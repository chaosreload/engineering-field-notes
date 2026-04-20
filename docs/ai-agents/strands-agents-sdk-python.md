# strands-agents/sdk-python Getting Started

> 整理日期：2026-04-20
> 仓库地址：<https://github.com/strands-agents/sdk-python>
> 项目版本：v1.36.0
> 数据：5.67K ⭐ / 791 forks / Python / Apache-2.0 / 创建于 2025-05-14（AWS 官方开源）

## 项目简介

**Strands Agents SDK** 是 AWS 官方开源的 Python agent 框架，主打 **"model-driven，几行代码写 agent"**。和 Claude Agent SDK 只能跑 Claude 不同，Strands 是个**真正的多模型 agent 框架**——它自己实现了 agent loop、工具执行、流式处理、多 agent 编排，通过 `Model` 抽象把 Bedrock / Anthropic / OpenAI / Gemini / LiteLLM / Llama / Ollama / Mistral / SageMaker / Writer 全都接了进来。

核心设计：**model-driven loop**。不靠 orchestrator 节点做"先思考再行动"这种硬编码流程，而是把模型的原生 tool use 能力当作驱动力——模型说要调工具就调，说要结束就结束，SDK 只做"编排 + 工具执行 + 历史管理"这层胶水。

适合场景：

- 在 AWS 上用 Bedrock 搭生产 agent，想要官方支持
- 需要跨多家模型供应商、切换灵活（一个 agent 换个 `model=` 参数就能从 Bedrock 切到 OpenAI）
- 要多 agent 协作（graph、swarm、A2A server）
- 要 MCP 生态的几千个现成工具
- 想要 OpenTelemetry 原生可观测（traces/metrics）而不是自己贴一层

## 项目数据

- **规模**：164 个 Python 文件、~35.9K LoC、`src/strands/` 21 个子模块
- **gitnexus 索引**：6,732 nodes / 20,527 edges / 552 clusters / 300 flows
- **发布节奏**：v1.0 发在 2025-05-14（第一次开源），v1.36.0 在 2026-04-20，12 个月 36 个 minor 版本，周更节奏
- **周边仓库**：`strands-agents/tools`（60+ 预制工具）、`samples`、`mcp-server`、`agent-builder`、`docs`

## 项目结构

```
strands-agents-sdk-python/
├── src/strands/
│   ├── __init__.py              # 公共 API 导出：Agent, tool, Plugin, ...
│   ├── agent/
│   │   ├── agent.py             # Agent 主类（1210 行，公共 API 的头牌）
│   │   ├── agent_result.py      # AgentResult（stop_reason + metrics + messages）
│   │   ├── base.py              # AgentBase（抽象基类）
│   │   ├── a2a_agent.py         # A2A 协议 agent（懒加载）
│   │   ├── _agent_as_tool.py    # "把另一个 agent 当工具" 适配器
│   │   ├── conversation_manager/ # 历史裁剪策略：SlidingWindow / Summarizing / Null
│   │   └── state.py             # AgentState（持久化状态）
│   ├── event_loop/
│   │   ├── event_loop.py        # 核心 agent loop（597 行）
│   │   ├── streaming.py         # 模型流式处理（507 行）
│   │   └── _retry.py            # ModelRetryStrategy（指数退避，throttling/5xx）
│   ├── models/                  # 统一 Model 抽象 + 13 家实现
│   │   ├── model.py             # 抽象基类（162 行）
│   │   ├── bedrock.py           # AWS Bedrock（1126 行，默认 provider）
│   │   ├── anthropic.py / openai.py / gemini.py / litellm.py / ollama.py
│   │   ├── llamaapi.py / llamacpp.py / mistral.py / sagemaker.py / writer.py
│   │   └── openai_responses.py  # OpenAI 新版 Responses API
│   ├── tools/
│   │   ├── decorator.py         # @tool 装饰器（833 行，核心魔法）
│   │   ├── registry.py          # ToolRegistry（731 行）
│   │   ├── mcp/mcp_client.py    # MCPClient（1212 行，后台线程管生命周期）
│   │   ├── executors/           # ConcurrentToolExecutor / SequentialToolExecutor
│   │   ├── watcher.py           # 热加载 ./tools/ 目录
│   │   ├── structured_output/   # Pydantic → tool spec
│   │   └── loader.py / tool_provider.py
│   ├── hooks/
│   │   ├── events.py            # 9 种 HookEvent：BeforeModelCall / AfterToolCall / ...
│   │   ├── registry.py          # HookRegistry + 类型推断
│   │   └── _type_inference.py
│   ├── multiagent/              # 多 agent 编排
│   │   ├── graph.py             # 有向图（DAG）
│   │   ├── swarm.py             # swarm 模式
│   │   └── a2a/                 # A2A（agent-to-agent）server
│   ├── session/                 # 持久化：File / Repository / S3 SessionManager
│   ├── telemetry/               # OpenTelemetry 接入（traces + metrics）
│   ├── experimental/            # 实验特性：bidi（双向流式）/ steering / hooks
│   ├── plugins/                 # Plugin 机制：一次挂多个 hook + 配置
│   ├── vended_plugins/          # 内置 plugin：AgentSkills / steering
│   ├── interrupt.py             # 中断控制（_InterruptState + Interrupt 异常）
│   └── types/                   # TypedDict / Pydantic 类型定义
├── tests/                       # 单元测试
├── tests_integ/                 # 集成测试（按模块组织：mcp/hooks/bidi/a2a/...）
└── docs/                        # sphinx
```

