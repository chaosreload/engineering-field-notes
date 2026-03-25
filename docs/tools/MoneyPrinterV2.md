# MoneyPrinterV2 Getting Started

> 整理日期：2026-03-25
> 仓库地址：https://github.com/FujiwaraChoki/MoneyPrinterV2

## 项目简介

**MoneyPrinterV2（MPV2）** 是一个"在线赚钱自动化"工具集，用 **本地 Ollama LLM + Selenium 浏览器自动化 + 视频生成管线**，把内容创作和推广的全流程串起来。

四大功能模块：
1. **YouTube Shorts 自动化** — AI 生成脚本 → AI 生图 → TTS → 合成视频 → 自动上传
2. **Twitter Bot** — AI 生成推文 → Selenium 自动发布 → CRON 定时发
3. **Affiliate Marketing** — 爬 Amazon 商品信息 → AI 生成营销文案 → 发 Twitter
4. **Outreach** — 爬 Google Maps 本地商家 → 提取邮箱 → 自动发冷邮件

**核心卖点**：全部在本地运行（Ollama），不依赖 OpenAI API。适合想用 AI 做内容自动化但不想付 API 费用的个人创作者。

## 项目结构

```
MoneyPrinterV2/
├── src/
│   ├── main.py              # CLI 入口：菜单驱动，选择功能模块
│   ├── classes/
│   │   ├── YouTube.py       # YouTube Shorts 全流程：选题→脚本→图片→TTS→视频→上传
│   │   ├── Twitter.py       # Twitter Bot：AI 生成推文 + Selenium 自动发布
│   │   ├── AFM.py           # Affiliate Marketing：爬 Amazon + AI 生成营销文案
│   │   ├── Outreach.py      # 冷邮件外展：Google Maps 爬虫 + 邮箱提取 + 自动发送
│   │   └── Tts.py           # TTS 封装：KittenTTS 语音合成
│   ├── llm_provider.py      # Ollama 客户端封装（模型选择 + 文本生成）
│   ├── config.py            # 配置读取（config.json）
│   ├── cache.py             # 账号/视频/推文缓存（JSON 文件持久化）
│   ├── cron.py              # CRON 任务入口（schedule 库）
│   ├── constants.py         # 常量定义（菜单选项、DOM selector）
│   ├── utils.py             # 工具函数（文件清理、歌曲下载、URL 构建）
│   └── status.py            # 彩色终端输出（info/success/warning/error）
├── docs/
│   ├── Configuration.md     # 完整配置说明
│   ├── YouTube.md           # YouTube 模块文档
│   ├── TwitterBot.md        # Twitter 模块文档
│   ├── AffiliateMarketing.md # 联盟营销模块文档
│   └── Roadmap.md           # 路线图
├── fonts/                   # 字幕字体文件
├── scripts/                 # 便捷脚本（本地 setup、视频上传）
├── config.example.json      # 配置模板
└── requirements.txt         # Python 依赖（~15 个包）
```

## 核心架构

```
┌─────────────────────────────────────────────────────┐
│  main.py — CLI 菜单（交互式选择功能模块）            │
└──────┬──────┬──────┬──────┬─────────────────────────┘
       │      │      │      │
       ▼      ▼      ▼      ▼
  YouTube  Twitter   AFM   Outreach
       │      │      │      │
       └──┬───┴──┬───┘      │
          │      │           │
          ▼      ▼           ▼
    ┌──────────┐  ┌──────────────────┐
    │  Ollama  │  │  Google Maps     │
    │  (本地)  │  │  Scraper (Go)    │
    └────┬─────┘  └────────┬─────────┘
         │                 │
    文本生成               商家数据
    (脚本/推文/文案)       (CSV + 邮箱)
         │                 │
    ┌────┴──────────┐   ┌──┴──────────┐
    │ Nano Banana 2 │   │  yagmail    │
    │ (Gemini API)  │   │  (SMTP)     │
    │ → AI 生图     │   │  → 发邮件   │
    └────┬──────────┘   └─────────────┘
         │
    ┌────┴──────────┐
    │  KittenTTS    │  ← 本地 TTS（无需 API）
    │  → 语音合成   │
    └────┬──────────┘
         │
    ┌────┴──────────┐
    │  MoviePy      │  ← 图片拼接 + 字幕 + 背景音乐
    │  → 视频合成   │
    └────┬──────────┘
         │
    ┌────┴──────────┐
    │  Selenium     │  ← Firefox 自动化
    │  → 上传/发布  │
    └───────────────┘
```

