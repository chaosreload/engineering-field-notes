# crewAI Getting Started

> 整理日期：2026-04-20
> 仓库地址：https://github.com/crewAIInc/crewAI

## 项目简介

CrewAI 是一个**role-based 多 Agent 编排框架**——把 AI Agent 想象成一支「剧组」：每个 Agent 有明确的 `role / goal / backstory`，一组 `Task` 按流程分配给 Agent 执行，由 `Crew` 作为团队容器统一调度。

**两套互补 API：**

- **Crews**：声明式、自主协作。适合"多个专业角色一起做一件事"的场景（研究员 → 写作 → 审核）。
- **Flows**：事件驱动编排，通过 `@start / @listen / @router` 装饰器显式描述流程图。对标 LangGraph，主打"精细控制 + 单次 LLM 调用节省"，可原生嵌入 Crews 作为节点。

**定位：** Python 原生、零 LangChain 依赖（README 强调"built from scratch, completely independent of LangChain"），既做 OSS 又做商业 AMP Suite（Control Plane / Observability / Enterprise）。PyPI 包名 `crewai`，MIT。

---

## 核心数据

| 项 | 值 |
|---|---|
| GitHub stars | **49,310** ⭐（2026-04-20） |
| Forks | 6,745 |
| Open issues | 400 |
| PyPI 版本 | `crewai 1.14.2` |
| Python 支持 | 3.10 – 3.13 |
| 社区 | 号称 >100K developers certified through learn.crewai.com |
| License | MIT |
| gitnexus 规模 | **16,005 nodes / 42,370 edges / 870 clusters / 300 flows** |
| 仓库规模 | monorepo 4 包：`crewai` / `crewai-files` / `crewai-tools` / `devtools` |
| 原生 LLM provider | OpenAI / Anthropic / Azure / Bedrock / Gemini / OpenAI-compatible |

---

## 项目结构

```
crewAI/                              # monorepo
└── lib/
    ├── crewai/                      # 主包
    │   └── src/crewai/
    │       ├── crew.py              # Crew 主入口（2,298 行）
    │       ├── process.py           # Process.sequential / hierarchical 枚举
    │       ├── task.py              # Task 定义（1,353 行）
    │       ├── llm.py               # LLM 工厂（按 model 前缀路由 provider）
    │       ├── agent/               # Agent 核心
    │       │   ├── core.py          # class Agent（1,851 行）
    │       │   ├── internal/        # 执行辅助
    │       │   └── planning_config.py
    │       ├── agents/
    │       │   ├── crew_agent_executor.py  # 每个 Agent 的执行 loop（ReAct-like）
    │       │   └── agent_adapters/
    │       ├── tasks/               # conditional_task / hallucination_guardrail 等高级 task
    │       ├── flow/
    │       │   ├── flow.py          # Flow + @start/@listen/@router（3,460 行）
    │       │   ├── flow_config.py
    │       │   └── human_feedback.py
    │       ├── llms/providers/      # 原生 provider 实现
    │       │   ├── anthropic/
    │       │   ├── bedrock/         # 基于 boto3.Session + Converse API
    │       │   ├── openai/ azure/ gemini/ openai_compatible/
    │       ├── tools/               # 工具基础设施
    │       │   ├── base_tool.py     # BaseTool + @tool 装饰器
    │       │   ├── structured_tool.py
    │       │   ├── tool_usage.py
    │       │   └── agent_tools/     # delegate / ask_human 等内置
    │       ├── mcp/                 # MCP 原生支持（stdio / SSE / HTTP transport）
    │       ├── a2a/                 # A2A 协议（对外暴露 agent）
    │       ├── memory/              # short-term / long-term / entity memory
    │       ├── knowledge/           # 知识库（文件/URL/向量）
    │       ├── rag/                 # 内置 RAG（ChromaDB）
    │       ├── events/              # OpenTelemetry + 自定义事件总线
    │       ├── telemetry/
    │       └── cli/                 # `crewai` 命令行（scaffold 项目）
    ├── crewai-files/                # 文件操作工具包
    ├── crewai-tools/                # 官方工具库（SerperDev/ScrapeWebsite/...）
    └── devtools/
```

