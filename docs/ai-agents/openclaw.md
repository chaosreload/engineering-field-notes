# OpenClaw Getting Started

> 整理日期：2026-04-16
> 仓库地址：https://github.com/openclaw/openclaw
> 版本：2026.4.4

## 项目简介

**核心结论：OpenClaw 是一个自托管的多渠道 AI Agent 网关，通过单一 Gateway 进程将 Slack/Telegram/Discord/WhatsApp/iMessage 等 100+ 消息渠道连接到 AI 编程助手（Pi），实现"任何设备发消息，AI 即时响应"。**

它解决的核心问题是：**AI Agent 与人的交互入口碎片化**。开发者想在手机上发条消息让 AI 帮忙写代码、查日志、做任务，但每个平台都要单独集成。OpenClaw 把这些全部统一了。

为什么火：
- MIT 开源，完全自托管，数据不经过第三方
- 单进程支持 100+ 渠道（内置 + 插件），包括 Signal、iMessage、Matrix、微信等
- 原生支持多 Agent 路由、记忆系统、技能系统、子 Agent 协作
- 从 `npm install -g openclaw` 到可用只需 5 分钟

## 核心架构

**核心发现：OpenClaw 的架构可拆解为四大组件，与亚马逊云文章描述一致，但源码揭示了更多工程细节。**

```
┌──────────────────────────────────────────────────────────────┐
│                     Control Interfaces                       │
│         Web UI │ CLI │ macOS App │ iOS/Android Nodes          │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌──────────────────────────────────────────────────────────────┐
│                    Channel Adapters                           │
│  Slack │ Telegram │ Discord │ WhatsApp │ Signal │ iMessage   │
│  Teams │ Matrix │ Feishu │ LINE │ IRC │ Nostr │ 100+ ...     │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌──────────────────────────────────────────────────────────────┐
│                 Gateway Control Plane                         │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐   │
│  │ 消息路由 │ │ 会话管理  │ │ 安全边界  │ │  插件/扩展管理  │   │
│  └─────────┘ └──────────┘ └──────────┘ └────────────────┘   │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐   │
│  │ Cron 调度│ │ Auth管理  │ │ Config   │ │  Channel健康   │   │
│  └─────────┘ └──────────┘ └──────────┘ └────────────────┘   │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌──────────────────────────────────────────────────────────────┐
│                    Agent Runtime                              │
│  Pi Coding Agent (嵌入式) + 工具系统 + 记忆 + 技能 + 压缩    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐   │
│  │ 上下文组装│  │ 模型调用  │  │ 工具执行  │  │ 会话持久化 │   │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### 1. Channel Adapters（渠道适配层）

**源码验证**：`extensions/` 目录包含 **100+ 渠道插件**，每个插件通过 `channel-entry.ts` 导出标准的 `ChannelPlugin` 接口。

```
extensions/
├── slack/          # Slack 集成
├── telegram/       # Telegram 集成  
├── discord/        # Discord 集成
├── whatsapp/       # WhatsApp 集成
├── signal/         # Signal 集成
├── imessage/       # iMessage (通过 BlueBubbles)
├── feishu/         # 飞书集成
├── matrix/         # Matrix 集成
├── msteams/        # Microsoft Teams
├── line/           # LINE 集成
├── irc/            # IRC 集成
├── nostr/          # Nostr 集成
├── zalo/           # Zalo 集成
└── ...             # 还有 googlechat, twitch, qqbot 等
```

插件加载机制（`src/channels/plugins/bundled.ts`）：
- 通过 `jiti`（即时 TypeScript 编译器）动态加载插件的 `channel-entry.ts`
- 支持命名导出模式：导出 `xxxPlugin` + `setXxxRuntime`
- 插件发现通过 `discoverOpenClawPlugins()` 扫描 `extensions/` 目录

### 2. Control Interfaces（控制接口）

- **CLI**：`openclaw.mjs` 入口，支持 `gateway start/stop/restart`、`onboard`、`dashboard` 等子命令
- **Web Control UI**：默认端口 18789，提供聊天、配置、会话管理界面
- **macOS App**：原生应用
- **Mobile Nodes**：iOS/Android 配对设备，支持 Canvas、摄像头、语音等

### 3. Gateway Control Plane（网关控制面）

**源码验证**：`src/gateway/` 目录是网关的核心，关键文件包括：

- `boot.ts`：启动引导，支持 `BOOT.md` 自动执行
- `auth.ts` + `auth-rate-limit.ts`：认证与限流
- `channel-health-monitor.ts`：渠道健康监控
- `call.ts`：核心调用路由逻辑

Gateway 承担的核心职责：
1. **消息路由**：根据 session key 路由到正确的 Agent workspace
2. **安全边界**：allowFrom 白名单、群组 mention 规则、exec 审批机制
3. **会话管理**：session store 持久化（JSON 文件），支持 per-sender/per-agent 隔离
4. **配置管理**：`~/.openclaw/openclaw.json` 配置热加载

### 4. Agent Runtime（Agent 运行时）

**这是最核心的部分。** 源码位于 `src/agents/pi-embedded-runner/`。

## Agent Runtime 执行循环

**核心发现：每次用户消息触发的 Agent 执行，实际上是一个复杂的多层重试循环，而非简单的"4步执行"。**

入口函数：`runEmbeddedPiAgent()`（`src/agents/pi-embedded-runner/run.ts`）

### 完整执行流程

```
用户消息到达
    │
    ▼
