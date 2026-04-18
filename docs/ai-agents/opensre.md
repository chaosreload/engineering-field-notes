# OpenSRE：给 AI SRE Agent 配一套 SWE-bench 式的评测基建

> 整理日期：2026-04-18
> 仓库地址：https://github.com/Tracer-Cloud/opensre
> 版本：v2026.4.5（Public Alpha）
> 许可证：Apache-2.0
> 主页：https://opensre.com

## 项目简介

SWE-bench 解决了"代码 agent 怎么量化变强"这个问题——给一个仓库、一个 issue、一组失败测试，agent 能不能修好，客观可打分。但**生产事故响应没有等价物**。日志散在 Datadog、指标散在 Grafana、traces 散在 Honeycomb、context 散在 Slack、runbook 散在 Notion，出一次事故连最基本的"ground truth 是什么"都难以结构化。

Tracer-Cloud 的回答是 OpenSRE：**一个开源的 AI SRE agent 框架 + 一套可评分的合成事故数据集**。两件事同时做，而且数据集比 agent 本身更值得看。

核心主张：

- 给 AI SRE 建一个类似 SWE-bench 的评测协议——每个 scenario 有结构化的 alert、fixture（CloudWatch metrics / Performance Insights / RDS events）、answer key（root_cause_category、required_keywords、forbidden_categories、optimal_trajectory、max_investigation_loops）。
- agent 本身用 LangGraph 构建，两套模式：chat（带工具调用）和 investigation（确定的 5 节点 DAG 再进循环）。
- 40+ 集成覆盖整个现代可观测性栈：Grafana / Datadog / Honeycomb / Coralogix / CloudWatch / Sentry / Elasticsearch / MongoDB / PagerDuty / Slack / Jira / …
- **Protocols 一栏明确列了 MCP · ACP · OpenClaw**——这是 Tracer 官方把 OpenClaw 纳入它的协议集。

适合场景：**想搭自托管 AI SRE、或者想为自己的 SRE agent 做 benchmark 的人。** 跑不了 SWE-bench 的生产类 agent 终于有一个对照基准了。

## 项目结构

```
opensre/
├── app/
│   ├── cli/                 opensre CLI（onboard / investigate / deploy / health…）
│   ├── pipeline/
│   │   ├── graph.py         LangGraph DAG 装配（核心入口）
│   │   ├── routing.py       条件边：chat vs investigation，diagnose 后是否再循环
│   │   └── runners.py       run_investigation() 等入口
│   ├── nodes/               DAG 节点：
│   │   ├── extract_alert/
│   │   ├── resolve_integrations/
│   │   ├── plan_actions/
│   │   ├── investigate/
│   │   ├── root_cause_diagnosis/
│   │   ├── publish_findings/
│   │   ├── chat.py          chat 模式路由器 + 工具执行器
│   │   └── auth.py
│   ├── integrations/        40+ 第三方：grafana、datadog、sentry、…、openclaw.py
│   ├── services/            更底层的 client（grafana、datadog、eks、tracer_client、…）
│   ├── tools/               100+ investigation tool
│   │   ├── AWSOperationTool / EKSPodLogsTool / …
│   │   ├── OpenClawMCPTool  通过 OpenClaw MCP 桥接的工具
│   │   └── investigation_registry/
│   ├── state/               AgentState / InvestigationState（LangGraph state）
│   ├── masking/             发给 LLM 前对 evidence 做可逆脱敏
│   ├── guardrails/          输出护栏
│   ├── sandbox/             沙箱执行
│   ├── deployment/          一键部署到 Railway / Vercel / EC2 / ECS / Lambda
│   └── webapp.py            FastAPI 入口（langgraph.json 指向它）
├── tests/
│   ├── synthetic/rds_postgres/   ⭐ 15 个 RDS PostgreSQL 合成事故 scenario
│   │   ├── 000-healthy/ ... 014-checkpoint-storm-cpu-saturation/
│   │   ├── schemas.py       fixture 的 TypedDict schema
│   │   ├── scenario_loader.py
│   │   ├── run_suite.py     Axis 1 跑 & 打分
│   │   ├── test_suite.py    pytest 版
│   │   └── test_suite_axis2.py  Axis 2 对抗推理质量
│   └── e2e/                 真实 k8s/EC2/CloudWatch/Lambda/ECS/Flink 场景
├── langgraph.json           LangGraph Platform 部署声明
└── Makefile                 make install / make benchmark / make test-cov / make test-rca
```