---

## 核心架构

```
┌──────────────────────────────────────────────────────────────────────┐
│  两套顶层 API                                                         │
│                                                                      │
│   Crew API（声明式 / 自主协作）          Flow API（事件驱动 / 精细控制） │
│   ┌────────────────────────┐           ┌────────────────────────┐   │
│   │  Crew(                 │           │  class MyFlow(Flow):   │   │
│   │    agents=[a1, a2],    │           │    @start()            │   │
│   │    tasks=[t1, t2],     │           │    def begin(): ...    │   │
│   │    process=sequential  │           │    @listen("begin")    │   │
│   │           | hierarchical│           │    def step2(): ...    │   │
│   │  ).kickoff()           │           │    @router(step2)      │   │
│   └────────────────────────┘           │    def branch(): ...   │   │
│           │                            └────────────────────────┘   │
│           │   ←── Flow 可以原生把 Crew 当作一个节点调用 ──→          │
└───────────┼──────────────────────────────────────────────────────────┘
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Crew 调度层                                                          │
│                                                                       │
│  process = sequential                 process = hierarchical          │
│  ┌───────────────────────┐            ┌───────────────────────────┐  │
│  │ for task in tasks:    │            │ 自动生成 manager Agent    │  │
│  │   task.agent.execute()│            │   （tools=AgentTools(...))│  │
│  │ → 按 tasks 顺序跑       │            │ manager 通过 delegate     │  │
│  │   后一个 task 默认       │            │   工具把 task 下发给       │  │
│  │   拿到前面 task.output   │            │   任意 worker agent       │  │
│  └───────────────────────┘            └───────────────────────────┘  │
└───────────────────────────┬──────────────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Agent 执行层（每个 Agent 一个独立 loop）                             │
│                                                                       │
│  CrewAgentExecutor:                                                   │
│    system prompt = role + goal + backstory + tool schema              │
│    loop:                                                              │
│      1. 让 LLM 产出 Thought/Action/Action Input/Observation           │
│      2. 解析 action → 查工具 → 执行 → 回填 observation                │
│      3. 看到 Final Answer → 返回给 Crew                               │
│    max_iter / max_rpm / memory / guardrail / HITL 在此层生效          │
└──────────────────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┼────────────────┐
            ▼               ▼                ▼
      Tool 系统         Memory 系统       LLM provider
      ┌───────────┐   ┌────────────┐   ┌──────────────────┐
      │ BaseTool  │   │ short-term │   │ class LLM(model=)│
      │ @tool 装饰│   │ long-term  │   │  按前缀路由：     │
      │ MCP tool  │   │ entity     │   │  bedrock/... →   │
      │ structured│   │ ChromaDB   │   │  BedrockCompletion│
      └───────────┘   └────────────┘   │  anthropic/... → │
                                        │  AnthropicCompl. │
                                        │  openai/... → ...│
                                        └──────────────────┘
```

---

## 关键设计

### 1. Role-based prompt 是一等公民

每个 `Agent` 必须声明三件套：

```python
Agent(
    role="AI Industry Researcher",
    goal="Find 3 crisp facts about a topic",
    backstory="You are a senior analyst who loves concise, well-sourced takes.",
    llm=llm,
)
```

这三个字段会被拼成 system prompt 的骨架。CrewAI 的核心假设是"让 LLM 扮演明确角色 + 给它一个清晰的 task 目标，产出质量显著更高"。这也是和 Strands/deepagents 最大的哲学差异——后两者把 Agent 当成「带工具的 LLM 调用」，CrewAI 把 Agent 当成「剧组里的角色」。

### 2. Task 是显式编排单位

不像 Strands/deepagents 那样把"任务"藏在 system prompt / 用户消息里，CrewAI 把 `Task` 拎出来做成一等对象：

