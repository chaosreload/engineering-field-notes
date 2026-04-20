# Pixelle-Video Getting Started

> 整理日期：2026-04-20  
> 仓库地址：https://github.com/AIDC-AI/Pixelle-Video  
> ⭐ 4.5k · Apache 2.0 · Python 3.11+ · 出品方：阿里国际 AIDC-AI  
> 官方文档：<https://aidc-ai.github.io/Pixelle-Video/zh>

## 项目简介

Pixelle-Video 是阿里国际 AIDC-AI 团队开源的"AI 全自动短视频引擎"。一句话定位：**输入一个主题，它吐出一条可发布的短视频**。LLM 写文案、ComfyUI 画图/出视频、TTS 配音、HTML 模板做画面合成、moviepy 拼接成片，全流程零人工剪辑。

它不是又一个"视频剪辑 SaaS 套壳"，而是一个**工作流编排引擎**：LLM 做上层编排（主题 → 文案 → 分镜 → 图像 prompt），ComfyUI 做底层原子能力（文生图、图生视频、TTS、声音克隆、动作迁移），Streamlit 做 Web 前台，FastAPI 提供 REST API。

它和 MoneyPrinterTurbo / NarratoAI 这类"短视频脚本批量生成器"的真正差别，是**把 ComfyUI 当作可插拔后端**——项目里 20+ 个工作流 JSON（`workflows/selfhost/` + `workflows/runninghub/`）可以随便换，FLUX、Qwen-Image、WAN 2.1/2.2、Nano Banana、SD3.5、Index-TTS、Edge-TTS、Spark-TTS…… 任何在 ComfyUI 上能跑的模型，这里都能直接拿来用。

适合的场景：

- 个人 / MCN 团队批量生产知识科普、影视解说、人文纪实类竖屏短视频
- 想在 ComfyUI 之上做二次封装但不想从零搭编排层的开发者
- 需要一个"LLM 编排 + ComfyUI 执行"参考实现的工程师

**不适合**：高端影视级 TTS（效果还是明显合成腔）、需要精细时间轴剪辑、要求原生 Sora/Kling 级画质的场景。

## 项目结构

```
Pixelle-Video/
├── pixelle_video/          # 核心 Python 包
│   ├── service.py          # PixelleVideoCore：统一入口，装配所有能力
│   ├── pipelines/          # 视频生成 pipeline（核心）
│   │   ├── base.py         # BasePipeline 抽象
│   │   ├── linear.py       # LinearVideoPipeline + PipelineContext（模板方法）
│   │   ├── standard.py     # 默认 pipeline：topic → narration → frames → video
│   │   ├── asset_based.py  # 用户上传素材驱动的 pipeline
│   │   └── custom.py       # 自定义 pipeline 骨架
│   ├── services/           # 原子能力服务
│   │   ├── llm_service.py          # OpenAI SDK 兼容层
│   │   ├── tts_service.py          # 封装 ComfyUI TTS 工作流
│   │   ├── media.py                # 封装 ComfyUI 图像/视频工作流
│   │   ├── comfy_base_service.py   # 公共基类（ComfyKit 调用 + workflow 发现）
│   │   ├── frame_processor.py      # 单帧四步处理（音频/媒体/合成/片段）
│   │   ├── frame_html.py           # Playwright 渲染 HTML 模板为图像
│   │   ├── video.py                # moviepy 最终拼接
│   │   └── history_manager.py      # 任务历史持久化
│   ├── models/             # Pydantic schema（Storyboard / Frame / Progress）
│   ├── prompts/            # LLM 提示词模板
│   ├── utils/              # 内容生成工具（generate_title / narrations / prompts）
│   ├── llm_presets.py      # 主流 LLM 预设（Qwen/GPT/DeepSeek/Ollama/Claude...）
│   └── tts_voices.py       # TTS 音色清单
├── web/                    # Streamlit Web UI
│   ├── app.py              # 入口
│   └── pipelines/          # 每个 pipeline 对应一个 PipelineUI
│       ├── standard.py             # 标准 AI 全自动
│       ├── asset_based.py          # 自定义素材驱动
│       ├── digital_human.py        # 数字人口播
│       ├── i2v.py                  # 图生视频
│       └── action_transfer.py      # 动作迁移
├── api/                    # FastAPI REST 层（对应 Web UI 的所有能力）
├── workflows/              # ComfyUI 工作流 JSON 库
│   ├── selfhost/           # 本地 ComfyUI 跑的工作流（image_flux / tts_edge / wan2.1 ...）
│   └── runninghub/         # RunningHub 云端跑的工作流（20+ 个）
├── templates/              # HTML 视频画面模板（1080x1920 / 1920x1080 / 1080x1080）
│   ├── image_default.html
│   ├── video_*.html
│   └── static_*.html
├── bgm/                    # 内置背景音乐
├── docker-compose.yml      # Init + API + Web 三服务
├── config.example.yaml     # 配置样板
└── pyproject.toml          # 依赖（streamlit / fastapi / comfykit / openai / moviepy / playwright）
```