`app/tools/` 下有 **100 个以上 tool class**——从 `EKSPodLogsTool` / `LambdaErrorsTool` / `S3InspectTool` / `GrafanaLogsTool` / `HoneycombTracesTool` / `DatadogAllTool` 一路到 `MySQLSlowQueriesTool` / `PostgreSQLReplicationStatusTool` / `KafkaConsumerGroupTool`。这是 opensre 在 integration 上最粗暴的优势：不写架构论文，先把"一个真实 SRE 会翻的每个地方"都写成了一个 Tool 类。

## 核心架构

`app/pipeline/graph.py` 一眼看懂：

```text
                    ┌──────────────┐
                    │ inject_auth  │  给 state 注入 auth context
                    └──────┬───────┘
                           │  route_by_mode
             ┌─────────────┴─────────────┐
             ▼                           ▼
     ┌──────────────┐          ┌──────────────────┐
     │   router     │          │  extract_alert   │
     │  (chat mode) │          │ (investigation)  │
     └──────┬───────┘          └────────┬─────────┘
            │ route_chat                │ route_after_extract
     ┌──────┴──────┐                    │
     ▼             ▼                    ▼
 chat_agent   general        resolve_integrations
     │             │                    │
     │ should_call_tools                │
     ▼             ▼                    ▼
 tool_executor    END             plan_actions
     │                                  │
     └──► chat_agent (循环)              ▼
                                    investigate
                                         │
                                         ▼
                                     diagnose
                                         │  route_investigation_loop
                                 ┌───────┴─────────┐
                                 │                 │
                                 ▼                 ▼
                            plan_actions        publish
                             (再循环)              │
                                                  ▼
                                                 END
```

两个关键设计：

**1. 把"自由对话"和"结构化事故调查"拆成两个子图。** chat 路径让模型自由调工具——适合人机对话、追问；investigation 路径是固定的 5 节点流水线 + 条件回环——适合自动化触发、结果可预测、可评测。

**2. `investigate → diagnose → (回到 plan_actions 或收尾)` 是一个 rationale 驱动的循环。** `route_investigation_loop` 在 `diagnose_root_cause` 拿到 validity_score 之后决定"证据够了去 publish / 证据不够回去 plan_actions 再跑一轮"。这个 loop 上限由 `max_investigation_loops`（state 字段）硬限制，避免无限 LLM 调用烧钱。

**3. `root_cause_diagnosis/claim_validator.py` 是 agent 防胡说的关键。** LLM 给出的 validated_claims 会逐条回到 evidence 里验证是否有对应证据，**没有证据的 claim 会被降级到 non_validated_claims 并扣分**。最后计算出 `validity_score`，这不是一个自我打分，是"每条陈述都有证据"这个形式化目标。

**4. evidence 对 LLM 的可逆脱敏。** `app/masking/MaskingContext` 在把 evidence 喂给 LLM 之前做一轮脱敏（DB 名、IP、主机名），等模型输出再反向映射回来。这是生产环境跑 AI SRE 的必需品——合规审计的人第一个问题就是"你发给 Claude 的数据里有没有 PII"。

## 100+ tool 的组织方式

所有 tool 在 `app/tools/<ToolName>/` 下，每个类一个目录，用 `@tool` 装饰器注册到 `investigation_registry`。`plan_actions` 节点让 LLM 输出 `actions: list[str]`（纯字符串名字），再由 `investigate` 节点根据名字查出真正的 tool class 并执行。

