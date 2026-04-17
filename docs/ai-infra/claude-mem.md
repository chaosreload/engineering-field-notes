# claude-mem：给 Claude Code 加一层会话记忆

> 整理日期：2026-04-17
> 仓库地址：https://github.com/thedotmack/claude-mem
> 版本：v12.1.6（README 称 6.5.0，package.json 实际 12.1.6）
> 许可证：AGPL-3.0

## 项目简介

Claude Code 默认每个 session 是独立的——上一次会话里调试出来的思路、踩过的坑、做过的架构决策，下次开会话全部重来。**claude-mem 做的事就一件：把每一次 session 里 Claude 的"工具调用观察 + 结论"沉淀下来，在下一次 session 开始时注入回上下文。**

它不是外挂一个 RAG 服务，而是作为 **Claude Code 插件**安装，挂在 Claude Code 的 **lifecycle hooks** 上：

- 你每次让 Claude 执行 `Bash` / `Edit` / `Read` 等工具 → `PostToolUse` hook 触发 → 异步调用 Claude Agent SDK 把这次调用提炼成一条 "observation"（title / narrative / facts / concepts）→ 存进本地 SQLite。
- 下次会话启动 → `SessionStart` hook 从 SQLite 里挑相关 observation → 拼成 context 注入到系统提示。

关键的不是"存记忆"这件事本身，而是它**没有把存储放在云端、没有拽你去它的 UI**：worker 跑在本地 `:37777`，数据库是本地 SQLite，查询接口是一组 REST API + MCP 工具，你可以用任何方式（Web UI、MCP client、curl）去访问。

适合场景：**长期做同一个代码库，想让 Claude Code"记得住"你上周为什么选了 Redis 而不是本地缓存**的人。

## 项目结构

```
claude-mem/
├── .claude-plugin/          # Claude Code 插件清单
├── plugin/
│   ├── hooks/hooks.json     # 5 个 lifecycle hook 配置
│   ├── skills/              # mem-search / make-plan / do / ...
│   ├── modes/               # code / code--zh / code--ja 工作流+语言模式
│   └── scripts/             # 编译产物 (worker-service.cjs 等)
├── src/
│   ├── hooks/               # TS 源，build 到 plugin/scripts/*-hook.js
│   ├── services/
│   │   ├── worker/          # Worker 核心：SessionManager / SDKAgent / SearchManager
│   │   ├── server/          # Express server 装配
│   │   ├── context/         # 上下文生成：ContextBuilder / ObservationCompiler
│   │   ├── sqlite/          # SessionStore / SessionSearch / migrations
│   │   ├── sync/            # ChromaSync (向量索引同步)
│   │   └── integrations/    # Cursor / Windsurf / Gemini / OpenCode / OpenClaw 安装器
│   ├── ui/viewer/           # React 内置查看器 (http://localhost:37777)
│   └── npx-cli/             # `npx claude-mem install` CLI
└── openclaw/                # OpenClaw gateway 插件入口
```

实际上的入口只有两个：一个 `npx claude-mem install` 的安装器，一个由 hooks 触发的 `worker-service.cjs` 后台进程。

## 核心架构

README 里的架构图讲得很清楚：

```
┌──────────────────────────────────────────────────────────────┐
│ Claude Code (host)                                           │
│  + Hook System (5 events)                                    │
│  + MCP Client (search / timeline / get_observations)         │
├──────────────────────────────────────────────────────────────┤
│ CLI Layer (Bun)                                              │
│  + bun-runner.js  (Node→Bun bridge)                          │
│  + hook-command.ts (orchestrator)                            │
│  + handlers/ (context, session-init, observation,            │
│               summarize, session-complete)                   │
├──────────────────────────────────────────────────────────────┤
│ Worker Daemon (Express, port 37777)                          │
│  + SessionManager    会话生命周期                              │
│  + SDKAgent          Claude Agent SDK 封装                    │
│  + SearchManager     搜索编排                                  │
│  + ProcessRegistry   子进程池                                  │
│  + ChromaSync        embedding 同步                            │
├──────────────────────────────────────────────────────────────┤
│ Storage                                                      │
│  + SQLite (claude-mem.db)  结构化数据 + FTS                    │
│  + ChromaDB (chroma.sqlite3) 向量 embedding                    │
│  + MCP Server              对外接口                            │
└──────────────────────────────────────────────────────────────┘
```

值得单独拿出来说的几个设计：

### 1. Worker 作为"数据库前台"，不阻塞 Claude Code

