# bytedance/deer-flow Getting Started

> 整理日期：2026-04-20
> 仓库地址：https://github.com/bytedance/deer-flow

## 项目简介

**DeerFlow**（**D**eep **E**xploration and **E**fficient **R**esearch **Flow**）是字节跳动 2025 年开源的项目，2026 年 2 月 28 日发布 2.0 后上过 GitHub Trending 第 1，现在 **62.9K stars / 8.1K forks**，活得非常凶（最近 commit 几分钟前）。

**但是这篇文章立意和前 5 篇不一样**——这是**选型系列里唯一一个不是"SDK/框架"的东西**，而且它自己的定位 2026 年初刚发生过一次巨大变化，必须开门见山讲清楚。

### 一句话定位（非常重要）

> **DeerFlow 不是通用 agent SDK。它是一个开箱即用的 Super Agent Harness — 前端 + 后端 + 沙箱 + 21 个内置 Skill + 5 个 IM channel + 长期记忆 + sub-agent 调度的一整套"agent 应用"，而不是"agent 库"。**

换人话：

| 前 5 家给你的东西 | DeerFlow 给你的东西 |
|---|---|
| `pip install xxx` 之后写代码组装 agent | `make setup && make dev` 之后浏览器打开 <http://localhost:2026>，直接用 |
| 一个 Python package | 一个 Next.js 前端 + FastAPI 后端 + LangGraph server + 沙箱容器的**完整应用** |
| 模型/工具/中间件抽象 | 已经帮你组装好的 **lead_agent + 2 个 builtin sub-agent + 17 个 middleware + 21 个 skill** |
| 你自己写 prompt | 字节已经写好 1500+ 行 system prompt，你直接用或覆盖 |

**跟 deepagents 的关系最微妙**：两个都基于 LangGraph，都处理"deep、多步骤"任务，但定位差了一层——
- deepagents = "让任何 agent 都能做 deep task 的**框架**"（一个 Python 库，你引入后写自己的 agent）
- DeerFlow = "字节已经基于 LangGraph 帮你搭好的一个 deep research / super agent **应用**"（你直接部署，或在它的 skill 体系里加东西）

### 2.0 的关键转折（必读）

DeerFlow 1.x 是纯正的 **Deep Research 框架**，架构是经典的 coordinator → planner → researcher → reporter 多 agent 流水线，面向一个垂直任务：做研究报告。2026-02-28 的 2.0 版本**从零重写**（README 原文："DeerFlow 2.0 is a ground-up rewrite. It shares no code with v1"），立意从"Deep Research 框架"升级为 "**super agent harness**"：

> "DeerFlow wasn't just a research tool. It was a **harness** — a runtime that gives agents the infrastructure to actually get work done. So we rebuilt it from scratch."

这意味着网上 2026-03 之前所有介绍 DeerFlow 的内容（包括大量"Deep Research 开源替代"的文章）**描述的都是 1.x 架构**，2.0 已经换了骨架。本文写的是 2.0。

> 1.x 分支还在维护（`main-1.x`），如果你就是要一个"多 agent 研究报告流水线"的最小化实现，1.x 架构反而比 2.0 更薄更好读。

---

## 核心数据

| 项 | 值 |
|---|---|
| GitHub stars | **62,901** ⭐（2026-04-20） |
| Forks | 8,144 |
| License | MIT |
| 主语言 | Python（backend） + TypeScript/Next.js（frontend） |
| 最新版本 | 2.0（ground-up rewrite，2026-02-28 发布） |
| 默认分支 | main（2.0）；1.x 另开分支 `main-1.x` |
| 后端规模 | `backend/packages/harness/deerflow/` **~23,031 行** Python |
| 内置 Skill | **21 个**（deep-research / ppt-generation / podcast-generation / academic-paper-review / newsletter-generation / image-generation / video-generation / chart-visualization / code-documentation / consulting-analysis / data-analysis / frontend-design / github-deep-research / systematic-literature-review / surprise-me / skill-creator / bootstrap / claude-to-deerflow / vercel-deploy-claimable / web-design-guidelines / find-skills） |
| 内置 Sub-Agent | 2 个（`general-purpose`、`bash`） |
| 内置 Middleware | **17 个**（summarization / memory / title / todo / token_usage / clarification / view_image / loop_detection / subagent_limit / thread_data / uploads / sandbox_audit / tool_error_handling / dangling_tool_call / deferred_tool_filter / llm_error_handling / ...） |
| 搜索 Provider | Tavily / DuckDuckGo / Exa / Firecrawl / Jina AI / InfoQuest（字节自研）/ image_search |
| IM Channel | Telegram / Slack / Feishu / WeChat / WeCom |
| Tracing | LangSmith + Langfuse（二选一或同时） |
| 沙箱 | Local / Docker (AioSandboxProvider) / Kubernetes |
| 推荐最低配 | 4 vCPU / 8 GB RAM / 20 GB SSD；生产 16 vCPU / 32 GB |
| 依赖根 | **LangGraph + LangChain**（两家都是官方 acknowledgments 的） |
| 多语言 README | EN / 中 / 日 / 法 / 俄（5 种） |

