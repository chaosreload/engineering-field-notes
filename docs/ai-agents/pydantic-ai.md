# pydantic/pydantic-ai Study Notes

> 整理日期：2026-04-20
> 仓库地址：<https://github.com/pydantic/pydantic-ai>
> 本文定位：Agent SDK 选型研究系列 [6/8]（系列 SDK 学习阶段收官）

## 一句话定位

**"FastAPI feel for GenAI agents"** —— 由 Pydantic 团队（就是那个几乎所有 Python AI SDK 都在用的校验库作者）做的 agent 框架，核心卖点是用 Python 类型系统把 agent 的 **deps、输入、输出、工具 schema** 全部锁死，写代码像写 FastAPI 一样顺手，mypy 能全程帮你抓错。

在我们这份选型矩阵里它代表 **"轻量派 / 类型安全派"**：定位跟 `claude-agent-sdk` 一样轻，但 claude-agent-sdk 是"Claude Code runtime 的 Python 壳"，pydantic-ai 是"跟 FastAPI/Logfire 共享世界观的通用 agent 框架"。

---

## 核心数据（2026-04-20 snapshot）

| 项 | 值 |
|---|---|
| GitHub stars | **16,498** ⭐ |
| Forks | 1,952 |
| Open issues | 514 |
| 版本 | **1.84.1**（已过 v1，"Production/Stable"） |
| License | MIT |
| Python | 3.10+ |
| 作者 | Samuel Colvin（Pydantic 作者）+ Pydantic 团队 |
| 依赖生态 | Pydantic v2 · Logfire · FastAPI 同款团队 |
| Model providers（原生） | OpenAI, Anthropic, Google (Gemini/Vertex), **AWS Bedrock**, Azure, Mistral, Cohere, Groq, HuggingFace, Ollama, OpenRouter, LiteLLM, Cerebras, xAI, DeepSeek, ……  |
| 特性 | Type-safe structured output · Dep injection · Tool decorator · Streaming · MCP · A2A · pydantic-graph (FSM) · pydantic-evals · Logfire 内置 · Durable execution · HITL tool approval |

---

## 项目结构

Monorepo，主要 4 个发布包：

```
pydantic-ai/
├── pydantic_ai_slim/pydantic_ai/    # 核心框架（90% 代码在这）
│   ├── agent/                       # Agent 主类
│   │   ├── abstract.py              # AbstractAgent[DepsT, OutputT]
│   │   └── __init__.py              # Agent 具体实现
│   ├── models/                      # 22 个 provider 适配器
│   │   ├── bedrock.py               # BedrockConverseModel
│   │   ├── anthropic.py / openai.py / google.py / ...
│   │   └── fallback.py              # 多 provider 降级
│   ├── tools.py                     # @agent.tool 装饰器 / RunContext
│   ├── _run_context.py              # RunContext[DepsT] dataclass
│   ├── _output.py                   # 结构化输出 (~43KB)
│   ├── _agent_graph.py              # 内部 FSM 引擎 (~90KB)
│   └── capabilities/                # 可组合的能力包
├── pydantic_graph/                  # pydantic-graph 子包（通用 FSM 框架）
│   ├── graph.py / nodes.py          # Graph / BaseNode / End
│   └── persistence/                 # 图状态持久化（支持 durable execution）
├── pydantic_evals/                  # pydantic-evals 子包（测试/评估）
├── clai/                            # CLI 工具（`clai` 命令行）
└── examples/                        # 官方示例
```

**观察**：
- 核心 `pydantic-ai-slim` 走极简方向，model providers 全部作为 `extras` 按需安装（`pip install "pydantic-ai-slim[bedrock]"`），避免一次拉 20 个 SDK。
- `pydantic-graph` 独立子包——**可以不用 agent 单独使用它作为通用类型安全 FSM 库**。
- 没有"重型"的 multi-agent orchestrator 模块（对比 crewAI 的 Crew、ADK 的 SequentialAgent），多 agent 编排的唯一官方方式就是 `pydantic-graph`。

---

## 核心架构 & 关键设计

### 1. Agent 是一个泛型：`Agent[DepsT, OutputT]`

```python
class AbstractAgent(Generic[AgentDepsT, OutputDataT], ABC):
    ...
```

这是 pydantic-ai 跟其他 SDK 最大的差异点。两个类型参数：