┌─ Session Lane 排队（防并发） ─────────────────────────┐
│  enqueueSession → enqueueGlobal                       │
│                                                        │
│  1. Workspace 解析                                     │
│     resolveRunWorkspaceDir()                           │
│                                                        │
│  2. 插件加载                                           │
│     ensureRuntimePluginsLoaded()                       │
│                                                        │
│  3. 模型解析 + Hook 介入                               │
│     resolveHookModelSelection() → resolveModelAsync()  │
│                                                        │
│  4. Auth Profile 轮转初始化                            │
│     createEmbeddedRunAuthController()                  │
│     → 支持多 profile 自动轮转（限流/故障时切换）       │
│                                                        │
│  5. 重试循环 (最多 MAX_RUN_LOOP_ITERATIONS 次)         │
│     ┌─ runEmbeddedAttempt() ─────────────────────┐     │
│     │  a. 技能加载 + 环境变量覆盖                │     │
│     │  b. Bootstrap 上下文文件加载               │     │
│     │  c. 系统提示词构建                         │     │
│     │  d. 工具注册 (内置 + MCP + 插件)           │     │
│     │  e. 会话创建/恢复                          │     │
│     │  f. 流式调用 LLM                           │     │
│     │  g. 工具调用处理                           │     │
│     │  h. 会话状态持久化                         │     │
│     └────────────────────────────────────────────┘     │
│     失败处理:                                          │
│     - Context Overflow → 触发 Compaction 后重试        │
│     - Auth Error → 轮转到下一个 profile                │
│     - Rate Limit → Backoff + Profile 轮转              │
│     - Timeout → 超时压缩后重试                         │
│                                                        │
│  6. 返回结果 (EmbeddedPiRunResult)                     │
└────────────────────────────────────────────────────────┘
```

### 关键工程细节

**Session Lane 排队**：通过 `enqueueCommandInLane()` 实现 per-session 串行执行，避免并发写入冲突。

**Auth Profile 轮转**：`createEmbeddedRunAuthController()` 维护一个 profile 候选队列，当某个 API key 被限流或失败时，自动切换到下一个。支持的策略：
- 按最近使用时间排序
- Cooldown 自动过期
- Billing/Auth 错误标记

**Failover 策略**：分类处理不同错误：
- `isLikelyContextOverflowError` → 触发 compaction
- `isRateLimitAssistantError` → profile 轮转
- `isBillingAssistantError` → 标记 profile 失败
- `isTimeoutError` → 超时处理

## 上下文组装机制

**核心发现：系统提示词是一个精心分层的文本拼接过程，最终产出一个包含十几个 section 的 Markdown 格式字符串。**

上下文组装入口：`buildAgentSystemPrompt()`（`src/agents/system-prompt.ts`，763 行）

### 上下文组装的完整结构

```
System Prompt 组装顺序:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 基础身份
   "You are a personal assistant running inside OpenClaw."