**62.9k stars 在选型系列里稳居第一**（前 5 家里 crewAI ~37k 次之，ADK 19k）。但 stars 不意味着它是最好的 SDK——它在"**应用**"维度是最好的，在"**库**"维度**压根不在对比里**。

---

## 项目结构

```
deer-flow/
├── backend/
│   └── packages/harness/deerflow/        # 后端核心（~23k 行 Python）
│       ├── agents/
│       │   ├── lead_agent/               # 入口 agent（agent.py + prompt.py + __init__.py）
│       │   ├── middlewares/              # 17 个中间件
│       │   ├── memory/                   # 长期记忆
│       │   └── checkpointer/             # LangGraph checkpoint
│       ├── subagents/
│       │   ├── builtins/                 # general-purpose + bash
│       │   ├── executor.py               # sub-agent 异步执行
│       │   └── registry.py               # 可被 config.yaml 覆盖
│       ├── tools/builtins/               # task / clarification / present_file /
│       │                                 # setup_agent / invoke_acp_agent / tool_search
│       ├── skills/                       # Skill 加载器（Markdown 文件解析）
│       ├── community/                    # 外部 provider 适配
│       │   ├── tavily/ ddg_search/ exa/ firecrawl/ jina_ai/
│       │   ├── infoquest/                # 字节自家的搜索/爬虫
│       │   ├── image_search/
│       │   └── aio_sandbox/              # 隔离容器沙箱
│       ├── sandbox/                      # 本地沙箱 + security 边界
│       ├── mcp/                          # MCP server 接入
│       ├── models/                       # ChatModel 工厂（含 vLLM / Codex CLI / Claude OAuth）
│       ├── guardrails/ reflection/ tracing/ uploads/
│       ├── runtime/
│       │   ├── runs/ store/              # LangGraph runtime 封装
│       │   └── stream_bridge/            # SSE 流式输出
│       └── client.py                     # Embedded Python client（in-process 调用）
├── frontend/                             # Next.js 前端
├── skills/public/                        # 21 个内置 Skill（Markdown 定义）
├── config.example.yaml                   # ⚠️ 36KB 的配置模板
├── extensions_config.example.json
├── Install.md / Makefile / config.example.yaml
├── docker/                               # Docker Compose 配置
└── scripts/                              # serve.sh / docker.sh / deploy.sh
```

**看尺寸就知道不是 SDK**：`config.example.yaml` 36KB、`README.md` 38KB、后端 23k 行。这是一个**应用**的代码量级，不是一个库。

---

## 核心架构（2.0）

### 1. 单入口：`lead_agent`

所有请求的唯一入口，`backend/packages/harness/deerflow/agents/lead_agent/agent.py` 里用的是 **LangChain 的 `create_agent`**（不是 LangGraph 的 `StateGraph`）：

```python
return create_agent(
    model=create_chat_model(name=model_name, thinking_enabled=..., reasoning_effort=...),
    tools=get_available_tools(...),
    middleware=_build_middlewares(config, ...),   # 17 个中间件
    system_prompt=apply_prompt_template(...),     # 动态 prompt
    state_schema=ThreadState,
)
```

