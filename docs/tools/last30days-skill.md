# last30days-skill Getting Started

> 整理日期：2026-03-28
> 仓库地址：https://github.com/mvanhorn/last30days-skill

## 项目简介

last30days 是一个 **AI 驱动的多源实时研究引擎**，以 Claude Code / Codex / Gemini CLI / OpenClaw skill 的形式运行。输入一个话题，它会自动扫描 Reddit、X/Twitter、YouTube、TikTok、Instagram、Hacker News、Polymarket、Bluesky、Truth Social 和 Web 等 10+ 个信息源近 30 天的内容，经过评分、去重、交叉验证后，合成一份带真实引用的深度研究报告。

**一句话定位**：把"最近 30 天人们在说什么"变成结构化、可引用、可操作的洞察。

**适合谁用**：
- 需要快速了解某个话题最新动态的研究者
- 想发现社区真实用法/最佳实践的开发者
- 需要发现趋势和热点的内容创作者
- 做产品调研、竞品分析的产品经理

## 项目结构

```
last30days-skill/
├── SKILL.md                    # 核心 skill 指令（747 行，Claude Code 入口）
├── SPEC.md                     # 架构规范文档
├── CLAUDE.md                   # Claude Code 项目配置
├── scripts/
│   ├── last30days.py           # 主编排引擎（2080 行）
│   ├── watchlist.py            # 话题监控列表管理
│   ├── briefing.py             # 每日/每周简报生成
│   ├── store.py                # SQLite 持久化
│   └── lib/                    # 模块化功能库（~16000 行）
│       ├── schema.py           # 数据类型定义（Engagement, Comment, SubScores...）
│       ├── score.py            # 多信号评分引擎
│       ├── render.py           # Markdown/JSON 输出渲染
│       ├── reddit.py           # Reddit 搜索（ScrapeCreators API）
│       ├── reddit_enrich.py    # Reddit 帖子真实互动数据抓取
│       ├── hackernews.py       # HN 搜索（Algolia API，免费）
│       ├── polymarket.py       # 预测市场搜索（Gamma API，免费）
│       ├── youtube_yt.py       # YouTube 搜索 + 字幕提取（yt-dlp）
│       ├── tiktok.py           # TikTok 搜索（ScrapeCreators）
│       ├── bluesky.py          # Bluesky/AT Protocol 搜索
│       ├── truthsocial.py      # Truth Social 搜索
│       ├── websearch.py        # Web 搜索（Brave/Parallel AI/OpenRouter）
│       ├── relevance.py        # 相关性计算
│       ├── dedupe.py           # 近似去重（trigram + token Jaccard）
│       ├── normalize.py        # 原始 API 响应标准化
│       ├── query.py            # 查询构建与智能简化
│       ├── query_type.py       # 意图解析（PROMPTING/RECOMMENDATIONS/NEWS/COMPARISON）
│       ├── env.py              # API Key 加载
│       ├── cache.py            # 24 小时 TTL 缓存
│       ├── http.py             # HTTP 客户端（stdlib，含重试）
│       ├── models.py           # OpenAI/xAI 模型自动选择
│       └── vendor/bird-search/ # 内置 Twitter GraphQL 客户端
├── variants/
│   └── open/                   # OpenClaw/Always-On 变体（watchlist + briefing + history）
│       ├── SKILL.md
│       ├── context.md
│       └── references/
├── tests/                      # 455+ 测试用例（32 个测试文件）
├── agents/openai.yaml          # Codex CLI 兼容元数据
├── .claude-plugin/             # Claude Code marketplace 插件配置
└── assets/                     # README 示例图片
```

## 核心架构

### 数据流

