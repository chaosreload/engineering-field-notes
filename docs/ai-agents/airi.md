# Project AIRI — Getting Started Guide

> **学习整理于**: 2026-03-11  
> **仓库版本**: v0.9.0-alpha.12  
> **仓库地址**: https://github.com/moeru-ai/airi  
> **本地路径**: `/home/ubuntu/chaosreload/study/repo/public/airi`

---

## 1. 项目简介

**Project AIRI** 是一个开源的 AI 虚拟角色（AI VTuber）框架，目标是重新创造 [Neuro-sama](https://www.twitch.tv/vedal987) —— 一个以 LLM 为核心驱动的"虚拟灵魂容器"。

**核心定位**：
- 🧠 LLM-powered 虚拟角色，可实时对话、直播、玩游戏
- 🌐 **Web 优先**：基于 WebGPU/WebAudio/WASM 实现浏览器内全流程 AI 推理
- 🖥️ **跨平台**：Web、桌面（Electron/Tauri）、移动（iOS/Android via Capacitor）
- 🎮 **社区互动**：Discord、Telegram、Twitter 机器人，Minecraft/Factorio 游戏代理
- 🎭 **角色渲染**：VRM 3D 模型（Three.js）+ Live2D 2D 模型

**在线 Demo**: https://airi.moeru.ai

---

## 2. 项目结构（核心目录/模块）

```
airi/
├── apps/                          # 前端应用层
│   ├── stage-web/                 # 浏览器版本（主力应用，Vite + Vue 3）
│   ├── stage-pocket/              # 移动端（iOS/Android, Capacitor）
│   ├── stage-tamagotchi/          # 桌面版（Tauri 框架）
│   ├── component-calling/         # 组件调用 Demo
│   └── server/                    # 后端 API 服务器（Hono + PGlite/Postgres）
│
├── packages/                      # 共享库包（约 35 个）
│   ├── core-character/            # ⭐ LLM 管线编排（分段、情绪、延迟、TTS）
│   ├── stage-ui/                  # 核心 Vue 组件 + Stores + Workers
│   ├── stage-ui-three/            # Three.js WebGL 渲染层
│   ├── stage-ui-live2d/           # Live2D 2D 角色渲染
│   ├── stage-ui-three-performance-runtime/ # 3D 性能运行时
│   ├── audio/                     # 音频处理库
│   ├── audio-pipelines-transcribe/# 语音转文字管线
│   ├── pipelines-audio/           # 音频管线抽象
│   ├── stream-kit/                # 流式数据处理工具
│   ├── server-runtime/            # WebSocket/HTTP 服务端运行时（H3 + Srvx）
│   ├── server-sdk/                # 客户端 SDK
│   ├── server-schema/             # 数据库 Schema（Drizzle ORM）
│   ├── server-shared/             # 服务端共享类型
│   ├── memory-pgvector/           # 向量记忆存储（pgvector）
│   ├── plugin-sdk/                # 插件 SDK
│   ├── plugin-protocol/           # 插件通信协议
│   ├── ccc/                       # Character Card Codec（角色卡格式 V1/V2）
│   ├── model-driver-lipsync/      # 嘴型同步驱动
│   ├── model-driver-mediapipe/    # MediaPipe 面部追踪
│   ├── duckdb-wasm/               # DuckDB WASM 封装
│   ├── drizzle-duckdb-wasm/       # Drizzle ORM + DuckDB WASM 适配
│   ├── i18n/                      # 国际化（i18n）
│   ├── tauri-plugin-mcp/          # Tauri MCP 插件（TS 部分）
│   ├── ui/                        # 基础 UI 组件库
│   ├── ui-loading-screens/        # 加载屏幕组件
│   ├── ui-transitions/            # 动画过渡组件
│   └── fonts: font-departure-mono, font-xiaolai, font-cjkfonts-allseto
│
├── services/                      # 集成服务（社区 Bot）
│   ├── discord-bot/               # Discord 机器人（含 WhisperLargeV3 TTS）
│   ├── telegram-bot/              # Telegram 机器人（需要 Postgres）
│   ├── minecraft/                 # Minecraft 游戏代理（LLMAgent）
│   ├── satori-bot/                # Satori/Fediverse 协议机器人
│   └── twitter-services/          # Twitter/X 互动服务
│
├── integrations/
│   └── vscode/                    # VSCode 扩展
│
├── crates/                        # Rust Tauri 插件
│   ├── tauri-plugin-ipc-audio-transcription-ort/ # 音频转写（ONNX Runtime）
│   ├── tauri-plugin-ipc-audio-vad-ort/           # 语音活动检测
│   ├── tauri-plugin-mcp/                          # MCP 协议插件
│   ├── tauri-plugin-rdev/                         # 输入设备处理
│   ├── tauri-plugin-window-pass-through-on-hover/ # 鼠标穿透
│   └── tauri-plugin-window-router-link/           # 窗口路由
│
├── docs/                          # 文档站（VitePress）
├── plugins/                       # Vite/构建插件
└── scripts/                       # 构建脚本
```

---

## 3. 核心架构

### 3.1 整体架构图

```
用户/观众
    │
    ▼
┌─────────────────────────────────────────────────┐
│              Stage Layer（展示层）                │
│  stage-web / stage-tamagotchi / stage-pocket     │
│  Vue 3 + TresJS (Three.js) + Live2D              │
└──────────────────────┬──────────────────────────┘
                       │ WebSocket / HTTP
┌──────────────────────▼──────────────────────────┐
│           Character Pipeline（角色管线）          │
│  core-character: LLM → 分段 → 情绪标注 → TTS    │
│  stream-kit: 流式数据处理                         │
└──────────┬───────────────────────────┬──────────┘
           │                           │
┌──────────▼──────────┐   ┌────────────▼──────────┐
│  AI/LLM Backend     │   │  Audio Pipeline       │
│  @xsai (stream-text │   │  Kokoro TTS (WebWorker│
│  generate-text      │   │  WebGPU/ONNX)         │
│  generate-speech)   │   │  MediaPipe 面部追踪    │
│  @huggingface/      │   │  嘴型同步驱动          │
│  transformers       │   └───────────────────────┘
└──────────┬──────────┘
           │
┌──────────▼──────────────────────────────────────┐
│         Integration Layer（集成层）               │
│  Discord Bot / Telegram Bot / Minecraft / Twitter│
└─────────────────────────────────────────────────┘
```

### 3.2 关键数据流（来自 gitnexus 分析）

**角色对话流程**:
```
用户输入 → LLM Stream → CategorizedSegment（情绪/动作分类）
    → core-character 管线（分段+延迟）
    → SpeechPipelineRuntime（TTS抽象接口）
        ├─ KokoroWorkerManager（本地 Kokoro TTS，WebWorker）
        ├─ 或 xsai generate-speech（云端 TTS）
    → 音频播放 + 嘴型同步（VisemeEventPayload）
    → 3D/2D 角色渲染（stage-ui-three / Live2D）
```

**角色数据同步**:
```
fetchList → CanUseRemote 判断
    ├─ 有服务器：characters.repo.ts → Server API（findById/findByOwnerId）
    └─ 无服务器：DuckDB WASM 本地存储（buildLocalCharacter）
```

**Minecraft AI 代理**:
```
LLMConfig → LLMAgent（services/minecraft）
    → 感知游戏世界 → LLM 决策 → 执行动作
```

### 3.3 存储架构

| 环境 | 存储 | 技术 |
|------|------|------|
| 浏览器（无服务器）| 本地 | DuckDB WASM + Drizzle ORM |
| 有服务器 | 远程 | PGlite / Postgres + Drizzle ORM |
| 记忆/语义搜索 | 向量 | pgvector（memory-pgvector）|

---

## 4. 主要功能特性

### 4.1 AI 能力
- ✅ **多模型 LLM 支持**：通过 `@xsai-ext/providers` 支持 OpenAI/Anthropic 等
- ✅ **本地 LLM 推理**：WebGPU + `@huggingface/transformers`（在浏览器内运行）
- ✅ **语音合成 TTS**：
  - **Kokoro TTS**（本地，ONNX Runtime Web，WebWorker）
  - 云端 TTS via `@xsai/generate-speech`
- ✅ **语音识别 STT**：
  - WhisperLargeV3Pipeline（Discord Bot）
  - `@xsai/stream-transcription`（流式转写）
- ✅ **语音活动检测（VAD）**：Tauri 桌面版 ONNX Runtime

### 4.2 角色表现
- ✅ **3D 角色渲染**：VRM 模型（Three.js/TresJS）
- ✅ **2D 角色渲染**：Live2D（Cubism SDK）
- ✅ **嘴型同步**：VisemeEventPayload 事件驱动
- ✅ **情绪/表情**：LLM 响应自动分类（CategorizedSegment）
- ✅ **面部追踪**：MediaPipe 模型驱动

### 4.3 社区集成
- ✅ **Discord Bot**：实时语音+文字对话，WhisperLargeV3 TTS
- ✅ **Telegram Bot**：消息互动（需 Postgres）
- ✅ **Minecraft 代理**：游玩 Minecraft，感知+决策+执行
- ✅ **Twitter/X 服务**：社交互动
- ✅ **Satori 协议**：Fediverse/ActivityPub 支持

### 4.4 平台支持
- ✅ **Web（PWA）**：https://airi.moeru.ai
- ✅ **桌面**：Tauri（推荐）+ Electron（备选）
- ✅ **iOS**：Capacitor（stage-pocket）
- ✅ **Android**：Capacitor（stage-pocket）
- ✅ **VSCode 扩展**：integrations/vscode

### 4.5 数据与协议
- ✅ **角色卡格式 CCC V1/V2**（packages/ccc）：导入/导出角色定义
- ✅ **MCP 协议**（tauri-plugin-mcp）：模型上下文协议集成
- ✅ **Plugin 系统**：plugin-sdk + plugin-protocol
- ✅ **OpenTelemetry**：服务器可观测性（apps/server）

---

## 5. 部署步骤

### 5.1 环境准备

```bash
# 必需
node --version  # 需要 Node.js 23+
git --version

# 安装 pnpm
corepack enable
corepack prepare pnpm@latest --activate

# 可选：Rust（仅桌面版需要）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 5.2 克隆 & 安装

```bash
git clone https://github.com/moeru-ai/airi.git
cd airi

# 安装所有依赖（会自动构建 packages）
pnpm install

# Rust 依赖（可选，桌面版需要）
cargo fetch
```

### 5.3 运行各端应用

#### 🌐 Web 版（最简单，推荐入门）
```bash
pnpm dev:web
# 访问 http://localhost:5173
```

#### 🖥️ 桌面版 Tamagotchi（需要 Rust）
```bash
pnpm dev:tamagotchi
```

#### 📱 移动端
```bash
pnpm dev:pocket:ios      # iOS
pnpm dev:pocket:android  # Android
```

#### 🤖 后端服务器
```bash
# 复制环境变量
cp apps/server/.env apps/server/.env.local
# 编辑 .env.local 填入数据库连接等配置

pnpm dev:server
```

#### 💬 Discord Bot
```bash
cd services/discord-bot
cp .env .env.local
# 编辑 .env.local 填入 Discord Token
pnpm -F @proj-airi/discord-bot start
```

#### ⛏️ Minecraft 代理
```bash
cd services/minecraft
cp .env .env.local
# 编辑 .env.local 填入 Minecraft 服务器端口
pnpm -F @proj-airi/minecraft-bot start
```

#### 📱 Telegram Bot（需要 Postgres）
```bash
cd services/telegram-bot
docker compose up -d           # 启动 Postgres
cp .env .env.local             # 配置 token 和数据库
pnpm -F @proj-airi/telegram-bot db:push
pnpm -F @proj-airi/telegram-bot start
```

### 5.4 构建生产版本

```bash
pnpm build         # 构建所有
pnpm build:web     # 仅 Web 版
pnpm build:tamagotchi  # 桌面版
```

---

## 6. Quick Start（快速体验）

### 方式一：直接访问在线版
→ 打开 https://airi.moeru.ai  
→ 配置 LLM Provider（右上角设置）  
→ 选择/创建角色，开始对话

### 方式二：本地 Web 版（约 5 分钟）

```bash
# 前提：Node.js 23+, pnpm
git clone https://github.com/moeru-ai/airi.git
cd airi
pnpm install
pnpm dev:web
```

打开 http://localhost:5173，在设置中配置你的 LLM API Key（支持 OpenAI、Claude 等）。

---

## 7. 关键发现 / 学习心得

### 7.1 架构设计亮点

1. **Web 优先的本地 AI 推理**  
   项目大量使用 WebGPU + ONNX Runtime Web + HuggingFace Transformers.js，实现无需服务器的浏览器内 LLM/TTS/STT 推理。Kokoro TTS 运行在 WebWorker 中，不阻塞主线程。这是现代 AI Web 应用的前沿架构。

2. **双模式数据存储**  
   `CanUseRemote` 判断逻辑允许项目在"无服务器（纯浏览器 DuckDB WASM）"和"有服务器（Postgres）"两种模式下无缝运行，降低了入门门槛。

3. **Stream-first 设计**  
   `stream-kit` + LLM 流式响应 + `CategorizedSegment` 实现了"边生成边说话"的自然对话体验。角色说话不需要等 LLM 完整回复，大幅降低感知延迟。

4. **Plugin 系统与 MCP**  
   拥有 `plugin-sdk/protocol` + Tauri `tauri-plugin-mcp`，支持 MCP 协议，意味着可以接入 Claude Code/Cursor 等工具生态，未来扩展性很强。

5. **Monorepo + Turbo 构建**  
   35+ 个包用 pnpm workspace + Turbo 管理，包之间依赖清晰，各层职责分明。`core-character` 的"segmentation → emotion → delay → TTS"管线设计体现了良好的关注点分离。

### 7.2 需要注意的点

- **alpha 阶段**：v0.9.0-alpha.12，API 仍在变化，不适合直接用于生产
- **pnpm 强依赖**：必须用 pnpm，npm/yarn 不支持 workspace 协议（`workspace:^`）
- **iOS 开发**：包含 Swift 文件（stage-pocket/ios/），需要 Xcode，gitnexus 需要 patch 才能分析
- **Rust 可选**：只有 Tauri 桌面版和 Crates 需要 Rust，Web 版完全不需要
- **LLM 自备**：项目本身不包含 LLM，需要自备 API Key（OpenAI/Anthropic 等）

### 7.3 与 Neuro-sama 的对比

| 特性 | Project AIRI | Neuro-sama |
|------|-------------|-----------|
| 开源 | ✅ MIT | ❌ 闭源 |
| 多平台 | ✅ Web/桌面/移动 | 仅直播 |
| 本地推理 | ✅ WebGPU | ❌ |
| 游戏集成 | ✅ Minecraft/Factorio | ✅ |
| 插件系统 | ✅ MCP | ❌ |

---

## 8. 参考资源

| 资源 | 链接 |
|------|------|
| 在线演示 | https://airi.moeru.ai |
| GitHub 仓库 | https://github.com/moeru-ai/airi |
| 项目文档 | https://airi.moeru.ai/docs（需本地运行 `pnpm dev:docs`）|
| 贡献指南 | `.github/CONTRIBUTING.md` |
| moeru-ai 组织 | https://github.com/moeru-ai |
| xsai（LLM 库） | https://github.com/moeru-ai/xsai |
| Kokoro TTS | HuggingFace onnx-community/Kokoro-82M-v1.0-ONNX |
| CCC 格式规范 | `packages/ccc/src/export/types/data.ts` (DataV1/DataV2) |

---

## 9. gitnexus 分析摘要

```
仓库路径：/home/ubuntu/chaosreload/study/repo/public/airi
索引统计：7,279 nodes | 16,901 edges | 424 clusters | 300 flows
构建耗时：5.2s（KuzuDB 2.5s + FTS 1.9s）
跳过文件：1 个超大文件（>512KB）
注意事项：需 patch gitnexus ignore-service.js 排除 .swift 扩展名
```

**关键模块排名**（按 gitnexus cluster 分析）：
1. `packages/stage-ui/` — 最大模块，核心 UI 逻辑（Stores/Speech/Workers）
2. `apps/server/` — 后端 API 服务（Services 层）
3. `services/minecraft/` — 游戏代理（Cognitive/LLMAgent）
4. `services/discord-bot/` — Discord 集成（Pipelines）

---

*文档生成工具：gitnexus（知识图谱分析）+ 手动阅读源码*
