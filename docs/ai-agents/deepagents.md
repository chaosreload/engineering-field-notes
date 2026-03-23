# deepagents Getting Started

> 整理日期：2026-03-23
> 仓库地址：https://github.com/langchain-ai/deepagents

## 项目简介

deepagents 是 LangChain 官方出品的**"batteries-included" Agent 框架**——开箱即用的生产级 AI Agent。

**定位：** 直接对标 Claude Code，README 明确声明"primarily inspired by Claude Code"，目标是做出同类通用性更强的开源版本。本质是基于 LangGraph 构建的、带完整工具链的代码助手/任务 Agent 框架。

**三大产品形态：**
1. **Python SDK** (`deepagents`) — `create_deep_agent()` 一行代码创建 Agent
2. **CLI** (`deepagents-cli`) — 终端交互式 coding agent，类 Claude Code
3. **ACP Server** (`deepagents-acp`) — 通过 Agent Client Protocol 接入各种 AI IDE（如 Claude Code 客户端）

---

## 项目结构

```
deepagents/
├── libs/
│   ├── deepagents/              # 核心 SDK
│   │   └── deepagents/
│   │       ├── graph.py         # create_deep_agent() 主入口
│   │       ├── _models.py       # 模型解析工具
│   │       ├── backends/        # 文件/执行后端（Filesystem/State/LocalShell/Sandbox）
│   │       └── middleware/      # 中间件层（功能扩展点）
│   │           ├── filesystem.py       # 文件工具（read/write/edit/ls/glob/grep）
│   │           ├── subagents.py        # 同步 subagent（task 工具）
│   │           ├── async_subagents.py  # 异步 subagent（后台任务）
│   │           ├── summarization.py    # 上下文自动摘要
│   │           ├── memory.py           # 持久化 memory（AGENTS.md）
│   │           ├── skills.py           # 技能/工具加载
│   │           └── patch_tool_calls.py # Tool Call 修正中间件
│   │
│   ├── cli/                     # CLI 命令行工具
│   │   └── deepagents_cli/
│   │       ├── main.py          # CLI 入口点
│   │       ├── app.py           # Textual TUI App
│   │       ├── agent.py         # CLI Agent 创建（create_cli_agent）
│   │       ├── tools.py         # CLI 特有工具（web_search/fetch_url）
│   │       ├── server.py        # 本地 LangGraph 服务器
│   │       ├── mcp_tools.py     # MCP 协议集成
│   │       ├── ask_user.py      # Human-in-the-Loop 工具
│   │       └── subagents.py     # subagents.yaml 解析
│   │
│   ├── acp/                     # ACP 协议服务器
│   │   └── deepagents_acp/
│   │       └── server.py        # AgentServerACP（桥接 ACP 协议↔LangGraph）
│   │
│   ├── evals/                   # 评测框架
│   └── partners/                # 合作方沙箱集成
│       ├── daytona/             # Daytona 沙箱
│       ├── modal/               # Modal 远程执行
│       ├── quickjs/             # QuickJS 沙箱
│       └── runloop/             # Runloop 沙箱
│
└── examples/
    ├── deep_research/           # 深度研究 Agent
    ├── content-builder-agent/   # 内容生成 Agent
    ├── nvidia_deep_agent/       # NVIDIA API 集成 Agent
    ├── ralph_mode/              # Ralph Mode（扩展示例）
    └── text-to-sql-agent/       # Text-to-SQL Agent
```

---

## 核心架构