## 核心架构

```
┌─────────────────────────────────────────────────────┐
│ 用户代码                                              │
│   agent = Agent(model=..., tools=[...], hooks=[...]) │
│   result = agent("do something")                     │
│   async for ev in agent.stream_async(...): ...       │
└───────────────────────────┬─────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────┐
│ Agent 类（agent/agent.py）                           │
│   __init__：注册 tools + hooks + plugins + session   │
│   __call__ / invoke_async / stream_async             │
│   agent.tool.<name>(...)（直接工具调用）              │
│   structured_output(...)（Pydantic 化输出）           │
└───────────────────────────┬─────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────┐
│ event_loop_cycle（event_loop/event_loop.py）         │
│   1. fire BeforeModelCallEvent                       │
│   2. stream_messages(model, ...)  ← 流式拉模型       │
│   3. fire AfterModelCallEvent / ModelMessageEvent    │
│   4. if stop_reason == "tool_use":                   │
│        _handle_tool_execution(...)                   │
│        → 递归 event_loop_cycle                       │
│   5. 处理 ContextWindowOverflow / MaxTokens          │
└────────────┬─────────────────────────┬──────────────┘
             │                         │
┌────────────▼────────────┐  ┌─────────▼─────────────┐
│ Model（models/*.py）    │  │ ToolExecutor           │
│ 抽象 .stream()          │  │ Concurrent / Sequential│
│ Bedrock / Anthropic /   │  │ 调 @tool / MCPAgentTool│
│ OpenAI / Gemini / ...   │  │ / @agent as tool       │
└─────────────────────────┘  └────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────┐
│ Hook / Plugin / SessionManager                       │
│ 全局事件总线：9 种事件 × N 个 listener               │
│ 驱动 session 持久化（S3 / 文件 / 自定义）             │
└──────────────────────────────────────────────────────┘
```

## 关键设计选择

### 1. 真正的"model-driven loop"：只有一个循环，没有 planner 节点

看 `event_loop_cycle` 的核心逻辑（`src/strands/event_loop/event_loop.py:80+`），它本质只做三件事：
1. 拉模型流式输出（`stream_messages`）
2. 如果 `stop_reason == "tool_use"` → 执行工具 → 递归进入下一轮
3. 否则返回

**没有 planner/executor/critic 这种节点拆分**——整个 agent 的"思考方式"完全由模型自己的 tool use 行为决定。这种设计的代价是：模型不行的时候整个 agent 就废了；好处是代码极简、对新模型零适配成本。和 LangGraph 那种"node + edge" 显式图完全相反。

### 2. Model 抽象统一 13 家 provider，Bedrock 是头等公民

`models/model.py` 只定义了一个精简的抽象（162 行），核心就是一个 async `stream()` 方法。`bedrock.py` 1126 行是老大，也是默认 provider——`Agent()` 不传 model 就走 `BedrockModel("us.anthropic.claude-sonnet-4-20250514-v1:0")` in `us-west-2`。**切 provider 只需改一个参数**：`Agent(model=AnthropicModel(api_key=...))` 或 `Agent(model=OpenAIModel(...))`，event loop 代码完全不用动。这是 Strands 和 Claude Agent SDK 最大的差别。

### 3. @tool 装饰器 + 类型化 Hook 系统：两条解耦干净的扩展路径

- `@tool` 通过 `docstring_parser` + Pydantic 自动把函数签名 → ToolSpec JSON schema，还支持 context 参数注入（`ToolContext`）。写工具最少 3 行。
- `hooks/registry.py` 的 `HookRegistry` 用 **Python 类型标注做事件路由**——你写 `def on_event(self, event: BeforeToolCallEvent): ...`，registry 靠 `_type_inference.py` 反射出来自动绑定。9 种事件覆盖 agent lifecycle（init/invocation/message/model call/tool call）+ multi-agent（node/invocation）。SessionManager 就是一个预设的 HookProvider，把持久化逻辑挂到 `MessageAddedEvent` / `AfterInvocationEvent` 上。**所有扩展点都是 hook**——重试、session、telemetry、甚至 steering 全都同构。