```
用户输入话题
    │
    ▼
┌─────────────────────────────────┐
│  意图解析（query_type.py）       │
│  → PROMPTING / RECOMMENDATIONS  │
│  → NEWS / COMPARISON / GENERAL  │
└─────────────┬───────────────────┘
              │
    ▼ (可选) X Handle 解析
              │
              ▼
┌─────────────────────────────────┐
│  并行搜索 Phase 1（ThreadPool） │
│  ┌────────┐ ┌────┐ ┌────────┐  │
│  │ Reddit │ │ X  │ │YouTube │  │
│  └────────┘ └────┘ └────────┘  │
│  ┌────────┐ ┌────┐ ┌────────┐  │
│  │ TikTok │ │ HN │ │Polymar.│  │
│  └────────┘ └────┘ └────────┘  │
│  ┌────────┐ ┌────┐ ┌────────┐  │
│  │Bluesky │ │Web │ │  IG    │  │
│  └────────┘ └────┘ └────────┘  │
└─────────────┬───────────────────┘
              │
              ▼
┌─────────────────────────────────┐
│  Phase 2: 补充搜索              │
│  从 Phase 1 提取 @handle、      │
│  subreddit → 定向二次搜索       │
└─────────────┬───────────────────┘
              │
              ▼
┌─────────────────────────────────┐
│  标准化 → 评分 → 去重 → 排序   │
│  normalize → score → dedupe     │
└─────────────┬───────────────────┘
              │
              ▼
┌─────────────────────────────────┐
│  渲染输出（compact/json/md）    │
│  + 跨源收敛检测                 │
│  + 自动保存到 ~/Documents/      │
└─────────────────────────────────┘
```

### 评分系统

这是 last30days 的核心竞争力——不只是搜，而是**排序**。

**三维评分权重**（Reddit/X）：
| 维度 | 权重 | 说明 |
|------|------|------|
| 相关性 | 45% | 双向子串匹配 + 同义词扩展 + token 重叠 |
| 时效性 | 25% | 时间衰减，越新越好 |
| 互动量 | 30% | 平台特定公式（见下） |

**Reddit 互动评分公式**：
```
0.50 × log1p(score) + 0.35 × log1p(comments) + 0.05 × (upvote_ratio × 10) + 0.10 × log1p(top_comment_score)
```

**X 互动评分公式**：
```
0.55 × log1p(likes) + 0.25 × log1p(reposts) + 0.15 × log1p(replies) + 0.05 × log1p(quotes)
```

**Polymarket 专用 5 因子评分**：文本相关性 30% + 24h 交易量 30% + 流动性深度 15% + 价格变动 15% + 结果竞争性 10%。

**跨源收敛检测**：当同一话题同时出现在 Reddit + HN + YouTube 等多个平台时，自动标记 `[also on: Reddit, HN]`，这种信号最强。

### 两大变体

| 变体 | 适用场景 | 功能 |
|------|---------|------|
| **Standard** (`SKILL.md`) | Claude Code / Codex / Gemini CLI 一次性研究 | 输入话题 → 输出报告 |
| **Open** (`variants/open/`) | OpenClaw 等 Always-On 环境 | + Watchlist 话题监控 + 定期 Briefing + 历史查询 + SQLite 持久化 |

## 核心工作流程

### 一次性研究流程

1. **意图解析**：从用户输入提取 TOPIC、TARGET_TOOL、QUERY_TYPE
2. **X Handle 解析**（可选）：如果话题可能有 X 账号，先 WebSearch 解析 handle
3. **并行搜索 Phase 1**：10+ 源同时搜索，各源独立超时控制
4. **补充搜索 Phase 2**：从 Phase 1 结果提取 @handle 和 subreddit，定向二次搜索
5. **Reddit JSON 增强**：获取真实 upvote/comment 数据
6. **标准化 → 评分 → 去重**：统一 schema → 三维评分 → trigram+token Jaccard 去重
7. **渲染报告**：合成带引用的研究报告 + 自动保存到 `~/Documents/Last30Days/`

### 对比模式（X vs Y）

当检测到 "X vs Y" 格式时，执行 **三轮并行研究**：
- Pass 1: 研究 X
- Pass 2: 研究 Y（与 Pass 1 并行）
- Pass 3: 研究 "X vs Y"（在 1+2 完成后）

最终输出包含：各自优劣、正面对比表格、数据驱动的结论。

### Watchlist 监控模式（Open 变体）

```bash
# 添加监控话题
python3 watchlist.py add "AI video tools" --weekly

# 手动运行所有监控
python3 watchlist.py run-all

# 生成简报
python3 briefing.py
```

数据持久化到 `~/.local/share/last30days/research.db`（SQLite），支持全文搜索历史研究结果。

## 安装与配置

### Claude Code 安装（推荐）

```bash
/plugin marketplace add mvanhorn/last30days-skill
/plugin install last30days@last30days-skill
```