2. ## Tooling（工具清单）
   - 核心工具: read, write, edit, exec, process, web_search, ...
   - 插件工具: message, browser, canvas, nodes, cron, ...
   - 工具策略指导: cron vs exec 使用场景

3. ## Tool Call Style
   - 默认不解释，直接调用
   - 复杂操作才需解释

4. ## Safety（安全规范）
   - 无独立目标、不自我复制
   - 冲突时暂停请求人类监督

5. ## OpenClaw CLI Quick Reference

6. ## Skills (mandatory)（技能列表）
   - <available_skills> XML 格式
   - 每个 skill: name + description + location
   - 强制匹配规则：精确匹配一个就读取 SKILL.md

7. ## Memory（记忆搜索提示）
   - 由 memory-core 插件注入

8. ## OpenClaw Self-Update

9. ## Model Aliases

10. ## Workspace
    - 工作目录路径
    - Sandbox 模式指导

11. ## Documentation
    - 本地 docs 路径 + 在线文档链接

12. ## Sandbox（如果启用）
    - 容器路径 vs 宿主路径映射

13. ## Current Date & Time

14. ## Workspace Files (injected)（Bootstrap 文件）
    - AGENTS.md → 工作流程定义
    - SOUL.md → 人格/风格
    - TOOLS.md → 用户自定义工具指南
    - IDENTITY.md → 名称/emoji/头像
    - USER.md → 用户偏好
    - MEMORY.md → 长期记忆
    - BOOTSTRAP.md → 自定义引导
    - 自定义注入文件

15. ## Subagent Context（如果是子 Agent）

16. ## Runtime 信息
    agent= | host= | os= | model= | channel= | ...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Workspace 配置文件详解

| 文件 | 用途 | 源码位置 |
|------|------|---------|
| `AGENTS.md` | 定义 Agent 的工作流程、协作关系、KPI | `workspace.ts` → `DEFAULT_AGENTS_FILENAME` |
| `SOUL.md` | 人格、语气、核心原则 | `DEFAULT_SOUL_FILENAME` |
| `TOOLS.md` | 用户自定义工具使用指南（不控制工具可用性） | `DEFAULT_TOOLS_FILENAME` |
| `IDENTITY.md` | 名称、emoji、头像 | `DEFAULT_IDENTITY_FILENAME` |
| `USER.md` | 用户信息和偏好 | `DEFAULT_USER_FILENAME` |
| `MEMORY.md` | 长期记忆 | `DEFAULT_MEMORY_FILENAME` |
| `HEARTBEAT.md` | 心跳检查指令 | `DEFAULT_HEARTBEAT_FILENAME` |
| `BOOTSTRAP.md` | 自定义引导 | `DEFAULT_BOOTSTRAP_FILENAME` |
| `BOOT.md` | Gateway 启动时自动执行 | `gateway/boot.ts` |

### Bootstrap 文件加载机制

源码（`bootstrap-files.ts`）揭示了精细的加载控制：

1. **加载**：`loadWorkspaceBootstrapFiles()` 从 workspace 目录读取
2. **过滤**：`filterBootstrapFilesForSession()` 按 session 类型过滤
3. **Hook 覆盖**：`applyBootstrapHookOverrides()` 允许插件修改
4. **Context Mode**：
   - `full`：加载所有 bootstrap 文件
   - `lightweight`：心跳场景只保留 `HEARTBEAT.md`，cron 场景清空