```
┌──────────────────────────────────────────────────────────────────────┐
│  用户 / IDE / Claude Code 客户端                                      │
└─────┬─────────────┬──────────────────────┬──────────────────────────┘
      │             │                      │
      ▼             ▼                      ▼
  Python SDK      CLI (TUI)            ACP Server
  直接调用         终端交互              ACP 协议接入
      │             │                      │
      └─────────────┴──────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│  create_deep_agent()  ←  graph.py 核心工厂                           │
│                                                                      │
│  中间件栈（Middleware Stack）：                                        │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  TodoListMiddleware       ← write_todos 任务规划              │   │
│  │  FilesystemMiddleware     ← read/write/edit/ls/glob/grep      │   │
│  │  SubAgentMiddleware       ← task（同步 subagent 委派）         │   │
│  │  AsyncSubAgentMiddleware  ← 后台异步 subagent（LangSmith 部署）│   │
│  │  SummarizationMiddleware  ← 上下文过长时自动摘要               │   │
│  │  PatchToolCallsMiddleware ← Tool Call 格式修正                 │   │
│  │  SkillsMiddleware         ← 自定义技能加载                     │   │
│  │  MemoryMiddleware         ← AGENTS.md 持久化 memory           │   │
│  │  AnthropicCachingMiddleware ← Anthropic prompt cache 优化      │   │
│  │  HumanInTheLoopMiddleware ← interrupt_on 配置的 HITL 审批      │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                    │                                                  │
│                    ▼                                                  │
│         langchain.create_agent()  →  LangGraph CompiledStateGraph    │
│                                                                      │
│  Backend（文件/执行后端）：                                            │
│  ┌─────────────────────────────────────────────┐                    │
│  │ StateBackend     ← 内存（默认，测试用）       │                    │
│  │ FilesystemBackend ← 本地磁盘                  │                    │
│  │ LocalShellBackend ← 本地 shell + 文件系统     │                    │
│  │ CompositeBackend  ← 路由（不同路径→不同后端） │                    │
│  │ SandboxBackend   ← Modal/Daytona/Runloop 等  │                    │
│  └─────────────────────────────────────────────┘                    │
└──────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
         LLM（Claude Sonnet 4.6 默认，支持任意 tool-calling 模型）
```

---

## 核心工作流程

### 1. Agent 初始化（`create_deep_agent`）

```python
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    tools=[my_tool],
    system_prompt="You are a research assistant.",
    interrupt_on={"edit_file": True},   # 编辑文件前暂停等待人工确认
    checkpointer=MemorySaver(),          # 持久化对话状态
)
```

内部流程：
1. 解析 model（string → `BaseChatModel`，OpenAI 默认用 Responses API）
2. 为 general-purpose subagent 构建中间件栈
3. 处理 subagents 列表（SubAgent / CompiledSubAgent / AsyncSubAgent 三种类型）
4. 构建主 Agent 中间件栈
5. 拼接 system_prompt（用户自定义 + BASE_AGENT_PROMPT）
6. 调用 `langchain.create_agent()` → 返回 LangGraph CompiledStateGraph

### 2. 请求处理（Agent Invoke）

```python
result = agent.invoke({
    "messages": [{"role": "user", "content": "Research LangGraph and write a summary"}]
})
```

流程：
```
用户消息 → LangGraph 图执行
  → 中间件注入工具到 LLM context
  → LLM 调用 write_todos（规划任务）
  → LLM 调用 read_file / glob / grep（读取代码/文件）
  → LLM 调用 execute（运行命令）
  → LLM 调用 task（委派给 subagent）
  → 上下文过长时 SummarizationMiddleware 自动摘要
  → HITL interrupt_on 触发时暂停等待用户决策
  → 任务完成返回最终结果
```

### 3. Subagent 机制

**同步 SubAgent**（`task` 工具）：
- 主 Agent 通过 `task(description, subagent_type)` 委派任务
- subagent 在独立上下文窗口中运行，防止上下文污染
- 可通过 `subagents.yaml` 或 Python 代码定义

**异步 SubAgent**（后台任务）：
- 针对 LangSmith 上部署的远程 LangGraph Agent
- 主 Agent 可 `launch_async_subagent` 启动后台任务，继续做其他事
- 通过 `check_async_subagent` 查询状态，`cancel_async_subagent` 取消

### 4. ACP Server（供 IDE 接入）

`AgentServerACP` 实现 ACP 协议，把 Deep Agent 暴露给任何支持 ACP 的 IDE：
- 流式推送 tool call 状态（read/edit/execute 等类型可视化）
- Todo list → Plan 可视化（`write_todos` → `AgentPlanUpdate`）
- HITL 权限请求（approve/reject/always allow）
- 支持会话模式切换（mode 对应不同 Agent 配置）

---

## 部署步骤

### 方法一：SDK（Python）

```bash
pip install deepagents
# 或
uv add deepagents
```

```python
from deepagents import create_deep_agent

# 最简用法（默认 claude-sonnet-4-6，需设 ANTHROPIC_API_KEY）
agent = create_deep_agent()
result = agent.invoke({
    "messages": [{"role": "user", "content": "List files in /tmp"}]
})

# 自定义模型
from langchain.chat_models import init_chat_model
agent = create_deep_agent(
    model=init_chat_model("openai:gpt-5"),
    tools=[my_tool],
    system_prompt="You are a helpful assistant.",
)
```