- **`DepsT`**：运行时依赖（httpx client、DB session、配置对象……），通过 `deps=` 传进 `agent.run()`，在工具函数里通过 `RunContext[DepsT]` 拿到。
- **`OutputT`**：输出类型，默认是 `str`；传 `output_type=YourPydanticModel` 后，`result.output` 就是强类型的 `YourPydanticModel` 实例。

IDE / mypy 会一路顺着泛型推下去——写工具函数时 `ctx.deps.xxx` 有全自动补全，`result.output.field` 有类型检查。

> `mypy --strict demo_01_structured_output.py` → **Success: no issues found**。在我们测试过的 6 家 SDK 里，只有 pydantic-ai 默认就通得过 strict mypy。

### 2. 结构化输出 = Pydantic 模型 → JSON Schema → 注入 prompt / tool call

`output_type=Weather` 时，pydantic-ai 会：

1. 用 `TypeAdapter(Weather).json_schema()` 生成 JSON Schema
2. 把 schema 作为"虚拟工具"注册给 LLM（或走 provider 原生 structured output）
3. LLM 返回的原始 JSON 用 `Weather.model_validate(...)` 校验 + 解析
4. 校验失败 → 自动再跑一轮让 LLM 修正（retry 机制内置）

实际跑的时候，`result.output` 是真实的 `Weather` 实例，不是 dict：

```
--- type(result.output) = Weather
City:      Guangzhou
Temp (C):  28.0
```

### 3. 工具注册：`@agent.tool` 读函数签名当 schema

```python
@agent.tool
def get_price(ctx: RunContext[StockDeps], ticker: str) -> float:
    """Get the current quoted price for a ticker symbol (USD)."""
    return ctx.deps.prices[ticker.upper()]
```

- 参数类型 → JSON schema（`ticker: str`）
- docstring → tool description（feed 给 LLM 作为工具说明）
- `ctx: RunContext[StockDeps]` 第一参数是特殊约定，**不会出现在工具 schema 里**，只是运行期注入 deps
- 还有 `@agent.tool_plain` 版本 = 不需要 `ctx` 时用

这个模式完全是 FastAPI 的依赖注入翻版，熟 FastAPI 的一眼就会。

### 4. `pydantic-graph` = 类型安全的 FSM

每个 node 是一个 dataclass，`run()` 方法的**返回类型注解**就是转移表：

```python
@dataclass
class AnalyzeQuery(BaseNode[GraphState, None, str]):
    async def run(self, ctx: GraphRunContext[GraphState, None]) -> "AnswerQuery":
        # 返回类型 = "AnswerQuery" 意味着必然转移到 AnswerQuery 节点
        ...

@dataclass
class AnswerQuery(BaseNode[GraphState, None, str]):
    async def run(self, ctx: GraphRunContext[GraphState, None]) -> End[str]:
        # 返回 End[str] = 图结束
        ...
```

跟 LangGraph 对比：
- LangGraph：edges 显式 `builder.add_edge("a", "b")` 配置，节点间跳转是字符串
- pydantic-graph：edges 通过**返回类型**隐式声明，mypy 能在编译期查出"这条边不存在"

另外 `pydantic-graph` 自带 **persistence**（in-memory / file / 自定义 backend），配合内置的 `message_history` 就能支持 durable execution（挂掉重启后接着跑）。

### 5. 生态：Logfire + FastAPI + Pydantic 三件套深度绑定

- **Logfire**（Pydantic 团队自家的 OTEL 平台）：`logfire.configure()` + `logfire.instrument_pydantic_ai()` 一键打开 agent 全链路 trace，token 成本自动聚合
- **FastAPI**：跟 `fasta2a` 包集成，Agent 可以直接 `agent.to_a2a()` 变 FastAPI app（A2A 协议）
- **Pydantic v2**：深度绑定，没有 pydantic 就没有 pydantic-ai

---

## 3 段 Demo（Bedrock Claude Sonnet 4.5 跑通）

部署：

```bash
python3 -m venv venv && source venv/bin/activate
pip install "pydantic-ai-slim[bedrock,logfire]" boto3
```

环境：`AWS_PROFILE=weichaol-testenv2-awswhatsnewtest` + `AWS_DEFAULT_REGION=us-west-2`，模型 `global.anthropic.claude-sonnet-4-5-20250929-v1:0`。

### Demo 1 — Type-safe structured output

目标：让 LLM 返回严格类型化的 `Weather` 对象。

