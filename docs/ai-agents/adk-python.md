# google/adk-python Getting Started

> 整理日期：2026-04-20
> 仓库地址：https://github.com/google/adk-python

## 项目简介

**Agent Development Kit (ADK)** 是 Google 官方出品的开源 Python agent 框架，2025 年 4 月 Google Cloud Next '25 首发，之后 ~1 年做到 **19.1K stars**、`v1.31.0`、bi-weekly 发版，同时配套 Java ADK、Go ADK、ADK Web（可视化调试 UI）。

**一句话定位：**

> "A flexible and modular framework that applies software development principles to AI agent creation. **Optimized for Gemini**, but model-agnostic and deployment-agnostic."

换成人话：**Google 把"构建 agent"当成工程问题来做**——Agent 是 pydantic `BaseModel`，orchestration 是显式的类（`Sequential/Parallel/Loop`），flow 是一条显式的 processor pipeline，runner 是 FastAPI server 级别的生产件。跟 crewAI 的"Crew + 角色建模"、deepagents 的"middleware 栈"完全不同路子——**ADK 更像 Django 之于 web：有 opinion 但抽象层次拉满，能从 hello world 直接一路铺到 Vertex AI Agent Engine 生产部署**。

**和 Google 生态的三层绑定：**
1. **模型层**：虽然"model-agnostic"，但默认路径是 Gemini（`google-genai` 硬依赖）。
2. **协议层**：原生支持 [A2A (Agent2Agent) Protocol](https://github.com/google-a2a/A2A/)，`RemoteA2aAgent` 直接把远端 agent 当 sub_agent 调。
3. **部署层**：Cloud Run / Vertex AI Agent Engine / Agentspace 四处配套，和单纯"SDK 框架"差了一个量级。

---

## 核心数据

| 项 | 值 |
|---|---|
| GitHub stars | **19,133** ⭐（2026-04-20） |
| Forks | 3,260 |
| Open issues | 787 |
| PyPI 版本 | `google-adk 1.31.0` |
| Python 支持 | 3.10 – 3.13 |
| License | Apache 2.0 |
| 首发 | 2025 年 4 月（Google Cloud Next '25） |
| 发版节奏 | bi-weekly |
| gitnexus 规模 | **14,145 nodes / 42,989 edges / 883 clusters / 300 flows** |
| 依赖 | 40+ 运行时依赖（google-cloud-* 全家桶 + google-genai + FastAPI + MCP SDK + OTel + pydantic） |
| 原生 LLM | Gemini（google_llm） / Anthropic Claude（anthropic_llm，支持 direct + Vertex） / Gemma（gemma_llm） / Apigee / **LiteLlm（100+ providers 包括 Bedrock/OpenAI/Ollama）** |
| 多语言版本 | Java (`adk-java`) + Go (`adk-go`) + Web UI (`adk-web`) |

---

## 项目结构

```
adk-python/
├── src/google/adk/
│   ├── agents/                        # agent 类型层
│   │   ├── base_agent.py              # BaseAgent (pydantic BaseModel 基类)
│   │   ├── llm_agent.py               # LlmAgent — 带 LLM + tools 的 agent
│   │   ├── sequential_agent.py        # 串行 orchestration shell
│   │   ├── parallel_agent.py          # 真并行 (asyncio.TaskGroup) orchestration shell
│   │   ├── loop_agent.py              # 循环 orchestration shell
│   │   ├── remote_a2a_agent.py        # 把远端 A2A agent 当 sub_agent
│   │   ├── langgraph_agent.py         # 把 LangGraph 封装成 agent
│   │   ├── invocation_context.py      # 运行态上下文（state / branch / events）
│   │   ├── run_config.py              # 运行配置（streaming/live/debug）
│   │   └── agent_config.py            # Agent Config（YAML 无代码定义 agent）
│   ├── flows/llm_flows/               # LLM agent 的执行 pipeline
│   │   ├── base_llm_flow.py           # 抽象执行 loop（model call → tool call → loop）
│   │   ├── single_flow.py             # 单 agent flow（无 transfer）
│   │   ├── auto_flow.py               # 多 agent flow（带 agent_transfer processor）
│   │   ├── basic.py / instructions.py / contents.py   # 基础 processors
│   │   ├── functions.py               # function-calling 处理（含线程池并发）
│   │   ├── agent_transfer.py          # 多 agent delegation (transfer_to_agent)
│   │   ├── _code_execution.py         # 代码执行 processor
│   │   ├── _nl_planning.py            # 自然语言规划 processor
│   │   ├── _output_schema_processor.py
│   │   ├── context_cache_processor.py # Gemini context cache 支持
│   │   ├── compaction.py              # 长对话压缩
│   │   ├── request_confirmation.py    # Tool Confirmation (HITL)
│   │   └── audio_cache_manager.py / transcription_manager.py  # Live mode
│   ├── models/                        # LLM provider 抽象
│   │   ├── base_llm.py / registry.py  # BaseLlm + LLMRegistry（按 regex 路由）
│   │   ├── google_llm.py              # Gemini 原生
│   │   ├── anthropic_llm.py           # Claude 原生（direct + AnthropicVertex）
│   │   ├── gemma_llm.py / apigee_llm.py
│   │   ├── lite_llm.py                # LiteLLM 适配器 → 100+ providers
│   │   └── gemini_llm_connection.py   # Live mode 双向流
│   ├── tools/                         # 工具生态
│   │   ├── base_tool.py / base_toolset.py
│   │   ├── function_tool.py           # Python 函数自动变工具
│   │   ├── mcp_tool/                  # MCP toolset（stdio + SSE）
│   │   ├── openapi_tool/              # OpenAPI spec → 工具集
│   │   ├── retrieval/                 # Vertex AI RAG / GCS / in-memory
│   │   ├── bigquery/ spanner/ bigtable/   # 数据库工具集（Google Cloud）
│   │   ├── vertex_ai_search_tool.py / google_search_tool.py
│   │   ├── agent_tool.py              # 把 agent 当工具用（agent-as-tool）
│   │   ├── tool_context.py            # 工具访问 session state 的上下文
│   │   └── confirmation/              # Tool Confirmation (HITL)
│   ├── runners.py                     # Runner + InMemoryRunner（agent 入口）
│   ├── sessions/                      # 会话存储
│   │   ├── in_memory_session_service.py
│   │   ├── database_session_service.py (SQLAlchemy)
│   │   ├── spanner_session_service.py
│   │   └── vertex_ai_session_service.py
│   ├── memory/                        # 跨会话记忆（in-memory / vertex_ai_memory_bank）
│   ├── artifacts/                     # 附件存储（local / GCS）
│   ├── events/event.py                # 统一 Event 协议（Runner yield 的东西）
│   ├── a2a/                           # Agent2Agent 协议客户端 + server
│   ├── evaluation/                    # 内置评估框架（trajectory + metric）
│   ├── cli/                           # `adk` CLI（run / web / api_server / deploy）
│   ├── code_executors/                # sandbox（BuiltInCode / VertexAi / Container / Unsafe）
│   ├── planners/                      # plan-and-execute 规划器
│   ├── plugins/                       # 插件系统（callback hooks）
│   ├── auth/                          # OAuth / API-key 认证
│   ├── integrations/                  # LangGraph / A2A 桥接
│   └── telemetry.py                   # OpenTelemetry tracing
├── contributing/samples/              # 大量官方 sample
└── tests/                             # 完整单元测试
```

---

## 核心架构

```
┌──────────────────────────────────────────────────────────────────────┐
│  用户代码层                                                           │
│                                                                      │
│  LlmAgent(model=, instruction=, tools=, sub_agents=, output_key=)    │
│    │                                                                 │
│  SequentialAgent / ParallelAgent / LoopAgent  ← orchestration shell  │
│    │   (纯编排 agent，不带 LLM，只组合 sub_agents)                    │
│  RemoteA2aAgent / LangGraphAgent              ← 桥接型 agent          │
└────┼────────────────────────────────────────────────────────────────┘
     │
     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Runner 层（runners.py）                                              │
│                                                                      │
│  Runner / InMemoryRunner                                             │
│    .run_async(user_id, session_id, new_message)  → AsyncGenerator[Event]│
│     │                                                                │
│     ├─ SessionService      （存 state / 历史 events）                 │
│     ├─ MemoryService       （跨 session 长期记忆）                    │
│     ├─ ArtifactService     （二进制附件）                             │
│     └─ InvocationContext   （每次调用的运行态）                       │
└──────┼───────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Agent 执行层                                                         │
│                                                                      │
│  LlmAgent._run_async_impl(ctx)                                       │
│    └─ self._llm_flow.run_async(ctx)                                  │
│         │                                                            │
│         ▼                                                            │
│  BaseLlmFlow = SingleFlow / AutoFlow                                 │
│  ┌────────────────────────────────────────────────────────────┐      │
│  │  request_processors (顺序跑):                              │      │
│  │    basic → auth → instructions → identity → contents       │      │
│  │    → _nl_planning → _code_execution → agent_transfer*      │      │
│  │  model.generate_content_async(request)    ← Gemini/Claude/... │    │
│  │  response_processors:                                      │      │
│  │    _nl_planning → _code_execution → functions(tool call)   │      │
│  │  if has tool calls: execute → feed back → loop             │      │
│  │  if transfer_to_agent: hand off to sub_agent               │      │
│  └────────────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  模型适配层 (models/)                                                 │
│                                                                      │
│  LLMRegistry.resolve(name)  ← 按 regex 路由                           │
│    ├─ "gemini-*"            → Gemini (google_llm.py)                 │
│    ├─ "claude-*"            → Claude (anthropic_llm.py, direct 或    │
│    │                             AnthropicVertex)                    │
│    ├─ "gemma-*"             → Gemma                                  │
│    └─ LiteLlm(model=...)    → LiteLLM → 100+ providers               │
│                                (bedrock/..., ollama/..., openai/...) │
└──────────────────────────────────────────────────────────────────────┘
```

### 三个关键层的设计取舍

1. **Agent 层 = pydantic `BaseModel`**
   所有 agent（`BaseAgent`/`LlmAgent`/`SequentialAgent`/…）都是 pydantic model，字段即配置。好处：**可以直接用 YAML 反序列化**（`Agent Config` 特性），连代码都不用写就能声明 agent。坏处：hot-patch 行为偏麻烦（字段都是 frozen-ish）。

2. **Orchestration 层 = 纯 shell**
   `SequentialAgent`/`ParallelAgent`/`LoopAgent` 不含 LLM、不含 tool，只是 `sub_agents: list[BaseAgent]` 的壳。`ParallelAgent._run_async_impl` 直接 `asyncio.TaskGroup` 并发跑 sub_agents 的 `run_async`，通过 queue 合并 event 流 — 是**真并行**，不是 LangGraph 那种 "declare parallel 但底层同步跑"。

3. **Flow 层 = 有序 processor pipeline**
   `LlmAgent` 不自己写 loop，委托给 `_llm_flow: BaseLlmFlow`。flow 是一串 request/response processor 的 pipeline（instructions, contents, code_execution, agent_transfer, functions…），每个 processor 是 `async def run_async(ctx, request/response)`。要加功能（比如 HITL confirmation、context cache）就加 processor，**不改 agent 代码**。这是 ADK 和 Strands 最大的架构分歧——Strands 的 event loop 是 hand-written 循环，ADK 是 declarative pipeline。

---

## 关键设计

### 1. 五种原生 agent 类型

| 类型 | 带 LLM | 用途 |
|---|---|---|
| `LlmAgent` | ✅ | 基础 agent，持有 model / tools / instruction / sub_agents |
| `SequentialAgent` | ❌ | sub_agents 串行跑，event 流透传 |
| `ParallelAgent` | ❌ | sub_agents 真并行（TaskGroup + queue merge） |
| `LoopAgent` | ❌ | sub_agents 循环跑到条件满足（显式 max_iterations + escalate 机制） |
| `RemoteA2aAgent` | ❌ | 远端 agent 通过 A2A 协议接入，本地当 sub_agent 用 |
| `LangGraphAgent` | （桥接） | 把一个 LangGraph compiled graph 包装成 ADK agent |

这 5 类 agent **正交可组合** — `SequentialAgent([ParallelAgent([LlmAgent, LlmAgent]), LlmAgent])` 是合法写法，Demo 2 就是这个结构。

### 2. Session / State / Memory 三层存储

ADK **唯一把"会话存储"当一等公民设计的框架**（对比 crewAI 把 memory 塞进 Crew、deepagents 完全没有）：

| 层 | 粒度 | 抽象 | 实现 |
|---|---|---|---|
| **Session** | 一次对话（含多轮） | `SessionService` + `session.state: dict` | InMemory / Database (SQLAlchemy) / Spanner / Vertex AI |
| **Memory** | 跨会话长期记忆 | `MemoryService` | InMemory / Vertex AI Memory Bank |
| **Artifact** | 附件（PDF/图片） | `ArtifactService` | Local / GCS |

`session.state` 是 `dict`，agent 通过 `output_key="xxx"` 把 LLM 最终输出直接写进 `state["xxx"]`；工具通过 `ToolContext.state` 读写；下一个 agent 的 instruction 里可以用 `{xxx}` 模板插值 — **state 是 agent 之间传数据的主通道**，不是靠对话历史。Demo 2/3 都演示了这点。

### 3. Tool 四种定义方式

```python
# (1) 纯函数 — docstring 变描述，type hints 变 schema
def add_todo(item: str, tool_context: ToolContext) -> dict: ...

# (2) BaseTool 子类 — 需要自定义 schema 或状态
class MyTool(BaseTool): ...

# (3) MCP toolset — 一行接入外部 MCP server
from google.adk.tools.mcp_tool import MCPToolset
tools = [MCPToolset(connection_params=StdioServerParameters(command="uvx", args=["mcp-server-git"]))]

# (4) OpenAPI spec — 整个 REST API 变一组工具
from google.adk.tools.openapi_tool import OpenAPIToolset
tools = [OpenAPIToolset(spec_str=open("api.yaml").read())]
```

额外有一组 Google Cloud 专用工具集：`BigQueryToolset` / `SpannerToolset` / `BigtableToolset` / `VertexAiSearchTool` / `GoogleSearchTool` — 这是 ADK 和 Google 生态的明显耦合。

### 4. Agent Config — **无代码定义 agent (YAML)**

ADK 独有特性：agent 可以写 YAML：

```yaml
name: my_agent
model: gemini-2.0-flash
instruction: "Help the user..."
tools:
  - type: google_search
sub_agents:
  - $ref: ./sub_agent.yaml
```

然后 `adk run my_agent.yaml` 就能跑。用 `config_agent_utils.py` 解析，底层还是 pydantic 反序列化。**定位是给非工程人员用**（product manager 调 prompt），其他框架都没做这层。

### 5. `adk` CLI = 完整生产工具链

```bash
adk create <app>       # scaffold 项目
adk run <agent>        # 本地跑 agent
adk web                # 启动 ADK Web UI（可视化 debug / trace / replay）
adk api_server         # 启动 FastAPI server（对外暴露 agent）
adk deploy cloud_run   # 部署到 Cloud Run
adk deploy agent_engine # 部署到 Vertex AI Agent Engine
adk eval               # 跑评估集
```

对比 crewAI 的 CLI（只做 scaffold），ADK CLI **是完整的 dev → debug → deploy 工具链**，这也是"应用软件工程原则"的体现。

### 6. A2A 协议 — 原生双向

- **作为 server**：ADK agent 直接 `adk api_server` 对外暴露 A2A 接口
- **作为 client**：`RemoteA2aAgent(agent_card="http://...")` 把别家（包括 crewAI、LangGraph 的 A2A）agent 当本地 sub_agent

这让 **ADK 和 crewAI 是 A2A 世界里两个最完整的 endpoint**（deepagents 只有 ACP，Strands 有 A2A server 但没 client）。

### 7. Live Mode — 双向音频/视频流

ADK 有一整套 `_run_live_impl`（每个 agent 都实现了）+ `GeminiLlmConnection` 双向流，主打 **Gemini Live API**（声音进、声音出、中间可插入文本和工具调用）。这是当前所有 agent 框架里**唯一把 live / streaming / 音频当一等公民实现**的 — crewAI / deepagents / Strands 都没这层。代价：基本锁定在 Gemini（其他模型没有双向流协议）。

### 8. Tool Confirmation (HITL)

`request_confirmation.py` processor：tool 调用前可强制要求人类显式确认，每个 tool 可配置确认规则 + 自定义输入 — 金融 / 医疗等高风险场景专用设计，其他框架要自己写。

### 9. 三层模型抽象 + Registry 路由

```python
# 层 1：LlmAgent(model="gemini-2.0-flash") — 直接传 regex 能匹配的名字
# 层 2：LlmAgent(model=Claude(model="claude-sonnet-4-5")) — 传 BaseLlm 实例
# 层 3：LlmAgent(model=LiteLlm(model="bedrock/...")) — 走 LiteLLM 适配器
```

`LLMRegistry` 按 regex 路由，默认注册：`gemini-.*` → Gemini，`claude-.*` → Claude，`gemma-.*` → Gemma。**Bedrock/OpenAI/Ollama 必须用 `LiteLlm(model="...")` 显式包裹**（Demo 1 用的就是 `LiteLlm(model="bedrock/global.anthropic.claude-sonnet-4-5-...")`）。

---

## 部署步骤

Python 3.10 venv 一把梭：

```bash
cd /data/projects/chaosreload/study/demo/adk
python3 -m venv venv
source venv/bin/activate
pip install google-adk        # 安装核心（1.31.0）
pip install litellm boto3     # Bedrock 路线需要
```

**坑 1：用 Bedrock 必须单独装 `boto3`**。`google-adk` 和 `litellm` 都不默认依赖 boto3（litellm 用懒加载），第一次调用 `LiteLlm(model="bedrock/...")` 会在 runtime 爆 `ModuleNotFoundError: No module named 'boto3'`。

---

## Demo 示例（Bedrock Claude Sonnet 4.5）

> AWS profile: `weichaol-testenv2-awswhatsnewtest`，region: `us-east-1`，模型:`bedrock/global.anthropic.claude-sonnet-4-5-20250929-v1:0`

### Demo 1：最基础 LlmAgent

```python
import asyncio, os
from google.adk.agents import LlmAgent
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import InMemoryRunner
from google.genai import types

agent = LlmAgent(
    name="concise_writer",
    model=LiteLlm(model="bedrock/global.anthropic.claude-sonnet-4-5-20250929-v1:0"),
    description="Writes crisp 3-bullet Chinese summaries.",
    instruction="You are a concise technical writer. Answer in Chinese markdown, exactly 3 bullets, each <= 25 chars.",
)

async def main():
    runner = InMemoryRunner(agent=agent, app_name="adk-demo1")
    session = await runner.session_service.create_session(app_name="adk-demo1", user_id="weichao")
    msg = types.Content(role="user", parts=[types.Part(text="用 3 个 bullet 总结 MCP.")])
    async for event in runner.run_async(user_id="weichao", session_id=session.id, new_message=msg):
        if event.content and event.content.parts:
            for p in event.content.parts:
                if p.text: print(p.text, end="")

asyncio.run(main())
```

**实际输出：**

```
- **统一 AI 上下文接口标准**
- **连接 LLM 与数据源工具**
- **简化应用集成开发**
```

核心语法：

- `LlmAgent(...)` 是 pydantic `BaseModel`，字段即配置，**没有 `.run()` 方法**（agent 本身是声明，不是入口）。
- `InMemoryRunner` 才是入口，`run_async` 返回 `AsyncGenerator[Event]` — 每个模型 chunk / tool call / tool result 都是一个 event。
- Session 必须先 `create_session` 再用，不能直接传 "hello" 字符串（对比 crewAI/Strands 的 `.kickoff()` / `.invoke()`）。

### Demo 2：ParallelAgent + SequentialAgent 组合

3 个 researcher 真并行 → summarizer 汇总：

```python
MODEL = LiteLlm(model="bedrock/global.anthropic.claude-sonnet-4-5-20250929-v1:0")

def researcher(name, topic):
    return LlmAgent(
        name=name, model=MODEL,
        instruction=f"You research {topic}. Produce exactly ONE English bullet (<=25 words)...",
        output_key=f"{name}_output",   # 把输出写进 session.state
    )

summarizer = LlmAgent(
    name="summarizer", model=MODEL,
    instruction=(
        "Combine the three research bullets from session state:\n"
        "Bullet 1: {mcp_researcher_output}\n"       # 模板插值读 state
        "Bullet 2: {multiagent_researcher_output}\n"
        "Bullet 3: {eval_researcher_output}\n"
    ),
)

pipeline = SequentialAgent(
    name="pipeline",
    sub_agents=[
        ParallelAgent(name="parallel_research", sub_agents=[
            researcher("mcp_researcher", "Model Context Protocol"),
            researcher("multiagent_researcher", "multi-agent orchestration"),
            researcher("eval_researcher", "agent evaluation frameworks"),
        ]),
        summarizer,
    ],
)
```

**实际输出：**

```
[author=multiagent_researcher]  Multi-agent orchestration in 2025 leverages LLM-based coordinators...
[author=mcp_researcher]         MCP enables standardized communication between AI assistants...
[author=eval_researcher]        Most 2025 agent evaluation frameworks focus on multi-step task...
[author=summarizer]
## 2025 Agent 生态三大趋势
• **MCP 协议标准化**：统一 AI 与数据源通信
• **多智能体编排升级**：动态任务分解与层级规划
• **评估框架演进**：从基准测试转向实际可靠性

=== session.state keys ===
  multiagent_researcher_output: ...
  mcp_researcher_output: ...
  eval_researcher_output: ...
[done] total time: 9.6s
```

**关键验证**：3 个 researcher 并发事件流交织出现（`multiagent_researcher` 先完成，`mcp_researcher` 第二），**总时间 9.6s** 对比纯串行需要 ~25s+，说明 `ParallelAgent` **是真并行**，不是声明语法糖。`output_key` + `{xxx}` 模板插值是 agent 间传数据的标准姿势。

### Demo 3：FunctionTool + Session State（跨轮次持久化）

```python
def add_todo(item: str, tool_context: ToolContext) -> dict:
    """Add a TODO item to the user's list and persist it in session state."""
    todos = list(tool_context.state.get("todos", []))
    todos.append(item)
    tool_context.state["todos"] = todos
    return {"status": "ok", "count": len(todos), "todos": todos}

def list_todos(tool_context: ToolContext) -> dict:
    """List all TODO items."""
    return {"count": len(...), "todos": list(...)}

agent = LlmAgent(
    name="todo_agent", model=MODEL,
    instruction="You are a TODO-list assistant...",
    tools=[add_todo, list_todos, clear_todos],  # 普通函数直接传
)
```

3 轮对话共享同一个 `session_id`，tool 往 state 里写，最后：

```
>>> USER: 加两个待办: 1) 写 ADK 文档 2) 跑 demo3
  [tool_call] add_todo({'item': '写 ADK 文档'})
  [tool_call] add_todo({'item': '跑 demo3'})   ← 同一轮 LLM 输出里并发发两个 tool call
  AGENT: 已添加两个待办事项！

>>> USER: 再加一个: 推 PR
  [tool_call] add_todo({'item': '推 PR'})
  AGENT: 已添加待办事项！

>>> USER: 现在我列表上都有啥?
  [tool_call] list_todos({})
  [tool_result] list_todos -> {'count': 3, 'todos': ['写 ADK 文档', '跑 demo3', '推 PR']}
  AGENT: 您的待办列表有3项：写 ADK 文档、跑 demo3、推 PR。

=== final session.state ===
  todos: ['写 ADK 文档', '跑 demo3', '推 PR']
```

两个关键点：
1. **ToolContext.state 直接当 dict 用**，不需要显式 save / commit（runner 会在 event 写入时自动持久化）。
2. **同一轮 LLM 输出可以发多个 tool call**（"加两个待办" 触发两个 `add_todo`），ADK 的 `functions.py` processor 自动并发执行（有线程池）。

### 三个 demo token 成本粗估

全跑一遍共发了约 **12-15 次 Bedrock converse 调用**，Sonnet 4.5 token 按 ~2k input / ~200 output / 次，成本 < **$0.08**。gitnexus 索引 + demo 编写 + 调试约 25 分钟。

---

## 五方对照：claude-agent-sdk / Strands / deepagents / crewAI / **ADK**

| 维度 | claude-agent-sdk | Strands | deepagents | crewAI | **ADK** |
|---|---|---|---|---|---|
| 出品方 | Anthropic 官方 | AWS 官方 | LangChain 官方 | CrewAI Inc | **Google 官方** |
| Stars / 版本 | 6.4K / v0.1.63 | 5.67K / v1.36.0 | 21.3K / v0.5.3 | 49.3K / v1.14.2 | **19.1K / v1.31.0** |
| 本质 | Claude Code CLI 包装 | 自建 event loop + 多模型 | LangGraph + middleware | role-based 多 agent + Flow | **pydantic agent + declarative flow pipeline + 完整生产工具链** |
| 核心抽象 | `query()` | `Agent(model, tools)` | `create_deep_agent()` | `Agent/Task/Crew` | **`LlmAgent` / `Seq/Par/LoopAgent` / `Runner`** |
| 多 agent | subagents (CLI) | graph/swarm/a2a/tool | SubAgentMiddleware | Crew + Flow | **5 种原生 agent 类型正交可组合 + A2A** |
| 流程编排 | prompt 决定 | 代码决定 | 中间件栈 | Crew 声明 + Flow 事件 | **声明式 Seq/Par/Loop shell + Flow pipeline** |
| Session/State | 无内置 | 无 | conversation state | 内置 memory | **一等公民：Session/Memory/Artifact 三层 + 多种后端** |
| 模型支持 | Claude | 13 providers | 任意 tool-calling LLM | 6 原生 + LiteLLM 兜底 | **Gemini/Claude/Gemma/Apigee 原生 + LiteLLM (100+)** |
| 锁定程度 | 高（Claude Code） | 低 | 中（LangGraph） | 低 | **中（Gemini 体验最佳，其他 via LiteLlm）** |
| MCP | in-process MCP | ✅ | langchain-mcp-adapters | 原生 MCP（三种 transport） | **原生 MCPToolset（stdio+SSE）** |
| A2A | ❌ | server 侧 | ACP | server + MCP client | **✅ 双向（RemoteA2aAgent 当 sub_agent）** |
| 可观测 | CLI 输出 | OpenTelemetry | LangSmith | OTel + 自研事件总线 | **OpenTelemetry + GCP 原生 exporter + ADK Web UI** |
| 无代码定义 | ❌ | ❌ | ❌ | ❌ | **✅ Agent Config (YAML)** |
| Live/音频 | ❌ | ❌ | ❌ | ❌ | **✅ Gemini Live 双向流** |
| HITL | ❌ | ❌ | human-in-loop middleware | ask_human tool | **✅ Tool Confirmation processor** |
| 评估框架 | ❌ | ❌ | ❌ | 有 | **✅ 内置 trajectory + metric** |
| 部署工具链 | ❌ | ❌ | ❌ | AMP Control Plane | **`adk deploy cloud_run / agent_engine` + Web UI** |
| 商业化 | 纯开源 | 纯开源 | 纯开源（LangSmith 付费） | 开源 + AMP 企业版 | **开源 + Vertex AI Agent Engine（按量）** |
| 多语言版本 | ❌（Python/TS 两家各一） | ❌（Python） | ❌（Python + JS） | ❌（Python） | **✅ Python + Java + Go + Web UI** |
| 最小 hello world | `query("hi")` | `Agent(...).invoke("hi")` | `create_deep_agent().stream()` | `Crew(...).kickoff()` | `Runner(agent).run_async(session_id, msg)` |

### 一段话说清五条路线

- **claude-agent-sdk**：把 Claude Code 当 agent runtime 嵌进 Python。
- **Strands**：AWS 站台的 hand-written event loop + 多模型框架，纯代码。
- **deepagents**：LangGraph 之上封"规划 + subagent + 文件系统"通用 agent 模板。
- **crewAI**：把 agent 类比成剧组角色，声明式 Crew + 事件式 Flow 两套 API。
- **ADK**：**把 agent 当 pydantic model，把编排当显式 class（Seq/Par/Loop），把执行当 processor pipeline，把整个 dev lifecycle（config→run→debug→eval→deploy）当一套工具链做** — 五家里**工程抽象层次最高、生产工具链最完整的一家**。

### 一句话选型指引（五家版）

> **嵌入选 claude-agent-sdk，多模型平台选 Strands，通用 coding/research 选 deepagents，角色团队建模选 crewAI，工程化/多语言/Google 生态选 ADK。**

展开：
- 只想把 Claude Code 嵌产品 → **claude-agent-sdk**
- 在多模型之间切换 + AWS 背书 + OTel → **Strands**
- 想复用类 Claude Code 的 planning + subagent + FS → **deepagents**
- 把复杂业务流程拆成角色和任务 + 全家桶 → **crewAI**
- 要把 agent **当正经软件工程项目做**（多语言版本、config 驱动、内置 eval、Web UI debug、一键 deploy Cloud Run/Agent Engine），或已经在 Google Cloud 生态 → **ADK**

### ADK 什么时候 *不* 合适

- **仅在 AWS 生态，严格避免 Google 依赖**：`google-cloud-*`、`google-genai`、`google-auth` 是硬依赖（哪怕你只用 Bedrock），虚拟环境会装 200MB+ Google 包，让人抓狂 → 上 Strands。
- **要最小抽象、手撸 agent loop**：ADK 的 Runner + Flow + processor pipeline 层次很深，想 hack 某个行为需要懂整套架构 → Strands / claude-agent-sdk 更直接。
- **简单单 agent + 对话**：`LlmAgent + Runner + Session` 的启动成本高于 `query("hi")` 或 `Agent(...).invoke("hi")` → claude-agent-sdk / Strands。
- **重度 LangChain 生态（Retriever / Chain / VectorStore 复用）**：ADK 不在 LangChain 体系里 → deepagents。

---

## 踩坑记录

### 坑 1：Bedrock 路线必须手动装 `boto3`

`google-adk` 依赖 `litellm`，但 **litellm 不把 boto3 当默认依赖**（懒加载）。所以：

```bash
pip install google-adk        # ✅ 装好 ADK
# 然后第一次调 LiteLlm(model="bedrock/...") 会 runtime 爆：
# litellm.APIConnectionError: No module named 'boto3'
pip install boto3             # ← 补这步
```

### 坑 2：最小 hello world 语法比其他框架重

crewAI: `Crew(agents=[a], tasks=[t]).kickoff()` 一行拿结果。
ADK: 必须先 `InMemoryRunner(agent=...)` → `await runner.session_service.create_session(...)` → `runner.run_async(user_id, session_id, types.Content(...))`，遍历 `AsyncGenerator[Event]`。

**session 概念强制前置**。好处：API 一致（单轮 / 多轮 / 生产 FastAPI server 都用同一套），坏处：看起来有 10 行 boilerplate 才能 hello world。

### 坑 3：`LiteLlm(model="...")` 必须显式包裹

不能直接写 `LlmAgent(model="bedrock/...")` — `LLMRegistry` 按 regex 路由，`bedrock/...` 没对应的 native LLM 注册，会报找不到。**标准姿势：`LlmAgent(model=LiteLlm(model="bedrock/..."))`**。

### 坑 4：`output_key` 的模板插值是花括号字符串

`LlmAgent(instruction="{some_key}")` 里的 `{some_key}` 会被 ADK **在 prompt 渲染时**从 `session.state` 里读并替换。如果 state 里没这个 key，**不会报错，会留下字面量 `{some_key}`** — 我第一版 demo2 的模板 key 和 output_key 对不上时就出现过 — 调 state 相关功能先打印 `session.state` 确认 key 名。

### 坑 5：asyncio cleanup 噪音

每个 demo 跑完都会在 stderr 输出一堆 `Event loop is closed` / `Fatal write error on socket transport` — 是 LiteLLM/anthropic SDK 在 atexit 时尝试 close HTTP connection pool 但 asyncio loop 已经关了。**不影响功能**，但日志输出丑，生产建议用 `asyncio.Runner(...)` 显式管理生命周期或 `contextlib.suppress`。

### 坑 6：依赖"肥"

`pip install google-adk` 会带入 200MB+ 的 `google-cloud-*` 家族包（bigquery-storage / spanner / pubsub / dataplex / discoveryengine / secret-manager / aiplatform[agent_engines] ...），就算你一行 Google Cloud 都不用。是 ADK 的"全家桶"设计代价。

---

## 关键结论

### 1. ADK 是**工程抽象最彻底**的那一家

其他四家要么是 hand-written loop（Strands、claude-agent-sdk），要么是 graph/middleware 复用（deepagents、crewAI Flow），**只有 ADK 把 agent 当 pydantic model + 把执行当 processor pipeline + 把部署当 CLI 子命令** — 整套下来更像 Django 之于 Web 框架：有很强 opinion 但抽象层次拉满。

### 2. Session/State 是 ADK 的独有一等公民

其他家 session 都要自己拼（crewAI 把 memory 塞进 Crew、Strands 靠用户手动管理历史、deepagents 把 state 挂在 graph 里）。ADK 的 `SessionService + session.state + MemoryService + ArtifactService` 四层存储是**所有框架里唯一做到这个粒度的**，而且直接内置 Spanner / Vertex AI 后端 — 说明 Google 对 "agent 要上生产" 的想定非常具体。

### 3. `adk` CLI + ADK Web UI 改变了 agent dev/debug 的 UX

Web UI 是一个 React 应用（`adk-web` repo），**本地 trace 每一步 event、可视化 session state、replay 过去的调用、直接在浏览器编辑 agent 配置**。对比其他四家只能看日志或接 LangSmith 付费服务，ADK Web 是**目前开源 agent 框架里最完整的本地 debug 工具**。配合 `adk deploy cloud_run` / `agent_engine`，dev → deploy 的链路是闭环的。

### 4. "Gemini-first 但 model-agnostic" 的实际含义

- **一等支持**：Gemini（native google_llm，带 Live 双向流、context cache、thinking mode）
- **二等支持**：Anthropic Claude（native anthropic_llm，走 Anthropic API 或 AnthropicVertex，**不支持 Live 流**）、Gemma
- **三等支持**：其他所有（Bedrock/OpenAI/Ollama/…）走 `LiteLlm(...)` 适配器

如果你没在用 Gemini，ADK 相对 Strands 的优势主要在"工程化 + Session + CLI + Web UI + 多语言版本 + A2A 双向"，而不是模型层。

### 5. 多语言版本 + A2A 双向是 ADK 独有的生态位

**`adk-java` + `adk-go` + `adk-python` 三个语言版本共享同一个 concepts 和 A2A 协议**，意味着 Java 后端团队、Go 基础设施团队、Python 数据团队可以用**同一套模型**写 agent，然后通过 A2A 互相调用。这是其他所有框架都没有的能力，也是 Google "要做 agent 基础设施" 这个战略意图的最明确体现（对标 "protocol buffers 之于 RPC"）。

### 6. 依赖重 + session boilerplate 多 = 不适合原型

缺点也明显：`pip install` 拉 200MB google-cloud 包、hello world 10 行 boilerplate、processor pipeline 深到需要啃源码才能 debug。**做快速原型选 claude-agent-sdk 或 Strands；做 production multi-agent system 且打算跑 ≥ 3 个月的项目选 ADK** — 前期投入 1 周学曲线，换后面工程化的红利。

---

## 下次可以试的方向

- `adk web` 本地启动 ADK Web UI，用 demo2 跑一把 — 验证"可视化 debug"到底多好用
- `adk deploy cloud_run` 实测把 demo 部署到 Google Cloud Run
- `RemoteA2aAgent` 对接 crewAI 的 A2A server，验证双向跨框架互调
- `AgentConfig`（YAML）把 demo3 改写成无代码版本
- `LoopAgent` + `max_iterations` + `escalate` 做一个 planning-and-execute 循环
- `Tool Confirmation` processor 做一个带人工确认的金融场景

---

## 参考资源

- 官方文档：<https://google.github.io/adk-docs/>
- PyPI：<https://pypi.org/project/google-adk/>
- Samples 仓库：<https://github.com/google/adk-samples>
- Java ADK：<https://github.com/google/adk-java>
- Go ADK：<https://github.com/google/adk-go>
- ADK Web UI：<https://github.com/google/adk-web>
- A2A 协议：<https://github.com/google-a2a/A2A>
- Reddit 社区：<https://www.reddit.com/r/agentdevelopmentkit/>