好处：

- 即便 LLM 幻觉出不存在的 action，`investigate` 节点会在 warning log 里忽略，不会 crash。
- 新加一个集成只要新建目录 + 一个 class，不用动 graph 代码——这是整个项目对外贡献 PR 的主路径。

tool 的列表很能看出这个项目的真实面向：`EKSPodLogsTool` / `LambdaErrorsTool` / `LambdaInvocationLogsTool` / `PostgreSQLSlowQueriesTool` / `MongoDBCurrentOpsTool` / `MariaDBSlowQueriesTool` / `MySQLReplicationStatusTool` / `KafkaTopicHealthTool` / `PrefectFlowRunsTool` / `TracerFailedJobsTool` ... 几乎把"SRE 凌晨 3 点会翻的每一个 dashboard"都对应出一个类。

### OpenClaw 作为 MCP 集成

`app/integrations/openclaw.py` + `app/tools/OpenClawMCPTool/` 把 OpenClaw 接成一个 **MCP server**：

```python
class OpenClawConfig(StrictConfigModel):
    url: str = ""
    mode: Literal["stdio", "sse", "streamable-http"] = "streamable-http"  # 默认
    auth_token: str = ""
    command: str = ""          # stdio 模式用
    args: tuple[str, ...] = ()
    ...
```

三种传输全部支持：`streamable-http`（默认，走 OpenClaw 的 Gateway API）、`sse`、`stdio`（本地 `openclaw mcp serve` 子进程）。这意味着 **opensre agent 可以把 OpenClaw 提供的"跨通道对话历史 + 跨 agent 协作"作为证据来源**——比如从 Slack/Telegram/Discord 的对话中捞出 on-call 讨论记录，和 Grafana 指标一起做 root cause。

README 的 Protocols 栏把 OpenClaw 和 MCP、ACP 并列——这是 Tracer 官方把 OpenClaw 定位成一类"agent 互操作协议"的信号。

## 合成 RCA 评测套件（最稀缺的部分）

`tests/synthetic/rds_postgres/` 下有 15 个 RDS PostgreSQL 合成 scenario，每个是一个目录：

```
001-replication-lag/
├── scenario.yml                  场景元数据（failure_mode, severity, depends_on）
├── alert.json                    输入：Prometheus 式 alert payload
├── aws_cloudwatch_metrics.json   fixture：CloudWatch GetMetricData 响应
├── aws_rds_events.json           fixture：RDS Event 流
├── aws_performance_insights.json fixture：PI DB load + top_sql
└── answer.yml                    ground truth（见下）
```

`answer.yml` 就是整个项目最有价值的东西：

```yaml
root_cause_category: resource_exhaustion
required_keywords:
  - replication lag
  - write-heavy workload
  - replica
  - wal
forbidden_categories:
  - cpu_saturation         # 对抗场景：不能被 CPU 红鲱鱼误导
optimal_trajectory:
  - query_grafana_metrics
  - query_grafana_logs
  - query_grafana_alert_rules
max_investigation_loops: 3
model_response: |          # 参考答案（理想输出）
  ROOT_CAUSE: The database hit replication lag because a write-heavy workload ...
  CAUSAL_CHAIN:
  - A write-heavy workload drove sustained bulk updates on the primary.
  - WAL generation increased faster than the replica could replay.
  - Replication lag accumulated ...
```

15 个 scenario 覆盖：healthy / replication_lag / connection_exhaustion / storage_full / cpu_saturation / failover，以及**故意加红鲱鱼的对抗场景**：

- `006-replication-lag-cpu-redherring` — 真因是 replication，但 CPU 指标也短暂飙高，agent 容易错归因到 CPU
- `007-connection-pressure-noisy-healthy` — 看起来有 connection 压力但其实健康，agent 容易误报
- `009-dual-fault-connection-cpu` — 同时两种故障，检验能不能列全
- `010-replication-lag-missing-metric` — 关键 metric 缺失，考验 agent 能不能从其他证据推断
- `012-replication-lag-misleading-events` — event 流给出误导性描述
- `013-storage-recovery-false-alert` — 存储已自愈的 false positive
- `014-checkpoint-storm-cpu-saturation` — 高级组合