### 方法二：CLI（命令行 coding agent）

```bash
# 一键安装
curl -LsSf https://raw.githubusercontent.com/langchain-ai/deepagents/main/libs/cli/scripts/install.sh | bash

# 启动
deepagents

# 非交互模式（CI/脚本）
deepagents --no-interactive --prompt "Add tests for all functions in src/"

# 指定模型
deepagents --model openai:gpt-5
```

### 方法三：ACP Server（供 IDE 接入）

```bash
pip install deepagents-acp

# 启动 ACP server（可被 Claude Code 等 ACP 客户端连接）
python -m deepagents_acp
```

---

## Demo 示例

### 1. 基础用法

```python
from deepagents import create_deep_agent

agent = create_deep_agent()

# 流式输出
for chunk in agent.stream(
    {"messages": [{"role": "user", "content": "Write a Python fibonacci function"}]},
    stream_mode="messages"
):
    print(chunk)
```

### 2. 带 HITL 的 Agent

```python
from deepagents import create_deep_agent
from langgraph.checkpoint.memory import MemorySaver

agent = create_deep_agent(
    interrupt_on={
        "execute": True,   # 执行命令前等待确认
        "edit_file": True, # 编辑文件前等待确认
    },
    checkpointer=MemorySaver(),
)

config = {"configurable": {"thread_id": "session-1"}}

# 第一次调用，执行会在 execute 工具处暂停
result = agent.invoke(
    {"messages": [{"role": "user", "content": "Run ls -la"}]},
    config=config
)

# 恢复执行（批准）
agent.invoke(
    {"type": "approve"},
    config=config
)
```

### 3. 自定义 Subagent（通过 subagents.yaml）

```yaml
# ~/.deepagents/agent/subagents.yaml
subagents:
  - name: researcher
    description: "Specialized in web research and summarization"
    system_prompt: "You are a research specialist..."
    model: openai:gpt-5
```

---

## 关键发现 / 学习心得

### 1. 中间件架构是最大亮点

不同于 CrewAI/AutoGen 等框架，deepagents 使用**中间件栈**而非继承/装饰器模式扩展 Agent。每个 Middleware 向 Agent 注入工具、修改 state、或 wrap LLM 调用。这让功能组合非常灵活，任意启停单个能力，且各 Middleware 之间解耦。

### 2. Backend 抽象解决了"在哪执行"问题

同一套 Agent 代码可以跑在：本地 shell、本地文件系统、Modal/Daytona/Runloop 远程沙箱。切换只需替换 `backend` 参数，Agent 逻辑完全不变。这是 Claude Code 等工具的核心痛点——deepagents 用 Backend 协议优雅解决了。

### 3. ACP 协议是战略核心

deepagents-acp 让 deepagents 可以作为后端接入任何 ACP 兼容的前端（包括 Claude Code 的客户端 UI）。LangChain 在押注 ACP 成为 AI Agent 通信的通用协议，类似 LSP 之于编辑器。

### 4. "Trust the LLM" 安全模型

明确拒绝"靠模型自律"的安全策略。系统依赖工具/沙箱层面的边界（`interrupt_on` HITL 审批 + sandbox isolation），不期望 LLM 自我节制。这和大多数生产级 Agent 框架的趋势一致。

### 5. 与 Claude Code 的核心区别

| 特性 | Claude Code | deepagents |
|------|-------------|------------|
| 模型 | 仅 Anthropic | 任意 tool-calling LLM |
| 开源 | 否 | MIT 全开源 |
| 扩展性 | 有限 | Middleware 完全可组合 |
| Sandbox | 无原生支持 | Modal/Daytona/Runloop 等 |
| 协议 | 专有 | ACP 开放协议 |

---

## 参考资源

- GitHub: https://github.com/langchain-ai/deepagents
- 官方文档: https://docs.langchain.com/oss/python/deepagents/overview
- API 参考: https://reference.langchain.com/python/deepagents/
- ACP 协议: https://agentclientprotocol.com/protocol/overview
- JS/TS 版本: https://github.com/langchain-ai/deepagentsjs
- LangSmith: https://docs.langchain.com/langsmith/home
