# Claude Code Game Studios Getting Started

> 整理日期：2026-04-07
> 仓库地址：https://github.com/Donchitos/Claude-Code-Game-Studios
> Stars: 8,294 ⭐ | Forks: 1,258 | License: MIT

## 项目简介

Claude Code Game Studios 把一个 Claude Code 会话变成一个**完整的游戏开发工作室**。它不是一个运行时框架，而是一套**纯配置模板**（Markdown + Shell），通过 Claude Code 原生的 agents/skills/hooks/rules 系统，让 AI 按照真实游戏工作室的组织架构和协作流程来辅助独立开发者做游戏。

**核心数字**：48 个专业 Agent、37 个 Slash Command 工作流、8 个自动化 Hook、11 条路径级代码规范、29 个文档模板。

**适合谁**：想用 Claude Code 做独立游戏开发的人。不需要写代码，clone 下来用 `claude` 命令打开就行。

## 项目结构

```
CLAUDE.md                           # 主配置入口（~54 行）
.claude/
├── settings.json                   # Hooks、权限、安全规则
├── statusline.sh                   # 状态栏脚本（显示上下文占用、模型、开发阶段）
├── agents/          (48 个文件)     # Agent 定义（Markdown + YAML frontmatter）
├── skills/          (37 个目录)     # Slash Command 定义
├── hooks/           (8 个脚本)      # 自动化验证钩子
├── rules/           (11 个文件)     # 路径级编码标准
└── docs/                           # 参考文档 + 28 个模板
    └── templates/                  # GDD、ADR、Sprint Plan 等模板
```

**注意**：项目的 `src/`、`assets/`、`design/` 等目录是**占位空目录**，用于放你自己的游戏代码和资源。

## 核心架构

### 三层 Agent 层级（模拟真实工作室）

这是项目最核心的设计。48 个 Agent 按三层组织，每层用不同模型：

```
Tier 1 — 总监层（Opus，高推理）
  creative-director    → 创意愿景守护者，解决跨部门冲突
  technical-director   → 技术架构决策者
  producer             → 排期协调、风险管理、跨部门联动

Tier 2 — 部门主管（Sonnet）
  game-designer        art-director        narrative-director
  lead-programmer      audio-director      qa-lead
  release-manager      localization-lead

Tier 3 — 专家（Sonnet/Haiku，执行层）
  gameplay-programmer    engine-programmer     ai-programmer
  network-programmer     tools-programmer      ui-programmer
  systems-designer       level-designer        economy-designer
  technical-artist       sound-designer        writer
  world-builder          qa-tester             prototyper
  performance-analyst    devops-engineer       analytics-engineer
  security-engineer      accessibility-specialist
  live-ops-designer      community-manager
```

此外还有**引擎专家组**（按需选用一组）：

| 引擎 | 主 Agent | 子专家 |
|------|----------|--------|
| Godot 4 | `godot-specialist` | GDScript、Shaders、GDExtension |
| Unity | `unity-specialist` | DOTS/ECS、Shaders/VFX、Addressables、UI Toolkit |
| Unreal 5 | `unreal-specialist` | GAS、Blueprints、Replication、UMG/CommonUI |

### Agent 协作模型

```
垂直委派：总监 → 主管 → 专家（不跳级）
水平咨询：同级 Agent 可咨询，但不能做跨域绑定决策
冲突上报：设计冲突 → creative-director，技术冲突 → technical-director
变更传播：跨部门变更由 producer 协调
域边界：Agent 不修改域外文件（除非被显式委派）
```

### 协作而非自动驾驶（关键设计原则）

**这不是一个自动跑的系统。** 每个 Agent 遵循严格的协作协议：

1. **Ask** — 先提问，了解需求
2. **Present Options** — 给出 2-4 个方案 + 利弊分析
3. **You Decide** — 用户做决定
4. **Draft** — 展示草稿
5. **Approve** — 用户批准后才写文件

这意味着 **你始终掌控一切**，Agent 提供结构和专业能力，不是替你做主。

## 核心工作流程

### 新手入口：`/start`

`/start` 是整个系统的入口，它会先检测项目状态，然后问你在哪个阶段：