注意：2.0 **没有**经典意义上的 "coordinator / planner / researcher / reporter" 多节点 LangGraph 流水线了。那是 1.x 的模式，2.0 是一个**配了豪华中间件的单 lead agent**，复杂任务靠 `task` tool 派 sub-agent，类似 Claude Code 里的 "Task" tool。

### 2. 中间件栈（17 个，有严格顺序）

核心执行顺序（`agents/lead_agent/agent.py::_build_middlewares`）：

1. `ThreadDataMiddleware` — 提取 thread_id
2. `UploadsMiddleware` — 挂载用户上传的文件
3. `DanglingToolCallMiddleware` — 修复被 provider 中断的 tool_call 历史（否则 OpenAI 严格模式会炸）
4. `SandboxAuditMiddleware` — 审计沙箱调用
5. `ToolErrorHandlingMiddleware` — 工具报错转 ToolMessage
6. `DeerFlowSummarizationMiddleware` — 上下文超阈值自动摘要
7. `TodoMiddleware` — plan 模式下的 todo list（类 Claude Code）
8. `TokenUsageMiddleware` — token 计费
9. `TitleMiddleware` — 首轮后自动生成 thread 标题
10. `MemoryMiddleware` — 长期记忆读写
11. `ViewImageMiddleware` — 视觉模型才加载
12. `DeferredToolFilterMiddleware` — 按需加载工具 schema（省 context）
13. `SubagentLimitMiddleware` — 限制每轮最多派 N 个 sub-agent
14. `LoopDetectionMiddleware` — 破死循环
15. `ClarificationMiddleware` — 最后拦截"澄清请求"

**这 17 个中间件就是 DeerFlow 真正的"产品竞争力"**——这些都是在大量线上 agent 上**踩过坑**才攒出来的，单独拉出来看每一个都是一篇文章。

### 3. Sub-Agent 调度（`task` tool）

不是 LangGraph 子图，是一个叫 `task` 的 tool：

```python
@tool("task", parse_docstring=True)
async def task_tool(runtime, description, prompt, subagent_type, ...):
    """Delegate a task to a specialized subagent that runs in its own context."""
    config = get_subagent_config(subagent_type)   # general-purpose / bash
    ...
    # 异步跑 sub-agent，背后自动 polling，主 agent 看到的是"同步返回结果"
```

这个模式和 **Claude Code 的 Task tool 一模一样**——sub-agent 有隔离的 context、各自的 tool 子集、有 `disallowed_tools=["task", "ask_clarification"]` 防止嵌套爆炸。默认上限**每轮最多 3 个并发**（`max_concurrent_subagents`），prompt 里写明"超过系统会 silently discard"。

两个 builtin sub-agent：
- `general-purpose`：继承父 agent 所有工具，万能选手，适合大部分复杂任务
- `bash`：只跑 bash 命令，**仅在 `AioSandboxProvider`（Docker 隔离沙箱）或显式允许 host bash 时才注册**——很正的安全边界设计

### 4. Skill 系统

**这是 DeerFlow 最独特的设计**。Skill = Markdown 文件 + 一点结构化 metadata，路径在 `skills/public/<skill-name>/SKILL.md`，LLM 按需加载、不是一次性全塞 prompt。看一眼 `deep-research` skill 的 frontmatter：

```yaml
---
name: deep-research
description: Use this skill instead of WebSearch for ANY question requiring web research. Trigger on queries like "what is X", "explain X", "compare X and Y", "research X", or before content generation tasks. ...
---

# Deep Research Skill

## Overview
...
## Research Methodology
### Phase 1: Broad Exploration
### Phase 2: Depth Exploration
### Phase 3: Source Diversification
### Phase 4: Validation
...
```

**Skill 不是代码，是"给 LLM 看的 SOP"**。21 个 builtin skill 覆盖：research（深度研究）、ppt-generation（生成 PPT）、podcast-generation（生成播客 + TTS）、newsletter-generation、systematic-literature-review（系统性文献综述）、data-analysis、frontend-design、image-generation、video-generation、chart-visualization、code-documentation……

这也是 2.0 把自己叫 "super agent" 而不是 "deep research" 的底气——**原来 deep research 只是 21 个 skill 其中一个**。

