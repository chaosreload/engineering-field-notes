# claude-howto Getting Started

> 整理日期：2026-04-04
> 仓库地址：https://github.com/luongnv89/claude-howto
> Stars：5,900+ | Forks：690+ | License：MIT | 版本：v2.2.0

## 项目简介

**claude-howto** 是一份结构化的 Claude Code 进阶指南，由越南开发者 [luongnv89](https://github.com/luongnv89) 维护。它解决了一个真实痛点：**Claude Code 官方文档告诉你"有什么功能"，但不告诉你"怎么组合使用"。**

与官方文档的差异：

| | 官方文档 | claude-howto |
|--|---------|-------------|
| 格式 | API 参考风格 | 带 Mermaid 图的可视化教程 |
| 深度 | 功能描述 | 底层原理 + 生产级模板 |
| 结构 | 按功能分类 | 渐进式学习路径（入门→高级） |
| 自测 | 无 | 内置 `/self-assessment` + `/lesson-quiz` |

**适合谁**：已安装 Claude Code，想从"会聊天"进化到"能编排 Agent + Hook + MCP 自动化流水线"的开发者。

## 项目结构

```
claude-howto/
├── 01-slash-commands/      # 模块1：斜杠命令（55+ 内置 + 自定义）
├── 02-memory/              # 模块2：持久化记忆（CLAUDE.md 层级体系）
├── 03-skills/              # 模块3：Agent Skills（自动触发的可复用能力）
├── 04-subagents/           # 模块4：子Agent（隔离上下文的专业助手）
├── 05-mcp/                 # 模块5：MCP 协议（外部工具/API 接入）
├── 06-hooks/               # 模块6：Hook 事件驱动（25 种事件 × 4 种类型）
├── 07-plugins/             # 模块7：插件（打包发布的完整方案）
├── 08-checkpoints/         # 模块8：检查点与回退
├── 09-advanced-features/   # 模块9：高级功能（Planning/Auto Mode/Voice 等）
├── 10-cli/                 # 模块10：CLI 完整参考
├── CATALOG.md              # 全功能目录（117 个组件速查表）
├── LEARNING-ROADMAP.md     # 学习路线图（分三级，带时间估算）
├── QUICK_REFERENCE.md      # 快速参考卡片
├── claude_concepts_guide.md # 核心概念指南
├── scripts/                # 工具脚本（EPUB 生成等）
├── slides/                 # 演示幻灯片
└── resources/              # Logo、设计系统
```

每个模块目录包含：
- `README.md` — 完整教程（含 Mermaid 架构图）
- 示例文件 — 可直接复制到项目中使用的模板

## 核心架构：10 模块渐进式体系

claude-howto 把 Claude Code 的能力拆成 **10 个模块**，按依赖关系排序，形成三级学习路径：

```
Level 1（入门，~3h）          Level 2（进阶，~5h）          Level 3（高级，~5h）
┌─────────────────┐     ┌─────────────────────┐     ┌──────────────────────┐
│ 1. Slash Commands│     │ 5. Skills           │     │ 9. Advanced Features │
│ 2. Memory        │ ──→ │ 6. Hooks            │ ──→ │ 10. Plugins          │
│ 3. Checkpoints   │     │ 7. MCP              │     │ 11. CLI Mastery      │
│ 4. CLI Basics    │     │ 8. Subagents        │     │                      │
└─────────────────┘     └─────────────────────┘     └──────────────────────┘
```

### 核心模块速览

#### 1. Slash Commands — 入口

55+ 内置命令 + 5 个捆绑 Skill。自定义命令已合并到 Skills 体系，但 `.claude/commands/` 仍兼容。

关键命令：`/plan`（规划模式）、`/effort`（推理力度）、`/rewind`（回退检查点）、`/schedule`（定时任务）、`/voice`（语音输入）

#### 2. Memory — 跨会话记忆

三层记忆体系：
- **全局** `~/.claude/CLAUDE.md` → 个人偏好
- **项目** `./CLAUDE.md` → 团队标准（Git 版本控制）
- **目录** `src/api/CLAUDE.md` → 局部规则

快速更新：对话中以 `#` 开头写规则，自动追加到 CLAUDE.md。

#### 3. Skills — 自动触发的可复用能力

**渐进加载架构**是 Skills 的核心设计：

| 层级 | 加载时机 | Token 消耗 | 内容 |
|------|---------|-----------|------|
| Level 1：元数据 | 启动时总是加载 | ~100 tokens/Skill | name + description（YAML frontmatter） |
| Level 2：指令 | 触发时按需加载 | <5k tokens | SKILL.md 正文 |
| Level 3：资源 | 需要时按需加载 | 无上限 | 脚本、模板、文档 |

→ 安装再多 Skill 也不会吃满上下文窗口，这是其可扩展性的关键。

#### 4. Subagents — 隔离的专业 Agent

每个 Subagent 有独立上下文窗口、自定义 system prompt、工具权限控制。6 个内置 Agent：

| Agent | 用途 | 模型 |
|-------|------|------|
| general-purpose | 多步骤任务 | 继承 |
| Plan | 实现规划 | 继承 |
| Explore | 代码探索 | Haiku 4.5 |
| Bash | 命令执行 | 继承 |
| Claude Code Guide | 帮助文档 | Haiku 4.5 |

**关键配置字段**：`tools`（工具白名单）、`model`（模型选择）、`isolation: worktree`（Git 工作树隔离）、`memory`（持久记忆范围）、`background: true`（后台运行）

#### 5. MCP — 外部工具接入

支持 4 种传输协议：HTTP（推荐）、Stdio（本地）、WebSocket、SSE（已废弃）。

内置 OAuth 2.0 支持，Token 存储在系统钥匙串。常见集成：GitHub、PostgreSQL、Slack、Google Docs、文件系统。

#### 6. Hooks — 事件驱动自动化

**25 种事件** × **4 种 Hook 类型**：

| Hook 类型 | 说明 | 典型用途 |
|-----------|------|---------|
| Command | 执行 Shell 命令 | 代码格式化、安全扫描 |
| HTTP | POST 到 Webhook | 外部通知 |
| Prompt | LLM 评估 | 任务完成度检查 |
| Agent | 派子Agent 验证 | 架构合规检查 |

事件分类：Tool（PreToolUse/PostToolUse）、Session（Start/End）、Task（Submit/Completed）、Lifecycle（ConfigChange/FileChanged 等）

#### 7. Plugins — 打包发布

Plugin = Commands + Agents + MCP + Hooks + Skills 的完整打包。`/plugin install pr-review` 一键安装。支持 LSP 服务器配置。

#### 8-10. 高级功能

- **Checkpoints**：会话快照 + 回退，安全实验
- **Planning Mode**：两阶段（规划→执行），`opusplan` 模型别名（Opus 规划 + Sonnet 执行）
- **Auto Mode**（Research Preview）：后台安全分类器审查每个操作
- **6 种权限模式**：default → acceptEdits → plan → auto → dontAsk → bypassPermissions
- **Headless Mode**：`claude -p` 用于 CI/CD
- **Voice Dictation**：20 语言 STT
- **Channels**：MCP 服务器推送消息到运行中的会话
- **Remote Control**：从 claude.ai 远程控制本地 Claude Code
- **Sandboxing**：OS 级文件系统和网络隔离

## 使用方式

这不是一个需要部署的应用，而是一套 **copy-paste 模板库**：

```bash
# 克隆指南
git clone https://github.com/luongnv89/claude-howto.git
cd claude-howto

# 15 分钟快速上手：复制模板到你的项目
mkdir -p /your-project/.claude/commands
cp 01-slash-commands/*.md /your-project/.claude/commands/
cp 02-memory/project-CLAUDE.md /your-project/CLAUDE.md
cp -r 03-skills/code-review /your-project/.claude/skills/
cp 04-subagents/*.md /your-project/.claude/agents/

# 生成 EPUB 离线阅读
uv run scripts/build_epub.py
```

### 内置自测系统

在 Claude Code 中运行：
- `/self-assessment` — 评估你的 Claude Code 熟练度，生成个性化学习路径
- `/lesson-quiz hooks` — 完成 Hooks 模块后的知识测验

## 关键发现 / 学习心得

### 1. Skills 的渐进加载设计值得借鉴

claude-howto 最核心的洞察是 Skills 的三层渐进加载架构。启动时只加载 ~100 tokens 的元数据（name + description），真正触发时才加载指令（<5k tokens），需要资源时再按需读取。**这意味着你可以安装几十个 Skill 而不会吃满上下文窗口**。这个设计模式对我们的 OpenClaw Skill 体系也有参考价值。

### 2. Hook 系统比想象中强大

4 种 Hook 类型（Command/HTTP/Prompt/Agent）× 25 种事件 = 非常灵活的自动化能力。特别是 **Agent Hook**——可以派一个子 Agent 去做架构合规检查，这比简单的 Shell 脚本强大得多。

### 3. `opusplan` 模型别名是个聪明的设计

用 Opus 做规划（贵但聪明），用 Sonnet 做执行（便宜但够用），一个 flag 搞定成本优化：`claude --model opusplan "design and implement the API"`。

### 4. 与 OpenClaw 的对比

| 特性 | Claude Code | OpenClaw |
|------|------------|---------|
| Skills | SKILL.md（渐进加载） | SKILL.md（兼容，也支持渐进加载） |
| Memory | CLAUDE.md 三层 | MEMORY.md + memory/*.md |
| Subagents | .claude/agents/ | sessions_spawn |
| Hooks | 25 events × settings.json | Heartbeat + 事件系统 |
| MCP | 原生支持 | mcporter 集成 |
| Plugins | .claude-plugin/ | Skills + Extensions |

两者在 Skill 层面已经互通（AgentSkills 开放标准），但 Hook 和 Plugin 体系各有特色。

### 5. 这个项目的"产品化"做得好

不是简单的文档堆砌，而是：
- 有学习路径（三级分层 + 时间估算）
- 有自测系统（`/self-assessment` + `/lesson-quiz`）
- 有 EPUB 离线阅读
- 有 Feature Catalog（117 个组件的完整速查表）
- README 用 `<details>` 折叠避免信息过载

这套"教程产品化"的思路，对我们做 OpenClaw 文档也有参考价值。

## 参考资源

- [官方仓库](https://github.com/luongnv89/claude-howto) — 持续更新，跟进 Claude Code 每个版本
- [Claude Code 官方文档](https://code.claude.com/docs/en/overview) — 官方参考
- [AgentSkills 开放标准](https://agentskills.io) — Skills 互通标准
- [MCP 协议规范](https://modelcontextprotocol.io) — Model Context Protocol
- [Boris Cherny 的工作流](https://x.com/bcherny/status/2007179832300581177) — Claude Code 创造者分享的系统化工作流
- [作者 Medium 博客](https://medium.com/@luongnv89) — 更多实战文章