| 选项 | 你的状态 | 引导路径 |
|------|---------|---------|
| A | 完全没想法 | → `/brainstorm` 头脑风暴 → `/setup-engine` → `/prototype` |
| B | 有模糊概念 | → `/brainstorm [hint]` 发展概念 → `/setup-engine` |
| C | 有明确概念 | → `/setup-engine` → `/map-systems` → `/design-system` |
| D | 有现成代码 | → `/project-stage-detect` 分析现状 → 补缺 |

### 37 个 Slash Commands 分类

**评审类**：`/design-review` `/code-review` `/balance-check` `/asset-audit` `/scope-check` `/perf-profile` `/tech-debt`

**生产管理**：`/sprint-plan` `/milestone-review` `/estimate` `/retrospective` `/bug-report`

**项目管理**：`/start` `/project-stage-detect` `/reverse-document` `/gate-check` `/map-systems` `/design-system`

**发布类**：`/release-checklist` `/launch-checklist` `/changelog` `/patch-notes` `/hotfix`

**创意类**：`/brainstorm` `/playtest-report` `/prototype` `/onboard` `/localize`

**团队编排**（多 Agent 协作完成一个功能）：`/team-combat` `/team-narrative` `/team-ui` `/team-release` `/team-polish` `/team-audio` `/team-level`

### 团队编排工作流（`/team-*` 系列）

以 `/team-combat` 为例，它编排 6 个 Agent 走完完整的战斗功能开发流水线：

```
Phase 1: Design        → game-designer 写设计文档
Phase 2: Architecture   → gameplay-programmer + ai-programmer 设计代码架构
Phase 3: Implementation → 4 个 Agent 并行（程序/AI/美术/音效）
Phase 4: Integration    → 串联所有实现
Phase 5: Validation     → qa-tester 测试验证
Phase 6: Sign-off       → 汇总报告
```

**每个阶段转换都需要用户审批**，通过 `AskUserQuestion` 工具呈现选项。

### 8 个自动化 Hook

| Hook | 触发时机 | 功能 |
|------|---------|------|
| `session-start.sh` | 会话开始 | 加载 Sprint 上下文 + 最近 Git 活动 |
| `detect-gaps.sh` | 会话开始 | 检测新项目（建议 `/start`）、发现文档空缺 |
| `validate-commit.sh` | `git commit` | 检查硬编码值、TODO 格式、JSON 有效性、GDD 必要章节 |
| `validate-push.sh` | `git push` | 保护分支警告 |
| `validate-assets.sh` | 写 `assets/` 文件后 | 验证命名规范和 JSON 格式 |
| `pre-compact.sh` | 上下文压缩前 | 保留会话进度笔记 |
| `session-stop.sh` | 会话结束 | 记录完成事项 |
| `log-agent.sh` | 子 Agent 启动 | 审计所有子 Agent 调用 |

### 11 条路径级编码规范（Rules）

| 路径 | 强制执行 |
|------|---------|
| `src/gameplay/**` | 数据驱动、delta time、不引用 UI |
| `src/core/**` | 热路径零分配、线程安全、API 稳定性 |
| `src/ai/**` | 性能预算、可调试性、数据驱动参数 |
| `src/networking/**` | 服务器权威、版本化消息、安全 |
| `src/ui/**` | 不持有游戏状态、本地化就绪、无障碍 |
| `design/gdd/**` | 8 个必要章节、公式格式、边界情况 |
| `tests/**` | 测试命名、覆盖率要求、fixture 模式 |
| `prototypes/**` | 放宽标准，但必须有 README + 假设文档 |

### 状态栏（statusline.sh）

在 Claude Code 底部显示实时状态：
```
ctx: 45% | Claude 4 Sonnet | Pre-Production | Combat > Melee > Implement
```
包含：上下文占用百分比 | 当前模型 | 开发阶段 | 当前工作路径

## Agent 设计深度分析

### Agent 文件格式（YAML Frontmatter + Markdown）

每个 Agent 文件包含：

```yaml
---
name: creative-director
description: "..."
tools: Read, Glob, Grep, Write, Edit, WebSearch
model: opus              # 模型选择（opus/sonnet/haiku）
maxTurns: 30             # 最大对话轮数
memory: user             # 记忆模式
disallowedTools: Bash    # 总监不能执行命令
skills: [brainstorm, design-review]  # 可调用的 Skill
---
```

然后是详细的 System Prompt，包含：
- **协作协议**（Question → Options → Decision → Draft → Approval）
- **职责边界**（能做什么、不能做什么）
- **决策框架**（如 Creative Director 的 MDA Framework、Pillar Methodology）
- **委派地图**（能委派给谁、向谁上报）
- **输出格式**（文档模板）