> 这个 Skill 的思路跟 Anthropic Claude 的 **Agent Skills** 完全同源（README 里甚至有 `claude-to-deerflow` skill 专门对接 Claude Code）。OpenClaw 这边的 skills/ 目录也是同一套思路——**所有在做"可扩展 agent 应用"的人都走到了这个设计**。

### 5. 沙箱 + 文件系统

DeerFlow 的口号："It doesn't just *talk* about doing things. It has its own computer."

每个 thread 有独立的 sandbox workspace：

```
/mnt/user-data/
├── uploads/          ← 用户上传文件
├── workspace/        ← agent 工作目录（读写代码、数据）
└── outputs/          ← 最终产出（PPT / 报告 / 图片 / 视频）

/mnt/skills/public    ← 21 个内置 skill
/mnt/skills/custom    ← 你自己的 skill
```

三种沙箱模式：
- `LocalSandboxProvider` — 文件 IO 映射到 host 的 per-thread 目录，**host bash 默认禁用**（不算安全边界）
- `AioSandboxProvider` — 隔离 Docker 容器，shell 可用
- Kubernetes（通过 provisioner 服务）

### 6. IM Channel = agent UI 的第六种选项

5 个 IM 渠道原生支持，**都不需要公网 IP**（全走长连接/Socket Mode/WebSocket）：

| Channel | 传输 | 难度 |
|---|---|---|
| Telegram | Bot API long-polling | Easy |
| Slack | Socket Mode | Moderate |
| Feishu | WebSocket | Moderate |
| WeChat | Tencent iLink long-polling | Moderate |
| WeCom | WebSocket | Moderate |

内置命令：`/new`、`/status`、`/models`、`/memory`、`/help`。
**这是 "把 agent 当成一个可被消息入口访问的服务" 的典型产品化设计**，前 5 家里没有一个做到这个程度。

### 7. Startup 模式矩阵

光"怎么启动"就是一个 2x2 矩阵（README 给了一张 4x4 表）：

| | Local Foreground | Local Daemon | Docker Dev | Docker Prod |
|---|---|---|---|---|
| Dev | `make dev` | `make dev-daemon` | `make docker-start` | — |
| **Dev + Gateway** | `make dev-pro` | `make dev-daemon-pro` | `make docker-start-pro` | — |
| Prod | `make start` | `make start-daemon` | — | `make up` |
| **Prod + Gateway** | `make start-pro` | `make start-daemon-pro` | — | `make up-pro` |

其中 **Gateway Mode** 是 2.0 的新选项：把 LangGraph agent runtime **嵌进 Gateway API 进程**，从 4 个容器（frontend / gateway / langgraph / nginx）减到 3 个，**不再需要 LangGraph Platform 的商业 license**。这是 DeerFlow 解耦 LangGraph 商业化的一次发力。

---

## Demo：为什么这次没跑起来（以及不重要）

**老实交代**：这篇文章**没跑通 demo**，有意为之，也是时间权衡。

原因：
1. DeerFlow 不是 `pip install && python demo.py` 跑 15 秒就结束的 SDK。一个完整 demo 要 **Next.js frontend + FastAPI backend + LangGraph server + 沙箱 Docker + nginx** 全起来，推荐配置 **8 vCPU / 16 GB RAM**，dev-server 跑起来也要 15-30 分钟预热
2. `make setup` 要交互式问一堆配置，CI 式的一把过很难；`config.example.yaml` 36KB，手改风险大
3. **时间预算 30-40 分钟**，大头应该花在架构吃透上，不是堆环境
4. 退一步讲，**DeerFlow 的价值根本不是"一行代码跑通"**。它的价值是"字节已经把 agent 应用的 17 个中间件 + 21 个 skill + 5 个 IM channel + 沙箱 + 记忆 + sub-agent + tracing 全攒好了"。Demo 跑通只证明 `make setup` 没写错，**跑不通不影响判断定位**

想试水的话，最低路径：

```bash
git clone https://github.com/bytedance/deer-flow.git
cd deer-flow
make setup         # 交互式选 provider + 填 key
make docker-init   # 拉沙箱镜像
make docker-start  # 起服务
# 浏览器开 http://localhost:2026
```

要跑通的前置：
- Docker 装好
- 至少一个 LLM API key（豆包/Anthropic/OpenAI/Codex CLI/Claude OAuth 都行）
- 至少一个搜索 API key（或用 DuckDuckGo 免费 fallback）

