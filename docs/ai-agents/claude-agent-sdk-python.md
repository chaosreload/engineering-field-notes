# claude-agent-sdk-python Getting Started

> 整理日期：2026-04-20
> 仓库地址：<https://github.com/anthropics/claude-agent-sdk-python>
> 项目版本：v0.1.63（bundled Claude Code CLI 2.1.114）
> 数据：6.4K ⭐ / 907 forks / Python / MIT

## 项目简介

**Claude Agent SDK for Python** 是 Anthropic 官方为 Python 开发者提供的 Claude Code Agent 封装库。它本身**不实现 Agent 逻辑**，而是把 Claude Code CLI（Node.js 进程）封装成 Pythonic 的 `async` API，让开发者在 Python 里：

- 向 Claude Code 发一次性 prompt（`query()`）
- 维持多轮有状态对话（`ClaudeSDKClient`）
- 注入自定义工具（in-process MCP servers）
- 通过 **hooks** 拦截 / 修改 agent 行为
- 管理 sessions（fork、resume、rename、delete）
- 编程式生成 subagents

核心设计：**SDK 做 Pythonic 包装 + IPC 桥接，真正的 agent loop 跑在 Claude Code CLI 子进程里**。这让 SDK 只需要跟着 CLI 版本走，不用自己维护模型调用、工具执行、权限判定等重逻辑。

适合场景：

- 把 Claude Code 嵌入 Python 应用 / CI 流水线
- 给现有 Python 代码库加 AI 副驾
- 想在 Jupyter / FastAPI / MCP server 里用 Agent 能力
- 需要自定义工具 + hooks 做定制行为（评测、安全防护、日志审计）

## 项目结构

```
claude-agent-sdk-python/
├── src/claude_agent_sdk/
│   ├── __init__.py              # 公共 API 汇总导出（640 行）
│   ├── query.py                 # query() 顶层函数（126 行）
│   ├── client.py                # ClaudeSDKClient 类（625 行）
│   ├── types.py                 # 所有类型定义（1553 行）
│   ├── _errors.py               # 错误类
│   ├── _bundled/claude          # 打包进 wheel 的 Claude Code CLI
│   └── _internal/
│       ├── client.py            # InternalClient（真正驱动器）
│       ├── query.py             # Query 类 + 消息循环（825 行）
│       ├── message_parser.py    # CLI JSON 消息解析
│       ├── sessions.py          # session 读写助手（1798 行，最大）
│       ├── session_mutations.py # fork/delete/rename/tag（962 行）
│       ├── session_resume.py    # 断点续传
│       ├── session_store.py     # session 后端抽象
│       ├── transcript_mirror_batcher.py  # 转写镜像批处理
│       └── transport/
│           ├── __init__.py      # Transport 抽象基类
│           └── subprocess_cli.py # 唯一实现：subprocess + JSON lines（736 行）
├── examples/                    # 18 个示例（含 agents、hooks、MCP、plugin、session_stores）
├── tests/                       # 27 个测试文件（含 postgres/redis/s3 session store live test）
├── e2e-tests/                   # 端到端测试
├── scripts/                     # build_wheel.py 下载并打包 CLI
└── CHANGELOG.md                 # 每个小版本跟 CLI 对齐（当前 bundled 2.1.114）
```

## 核心架构

```
┌──────────────────────────────────────────────────┐
│  用户代码                                         │
│    async for msg in query(prompt="…"):           │
│    async with ClaudeSDKClient(options) as c:     │
└─────────────────┬────────────────────────────────┘
                  │
┌─────────────────▼────────────────────────────────┐
│  公共 API 层（src/claude_agent_sdk/）             │
│    query() · ClaudeSDKClient · @tool ·           │
│    create_sdk_mcp_server · ClaudeAgentOptions    │
└─────────────────┬────────────────────────────────┘
                  │
┌─────────────────▼────────────────────────────────┐
│  内部层（_internal/）                             │
│    InternalClient → Query（消息循环 / 控制信道）   │
│    sessions / session_mutations / session_resume │
│    message_parser（解析 CLI JSON）                │
└─────────────────┬────────────────────────────────┘
                  │
┌─────────────────▼────────────────────────────────┐
│  Transport 层（唯一实现：SubprocessCLITransport） │
│    - 启动 claude 子进程（bundled 或系统）         │
│    - stdin/stdout 用 JSON lines 流式 IPC         │
│    - 控制信道走 control_request / control_response│
└─────────────────┬────────────────────────────────┘
                  │ subprocess（anyio）
┌─────────────────▼────────────────────────────────┐
│  Claude Code CLI（Node.js, bundled/system）      │
│    真正跑 agent loop、调模型、执行工具、管权限     │
└──────────────────────────────────────────────────┘
```

