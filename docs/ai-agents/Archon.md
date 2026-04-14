# Archon Getting Started

> 整理日期：2026-04-14
> 仓库地址：https://github.com/coleam00/Archon

## 项目简介

Archon 是一个**面向 AI 编码的工作流引擎**。核心思路：把软件开发过程（规划→实现→测试→Code Review→创建 PR）编码为 YAML 工作流，让 AI 编码 Agent（Claude Code / Codex）按确定性流程执行，而不是「看心情」随机发挥。

**类比**：Dockerfile 之于基础设施、GitHub Actions 之于 CI/CD，Archon 之于 AI 编码工作流。或者说，它是开发领域的 n8n。

**解决的核心问题**：AI 编码 Agent 的「不可重复性」——同一个 prompt，每次执行路径不同，可能跳过测试、忘记 code review、PR 描述不符合模板。Archon 用 DAG 工作流固定流程骨架，AI 只在每个节点内发挥「智能」。

**版本说明**：当前是 v0.3.x（TypeScript 重写），旧版（Python + RAG 任务管理）保留在 `archive/v1-task-management-rag` 分支。

## 核心亮点

| 特性 | 说明 |
|------|------|
| **确定性** | YAML 定义执行顺序，AI 只负责节点内智能，流程可重复 |
| **隔离** | 每次工作流运行自动创建 git worktree，多任务并行零冲突 |
| **DAG 调度** | 节点间有依赖关系，同层节点并发执行（如 5 个 reviewer 并行） |
| **混合节点** | Prompt 节点（AI）+ Bash 节点（确定性脚本）+ Script 节点 + Loop 节点 + Approval 节点 |
| **多平台** | CLI / Web UI / Telegram / Slack / Discord / GitHub Webhook |
| **多 Provider** | Claude Code SDK + Codex SDK，可切换 |

## 项目结构

```
Archon/
├── .archon/                     # 工作流配置
│   ├── config.yaml              # 项目级配置（baseBranch: dev）
│   └── workflows/
│       └── defaults/            # 20 个内置工作流 YAML
├── packages/                    # Monorepo（Bun workspaces）
│   ├── core/                    # 核心引擎
│   │   ├── orchestrator/        # 消息路由 + 上下文管理
│   │   ├── db/                  # 数据库层（SQLite/PostgreSQL）
│   │   ├── handlers/            # 消息处理
│   │   ├── services/            # 清理、Cleanup 等服务
│   │   └── types/               # 核心类型定义
│   ├── workflows/               # 工作流引擎（核心！）
│   │   ├── dag-executor.ts      # DAG 拓扑排序 + 并发执行
│   │   ├── executor.ts          # 工作流入口
│   │   ├── schemas/             # Zod schema（dag-node, workflow, loop...）
│   │   ├── condition-evaluator  # when 条件表达式求值
│   │   └── defaults/            # 内置工作流加载
│   ├── providers/               # AI Provider 抽象
│   │   ├── claude/              # Claude Code SDK 封装
│   │   ├── codex/               # Codex SDK 封装
│   │   └── registry.ts          # Provider 注册表
│   ├── isolation/               # 隔离环境管理
│   │   ├── providers/worktree   # Git worktree 隔离
│   │   └── resolver.ts          # 隔离策略决策
│   ├── adapters/                # 平台适配器
│   │   ├── chat/                # Telegram, Slack
│   │   ├── forge/               # GitHub Webhook
│   │   └── community/           # Discord
│   ├── git/                     # Git 操作封装
│   ├── cli/                     # CLI 入口
│   ├── server/                  # HTTP Server（Hono）
│   ├── web/                     # React Web UI
│   ├── docs-web/                # 文档站（Astro + Starlight）
│   └── paths/                   # 路径/日志工具
├── migrations/                  # SQL 迁移文件（21 个）
├── deploy/                      # Docker 部署配置
└── scripts/                     # 构建/安装脚本
```

## 核心架构

### 整体数据流

```
用户消息（CLI/Slack/Telegram/Web/GitHub）
        │
        ▼
┌─────────────────────────────┐
│     Platform Adapters        │  统一消息格式
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│      Orchestrator            │  路由：Slash Command / Workflow / 普通对话
└──────┬──────────────┬───────┘
       │              │
       ▼              ▼
 ┌──────────┐  ┌──────────────┐
 │ Command  │  │  Workflow     │
 │ Handler  │  │  Executor     │
 └──────────┘  └──────┬───────┘
                      │
                      ▼
              ┌──────────────┐
              │ DAG Executor  │  拓扑排序 → 分层并发
              └──────┬───────┘
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
     PromptNode  BashNode   LoopNode  ...
     (AI 执行)   (脚本)    (循环直到完成)
          │
          ▼
  ┌──────────────┐
  │ AI Provider   │  Claude Code SDK / Codex SDK
  └──────────────┘
          │
          ▼
  ┌──────────────┐
  │  Isolation    │  Git Worktree（每次运行独立分支）
  └──────────────┘
          │
          ▼
  ┌──────────────┐
  │   Database    │  SQLite / PostgreSQL（8 张表）
  └──────────────┘
```