所有 hook 脚本做的事都是：**尽量快地把事件丢给本地 `:37777` worker，然后立刻退出。** 重活（调用 Agent SDK 去提炼 observation、embedding、summarize）都发生在 worker 进程里。

hook 代码里有一条原则写得很赤裸（`src/cli/handlers` 上方）：

```
Transport errors (ECONNREFUSED, timeout, 5xx) → exit 0
Client bugs (4xx, TypeError, ReferenceError)   → exit 2
```

worker 挂掉不会阻塞你正常用 Claude Code，只是失去记忆写入能力。这对一个"默默跑在后台的附加服务"来说是正确的哲学。

### 2. 两种 session id

一个字段叫 `contentSessionId`（Claude Code 给的，整个会话恒定），一个叫 `memorySessionId`（SDK Agent 给的，worker 重启就会变）。外键约束都建在 `memory_session_id` 上，所以有一层 `SessionStore` 负责维护两者映射——这是 worker 可以随意重启而不丢关系的关键。

### 3. CLAIM-CONFIRM 队列，自愈

`pending_messages` 表不是普通队列，它用三个状态实现"零丢失 + 可重试"：

```
enqueue()           → INSERT status='pending'
claimNextMessage()  → UPDATE status='processing' (原子)
confirmProcessed()  → DELETE (成功)
markFailed()        → UPDATE status='failed' (retry < 3)

自愈: 'processing' 超过 60s 自动重置为 'pending'
```

即便 worker crash 在"取出来但还没写完"的瞬间，下次重启也会把它拉回来重做。

### 4. 熔断器防止无限重试

`SessionRoutes` 里包了一个指数退避 + 熔断：

```
Generator crash → retry 1 (1s) → retry 2 (2s) → retry 3 (4s)
  → consecutiveRestarts > 3 → CIRCUIT-BREAKER
  → 把这个 session 相关的所有 pending message 标记 abandoned
  → 停止重试
```

没了这个，一条毒消息能把 worker CPU 拉满。

### 5. 去重靠内容哈希

```
content_hash = SHA256(memory_session_id + title + narrative)[:16]
30 秒内同哈希 → 返回已有 ID，不再 insert
```

避免同一个工具反复触发 hook 造成重复记录。

### 6. 搜索走 Hybrid：SQLite 过滤 + Chroma 排序

这是最值得学的模式。`src/services/worker/search/strategies/HybridSearchStrategy.ts`：

```
Step 1. SQLite metadata filter   → 按 project / type / concept / date 筛出候选 ID 列表
Step 2. Chroma semantic rank     → 用 query 做向量检索，拿到 ID 排序
Step 3. Intersect                → 只保留步骤 1 的 ID，按步骤 2 的顺序
Step 4. Hydrate                  → 从 SQLite 拉完整数据（比从 Chroma 拉快 + 字段全）
```

好处：**Chroma 只负责排序，不负责过滤**。所有刚性约束（项目、类型、时间）都用 SQLite 硬过滤完成，Chroma 只处理模糊语义相关性。这比让向量库同时承担过滤 + 排序要稳定得多，也大幅降低 Chroma 的负担。

### 7. 3 层 MCP 工具：强制"先索引后取全文"

claude-mem 暴露给 Claude 的 MCP 工具刻意只有 3 个，引导一个固定工作流：

```
search(query, filters)     → 返回紧凑表格（ID、标题、~50 token/条）
timeline(anchor, depth)    → 围绕某个 ID 取前后 chronological 上下文
get_observations(ids=[…])  → 拿到 ID 列表后再批量取完整 narrative/facts（~500-1000 token/条）
```

这是一个典型的 **"progressive disclosure"** 模式——不要让 LLM 一次性吞下全文，先看索引、决定感兴趣的再展开。README 里说是"10x token 节省"，看数字不夸张。

## 核心工作流程

一次典型的会话链路（忽略所有 try/catch 简化到骨架）：