**关键设计：**

1. **单一 Transport**：目前只有 `SubprocessCLITransport`，抽象基类留了口子未来可加 HTTP / WebSocket。
2. **始终用 streaming mode**：即使是一次性 `query()`，内部也走 streaming，方便把大型 agent / MCP config 通过 `initialize` 请求发过去。
3. **控制信道复用 stdout**：除了 assistant/user/tool_use 业务消息，还在同一条 JSON 流里走 `control_request` / `control_response`（interrupt、set_permission_mode、toggle_mcp_server 等）。
4. **SDK MCP Server 是 in-process**：`@tool` 装饰的函数通过 `create_sdk_mcp_server()` 注册后，Claude 的工具调用会反向通过控制信道打回 Python 进程，直接在同进程执行，不需要起独立 MCP server 进程。
5. **CLI 被 wheel 打包**：`scripts/build_wheel.py` 在构建时下载对应平台的 `claude` 二进制塞进 `_bundled/`，所以 `pip install claude-agent-sdk` 不需要单独装 Claude Code。

## 核心工作流程

### 场景 A：一次性查询 `query()`

```
用户 await query(prompt="Hello")
  ↓
InternalClient.process_query(...)
  ↓
SubprocessCLITransport.connect()
  ├─ _find_cli()           查 bundled → PATH → 常见路径
  └─ anyio.open_process()  启动 claude --output-format=stream-json ...
  ↓
transport.write() 发 streaming user message
  ↓
Query._read_messages()   循环读 stdout JSON line
  ↓
message_parser.parse()   → AssistantMessage / ToolUseBlock / ResultMessage
  ↓
yield 回用户 async for 迭代器
```

### 场景 B：双向会话 `ClaudeSDKClient`

```
async with ClaudeSDKClient(options) as client:
    await client.query("问题 1")        ← stdin 写入
    async for msg in client.receive_response():
        ...                              ← 流式读取直到 ResultMessage
    await client.query("跟进问题 2")    ← 复用同一 claude 子进程
```

`Query` 类维护一个 asyncio 任务组，同时跑：

- 读 stdout 循环
- 读 stderr 循环（错误诊断）
- 控制请求 handler（处理来自 CLI 的 `can_use_tool` / `hook_callback` 回调）
- 用户 stream_input 任务

### 场景 C：自定义工具（SDK MCP Server）

```python
@tool("weather", "查天气", {"city": str})
async def get_weather(args): ...

server = create_sdk_mcp_server(name="weather", tools=[get_weather])
options = ClaudeAgentOptions(
    mcp_servers={"weather": server},
    allowed_tools=["mcp__weather__weather"],  # 注意命名格式
)
```

CLI 端 Claude 决定要用工具 → 通过控制信道发 `sdk_mcp_request` → Python 端 `_handle_sdk_mcp_request` 路由到 `get_weather()` → 结果打回 → Claude 继续。

### 场景 D：Hooks（行为拦截）

```python
async def check_bash_command(input_data, tool_use_id, context):
    if "foo.sh" in input_data["tool_input"].get("command", ""):
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": "blocked",
            }
        }
    return {}

options = ClaudeAgentOptions(
    hooks={"PreToolUse": [HookMatcher(matcher="Bash", hooks=[check_bash_command])]},
)
```

支持的 hook 点（见 `types.py`）：`PreToolUse`、`PostToolUseHookInput`、`PostToolUseFailure`、`PreCompact`、`Notification`、`PermissionRequest` 等。

## 部署步骤

### 前置

- Python 3.10+
- （推荐）dev-server 或本地有 Claude Code 凭证（`~/.claude/.credentials.json`）；或者设置 `ANTHROPIC_API_KEY`；或配置 Bedrock / Vertex