5. **预算控制**：`analyzeBootstrapBudget()` 防止 bootstrap 文件超出 token 预算
6. **缓存**：`getOrLoadBootstrapFiles()` 通过 inode/mtime 缓存避免重复读取

### PromptMode 分级

```typescript
type PromptMode = "full" | "minimal" | "none";
```

- `full`：主 Agent，完整 section（Skills、Memory、Docs、Reply Tags 等）
- `minimal`：子 Agent，只保留 Tooling + Workspace + Runtime
- `none`：最简模式，只有一行身份声明

## 记忆系统

**核心发现：记忆系统是一个独立的扩展插件（`extensions/memory-core/`），而非嵌在核心代码中。采用"混合搜索 + Dreaming 整合"的两层架构。**

### 存储架构

```
memory-core/
├── src/
│   ├── memory/
│   │   ├── manager.ts          # MemoryIndexManager 中枢
│   │   ├── hybrid.ts           # 混合搜索引擎
│   │   ├── embeddings.ts       # 向量嵌入管理
│   │   ├── temporal-decay.ts   # 时间衰减
│   │   ├── mmr.ts              # 最大边际相关性
│   │   ├── search-manager.ts   # 搜索管理器
│   │   └── provider-adapters.ts # 嵌入模型适配
│   ├── dreaming.ts             # Dreaming 机制
│   ├── short-term-promotion.ts # 短期记忆晋升
│   ├── flush-plan.ts           # 记忆刷写计划
│   └── tools.ts                # 记忆工具定义
```

### 混合搜索机制（Hybrid Search）

源码（`memory/hybrid.ts`）确认了双路搜索 + 加权融合：

```
查询 → ┬→ 向量搜索 (cosine similarity) ──→ vectorWeight (默认 0.7)
       │                                         │
       └→ FTS5 全文搜索 (BM25 排名)   ──→ textWeight (默认 0.3)
                                                  │
                                          加权融合 + 去重
                                                  │
                                          ┌───────┴───────┐
                                          │ MMR 重排序     │ (可选, 多样性)
                                          │ 时间衰减       │ (可选, 半衰期)
                                          └───────────────┘
                                                  │
                                          Top-K 结果返回
```

关键配置参数（`memory-search.ts`）：
- `maxResults`: 默认 6
- `minScore`: 默认 0.35
- `vectorWeight`: 0.7, `textWeight`: 0.3
- `candidateMultiplier`: 4（先取 4 倍候选再精排）
- `temporalDecay.halfLifeDays`: 30 天
- `chunking.tokens`: 400, `overlap`: 80

**BM25 分数归一化**（源码直接验证）：
```typescript
function bm25RankToScore(rank: number): number {
  if (rank < 0) {
    const relevance = -rank;
    return relevance / (1 + relevance);
  }
  return 1 / (1 + rank);
}
```

### Dreaming 机制

源码（`dreaming.ts`）揭示 Dreaming 已经**重构为 Short-Term Promotion（短期记忆晋升）机制**，不再是文章描述的"Light Sleep → REM Sleep"两阶段。

三种预设模式：
- `core`：每天凌晨 3 点执行，处理 10 条候选
- `deep`：每 12 小时，更严格的过滤条件
- `rem`：每 6 小时，最严格（minScore=0.85, minRecallCount=4）

晋升条件：
- `minScore`：最低向量相似度
- `minRecallCount`：最少被召回次数
- `minUniqueQueries`：至少被多少不同查询召回

通过 Cron 系统调度，每次执行 `applyShortTermPromotions()` 将高频被召回的短期记忆晋升为长期记忆。

### 插件注册机制

记忆系统通过 `src/plugins/memory-state.ts` 暴露注册接口：
- `MemoryPromptSectionBuilder`：注入系统提示词的记忆 section
- `MemoryFlushPlanResolver`：控制记忆刷写时机和格式
- `RegisteredMemorySearchManager`：提供 sync/search/close 生命周期

## 技能系统 (Skills)