### ClawHub 安装

```bash
clawhub install last30days-official
```

### 手动安装

```bash
git clone https://github.com/mvanhorn/last30days-skill.git ~/.claude/skills/last30days
```

### API Key 配置

```bash
mkdir -p ~/.config/last30days
cat > ~/.config/last30days/.env << 'EOF'
SCRAPECREATORS_API_KEY=...   # Reddit + TikTok + Instagram（一个 key 覆盖三个源）
AUTH_TOKEN=...               # X 搜索（从 x.com cookie 复制）
CT0=...                      # X 搜索（从 x.com cookie 复制）
BSKY_HANDLE=you.bsky.social  # Bluesky（可选）
BSKY_APP_PASSWORD=xxxx       # Bluesky（可选）
EOF
chmod 600 ~/.config/last30days/.env
```

**免费可用源**（无需 API key）：HN（Algolia）、Polymarket（Gamma）、YouTube（yt-dlp）、Reddit 公共 JSON。

### 诊断源可用性

```bash
python3 scripts/last30days.py --diagnose
```

## 使用示例

```bash
# 基础研究
/last30days AI video tools

# 指定天数
/last30days Claude Code skills --days=7

# 快速模式
/last30days best rap songs --quick

# 深度模式
/last30days Anthropic odds --deep

# 对比模式
/last30days Cursor vs Windsurf

# Agent 模式（无交互，直接输出）
/last30days plaud granola --agent
```

## 关键发现 / 学习心得

### 1. "研究即产品"的 Skill 设计范式

last30days 不是简单的 API 封装——它定义了一种**研究即产品**的 AI skill 范式：

- **SKILL.md 是灵魂**：747 行的 SKILL.md 不是文档，而是"给 AI 的操作手册"，精确控制意图解析、搜索策略、输出格式
- **Python 做重活**：评分、去重、标准化这些需要精确控制的逻辑放在 Python 脚本里，不依赖 LLM 判断
- **LLM 做合成**：最终的信息合成和报告生成交给 LLM，发挥其语言理解优势

### 2. 多信号评分是核心壁垒

同一个话题在 Reddit 有 500 upvotes、X 有 5000 likes、YouTube 有 100K views——如何比较？last30days 用 `log1p` 归一化 + 平台特定权重解决了跨平台互动量对齐问题。这不是简单的搜索聚合，而是**信息质量排序**。

### 3. 两阶段搜索策略很聪明

Phase 1 广撒网 → Phase 2 从结果中提取 @handle 和 subreddit 做定向搜索。这解决了"你不知道你不知道什么"的问题——比如搜 "Dor Brothers" 时自动发现 @thedorbrothers 账号，找到关键词搜索永远找不到的内容。

### 4. Open 变体为 Always-On 场景量身定制

Watchlist + Briefing + History 三件套把一次性研究工具变成了**持续情报系统**。特别适合 OpenClaw 这样的 always-on 环境，配合 cron 实现自动化竞品监控。

### 5. 测试覆盖率惊人

455+ 测试、32 个测试文件，覆盖从 query 解析到 score 计算到 render 输出的完整链路。对于一个 Claude Code skill 来说，这个工程质量很少见。

### 6. ScrapeCreators 一 Key 多源

一个 `SCRAPECREATORS_API_KEY` 覆盖 Reddit + TikTok + Instagram 三个源，大幅降低配置门槛。这种"少 key 多源"的设计对用户体验很重要。

## 超时控制参考

| Profile | 全局超时 | 单源超时 | HTTP | 适用场景 |
|---------|---------|---------|------|---------|
| quick | 90s | 30s | 15s | 快速扫描 |
| default | 180s | 60s | 30s | 日常研究 |
| deep | 300s | 90s | 30s | 深度分析 |

## 参考资源

- [GitHub 仓库](https://github.com/mvanhorn/last30days-skill)
- [ClawHub 页面](https://clawhub.ai/skills/last30days-official)
- [SPEC.md - 完整架构文档](https://github.com/mvanhorn/last30days-skill/blob/main/SPEC.md)
- [ScrapeCreators API](https://scrapecreators.com)（Reddit/TikTok/Instagram 数据源）
- [Polymarket Gamma API](https://gamma-api.polymarket.com)（预测市场数据，免费）
