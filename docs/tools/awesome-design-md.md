# awesome-design-md Getting Started

> 整理日期：2026-04-13
> 仓库地址：https://github.com/VoltAgent/awesome-design-md

## 项目简介

**awesome-design-md** 是一个精选的 `DESIGN.md` 文件集合，灵感来源于知名品牌/产品的设计系统。核心理念很简单：

> 把一个 DESIGN.md 文件丢进你的项目根目录，告诉 AI coding agent "照这个风格建页面"，就能得到像素级还原的 UI。

这个概念由 **Google Stitch** 提出，将设计系统用纯 Markdown 描述，让 LLM 能直接理解和应用。项目由 **VoltAgent**（一个 AI agent 框架团队）维护，两周内从零到 **47K+ stars**，是 2026 年 4 月增长最快的开源项目之一。

**适合谁？**
- 用 AI agent（Claude、Cursor、Copilot、Google Stitch 等）写前端的开发者
- 想快速搭建高质量 UI 但不想从零设计的独立开发者
- 做 vibe coding 的人 —— 口述需求，AI 出设计

## 核心概念：DESIGN.md 是什么？

| 文件 | 读者 | 定义内容 |
|------|------|----------|
| `AGENTS.md` | Coding agent | 如何构建项目 |
| `DESIGN.md` | Design agent | 项目应该长什么样 |

DESIGN.md 本质是一个纯文本的设计系统规范。没有 Figma 导出、没有 JSON schema、不需要特殊工具。Markdown 是 LLM 最擅长读取的格式，所以无需额外解析。

### DESIGN.md 的 9 大标准章节