```python
Task(
    description="Turn the researcher's bullets into a Chinese markdown summary.",
    expected_output="A markdown section with exactly 3 Chinese bullets.",
    agent=writer,
    context=[task1],  # ← 显式声明上游依赖，自动注入 task1.output
)
```

好处：流程可视化、task 复用、依赖清晰。副作用：上手"更像写 BPMN 而不是写代码"，对简单场景偏重。

### 3. Sequential vs Hierarchical 两种调度

- **sequential**：按 `tasks` 数组顺序跑，后一个 task 自动继承前面的 output。简单、可预测。
- **hierarchical**：Crew 额外创建一个 **manager agent**（用 `manager_llm` 参数指定模型），manager 拿到 `AgentTools(agents).tools()`（即 delegate 工具），自己决定把 task 下发给哪个 worker。Demo 实测：同一个任务 sequential 用 **1,288 tokens** 跑完，hierarchical 用 **38,337 tokens / 15 次 LLM 调用** 才完成——贵近 30 倍，但在"开放式任务、不知道谁该做什么"的场景下有价值。

源码里的 hierarchical 实现很朴素（`crew.py:1401`）：

```python
def _run_hierarchical_process(self) -> CrewOutput:
    self._create_manager_agent()  # 自动拼出带 delegate 工具的 manager
    return self._execute_tasks(self.tasks)
```

manager agent 就是一个普通 Agent，只不过 `allow_delegation=True` + `tools=AgentTools(agents).tools()`。一句话：**hierarchical 其实是 sequential 跑一个拥有"分派工具"的 manager。**

### 4. Flow API 的定位 — 和 LangGraph 正面对标

Flow 不是"更好的 Crew"，而是**完全不同层次**：

- Crew = 让 LLM 自己协作，你只声明角色和任务
- Flow = 你画流程图，每个节点可以是普通 Python 函数、LLM 调用、或者一整个 Crew

装饰器：
- `@start()` — 入口，可带条件（某方法跑完后才启动）
- `@listen(method_or_condition)` — 监听上游事件
- `@router(method)` — 分支路由，返回字符串，下游用 `@listen("label")` 接

State 是 Pydantic 模型，整条 Flow 共享。Flow 适合"我已经知道流程该怎么走，只是想让 LLM 做其中几步决策"的场景。这点和 LangGraph 的 `StateGraph` 几乎同构，只是 CrewAI 的哲学更轻——没有图编译、没有 reducer，全靠装饰器+事件总线。

### 5. LLM 抽象：按前缀路由到原生 provider

CrewAI 1.x 大幅去除 LiteLLM 依赖，自建原生 provider：

```python
LLM(model="bedrock/global.anthropic.claude-sonnet-4-5-20250929-v1:0")
# → 按前缀 "bedrock/" 自动实例化 BedrockCompletion（基于 boto3 Converse API）

LLM(model="openai/gpt-4o")     # → OpenAICompletion
LLM(model="anthropic/claude-sonnet-4-5")  # → AnthropicCompletion
```

支持清单（`lib/crewai/src/crewai/llms/providers/`）：`openai / anthropic / azure / bedrock / gemini / openai_compatible`。Bedrock 用 boto3 原生 Converse，无需 LiteLLM 中转。

### 6. MCP 原生支持

`crewai/mcp/` 目录独立实现 stdio / SSE / HTTP 三种 transport，agents 可以直接加载 MCP server 的工具：

```python
from crewai.mcp import MCPServerAdapter
with MCPServerAdapter({"command": "uvx", "args": ["some-mcp-server"]}) as tools:
    agent = Agent(..., tools=tools)
```

不依赖 LangChain 的 `langchain-mcp-adapters`。

### 7. 全链路 OpenTelemetry

`events/listeners/tracing/` 在 Crew/Flow 启动时自动注入 OTel baggage 和 span，每个 task/tool/llm call 都有 trace。这一点上和 Strands 持平（deepagents 走 LangSmith，Claude SDK 靠 CLI 日志）。

---

## 3 段 Demo（Bedrock Claude Sonnet 4.5）