```python
from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.models.bedrock import BedrockConverseModel

class Weather(BaseModel):
    city: str
    temp_c: float
    condition: str
    humidity_pct: int = Field(ge=0, le=100)

model = BedrockConverseModel("global.anthropic.claude-sonnet-4-5-20250929-v1:0")
agent = Agent(model, output_type=Weather, instructions="You are a weather reporter. ...")

result = agent.run_sync("What's the weather in Guangzhou?")
output: Weather = result.output   # ← 强类型，不是 dict
```

运行输出：

```
--- type(result.output) = Weather
City:      Guangzhou
Temp (C):  28.0
Condition: partly cloudy
Humidity:  75%
Elapsed:   2.43s
Usage:     RunUsage(input_tokens=816, output_tokens=98, requests=1)
```

`mypy --strict demo_01_structured_output.py` → 0 errors。

### Demo 2 — Deps 注入 + 工具

```python
@dataclass
class StockDeps:
    prices: dict[str, float]
    commission_bps: int

agent = Agent[StockDeps, str](model, deps_type=StockDeps, instructions="...")

@agent.tool
def get_price(ctx: RunContext[StockDeps], ticker: str) -> float:
    """Get the current quoted price for a ticker symbol (USD)."""
    return ctx.deps.prices[ticker.upper()]

@agent.tool
def calc_buy_cost(ctx: RunContext[StockDeps], ticker: str, shares: int) -> dict:
    ...

deps = StockDeps(prices={"NVDA": 135.10, ...}, commission_bps=5)
result = agent.run_sync("I want to buy 100 shares of NVDA...", deps=deps)
```

运行输出：

```
NVDA is currently trading at $135.10 per share.
- Notional cost:  $13,510.00
- Commission:     $6.76
- Total cost:     $13,516.76

Elapsed: 7.31s
Usage:   RunUsage(input_tokens=1676, output_tokens=197, requests=2, tool_calls=2)
```

Agent 自动识别出需要先 `get_price` 再 `calc_buy_cost`，一次 run 两个 tool call。

### Demo 3 — 多 agent via pydantic-graph

```python
@dataclass
class GraphState:
    question: str
    category: Category | None = None

@dataclass
class AnalyzeQuery(BaseNode[GraphState, None, str]):
    async def run(self, ctx) -> "AnswerQuery":
        r = await classifier.run(ctx.state.question)  # agent #1
        ctx.state.category = r.output.category
        return AnswerQuery()

@dataclass
class AnswerQuery(BaseNode[GraphState, None, str]):
    async def run(self, ctx) -> End[str]:
        agent = {"math": math_agent, "history": history_agent}.get(
            ctx.state.category, fallback_agent
        )
        r = await agent.run(ctx.state.question)     # agent #2
        return End(r.output)

graph = Graph(nodes=[AnalyzeQuery, AnswerQuery])
result = await graph.run(AnalyzeQuery(), state=GraphState(question="..."))
```

运行两个问题都正确路由：

```
Q: What is the derivative of x^3 sin(x)?
Trace: ['classified as math', 'answered via math agent']
Answer: ... (product rule, 3x²sin(x) + x³cos(x))

Q: Why did the Ming dynasty collapse?
Trace: ['classified as history', 'answered via history agent']
Answer: ... (fiscal breakdown, Little Ice Age, Li Zicheng 1644 ...)
```

**Demo 总成本**：3 个 demo 跑完 ≈ 3600 input tokens + 600 output tokens，Bedrock Claude Sonnet 4.5 ~$0.02（sub-cent per demo）。

---

## 六方对照表（本系列 5 通用 SDK + pydantic-ai）

> 注：deer-flow 是垂直应用（Deep Research 框架），跟这 6 个通用 SDK 不在同一层，不列入同表对比，在各列脚注提及。