### DAG 执行引擎（核心中的核心）

`dag-executor.ts` 是 Archon 最核心的文件（~2100+ 行），实现了：

1. **拓扑排序**：`buildTopologicalLayers()` 将 DAG 节点按依赖关系分层
2. **并发执行**：同一层的独立节点通过 `Promise.allSettled` 并发运行
3. **条件执行**：`when` 表达式支持引用上游节点输出（如 `$classify.output.issue_type == 'bug'`）
4. **触发规则**：`trigger_rule` 支持 `all_success`、`one_success`、`all_done` 等
5. **输出传递**：`$node_id.output` 变量替换，节点间传递数据
6. **Loop 节点**：循环执行直到检测到完成信号（如 `ALL_TASKS_COMPLETE`）
7. **Approval 节点**：暂停工作流等待人工审批
8. **错误分类与重试**：区分 transient/fatal 错误，自动重试

### 六种节点类型

| 类型 | 用途 | 示例 |
|------|------|------|
| `PromptNode` | AI 执行，发 prompt 给 Claude/Codex | 规划、实现、review |
| `BashNode` | 确定性脚本，无 AI | 运行测试、git 操作 |
| `CommandNode` | 引用 `.archon/commands/` 下的 markdown 文件 | 复用标准化 prompt |
| `LoopNode` | 循环执行直到完成信号 | 实现→测试→修复循环 |
| `ApprovalNode` | 暂停等待人工输入 | Code Review 审批 |
| `ScriptNode` | 运行 Bun/uv 脚本 | 数据处理、API 调用 |

### 隔离机制

每次工作流运行自动创建 **git worktree**：
- 独立分支，独立工作目录
- 5 个修复可以并行运行，互不干扰
- 完成后自动清理（可配置）
- `IsolationResolver` 负责决策：复用已有 worktree 还是创建新的

### 数据库设计（8 张表）

| 表 | 职责 |
|----|------|
| `codebases` | 注册的代码仓库 |
| `codebase_env_vars` | 每个项目的环境变量 |
| `conversations` | 对话（跨平台统一） |
| `sessions` | AI Agent 会话 |
| `isolation_environments` | Worktree 隔离环境 |
| `workflow_runs` | 工作流运行实例 |
| `workflow_events` | 工作流事件日志 |
| `messages` | 消息历史 |

## 内置工作流（17 个）

最常用的几个：

### `archon-fix-github-issue`（10 阶段 DAG）

完整的 Issue → PR 流水线：

```
extract-issue-number → fetch-issue → classify（bug/feature/...）
                                         │
                         ┌────────────────┼────────────────┐
                         ▼                ▼                ▼
                   web-research      investigate        plan
                                   （bug 路径）     （feature 路径）
                         │                │                │
                         └────────────────┴────────────────┘
                                         │
                                    bridge-artifacts
                                         │
                                      implement（Opus 模型）
                                         │
                                      validate
                                         │
                                      create-pr（Draft PR）
                                         │
                              ┌──────────┼──────────┐
                              ▼          ▼          ▼
                         code-review  error-handling  test-coverage ...
                              │          │          │
                              └──────────┴──────────┘
                                         │
                                     synthesize
                                         │
                                      self-fix
                                         │
                                      simplify
                                         │
                                       report
```

**设计亮点**：
- `classify` 节点用 Haiku（便宜/快）做分类，`implement` 用 Opus（贵/强）做实现
- Review 阶段 5 个 Agent 并行（code-review 必跑，其他按条件触发）
- `self-fix` 自动修复 review 发现的问题

### `archon-idea-to-pr`

从模糊想法到 PR：plan → implement（循环到测试通过）→ approve（人工审批）→ create-pr

### `archon-smart-pr-review`

PR 复杂度分类 → 针对性运行 review agent → 综合发现

## 部署步骤

### 前置依赖

- **Bun** ≥ 1.3（`curl -fsSL https://bun.sh/install | bash`）
- **Claude Code** 或 **Codex**（至少一个 AI provider）
- **GitHub CLI**（`gh`）

### 快速安装（CLI only）

```bash
# macOS / Linux
curl -fsSL https://archon.diy/install | bash

# 或通过 Homebrew
brew install coleam00/archon/archon
```

### 完整安装（从源码）

```bash
git clone https://github.com/coleam00/Archon
cd Archon
bun install
bun run build
```