## 3 种用法 Demo

### Demo 1：hello-world（默认 Bedrock Claude Sonnet 4）

```python
# demo1_hello.py
from strands import Agent

agent = Agent()  # 默认 model = Bedrock Claude Sonnet 4, region = us-west-2
result = agent("用一句话介绍 AWS Bedrock，不超过 20 字。")
print(result.metrics.get_summary()["accumulated_usage"])
```

运行：

```
$ python3 demo1_hello.py
AWS Bedrock是亚马逊云提供的托管式生成式AI服务平台。
stop_reason=end_turn
usage: inputTokens=29, outputTokens=29, totalTokens=58, latencyMs=2368
```

**观察**：默认 `callback_handler=PrintingCallbackHandler()` 会把文本流式打到 stdout，`AgentResult` 里包含完整 metrics（token 用量 + trace 层级 + 每个 cycle 的耗时）。

### Demo 2：@tool + 多轮对话

```python
# demo2_tools.py
from strands import Agent, tool

@tool
def word_count(text: str) -> int:
    """统计文本中的单词数量。

    Args:
        text: 要统计的文本。
    """
    return len(text.split())

@tool
def reverse_string(text: str) -> str:
    """反转一段字符串。"""
    return text[::-1]

agent = Agent(
    system_prompt="优先调用可用工具而不是自己估算。",
    tools=[word_count, reverse_string],
)

agent("下面这句话有多少个单词？'The quick brown fox jumps over the lazy dog'")
agent("把刚才那句话反过来。")  # 同一个 agent 实例，历史自动保留
```

运行输出：

```
=== 第 1 轮 ===
我来帮你统计这句话中的单词数量。
Tool #1: word_count
这句话 ... 总共有 **9个单词**。

=== 第 2 轮 ===
我来帮你把刚才那句话反转过来。
Tool #2: reverse_string
反转后的句子是：**god yzal eht revo spmuj xof nworb kciuq ehT**

messages 累计 = 8 条
```

**观察**：同一个 `agent` 实例自动维护历史（`agent.messages` 是一个 `Messages` list），不需要显式传 history。默认用 `SlidingWindowConversationManager` 做上下文窗口管理，超长自动裁剪。

### Demo 3：MCP 集成

```python
# demo3_mcp.py
from mcp import StdioServerParameters, stdio_client
from strands import Agent
from strands.tools.mcp import MCPClient

mcp_client = MCPClient(lambda: stdio_client(
    StdioServerParameters(command="python3", args=["./mcp_server.py"])
))

with mcp_client:
    tools = mcp_client.list_tools_sync()
    print(f"MCP tools: {[t.tool_name for t in tools]}")
    agent = Agent(tools=tools)
    agent("请用 square 工具算 13 的平方，再用 greet 工具跟 'weichao' 打个招呼。")
```

对应 `mcp_server.py`（用官方 `mcp.server.fastmcp.FastMCP`）：

```python
from mcp.server.fastmcp import FastMCP
mcp = FastMCP("strands-demo-server")

@mcp.tool()
def greet(name: str) -> str:
    """Say hello to someone by name."""
    return f"Hello {name}, 从 MCP server 问好！"

@mcp.tool()
def square(x: int) -> int:
    """Return the square of an integer."""
    return x * x

if __name__ == "__main__":
    mcp.run()
```

运行输出：

```
MCP server 暴露的工具: ['greet', 'square']
Tool #1: square
Tool #2: greet
- 13 的平方是 **169**
- 向 weichao 的问候：**Hello weichao, 从 MCP server 问好！**
```

**观察**：`MCPClient` 用 **`with` context manager** 管 MCP server 子进程的生命周期——内部其实是起了一个后台线程跑 `asyncio.new_event_loop()`，让 sync 代码能"看起来同步"地调异步的 MCP 协议（`mcp_client.py` 1212 行里大段代码在处理这个 thread + asyncio 桥接）。一次性把所有 MCP tools 注入到 Agent，模型自动决定调哪个。

### 成本

本次 3 个 demo 总共约 **2K input + 300 output tokens**，Claude Sonnet 4 定价 $3/M in + $15/M out，总成本 **< $0.01**（一分钱以内）。

## 对照 claude-agent-sdk-python 的设计差异

