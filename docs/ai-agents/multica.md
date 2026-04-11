# multica Getting Started

> 整理日期：2026-04-11
> 仓库地址：https://github.com/multica-ai/multica
> 许可证：Apache 2.0

## 项目简介

Multica 是一个 **开源的 AI Agent 管理平台**，核心理念是 **"你的下 10 个员工不是人类"**。它把 coding agent（Claude Code、Codex、OpenClaw、OpenCode、Hermes）变成项目管理看板上的真正队友——可以被分配 issue、自动执行任务、汇报进度、创建子 issue、发评论，就像一个人类同事一样参与团队协作。

**一句话总结**：Linear/Jira for AI Agents——一个让 AI Agent 和人类在同一个项目看板上协作的开源平台。

**定位差异**：不是 Agent 框架（不像 Hermes Agent/OpenClaw），而是 Agent **编排和管理层**。它不关心 Agent 内部怎么思考和调用工具，只关心：分配什么任务、在哪个机器上跑、进度如何、结果怎样、学到的经验如何复用。

## 适合谁用

- 2-10 人的 AI-native 小团队，想让 coding agent 参与日常开发流程
- 已经在用 Claude Code / Codex / OpenClaw 等工具，但缺少统一管理和任务分配
- 想要自托管的、vendor-neutral 的 Agent 管理方案（不绑定特定 Agent 提供商）

## 项目结构

```
multica/
├── server/                    # Go 后端
│   ├── cmd/
│   │   ├── server/            # HTTP API 服务器入口
│   │   │   ├── main.go        # 启动（数据库、Hub、监听器）
│   │   │   ├── router.go      # Chi 路由定义
│   │   │   ├── listeners.go   # 事件总线 → WebSocket 广播
│   │   │   └── runtime_sweeper.go  # 离线 Runtime 清理
│   │   ├── multica/           # CLI 入口（daemon、agent、issue、workspace…）
│   │   └── migrate/           # 数据库迁移
│   │
│   ├── internal/
│   │   ├── handler/           # HTTP Handler（一个文件一个域）
│   │   │   ├── issue.go       # Issue CRUD + 分配
│   │   │   ├── comment.go     # 评论（人类 + Agent）
│   │   │   ├── agent.go       # Agent 管理
│   │   │   ├── daemon.go      # Daemon 通信
│   │   │   ├── skill.go       # 技能管理
│   │   │   ├── workspace.go   # 工作空间
│   │   │   ├── project.go     # 项目
│   │   │   ├── inbox.go       # 通知收件箱
│   │   │   └── ...
│   │   ├── daemon/            # 本地 Agent Daemon
│   │   │   ├── daemon.go      # 主循环（认证→注册→轮询→执行）
│   │   │   ├── execenv/       # 任务隔离执行环境
│   │   │   ├── repocache/     # Git 仓库缓存
│   │   │   └── usage/         # Token 使用量追踪
│   │   ├── realtime/          # WebSocket Hub（workspace 级房间广播）
│   │   ├── events/            # 内部事件总线（解耦 handler ↔ service）
│   │   ├── service/
│   │   │   └── task.go        # 任务生命周期编排（enqueue→claim→start→complete/fail）
│   │   ├── auth/              # JWT + CloudFront 签名
│   │   ├── middleware/        # 认证中间件（X-User-ID / X-Workspace-ID）
│   │   └── storage/           # S3 文件存储
│   │
│   ├── pkg/
│   │   ├── agent/             # Agent SDK（统一 Backend 接口）
│   │   │   ├── agent.go       # Backend interface + factory
│   │   │   ├── claude.go      # Claude Code 适配器
│   │   │   ├── codex.go       # Codex 适配器
│   │   │   ├── openclaw.go    # OpenClaw 适配器
│   │   │   ├── opencode.go    # OpenCode 适配器
│   │   │   └── hermes.go      # Hermes Agent 适配器
│   │   ├── db/                # sqlc 生成的数据库代码
│   │   ├── protocol/          # WebSocket 事件类型定义
│   │   └── redact/            # 敏感信息脱敏
│   │
│   └── migrations/            # PostgreSQL 迁移（39+）
│
├── apps/web/                  # Next.js 16 前端（App Router）
│   ├── app/                   # 路由层（薄壳，导入 features/）
│   ├── features/              # 按业务域组织的模块
│   │   ├── auth/              # 认证状态（Zustand store）
│   │   ├── workspace/         # 工作空间、成员、Agent
│   │   ├── issues/            # Issue 状态、组件、配置
│   │   ├── inbox/             # 通知收件箱
│   │   ├── skills/            # 技能管理
│   │   ├── landing/           # 落地页
│   │   └── modals/            # 弹窗注册
│   └── shared/                # 跨 feature 工具（ApiClient、WSClient、类型定义）
│
├── apps/desktop/              # Electron 桌面应用
├── e2e/                       # Playwright E2E 测试
├── scripts/                   # 构建脚本
├── docker-compose.selfhost.yml  # 自托管 Docker Compose
└── Makefile                   # 一键开发命令
```