**评分三轴**（`tests/synthetic/rds_postgres/run_suite.py`）：

```
Axis 1  Primary RCA accuracy
  ✓ root_cause_category 是否正确
  ✓ required_keywords 是否全部出现在模型结论里（字符串匹配）
  ✓ 没踩 forbidden_categories

Axis 2  Reasoning quality (adversarial)
  ✓ ruling_out_keywords：agent 是否主动排除了红鲱鱼？
  ✓ required_queries：是否做了关键的反证查询（如对应 metric 名）

Efficiency / trajectory
  ✓ 实际 action 序列覆盖了 optimal_trajectory 里的必要步骤（集合包含）
  ✓ investigation loops <= max_investigation_loops
```

跑完 15 个 scenario 就能得到一个 agent 的 benchmark 分数——**这是目前 SWE-bench 到 AI SRE 之间最接近的桥梁**。

## 部署步骤（在 dev-server 上复现）

项目规定 `python >= 3.13`。dev-server 只有 3.11，部分依赖（pydantic + TypedDict）在 3.11 下会出问题，但**不影响理解架构 + 消费 synthetic 套件**。

```bash
# 1. clone
git clone https://github.com/Tracer-Cloud/opensre.git
cd opensre

# 2. 在 3.13 环境下走官方路径
make install       # 创建 .venv + pip install -e ".[dev]"

# 3. 诊断环境
opensre doctor
# 期望：python / env_file / llm_provider / integrations / version / network 6 项全绿

# 4. 配 LLM（以 Bedrock 为例，因为我们有现成的 profile）
cat > .env <<EOF
LLM_PROVIDER=bedrock
BEDROCK_REASONING_MODEL=global.anthropic.claude-sonnet-4-6
BEDROCK_TOOLCALL_MODEL=global.anthropic.claude-haiku-4-5-20251001-v1:0
AWS_PROFILE=weichaol-testenv2-awswhatsnewtest
AWS_REGION=us-east-1
EOF

# 5. 跑一次 investigate（K8s datadog alert fixture）
opensre investigate -i tests/e2e/kubernetes/fixtures/datadog_k8s_alert.json \
                    -o /tmp/opensre-demo-result.json

# 6. 跑合成 RCA 套件
make test-rds-synthetic
make benchmark
```

### 踩过的坑

- **Python 3.11 不够**。`pyproject.toml` 要求 `>=3.11` 但 pydantic 运行时会对 `typing.TypedDict` 在 3.11 报 `Please use typing_extensions.TypedDict instead`，`investigate` 路径直接 crash。必须 **Python 3.13**（`.tool-versions` 里写的是 3.13.11）。我们用 3.11 跑 `opensre version / opensre doctor / 载入 synthetic scenario` 这些不走 LangGraph 主路径的命令是可以的。
- **Bedrock 默认模型 ID 是 `us.anthropic.*`**（美东 Inference Profile）。如果你用 cross-region 的 global profile，要把 `BEDROCK_REASONING_MODEL` 改成 `global.anthropic.*`，否则 `InvokeModel` 会 403。
- **langgraph.json 写死了部署入口 `app.graph_pipeline:build_graph`**。源码早就迁到了 `app.pipeline.graph`，`app/graph_pipeline.py` 只是一个 compat shim。部署到 LangGraph Platform 时千万别以为这是主文件去改。
- **onboard 向导会在 `~/.tracer/integrations.json` 落盘，依赖 keyring 存敏感信息**。在 headless server 上 keyring 拿不到 secret，会默认走 plaintext fallback——生产部署要注意。
- **1500+ stars 的项目很大部分 commit 来自 tracer-bot 账户**（`davincios` / `aliya-tracer` / `arnetracer` / `kylie-tracer` / `paultracer` 等等），判断社区活跃度时要打折扣——但代码质量和测试覆盖率确实高于同类开源 SRE 框架。