### 关键技术栈

| 组件 | 技术 | 作用 |
|------|------|------|
| LLM | Ollama（本地） | 生成脚本、推文、营销文案、图片 prompt |
| 图片生成 | Nano Banana 2（Gemini API） | 根据 prompt 生成 AI 图片 |
| TTS | KittenTTS（本地模型） | 文本转语音 |
| 字幕 | faster-whisper（本地）/ AssemblyAI | 语音转字幕（SRT 格式） |
| 视频合成 | MoviePy + ImageMagick | 图片拼接 + 字幕叠加 + 背景音乐 |
| 浏览器自动化 | Selenium + Firefox | YouTube 上传、Twitter 发推 |
| 定时任务 | schedule 库 | CRON 风格的定期自动发布 |
| 邮件 | yagmail + SMTP | 冷邮件自动发送 |
| 商家爬虫 | google-maps-scraper（Go） | 抓取本地商家信息 |

## 核心工作流程

### 1. YouTube Shorts 自动化（最核心的功能）

```
Step 1: 生成选题
  → Ollama: "为 {niche} 生成一个视频创意"
  → 输出: 一句话选题

Step 2: 生成脚本
  → Ollama: "根据选题写 {N} 句脚本"（默认 4 句）
  → 输出: 短视频旁白文本

Step 3: 生成元数据
  → Ollama: 分别生成标题（<100字符）和描述
  → 输出: {title, description}

Step 4: 生成图片
  → Ollama: 根据脚本生成 N 个图片 prompt（JSON 数组）
  → Nano Banana 2 API（Gemini）: 对每个 prompt 生成 9:16 图片
  → 保存到 .mp/ 目录

Step 5: TTS 语音合成
  → KittenTTS: 脚本文本 → WAV 音频
  → 支持 8 种声音（Bella, Jasper, Luna...）

Step 6: 字幕生成
  → faster-whisper（本地）或 AssemblyAI → SRT 字幕文件
  → srt_equalizer 均衡化字幕时长

Step 7: 视频合成
  → MoviePy 串联：
    · 图片按时长均分（总时长 = TTS 音频时长）
    · 裁剪/缩放到 1080×1920（9:16 竖屏）
    · 叠加黄色字幕（ImageMagick 渲染）
    · 混合背景音乐（10% 音量）
  → 输出 MP4

Step 8: 上传 YouTube
  → Selenium 打开 youtube.com/upload
  → 填写标题/描述 → 设置"非儿童内容" → 设为未列出 → 提交
  → 记录视频 URL 到缓存
```

### 2. Twitter Bot

```
Step 1: 配置账号
  → 提供 Firefox profile 路径（已登录 Twitter）
  → 设置话题（topic）和语言

Step 2: 生成推文
  → Ollama: "生成一条关于 {topic} 的推文，不超过 2 句"
  → 限制 260 字符

Step 3: Selenium 发布
  → 打开 x.com/compose/post
  → 找到文本框 → 输入 → 点击 Post

Step 4: 可选定时发布
  → schedule 库：每天 1/2/3 次
```

### 3. Affiliate Marketing

```
Step 1: 输入 Amazon 商品链接 + 关联 Twitter 账号
Step 2: Selenium 打开商品页 → 爬取标题 + 功能特性
Step 3: Ollama 生成营销文案（pitch）
Step 4: 通过 Twitter Bot 发布（附带联盟链接）
```

### 4. Outreach（冷邮件）

```
Step 1: 配置行业关键词（niche）
Step 2: google-maps-scraper（Go 编译）爬取商家信息 → CSV
Step 3: 对每个商家网站提取邮箱（正则匹配）
Step 4: yagmail 发送 HTML 模板邮件（支持 {{COMPANY_NAME}} 变量）
```

## 部署步骤

### 环境要求

- **Python 3.12**（必须，项目声明的版本）
- **Ollama**（本地 LLM 服务，需提前 `ollama pull llama3.2:3b` 或其他模型）
- **Firefox**（Selenium 自动化需要）
- **ImageMagick**（视频字幕渲染）
- **Go**（仅 Outreach 模块需要，用于编译 Google Maps 爬虫）

### 安装步骤