核心包规模：`gitnexus analyze` 统计 **846 节点 / 2199 边 / 83 簇 / 57 flow**，代码体量中等但分层清晰。

## 核心架构

Pixelle-Video 的架构可以用一句话概括：

> **`PixelleVideoCore`（服务装配器）+ `LinearVideoPipeline`（模板方法编排）+ `ComfyBaseService`（ComfyUI 工作流适配层）**

三层职责分明：

```
┌──────────────────────────────────────────────────────────────────┐
│  Web UI (Streamlit)        API (FastAPI)                         │
│  web/pipelines/*.py        api/routers/*.py                      │
│  用户交互 + 文件上传 + 参数表单        REST 调用 + 任务队列          │
└────────────────────────┬─────────────────────────────────────────┘
                         │  调用
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Pipeline 编排层 (pixelle_video/pipelines/)                      │
│                                                                  │
│  BasePipeline (抽象)                                             │
│    └─ LinearVideoPipeline (模板方法 6 阶段)                       │
│         ├─ StandardPipeline       # topic → video                │
│         ├─ AssetBasedPipeline     # 用户素材 → video              │
│         └─ CustomPipeline         # 用户自定义                    │
└────────────────────────┬─────────────────────────────────────────┘
                         │  调用 self.core
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Service 原子能力层 (pixelle_video/services/)                    │
│                                                                  │
│  LLMService ──────────────► OpenAI SDK (Qwen/GPT/DS/Ollama)      │
│                                                                  │
│  TTSService ──┐                                                  │
│  MediaService ├──► ComfyBaseService ──► ComfyKit                 │
│  VideoService │                          │                       │
│               ├──► FrameProcessor        ▼                       │
│               │    (4-step per frame)  ComfyUI API / RunningHub  │
│               │                                                  │
│               └──► HTMLFrameGenerator ──► Playwright (Chromium)  │
└──────────────────────────────────────────────────────────────────┘
```

### 几个值得记住的设计细节

**1. `LinearVideoPipeline` 用模板方法把"topic → video"拆成 6 阶段 8 步**（`pipelines/linear.py`）：

```
setup_environment     # 建任务目录、task_id
generate_content      # LLM 生成 narration 列表
determine_title       # LLM 生成/确定标题
plan_visuals          # LLM 为每句 narration 生成 image_prompt
initialize_storyboard # 构建 Storyboard 数据结构
produce_assets        # 🔥 核心：每个 frame 跑 FrameProcessor
post_production       # moviepy 拼接 + BGM 混音
finalize              # 返回 VideoGenerationResult
```

子类只需要重写其中几步就能扩展——这套模板在 `StandardPipeline` 和 `AssetBasedPipeline` 里都被复用。

**2. `FrameProcessor` 每帧跑四步流水线**（`services/frame_processor.py`）：

```
Frame(index, narration, image_prompt)
   │
   ├─ Step 1: TTS 生成音频       → frame.audio_path  (via ComfyUI TTS workflow)
   ├─ Step 2: 生成媒体            → frame.image_path / video_path  (via ComfyUI image/video workflow)
   ├─ Step 3: HTML 模板合成静态帧  → frame.composed_image_path  (Playwright 渲染 templates/*.html)
   └─ Step 4: 合成带音轨的视频片段 → frame.video_segment_path  (ffmpeg/moviepy)
```

**3. HTML + Playwright 做画面合成**是整个项目最聪明的工程决策。

传统做法（PIL/moviepy 手动画字幕 / 蒙版）写死在 Python 里，美工调样式要改代码；Pixelle-Video 把每一帧当作一个带数据绑定的 HTML 页面（`templates/1080x1920/image_default.html`），用 Playwright 无头浏览器截成 PNG，然后塞进视频。好处：前端设计师不懂 Python 也能出模板；模板热插拔；CSS 动画、渐变、字体排版都能直接用 Web 能力实现。`templates/` 目录按分辨率分三档（竖屏 1080x1920、横屏 1920x1080、方形 1080x1080），每档 5–10 套风格。