| 维度 | claude-agent-sdk | **pydantic-ai** | strands-agents | deepagents | crewAI | adk-python |
|------|---|---|---|---|---|---|
| **主推者** | Anthropic | Pydantic | AWS | LangChain | CrewAI Inc | Google |
| **GitHub stars** | ~5.6k | **16.5k** | ~4.6k | ~5.4k | ~43k | ~18k |
| **定位** | Claude Code 的 Python 壳 | **通用轻量 + 类型安全信仰** | 通用轻量 + AWS 绑定 | LangGraph 上的"深度思考"模板 | 多 agent 协作"团队"编排 | Google 全家桶 agent 平台 |
| **Hello World 行数** | ~5 行 | **~5 行** | ~10 行 | ~15 行 | ~25 行（Agent + Task + Crew） | ~15 行 |
| **Type safety** | 弱（依赖 dict schema） | **🌟 最强：泛型 `Agent[DepsT, OutputT]` + strict mypy 过关** | 中（TypedDict） | 弱（LangChain 世界观） | 弱 | 中（pydantic 模型） |
| **结构化输出** | ❌ 原生没有（自己解析） | **🌟 原生一等公民**（`output_type=Model`） | ✅ 有（`output_schema`） | ✅ 靠 LangGraph state | ✅ `Task(output_pydantic=...)` | ✅ `output_schema` |
| **Deps 注入** | ❌ 无此概念 | **🌟 `RunContext[DepsT]` + 泛型 + FastAPI 味** | ❌ | ⚠️ 靠 state 传 | ❌ | ✅ `InvocationContext` |
| **工具注册 DX** | 自写 tool class | **🌟 `@agent.tool` 读签名**（FastAPI 同款） | `@tool` 装饰器 | LangChain tool | `@tool` 装饰器 | `@FunctionTool` |
| **多 agent 模式** | ❌ 不管（单 agent 壳） | **`pydantic-graph` FSM（类型安全转移）** 或 "agent as tool" | "agent as tool" / `GraphAgent` | Planner-Subagent 模板 | **Crew（Process.sequential/hierarchical）** | 8 种内置：Sequential/Parallel/Loop/LLM-driven... |
| **核心模型绑定** | Claude only（不支持别家） | 22+ providers（含 Bedrock 原生） | Bedrock 首选 + 其他 | 跟 LangChain 后端 | LiteLLM (100+) | Vertex/Gemini 首选 + LiteLLM |
| **生态绑定** | Claude Code / MCP | **Logfire + FastAPI + Pydantic v2** | AWS（Bedrock/AgentCore） | LangGraph/LangChain | 自有 Enterprise 平台 | Google Cloud / A2A / Vertex |
| **Observability** | 靠 Claude Code | **Logfire 内置 + OTEL 通用** | OTEL + CloudWatch | LangSmith | 自家 dashboard | Cloud Trace |
| **Durable execution** | ❌ | ✅ pydantic-graph persistence / Temporal / DBOS | ⚠️ 靠 Bedrock session | ✅ 靠 LangGraph checkpointer | ❌ | ✅ `Runner` 持久化 |
| **成熟度** | v0.x（跟 Claude Code 绑） | **v1.84（Production/Stable）** | v1.x | v0.x | v0.x 但社区大 | v1.x |
| **最适合场景** | Claude-only 项目、想复用 Claude Code 生态 | **生产级 type-safe agent、FastAPI/Logfire 栈、要把 LLM 输出当强类型数据用的场景** | AWS-native 全家桶（Bedrock + AgentCore + SageMaker） | 照搬"DeepResearch"套路 | 角色扮演式多 agent 团队协作 | Google Cloud 全家桶 + 需要丰富 orchestration 原语 |

> 垂直应用层（本系列第 6 篇 **deer-flow**）= 字节开源的 Deep Research 应用，跑在 LangGraph 上，不参与 SDK 层对比。

---

## 特写：**pydantic-ai vs claude-agent-sdk**（两个"薄"派的关键分歧）

两家都自称"极简"，但哲学几乎对立：

| 维度 | claude-agent-sdk | pydantic-ai |
|---|---|---|
| **"薄" 的含义** | 薄壳 → 把 CLI/runtime 交给 Claude Code | 薄核 → 自己实现 FSM、tool、output，但去掉一切花活 |
| **模型选择** | **只支持 Anthropic Claude** | 22+ provider（Bedrock/OpenAI/Gemini 平等对待） |
| **类型安全** | 可有可无 | **信仰级别**，泛型贯穿全栈 |
| **Runtime 依赖** | 需要 `claude` CLI + 一堆 Claude Code 生态 | 纯 Python 库，pip install 即跑 |
| **生态绑定** | Claude Code ecosystem | FastAPI / Logfire / Pydantic ecosystem |
| **适用人群** | 已经重度用 Claude Code 的开发者 | 已经用 FastAPI + Pydantic 做生产服务的团队 |
| **踩坑风险** | 绑死 Anthropic，provider 迁移成本高 | 绑死 Pydantic v2 API，`output_type` 只能用 Pydantic 模型 |