```bash
# 1. 克隆
git clone https://github.com/FujiwaraChoki/MoneyPrinterV2.git
cd MoneyPrinterV2

# 2. 配置
cp config.example.json config.json
# 编辑 config.json，填入：
#   - firefox_profile: Firefox 配置文件路径
#   - ollama_model: Ollama 模型名（如 llama3.2:3b）
#   - nanobanana2_api_key: Gemini API Key（用于生图）
#   - imagemagick_path: ImageMagick 路径

# 3. 虚拟环境
python -m venv venv
source venv/bin/activate  # Linux/macOS
# .\venv\Scripts\activate  # Windows

# 4. 安装依赖
pip install -r requirements.txt

# 5. 确保 Ollama 在运行
ollama serve &
ollama pull llama3.2:3b

# 6. 启动
python src/main.py
```

### 注意事项

- Firefox profile 需要**已登录** YouTube/Twitter，程序通过 Selenium 复用 session
- Nano Banana 2（Gemini）API key 可通过配置文件或 `GEMINI_API_KEY` 环境变量设置
- ImageMagick 必须安装，否则 MoviePy 字幕渲染会报错

## Demo 示例

### 交互式菜单

```
$ python src/main.py

============ OPTIONS ============
 1. YouTube Shorts Automation
 2. Twitter Bot
 3. Affiliate Marketing
 4. Outreach
 5. Quit
=================================

Select an option: 1

========== OLLAMA MODELS =========
 1. llama3.2:3b
 2. mistral:7b
==================================

Select a model: 1
Using model: llama3.2:3b
```

### YouTube Shorts 生成输出

```
[+] Generated Topic: "5 Mind-Blowing Facts About Deep Ocean Creatures"
[+] Generated Script: "The deep ocean holds..." (4 sentences)
[+] Generated 4 Image Prompts
[+] Generating Image using Nano Banana 2 API...
[+] Wrote image to ".mp/abc123.png"
[+] Wrote TTS to ".mp/def456.wav"
[+] Combining images...
[+] Wrote Video to ".mp/ghi789.mp4"
```

## 关键发现 / 学习心得

### 1. "全栈自动化"的典型架构

MPV2 的价值不在任何单一技术，而在于**把一个完整的内容生产流程串起来**：选题 → 脚本 → 配图 → 语音 → 视频 → 上传。每个环节用不同工具（Ollama/Gemini/KittenTTS/MoviePy/Selenium），胶水代码把它们粘在一起。这种"端到端自动化"思路很有参考价值。

### 2. 本地优先（Ollama）降低门槛

所有文本生成都走本地 Ollama，不需要 OpenAI API key。对个人用户来说，成本几乎为零（只要有 GPU 或能接受较慢的 CPU 推理）。图片生成用的 Gemini API（Nano Banana 2）有免费额度。

### 3. Selenium 自动化的脆弱性

YouTube 上传和 Twitter 发推都依赖 Selenium 操作真实浏览器 DOM。这意味着：
- **依赖 Firefox profile 的已登录状态**（不是 API 认证）
- **DOM selector 硬编码**（如 `YOUTUBE_TEXTBOX_ID = "textbox"`），平台 UI 改版就会挂
- **无错误恢复机制**（YouTube 上传的 `except` 直接 `return False`）

这种方式适合个人小规模使用，不适合生产级部署。

### 4. 代码质量——"快速原型"风格

- 无类型检查、无测试、无 CI/CD
- `main.py` 是一个 300+ 行的嵌套 if-else
- 全局状态管理（`_selected_model` 模块级变量）
- 但对于这类个人工具项目来说，"能跑就行"的策略是合理的——GitHub 9000+ 星说明需求真实存在

### 5. 与 V1 的区别

V1 使用**股票素材（stock footage）**作为视频画面，V2 改用 **AI 生成图片**。这解决了两个问题：视频更独特不容易被平台标记为重复，以及不需要付费素材库。

### 6. 有趣的"伪装"命名

图片生成 API 在代码中叫 `Nano Banana 2`，实际上就是 Google Gemini 的图片生成 API（`generativelanguage.googleapis.com/v1beta`）。配置文件中的 `nanobanana2_*` 参数对应的就是 Gemini 配置。

## 参考资源

- **GitHub 仓库**：https://github.com/FujiwaraChoki/MoneyPrinterV2
- **V1 版本**：https://github.com/FujiwaraChoki/MoneyPrinter
- **中文 Fork（MoneyPrinterTurbo）**：https://github.com/harry0703/MoneyPrinterTurbo
- **KittenTTS（TTS 引擎）**：https://github.com/KittenML/KittenTTS
- **Ollama**：https://ollama.ai
- **视频教程**：https://youtu.be/wAZ_ZSuIqfk
- **作者 X**：[@DevBySami](https://x.com/DevBySami)
