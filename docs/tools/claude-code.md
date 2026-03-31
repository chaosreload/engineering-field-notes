# Claude Code — Source Code Deep Dive

> 整理日期：2026-03-31
> 仓库地址：https://github.com/instructkr/claude-code
> 泄露时间：2026-03-31（通过 npm registry .map 文件暴露）

## 项目简介

Claude Code 是 Anthropic 官方的 CLI 编程助手工具。用户在终端中通过自然语言与 Claude 交互，完成代码编辑、命令执行、代码搜索、Git 工作流管理等软件工程任务。

**2026 年 3 月 31 日，其完整 TypeScript 源码通过 npm 包中的 `.map` 文件意外泄露**，由 [@Fried_rice](https://x.com/Fried_rice) 在 X 上首先披露。这是迄今为止规模最大的 AI 编程工具源码公开事件之一。

### 关键数字

| 指标 | 数值 |
|------|------|
| 语言 | TypeScript |
| 运行时 | Bun |
| UI 框架 | React + [Ink](https://github.com/vadimdemedes/ink)（终端 React 渲染器）|
| 源文件数 | ~1,902 |
| 代码行数 | ~148,000 行（纯 TS/TSX）|
| 工具数量 | ~40 个 Agent Tools |
| 命令数量 | ~60 个 Slash Commands |
| React Hooks | ~80+ 个自定义 Hooks |

---

## 项目结构

```
src/
├── main.tsx                 # 入口（Commander.js CLI 解析器）
├── QueryEngine.ts           # 核心 LLM 查询引擎（1,295 行）
├── Tool.ts                  # Tool 类型定义（792 行）
├── tools.ts                 # Tool 注册表
├── commands.ts              # 命令注册表（754 行）
├── context.ts               # 系统/用户上下文收集
├── cost-tracker.ts          # Token 成本追踪
│
├── tools/                   # Agent Tool 实现（~40 个）
│   ├── BashTool/            # Shell 命令执行（含安全验证子模块）
│   ├── FileReadTool/        # 文件读取
│   ├── FileWriteTool/       # 文件写入
│   ├── FileEditTool/        # 文件编辑（字符串替换）
│   ├── AgentTool/           # 子 Agent 生成
│   ├── WebFetchTool/        # URL 内容抓取
│   ├── WebSearchTool/       # 网络搜索
│   ├── MCPTool/             # MCP 服务器工具调用
│   ├── LSPTool/             # Language Server Protocol 集成
│   ├── SkillTool/           # Skill 执行
│   ├── TaskCreateTool/      # 任务管理
│   ├── TeamCreateTool/      # 多 Agent 团队管理
│   ├── EnterWorktreeTool/   # Git worktree 隔离
│   ├── SleepTool/           # 后台等待
│   ├── ScheduleCronTool/    # 定时任务
│   └── ...
│
├── commands/                # Slash 命令实现（~60 个）
│   ├── compact/             # 上下文压缩
│   ├── mcp/                 # MCP 服务器管理
│   ├── memory/              # 持久记忆管理
│   ├── skills/              # Skill 管理
│   ├── review.ts            # 代码审查
│   ├── commit.ts            # Git commit
│   ├── doctor/              # 环境诊断
│   └── ...
│
├── components/              # Ink UI 组件（~140 个）
├── hooks/                   # React Hooks（~80+ 个）
│   └── toolPermission/      # 工具权限检查系统
│
├── services/                # 外部服务集成
│   ├── api/                 # Anthropic API 客户端
│   ├── mcp/                 # MCP 协议实现
│   ├── compact/             # 上下文压缩服务
│   ├── oauth/               # OAuth 2.0 认证
│   ├── lsp/                 # LSP 管理器
│   ├── analytics/           # GrowthBook 特性标志 + 分析
│   ├── extractMemories/     # 自动记忆提取
│   └── teamMemorySync/      # 团队记忆同步
│
├── bridge/                  # IDE 集成桥（VS Code / JetBrains）
│   ├── bridgeMain.ts        # 桥主循环
│   ├── bridgeMessaging.ts   # 消息协议
│   ├── replBridge.ts        # REPL 会话桥
│   └── jwtUtils.ts          # JWT 认证
│
├── coordinator/             # 多 Agent 协调器
├── memdir/                  # 持久记忆目录（MEMORY.md 系统）
├── skills/                  # Skill 系统
├── plugins/                 # 插件系统
├── tasks/                   # 任务管理（LocalAgentTask / RemoteAgentTask）
├── state/                   # 状态管理（AppState store）
├── schemas/                 # 配置 Schema（Zod 验证）
├── migrations/              # 配置迁移（模型版本升级）
├── remote/                  # 远程会话
├── server/                  # Server 模式
├── voice/                   # 语音输入
├── vim/                     # Vim 模式
├── buddy/                   # 伴侣精灵（彩蛋）
└── upstreamproxy/           # 代理配置
```

---

## 核心架构

### 1. 启动流程（main.tsx → REPL）

Claude Code 的启动是一个精心优化的流程，核心目标是**最小化首字节时间**：

```
main.tsx entry
  ├── profileCheckpoint('main_tsx_entry')     # 性能标记
  ├── startMdmRawRead()                       # MDM 子进程（并行）
  ├── startKeychainPrefetch()                 # macOS Keychain 预读（并行）
  ├── Commander.js CLI 参数解析
  ├── init() → 初始化遥测、配置、GrowthBook
  ├── 加载 MCP 服务器、插件、Skill
  ├── 权限系统初始化
  └── launchRepl() → 进入 React/Ink REPL 循环
```

**关键优化**：
- Keychain 读取（OAuth + API Key）从串行改为**并行预取**，节省 ~65ms（macOS）
- MDM 设置读取（plutil/reg query）在 import 阶段就启动子进程
- GrowthBook 特性标志异步加载，不阻塞启动
- 使用 Bun 的 `bun:bundle` feature flags 做**编译时死代码消除**

### 2. QueryEngine — LLM 交互核心

`QueryEngine.ts`（1,295 行）是整个系统的心脏，负责：

```
用户输入 → QueryEngine
  ├── 构建系统消息（system prompt + context）
  ├── 调用 Anthropic API（streaming）
  ├── 处理 tool_use 响应
  │   ├── 权限检查（PermissionContext）
  │   ├── 执行工具
  │   └── 将结果注入对话
  ├── 循环直到模型完成
  ├── Token 计数 + 成本追踪
  └── 会话持久化
```

**QueryEngineConfig** 定义了引擎的完整配置：

```typescript
type QueryEngineConfig = {
  cwd: string
  tools: Tools
  commands: Command[]
  mcpClients: MCPServerConnection[]
  agents: AgentDefinition[]
  canUseTool: CanUseToolFn
  getAppState: () => AppState
  initialMessages?: Message[]
  customSystemPrompt?: string
  thinkingConfig?: ThinkingConfig
  maxTurns?: number
  maxBudgetUsd?: number      // 预算控制
  jsonSchema?: Record<string, unknown>  // 结构化输出
}
```

### 3. Tool 系统 — 模块化工具架构

每个 Tool 是一个自包含模块，定义了：
- **Input Schema**（Zod 验证）
- **Permission Model**（权限模型）
- **Execution Logic**（执行逻辑）
- **UI Rendering**（Ink 组件渲染）

完整工具列表：

| 工具 | 功能 | 特殊说明 |
|------|------|----------|
| `BashTool` | Shell 命令执行 | 含 18 个子模块：安全验证、破坏性命令警告、sed 解析、沙箱判断 |
| `FileReadTool` | 文件读取 | 支持图片、PDF、Notebook |
| `FileWriteTool` | 文件创建/覆盖 | |
| `FileEditTool` | 文件编辑（字符串替换）| |
| `GlobTool` | 文件模式匹配搜索 | |
| `GrepTool` | ripgrep 内容搜索 | |
| `AgentTool` | 子 Agent 生成 | 支持同步/异步、worktree 隔离、远程执行 |
| `WebFetchTool` | URL 内容抓取 | |
| `WebSearchTool` | 网络搜索 | |
| `MCPTool` | MCP 服务器工具调用 | |
| `LSPTool` | LSP 集成 | |
| `SkillTool` | Skill 执行 | |
| `NotebookEditTool` | Jupyter 编辑 | |
| `TaskCreateTool` | 任务创建 | |
| `TaskUpdateTool` | 任务更新 | |
| `SendMessageTool` | Agent 间消息 | |
| `TeamCreateTool` | 团队创建 | |
| `EnterPlanModeTool` | 进入计划模式 | |
| `EnterWorktreeTool` | Git worktree 隔离 | |
| `ToolSearchTool` | 延迟工具发现 | |
| `SleepTool` | 后台等待 | PROACTIVE/KAIROS 模式 |
| `CronCreateTool` | 定时任务 | AGENT_TRIGGERS 特性标志 |
| `RemoteTriggerTool` | 远程触发 | |
| `SyntheticOutputTool` | 结构化输出 | |
| `BriefTool` | 简要模式 | |
| `TodoWriteTool` | TODO 管理 | |
| `PowerShellTool` | PowerShell（Windows）| 条件加载 |
| `WebBrowserTool` | 浏览器控制 | WEB_BROWSER_TOOL 特性标志 |
| `ConfigTool` | 配置管理 | Anthropic 内部 |
| `REPLTool` | REPL 工具 | Anthropic 内部 |

**BashTool 的安全架构**特别值得关注，包含 18 个子模块：

```
BashTool/
├── BashTool.tsx              # 主实现
├── bashSecurity.ts           # 安全策略
├── bashPermissions.ts        # 权限判断
├── commandSemantics.ts       # 命令语义分析
├── destructiveCommandWarning.ts  # 破坏性命令警告
├── sedEditParser.ts          # sed 命令解析
├── sedValidation.ts          # sed 安全验证
├── pathValidation.ts         # 路径验证
├── readOnlyValidation.ts     # 只读验证
├── modeValidation.ts         # 模式验证
└── shouldUseSandbox.ts       # 沙箱判断
```

### 4. 权限系统 — 多层安全模型

权限系统是 Claude Code 最复杂的子系统之一，位于 `hooks/toolPermission/`：

```
Tool 调用请求
  ├── Step 1: Deny Rules 检查
  │   └── 配置中的全局/工具级禁止规则
  ├── Step 2: Permission Mode 判断
  │   ├── default → 逐次询问用户
  │   ├── plan → 计划模式（只读）
  │   ├── auto → 分类器自动审批
  │   └── bypassPermissions → 跳过（危险）
  ├── Step 3: Hook 系统
  │   └── 执行 pre-tool-use hooks
  ├── Step 4: 分类器审批（auto 模式）
  │   └── Bash 命令分类器判断安全性
  └── Step 5: 用户交互
      ├── 允许（临时/永久）
      └── 拒绝（含反馈）
```

**Auto Mode 的分类器审批**是一个亮点：在 auto 模式下，BashTool 的每条命令都经过一个分类器（`awaitClassifierAutoApproval`），判断是否安全。不安全的命令仍会弹出用户确认。

### 5. Feature Flags — 编译时死代码消除

这是 Claude Code 工程上最聪明的设计之一。利用 Bun 的 `bun:bundle` 特性：

```typescript
import { feature } from 'bun:bundle'

// 编译时决定是否包含代码
const voiceCommand = feature('VOICE_MODE')
  ? require('./commands/voice/index.js').default
  : null

const SleepTool = feature('PROACTIVE')
  ? require('./tools/SleepTool/SleepTool.js').SleepTool
  : null
```

**已知 Feature Flags**：

| Flag | 功能 | 状态 |
|------|------|------|
| `PROACTIVE` | 主动模式（SleepTool） | 实验性 |
| `KAIROS` | 助手模式（完整后台运行） | 实验性 |
| `BRIDGE_MODE` | IDE 桥接 | 生产 |
| `DAEMON` | 守护进程模式 | 实验性 |
| `VOICE_MODE` | 语音输入 | 实验性 |
| `AGENT_TRIGGERS` | 定时触发（Cron） | 实验性 |
| `COORDINATOR_MODE` | 多 Agent 协调器 | 实验性 |
| `WEB_BROWSER_TOOL` | 浏览器工具 | 实验性 |
| `HISTORY_SNIP` | 历史裁剪 | 实验性 |
| `WORKFLOW_SCRIPTS` | 工作流脚本 | 实验性 |
| `TERMINAL_PANEL` | 终端面板 | 实验性 |
| `CONTEXT_COLLAPSE` | 上下文折叠 | 实验性 |
| `UDS_INBOX` | Unix Domain Socket 收件箱 | 实验性 |
| `FORK_SUBAGENT` | Fork 子 Agent | 实验性 |
| `BUDDY` | 伴侣精灵 | 彩蛋 |
| `BASH_CLASSIFIER` | Bash 命令分类器 | 实验性 |
| `TRANSCRIPT_CLASSIFIER` | 对话记录分类器 | 实验性 |

**为什么这很聪明**：发布到 npm 的公开版本通过 feature flags 剥离了所有实验性功能，但源码中保留了完整实现。这意味着 Anthropic 内部版本拥有远超公开版的功能。

### 6. Memory 系统（memdir/）

Claude Code 的记忆系统基于 `MEMORY.md` 文件：

```
memdir/
├── memdir.ts              # 核心逻辑
├── findRelevantMemories.ts # 相关记忆检索
├── memoryScan.ts          # 记忆扫描
├── memoryTypes.ts         # 记忆类型定义
├── memoryAge.ts           # 记忆老化
├── paths.ts               # 路径管理
├── teamMemPaths.ts        # 团队记忆路径
└── teamMemPrompts.ts      # 团队记忆提示
```

**设计要点**：
- `MEMORY.md` 入口文件限制 **200 行 / 25KB**（防止系统提示膨胀）
- 支持**自动记忆提取**（`services/extractMemories/`）
- 支持**团队记忆同步**（`services/teamMemorySync/`）
- 记忆注入系统提示时会做相关性过滤

### 7. MCP（Model Context Protocol）集成

MCP 是 Claude Code 连接外部工具的标准协议：

```
services/mcp/
├── types.ts               # 配置 Schema（支持 stdio/sse/http/ws/sdk）
├── client.ts              # MCP 客户端管理
├── config.ts              # 配置解析（多层级：local/user/project/enterprise/claudeai）
├── officialRegistry.ts    # 官方注册表预取
└── xaaIdpLogin.ts         # 跨应用认证（XAA）
```

**MCP 配置层级**（从高到低优先级）：
1. `enterprise` — 企业策略
2. `managed` — 远程管理
3. `claudeai` — Claude AI 订阅者特有
4. `project` — 项目级（`.claude/mcp.json`）
5. `user` — 用户级
6. `local` — 本地级
7. `dynamic` — 运行时动态注册

### 8. 上下文压缩（Compact）

当对话超出上下文窗口时，Claude Code 使用多层压缩策略：

```
services/compact/
├── compact.ts             # 主压缩逻辑（使用 forked agent）
├── autoCompact.ts         # 自动触发压缩
├── microCompact.ts        # 微压缩（轻量级）
├── apiMicrocompact.ts     # API 级微压缩
├── grouping.ts            # 消息分组
├── sessionMemoryCompact.ts # 会话记忆压缩
└── postCompactCleanup.ts  # 压缩后清理
```

压缩流程：用一个 **forked agent**（子进程 Claude）来总结当前对话，生成精简版注入新的上下文窗口。

### 9. Bridge 系统 — IDE 集成

Bridge 是 Claude Code 与 IDE 扩展（VS Code / JetBrains）之间的双向通信层：

```
bridge/
├── bridgeMain.ts          # 桥主循环
├── bridgeMessaging.ts     # 消息协议
├── bridgePermissionCallbacks.ts  # 权限回调
├── replBridge.ts          # REPL 会话桥
├── jwtUtils.ts            # JWT 认证
├── sessionRunner.ts       # 会话执行管理
├── inboundMessages.ts     # 入站消息处理
├── inboundAttachments.ts  # 入站附件处理
└── trustedDevice.ts       # 可信设备管理
```

### 10. Agent Swarm — 多 Agent 协作

Claude Code 内置了多 Agent 协作系统：

- **AgentTool**：生成子 Agent，支持同步/异步执行
- **TeamCreateTool / TeamDeleteTool**：管理 Agent 团队
- **SendMessageTool**：Agent 间消息传递
- **Coordinator Mode**：协调器模式，一个 Agent 负责分解任务，多个 Worker Agent 并行执行
- **Worktree 隔离**：每个 Agent 在独立的 Git worktree 中工作，避免冲突

```typescript
// AgentTool 支持多种执行模式
- 同步执行（foreground）
- 异步执行（background，2 秒后自动后台化）
- 远程执行（teleport 到远程机器）
- Fork 执行（FORK_SUBAGENT flag）
```

---

## 核心工作流程

### 用户输入处理流程

```
1. 用户在终端输入文本
2. main.tsx 中的 Commander.js 解析 CLI 参数
3. launchRepl() 启动 React/Ink REPL 界面
4. 用户消息进入 QueryEngine
5. QueryEngine 构建完整上下文：
   - 系统提示（含 CLAUDE.md、MEMORY.md、git 状态）
   - 用户上下文（cwd、环境变量、项目信息）
   - 对话历史
6. 调用 Anthropic API（streaming）
7. 处理响应：
   - 纯文本 → 渲染到终端
   - tool_use → 权限检查 → 执行工具 → 注入结果 → 循环
8. 对话持久化到本地文件
```

### Slash 命令处理流程

```
1. 用户输入 /command [args]
2. commands.ts 匹配命令
3. 命令分两类：
   - Local Command → 直接执行，不调用 LLM
   - Prompt Command → 生成提示词注入 LLM 对话
4. 结果渲染到终端
```

---

## 关键发现 / 学习心得

### 1. "终端 React" 是真实的生产级方案

Claude Code 用 **React + Ink** 构建了一个完整的终端 UI 框架，包含 ~140 个组件、~80 个 Hooks。这不是玩具——这是 Anthropic 的主力产品。这证明了 React 的抽象在终端场景也完全可行。

### 2. Feature Flags 做死代码消除 = 一套代码两种产品

Bun 的 `bun:bundle` feature flags 让 Anthropic 在**同一个代码库**里维护内部版和公开版。内部版有：语音模式、主动模式（AI 主动工作）、协调器模式、浏览器工具、守护进程模式等。**公开版用户看到的只是冰山一角。**

### 3. BashTool 的安全工程令人印象深刻

18 个子模块只为安全执行一条 shell 命令。包括：语义分析（区分读/写/破坏性）、sed 解析验证、路径验证、沙箱判断、分类器自动审批。这说明在 AI Agent 场景下，**命令执行安全是第一优先级**。

### 4. 模型迁移代码暴露了 Anthropic 的版本节奏

`migrations/` 目录记录了模型切换历史：
- `migrateFennecToOpus` — Fennec 是 Opus 的内部代号
- `migrateLegacyOpusToCurrent`
- `migrateOpusToOpus1m` — Opus 1M 上下文
- `migrateSonnet1mToSonnet45` — Sonnet 4.5
- `migrateSonnet45ToSonnet46` — Sonnet 4.6

这暴露了 Anthropic 模型的内部命名和迭代节奏。

### 5. KAIROS — Anthropic 的下一步

KAIROS 是 Claude Code 内部的**助手模式**，Feature Flag `KAIROS` 控制了大量代码路径：
- 后台持续运行
- 推送通知（`PushNotificationTool`）
- 文件发送（`SendUserFileTool`）
- 会话记忆
- 简要模式（BriefTool）
- GitHub Webhook 订阅

这暗示 Anthropic 正在把 Claude Code 从"被动 CLI 工具"进化为"**主动 AI 助手**"——一个始终在线、主动工作的编程伙伴。

### 6. 上下文管理是核心竞争力

Claude Code 在上下文管理上投入了大量工程：
- 多层压缩策略（compact → micro-compact → API micro-compact）
- 文件状态缓存（避免重复读取）
- 会话记忆与自动记忆提取
- 上下文折叠（CONTEXT_COLLAPSE flag）
- 历史裁剪（HISTORY_SNIP flag）

这说明在长对话场景下，**如何在有限上下文窗口里保持最相关的信息**是最大的工程挑战。

---

## 与 OpenClaw 的对比视角

作为 OpenClaw 的研究员，几个值得注意的对比点：

| 方面 | Claude Code | OpenClaw |
|------|------------|----------|
| 运行时 | Bun（单 JS runtime） | Node.js |
| UI | React/Ink（终端 React） | 多渠道（Telegram/Slack/Discord/...） |
| 模型 | Anthropic 独占 | 多模型支持 |
| Agent 协作 | 内置 Swarm（进程内） | 多 Agent workspace + 跨频道 |
| MCP | 深度集成 | 插件式集成 |
| 记忆 | MEMORY.md + 自动提取 | MEMORY.md + memory/*.md |
| 权限 | 多层级（含分类器） | 工具级 allowlist |
| IDE 集成 | 原生 Bridge | ACP 协议 |

---

## 参考资源

- [泄露事件原推](https://x.com/Fried_rice/status/2038894956459290963) — @Fried_rice
- [GitHub 仓库](https://github.com/instructkr/claude-code) — instructkr/claude-code
- [Ink — React for CLI](https://github.com/vadimdemedes/ink)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Bun 文档](https://bun.sh/docs)