## Demo 示例

不需要完整 pipeline 和 LLM，直接消费合成 RCA 套件——**这是 opensre 真正值得抄的资产**。放在 dev-server：`/data/projects/chaosreload/study/demo/opensre/scenarios.py`

```python
from tests.synthetic.rds_postgres.scenario_loader import load_all_scenarios

scenarios = load_all_scenarios()   # 15 scenarios

for sc in scenarios:
    md = sc.metadata        # failure_mode, severity, db_instance_identifier, ...
    ak = sc.answer_key      # root_cause_category, required_keywords, ...
    print(sc.scenario_id, md.failure_mode, ak.root_cause_category,
          len(ak.required_keywords), ak.max_investigation_loops)
```

跑起来：

```
$ .venv/bin/python /data/projects/chaosreload/study/demo/opensre/scenarios.py
Loaded 15 RDS PostgreSQL synthetic scenarios

scenario_id                              | failure_mode           | sev      | category              | kw | traj | loops
001-replication-lag                      | replication_lag        | critical | resource_exhaustion   |  4 |   3  |   3
002-connection-exhaustion                | connection_exhaustion  | critical | resource_exhaustion   |  4 |   3  |   3
003-storage-full                         | storage_full           | critical | resource_exhaustion   |  2 |   3  |   3
004-cpu-saturation-bad-query             | cpu_saturation         | critical | resource_exhaustion   |  3 |   3  |   3
005-failover                             | failover               | critical | infrastructure        |  4 |   3  |   3
006-replication-lag-cpu-redherring       | replication_lag        | critical | resource_exhaustion   |  3 |   3  |   3
007-connection-pressure-noisy-healthy    | healthy                | warning  | healthy               |  2 |   3  |   3
...

================================================================================
示例：scenario 006 (replication-lag-cpu-redherring) 的 answer_key
================================================================================
scenario_id            : 006-replication-lag-cpu-redherring
failure_mode           : replication_lag
root_cause_category    : resource_exhaustion
required_keywords      : ['replication', 'WAL', 'replica']
forbidden_categories   : ['cpu_saturation']   ← 评分要点：不能被 CPU 红鲱鱼误导
optimal_trajectory     : ['query_grafana_metrics', 'query_grafana_logs', 'query_grafana_alert_rules']
max_investigation_loops: 3

evidence fixtures:
  aws_cloudwatch_metrics  : dict keys=['namespace', 'period', 'start_time', ...]
  aws_rds_events          : 1 items
  aws_performance_insights: dict keys=['db_instance_identifier', 'top_sql', ...]
```

有了这个就能自己写 agent 跑对比——不管是 opensre、自研 LangGraph agent、还是直接 prompt Claude/GPT，都用同一套 answer_key 打分，得到可比较的分数。

## 关键发现 / 学习心得