**一句话差异**：claude-agent-sdk 是"**Claude Code 用户想写 Python 时用的壳**"，pydantic-ai 是"**FastAPI 用户想写 LLM 应用时用的框架**"。两者几乎没有目标用户重叠。

---

## 关键发现 / 学习心得

### Top 3 核心发现

1. **"类型安全"不是宣传词，是真的被 mypy 强制。** `mypy --strict demo_01.py` 默认通过——这在我们跑过的 6 家 SDK 里是**唯一**一家。`Agent[DepsT, OutputT]` 泛型从 deps 到 output 一路透传，IDE 补全 + mypy 检查 + Pydantic 运行时校验三层叠加，把 "LLM 输出是 dict/str" 这个开发痛点从 runtime 搬到了 write-time。对比"LLM 输出要不要 parse 成 Pydantic" 这个问题，claude-agent-sdk / Strands / crewAI 要自己写校验逻辑，pydantic-ai 是 `output_type=Model` 一行配置。

2. **pydantic-ai 才是真正的 "Claude Code 壳之外的轻量派"。** Hello world 5 行，跟 claude-agent-sdk 一样薄，但：①模型不绑 Claude（Bedrock Converse API 原生支持 Claude/Nova/DeepSeek/Llama）②不需要 CLI runtime（纯 pip 库）③生态绑 FastAPI/Logfire 而不是 Claude Code。**选型矩阵里它填上了"不想上重型框架、但也不想绑死 Anthropic"这个中间档**——以前这个位置没有合适选手（Strands 稍重且绑 AWS，LangChain 过度工程）。

3. **`pydantic-graph` 把 LangGraph 做成了类型安全版。** 转移表不是字符串 `add_edge("a","b")`，而是 `run()` 方法的返回类型——错写一条边 mypy 直接报错。对于"就想搞个 2-3 步 FSM 协调 2 个 agent" 的场景（常见的 classify-then-route），pydantic-graph 比 LangGraph 轻量得多；但要搞 ADK 那种 Sequential/Parallel/Loop 一堆现成 orchestrator，pydantic-ai 需要自己在 graph 里写——这时候就不如 ADK 开箱即用。

### 踩坑 Top 3

1. **`pip install "pydantic-ai[bedrock]"` 会报 "does not provide the extra 'bedrock'"**。
   `extras` 是挂在 **`pydantic-ai-slim`** 上而不是 `pydantic-ai` 上。正确写法：`pip install "pydantic-ai-slim[bedrock,logfire]"`。安装 `pydantic-ai` 之后再装 `pydantic-ai-slim[...]` 也行，但更直接的做法是一开始就用 slim。

2. **gitnexus 多项目索引时必须传 `--repo`**。dev-server 上累积索引过 20+ 项目，`gitnexus query "..."` 会报 `Multiple repositories indexed`。加 `--repo pydantic-ai`（或在项目目录内用 `cd project && gitnexus query --repo project ...`）即可。

3. **Bedrock 模型 ID 必须是完整形式**（`global.anthropic.claude-sonnet-4-5-20250929-v1:0`），**不是** Anthropic API 的短名 `claude-sonnet-4-5`。`BedrockConverseModel("claude-sonnet-4-5")` 会直接 400。

---

## 一句话选型指引（本系列全量更新）

> **Claude-only 的脚本场景** → `claude-agent-sdk`  
> **想要 type-safe 生产级 agent / 已经在用 FastAPI+Pydantic+Logfire 栈** → **`pydantic-ai`** ⭐️（新入选）  
> **AWS-native（Bedrock + AgentCore + SageMaker）** → `strands-agents`  
> **想照搬 DeepResearch 套路** → `deepagents`  
> **角色扮演式多 agent 团队协作（客服群、写稿小组）** → `crewAI`  
> **Google Cloud 全家桶 + 需要丰富的 orchestration 原语** → `adk-python`  
> **直接落地 Deep Research 应用** → `deer-flow`（跑在 LangGraph 上的垂直应用）

---

## 参考资源

- 官方文档：<https://ai.pydantic.dev/>
- Samuel Colvin 的"Why we built Pydantic AI"：<https://pydantic.dev/articles/pydantic-ai>
- Graph 设计（vs LangGraph 对比）：<https://ai.pydantic.dev/graph>
- Bedrock provider：<https://ai.pydantic.dev/models/bedrock/>
- Demo 代码：`/data/projects/chaosreload/study/demo/pydantic-ai/demo_{01,02,03}_*.py`
