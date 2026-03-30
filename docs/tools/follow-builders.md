# follow-builders Getting Started

> 整理日期：2026-03-30
> 仓库地址：https://github.com/zarazhangrui/follow-builders

## 项目简介

**Follow Builders, Not Influencers** 是一个 AI 驱动的信息摘要工具，追踪 AI 行业真正在做事的人（研究者、创始人、PM、工程师），将他们在 X/Twitter、YouTube 播客和公司官方博客上的内容汇总成每日/每周摘要。

核心理念：**关注真正在 build 的人，而非转述信息的 influencer。**

适合场景：
- AI 从业者想高效追踪行业动态
- 团队希望自动化信息搜集和分发
- 不想逐个刷 X/YouTube，但想知道关键人物在聊什么

## 项目结构

```
follow-builders/
├── SKILL.md                     # Agent skill 定义（完整的 onboarding + 工作流指令）
├── README.md / README.zh-CN.md  # 项目说明
├── config/
│   ├── default-sources.json     # 信息源配置（25 个 X 账号 + 6 个播客 + 2 个博客）
│   └── config-schema.json       # 用户配置 JSON Schema
├── prompts/                     # LLM remix 指令（纯英文，可自定义）
│   ├── digest-intro.md          # 摘要整体格式和规则
│   ├── summarize-tweets.md      # X/Twitter 帖子摘要方式
│   ├── summarize-podcast.md     # 播客转写摘要方式
│   ├── summarize-blogs.md       # 博客文章摘要方式
│   └── translate.md             # 中文翻译指令
├── scripts/                     # Node.js 脚本
│   ├── generate-feed.js         # 中央 feed 生成器（GitHub Actions 运行）
│   ├── prepare-digest.js        # 客户端预处理（拉取 feed + prompts + config）
│   ├── deliver.js               # 投递脚本（Telegram / Email / stdout）
│   └── package.json             # 依赖：dotenv + proper-lockfile
├── feed-x.json                  # X/Twitter feed（GitHub Actions 每日更新）
├── feed-podcasts.json           # 播客 feed
├── feed-blogs.json              # 博客 feed
├── state-feed.json              # 去重状态（已处理的 tweet ID / video ID / article URL）
├── examples/
│   └── sample-digest.md         # 示例输出
└── .github/workflows/
    └── generate-feed.yml        # GitHub Actions 自动化
```

## 核心架构

```
┌─────────────────────────────────────────────────────────┐
│                    GitHub Actions (每日 6am UTC)          │
│                                                          │
│  generate-feed.js                                        │
│  ├─ X API v2 → 25 个 builder 最新推文 → feed-x.json     │
│  ├─ Supadata API → 6 个播客最新转写 → feed-podcasts.json │
│  ├─ HTML scraping → 2 个博客最新文章 → feed-blogs.json   │
│  └─ state-feed.json 去重（7 天窗口自动清理）             │
│                                                          │
│  产出 commit 到 GitHub repo main 分支                    │
└─────────────────────────────────────────────────────────┘
                          │
                          │ raw.githubusercontent.com
                          ▼
┌─────────────────────────────────────────────────────────┐
│              用户侧 Agent（OpenClaw / Claude Code）       │
│                                                          │
│  prepare-digest.js                                       │
│  ├─ 从 GitHub 拉取三个 feed JSON                        │
│  ├─ 加载 prompts（用户自定义 > GitHub 最新 > 本地默认）  │
│  ├─ 读取 ~/.follow-builders/config.json                  │
│  └─ 输出单一 JSON blob（所有内容 + prompts + config）    │
│                                                          │
│  Agent (LLM)                                             │
│  ├─ 读取 JSON blob                                       │
│  ├─ 按 prompts 指令 remix 内容                           │
│  └─ 输出格式化的摘要文本                                 │
│                                                          │
│  deliver.js                                              │
│  ├─ stdout → 直接输出                                    │
│  ├─ telegram → Telegram Bot API                          │
│  └─ email → Resend API                                   │
└─────────────────────────────────────────────────────────┘
```

