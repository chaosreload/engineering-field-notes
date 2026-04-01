# Claude Code — Source Code Deep Dive

> 整理日期：2026-03-31 | 仓库地址：[instructkr/claude-code](https://github.com/instructkr/claude-code)
>
> 泄露时间：2026-03-31（通过 npm registry `.map` 文件暴露）
>
> 架构分析：Scout（🔭） | BashTool 深度分析：码虾（🦐）

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

### 启动流程（main.tsx → REPL）

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

### QueryEngine — LLM 交互核心

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

### Tool 系统 — 模块化工具架构

每个 Tool 是一个自包含模块，定义了：
- **Input Schema**（Zod 验证）
- **Permission Model**（权限模型）
- **Execution Logic**（执行逻辑）
- **UI Rendering**（Ink 组件渲染）

**完整工具列表**：

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

### 权限系统 — 多层安全模型

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

### Feature Flags — 编译时死代码消除

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

### Memory 系统（memdir/）

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

### MCP（Model Context Protocol）集成

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

### 上下文压缩（Compact）

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

### Bridge 系统 — IDE 集成

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

### Agent Swarm — 多 Agent 协作

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

## BashTool 深度分析 — 命令执行模块

> 源码路径：`src/tools/BashTool/`（15 个文件，10,894 行）

BashTool 是 Claude Code 最复杂也最危险的模块——15 个文件、近 11,000 行代码，只为安全执行一条 shell 命令。本节从源码角度做逐层深挖。

```
BashTool/
├── BashTool.tsx              # 主实现（~800 行）
├── bashSecurity.ts           # 语法安全检查（2,592 行）
├── bashPermissions.ts        # 权限规则系统（2,621 行）
├── pathValidation.ts         # 路径语义验证（1,303 行）
├── readOnlyValidation.ts     # 只读约束（1,990 行）
├── sedValidation.ts          # sed 专项验证（684 行）
├── commandSemantics.ts       # 命令退出码语义（140 行）
├── destructiveCommandWarning.ts  # 破坏性命令告警（102 行）
├── shouldUseSandbox.ts       # 沙箱决策（153 行）
├── sedEditParser.ts          # sed 命令解析
├── modeValidation.ts         # 模式验证
└── prompt.ts                 # BashTool 提示词
```

### 命令构建：从 LLM 输入到执行参数

LLM 通过 `tool_use` 响应传入命令，Schema 定义（`BashTool.tsx`）：

```typescript
// Zod schema — LLM 必须遵守这个格式
const inputSchema = z.object({
  command: z.string(),           // 要执行的 shell 命令
  timeout: z.number().optional(), // 超时毫秒数（可选）
  description: z.string().optional(), // 人类可读描述（可选）
})
```

`command` 是纯字符串，Claude 模型根据 system prompt 中的工具描述来决定填什么。

**System Prompt 中的命令构建指引**（`src/tools/BashTool/prompt.ts`）：

```typescript
// 核心约束（精简）
- 始终使用 set -e, set -o pipefail 等安全选项
- 不要使用 sudo（除非明确被要求）
- 优先使用绝对路径
- 长时间运行的命令必须加 timeout 参数
- 不要在后台运行（& 后台）除非明确要求
```

关键设计：**LLM 被训练成倾向于构建"保守"命令**——加 timeout、避免 sudo、不乱写文件，而非通过安全检查强制。模型自律 + 技术防护双层。

**超时控制**：

```typescript
export function getDefaultTimeoutMs(): number {
  return 120_000  // 默认 2 分钟
}

export function getMaxTimeoutMs(): number {
  return 600_000  // 最大 10 分钟
}
```

超时后进程被 SIGTERM，再等 5 秒后 SIGKILL。

### 命令执行：Shell.ts

最终执行走 `src/utils/Shell.ts`，底层调用 Node.js `child_process.spawn`：

```typescript
// Shell.ts — 核心执行逻辑
import { spawn } from 'child_process'

// 执行环境选择
export async function findSuitableShell(): Promise<string> {
  // 优先级：CLAUDE_CODE_SHELL 环境变量 > bash > zsh > sh
  const shellOverride = process.env.CLAUDE_CODE_SHELL
  if (shellOverride && isExecutable(shellOverride)) return shellOverride
  // ... 查找 bash/zsh
}
```

**关键设计**：命令通过 `spawn(shell, ['-c', command])` 执行，而非 `exec()`。这避免了命令行长度限制（exec 在 Linux 上是 2MB，但 spawn+shell 没有这个限制）。

**沙箱化执行路径**：当 `shouldUseSandbox()` 返回 true 时，走 `SandboxManager`：

```
macOS     → 系统级 sandbox-exec（Apple sandbox profiles）
Linux     → seccomp + namespace 隔离（或降级为无沙箱）
```

`shouldUseSandbox.ts` 的决策逻辑：
1. `SandboxManager.isSandboxingEnabled()` 为 true
2. 且 NOT `dangerouslyDisableSandbox`（用户未手动关闭）
3. 且 NOT 命令在 `excludedCommands` 列表中（用户配置）

**工作目录管理**：BashTool 维护一个 session 级别的 `cwd` 状态。注意 `cd` 命令的特殊处理：

```typescript
// BashTool.tsx
if (commandHasAnyCd(command)) {
  // cd 命令需要特殊处理：在 BashTool 进程里执行 cd 并更新 cwd 状态
  // 因为 spawn 的子进程 cd 不会影响父进程的工作目录
  const newCwd = await resolveCdCommand(command, currentCwd)
  setCwdState(newCwd)  // 更新全局 cwd
}
```

**输出处理**：
- stdout/stderr 通过流式读取，实时渲染到 Ink UI
- 输出截断：单条命令最大 `TOOL_SUMMARY_MAX_LENGTH`（防止上下文爆炸）
- 图片输出检测：`isImageOutput()` — 如果 stdout 是图片（PNG/JPEG），走 base64 编码路径返回图片给 LLM

### 安全管控：五层纵深防御体系

BashTool 的安全架构是 **Defense in Depth（纵深防御）**，没有任何单一检查点是完全可信的：

```
用户输入
   │
   ▼
[Layer 1] Mode Validation     — 当前 Permission Mode 允许执行吗？
   │
   ▼
[Layer 2] Deny Rules          — 全局/工具级禁止规则命中了吗？
   │
   ▼
[Layer 3] Syntax Security     — 命令本身有没有危险语法？（23 项检查）
   │
   ▼
[Layer 4] Semantic Security   — 路径/行为语义是否安全？
   │
   ▼
[Layer 5] Runtime Sandbox     — 运行时进程级别隔离
```

#### Layer 1：Permission Mode 检查

`modeValidation.ts` 定义四种模式：

```typescript
type PermissionMode =
  | 'default'     // 每次询问用户
  | 'plan'        // 计划模式（只读）
  | 'auto'        // 分类器自动审批
  | 'bypassPermissions'  // 跳过所有检查（！高危！）
```

`plan` 模式下 BashTool 直接走 `checkReadOnlyConstraints`，任何写操作都会被拒绝。

#### Layer 2：Deny Rules + Allow Rules 系统

`bashPermissions.ts`（2,621 行）是核心文件。规则系统设计精妙：

**规则格式**（`PermissionRule`）：
```
Bash(git commit:*)           → 前缀匹配，允许所有 git commit 子命令
Bash(rm -rf /tmp/*)          → 通配符匹配
Bash(curl https://api.com)   → 精确匹配
```

**核心逻辑——`stripSafeWrappers()`**：
```typescript
// 在匹配规则前，先剥离"安全包装命令"，防止规则被绕过
// 例如：timeout 30 git commit → git commit（timeout 是安全包装）
const SAFE_WRAPPER_PATTERNS = [
  /^timeout\s+\d+\s+/,
  /^env\s+/,
  /^nice\s+/,
  // ...
]
```

**关键安全考量**：规则匹配前还要剥离 env var 赋值（`FOO=bar cmd` → `cmd`），防止 `FOO=bar bash -c evil` 绕过 `bash:*` 拒绝规则。

**BINARY_HIJACK_VARS 保护**：
```typescript
// 这些环境变量可以劫持 PATH，被列为"不安全 env var"
const BINARY_HIJACK_VARS = new Set(['PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', ...])
// 包含这些变量的命令，不走"剥离 env var"的快捷路径，强制 ask
```

#### Layer 3：Syntax Security — 最核心的 23 项检查

`bashSecurity.ts`（2,592 行）是安全检查引擎，分两条路径：

```
Tree-sitter 可用   → bashCommandIsSafeAsync（AST 级别分析）
Tree-sitter 不可用 → bashCommandIsSafe_DEPRECATED（正则 + shell-quote）
```

**设计哲学**：两个解析器（shell-quote 和 bash）对同一命令的解析可能存在差异（misparsing），攻击者可利用这种差异绕过安全检查。大量检查专门针对这类 **parser differential attack**。

**23 项检查清单**（按源码顺序）：

| ID | 检查名 | 防御目标 |
|----|--------|---------|
| 1 | `validateIncompleteCommands` | 阻止以 `-`、`&&` 开头的片段命令 |
| 2 | `validateSafeCommandSubstitution` | 允许 `$(cat <<'EOF'...EOF)` 安全 heredoc，阻止其他 `$()` |
| 3 | `validateGitCommit` | 允许简单 git commit，阻止消息中的 `$()` 和链式命令 |
| 4 | `validateJqCommand` | 阻止 `jq system()`（任意命令执行）和 `-f --from-file` |
| 5 | `validateObfuscatedFlags` | 阻止 `"-"exec`、`"--"output` 等引号混淆 flag |
| 6 | `validateShellMetacharacters` | 阻止参数中的 `;`、`` ` `` |
| 7 | `validateDangerousVariables` | 阻止 `$VAR \| cmd`、`> $VAR` 等危险变量用法 |
| 8 | `validateCommentQuoteDesync` | 阻止 `# '` 注释中的引号（会 desync quote tracker）|
| 9 | `validateQuotedNewline` | 阻止引号内换行 + `#` 开头的下一行（隐藏参数）|
| 10 | `validateCarriageReturn` | 阻止 `\r`（shell-quote vs bash 解析差异）|
| 11 | `validateNewlines` | 阻止未转义换行（多命令注入）|
| 12 | `validateIFSInjection` | 阻止 `$IFS` 操控（绕过正则验证）|
| 13 | `validateProcEnvironAccess` | 阻止 `/proc/*/environ` 读取（API key 泄露）|
| 14 | `validateDangerousPatterns` | 阻止 `$()`、反引号、`${}`、进程替换 `<()`、Zsh 特殊语法 |
| 15 | `validateRedirections` | 阻止 `<`（读敏感文件）和 `>`（写任意文件）|
| 16 | `validateBackslashEscapedWhitespace` | 阻止 `echo\ test` 路径遍历 |
| 17 | `validateBackslashEscapedOperators` | 阻止 `\;`（splitCommand 归一化后暴露 `;`）|
| 18 | `validateUnicodeWhitespace` | 阻止 Unicode 空白字符（`\u00A0` 等）|
| 19 | `validateMidWordHash` | 阻止 `foo#bar`（shell-quote vs bash `#` 注释处理差异）|
| 20 | `validateBraceExpansion` | 阻止 `{a,b}` brace expansion 绕过 allowlist |
| 21 | `validateZshDangerousCommands` | 阻止 `zmodload`、`zpty`、`ztcp`、`fc -e` 等 Zsh 危险命令 |
| 22 | `validateMalformedTokenInjection` | 阻止 `{hi:"hi;evil}` 等畸形 token + 命令分隔符 |
| - | Control Characters | 最先检查：阻止 `\x00`-`\x08`、`\x0B`-`\x1F`（控制字符绕过）|
| - | SingleQuote Backslash Bug | shell-quote 单引号 `\'` 解析 bug 防护 |

**最有价值的安全洞见**——`BASH_SECURITY_CHECK_IDS`：每个检查都有一个数字 ID（而非字符串），触发时上报 `tengu_bash_security_check_triggered` 遥测。Anthropic 在生产中实时监控哪个 ID 被触发最多，持续改进安全策略。

#### Layer 4：Semantic Security

**路径验证**（`pathValidation.ts`，1,303 行）：针对文件路径命令（`rm`/`cp`/`mv`/`cat`/`git` 等 25 种）做路径验证：

```typescript
// 核心：isDangerousRemovalPath() 检查
// 永久硬拒绝的路径（即使有 allowlist 规则也不行）：
const ALWAYS_DANGEROUS_PATHS = [
  '/', '/etc', '/usr', '/bin', '/sbin', '/lib',
  '/var', '/tmp',  // /tmp 也保护！
  '/home',         // 整个 home 目录
  // macOS 特有
  '/System', '/Library', '/Applications',
  // ...
]
```

路径规范化：所有路径经过 `expandTilde()` 和 `path.resolve()` 后验证，防止 `../../` 路径遍历。

**只读验证**（`readOnlyValidation.ts`，1,990 行）：在 plan 模式和 auto 模式的 read-only 约束下，分析命令是否真的只读：

```typescript
function isCommandReadOnly(command: string): boolean {
  const readOnlyCommands = new Set(['cat', 'ls', 'grep', 'find', 'head', 'tail',
    'wc', 'stat', 'git log', 'git diff', 'git status', ...])
  // ...
}
```

**破坏性命令告警**（`destructiveCommandWarning.ts`）：不影响权限决策，纯粹的告知性警告：

```typescript
const DESTRUCTIVE_PATTERNS = [
  { pattern: /\bgit reset --hard\b/, warning: 'Note: may discard uncommitted changes' },
  { pattern: /\brm -[a-z]*r[a-z]*f\b/, warning: 'Note: may recursively force-remove files' },
  { pattern: /\bkubectl delete\b/, warning: 'Note: may delete Kubernetes resources' },
  { pattern: /\bterraform destroy\b/, warning: 'Note: may destroy Terraform infrastructure' },
  // git push --force, git clean -f, DROP TABLE/DATABASE...
]
```

**sed 专项验证**（`sedValidation.ts`，684 行）：因为 `sed -i` 可以写文件，需要单独验证写入路径是否在允许目录内。

#### Layer 5：Runtime Sandbox

运行时的最后防线，macOS 上使用 Apple 的 `sandbox-exec`：

```
命令执行前 → shouldUseSandbox() 判断 → 是 → SandboxManager.run(command, sandboxProfile)
                                       ↓ 否
                                  直接 spawn
```

沙箱的 `excludedCommands` 机制：用户可以配置某些命令不走沙箱（比如 bazel，因为构建系统需要访问系统资源）。但这是**用户配置的便利功能，不是安全边界**——源码注释明确写着：

```
// NOTE: excludedCommands is a user-facing convenience feature, not a security boundary.
```

### Bash 分类器（BASH_CLASSIFIER）

在 `auto` 模式下，Layer 3 通过后还有一个**分类器自动审批**步骤：

```typescript
// bashPermissions.ts
if (isClassifierPermissionsEnabled()) {
  const classifierResult = await classifyBashCommand(command)
  // classifierResult: { behavior: 'allow' | 'ask' | 'deny', confidence: number }
  if (classifierResult.behavior === 'allow' && classifierResult.confidence > threshold) {
    return { behavior: 'allow', source: 'classifier' }
  }
}
```

这个分类器是 Anthropic 训练的专门模型（或规则引擎），用来判断命令在当前上下文是否安全。目前是实验性功能（`BASH_CLASSIFIER` feature flag）。

### 命令语义解析（commandSemantics.ts）

一个容易被忽视但有价值的设计：不同命令有不同的"成功"定义：

```typescript
// grep 返回 1 不是错误（只是没找到）
// diff 返回 1 不是错误（只是有差异）
const COMMAND_SEMANTICS = new Map([
  ['grep', (exitCode) => ({ isError: exitCode >= 2,
    message: exitCode === 1 ? 'No matches' : undefined })],
  ['diff', (exitCode) => ({ isError: exitCode >= 2,
    message: exitCode === 1 ? 'Files differ' : undefined })],
  ['find', (exitCode) => ({ isError: exitCode >= 2 })],
  // ...
])
```

这让 LLM 不会因为 `grep` 没找到内容就认为"命令执行失败"，避免不必要的重试循环。

---

## 关键发现与学习心得

### 1. "终端 React" 是真实的生产级方案

Claude Code 用 **React + Ink** 构建了一个完整的终端 UI 框架，包含 ~140 个组件、~80 个 Hooks。这不是玩具——这是 Anthropic 的主力产品。这证明了 React 的抽象在终端场景也完全可行。

### 2. Feature Flags 做死代码消除 = 一套代码两种产品

Bun 的 `bun:bundle` feature flags 让 Anthropic 在**同一个代码库**里维护内部版和公开版。内部版有：语音模式、主动模式（AI 主动工作）、协调器模式、浏览器工具、守护进程模式等。**公开版用户看到的只是冰山一角。**

### 3. BashTool 的安全工程令人印象深刻

18 个子模块只为安全执行一条 shell 命令。包括：语义分析（区分读/写/破坏性）、sed 解析验证、路径验证、沙箱判断、分类器自动审批。这说明在 AI Agent 场景下，**命令执行安全是第一优先级**。

### 4. Parser Differential 是 AI Agent 安全的核心威胁

Claude Code 的安全检查器用 JavaScript 的 shell-quote 库解析命令，而实际执行是 bash。这两者对同一字符串的解析存在系统性差异：

| 字符 | shell-quote 解析 | bash 实际行为 |
|------|----------------|--------------|
| `\r`（CR） | 视为词分隔符 | 不在 IFS 中，视为字面量 |
| `\` 在 `'...'` 中 | 触发转义 | 字面量 |
| `mid#word` | `#` 开始注释 | `#` 是字面量 |
| `{a,b}` brace expansion | 视为字面量 | 展开为多个参数 |

**攻击链路**：利用解析差异 → 构造在 shell-quote 解析时看起来"无害"但 bash 实际执行危险操作的命令。

`isBashSecurityCheckForMisparsing: true` 标记的检查（17 项）会在 `bashPermissions.ts` 的早期门关处直接 block，**不允许走分类器自动审批**——因为这类检查的本质是"我们无法准确分析这个命令"，自动审批在此不安全。

### 5. Tree-sitter 是升级路径

源码注释里有大量 `@deprecated Legacy regex/shell-quote path. Only used when tree-sitter is unavailable.`。Anthropic 正在把解析层从 shell-quote 迁移到 tree-sitter（成熟的增量解析器），可以生成精确的 AST，消除 parser differential 问题。

### 6. 模型迁移代码暴露了 Anthropic 的版本节奏

`migrations/` 目录记录了模型切换历史：
- `migrateFennecToOpus` — Fennec 是 Opus 的内部代号
- `migrateLegacyOpusToCurrent`
- `migrateOpusToOpus1m` — Opus 1M 上下文
- `migrateSonnet1mToSonnet45` — Sonnet 4.5
- `migrateSonnet45ToSonnet46` — Sonnet 4.6

### 7. KAIROS — Anthropic 的下一步

KAIROS 是 Claude Code 内部的**助手模式**，Feature Flag `KAIROS` 控制了大量代码路径：
- 后台持续运行
- 推送通知（`PushNotificationTool`）
- 文件发送（`SendUserFileTool`）
- 会话记忆
- 简要模式（BriefTool）
- GitHub Webhook 订阅

这暗示 Anthropic 正在把 Claude Code 从"被动 CLI 工具"进化为"**主动 AI 助手**"——一个始终在线、主动工作的编程伙伴。

### 8. 上下文管理是核心竞争力

Claude Code 在上下文管理上投入了大量工程：
- 多层压缩策略（compact → micro-compact → API micro-compact）
- 文件状态缓存（避免重复读取）
- 会话记忆与自动记忆提取
- 上下文折叠（CONTEXT_COLLAPSE flag）
- 历史裁剪（HISTORY_SNIP flag）

这说明在长对话场景下，**如何在有限上下文窗口里保持最相关的信息**是最大的工程挑战。

### 9. "允许一次" vs "永久允许" 的规则存储

用户在权限弹窗点"Yes, always allow"时，会将规则写入持久化配置（`.claude/settings.json` 或用户级配置）。规则建议由 `getSimpleCommandPrefix()` 生成——倾向于建议 `git commit:*` 而非精确命令，平衡安全与便利。

化合物命令（`&&` 链）最多建议 5 条规则（`MAX_SUGGESTED_RULES_FOR_COMPOUND = 5`），防止单次操作保存过多权限。

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

**BashTool 安全模型对比**：

| 维度 | Claude Code BashTool | OpenClaw exec tool |
|------|---------------------|-------------------|
| 安全检查层数 | 5 层（mode → deny → syntax → semantic → sandbox） | exec allowlist（单层） |
| Parser 分析 | tree-sitter AST + shell-quote 双引擎 | shell 直接执行 |
| 沙箱 | macOS sandbox-exec，Linux namespace | 无（依赖 allowlist） |
| 规则系统 | 通配符 `Bash(cmd:*)` + 精确匹配 | 命令级 allowlist |
| 自动审批 | 分类器（实验性） | 无 |
| 破坏性警告 | 独立模块，15 种模式 | 无 |

OpenClaw 的安全模型更简单——exec allowlist 是白名单制（不在列表的默认拒绝），而 Claude Code 是黑名单+规则制（默认允许，通过检查过滤）。两种思路各有取舍：**Claude Code 面向通用编程任务（必须足够灵活），OpenClaw 面向受控自动化（可以足够严格）**。

---

## 参考资源

- [泄露事件原推](https://x.com/Fried_rice/status/2038894956459290963) — @Fried_rice
- [GitHub 仓库](https://github.com/instructkr/claude-code) — instructkr/claude-code
- [Ink — React for CLI](https://github.com/vadimdemedes/ink)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Bun 文档](https://bun.sh/docs)