环境：`python 3.12.12` + `crewai==1.14.2` + `boto3` + `AWS_PROFILE=weichaol-testenv2-awswhatsnewtest` + region `us-east-1`。

### Demo 1：最基础的 Crew（sequential）

```python
from crewai import Agent, Task, Crew, Process, LLM

llm = LLM(model="bedrock/global.anthropic.claude-sonnet-4-5-20250929-v1:0",
          aws_region_name="us-east-1")

researcher = Agent(role="AI Industry Researcher",
                   goal="Find 3 crisp facts about a topic",
                   backstory="Senior analyst.", llm=llm, allow_delegation=False)
writer = Agent(role="Technical Writer",
               goal="Turn raw facts into a 3-bullet markdown summary (Chinese)",
               backstory="No fluff.", llm=llm, allow_delegation=False)

task1 = Task(description="Collect 3 factual bullet points about Model Context Protocol.",
             expected_output="3 bullets in English, each <=20 words.", agent=researcher)
task2 = Task(description="Turn researcher's bullets into '## MCP 三点速览'.",
             expected_output="3 Chinese bullets.", agent=writer, context=[task1])

crew = Crew(agents=[researcher, writer], tasks=[task1, task2], process=Process.sequential)
result = crew.kickoff()
print(result.raw)
print(result.token_usage)
```

实测输出：

```
## MCP 三点速览

• **MCP 是 Anthropic 推出的开放协议，使 AI 助手能够安全连接外部数据源和工具**
• **2024年11月发布，提供标准化的服务器-客户端架构，实现 LLM 与应用程序之间的上下文共享**
• **通过预构建的 MCP 服务器和 SDK,支持与 Google Drive、Slack、GitHub 等平台集成**

total_tokens=1288 prompt_tokens=748 completion_tokens=540 successful_requests=4
```

**1,288 tokens、4 次 LLM 调用**，researcher 和 writer 各跑一轮（每轮 agent loop 2 次调用）。

### Demo 2：自建 `@tool` 装工具

```python
from crewai.tools import tool

@tool("compound_interest")
def compound_interest(principal: float, rate_pct: float, years: int) -> str:
    """Compute compound interest."""
    rate = rate_pct / 100.0
    final = principal * (1 + rate) ** years
    return f"Principal ${principal} at {rate_pct}% for {years} years = ${final:.2f}"

analyst = Agent(role="Financial Analyst", goal="Answer finance questions.",
                backstory="Numbers-first.", llm=llm, tools=[compound_interest])

task = Task(description="If I invest $10,000 at 7% for 10 years, what is the final amount?",
            expected_output="One paragraph citing the tool output.", agent=analyst)

result = Crew(agents=[analyst], tasks=[task]).kickoff()
```

实测输出：

```
If you invest $10,000 at 7% annual interest for 10 years, the final amount will be
$19,671.51 according to the compound_interest tool calculation...

total_tokens=1843 prompt_tokens=1654 completion_tokens=189 successful_requests=2
```

Agent 正确识别需要调用 `compound_interest(10000, 7, 10)`，把工具输出织进最终回答。

### Demo 3：Flow API（@start / @router / @listen）

```python
from pydantic import BaseModel
from crewai.flow.flow import Flow, start, listen, router

class TopicState(BaseModel):
    topic: str = ""
    classification: str = ""
    summary: str = ""

class TopicFlow(Flow[TopicState]):
    @start()
    def pick_topic(self):
        self.state.topic = "Kubernetes Horizontal Pod Autoscaler"

    @router(pick_topic)
    def classify(self):
        reply = llm.call([{"role": "user",
                           "content": f"Classify '{self.state.topic}' as INFRA / ML / PRODUCT."}])
        label = reply.strip().upper().split()[0]
        self.state.classification = label
        return label   # 路由下游

    @listen("INFRA")
    def handle_infra(self):
        self.state.summary = llm.call([{"role": "user",
                                        "content": f"One Chinese sentence about {self.state.topic}."}])

    @listen("ML")
    def handle_ml(self): self.state.summary = "ML branch"
    @listen("PRODUCT")
    def handle_product(self): self.state.summary = "PRODUCT branch"

flow = TopicFlow()
flow.kickoff()
```