### Creative Director 的设计理论基础

这是项目设计水平最高的体现——Creative Director Agent 内置了专业游戏设计理论：

- **MDA Framework**（Mechanics-Dynamics-Aesthetics）：分析游戏设计的三层模型
- **Self-Determination Theory**（自我决定理论）：Autonomy/Competence/Relatedness
- **Flow State**（心流理论）：挑战-技能平衡
- **Bartle Player Types**：玩家类型分析
- **Ludonarrative Consonance**：机制与叙事的一致性

这些不是装饰，而是 Agent 做决策的实际框架。比如砍需求时：
1. 先砍不服务任何 pillar 的功能
2. 再砍成本收益比低的
3. 简化（保留核心 20%）
4. 绝对保护的 = pillar 本身

## 安全模型

`settings.json` 定义了细粒度的权限：

**自动允许**：`git status/diff/log/branch`、`ls`、`pytest`
**禁止**：`rm -rf`、`git push --force`、`git reset --hard`、`sudo`、`chmod 777`、读写 `.env`

Hook 机制提供额外安全：
- commit 时自动检查硬编码值
- push 到保护分支时警告
- 资产文件命名规范验证
- 全部用 POSIX grep（`grep -E`），兼容 Windows Git Bash

## 关键发现 / 学习心得

### 1. Claude Code Agent 系统的最佳实践展示

这个项目是目前最完整的 Claude Code 原生 Agent 架构示范。它展示了如何用 `.claude/` 目录下的原生机制（agents、skills、hooks、rules）构建复杂的多 Agent 系统，**完全不需要额外框架**。

### 2. "模拟组织架构"是 Prompt Engineering 的高阶用法

把 Agent 组织成公司层级结构，不只是形式：
- **垂直委派**解决了"谁负责什么"的问题
- **域边界**防止 Agent 互相覆盖
- **冲突上报**给了决策一个清晰的升级路径
- **模型分层**（总监用 Opus，执行用 Sonnet/Haiku）在成本和质量间取得平衡

### 3. "协作 > 自动化"的设计哲学

最反直觉的设计选择：这个系统**故意不自动化**。每一步都要用户审批。这不是技术限制，是刻意设计——因为游戏开发中最危险的不是 bug，而是"方向走偏了但没人发现"。

### 4. Hook 系统 = 可编程的质量门禁

8 个 Hook 覆盖了会话全生命周期（开始→执行→提交→压缩→结束）。尤其是 `detect-gaps.sh`——它在每次打开会话时自动扫描"有代码但没设计文档""有原型但没 README"等常见遗漏，非常实用。

### 5. 适用范围与局限

- ✅ 独立开发者 / 小团队用 Claude Code 做游戏
- ✅ 学习 Claude Code Agent 系统的最佳实践
- ✅ 可定制——所有文件都能改，是模板不是框架
- ❌ 不是运行时代码，不能脱离 Claude Code 使用
- ❌ 需要 Claude Code 订阅（Max/Pro）
- ❌ 48 个 Agent 全用起来会消耗大量 token

### 6. 与 OpenClaw 的对比思考

OpenClaw 走的是"通用 AI Agent 平台"路线，而 Claude Code Game Studios 走的是"垂直领域深度定制"路线。两者的 Agent 组织思路有相通之处——分层、分域、有协调者——但实现机制完全不同：

| 维度 | OpenClaw | Claude Code Game Studios |
|------|----------|-------------------------|
| Agent 定义 | SOUL.md + 代码 | YAML frontmatter + Markdown |
| 协调方式 | 多 workspace + session | 层级委派 + 冲突上报 |
| Hook 机制 | Heartbeat + 事件 | Git 生命周期 Hook |
| 适用范围 | 通用 | 游戏开发垂直场景 |

## 参考资源

- [官方 README](https://github.com/Donchitos/Claude-Code-Game-Studios)
- [Quick Start Guide](.claude/docs/quick-start.md)
- [Agent Coordination Map](.claude/docs/agent-coordination-map.md)
- [Claude Code 官方文档](https://docs.anthropic.com/en/docs/claude-code)
- [UPGRADING.md](https://github.com/Donchitos/Claude-Code-Game-Studios/blob/main/UPGRADING.md) — 版本迁移指南
