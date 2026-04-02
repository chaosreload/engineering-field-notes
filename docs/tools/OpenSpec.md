# OpenSpec Getting Started

> 整理日期：2026-04-02
> 仓库地址：https://github.com/Fission-AI/OpenSpec

## 项目简介

OpenSpec 是一个 **AI 原生的规范驱动开发框架**。核心理念：在 AI 编码助手写代码之前，先和它对齐"要做什么"。它提供一套轻量的 spec 层（规范层），让人和 AI 在 proposal → specs → design → tasks → implement → archive 的流程中协作，避免"需求全在聊天记录里"导致的不可预测结果。

**一句话总结**：给 AI coding agent 加一个"需求文档管理系统"，用 slash command 驱动，spec 就是 source of truth。

### 核心哲学

```
→ fluid not rigid        — 没有严格的阶段门，按需工作
→ iterative not waterfall — 边做边学，边学边改
→ easy not complex        — 轻量设置，零仪式感
→ brownfield-first        — 为改造现有系统优化，不只服务新项目
```

### 适用场景

- 用 Claude Code / Cursor / Copilot 等 AI 编码工具做中大型功能开发
- 团队需要在 AI 辅助开发中保持需求可追溯
- 想要"先对齐 spec 再写代码"的工作流
- 并行开发多个功能时需要隔离变更

## 项目结构

```
OpenSpec/
├── src/
│   ├── cli/index.ts                    # CLI 入口（openspec 命令）
│   ├── commands/                       # CLI 子命令
│   │   ├── workflow/                   # 工作流命令（new, status, instructions 等）
│   │   ├── change.ts                   # change 管理
│   │   ├── config.ts                   # 配置管理
│   │   ├── spec.ts                     # spec 操作
│   │   └── validate.ts                 # 验证
│   ├── core/
│   │   ├── artifact-graph/             # ⭐ 核心：Artifact 依赖图
│   │   │   ├── graph.ts                # DAG 图 + 拓扑排序（Kahn's algorithm）
│   │   │   ├── resolver.ts             # 依赖解析器
│   │   │   ├── schema.ts               # Schema YAML 加载/解析
│   │   │   ├── state.ts                # 完成状态跟踪
│   │   │   └── instruction-loader.ts   # Artifact 模板加载
│   │   ├── command-generation/         # ⭐ 核心：多工具 Adapter
│   │   │   ├── adapters/               # 25+ AI 工具适配器
│   │   │   │   ├── claude.ts           # Claude Code
│   │   │   │   ├── cursor.ts           # Cursor
│   │   │   │   ├── github-copilot.ts   # GitHub Copilot
│   │   │   │   ├── windsurf.ts         # Windsurf
│   │   │   │   └── ...                 # Amazon Q, Gemini, Kiro, Codex, etc.
│   │   │   ├── generator.ts            # 命令文件生成器
│   │   │   └── registry.ts             # 工具注册表
│   │   ├── templates/workflows/        # Slash command 工作流模板
│   │   │   ├── propose.ts              # /opsx:propose 模板
│   │   │   ├── apply-change.ts         # /opsx:apply 模板
│   │   │   ├── archive-change.ts       # /opsx:archive 模板
│   │   │   └── ...
│   │   ├── parsers/                    # Markdown 解析器
│   │   │   ├── change-parser.ts        # Change 文件夹解析
│   │   │   ├── markdown-parser.ts      # Markdown 结构解析
│   │   │   └── requirement-blocks.ts   # Requirement/Scenario 提取
│   │   ├── schemas/                    # JSON Schema 验证
│   │   ├── profiles.ts                 # Profile 管理（core / expanded）
│   │   ├── config.ts                   # 项目配置
│   │   ├── init.ts                     # openspec init 逻辑
│   │   ├── update.ts                   # openspec update 逻辑
│   │   └── archive.ts                  # Change 归档逻辑
│   ├── telemetry/                      # 匿名使用统计
│   ├── ui/                             # 欢迎界面 + ASCII art
│   └── utils/                          # 文件系统、Shell 检测等工具
├── openspec/                           # OpenSpec 自己吃自己的狗粮（self-hosted changes）
│   ├── specs/                          # 主 spec（source of truth）
│   └── changes/                        # 活跃的变更
├── docs/                               # 文档
├── bin/openspec.js                     # CLI 入口脚本
├── build.js                            # 构建脚本（esbuild）
└── package.json                        # npm 包：@fission-ai/openspec
```

## 核心架构

### 1. Artifact 依赖图（ArtifactGraph）