实测输出：

```
[start] topic = Kubernetes Horizontal Pod Autoscaler
[router] classification = INFRA
[infra branch] Kubernetes 的 HPA 就像根据 CPU 和内存使用率自动增减你的 Python 应用容器实例数量，
类似于自动调整 gunicorn 的 worker 进程数。

Flow Execution Completed ✅
```

Router 正确决策走 INFRA 分支，ML/PRODUCT 分支未被触发（`@listen` 只有匹配到 router 返回值才跑）。

### Demo 1b：Hierarchical 实测

同样的 "写 MCP 2 条中文摘要" 任务，把 `process=sequential` 改成 `process=hierarchical, manager_llm=llm` 后：

- **38,337 tokens / 15 次 LLM 调用**（vs sequential 的 1,288 tokens / 4 次）
- manager 先判断"这是写作任务，让 writer 做"，把 task 通过 delegate 工具下发
- writer 反馈结果，manager 包装后返回

结论：**hierarchical 开销是 sequential 的 ~30×，在任务明确时不要用**；hierarchical 的价值是"开放式任务 + manager 需要拆解"的场景。

---

## 四方对照：claude-agent-sdk vs Strands vs deepagents vs crewai

| 维度 | claude-agent-sdk-python | strands-agents/sdk-python | langchain-ai/deepagents | **crewAIInc/crewAI** |
|---|---|---|---|---|
| 出品方 | Anthropic 官方 | AWS 官方 | LangChain 官方 | CrewAI Inc（独立商业公司） |
| Stars / 版本 | 6.4K ⭐ / v0.1.63 | 5.67K ⭐ / v1.36.0 | 21.3K ⭐ / v0.5.3 | **49.3K ⭐ / v1.14.2** |
| 本质 | Claude Code CLI 的 Python 包装 | 自建 event loop + 多模型框架 | 基于 LangGraph 的 batteries-included | **role-based 多 agent 编排框架 + 事件驱动 Flow** |
| 核心抽象 | `query()` / AsyncClient | `Agent(model, tools)` | `create_deep_agent()` | **`Agent(role/goal/backstory)` + `Task` + `Crew`** |
| 多 agent | subagents（CLI 层） | graph / swarm / a2a / agent-as-tool | SubAgentMiddleware | **Crew（sequential/hierarchical）+ Flow 编排** |
| 流程编排 | 无（靠 prompt） | 无（靠代码） | 中间件栈（有序） | **Crew 声明式 + Flow @start/@listen/@router 事件驱动** |
| 模型支持 | 仅 Claude | 13 家 provider（Bedrock/Anthropic/OpenAI/Gemini/LiteLLM/Ollama/…） | 任意 tool-calling LLM（LangChain 供应商） | **6 家原生 provider（OpenAI/Anthropic/Azure/Bedrock/Gemini/OpenAI-compat），自建不依赖 LiteLLM** |
| 锁定程度 | 高（绑 Claude Code 生态） | 低（`model=` 切供应商） | 中（绑 LangGraph/LangChain 生态） | **低（原生 provider 抽象，零 LangChain 依赖）** |
| Sandbox / 文件 | 继承 Claude Code 工具 | 无抽象 | Backend 抽象（Filesystem/Modal/Daytona/…） | 无沙箱抽象（靠工具自行实现） |
| MCP | in-process MCP | 支持 | langchain-mcp-adapters | **原生 MCP（stdio/SSE/HTTP 三种 transport 自研）** |
| 可观测 | 依赖 CLI 输出 | OpenTelemetry | LangSmith | **OpenTelemetry + 自研事件总线 + AMP Control Plane（商业）** |
| 协议开放 | 私有 | A2A server | ACP server + JS 版本 | **A2A server + MCP client** |
| Memory | 无内置 | 无内置（靠工具） | 无内置（靠 middleware） | **内置 short-term / long-term / entity（ChromaDB）** |
| 知识库/RAG | 无 | 无 | 无 | **内置 Knowledge 模块 + RAG（ChromaDB）** |
| 商业化模式 | 纯开源 | 纯开源 | 纯开源 + LangSmith（付费可观测） | **开源 + AMP Suite（Control Plane/Observability/付费企业）** |
| 最小 hello world | `query("hi")` | `Agent(...).invoke("hi")` | `create_deep_agent().stream(...)` | `Crew(agents=[a],tasks=[t]).kickoff()` |