**核心发现：技能系统是一个"声明式发现 + 按需加载"的架构，agent 在每次回复前扫描技能列表，匹配则动态读取 SKILL.md。**

### 技能加载流程

```
启动时：
  loadWorkspaceSkillEntries()
    │
    ├── 扫描 bundled skills（内置技能目录）
    ├── 扫描 workspace skills（~/.openclaw/workspace/skills/）
    ├── 扫描 plugin skills（插件提供的技能）
    └── 合并 + 去重 + 过滤
    
组装到系统提示词：
  resolveSkillsPromptForRun()
    → buildWorkspaceSkillsPrompt()
      → formatSkillsForPrompt()
        → 输出 <available_skills> XML 块
```

### 技能匹配与注入

系统提示词中的 Skills section 强制要求 Agent 遵循以下规则：
1. 每次回复前扫描 `<available_skills>` 的 `<description>` 字段
2. 精确匹配一个技能 → 用 `read` 工具读取 `SKILL.md`
3. 多个可能匹配 → 选最具体的
4. 都不匹配 → 不读取任何 SKILL.md
5. **永远不要预读多个技能**

### 技能限制参数

```typescript
DEFAULT_MAX_CANDIDATES_PER_ROOT = 300    // 每个目录最多扫描 300 个候选
DEFAULT_MAX_SKILLS_LOADED_PER_SOURCE = 200  // 每个来源最多 200 个
DEFAULT_MAX_SKILLS_IN_PROMPT = 150       // 系统提示词最多 150 个技能
DEFAULT_MAX_SKILLS_PROMPT_CHARS = 30_000 // 技能列表最多 30K 字符
DEFAULT_MAX_SKILL_FILE_BYTES = 256_000   // 单个 SKILL.md 最大 256KB
```

### 路径压缩优化

`compactSkillPaths()` 将用户 home 目录替换为 `~`，每个技能路径节省 5-6 个 token，150 个技能可节省约 600 tokens。

## 上下文压缩 (Compaction)

**核心发现：Compaction 是 OpenClaw 应对长对话 token 溢出的核心机制，通过 LLM 生成摘要来压缩历史。**

源码（`compaction.ts`）关键参数：

```typescript
BASE_CHUNK_RATIO = 0.4    // 基础分块比例：取上下文窗口的 40%
MIN_CHUNK_RATIO = 0.15    // 最小分块：不低于 15%
SAFETY_MARGIN = 1.2       // 20% 安全边距（estimateTokens 可能不准）
DEFAULT_PARTS = 2         // 默认分 2 部分压缩
```

### 压缩流程

1. 检测 token 溢出（context overflow error 或主动检查）
2. 将历史消息分块（`BASE_CHUNK_RATIO` 决定块大小）
3. 每块调用 LLM 生成摘要（`generateSummary()`）
4. 多块摘要再合并（`MERGE_SUMMARIES_INSTRUCTIONS`）
5. 替换原始历史，保留摘要

### 摘要指令（必须保留的内容）

```
MUST PRESERVE:
- Active tasks and their current status
- Batch operation progress (e.g., '5/17 items completed')
- The last thing the user requested
- Decisions made and their rationale
- TODOs, open questions, and constraints
- Any commitments or follow-ups promised
```

### 标识符保留策略

`identifierPolicy` 支持三种模式：
- `strict`（默认）：保留所有 UUID、hash、URL、文件名等
- `custom`：自定义保留规则
- `off`：不特殊处理

### 触发时机

- **Context Overflow**：LLM 返回溢出错误时，最多重试 3 次压缩
- **Timeout Compaction**：超时后尝试压缩，最多 2 次
- **Tool Result Truncation**：检测到超大工具输出时先截断再重试

## 插件/扩展体系

**核心发现：OpenClaw 的扩展体系高度模块化，extensions/ 目录包含 100+ 独立扩展，涵盖渠道、AI 提供商、工具三大类。**

### 扩展分类