### 启动 Web UI

```bash
# 从源码
bun run dev        # 开发模式（server + web 同时启动）

# 或通过 CLI binary
archon serve       # 自动下载 + 启动 Web UI
```

### 在项目中使用

```bash
cd /path/to/your/project
claude                          # 启动 Claude Code
> Use archon to fix issue #42   # Agent 自动选择工作流
```

## Demo 示例

### 创建自定义工作流

```yaml
# .archon/workflows/my-review.yaml
name: my-review
description: Quick code review workflow

nodes:
  - id: scan
    prompt: "Scan the codebase for potential issues. Focus on error handling and edge cases."

  - id: run-tests
    depends_on: [scan]
    bash: "bun run test"

  - id: report
    depends_on: [run-tests]
    prompt: |
      Summarize the scan findings and test results.
      Scan: $scan.output
      Tests: $run-tests.output
```

### 使用条件分支

```yaml
nodes:
  - id: check-type
    prompt: "Is this a bug fix or a new feature? Output: bug or feature"
    output_format:
      type: object
      properties:
        type: { type: string, enum: [bug, feature] }

  - id: investigate
    depends_on: [check-type]
    when: "$check-type.output.type == 'bug'"
    prompt: "Investigate the bug..."

  - id: plan
    depends_on: [check-type]
    when: "$check-type.output.type == 'feature'"
    prompt: "Create a feature plan..."
```

### 使用 Loop 节点

```yaml
nodes:
  - id: implement
    loop:
      prompt: "Implement the next task. Run tests. If all pass, output ALL_TASKS_COMPLETE."
      until: ALL_TASKS_COMPLETE
      fresh_context: true    # 每次循环用新的上下文
```

## 关键发现 / 学习心得

### 1. 「确定性骨架 + AI 填充」是 AI 编码的最佳实践

Archon 最有价值的洞察：**不是让 AI 决定做什么，而是让人决定流程，AI 决定怎么做**。这解决了 AI 编码最大的痛点——不可重复性。工作流 YAML 就是「可版本控制的软件开发流程」。

### 2. DAG 调度引擎的工程质量很高

`dag-executor.ts` 2100+ 行但结构清晰：拓扑排序 → 分层并发 → 条件求值 → 错误重试。每个节点类型有独立的执行函数，通过 Zod schema 做类型安全的节点定义。这不是 toy project，是生产级的工作流引擎。

### 3. 节省成本的巧妙设计

- `classify` 等简单判断用 Haiku（便宜 40x）
- `implement` 等核心步骤用 Opus
- 每个节点可以独立指定 `model`、`provider`、`effort`
- `fresh_context: true` 避免 token 累积

### 4. Git Worktree 隔离是杀手级特性

大多数 AI 编码工具在同一个分支上操作，容易冲突。Archon 用 git worktree 做到「每个工作流运行有自己的独立世界」，支持真正的并行开发。

### 5. 与 OpenClaw 的对比思考

| 维度 | Archon | OpenClaw |
|------|--------|----------|
| 定位 | AI 编码工作流引擎 | 通用 AI Agent 平台 |
| 工作流 | YAML DAG（强结构化） | Agent 自主决策 + Skills |
| 隔离 | Git Worktree | Sandbox / Sub-agent |
| Provider | Claude Code SDK / Codex SDK | 任意 LLM |
| 多平台 | Slack/Telegram/Web/GitHub | Slack/Telegram/Discord/Signal 等 |
| 优势 | 编码工作流可重复 | 通用性更强、Agent 更灵活 |

两者互补：OpenClaw 适合「通用 AI Agent」场景，Archon 适合「结构化 AI 编码」场景。

### 6. 值得关注的设计模式

- **命令覆盖**：`.archon/commands/` 中同名文件覆盖内置默认，团队可定制标准流程
- **事件发射器**：`WorkflowEventEmitter` 实现实时 UI 更新
- **Zod 驱动类型**：所有 schema 用 Zod 定义，`z.infer` 导出类型，避免类型和验证不一致
- **Lazy Logger**：所有模块用延迟初始化 logger，方便测试 mock

## 参考资源

- **官方文档**：[archon.diy](https://archon.diy)
- **The Book of Archon**：[10 章叙事教程](https://archon.diy/book/)
- **工作流编写指南**：[Authoring Workflows](https://archon.diy/guides/authoring-workflows/)
- **命令编写指南**：[Authoring Commands](https://archon.diy/guides/authoring-commands/)
- **架构参考**：[Architecture](https://archon.diy/reference/architecture/)
- **CLI 参考**：[CLI Reference](https://archon.diy/reference/cli/)
- **GitHub Issues**：[github.com/coleam00/Archon/issues](https://github.com/coleam00/Archon/issues)