### 一段话说清四条路线的思路差异

- **claude-agent-sdk**：把 Claude Code 当"黑盒 agent runtime"卖给 Python 用户。嵌入式思路。
- **Strands**：不押注任何一家模型，自己实现 agent loop + 统一 Model 抽象，AWS 平台背书。
- **deepagents**：主张"通用 agent = 规划 + subagent + 文件系统 + 详细 prompt"，基于 LangGraph 封死这套。
- **crewAI**：**把 agent 类比成"剧组角色"，用 role/goal/backstory 建模 + task 建模流程**，再用 Flow 补一套事件驱动图。同时带 memory、RAG、knowledge 全套电池，也是四者里**唯一同时做开源和商业 SaaS（AMP Suite）的**。

### 一句话选型指引（更新为四家）

> **嵌入选 claude-agent-sdk，平台选 Strands，产品选 deepagents，团队/角色建模选 crewAI。**

展开：
- 只想把 Claude Code 能力嵌进自己产品 → claude-agent-sdk
- 要在多模型之间切换、要 AWS 背书、要 OTel 可观测 → Strands
- 要做类 Claude Code 的通用 coding/research agent → deepagents
- **要把"复杂业务流程"拆成多个角色/任务显式建模，或要一个"能直接上生产"的全家桶（memory + RAG + MCP + 企业 Control Plane）** → crewAI

### crewAI 什么时候 *不* 合适

- 单 agent 简单场景：role/goal/backstory + task 的声明成本偏高，直接用 Strands/Claude SDK 更快。
- 需要 LangChain 生态的大量现成 chain/retriever：crewAI 刻意不依赖 LangChain，复用有隔阂，deepagents 更顺。
- Coding agent / 文件系统深度交互：deepagents 的 Backend 抽象更专业。

---

## 踩坑记录

### 坑 1：crewai 1.14 不再默认装 litellm，Bedrock 用原生 provider
- **现象**：`pip install crewai` 后 `from litellm import ...` 报 ModuleNotFoundError
- **原因**：crewai 1.x 大幅重构，`llms/providers/{anthropic,bedrock,openai,...}/` 每家自实现，Bedrock 直接用 `boto3 Converse API`
- **解决**：`pip install boto3`（或装 `crewai[bedrock]` extras 更稳）。模型前缀 `bedrock/<model_id>` 就自动走 BedrockCompletion

### 坑 2：LLM(model=...) 的前缀决定 provider 路由
- **现象**：写成 `LLM(model="claude-sonnet-4-5")` 可能被识别错
- **正确**：带上 `bedrock/ / anthropic/ / openai/ / azure/ / gemini/` 前缀，源码 `llm.py:315` 明确按前缀路由
- Bedrock inference profile 要完整写：`bedrock/global.anthropic.claude-sonnet-4-5-20250929-v1:0`

### 坑 3：hierarchical process 贵 30×
- **现象**：把 `process=sequential` 改成 `hierarchical` 后 token 用量暴增
- **原因**：manager agent 要自己跑 ReAct loop 决定 delegate 给谁 → 额外 10+ 次 LLM 调用
- **建议**：任务路径清晰时永远用 sequential；只在"开放式任务 + 需要 LLM 自己分派"时才用 hierarchical