**4. ComfyUI 抽象得很薄**（`services/comfy_base_service.py`）。

`ComfyBaseService` 只做两件事：从 `workflows/{selfhost,runninghub}/{prefix}_*.json` 发现可用工作流，把 pipeline 参数塞进 JSON 的几个固定节点位置然后提交给 ComfyKit。`TTSService` / `MediaService` 只给它配一组 `WORKFLOW_PREFIX` + `DEFAULT_WORKFLOW` 就够了——要加一种新能力（比如视频理解），在 `workflows/` 丢一个 JSON、继承 `ComfyBaseService` 就完事。这种"**把 ComfyUI 当 Function Registry 用**"的思路是从姊妹项目 [Pixelle-MCP](https://github.com/AIDC-AI/Pixelle-MCP) 继承下来的。

**5. 本地 vs 云端双后端**。

工作流名里带前缀 `selfhost/` 就走本地 ComfyUI（`http://127.0.0.1:8188`），带 `runninghub/` 就走 [RunningHub](https://www.runninghub.ai/) 云端 GPU。runninghub 后端支持并发（`runninghub_concurrent_limit` 1–10），`produce_assets` 会自动切到 `asyncio.Semaphore` 并行跑每帧——**这一点对没显卡的用户非常友好**，也让 Pixelle-Video 可以一键在普通云主机上部署。

## 核心工作流程

以最常用的 `StandardPipeline`（AI 全自动模式）为例，完整数据流：

```
用户在 Web UI 输入主题「如何理解反脆弱」
            │
            ▼
┌────────────────────────────────────────────────────────────────┐
│ Phase 1: Preparation                                           │
│   setup_environment → 创建 output/<task_id>/ 目录               │
└────────────────────────────────────────────────────────────────┘
            │
            ▼
┌────────────────────────────────────────────────────────────────┐
│ Phase 2: Content Creation (LLM 主导)                           │
│   generate_content:                                            │
│     LLM("用主题'反脆弱'写一段 300 字的短视频解说词")            │
│     → narration_script                                         │
│     split_narration_script → ["第一句...", "第二句...", ...]    │
│                                                                │
│   determine_title:                                             │
│     LLM("给这段解说词起一个抓眼球的标题")                         │
│     → title                                                    │
└────────────────────────────────────────────────────────────────┘
            │
            ▼
┌────────────────────────────────────────────────────────────────┐
│ Phase 3: Visual Planning (LLM 主导)                            │
│   plan_visuals:                                                │
│     对每条 narration 调 LLM：                                   │
│       "给这句话生成一个英文绘画 prompt"                           │
│     → image_prompts = [p1, p2, p3, ...]                        │
│                                                                │
│   initialize_storyboard:                                       │
│     构建 Storyboard{frames=[Frame(narration, image_prompt)]}   │
└────────────────────────────────────────────────────────────────┘
            │
            ▼
┌────────────────────────────────────────────────────────────────┐
│ Phase 4: Asset Production (ComfyUI 主导，可并行)                │
│   produce_assets:                                              │
│     for frame in frames  (如果是 runninghub 且 concurrent>1，   │
│                            用 Semaphore 并行):                  │
│       FrameProcessor(frame):                                   │
│         1. TTS     → ComfyUI(tts_edge / tts_index2)  → audio   │
│         2. Image   → ComfyUI(image_flux / qwen / sd)  → png    │
│            Video   → ComfyUI(video_wan2.1_fusionx)    → mp4    │
│         3. HTML 模板 + Playwright 截图 → composed.png           │
│         4. ffmpeg 拼字幕 + 音频          → segment.mp4          │
└────────────────────────────────────────────────────────────────┘
            │
            ▼
┌────────────────────────────────────────────────────────────────┐
│ Phase 5: Post Production                                       │
│   post_production:                                             │
│     moviepy.concat_videoclips(segments)                        │
│     + BGM audio mix                                            │
│     → final.mp4                                                │
└────────────────────────────────────────────────────────────────┘
            │
            ▼
        VideoGenerationResult{video_path, duration, frames, ...}
```

几个容易漏掉的点：

- **LLM 被调用 3 次，不是 1 次**：文案、标题、每帧的 image_prompt 都是独立调用，所以总 token 消耗比直觉高（一个 5–8 分镜的视频通常 2–4k token）。
- **RunningHub 并发是整条流水线唯一的并行点**，本地 ComfyUI 因为单 GPU 只能串行。
- **所有工作流文件都是普通的 ComfyUI 导出 JSON**，运维/玩家可以在 ComfyUI 里改了再导出覆盖，完全不用改 Python 代码。

## 部署步骤

> **状态说明**：dev-server 没有 GPU，所以本次没有执行完整的本地推理链路跑通，只做了源码解读 + 部署路径验证。RunningHub 云端方案在无 GPU 环境下完全可行（本文档对此路径做了完整梳理）；本地 GPU 方案给出命令但未实测。

### 路径 A：RunningHub 云端方案（推荐，零 GPU 可跑）

这是最适合个人开发者和没有显卡的人的方案。只要有一个 LLM API Key（通义千问最便宜）+ 一个 RunningHub API Key，就能全云端跑。

```bash
# 1. 装前置
# uv: https://docs.astral.sh/uv/getting-started/installation/
curl -LsSf https://astral.sh/uv/install.sh | sh

# ffmpeg（Linux）
sudo apt-get update && sudo apt-get install -y ffmpeg fontconfig fonts-liberation fonts-noto-cjk

# 2. 克隆 + 配置
git clone https://github.com/AIDC-AI/Pixelle-Video.git
cd Pixelle-Video
cp config.example.yaml config.yaml
# 编辑 config.yaml，填：
#   llm.api_key / llm.base_url / llm.model         （例：Qwen qwen-max）
#   comfyui.runninghub_api_key                     （去 runninghub.ai 注册）
#   comfyui.tts.default_workflow: runninghub/tts_edge.json
#   comfyui.image.default_workflow: runninghub/image_flux.json
#   comfyui.video.default_workflow: runninghub/video_wan2.1_fusionx.json

# 3. 一键启动（uv 自动装依赖 + Playwright Chromium）
uv run streamlit run web/app.py
# 浏览器打开 http://localhost:8501
```

首次启动会下载 Chromium（约 150MB）。依赖全装完约 1–2 GB 磁盘占用。

### 路径 B：本地 ComfyUI 方案（需要 NVIDIA GPU，≥ 12GB 显存更稳）

```bash
# 1. 先单独部署 ComfyUI，把需要的模型（FLUX / WAN 2.1 / Edge-TTS / ...）下好
#    ComfyUI 跑在 http://127.0.0.1:8188

# 2. config.yaml 里：
#    comfyui.comfyui_url: http://127.0.0.1:8188
#    *.default_workflow 全改成 selfhost/ 前缀

# 3. uv run streamlit run web/app.py
```

需要的模型粗估：FLUX.1-dev（约 24GB）+ WAN 2.1（约 14GB）+ TTS 模型若干，全套 60–80GB 存储。

### 路径 C：Docker Compose（开箱即用的 API + Web）

```bash
cd Pixelle-Video
# 大陆环境用 Tsinghua 镜像加速依赖下载
USE_CN_MIRROR=true docker compose up -d
```

会起三个服务：`init`（生成 config.yaml）+ `api`（FastAPI）+ `web`（Streamlit）。

### 路径 D：Windows 一键整合包

直接在 Releases 下载 zip，解压双击 `start.bat`。适合非技术用户演示。

### 没做到的事（本次）

- 没真实跑出一条视频（没 GPU + 没 RunningHub key）
- 没验证 `runninghub_concurrent_limit=3` 这类并发参数的实际效果
- 没测试数字人口播 / 动作迁移这两个扩展 pipeline 的产出质量

## Demo 示例

> ⚠️ **下面的代码 / JSON 是"假设已部署完"的调用示例和工作流参考，本次未实际运行**。

### 调用方式 1：REST API（FastAPI）

项目的 `api/` 目录暴露了完整的 REST 接口。启动后 `http://localhost:8000/docs` 有 Swagger UI。

```bash
# 异步创建视频任务
curl -X POST http://localhost:8000/api/v1/video/generate \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "ai_generate",
    "topic": "如何理解反脆弱",
    "template": "1080x1920/image_default.html",
    "bgm": "default.mp3",
    "image_prompt_prefix": "Minimalist black-and-white matchstick figure style"
  }'
# → {"task_id": "t_20260420_abc123"}

# 轮询进度
curl http://localhost:8000/api/v1/video/task/t_20260420_abc123
# → {"status": "processing", "progress": 0.42, "step": "processing_frame", "frame_current": 3, "frame_total": 6}

# 拿最终视频
curl -O http://localhost:8000/api/v1/video/task/t_20260420_abc123/download
```

### 调用方式 2：Python 直接调用 Core

```python
import asyncio
from pixelle_video import pixelle_video

async def main():
    await pixelle_video.initialize()

    def on_progress(event):
        print(f"[{event.event_type}] {event.progress*100:.0f}% {event.action or ''}")

    result = await pixelle_video.pipelines.standard(
        text="如何理解反脆弱",
        progress_callback=on_progress,
        template="1080x1920/image_default.html",
    )
    print(f"Video: {result.video_path}")
    print(f"Duration: {result.duration:.2f}s")
    print(f"Frames: {len(result.frames)}")

asyncio.run(main())
```

### 工作流 JSON 样例（`workflows/selfhost/tts_edge.json` 节选）

```json
{
  "1": {
    "inputs": {
      "text":  ["3", 0],       // 引用节点 3 的 value
      "voice": ["5", 0],       // 引用节点 5 的 voice 选择
      "speed": ["8", 0],
      "pitch": 0
    },
    "class_type": "EdgeTTS",
    "_meta": { "title": "Edge TTS 🔊" }
  },
  "3": {
    "inputs": { "value": "床前明月光，疑是地上霜。" },
    "class_type": "PrimitiveStringMultiline",
    "_meta": { "title": "$text.value!" }
  },
  "4": {
    "inputs": {
      "filename_prefix": "audio/ComfyUI",
      "quality": "V0",
      "audio": ["1", 0]
    },
    "class_type": "SaveAudioMP3",
    "_meta": { "title": "Save Audio (MP3)" }
  }
  // ... 剩余节点：音色选择 / speed / 条件路由
}
```

`_meta.title` 里带 `$text.value!` 这种占位符，是 Pixelle-Video 的**参数注入约定**——`ComfyBaseService` 运行时把 `text="反脆弱..."` 塞到所有标题里含 `$text.value!` 的节点上。这让同一个 ComfyUI 工作流在设计时和运行时之间有个干净的变量接口。

## 关键发现 / 学习心得

### 1. "LLM 编排 + ComfyUI 执行"是 AIGC 工具链里被低估的架构范式

市面上大多数 AI 视频工具有两种偏极端的选择：要么是**纯前端 SaaS 套壳**（把 Runway / Kling 的 API 重新包一层 UI），要么是**重新造 pipeline 轮子**（完全不用 ComfyUI，自己写图像/视频生成逻辑）。

Pixelle-Video 给出了第三条路：

- **下层复用 ComfyUI 生态**——开源社区每周在迭代的新模型、新采样器、新 LoRA，全部自动可用
- **上层用 LLM 做编排**——主题分解、脚本生成、prompt engineering 都交给 GPT/Qwen
- **中间用 HTML 模板做可视化层**——前端技能栈进来了（CSS 动画、字体、布局），这件事 moviepy/PIL 路线做不到

这和 [Pixelle-MCP](https://github.com/AIDC-AI/Pixelle-MCP)（同团队早期作品：用 MCP 协议把 ComfyUI 暴露给 AI 助手）是一个思路的两次演进——**把 ComfyUI 当作 Tool Registry / Function Catalog 来用**。

### 2. 模板方法 + PipelineContext 的扩展性

`LinearVideoPipeline` 6 阶段 8 步的切分非常典型。读代码时能很明显感觉到，作者是**先定义了"一条线性流水线"这个通用骨架，再实例化成 standard / asset_based / custom** 三种。数字人口播、图生视频、动作迁移这三个后期加的 Web 端 pipeline，走的是另一条路：**直接调 RunningHub 专用工作流 JSON**（`digital_combination.json` / `i2v_LTX2.json` 等），不走 LinearVideoPipeline。这一点小分裂——可能是因为这几个场景不需要"按分镜拆解"这一步。

### 3. HTML + Playwright 做视频帧合成的工程影响

这是我在其他开源 AI 视频工具里没见过的做法，值得记下来：

- **好**：美工/前端能参与，模板仓库（`templates/`）是纯 HTML+CSS，不用懂 Python
- **好**：渐变、字体、文字动画、阴影这些 CSS 一行就能搞定的事，不用在 PIL 里重写
- **成本**：每帧要启动一次 Chromium 渲染，比纯 PIL 慢（但在整条 pipeline 里 LLM + 图像生成才是瓶颈，浏览器渲染反倒不明显）
- **副作用**：Linux 服务器必须装中文字体（`fonts-noto-cjk`），不然中文字幕是豆腐块——`frame_html.py` 顶上专门写了注释提醒

### 4. 与同赛道开源项目的横向对比

| 项目 | 定位 | 核心差异 |
|------|------|---------|
| **Pixelle-Video** | 全自动"主题 → 短视频" | LLM 编排 + ComfyUI 执行 + HTML 模板渲染，覆盖文案/配图/TTS/合成全链路 |
| [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) | 口述视频批量生成 | 走素材库拼接路线（Pexels 等），不依赖 ComfyUI，早期作品 |
| [NarratoAI](https://github.com/linyqh/NarratoAI) | 影视解说自动化 | 视频理解 + LLM 解说，聚焦"二创"场景 |
| [FramePack](https://github.com/lllyasviel/FramePack) | 长视频连续生成模型 | 底层模型研究，不是应用层工具 |
| [WAN 2.1 / 2.2](https://github.com/Wan-Video/Wan2.1) | 视频生成基础模型 | 单点模型，Pixelle-Video 把它当作工作流里的一个节点 |
| ShotRunner / Kling / Sora / Runway | 闭源商业产品 | 模型质量领先，但不开放编排层 |

Pixelle-Video 站在**应用编排层**，它不造模型，而是把开源社区的最新模型通过 ComfyUI 工作流吃进来。这意味着它的天花板跟着 ComfyUI 生态涨。

### 5. 阿里 AIDC-AI 的开源策略观察

2025–2026 这一年 AIDC-AI 仓库节奏非常密集：

- [ComfyUI-Copilot](https://github.com/AIDC-AI/ComfyUI-Copilot)（5k⭐）：把 AI 助手嵌到 ComfyUI 里帮你搭工作流
- [Pixelle-MCP](https://github.com/AIDC-AI/Pixelle-MCP)（954⭐）：用 MCP 协议把 ComfyUI 暴露给 AI Agent
- [Pixelle-Video](https://github.com/AIDC-AI/Pixelle-Video)（4.5k⭐）：在 ComfyUI + LLM 之上做全自动短视频
- [Marco-o1](https://github.com/AIDC-AI/Marco-o1)（1.5k⭐）：推理模型
- [Ovis / Ovis-U1](https://github.com/AIDC-AI/Ovis)（1.4k⭐）：多模态模型
- [Agentic-ADK](https://github.com/AIDC-AI/Agentic-ADK)（668⭐）：Java Agent 框架

**Pattern**：围绕 ComfyUI 做 AIGC 编排层 + 围绕 Agent 做协议层和应用层。这个组合和阿里国际的业务（跨境电商 —— Lazada/AliExpress 需要低成本出海内容/素材/数字人）高度吻合。**Pixelle 这条产品线明显是"先开源打品牌，再往商业产品引流"的策略**（[pixelle.ai](https://pixelle.ai) 已经立站）。

### 6. 没能做到的 / 值得后续挖的

- 数字人口播（韩语 demo）背后的 `digital_combination.json` 工作流到底怎么串的——这是最近加的模块，文档里还没细讲
- 动作迁移（`action_transfer`）用了哪个视频模型，是 Wan 2.2 还是某个 ControlNet 方案
- `runninghub_concurrent_limit=10` 时的真实吞吐（读代码知道是 Semaphore 并行，但实际 RunningHub 端排队策略不明）
- 若要接入自己的 LLM（比如 Bedrock Claude），需要在 `llm_presets.py` 加一条 —— 代码里 `LLMService` 走的是 OpenAI SDK，Bedrock 需要一层转换

## 参考资源

- 官方仓库：<https://github.com/AIDC-AI/Pixelle-Video>
- 官方使用文档：<https://aidc-ai.github.io/Pixelle-Video/zh>
- 姊妹项目 Pixelle-MCP：<https://github.com/AIDC-AI/Pixelle-MCP>
- B 站视频教程：<https://www.bilibili.com/video/BV1WzyGBnEVp/>
- ComfyUI：<https://github.com/comfyanonymous/ComfyUI>
- ComfyKit（项目用的 ComfyUI Python 客户端）：<https://github.com/puke3615/ComfyKit>
- RunningHub（云端 GPU 方案）：<https://www.runninghub.ai/>
- 相关开源项目：[MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) · [NarratoAI](https://github.com/linyqh/NarratoAI)

