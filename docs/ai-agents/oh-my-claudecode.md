# oh-my-claudecode Getting Started

> 整理日期：2026-04-04
> 仓库地址：https://github.com/Yeachan-Heo/oh-my-claudecode
> Stars：23.1k ⭐ | Forks：2068 | 语言：TypeScript | 协议：MIT

## 项目简介

oh-my-claudecode（OMC）是一个为 [Claude Code](https://docs.anthropic.com/claude-code) 打造的**多 Agent 编排框架**。它的核心理念是"零学习曲线"——你不需要记命令，用自然语言描述任务，OMC 自动把任务拆解、分配给专业化的 Agent、并行执行、验证完成。

一句话总结：**把单个 Claude Code 变成一支 19 人的 AI 开发团队。**

### 解决什么问题

Claude Code 本身是一个强大的 AI 编程助手，但它是单线程的——一次只做一件事。当你面对大型项目时：

- 要改 20 个文件？一个一个来，效率低
- 需要代码审查 + 安全审查 + 测试？手动切换上下文
- 想同时用 Codex 和 Gemini 交叉验证？没有现成方案

OMC 把这些编排逻辑自动化了。你说 `autopilot: build a REST API`，它自动走完 分析→规划→实现→验证→修复 的全流程。

### 适合什么场景

- 中大型项目的功能开发（多文件变更）
- 需要多角度审查的场景（安全+代码质量+架构）
- 团队开发中需要标准化 AI 工作流的场景
- 想要同时利用 Claude + Codex + Gemini 三种 AI 能力的场景

## 项目结构

```
oh-my-claudecode/
├── src/                    # 核心源码（TypeScript）
│   ├── agents/             # Agent 定义和提示词
│   ├── skills/             # Skill 系统（行为注入）
│   ├── hooks/              # Claude Code 生命周期钩子
│   ├── team/               # Team 模式（多 Agent 协作）
│   ├── features/           # 核心功能模块
│   │   ├── magic-keywords.js   # 魔法关键词检测
│   │   ├── continuation-enforcement.js  # 持续执行保障
│   │   └── background-tasks.js  # 后台任务管理
│   ├── hud/                # HUD 状态栏
│   ├── mcp/                # MCP 服务器（工具暴露）
│   ├── openclaw/           # OpenClaw 集成
│   ├── planning/           # 规划系统
│   ├── verification/       # 验证协议
│   ├── notifications/      # 通知系统（Telegram/Discord/Slack）
│   ├── cli/                # CLI 入口
│   ├── config/             # 配置加载
│   ├── tools/              # LSP/AST 工具
│   └── providers/          # 外部 AI 提供商集成
├── agents/                 # 19 个 Agent 的 prompt 定义（.md 文件）
├── skills/                 # 35+ 个 Skill 定义
├── hooks/                  # hooks.json（生命周期钩子注册）
├── bridge/                 # 运行时桥接（cli.cjs, mcp-server.cjs）
├── scripts/                # 钩子脚本（keyword-detector, persistent-mode 等）
├── .claude-plugin/         # Claude Code 插件元数据
│   ├── plugin.json         # 插件声明
│   └── marketplace.json    # 市场发布信息
└── .mcp.json               # MCP 服务器配置
```

## 核心架构

OMC 的架构由四个互锁系统组成：

```
用户输入 → Hooks（事件检测）→ Skills（行为注入）→ Agents（任务执行）→ State（进度追踪）
```

### 架构全景图

```
┌─────────────────────────────────────────────────────────┐
│                    OH-MY-CLAUDECODE                       │
│                  Intelligent Skill Activation              │
└─────────────────────────────────────────────────────────┘

  用户输入                    Skill 检测                  执行
  ────────                    ─────────                  ────
       │                          │                        │
       ▼                          ▼                        ▼
┌─────────────┐          ┌──────────────────┐     ┌─────────────────┐
│ "ultrawork  │          │   CLAUDE.md      │     │ SKILL 激活      │
│  refactor   │─────────▶│   自动路由       │────▶│                 │
│  the API"   │          │                  │     │ ultrawork +     │
└─────────────┘          │ 任务类型:        │     │ default +       │
                         │  - 多文件实现     │     │ git-master      │
                         │  - 可并行化       │     │                 │
                         │                  │     │ → 并行 Agent    │
                         │ 匹配 Skills:     │     │ → 原子提交      │
                         │  - ultrawork ✓   │     └─────────────────┘
                         │  - default ✓     │
                         │  - git-master ✓  │
                         └──────────────────┘
```

### 四大核心系统

#### 1. Hooks 系统（事件驱动）

OMC 注册了 Claude Code 的 **11 个生命周期事件**，通过 `hooks.json` 声明钩子脚本：

| 事件 | 触发时机 | OMC 用途 |
|------|---------|---------|
| `UserPromptSubmit` | 用户提交 prompt | **魔法关键词检测** + Skill 注入 |
| `SessionStart` | 会话开始 | 初始化设置，加载项目记忆 |
| `PreToolUse` | 工具调用前 | 权限验证，并行执行提示 |
| `PostToolUse` | 工具调用后 | 结果验证，项目记忆更新 |
| `SubagentStart/Stop` | 子 Agent 启停 | Agent 追踪和输出验证 |
| `PreCompact` | 上下文压缩前 | **保存关键信息到 notepad** |
| `Stop` | Claude 即将停止 | **持久模式强制继续**（ralph 核心） |
| `SessionEnd` | 会话结束 | 清理和数据保存 |

关键设计：Hook 通过 `<system-reminder>` 标签向 Claude 注入额外上下文，比如检测到 `ralph` 关键词后注入 `"The boulder never stops"`，让 Claude 进入持续执行模式。

#### 2. Skills 系统（行为注入）

Skills 是 OMC 的行为层，**不替换 Agent，而是在现有 Agent 上叠加能力**。三层堆叠设计：

```
┌─────────────────────────────────────────────┐
│  保障层（可选）                                │
│  ralph: "不验证通过就不停止"                    │
├─────────────────────────────────────────────┤
│  增强层（0-N 个）                              │
│  ultrawork（并行）| git-master（提交）| ...     │
├─────────────────────────────────────────────┤
│  执行层（主 Skill）                            │
│  default（构建）| orchestrate（协调）| plan ... │
└─────────────────────────────────────────────┘
```

**公式**：`[执行 Skill] + [0-N 增强] + [可选保障]`

项目内置 35+ 个 Skill，核心的包括：

| Skill | 功能 | 触发方式 |
|-------|------|---------|
| `autopilot` | 全自主 5 阶段流水线 | `autopilot build me a...` |
| `ralph` | 循环执行直到验证通过 | `ralph: refactor auth` |
| `ultrawork` | 最大并行度 | `ulw fix all errors` |
| `team` | N 个 Claude Agent 协作 | `/team 3:executor "..."` |
| `ccg` | Claude+Codex+Gemini 三模型 | `/ccg review this PR` |
| `ralplan` | 迭代规划达成共识 | `ralplan this feature` |
| `deep-interview` | 苏格拉底式需求澄清 | `deep-interview "vague idea"` |
| `learner` | 从会话中提取可复用模式 | `/learner` |

#### 3. Agent 系统（19 个专业化 Agent）

按四条车道组织，每个 Agent 有明确的职责边界和默认模型：

**Build/Analysis 车道**（开发生命周期）：

| Agent | 模型 | 职责 |
|-------|------|------|
| `explore` | Haiku | 代码发现，文件/符号映射 |
| `analyst` | Opus | 需求分析，发现隐藏约束 |
| `planner` | Opus | 任务排序，创建执行计划 |
| `architect` | Opus | 系统设计，接口定义，权衡分析 |
| `debugger` | Sonnet | 根因分析，构建错误修复 |
| `executor` | Sonnet | **代码实现，重构**（核心） |
| `verifier` | Sonnet | 完成验证，测试充分性确认 |
| `tracer` | Sonnet | 证据驱动的因果追踪 |

**Review 车道**（质量门禁）：`security-reviewer`（Sonnet）+ `code-reviewer`（Opus）

**Domain 车道**（领域专家）：`test-engineer`, `designer`, `writer`, `qa-tester`, `scientist`, `git-master`, `document-specialist`, `code-simplifier`

**Coordination 车道**：`critic`（Opus）— 挑战其他 Agent 的计划和设计

**智能模型路由**：简单任务用 Haiku（便宜快速），标准实现用 Sonnet，复杂推理用 Opus。这套路由节省 30-50% 的 token 成本。

典型工作流：
```
explore → analyst → planner → critic → executor → verifier
(发现)    (分析)    (排序)    (审查)    (实现)     (确认)
```

#### 4. State 系统（跨上下文持久化）

核心问题：Claude Code 的上下文窗口会被压缩（compact），压缩后之前的信息就丢了。OMC 通过 `.omc/` 目录解决这个问题：

```
.omc/
├── state/                    # 各模式的状态文件
│   ├── autopilot-state.json
│   ├── ralph-state.json
│   └── sessions/{sessionId}/ # 每会话隔离状态
├── notepad.md                # 上下文压缩后仍保留的备忘录
├── project-memory.json       # 项目知识库（跨会话持久化）
├── plans/                    # 执行计划
├── notepads/{plan-name}/     # 每计划知识捕获
│   ├── learnings.md
│   ├── decisions.md
│   └── issues.md
└── research/                 # 研究结果
```

关键机制：
- **Notepad**：在 `PreCompact` 事件时自动保存关键信息，压缩后重新注入上下文
- **Project Memory**：跨会话的项目知识，自动从工具结果中提取并保存
- **`<remember>` 标签**：`<remember>` 保留 7 天，`<remember priority>` 永久保留

### 插件集成方式

OMC 作为 Claude Code Plugin 运行，通过两个入口集成：

1. **MCP Server**（`.mcp.json`）：暴露 LSP、AST、Notepad 等工具给 Claude
2. **Hooks**（`hooks.json`）：注册生命周期钩子脚本

安装后，OMC 不改变 Claude Code 的使用方式，而是在背后自动增强它。

## 核心工作流程

### autopilot 模式（全自主）

用户说 `autopilot: build a REST API for tasks`，OMC 自动执行 5 个阶段：

```
Stage 1: analyst → 需求分析，发现隐藏约束
Stage 2: planner → 创建任务排序和执行计划
Stage 3: executor (× N, 并行) → 代码实现
Stage 4: verifier → 验证完成（BUILD/TEST/LINT/FUNCTIONALITY）
Stage 5: debugger → 修复问题 → 回到 Stage 4（循环直到通过）
```

### team 模式（多 Agent 协作）

```bash
/team 3:executor "implement fullstack todo app"
```

启动 3 个 executor Agent 并行工作，执行流水线：
```
team-plan → team-prd → team-exec → team-verify → team-fix (loop)
```

v4.4.0 起支持跨 AI 提供商的 tmux CLI Workers：
```bash
omc team 2:codex "security review"     # 启动 2 个 Codex 工作进程
omc team 2:gemini "UI accessibility"   # 启动 2 个 Gemini 工作进程
omc team 1:claude "payment flow"       # 启动 1 个 Claude 工作进程
```

### ralph 模式（不完成不停止）

```bash
ralph: refactor the authentication module
```

关键机制：Hook 在 `Stop` 事件时检查任务是否真正完成，如果没有，注入 `"The boulder never stops"` 强制 Claude 继续工作。

### 验证协议

每次任务完成，verifier 执行 7 项检查：

| 检查项 | 内容 |
|--------|------|
| BUILD | 编译通过 |
| TEST | 所有测试通过 |
| LINT | 无 lint 错误 |
| FUNCTIONALITY | 功能按预期工作 |
| ARCHITECT | Opus 级别架构审查 |
| TODO | 所有 TodoWrite 项已完成 |
| ERROR_FREE | 无未解决错误 |

证据必须是 5 分钟内的新鲜输出，不能"假设通过"。

## 安装部署

### 方式一：Claude Code Plugin（推荐）

```bash
# 在 Claude Code 中执行
/plugin marketplace add https://github.com/Yeachan-Heo/oh-my-claudecode
/plugin install oh-my-claudecode

# 初始化
/setup
```

### 方式二：npm 全局安装

```bash
npm i -g oh-my-claude-sisyphus@latest

# CLI 命令
omc team 3:executor "fix all errors"
omc wait --start    # 速率限制自动恢复
omc hud             # 实时状态面板
```

> **注意**：npm 包名是 `oh-my-claude-sisyphus`，不是 `oh-my-claudecode`。

### 前提条件

- Claude Code CLI 已安装
- Claude Max/Pro 订阅 或 Anthropic API Key
- tmux（Team 模式和速率限制检测需要）

### 可选：多 AI 编排

| 提供商 | 安装 | 用途 |
|--------|------|------|
| Gemini CLI | `npm i -g @google/gemini-cli` | 设计审查、UI 一致性（1M token 上下文） |
| Codex CLI | `npm i -g @openai/codex` | 架构验证、代码审查交叉检查 |

三个 Pro 计划（Claude + Gemini + ChatGPT）合计 ~$60/月。

## 自定义 Skill

OMC 支持从实战中提取可复用的 Skill：

```yaml
# .omc/skills/fix-proxy-crash.md
---
name: Fix Proxy Crash
description: aiohttp proxy crashes on ClientDisconnectedError
triggers: ["proxy", "aiohttp", "disconnected"]
source: extracted
---
Wrap handler at server.py:42 in try/except ClientDisconnectedError...
```

- **项目级**：`.omc/skills/`（团队共享，版本控制）
- **用户级**：`~/.omc/skills/`（所有项目共用）
- 项目级优先级更高
- `/learner` 自动从会话中提取模式

## OpenClaw 集成

OMC 可以将 Claude Code 会话事件转发到 OpenClaw Gateway：

```bash
/oh-my-claudecode:configure-notifications
# → 选择 "openclaw" → "OpenClaw Gateway"
```

支持 6 个钩子事件：`session-start`, `stop`, `keyword-detector`, `ask-user-question`, `pre-tool-use`, `post-tool-use`。

## 关键发现 / 学习心得

### 1. 设计哲学：Skill 叠加 > Agent 替换

OMC 最聪明的设计是 **Skill 不替换 Agent，而是叠加行为**。这意味着你可以组合任意 Skill，比如 `ralph + ultrawork + git-master` = 并行执行 + 不完成不停 + 自动提交。这种组合爆炸式的灵活性来自简单的三层架构。

### 2. Hook 系统是核心创新

Claude Code 的 Hook 系统（生命周期事件）是整个 OMC 的基石。特别是：
- **`Stop` 事件 + persistent-mode** = ralph 的"永不停止"能力
- **`UserPromptSubmit` + keyword-detector** = 零学习曲线的魔法关键词
- **`PreCompact` + notepad** = 跨上下文记忆

这些 Hook 的组合让 Claude Code 从一个工具变成了一个可编程的 AI 运行时。

### 3. 模型路由的经济学

三层模型路由（Haiku/Sonnet/Opus）不只是技术选择，更是经济决策。explore 和 writer 用 Haiku，executor 用 Sonnet，architect/planner/critic 用 Opus——在保证质量的前提下节省 30-50% token 成本。

### 4. 与 oh-my-codex 的关系

同一作者（Yeachan Heo）同时维护 [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex)（给 OpenAI Codex 的类似框架），说明多 Agent 编排是一个跨平台的通用需求，不绑定特定 AI 提供商。

### 5. 验证协议的务实设计

要求"5 分钟内的新鲜输出"作为验证证据，这个细节很关键——防止 Agent 用缓存的旧结果"假装"通过验证。

## 与同类项目对比

| 项目 | 定位 | 差异 |
|------|------|------|
| [Superpowers](https://github.com/obra/superpowers) | Claude Code 增强 | 功能增强为主，非多 Agent 编排 |
| [everything-claude-code](https://github.com/affaan-m/everything-claude-code) | 资源集合 | 信息整合，非工具 |
| [Ouroboros](https://github.com/Q00/ouroboros) | 自我改进循环 | 单 Agent 迭代，非多 Agent 并行 |
| OMC | **多 Agent 编排框架** | 19 Agent + Skill 叠加 + 三模型路由 |

## 参考资源

- [官方文档](https://yeachan-heo.github.io/oh-my-claudecode-website)
- [CLI 参考](https://yeachan-heo.github.io/oh-my-claudecode-website/docs.html#cli-reference)
- [架构文档](https://github.com/Yeachan-Heo/oh-my-claudecode/blob/main/docs/ARCHITECTURE.md)
- [Migration Guide](https://github.com/Yeachan-Heo/oh-my-claudecode/blob/main/docs/MIGRATION.md)
- [Discord 社区](https://discord.gg/PUwSMR9XNk)
- [npm 包](https://www.npmjs.com/package/oh-my-claude-sisyphus)（注意包名与仓库名不同）