### 另一个选择：嵌入式 Python 客户端

如果真想跑单文件 demo，DeerFlow 提供了 `DeerFlowClient`，绕过 HTTP 层直接 in-process 调用：

```python
from deerflow.client import DeerFlowClient
client = DeerFlowClient()

response = client.chat("Analyze this paper for me", thread_id="my-thread")

for event in client.stream("hello"):
    if event.type == "messages-tuple" and event.data.get("type") == "ai":
        print(event.data["content"])

models = client.list_models()        # {"models": [...]}
skills = client.list_skills()        # {"skills": [...]}
client.update_skill("web-search", enabled=True)
```

**但这条路仍然需要完整的 config.yaml + sandbox + 21 个 skill 目录才能工作**——相当于把 HTTP 层剥掉，不是把应用剥成库。

---

## 关键发现 / 结论

### 1. DeerFlow 跟前 5 家根本不在同一层（最重要的一条）

前 5 家都是 **SDK / framework / library**：给你抽象、让你组装、让你写代码。DeerFlow 是 **app / harness / platform**：**它已经组装好了**。直接并排对比 DeerFlow 和 ADK、crewAI、deepagents、Strands、claude-agent-sdk 是**危险的类比**——等于拿 "Django 做的一个 CMS 应用（比如 Wagtail）" 跟 "Django / Flask / FastAPI" 比。

正确的同层对比是 DeerFlow vs **OpenHands**、**Manus**、**GPT Pilot**、**Dify 的 Agent 应用模板**——都是"开箱即用的 agent 应用"这一层。

这也解释了为什么它 62.9k stars：**应用类项目天然比框架类更容易攒 star**，因为"下载即能用"的吸引力是最大公约数。

### 2. 2.0 rewrite 的意图非常像"字节版的 Claude Code"

把 2.0 的几个关键设计放一起看：

- 单 `lead_agent` + `task` tool 派 sub-agent（Claude Code 是 main thread + Task）
- Skill = Markdown SOP，progressively load（Claude Code 的 Agent Skills 设计一模一样）
- Sandbox 是一等公民（Claude Code 的 bash/read/write/edit）
- Memory 是一等公民（Claude Code 的 CLAUDE.md 风格 persistent memory）
- TodoList middleware（Claude Code 的 Todo tool）
- 天然支持 Claude Code OAuth（`ClaudeChatModel`）+ 专门的 `claude-to-deerflow` skill

**这不是偶然**——2.0 立意显然是"把 Claude Code 的**产品形态**在开源 + LangGraph 基础上做出来"，而且加了 Claude Code 没有的东西：**5 个 IM channel 接入**（Claude Code 是 CLI-only）、**内置 21 个 skill**（Claude Code 生态才刚起步）、**web UI**。

如果这个判断成立，**DeerFlow 的 KPI 不是"另一个 agent 框架"，而是"开源 Claude Code 替代"**，这件事对选型的影响巨大：你要评价它，应该拿 Claude Code / Cursor / Windsurf 比，而不是拿 LangGraph / crewAI 比。

### 3. "From Deep Research to Super Agent Harness" 的升级有代价也有机会

代价：
- 网上所有 2026-03 之前的 DeerFlow 介绍文章现在都是**过期信息**（描述的是 1.x 的 planner/researcher/reporter 结构）。引用之前必须核对 README 标题有没有写 "2.0"
- 如果你就是要"研究报告流水线"，2.0 反而比 1.x 复杂（它把自己变成了通用 harness，然后 research 降级成 21 个 skill 之一）——那么用 **1.x 分支** 或者 **直接抄 1.x 代码到自己的项目** 更轻
- 2.0 的架构本身（`create_agent` + 中间件栈）可以用 LangChain 0.3+ 写 50 行复刻大半，重型部分是那 17 个中间件和 21 个 skill 里的工程积累

机会：
- 如果你就是想要一个**字节运维过的、沙箱 + 记忆 + IM 接入 + sub-agent + tracing 全都齐的 agent 应用骨架**，而且想让产品同学不用代码就能用上——直接 fork DeerFlow 比自己攒快得多
- 21 个 builtin skill（尤其 ppt-generation、podcast-generation、systematic-literature-review）里每一个都是独立价值点
- Skill 文件可以**单独提取出来复用到别的 LangChain/LangGraph 项目**（因为它们只是 Markdown）