OpenSpec 的工作流引擎基于一个 **DAG（有向无环图）**，定义 artifact 之间的依赖关系：

```
          proposal
         (root node)
              │
    ┌─────────┴─────────┐
    │                   │
    ▼                   ▼
  specs              design
(requires:         (requires:
 proposal)          proposal)
    │                   │
    └─────────┬─────────┘
              │
              ▼
           tasks
       (requires:
       specs, design)
```

实现在 `src/core/artifact-graph/graph.ts`，使用 **Kahn's algorithm** 做拓扑排序：
- `getBuildOrder()` — 计算完整的构建顺序
- `getNextArtifacts(completed)` — 给定已完成集合，返回当前可创建的 artifact
- `getBlocked(completed)` — 返回被阻塞的 artifact 及其未满足的依赖

这个图是**声明式的**——Schema YAML 定义 artifact 和依赖，图自动计算执行顺序。

### 2. 多工具适配器（Command Generation）

OpenSpec 支持 **25+ AI 编码工具**，通过适配器模式实现：

```
openspec init → 检测/选择工具 → 适配器生成对应文件

Claude Code  → .claude/skills/openspec-*/SKILL.md + .claude/commands/opsx/*.md
Cursor       → .cursor/skills/openspec-*/SKILL.md + .cursor/commands/opsx-*.md
Copilot      → .github/skills/openspec-*/SKILL.md + .github/prompts/opsx-*.prompt.md
Windsurf     → .windsurf/skills/openspec-*/SKILL.md + .windsurf/workflows/opsx-*.md
...
```

每个适配器实现 `ToolAdapter` 接口：
- `getSkillPath(workflowId)` — 返回 skill 文件的安装路径
- `getCommandPath(workflowId)` — 返回 command 文件的安装路径
- `generateCommand(workflow)` — 生成工具特定格式的命令文件

### 3. Delta Spec（增量规范）

这是 OpenSpec 最有价值的设计——用 **ADDED / MODIFIED / REMOVED** 三种操作描述变更，而不是重写整个 spec：

```markdown
# Delta for Auth

## ADDED Requirements
### Requirement: Two-Factor Authentication
The system MUST support TOTP-based 2FA.

## MODIFIED Requirements
### Requirement: Session Expiration
The system MUST expire sessions after 15 minutes. (Previously: 30 minutes)

## REMOVED Requirements
### Requirement: Remember Me
(Deprecated in favor of 2FA)
```

归档（archive）时，delta 自动合并到主 spec：
- ADDED → 追加到主 spec
- MODIFIED → 替换对应 requirement
- REMOVED → 从主 spec 删除

这种设计让**多个变更可以并行**——只要修改不同的 requirement，就不会冲突。

### 4. 工作流（Slash Commands）

OpenSpec 的用户界面是 **slash commands**，在 AI 编码助手的聊天界面中使用：

| 命令 | 作用 | 工作流阶段 |
|------|------|-----------|
| `/opsx:propose` | 创建变更 + 一次性生成所有规划 artifact | 启动 |
| `/opsx:explore` | 探索性思考，不创建 artifact | 前期调研 |
| `/opsx:new` | 创建变更脚手架 | 启动（精细控制） |
| `/opsx:continue` | 创建下一个可用的 artifact | 逐步规划 |
| `/opsx:ff` | 快进：一次创建所有规划 artifact | 快速规划 |
| `/opsx:apply` | 执行 tasks.md 中的任务 | 实现 |
| `/opsx:verify` | 验证实现是否匹配 spec | 质量检查 |
| `/opsx:sync` | 将 delta spec 合并到主 spec | 同步 |
| `/opsx:archive` | 归档完成的变更 | 收尾 |

完整流程：
```
/opsx:propose → AI 生成 proposal + specs + design + tasks
/opsx:apply   → AI 按 tasks 逐条实现代码
/opsx:archive → delta spec 合并到主 spec，变更归档
```

### 5. 文件夹即变更（Change as Folder）

每个变更是一个独立文件夹：

```
openspec/changes/add-dark-mode/
├── proposal.md        # 为什么要做 + 范围
├── specs/             # Delta spec（增量规范）
│   └── ui/spec.md
├── design.md          # 技术方案
├── tasks.md           # 实现检查清单（checkbox）
└── .openspec.yaml     # 元数据（schema、创建时间）
```

好处：
- **自包含**：所有上下文在一个地方
- **并行**：多个 change 同时存在互不干扰
- **可审计**：归档后保留完整历史

## 部署步骤

### 安装

```bash
# 全局安装（推荐）
npm install -g @fission-ai/openspec@latest

# 需要 Node.js >= 20.19.0
```