## 核心架构

### 1. 整体数据流

```
浏览器/CLI                  Go Backend                    PostgreSQL
   │                           │                              │
   ├──REST API──────────────>  │  ──sqlc queries──────────>   │
   │                           │                              │
   │  <────WebSocket────────   │  <────事件总线触发─────────   │
   │                           │                              │
   │                     Agent Daemon（运行在你的机器上）
   │                           │
   │                     Claude Code / Codex / OpenClaw / OpenCode / Hermes
```

### 2. 任务生命周期（核心流程）

这是 Multica 最重要的流程，由 `TaskService` 编排：

```
1. 用户在看板分配 Issue 给 Agent（或 @mention Agent）
   ↓
2. TaskService.EnqueueTaskForIssue() → 创建 queued 任务
   ↓
3. Daemon 轮询发现新任务 → claim 任务
   ↓
4. execenv.Prepare() → 创建隔离执行环境
   - 每个任务独立目录（{workspacesRoot}/{workspace_id}/{task_id}/）
   - 注入 CLAUDE.md / Agent 指令 / Skills
   - 仓库按需通过 `multica repo checkout` 检出
   ↓
5. Agent Backend.Execute() → 启动对应 CLI（如 `claude --output-format stream-json`）
   - 通过 Messages channel 流式返回进展
   - 通过 WebSocket 广播给前端
   ↓
6. 完成/失败 → TaskService 更新状态 → Issue 状态自动同步
   → Agent 可以自动发评论、创建子 Issue、报告 blockers
```

**关键设计**：
- 任务不存储上下文快照——Agent 在运行时通过 `multica` CLI 按需获取所有数据
- 支持两种触发方式：分配（on_assign）和 @mention
- 每个任务有优先级（从 Issue 继承）
- Agent 归档后自动跳过排队任务

### 3. Agent SDK（统一后端接口）

`server/pkg/agent/` 定义了一个优雅的 `Backend` 接口：

```go
type Backend interface {
    Execute(ctx context.Context, prompt string, opts ExecOptions) (*Session, error)
}
```

**Session** 返回两个 channel：
- `Messages <-chan Message`：流式事件（text、thinking、tool-use、tool-result、status、error）
- `Result <-chan Result`：最终结果（status、output、error、duration、token usage）

**5 个适配器**：Claude Code、Codex、OpenCode、OpenClaw、Hermes——每个都是薄封装，启动对应 CLI 进程并解析其 JSON stream 输出。

### 4. 实时通信

- **WebSocket Hub**：按 workspace 分房间，gorilla/websocket 实现
- **事件总线**（events.Bus）：handler 产生事件 → listener 监听 → Hub 广播
- **私人事件**（inbox）：只发给目标用户，不广播整个 workspace
- **38+ 事件类型**：issue/comment/agent/task/inbox/workspace/member/skill/activity

### 5. 前端架构

- **Next.js 16 App Router** + **Zustand** 状态管理
- Feature-based 架构：`features/auth/`、`features/workspace/`、`features/issues/`、`features/inbox/`、`features/skills/`
- 每个 feature 独立 Zustand store，依赖方向严格单向
- shadcn 组件库 + design tokens，禁止硬编码颜色
- 前端直接和 Go 后端通信（REST + WebSocket），无 BFF 层

### 6. 可复用 Skills

Skills 是跨 Agent 共享的程序化知识：

- 每个 workspace 有自己的 Skills 库
- Skill = name + description + content (SKILL.md) + supporting files
- 执行任务时，Skills 被注入到 Agent 的执行环境（写入 CLAUDE.md 等）
- Agent 执行后可以创建新 Skill → 团队知识积累
- 通过 CLI（`multica skill`）或 Web UI 管理

### 7. 多租户

- 所有查询按 `workspace_id` 过滤
- `X-Workspace-ID` header 路由请求
- 成员资格检查 gate 访问
- Daemon 支持同时 watch 多个 workspace

## 部署方式

### 自托管（Docker Compose）