### 4. DeerFlow 把"Agent 应用"的产品形态界定得很清晰

一个 agent 应用至少包含：
- 前端（对话 UI + 文件上传 + 产出展示）
- 后端（agent 运行时 + 工具 + 沙箱 + 记忆 + 追踪）
- 配置系统（模型 / 工具 / sub-agent / skill 动态可配）
- 多渠道接入（Web + IM + CLI + SDK）
- 部署运维（Docker Compose + K8s 模式）

前 5 个 SDK 基本只解决"后端 agent 运行时"那一层，**前端、配置、IM、部署全要自己再攒**。DeerFlow 把这 5 个维度的完整样板打包了，相当于给"我要做一个 agent SaaS 产品"的团队省掉 2-4 周工程基建。

### 5. 依赖 LangChain + LangGraph 又要解耦商业化

Acknowledgments 里明写 LangChain + LangGraph 是两大基石，但 2.0 的 Gateway Mode **显式干掉 LangGraph Platform 的 license 依赖**——把 LangGraph agent 嵌进 Gateway 进程直接跑。这是一个典型的**"生态用你但不完全绑你"**的工程选择，字节给自己留了退路。

---

## 六维地图：DeerFlow 在选型坐标系里的位置

把 6 个项目画到"**通用性**"和"**重量**"的坐标系里：

```
重型全家桶 (Heavy, batteries-included)
        ↑
        │
        │                                      ⭐ DeerFlow (app, 62.9k)
        │                                        LangGraph-based super agent harness
        │                                        ↑ 这里其实已经不是"通用 SDK"维度了
        │       ADK (19k)                      
        │       Google 生态全家桶              
        │       Session / CLI / Web UI         
        │                                      
        │   crewAI (37k)                       
        │   角色化多 agent + Flow              
        │                                      
        ├─────────────────────────────────────────────────→
        │   deepagents (5k)                          
        │   LangGraph middleware 扩展         
        │                                      
        │                                      
        │   Strands (3k)                       
        │   AWS 薄框架                         
        │                                      
        │   claude-agent-sdk (4k)              
        │   Anthropic 官方最薄              
        │                                      
        ↓
轻量级 (Lightweight, library-style)

   ←───────────── 通用 SDK ──────────┤├──────── 垂直 / 成品应用 ────→
```

**几个观察：**
- 横轴左侧是"**库**（library）"——你在自己代码里 import。claude-agent-sdk / Strands 是典型
- 横轴右侧是"**应用**（app）"——你部署起来用。DeerFlow 是横轴最右的那个
- **DeerFlow 单独占据"垂直应用 + 重型"象限**，6 家里唯一
- 纵轴上方是"框架自带的东西多"，比如 ADK 带 Session / Memory / CLI / Web UI / 部署命令；DeerFlow 在这个维度"满级"（21 skill / 17 middleware / 5 IM / sandbox / tracing / memory 全齐）
- 纵轴下方是"只给你 agent loop"，claude-agent-sdk / Strands 在这里——能力极简、抽象极薄
- **deepagents 和 DeerFlow 在同一条纵线附近**（都基于 LangGraph），但 deepagents 是左下象限（轻量库），DeerFlow 是右上象限（重型应用）——**这就是两家的本质差异**

---

## 选型指引更新（6 家版本）

| 你的诉求 | 选 |
|---|---|
| 纯 Anthropic/Claude 生态，最小抽象，快速原型 | **claude-agent-sdk-python** |
| AWS 生态，Bedrock 重度使用，薄框架 | **strands-agents/sdk-python** |
| 基于 LangChain/LangGraph 做自研 agent，middleware 可组合 | **langchain-ai/deepagents** |
| 多 agent 角色建模，Business-as-Code，Flow/Crew 两种形态 | **crewAIInc/crewAI** |
| Google 生态，工程化最彻底，production multi-agent system | **google/adk-python** |
| 🆕 **要一个开箱即用的 Deep Research / 通用 agent 应用，不想自己搭前后端和基建** | **bytedance/deer-flow** |