### 安装

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install claude-agent-sdk
python -c "import claude_agent_sdk; print(claude_agent_sdk.__version__)"
# 0.1.63
```

bundled CLI 位置：`<venv>/lib/pythonX.Y/site-packages/claude_agent_sdk/_bundled/claude`

### 踩坑提示

1. **MCP 工具命名**：`@tool("weather", ...)` 定义后，在 `allowed_tools` 里要写成 `mcp__<server_name>__<tool_name>`，例如 `mcp__weather__weather`。少写一层或名字不一致，Claude 调不到工具又不报错。
2. **始终用 streaming**：即使 `query()` 只跑一次，内部也是 streaming mode。调试时看 stderr 可以 set `options.stderr_callback=print`。
3. **`allowed_tools` ≠ 工具白名单**：它只是「免权限弹窗的自动授权列表」；要真正屏蔽工具用 `disallowed_tools`。
4. **认证顺序**：SDK 把认证/模型选择全甩给底层 CLI，所以出问题先 `claude auth status` 或检查 `~/.claude/.credentials.json`。

## Demo 示例

本次学习写了一个覆盖三种核心用法的 demo（`demo.py`，位于 `/data/projects/chaosreload/study/demo/claude-agent-sdk-python/`）：

```python
import anyio
from claude_agent_sdk import (
    AssistantMessage, ClaudeAgentOptions, ClaudeSDKClient,
    ResultMessage, TextBlock, ToolUseBlock,
    create_sdk_mcp_server, query, tool,
)

# Demo 1: 一次性查询
async def demo_query():
    async for msg in query(
        prompt="用一句话说明 Python 协程和线程的区别。",
        options=ClaudeAgentOptions(max_turns=1),
    ):
        if isinstance(msg, AssistantMessage):
            for b in msg.content:
                if isinstance(b, TextBlock): print(f"Claude: {b.text}")

# Demo 2: 多轮对话
async def demo_client_interactive():
    options = ClaudeAgentOptions(
        system_prompt="你是简洁的技术助手，每次回答不超过 50 字。",
        max_turns=4,
    )
    async with ClaudeSDKClient(options=options) as client:
        await client.query("什么是 AsyncIterator？")
        async for msg in client.receive_response(): ...
        await client.query("给我一个简单的 Python 例子。")
        async for msg in client.receive_response(): ...

# Demo 3: 自定义工具
@tool("weather", "查询城市天气", {"city": str})
async def get_weather(args):
    data = {"广州": "25°C, 多云", "北京": "12°C, 晴"}
    return {"content": [{"type": "text", "text": data.get(args["city"], "无数据")}]}

async def demo_custom_tool():
    server = create_sdk_mcp_server(name="weather-demo", tools=[get_weather])
    options = ClaudeAgentOptions(
        mcp_servers={"weather": server},
        allowed_tools=["mcp__weather__weather"],
    )
    async with ClaudeSDKClient(options=options) as client:
        await client.query("查一下广州和北京的天气。")
        async for msg in client.receive_response(): ...
```

### 实际运行输出

```
=== Demo 1: query() 一次性查询 ===
Claude: 协程是在单线程内由程序自身通过事件循环协作式调度的轻量级并发单元，
        而线程是由操作系统抢占式调度的、可利用多核的系统级并发单元。
[Cost: $0.098157, Turns: 1]

=== Demo 2: ClaudeSDKClient 多轮对话 ===
Round 1 | Claude: AsyncIterator 是一种支持异步逐项遍历的协议...
Round 2 | Claude: 用 async def + yield 创建异步生成器，async for 消费。

=== Demo 3: 自定义工具 ===
[工具调用 mcp__weather__weather: {'city': '广州'}]
[工具调用 mcp__weather__weather: {'city': '北京'}]
Claude: | 城市 | 温度 | 天气 |
        |------|------|------|
        | 广州 | 25°C | 多云 |
        | 北京 | 12°C | 晴  |
        广州比北京暖和不少，温差有 13°C。
[Cost: $0.073674]