```
[SessionStart hook]
  smart-install.js         → 检查 bun/uv 是否装好，没装就装
  worker-service start     → 后台起 worker（Bun 管理进程）
  curl /health             → 最多轮询 20 次
  worker hook claude-code context
    → Worker 从 SQLite 挑相关 observation → 拼成 markdown → 回写给 Claude Code → 注入上下文
           ↑
           └── ContextBuilder + ObservationCompiler + TokenCalculator

[UserPromptSubmit hook]
  worker hook claude-code session-init
    → SessionStore 注册 session（建立 contentId ↔ memoryId 映射）
    → SDKAgent 启动
    → 可选：把当前 prompt 做语义检索，提前注入相关记忆

[PostToolUse hook]   ← 每次工具调用都触发
  worker hook claude-code observation
    → POST /api/sessions/observations
    → PendingMessageStore.enqueue()
    → SDKAgent 异步处理
         Claude Agent SDK 分析工具的 input/output
         ResponseProcessor 解析
         storeObservations() → SQLite
         ChromaSync.sync()   → ChromaDB
         SSE broadcast       → viewer UI 实时显示

[Stop hook]
  worker hook claude-code summarize
    → 让 SDKAgent 对整个会话做一次 summary
    → 写到 session_summaries 表

[SessionEnd hook]
  worker hook claude-code session-complete
    → 标记 session 完成
    → 把 pending 队列里残留的消息 drain 掉
    → 30 秒超时硬切
```

7 个 hook 脚本 × 5 个生命周期事件，串起"写入 → 检索"的完整闭环。

## 部署步骤（在 dev-server 上复现）

项目要 Node ≥ 18 + Bun + （可选）uv（Chroma 的 Python 运行时）。

```bash
# 1. 克隆 + 装依赖
git clone https://github.com/thedotmack/claude-mem.git
cd claude-mem
npm install            # 570 包，约 1 分钟

# 2. 构建（把 TS hook 编译到 plugin/scripts/*-hook.js）
npm run build
# ✓ openclaw plugin built (14.39 KB)
# ✓ opencode plugin built (2.84 KB)
# Output: plugin/scripts/

# 3. 装 Bun（首次）
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

# 4. 启动 worker 守护进程
npm run worker:start

# 5. 验证
curl -s http://localhost:37777/health
# {"status":"ok","timestamp":...}

npm run worker:status
# Worker is running / PID: xxx / Port: 37777
```

worker 起来以后，`~/.claude-mem/` 下会自动生成：

```
~/.claude-mem/
├── claude-mem.db         SQLite 主库
├── claude-mem.db-shm     WAL 模式的共享内存
├── claude-mem.db-wal     WAL 日志
├── settings.json         默认配置（模型、端口、上下文策略）
├── supervisor.json       进程监督状态
├── transcript-watch.json 转录日志轮询状态
├── logs/                 worker-YYYY-MM-DD.log
└── corpora/              语料库（若启用）
```

真实使用时只要 `npx claude-mem install` 一条命令就完成上面 4-5 步；上面这套是用来"在 dev-server 从源码搞懂一遍"的流程。

### 踩过的坑

- **默认用 Bun 跑 worker，Node 不行**。Node ESM + 一些 cjs 模块的边界问题会导致 `worker-service.cjs` 起不来，项目一开始就按 Bun 设计（package.json 里 `"bun": ">=1.0.0"`）。
- **`/api/search`、`/api/search/by-*`、`/api/search/observations` 全都走 Chroma**。没装 uv / 没跑 chroma-mcp 的情况下会返回 `{"error":"chroma-mcp connection in backoff"}`。想用纯 SQLite 的场景应该用 `/api/observations`、`/api/decisions`、`/api/changes`、`/api/observations/batch` 这些路由。
- **`npm install -g claude-mem` 只装 SDK，不装插件 hook**。README 里很明显地警告过：必须走 `npx claude-mem install` 或者 Claude Code 的 `/plugin install claude-mem`，否则 hook 根本不会挂载。

## Demo 示例

不依赖任何 AI API key，直接往 SQLite 里注入 3 条 observation，再用 Worker 的 HTTP API 检索。放在 dev-server：`/data/projects/chaosreload/study/demo/claude-mem/demo.sh`。

```bash
# 1. 启动 worker
cd ~/claude-mem && npm run worker:start

# 2. 跑 demo
bash /data/projects/chaosreload/study/demo/claude-mem/demo.sh
```

核心片段：