| 类别 | 示例 | 数量 |
|------|------|------|
| **渠道插件** | slack, telegram, discord, whatsapp, signal, feishu | 30+ |
| **AI 提供商** | anthropic, openai, google, amazon-bedrock, deepseek, moonshot | 30+ |
| **功能扩展** | browser, memory-core, speech-core, image-generation-core | 20+ |
| **工具集成** | brave (搜索), exa, firecrawl, tavily, perplexity | 10+ |
| **协议适配** | ollama, vllm, sglang, litellm, openrouter | 10+ |

### 插件 SDK

源码（`src/plugins/`）提供标准化的插件接口：

- **Channel Plugin**：实现 `ChannelPlugin` 接口 + `channel-entry.ts` 入口
- **Provider Plugin**：通过 stream wrapper 注册模型提供商
- **Memory Plugin**：`registerMemoryRuntime` / `registerMemoryEmbeddingProvider`
- **Hook System**：`getGlobalHookRunner()` 提供生命周期钩子
  - `beforeAgentStart`：Agent 启动前
  - `beforePromptBuild`：提示词构建前
  - `afterTurn`：每轮执行后

### MCP 集成

`src/agents/pi-bundle-mcp-tools.ts` 支持 MCP (Model Context Protocol) 工具：
- 运行时动态加载 MCP 服务器
- 支持 stdio 和 HTTP 传输
- 每个 session 独立的 MCP 运行时

## Token 消耗分析

### 三类 Token 爆炸

1. **注入型爆炸**：
   - 系统提示词过长（Skills 列表、Bootstrap 文件、Memory section）
   - 防御：`DEFAULT_MAX_SKILLS_PROMPT_CHARS = 30_000`、`bootstrapMaxChars` 预算控制
   
2. **重复型爆炸**：
   - 长对话历史不断累积
   - 防御：Compaction 机制 + `limitHistoryTurns()` 限制历史轮次
   
3. **黑盒型爆炸**：
   - 工具返回结果过大（如 `cat` 大文件）
   - 防御：`tool-result-truncation.ts` 截断超大结果 + `tool-result-context-guard.ts` 运行时守卫

### 可观测三层

```
模型调用层：
  prompt-cache-observability.ts — 缓存命中率
  usage-accumulator.ts — Token 使用统计
  anthropic-payload-log.ts — 完整 payload 记录

Agent 执行层：
  system-prompt-report.ts — 系统提示词报告
  cache-trace.ts — 缓存追踪
  bootstrap-budget.ts — Bootstrap 预算分析

Prompt 构建层：
  context-tokens.runtime.ts — 上下文窗口运行时
  context-window-guard.ts — 窗口溢出守卫
  tool-result-char-estimator.ts — 工具结果字符估算
```

### Prompt Cache 优化

Anthropic 的 prompt cache 是 OpenClaw 重点优化的方向：
- `system-prompt-cache-boundary.ts`：标记缓存边界
- `anthropic-cache-retention.ts`：缓存保留策略
- `prompt-cache-stability.ts`：确保 section 排序稳定以提高缓存命中

## 多 Agent 协作

**核心发现：OpenClaw 通过 Subagent 机制实现多 Agent 协作，支持两种模式。**

### Spawn 机制

源码（`subagent-spawn.ts`）定义了两种模式：

```typescript
type SpawnSubagentMode = "run" | "session";
```

- `run`：一次性任务，完成后自动销毁
- `session`：持久会话，可多次交互

### Subagent 生命周期

```
主 Agent
  │
  ├─ sessions_spawn(task, mode="run")
  │    │
  │    ├── 分配独立 workspace
  │    ├── 创建独立 session
  │    ├── 注入 Subagent Context
  │    ├── PromptMode = "minimal"
  │    └── 完成后 auto-announce 回主 Agent
  │
  ├─ subagents(action="list")  → 查看子 Agent 状态
  ├─ subagents(action="steer") → 给子 Agent 追加指令
  └─ subagents(action="kill")  → 终止子 Agent
```