对于"Deep Research" 这个垂直诉求：
- 2.0 的 deep-research skill + sub-agent 机制**是当前开源里最完整的方案**
- 如果你只是原型验证 / 个人使用，直接部署 DeerFlow 一天内能用起来
- 如果你要嵌进自己的产品，改造成本比从 LangGraph 从零搭要低 60-80%
- 如果你想要"最薄的研究流水线骨架"，考虑 1.x 分支 + 自己裁剪，而不是 2.0

---

## 踩坑记录

### 坑 1：2.0 和 1.x 是两个完全不同的项目

README 开头就写了 "shares no code with v1"，但**网上绝大多数文章、教程、博客描述的仍然是 1.x 的 coordinator / planner / researcher / reporter 架构**。如果你看到文章讲 "DeerFlow 是一个基于 LangGraph 的多 agent 研究流水线，核心是 4 个节点……" ——**100% 是 1.x 的内容**。

研判前先做一次"年份 + 章节校验"：2.0 的 README 里有 `From Deep Research to Super Agent Harness` 这一段、有 `Skills & Tools` 这一段、有 `Sub-Agents` 这一段；1.x 的 README 这些都没有。

### 坑 2：62.9k stars 不代表"最好的 agent SDK"

应用类项目的 star 天然比框架类多 2-5 倍（下载门槛低 / 非技术人也会点 star）。前 5 家都是 SDK，横向比 stars 不公平。**DeerFlow 的 62.9k ≠ "最佳 agent 框架"**，只是 "最受欢迎的 agent 应用"。选型不要只看 stars。

### 坑 3：推荐配置 16GB RAM 不是虚的

README 写 "Starting point 4 vCPU / 8GB RAM"、"Recommended 8 vCPU / 16GB RAM"、"长跑服务器 16 vCPU / 32GB RAM"。这不是夸张，因为要同时跑 frontend + backend + LangGraph server + sandbox container + nginx + optionally LLM。**2 vCPU / 4GB 的小机器根本起不来**——我猜这也是为什么 dev-server 上没实际跑通的另一个原因。

### 坑 4：Skills 是 Markdown 但不可以随便改

看起来只是 `SKILL.md` 文件，但 skill 参与**动态 prompt 拼接**（progressively loaded），description 写得不精准会导致 LLM 找不到（或错误触发）。字节给了一个 `skill-creator` builtin skill 专门教你怎么写——**改 skill 前先读 `skill-creator/SKILL.md`**，不要凭感觉。

### 坑 5：`task` tool 每轮并发上限是硬墙

prompt 里明写："The system WILL discard excess calls and you WILL lose work. Always batch."  默认 3，超过会被静默丢弃（不报错！）。如果你在追踪 log 发现 "奇怪为什么只执行了 3 个 sub-task，明明 LLM 想并发 5 个"——就是这里。改 `configurable.max_concurrent_subagents` 或在 prompt 里教 LLM 分批。

---

## 扩展阅读

- 官方站：<https://deerflow.tech>
- GitHub 主分支（2.0）：<https://github.com/bytedance/deer-flow>
- 1.x 分支：<https://github.com/bytedance/deer-flow/tree/main-1.x>
- Install 指南：<https://github.com/bytedance/deer-flow/blob/main/Install.md>
- Backend 架构：`backend/README.md` 和 `backend/CLAUDE.md`
- MCP Server 接入：`backend/docs/MCP_SERVER.md`
- Skill 系统参考：`skills/public/skill-creator/SKILL.md`
- LangSmith 追踪：<https://smith.langchain.com>
- Langfuse 追踪：<https://langfuse.com>
- InfoQuest（字节自家搜索/爬虫工具，已集成）：<https://docs.byteplus.com/en/docs/InfoQuest/What_is_Info_Quest>

---

## 一句话收尾

**DeerFlow 是这 6 个项目里唯一一个"你不用写代码就能用起来的那个"**。
如果你的诉求是"造一个 agent 产品/应用"而不是"写一个 agent 库"，它是当前开源里最完整的答案。
反之如果你只是要一个 agent 库 import 进自己的工程——别选它，**选前 5 家的任何一个都更合适**。