```bash
# 注入 1 session + 3 条 observation（bugfix / feature / decision）
sqlite3 ~/.claude-mem/claude-mem.db <<SQL
INSERT INTO sdk_sessions(content_session_id, memory_session_id, project, platform_source,
  started_at, started_at_epoch, status) VALUES(...);

INSERT INTO observations(memory_session_id, project, type, title, subtitle, narrative,
  facts, concepts, files_read, files_modified, ...) VALUES
('...', 'demo-project', 'bugfix', 'Fixed JWT token expiration bug', ...),
('...', 'demo-project', 'feature', 'Added rate limiting to /api/login', ...),
('...', 'demo-project', 'decision', 'Chose Redis over in-memory for rate-limit store', ...);
SQL

# 查询
curl -s 'http://localhost:37777/api/stats' | jq '.database'
# { "observations": 3, "sessions": 1, ... }

curl -s 'http://localhost:37777/api/decisions?project=demo-project' | jq -r '.content[0].text'
# Found 1 decision(s)
# | ID | Time | T | Title                                             |
# |-----|------|---|---------------------------------------------------|
# | #12 | 4:59 | ⚖️ | Chose Redis over in-memory for rate-limit store |

# 按 ID 批量拉完整详情（MCP get_observations 等价）
curl -s -X POST http://localhost:37777/api/observations/batch \
  -H 'Content-Type: application/json' \
  -d '{"ids":[12]}' | jq '.[0] | {title, narrative, facts, concepts}'
# {
#   "title": "Chose Redis over in-memory for rate-limit store",
#   "narrative": "Picked Redis since we run 3 replicas behind ALB...",
#   "facts": "[\"3 replicas behind ALB\",\"picked Redis\"]",
#   "concepts": "[\"rate-limiting\",\"redis\",\"architecture\"]"
# }
```

跑一遍之后看 viewer UI（浏览器开 `http://localhost:37777`）能实时看到这些 observation 出现。

## 关键发现 / 学习心得

- **"让 Claude Code 有记忆"比"做一个记忆 agent"更务实**。这个项目解决的问题很具体——让 Claude Code 跨 session 记住项目上下文。它没有试图变成一个通用 AI agent 框架，也没有追求跨工具的野心，反而**把 MCP + hooks 这套机制用到了极致**。路径选得好。
- **Hook → HTTP worker → DB 的分层非常干净**。Hook 只负责"快速把事件丢出去"，所有重逻辑都在 worker 进程里，这样 worker 可以随便重启、换实现、做复杂异步流水线，而不影响 Claude Code 本身的交互延迟。值得任何写 CLI 插件的人抄。
- **SQLite + Chroma 的 Hybrid Search 是现阶段 agent memory 的最优解**。纯向量检索在"我要最近 3 天的 bugfix 相关"这种混合查询里表现很差；纯 SQLite 关键字又抓不到语义。Hybrid 把硬条件交给 SQL、语义排序交给向量，各司其职——这个拆分应该成为默认选择，而不是绑死一个向量数据库。
- **Progressive Disclosure 是给 LLM 设计工具 API 的关键原则**。给 MCP 工具只留 3 个（search / timeline / get_observations）并强制顺序，比开 20 个工具让模型自己挑要稳得多。token 成本可控性直接上一个量级。
- **Pro 版走"同一批 API、不一样的 UI"而不是 fork 一份代码**。README 里讲 Pro 特性只是多一个 viewer UI，开源版本的 localhost:37777 endpoint 全部保留可用。这种 open-core 架构设计得很干净，不会让社区用户担心将来核心功能被抽走。
- **踩过 Bun vs Node 的坑**。worker 只在 Bun 下稳，Node 跑会挂——这是很多 JS 工具链的现实问题，但项目直接**把 Bun 写进 engines** 并用 `bun-runner.js` 做桥接，没有试图两边兼容。选一条路死磕比两边都支持得一半好。

## 对标

- **Mem0 / Zep / MemGPT**：这些更像"通用 agent memory 库"，需要自己接业务；claude-mem 直接绑定 Claude Code 一个宿主，边界明确、体验一键化。
- **OpenAI Memory / Claude Projects**：云端闭源、不可自托管、跨 client 不能用。claude-mem 全部本地、数据自己掌握，适合代码场景。
- **继续关注**：它对 Gemini CLI / OpenCode / OpenClaw / Cursor / Windsurf 都做了 integrations——说明 hook + worker 模型本身是可以跨宿主的。这套架构也许会演化成一个"通用本地 agent memory layer"。

## 参考资源

- 仓库：<https://github.com/thedotmack/claude-mem>
- 官方文档：<https://docs.claude-mem.ai/>
- 架构总览：`docs/architecture-overview.md`
- Hook 配置：`plugin/hooks/hooks.json`
- 搜索策略源码：`src/services/worker/search/strategies/HybridSearchStrategy.ts`
- mem-search skill：`plugin/skills/mem-search/SKILL.md`
- 本次整理的运行环境：dev-server，`/data/projects/chaosreload/study/repo/public/claude-mem`
- Demo：`/data/projects/chaosreload/study/demo/claude-mem/demo.sh`