```bash
git clone https://github.com/multica-ai/multica.git
cd multica
cp .env.example .env
# 编辑 .env（至少改 JWT_SECRET）
docker compose -f docker-compose.selfhost.yml up -d
# 访问 http://localhost:3000
```

组件：PostgreSQL 17（pgvector）+ Go Backend + Next.js Frontend

### CLI 安装

```bash
# macOS/Linux
brew tap multica-ai/tap && brew install multica

# 或从源码构建
make build && cp server/bin/multica /usr/local/bin/multica
```

### 启动 Daemon

```bash
multica login           # 浏览器 OAuth 认证
multica daemon start    # 后台运行，自动检测 claude/codex/openclaw/opencode CLI
```

Daemon 会自动：
1. 发现 PATH 上的 Agent CLI
2. 注册为 Runtime
3. 轮询任务队列
4. 按 provider 路由到正确的 Agent 执行
5. 支持 config 热重载和自动更新

## 关键发现 / 学习心得

### 1. 填补了 Agent 生态的关键空白

目前 AI 开发工具生态有两层：
- **底层**：Agent 框架（Claude Code、Codex、OpenClaw、Hermes）——负责"怎么执行任务"
- **缺失层**：Agent 管理平台——负责"分配什么任务、监控执行、积累经验"

Multica 正好填补了这个缺失层。它不重新发明 Agent 轮子，而是做了一个 **"Agent 的项目经理"**。

### 2. Vendor-Neutral 设计非常干净

Agent SDK 的 `Backend` 接口设计简洁有力——5 个适配器都是薄封装（启动 CLI + 解析 JSON stream），添加新 Agent 只需实现一个文件。这意味着：
- 不绑定任何特定 Agent
- 团队可以混用不同 Agent（复杂任务用 Claude Code，简单任务用 Codex）
- 新 Agent 出现时零迁移成本

### 3. 执行环境隔离做得到位

`execenv` 包为每个任务创建独立目录，注入定制的上下文文件（CLAUDE.md、Skills），仓库按需检出。这解决了 Agent 并行执行时的上下文污染问题。

### 4. "Agent as Assignee" 是产品上的妙招

在 UI 层面，Agent 和人类成员使用完全相同的分配机制（`assignee_type` + `assignee_id` 多态设计），只是渲染样式不同（紫色背景 + 机器人图标）。这让 AI Agent 融入现有的项目管理心智模型，几乎零学习成本。

### 5. 技术栈选择务实

- **Go 后端**：性能好、部署简单（单 binary）、并发模型适合 WebSocket + Daemon
- **sqlc**：编译时安全的 SQL，比 ORM 更透明
- **Next.js 16 + Zustand**：前端主流方案，feature-based 架构清晰
- **PostgreSQL + pgvector**：一个数据库搞定关系型 + 向量搜索

### 6. 与同类产品的对比

| 维度 | Multica | Linear + AI | GitHub Copilot Workspace |
|------|---------|-------------|-------------------------|
| Agent 支持 | 5 种（Claude Code/Codex/OpenClaw/OpenCode/Hermes） | 无 | 仅 Copilot |
| 自托管 | ✅ | ❌ | ❌ |
| 开源 | ✅ Apache 2.0 | ❌ | ❌ |
| 任务管理 | ✅ 完整看板 | ✅ | ❌ |
| 技能积累 | ✅ 可复用 Skills | ❌ | ❌ |
| 实时进度 | ✅ WebSocket | N/A | 有限 |

## 对我们的启发

1. **OpenClaw 已被 Multica 作为一等 Agent 支持**——`server/pkg/agent/openclaw.go` 有完整的适配器实现
2. **Skills 跨 Agent 共享**的概念值得关注——在 Multica 上创建的 Skill 可以被 Claude Code、Codex、OpenClaw 等任何 Agent 使用
3. **Daemon 模式**（后台轮询 + CLI 检测 + 自动路由）是一个值得参考的 Agent 运行时设计模式

## 参考资源

- 🌐 **官网**：https://multica.ai
- ☁️ **云版本**：https://multica.ai/app
- 🔧 **GitHub**：https://github.com/multica-ai/multica
- 📖 **CLI 指南**：[CLI_AND_DAEMON.md](https://github.com/multica-ai/multica/blob/main/CLI_AND_DAEMON.md)
- 🏠 **自托管指南**：[SELF_HOSTING.md](https://github.com/multica-ai/multica/blob/main/SELF_HOSTING.md)
- 🐦 **X**：https://x.com/multica_hq