**关键设计决策：中央化 feed + 客户端 remix**

- **用户无需任何 API Key**（X API、Supadata 密钥在 GitHub Actions 的 secrets 里）
- 唯一 HTTP 请求是从 `raw.githubusercontent.com` 拉 JSON，不存在调用限额问题
- LLM 做"最后一公里"的 remix，内容聚合完全由确定性脚本完成
- 投递仅在用户选择 Telegram/Email 时需要额外密钥

## 核心工作流程

### 1. Feed 生成（服务端，GitHub Actions）

每日 6am UTC 自动运行 `generate-feed.js`：

1. **X/Twitter**：通过 X API v2 批量查询 25 个账号，拉取过去 24 小时推文（最多每人 3 条，排除转推/回复）
2. **播客**：通过 Supadata API 获取 YouTube 频道/播放列表最新视频 ID，选取最旧的未处理视频获取完整转写（72 小时窗口）
3. **博客**：HTML 抓取 Anthropic Engineering 和 Claude Blog 首页，解析文章链接并获取全文（72 小时窗口）
4. **去重**：通过 `state-feed.json` 记录已处理的 tweet ID / video ID / article URL，7 天自动清理
5. **提交**：将 feed JSON 和 state 文件 commit + push 到 repo

### 2. Digest 准备（客户端）

用户 agent 运行 `prepare-digest.js`：

1. 从 GitHub raw 拉取三个 feed JSON
2. 按优先级加载 prompts：`~/.follow-builders/prompts/` > GitHub 最新 > 本地默认
3. 读取 `~/.follow-builders/config.json` 获取语言/投递偏好
4. 组装单一 JSON blob 输出到 stdout

### 3. LLM Remix

Agent 读取 JSON blob，按 prompts 指令将原始内容 remix 成可读摘要：
- 推文：按 builder 分组，提炼关键观点，附原始链接
- 播客：200-400 字的精华提炼，含直接引用
- 博客：100-300 字的核心要点总结
- 语言：根据 config 输出英文/中文/双语交替

### 4. 投递

通过 `deliver.js` 发送：
- **stdout**：直接输出（OpenClaw 自动路由到用户的消息渠道）
- **Telegram**：Bot API 发送（自动分段处理 4096 字符限制，Markdown 失败自动降级纯文本）
- **Email**：Resend API 发送

## 部署步骤

### 依赖安装

```bash
cd follow-builders/scripts
npm install
# 依赖极少：dotenv + proper-lockfile，共 5 个包
```

### 运行 prepare-digest（验证）

```bash
cd scripts && node prepare-digest.js 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'Status: {d[\"status\"]}')
print(f'X builders: {d[\"stats\"][\"xBuilders\"]}')
print(f'Total tweets: {d[\"stats\"][\"totalTweets\"]}')
print(f'Podcast episodes: {d[\"stats\"][\"podcastEpisodes\"]}')
print(f'Blog posts: {d[\"stats\"][\"blogPosts\"]}')
"
```

实测结果（2026-03-30）：
```
Status: ok
X builders: 13
Total tweets: 27
Podcast episodes: 0
Blog posts: 0
```

feed 由 GitHub Actions 于 2026-03-29 07:01 UTC 生成，用户侧无需任何配置即可拉取。

### OpenClaw 安装与配置

```bash
# 克隆到 skills 目录
git clone https://github.com/zarazhangrui/follow-builders.git ~/skills/follow-builders
cd ~/skills/follow-builders/scripts && npm install

# 首次运行，agent 会引导你完成 onboarding：
# - 选择投递频率（daily/weekly）
# - 选择语言（en/zh/bilingual）
# - OpenClaw 自动检测渠道，无需手动配置投递方式
# - 设置 cron 定时任务
```

## Demo 示例

以下是从实际 feed 数据生成的摘要片段（截取自 feed-x.json）：

**Andrej Karpathy 的观察：**