| 维度 | claude-agent-sdk-python | strands-agents/sdk-python |
|------|-------------------------|---------------------------|
| **agent loop 在哪** | 跑在 Claude Code CLI 子进程里，SDK 只做 IPC | SDK 本身就是 agent loop（`event_loop_cycle`） |
| **模型支持** | 只有 Claude（Anthropic API / Bedrock / Vertex） | 13 家 provider 统一抽象，Bedrock 头等 |
| **扩展机制** | hooks + in-process MCP server（`@tool` → MCP） | hooks + plugins + `@tool` 装饰器 + MCPClient + agent-as-tool |
| **多 agent** | 编程式生成 subagents（写 `.claude/agents/*.md`） | 一等公民：graph / swarm / A2A server |
| **Session** | 文件 + 可插拔 store（postgres/redis/s3） | 文件 / Repository / S3 SessionManager（hook-driven） |
| **依赖体积** | 下载打包完整 Claude Code CLI（wheel 几十 MB） | 纯 Python 库 + boto3 + mcp，轻量 |
| **可观测** | 自己的 transcript/session 文件 | OpenTelemetry 原生接入（traces + metrics） |

**一句话总结**：Claude Agent SDK 是 **"把 Claude Code 装进 Python"**——你拿到的是 Claude Code 这个黑盒 agent 的 Python 壳。Strands 是 **"在 Python 里从零搭 agent"**——你拿到的是 agent 框架本身，什么模型、什么工具、什么流程全自己配。

**适用场景分化**：
- 想把 Claude Code 的本地文件编辑 + Bash + Web 搜索这套能力嵌进 Python 服务 → 用 Claude Agent SDK
- 想在 AWS Bedrock 上做生产 agent、需要多模型切换、需要多 agent 协作、需要 OTel 可观测 → 用 Strands

## 核心发现 Top 3

1. **"model-driven" 其实是对 orchestrator 设计的反叛**。LangGraph/LangChain 那套"planner→executor→critic"显式节点图的范式，Strands 用一个 `event_loop_cycle` 的 while 循环 + 模型原生 tool use 就替代了。代码量少一个数量级，但代价是所有"智能"全押在模型本身——小模型跑不起来。这种设计只有在 Claude 3.5+/GPT-4o+ 这档模型上才 make sense，是**纯粹为前沿模型写的框架**。

2. **Hook-based 架构把"跨 cutting concern"全同构化了**。Session 持久化、重试、telemetry、steering（引导生成）、甚至 session 恢复，全是 `HookProvider` 挂事件——`SessionManager` 继承 `HookProvider` 的写法太干净了。读 `session_manager.py:register_hooks` 那十几行就能看懂整个持久化机制，`MessageAddedEvent → append_message` 这种绑定一眼通透。**对比 LangChain 的 callbacks + 各种 `on_*` 回调散布在几十个类里，Strands 的 9 个事件 + 类型推断绑定是"正确的抽象"**。

3. **MCPClient 的 1212 行代码主要在做 sync/async 桥接**。MCP 本身是 asyncio 协议（anyio streams），但 `Agent.__call__` 是同步的，所以 `MCPClient` 内部起一个后台线程跑独立的 `asyncio` event loop，用 `concurrent.futures` 做跨线程调用，context manager 管子进程生命周期。**这块代码是整个 SDK 最难写的部分**（和 asyncio/contextvars/线程安全缠斗），也是工程价值最高的部分——MCP 标准化的"几千个工具"直接能用。

## 踩坑记录

- **Strands 默认 provider 是 Bedrock + us-west-2 + Claude Sonnet 4**。本地没 AWS creds、没开通这个模型的人，`Agent()` 直接报错；最快的 onboarding 路径是开通 `us.anthropic.claude-sonnet-4-*` 的 us-west-2 model access，或显式换 provider。
- **`Agent("prompt")` 和 `agent.tool.xxx(...)` 两种调用路径是共存的**。后者是直接调某个工具（绕过 LLM），适合做"LLM 决定要调的工具"在 Python 里自己直接调的场景。
- **多轮对话用同一个 `agent` 实例就行**，不要手动传 `messages`——`agent.messages` 会自动累积，`SlidingWindowConversationManager` 默认帮你管 context 窗口。
- **MCPClient 必须用 `with` 包起来**，否则子进程/后台线程不会清理。里面的 `list_tools_sync()` 是 sync API（内部走桥接），在 `with` 块外调直接报错。

## 参考资源

- 官方文档：<https://strandsagents.com/>
- 周边工具包：<https://github.com/strands-agents/tools>（60+ 预制工具，`strands-agents-tools` PyPI）
- MCP server 适配：<https://github.com/strands-agents/mcp-server>
- Samples：<https://github.com/strands-agents/samples>
- AgentCore 部署指南（AWS 生产环境）：<https://docs.aws.amazon.com/bedrock-agentcore/>（Strands 是 AgentCore 推荐的 agent 框架）
- 本篇姊妹文：[claude-agent-sdk-python Getting Started](./claude-agent-sdk-python.md)