### 深度限制

```typescript
DEFAULT_SUBAGENT_MAX_SPAWN_DEPTH  // 防止无限递归 spawn
```

### ACP (Agent Communication Protocol)

OpenClaw 还支持 ACP 运行时，允许通过 `sessions_spawn(runtime="acp")` 启动外部编程 Agent（如 Claude Code, Codex, Gemini CLI），提供标准化的交互协议。

## 关键设计决策

### 为什么选 TypeScript？

- 原生异步/事件驱动，天然适合 I/O 密集的网关场景
- NPM 生态直接可用（`npm install -g openclaw`）
- 与 Node.js 运行时无缝集成
- 插件可以直接用 TypeScript 编写，通过 `jiti` 即时编译

### 为什么用文件系统而非数据库？

- **会话持久化**：JSON 文件 per session，零依赖
- **记忆存储**：SQLite（单文件数据库）+ 向量扩展
- **配置**：`openclaw.json` 单文件，可直接编辑
- **Workspace 文件**：Markdown 格式（AGENTS.md, SOUL.md 等），人类可读可编辑
- **设计哲学**：自托管场景下，文件系统是最简单可靠的持久化方案

### 为什么 Markdown 配置？

- 人类可读可编辑，无需特殊工具
- LLM 原生理解 Markdown 格式
- 支持版本控制（Git 友好）
- Token 效率高（相比 JSON/YAML 配置）

### 嵌入式 Agent 而非 RPC

OpenClaw 使用**嵌入式 Pi Agent**（`pi-embedded-runner`），将 `@mariozechner/pi-coding-agent` 作为库直接集成，而非通过 RPC 调用独立进程。好处：
- 更低延迟（无进程间通信开销）
- 更精细的控制（直接操控 session manager、工具注册）
- 统一的生命周期管理

### Session Lane 排队

通过 `enqueueCommandInLane()` 实现 per-session 串行化：
- 防止同一 session 的并发写入
- 全局 lane 用于跨 session 的全局操作
- 兼顾并发性能和数据一致性

## 部署方式

### NPM 一行安装（推荐）

```bash
npm install -g openclaw@latest
openclaw onboard --install-daemon
```

### 系统要求

- Node.js 24（推荐）或 Node.js 22 LTS（22.14+）
- 任意操作系统（Linux/macOS/Windows）
- 一个 AI 提供商的 API key

### 配置文件

```
~/.openclaw/
├── openclaw.json          # 主配置
├── workspace/             # 默认 Agent workspace
│   ├── AGENTS.md
│   ├── SOUL.md
│   ├── TOOLS.md
│   ├── IDENTITY.md
│   ├── USER.md
│   ├── MEMORY.md
│   ├── skills/            # 自定义技能
│   └── memory/            # 记忆文件
├── workspace-{profile}/   # 多 Agent workspace
├── sessions/              # 会话存储
└── state/                 # 运行时状态
    └── memory/
        └── {agentId}.sqlite  # 记忆数据库
```

### 快速启动

```bash
# 安装
npm install -g openclaw@latest

# 引导设置（交互式配置 + 安装守护进程）
openclaw onboard --install-daemon

# 打开 Web UI
openclaw dashboard

# 或连接 Telegram（最快的移动端接入方式）
# 在 openclaw.json 中配置 channels.telegram.token
```

### Gateway 管理

```bash
openclaw gateway status    # 查看状态
openclaw gateway start     # 启动
openclaw gateway stop      # 停止
openclaw gateway restart   # 重启
```

## 参考资源

- **官方文档**: https://docs.openclaw.ai
- **GitHub 仓库**: https://github.com/openclaw/openclaw
- **社区 Discord**: https://discord.com/invite/clawd
- **技能市场**: https://clawhub.ai
- **许可证**: MIT

---

> 本文基于 OpenClaw v2026.4.4 源码分析整理，所有架构描述均经过源码验证。