### 初始化项目

```bash
cd your-project
openspec init
# 交互式选择要支持的 AI 工具（Claude Code, Cursor, Copilot 等）
```

### 开始使用

在 AI 编码助手中输入：
```
/opsx:propose add-user-authentication
```

AI 会在 `openspec/changes/add-user-authentication/` 下生成完整的规划文档。

### 从源码构建

```bash
git clone https://github.com/Fission-AI/OpenSpec.git
cd OpenSpec
pnpm install
pnpm run build
# ✅ Build completed successfully!
```

## Demo 示例

### 典型工作流

```
You: /opsx:propose add-dark-mode
AI:  Created openspec/changes/add-dark-mode/
     ✓ proposal.md — why we're doing this, what's changing
     ✓ specs/       — requirements and scenarios
     ✓ design.md    — technical approach
     ✓ tasks.md     — implementation checklist
     Ready for implementation!

You: /opsx:apply
AI:  Implementing tasks...
     ✓ 1.1 Add theme context provider
     ✓ 1.2 Create toggle component
     ✓ 2.1 Add CSS variables
     ✓ 2.2 Wire up localStorage
     All tasks complete!

You: /opsx:archive
AI:  Archived to openspec/changes/archive/2025-01-23-add-dark-mode/
     Specs updated. Ready for the next feature.
```

## 关键发现 / 学习心得

### 1. 解决了 AI 编码的核心痛点

AI coding agent 最大的问题不是代码质量，而是**需求模糊**——聊天记录里的零散指令很容易让 AI 跑偏。OpenSpec 用结构化的 spec 文件解决这个问题，让 AI 在动手前先"签合同"。

### 2. Delta Spec 是最精妙的设计

大多数 spec 工具只支持"写全量"，OpenSpec 的 ADDED/MODIFIED/REMOVED 增量模式完美适配 brownfield（改造现有系统）场景。这和 Git 的 diff 理念一脉相承——只描述变化，不重复已有内容。

### 3. Artifact Graph 的声明式依赖

用 Kahn's algorithm 做拓扑排序来驱动工作流——你声明 "tasks depends on specs and design"，框架自动算出创建顺序。这种设计让用户可以自定义 schema（比如先 research 再 proposal），灵活度很高。

### 4. 25+ 工具适配器的工程量惊人

OpenSpec 支持 Claude Code、Cursor、Copilot、Windsurf、Gemini CLI、Amazon Q、Kiro、Cline 等 25+ 工具。每个工具的 skill/command 文件格式都不同，项目为每个工具维护一个适配器。这既是壁垒也是维护负担。

### 5. 与竞品对比

| 维度 | OpenSpec | Spec Kit (GitHub) | Kiro (AWS) |
|------|---------|-------------------|------------|
| 工作流 | Fluid，无阶段门 | Rigid 阶段门 | IDE 内置 |
| 工具锁定 | 无，25+ 工具 | Python + 特定工具 | 锁定 Kiro IDE + Claude |
| 变更模型 | Delta spec（增量）| 全量 spec | Spec 文件 |
| 安装 | `npm install -g` | Python setup | 开箱即用 |
| 适合场景 | 多工具团队 | GitHub 生态 | Kiro 用户 |

### 6. 值得注意的局限

- **依赖 AI 理解 slash command**：如果 AI 不认识 `/opsx:propose`，整个工作流就断了
- **Spec 质量取决于 AI 能力**：低质量模型生成的 spec 可能反而增加噪音
- **推荐 Opus 4.5 / GPT 5.2**：项目明确建议用高推理能力模型

## 技术栈

- **语言**: TypeScript (ESM)
- **运行时**: Node.js >= 20.19.0
- **构建**: esbuild (via build.js)
- **包管理**: pnpm
- **发布**: npm (@fission-ai/openspec)
- **测试**: pnpm test
- **CI/CD**: GitHub Actions

## 参考资源

- [GitHub 仓库](https://github.com/Fission-AI/OpenSpec)
- [Getting Started](https://github.com/Fission-AI/OpenSpec/blob/main/docs/getting-started.md)
- [Concepts（核心概念）](https://github.com/Fission-AI/OpenSpec/blob/main/docs/concepts.md)
- [Commands（命令参考）](https://github.com/Fission-AI/OpenSpec/blob/main/docs/commands.md)
- [Supported Tools（25+ 工具列表）](https://github.com/Fission-AI/OpenSpec/blob/main/docs/supported-tools.md)
- [Discord 社区](https://discord.gg/YctCnvvshC)
- [@0xTab on X](https://x.com/0xTab)