✅ 所有 demo 完成
```

三个 demo 全部通过，总成本 ≈ $0.17。

## 关键发现 / 学习心得

### 1. SDK 是薄壳，CLI 才是本体

Python SDK 总代码 ~8800 行，但把 session 管理、message parser、transport 拆开看，**真正新写的业务代码不到 2000 行**，其他都是类型定义、session store 抽象、控制信道协议、测试。所有 agent loop / 权限判定 / 工具调度都在 Claude Code CLI 里。

这个设计的**成本**：Python 开发者没法只用 SDK 来「纯 Python 跑 agent」——必须有 Node.js 版 CLI 二进制。**收益**：SDK 团队不用跟两份 agent loop 实现，CLI 一升级 SDK 跟着 bundle。CHANGELOG 里大半版本都是 "Updated bundled Claude CLI to version X"。

### 2. SDK MCP Server 是这次最漂亮的设计

传统 MCP 需要起独立进程走 stdio；SDK MCP Server 是 **in-process 反向 RPC**：

- CLI 子进程要调 MCP 工具 → 通过 stdout 控制信道发 `sdk_mcp_request`
- Python 端 `Query._handle_sdk_mcp_request` 收到 → 找到本地函数 → 执行
- 结果从 stdin 打回 CLI

省掉 subprocess / IPC，避免了 MCP 生态里很常见的「10 个工具 10 个 Node.js 进程」资源浪费。

### 3. 控制信道复用业务流，协议设计很紧凑

同一条 JSON line 流承载：
- 业务消息（assistant / user / tool_use / tool_result / result）
- 控制请求（interrupt / set_permission_mode / toggle_mcp_server / set_model / rewind_files）
- SDK callback 请求（can_use_tool / hook_callback / sdk_mcp_request）

读代码体感：`_internal/query.py` 825 行里一半是这个协议的收发路由。

### 4. Session 管理已经足够成熟

`sessions.py`（1798 行）+ `session_mutations.py`（962 行）里实现了：

- **fork**：基于某个父 session 分叉出新 session（实验多分支）
- **rewind**：把 session 倒回某条用户消息之前（常用于撤销）
- **resume**：断电重连
- **subagent transcripts**：读 subagent 的消息链
- **external store**：支持 Postgres / Redis / S3 作为 session 后端（examples/session_stores/）

加上 0.1.60 加的 W3C trace context（`TRACEPARENT`）传递，可以把 SDK 和 CLI 的 OTel span 串起来。对于要把 Claude Code 放进生产 / 多用户 SaaS 的团队来说，这些是关键。

### 5. 跟 Claude Code 自己是什么关系？

- **Claude Code** = CLI/TUI 产品（一个命令行 agent 应用）
- **Claude Agent SDK (Python/TS)** = 把 Claude Code 当 backend 用的 SDK
- **Agent Skills、Subagents、Hooks、Plugins** 是 Claude Code 内部的扩展机制，SDK 全都暴露了 Pythonic 的绑定

所以如果你要写**自己的 Claude Code 替代品**，这个 SDK 不合适（因为你绕不开 CLI 依赖）。如果你要**让 Python 代码驱动 Claude Code 做事**，SDK 是官方最快的路径。

### 6. 对比 OpenAI Agents SDK / LangChain / AutoGen

这个 SDK **不是** "通用 agent 框架"：

- ❌ 不绑定一个 LLM provider —— 由 Claude Code CLI 决定用 Anthropic API / Bedrock / Vertex
- ❌ 没自己的 agent loop、工具调度、planning —— 全在 CLI
- ✅ 只提供**编程入口 + 自定义扩展点**（工具、hooks、session）

它更像 **「Python 版 Claude Code remote control」**，而不是一个 "写自己 agent" 的框架。weichao 关注 AI Agent 基础设施方向的话，这是对比「agent 产品 + SDK 套装」这条路线（Cursor + MCP / Cline / Claude Code 都是类似思路）的好样本。

## 参考资源

- [官方文档](https://platform.claude.com/docs/en/agent-sdk/python)
- [TypeScript 版 SDK](https://github.com/anthropics/claude-agent-sdk-typescript)（API 设计保持同步）
- [MCP Calculator 示例](https://github.com/anthropics/claude-agent-sdk-python/blob/main/examples/mcp_calculator.py)
- [Hooks 文档](https://platform.claude.com/docs/en/agent-sdk/hooks)
- [Permissions 文档](https://platform.claude.com/docs/en/agent-sdk/permissions)
- CHANGELOG：每个小版本跟 bundled CLI 版本号强绑定