### 坑 4：tracing 面板首次运行会弹用户选择提示
- **现象**：第一次 `crew.kickoff()` 命令行弹出 "Tracing Preference" 面板问是否开启
- **解决**：非交互场景设 `os.environ["CREWAI_DISABLE_TELEMETRY"] = "true"` 或 `OTEL_SDK_DISABLED=true`

### 坑 5：@tool 装饰器 import 路径
- **现象**：`from crewai import tool` 会失败
- **正确**：`from crewai.tools import tool`

### 坑 6：Flow 的 @listen 标签 = router 返回值（字符串）
- **现象**：`@listen(some_method)` 和 `@listen("LABEL")` 语义完全不同
- **说明**：前者"监听方法跑完"，后者"监听 router 返回 'LABEL'"，两者都合法，但要想清楚走哪种

---

## 关键结论

### 1. Role-based 建模是 crewAI 的最大差异点

四个框架里只有 crewAI 把 `role / goal / backstory` 做成 Agent 的一等字段。这不是"多写几行 prompt"，而是一种产品哲学——假设你在建模真实业务团队。好处是人类看代码就能知道每个 agent 在干嘛；坏处是单 agent 场景"过度设计"。

### 2. Crew + Flow 两套 API 覆盖两种哲学

- **Crew**（声明式）= "告诉我你的团队和任务，我让 LLM 协作跑完"
- **Flow**（命令式）= "告诉我流程图，我让 LLM 只做你点明的那几步决策"

两者可以嵌套（Flow 节点里放 Crew），这是 crewAI 相对 LangGraph 的差异化：LangGraph 偏命令式，crewAI 补齐了"我不想画图，直接声明团队"的路径。

### 3. "电池全带" 的唯一选手

四家里只有 crewAI 内置了：memory（short/long/entity）+ knowledge + RAG + MCP 客户端 + A2A server + CLI scaffold + 商业 Control Plane。这让"从 0 到 demo"非常快，代价是包体积大、抽象层次多，学习曲线偏重。

### 4. 去 LangChain 化是战略选择

README 第一句就是 "completely independent of LangChain"。对比 deepagents 深度绑定 LangGraph，crewAI 的判断是"LangChain 的包袱 > 复用收益"。从 `llms/providers/` 目录看，crewAI 愿意为每家 provider 写一份原生实现来换独立性。

### 5. 同一份代码里能看出公司化痕迹

不同于 claude-agent-sdk（Anthropic 纯开源）、Strands（AWS 纯开源）、deepagents（LangChain 带 LangSmith 付费可观测），crewAI 的 `events/listeners/tracing/` 和 AMP Control Plane 之间有清晰的上云入口。OSS 版完全可用，但"你要企业级 observability → app.crewai.com"的信号很明确。

---

## 下次可以试的方向

- [ ] 用 `Crew` 的 `planning=True` + `planning_llm` 看 LLM 自动生成 task 计划
- [ ] 跑 `CrewAI Flow` + 内嵌 `Crew` 的混合编排（Flow 节点里 kickoff 一整个 Crew）
- [ ] 用 `MCPServerAdapter` 给 Agent 加载真实 MCP server 工具（如 github-mcp-server）
- [ ] 测试 `Crew(memory=True, long_term_memory=...)` 跨 session 记忆
- [ ] 用 crewai CLI（`crewai create crew my-project`）跑一遍 scaffold 的标准项目结构
- [ ] 跑 hierarchical + 自定义 manager_agent，看能否替换掉默认 manager 的 prompt

---

## 参考资源

- GitHub: https://github.com/crewAIInc/crewAI
- 官方文档: https://docs.crewai.com
- Forum: https://community.crewai.com
- PyPI: https://pypi.org/project/crewai/
- AMP / Cloud Trial: https://app.crewai.com
- 社区课程: https://learn.crewai.com

> Agent SDK 选型研究系列：
> - [1/N] [claude-agent-sdk-python](./claude-agent-sdk-python.md)
> - [2/N] [strands-agents-sdk-python](./strands-agents-sdk-python.md)
> - [3/N] [deepagents](./deepagents.md)
> - [4/N] **crewAI**（本篇）