- **"定义评测协议比写 agent 更稀缺"。** LangGraph 版 SRE agent 不是新概念（Rootly / Causely / Neubird / Cleric / FixIt 等都在做），但**把 scenario + fixture + answer_key 结构化开源**的只有 opensre 一家。SWE-bench 之于代码 agent 的意义就在于让所有人用同一把尺子，opensre 在 SRE 场景复刻这件事——如果真能形成事实标准，这个项目的网络效应会非常大。
- **"百个 Tool class + LangGraph DAG"是目前 agent 系统的默认形态。** 不用过度设计抽象层：每个 tool 一个类、一个 `@tool` 装饰器、一个 string 名字丢给 LLM 做 plan，剩下全是数据。相比"agent 自己决定调哪个工具"，**plan_actions 节点让 LLM 先输出 `list[str]` 再由代码层 dispatch** 是一个更健壮的两段式——LLM 负责语义选择，Python 负责 routing/容错。这个 pattern 值得抄。
- **"对抗样本是 agent evaluation 的核心"。** 15 个 scenario 里至少 6 个是红鲱鱼/缺 metric/dual fault/误导 event，这种带对抗性的 test case 才是真正拉开 LLM 差距的地方——纯"正常 case"所有现代模型都能做到 90%+。`forbidden_categories` + `ruling_out_keywords` 这两个字段的设计尤其精妙——不仅看你猜对了什么，更看你有没有主动排除什么。
- **Claim Validator 是防幻觉的正确方向。** `root_cause_diagnosis/claim_validator.py` 对每条 LLM 声明回证到 evidence——这和简单让 LLM"生成 confidence score"有本质差别。**"每条陈述都可追溯到证据"作为形式约束**比 prompt engineering 可靠一个数量级。任何要上生产的 RAG / agent 都该抄这个模式。
- **OpenClaw 被纳入 Protocols 一栏是一个强信号。** Tracer 把 OpenClaw 和 MCP、ACP 并列为 agent 互操作协议——说明 OpenClaw 正在被第三方 agent 框架当作基础设施而非可选集成。值得让码虾跟进 `app/tools/OpenClawMCPTool/` 的使用方式，看我们自己的 gateway 是否还有改进空间（transport 模式、auth token 格式、错误语义等）。
- **可逆脱敏（masking）这件事被严肃对待。** 见过太多 agent 项目把 evidence 原样发给 LLM 然后被安全团队否决。opensre 把 MaskingContext 做到了 pipeline 层，默认启用环境变量控制——这是为 enterprise 设计的产品级细节。
- **"用 make 做所有事"仍然是正确选择。** 项目的 `Makefile` 有 80+ target：test / deploy-ec2 / deploy-lambda / test-rca / test-k8s / deploy-eks / deploy-dd-monitors / benchmark / cleanup-dd-monitors... 一条 shell 能做的事不要包成 Python CLI。opensre 把 CLI 留给面向用户的命令（onboard / investigate / deploy / doctor），把运维和开发留给 Makefile——这种边界划得很老到。

## 对标

- **Rootly / FireHydrant / incident.io**：商业 incident management，偏流程和协作，不开源 agent，不做 benchmark。
- **Cleric / Neubird / Causely**：商业 AI SRE agent，闭源、无法自托管、没有可评分的数据集。
- **ServiceWeaver / Kubeshark / K9s**：infra observability tools，不是 agent，不涉及 RCA 推理。
- **LLM 原生方案（ChatGPT Advanced Data Analysis）**：没有连接真实可观测性栈，只能做 one-shot 分析。
- **继续关注**：opensre 是目前**同时满足"开源 + 可自托管 + 有 benchmark 数据集 + 活跃维护 + 40+ 集成"的唯一选择**。如果评测协议能跨 DB/k8s/Lambda/Kafka 扩展到 50+ scenario 级别，这个项目有可能变成整个 AI SRE 领域的 de facto 评测基准。

## 参考资源

- 仓库：<https://github.com/Tracer-Cloud/opensre>
- 官方文档：<https://www.opensre.com/docs>
- Quickstart：<https://www.opensre.com/docs/quickstart>
- SWE-bench 原论文（项目定位参照）：<https://arxiv.org/abs/2310.06770>
- 关键源码：
  - LangGraph DAG：`app/pipeline/graph.py`
  - Root-cause claim validator：`app/nodes/root_cause_diagnosis/claim_validator.py`
  - OpenClaw MCP 集成：`app/integrations/openclaw.py` + `app/tools/OpenClawMCPTool/`
  - 合成 RCA 套件：`tests/synthetic/rds_postgres/`
  - 评分逻辑：`tests/synthetic/rds_postgres/run_suite.py`
- 本次整理的运行环境：dev-server `/data/projects/chaosreload/study/repo/public/opensre`
- Demo：`/data/projects/chaosreload/study/demo/opensre/scenarios.py`