遵循 [Google Stitch DESIGN.md 格式](https://stitch.withgoogle.com/docs/design-md/format/)，每个文件包含：

| # | 章节 | 内容 |
|---|------|------|
| 1 | Visual Theme & Atmosphere | 情绪、密度、设计哲学 |
| 2 | Color Palette & Roles | 语义命名 + hex + 功能角色 |
| 3 | Typography Rules | 字体族、完整层级表 |
| 4 | Component Stylings | 按钮、卡片、输入框、导航（含各状态） |
| 5 | Layout Principles | 间距比例、网格、留白哲学 |
| 6 | Depth & Elevation | 阴影系统、层级关系 |
| 7 | Do's and Don'ts | 设计护栏和反模式 |
| 8 | Responsive Behavior | 断点、触摸目标、折叠策略 |
| 9 | Agent Prompt Guide | 快速色彩参考、即用 prompt |

## 项目结构

```
awesome-design-md/
├── README.md              # 项目介绍 + 完整收录列表
├── CONTRIBUTING.md         # 贡献指南
├── LICENSE                 # MIT
└── design-md/              # 59 个品牌设计系统
    ├── stripe/
    │   └── README.md       # → 指向 getdesign.md/stripe/design-md
    ├── linear.app/
    ├── vercel/
    ├── apple/
    ├── tesla/
    └── ...                 # 每个品牌一个子目录
```

**注意**：当前版本的 repo 中，实际 DESIGN.md 内容已迁移到 [getdesign.md](https://getdesign.md/) 网站，repo 内只保留指向链接的 README.md。完整内容需通过网站获取。

## 收录分类（66 个设计系统）

| 分类 | 品牌示例 | 数量 |
|------|----------|------|
| **AI & LLM 平台** | Claude, Ollama, xAI, VoltAgent, ElevenLabs | 12 |
| **开发者工具 & IDE** | Cursor, Raycast, Vercel, Warp, Expo | 7 |
| **后端/数据库/DevOps** | Supabase, MongoDB, Sentry, ClickHouse, PostHog | 8 |
| **生产力 & SaaS** | Linear, Notion, Resend, Zapier, Cal.com | 7 |
| **设计 & 创意工具** | Figma, Framer, Webflow, Miro, Airtable | 6 |
| **金融科技 & 加密** | Stripe, Coinbase, Revolut, Binance, Wise | 6 |
| **电商 & 零售** | Airbnb, Nike, Shopify, Meta | 4 |
| **媒体 & 消费科技** | Apple, Spotify, SpaceX, Uber, NVIDIA, WIRED | 10 |
| **汽车** | Tesla, BMW, Ferrari, Lamborghini, Bugatti, Renault | 6 |

## 以 Stripe 为例：一个 DESIGN.md 的深度

以 Stripe 的 DESIGN.md 为例（~500 行），展示其精细程度：

### 视觉氛围描述

> "Stripe's website is the gold standard of fintech design — a system that manages to feel simultaneously technical and luxurious. The custom `sohne-var` variable font at weight 300 creates an ethereal, almost whispered authority. This is the opposite of the 'bold hero headline' convention; Stripe's headlines feel like they don't need to shout."

### 色彩系统（精确到阴影层）

```
- Stripe Purple: #533afd (CTA、链接、交互高亮)
- Deep Navy: #061b31 (标题 —— 不是黑色，是深蓝)
- Shadow Blue: rgba(50,50,93,0.25) (招牌蓝色调多层阴影)
- Shadow Black: rgba(0,0,0,0.1) (深度增强层)
```

### 字体层级表（15+ 级别）

从 56px Display Hero（weight 300, letter-spacing -1.4px）到 8px Nano，每一级都有精确的 size/weight/line-height/letter-spacing/OpenType feature 参数。

### 组件规范

按钮 4 种变体（Primary Purple / Ghost / Transparent Info / Neutral Ghost），每种都有 background、text、padding、radius、hover 状态的完整定义。

**这就是 DESIGN.md 的力量 —— AI agent 拿到这份文件后，生成的 UI 不是"差不多像 Stripe"，而是能精确到阴影颜色和字重。**

## 使用方式

```bash
# 1. 复制一个品牌的 DESIGN.md 到你的项目根目录
cp design-md/stripe/DESIGN.md ./DESIGN.md

# 2. 在 AI coding agent 中使用
# Cursor / Claude / Copilot / Google Stitch 等
"按照 DESIGN.md 中的设计系统，给我建一个定价页面"
```

也可以混搭：
```
"用 Linear 的布局 + Stripe 的配色，建一个 dashboard"
```

## 关键发现 / 学习心得

### 1. DESIGN.md 是 vibe coding 的"类型系统"

如果说 `AGENTS.md` 告诉 AI "怎么写代码"，`DESIGN.md` 就是告诉 AI "写出来的东西长什么样"。这两个文件的组合让 AI coding agent 从"能跑"进化到"能看"。

### 2. 增长密码：Google Stitch 引爆 + 实用主义

项目 3/31 创建，两周 47K stars。成功因素：
- **踩中 Google Stitch 发布的时间窗口** —— DESIGN.md 概念由 Google 正式提出
- **极低使用门槛** —— 复制一个文件，不需要学任何新工具
- **awesome-list 模式** —— 熟悉的社区模式，易于理解和传播
- **VoltAgent 团队的运营能力** —— 迅速建了 getdesign.md 网站 + request 功能

### 3. 内容已从 repo 迁移到网站

值得注意的是，实际的 DESIGN.md 内容已经从 GitHub repo 迁移到 [getdesign.md](https://getdesign.md/) 网站。repo 变成了一个索引/导航层。这是一个常见的开源项目商业化路径 —— 用开源获取流量，用网站做商业闭环（比如 private request 功能）。

### 4. 对 AI agent 生态的启示

DESIGN.md 模式揭示了一个趋势：**AI 时代的"配置文件"正在从机器语言（JSON/YAML）转向自然语言（Markdown）**。AGENTS.md、CLAUDE.md、DESIGN.md —— 这些都是面向 AI 的"说明书"，而不是面向解析器的配置。

### 5. 实用建议

- **最值得参考的设计系统**：Stripe（精细度最高）、Linear（极简标杆）、Vercel（黑白精准）
- **中文/CJK 场景**：可以看看 [awesome-design-md-jp](https://github.com/kzhrknt/awesome-design-md-jp)（448 stars），针对日文排版做了 CJK 适配
- **自己的项目**：不一定要用现成的，可以参照格式为自己的设计系统写一份 DESIGN.md

## 参考资源

- [Google Stitch - DESIGN.md 概念文档](https://stitch.withgoogle.com/docs/design-md/overview/)
- [getdesign.md - 完整 DESIGN.md 在线浏览](https://getdesign.md/)
- [VoltAgent - 项目背后的 AI Agent 框架](https://github.com/VoltAgent/voltagent)
- [awesome-design-md-jp - 日文/CJK 适配版](https://github.com/kzhrknt/awesome-design-md-jp)
- [awesome-design-md-skills - Agent 工具集成](https://github.com/bergside/awesome-design-md-skills)