> "Drafted a blog post → Used an LLM to improve the argument over 4 hours → Feeling great → Asked it to argue the opposite → LLM demolishes the entire argument → lol"

Karpathy 发现 LLM 在辩论方向上极为灵活——它可以说服你相信任何方向。这是一个超级有用的思维工具，但要小心谄媚效应。

来源：https://x.com/karpathy/status/2037921699824607591
点赞 23,516 | 转发 1,786

---

**Swyx 论"虚假等价"陷阱：**

> "False equivalence killed my first devtools startup... Most school systems, bureaucrats, managers, and content curators are not set up for one thing to matter 50x more than the next thing."

核心规则：精心下注极少数事情；不对冲，但保持可逆性；设置监控触发器；如果比预期更对，尽早加倍投入。

来源：https://x.com/swyx/status/2037969691910848941
点赞 255 | 转发 21

## 关键发现 / 学习心得

### 1. 架构精妙：中央化 feed 解决了 API Key 分发难题

传统做法是每个用户自己配 API Key 调用 X API / YouTube API。follow-builders 把数据抓取放到 GitHub Actions，用户只需 HTTP GET 一个 JSON 文件。**零配置，零依赖，零成本。** 这是面向 agent skill 生态的最佳实践。

### 2. "LLM 做最后一公里 remix" 的范式

脚本负责确定性的数据抓取、去重、组装；LLM 负责把原始数据 remix 成人话。两者分工明确：
- 脚本保证数据质量（不重复、有来源、有时间窗口）
- LLM 保证可读性（提炼要点、调整语气、多语言）

这个模式适用于任何 "数据聚合 + 内容生成" 场景。

### 3. Prompt 即配置

5 个 prompts 文件就是 "摘要风格" 的全部控制面板：
- 修改 `summarize-tweets.md` → 改变推文摘要方式
- 修改 `translate.md` → 改变翻译风格
- 用户覆盖优先于远程更新（`~/.follow-builders/prompts/` > GitHub）

不需要代码改动，纯自然语言配置。

### 4. 去重设计值得借鉴

`state-feed.json` 用 `{id: timestamp}` 的简单结构做去重，7 天自动清理老条目。每天运行不会重复推送同一条推文，但也不会无限膨胀。比 database 或 bloom filter 简单得多，完全适合这个量级。

### 5. 博客抓取的多层回退策略

抓取 Anthropic Engineering 博客时，依次尝试：
1. Next.js `__NEXT_DATA__` JSON → 最精确
2. 正则匹配 HTML 链接 → 兜底
3. 文章正文：先试 Sanity CMS portable text → 再试 `<article>` 标签 → 最后全页 strip HTML

这种"逐层降级"的爬虫策略在面对不同网站架构时很实用。

## 与 Scout 监控列表的交叉参考

follow-builders 追踪的 25 个账号中，与 Scout 现有 X 监控列表（`sources/x-watchlist.md`）重叠的：
- @karpathy ✅
- @sama ✅

可以补充的高价值账号（follow-builders 有但 Scout 没有）：
- @swyx（Latent Space 主播，AI 工程社区核心人物）
- @rauchg（Vercel CEO，前端 + AI 交叉领域风向标）
- @amasad（Replit CEO，AI coding 方向关键人物）
- @AmandaAskell（Anthropic，AI safety + alignment 视角）
- @levie（Box CEO，企业 AI 应用方向）
- @steipete（PSPDFKit 创始人，独立开发者 + AI 工具用户视角）

## 参考资源

- [GitHub 仓库](https://github.com/zarazhangrui/follow-builders)
- [中文 README](https://github.com/zarazhangrui/follow-builders/blob/main/README.zh-CN.md)
- [示例 Digest 输出](https://github.com/zarazhangrui/follow-builders/blob/main/examples/sample-digest.md)
- [Supadata API](https://supadata.ai/)（YouTube 转写服务）
- [Resend](https://resend.com/)（邮件投递服务）
- [X API v2 文档](https://developer.x.com/en/docs/twitter-api)
