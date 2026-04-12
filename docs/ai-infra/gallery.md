# Google AI Edge Gallery Getting Started

> 整理日期：2026-04-12
> 仓库地址：https://github.com/google-ai-edge/gallery
> Stars: 20.6k+ | Forks: 1.9k+ | License: Apache-2.0 | Language: Kotlin

## 项目简介

Google 官方出品的**端侧 AI 展示应用**，让你在 Android / iOS 手机上离线运行开源 LLM（Gemma 4、DeepSeek R1、Qwen 2.5 等）。100% 本地推理，零数据上传。

不只是聊天 demo——它是一个**完整的端侧 AI 能力平台**：多轮对话、图片理解、语音转文字、Agent 工具调用、基准测试、模型管理，全部在手机 NPU/GPU 上完成。

**核心价值**：让开发者和用户一键体验"LLM 在手机上能做什么"，同时作为 Google AI Edge SDK（LiteRT / LiteRT-LM）的 showcase。

## 项目结构

```
gallery/
├── Android/src/app/src/main/
│   ├── java/com/google/ai/edge/gallery/
│   │   ├── runtime/                  # 推理运行时（LiteRT-LM + AICore 双引擎）
│   │   │   ├── LlmModelHelper.kt    # 核心推理接口
│   │   │   ├── ModelHelperExt.kt     # 运行时路由（按 model 类型分发）
│   │   │   └── aicore/              # Google AICore 运行时（Pixel 专属）
│   │   ├── data/                     # 数据层
│   │   │   ├── Model.kt             # 模型定义（HF 下载 URL、大小、配置）
│   │   │   ├── Tasks.kt             # 任务定义（8 种内置任务类型）
│   │   │   ├── ModelAllowlist.kt    # 模型白名单（按 SoC 适配不同量化文件）
│   │   │   ├── DownloadRepository.kt # 模型下载管理（WorkManager 后台下载）
│   │   │   └── Categories.kt        # 任务分类（LLM / Classical ML / Experimental）
│   │   ├── customtasks/              # 自定义任务扩展点
│   │   │   ├── common/CustomTask.kt  # 插件接口
│   │   │   ├── agentchat/           # Agent Skills 聊天（工具调用）
│   │   │   ├── mobileactions/       # 手机操作控制
│   │   │   ├── tinygarden/          # 种菜小游戏（FunctionGemma 270M）
│   │   │   └── examplecustomtask/   # 自定义任务模板
│   │   ├── ui/                       # Jetpack Compose UI 层
│   │   │   ├── llmchat/             # 多轮对话界面 + 推理 Helper
│   │   │   ├── llmsingleturn/       # Prompt Lab（单轮测试）
│   │   │   ├── benchmark/           # 基准测试界面
│   │   │   ├── modelmanager/        # 全局模型管理
│   │   │   ├── home/                # 主页 + 任务卡片
│   │   │   └── common/chat/         # 通用聊天组件（30+ 文件）
│   │   ├── di/                       # Hilt 依赖注入
│   │   └── worker/                   # 后台工作（下载等）
│   └── assets/
│       ├── skills/                   # 内置 Agent Skills（8 个）
│       └── tinygarden/               # 种菜游戏资源
├── model_allowlists/                 # 版本化的模型白名单 JSON
│   ├── 1_0_11.json                  # 最新版（9 个模型）
│   └── ios_1_0_0.json               # iOS 版白名单
├── skills/                           # 开源 Skill 仓库
│   ├── built-in/                    # 内置 Skills
│   └── featured/                    # 社区精选 Skills
└── DEVELOPMENT.md                    # 构建说明
```

**170 个 Kotlin 文件**，纯 Android 原生开发（Jetpack Compose）。

## 核心架构

### 三层架构

```
┌─────────────────────────────────────────────────┐
│                   UI 层 (Compose)                │
│  HomeScreen → TaskScreen → ChatView/Benchmark   │
├─────────────────────────────────────────────────┤
│               业务逻辑层 (ViewModel)              │
│  ChatViewModel / BenchmarkViewModel / ...        │
│  SkillManagerViewModel (Agent 工具管理)           │
├─────────────────────────────────────────────────┤
│               Runtime 层 (双引擎)                │
│  ┌──────────────┐  ┌────────────────────────┐   │
│  │ LiteRT-LM    │  │ AICore (Pixel only)    │   │
│  │ (所有设备)    │  │ (系统级 AI 加速)        │   │
│  └──────────────┘  └────────────────────────┘   │
│         ↑ LlmModelHelper 接口统一                │
├─────────────────────────────────────────────────┤
│               数据层                             │
│  Model Allowlist → HF Download → Local Storage   │
│  DataStore (用户设置/聊天历史)                     │
└─────────────────────────────────────────────────┘
```

### 推理运行时：双引擎设计

所有 LLM 推理通过 `LlmModelHelper` 接口统一：

```kotlin
interface LlmModelHelper {
    fun initialize(context, model, supportImage, supportAudio, onDone, ...)
    fun runInference(model, input, resultListener, cleanUpListener, images, audioClips, ...)
    fun resetConversation(model, ...)
    fun cleanUp(model, onDone)
    fun stopResponse(model)
}
```

两个实现：
- **`LlmChatModelHelper`** — 基于 LiteRT-LM，适用所有 Android 设备。使用 `Engine` + `Conversation` API，支持 streaming、tool use、thinking mode
- **`AICoreModelHelper`** — 基于 Google AICore，仅 Pixel 设备。直接调用系统级 AI 加速框架

路由逻辑极简：`Model.runtimeHelper` 扩展属性根据 `runtimeType` 字段自动分发。

### 模型管理：Allowlist + HuggingFace 下载

模型不是硬编码的，而是通过**版本化的 JSON 白名单**管理：

```json
// model_allowlists/1_0_11.json 中的模型（v1.0.11）
Gemma-4-E2B-it          2.6GB   Chat/PromptLab/Agent/Image/Audio
Gemma-4-E4B-it          3.7GB   Chat/PromptLab/Agent/Image/Audio
Gemma-3n-E2B-it         3.7GB   Chat/PromptLab/Image/Audio
Gemma-3n-E4B-it         4.9GB   Chat/PromptLab/Image/Audio
Gemma3-1B-IT            0.6GB   Chat/PromptLab
Qwen2.5-1.5B-Instruct  1.6GB   Chat/PromptLab
DeepSeek-R1-Distill     1.8GB   Chat/PromptLab
TinyGarden-270M         0.3GB   种菜小游戏专用
MobileActions-270M      0.3GB   手机操作专用
```

每个模型定义了：
- **按 SoC 适配**的量化文件（`socToModelFiles`，不同芯片用不同优化版本）
- 支持的任务类型（`taskTypes`）
- 默认推理配置（`topK`、`temperature`、加速器选择）
- 最低设备内存要求

下载通过 WorkManager 后台进行，从 HuggingFace 拉取，支持进度通知和断点续传。

### Task 系统：8 种内置 + 自定义扩展

内置任务：

| Task ID | 功能 | 说明 |
|---------|------|------|
| `llm_chat` | AI Chat | 多轮对话 + Thinking Mode |
| `llm_prompt_lab` | Prompt Lab | 单轮测试，调参数 |
| `llm_ask_image` | Ask Image | 图片理解（相机/相册） |
| `llm_ask_audio` | Ask Audio | 语音转文字 |
| `llm_agent_chat` | Agent Skills | 工具调用（Wikipedia、地图等） |
| `llm_mobile_actions` | Mobile Actions | FunctionGemma 控制手机 |
| `llm_tiny_garden` | Tiny Garden | 自然语言种菜游戏 |
| `mp_scrapbook` | Scrapbook | 素材收集 |

**自定义任务机制**（`CustomTask` 接口）：

```kotlin
interface CustomTask {
    val task: Task                           // 任务元数据
    fun initializeModelFn(...)               // 模型初始化
    fun cleanUpModelFn(...)                  // 资源释放
    @Composable fun MainScreen(...)          // UI 界面
}
```

通过 Hilt `@IntoSet` 注入，新增任务**自动出现在主页**，无需改路由。

### Agent Skills 系统：LLM + 工具调用

这是整个项目**最有意思的部分**。Agent Skills 让端侧 LLM 拥有工具调用能力：

**Skill 格式**（SKILL.md 前置 + Instructions）：
```markdown
---
name: query-wikipedia
description: Query summary from Wikipedia for a given topic.
---
# Instructions
Call the `run_js` tool using `index.html` and a JSON string...
```

**工具链路**：
1. LLM 输出 tool call → `AgentTools.kt` 拦截
2. `loadSkill()` 加载 SKILL.md 指令
3. `runJs()` 在 WebView 中执行 JS 脚本
4. 结果通过 Channel 回传给 LLM

**内置 Skills（8 个）**：
- `query-wikipedia` — 维基百科查询
- `interactive-map` — 交互式地图
- `calculate-hash` — 哈希计算
- `qr-code` — 二维码生成
- `mood-tracker` — 情绪追踪
- `text-spinner` — 文字动画
- `send-email` — 发邮件
- `kitchen-adventure` — 厨房冒险游戏

**扩展方式**：
- 从 URL 加载远程 Skill
- 从本地导入
- 浏览 GitHub Discussions 社区贡献

## 技术栈

- **语言**: Kotlin（Android）
- **UI**: Jetpack Compose + Material 3
- **推理**: LiteRT-LM（Google 轻量 LLM 运行时）
- **DI**: Hilt
- **异步**: Kotlin Coroutines + Channels
- **后台任务**: WorkManager（模型下载）
- **数据持久化**: DataStore + Proto
- **模型源**: HuggingFace Hub（OAuth 认证下载）

## 构建方式

需要 Android Studio + HuggingFace Developer Application：

1. 创建 [HuggingFace OAuth App](https://huggingface.co/docs/hub/oauth#creating-an-oauth-app)
2. 在 `ProjectConfig.kt` 填入 `clientId` 和 `redirectUri`
3. 在 `build.gradle.kts` 修改 `appAuthRedirectScheme`
4. Build & Run（minSdk 31 = Android 12+）

> 不想编译？直接从 [Google Play](https://play.google.com/store/apps/details?id=com.google.ai.edge.gallery) / [App Store](https://apps.apple.com/us/app/google-ai-edge-gallery/id6749645337) 安装。

## 关键发现 / 学习心得

### 1. 端侧 AI 的"iPhone moment"正在发生

Gemma 4 E2B（2.6GB）在手机上跑多轮对话 + 图片理解 + 工具调用，这不是玩具，是实用级别。Google 把它做成 Play Store 应用上架，说明对端侧 AI 用户体验有信心。

### 2. 双运行时设计值得学习

`LlmModelHelper` 接口 + 扩展属性路由，让 LiteRT-LM（通用）和 AICore（Pixel 专属）无缝切换。这是"面向接口编程"在 AI 推理层的典型实践——以后加新运行时（比如 Qualcomm AI Engine Direct）只需实现接口。

### 3. Agent Skills = 端侧 Function Calling 的开放标准

Skill 用 SKILL.md（元数据） + JS 脚本（执行逻辑） + WebView（沙箱），实现了一套端侧的工具调用协议。与 OpenClaw 的 AgentSkill 体系理念相通，但面向的是移动端 LLM。

**关键区别**：OpenClaw Skills 运行在服务端 agent，调用系统工具；Gallery Skills 运行在手机 WebView 沙箱，调用前端 API。但 SKILL.md 格式几乎一致。

### 4. Model Allowlist 是个聪明的设计

不硬编码模型，而是通过版本化 JSON 白名单管理：
- **按 SoC 适配**：同一模型在不同芯片上用不同量化文件
- **按设备内存过滤**：自动隐藏装不下的模型
- **远程可更新**：不发新版 APK 就能加模型

这是移动端 AI 应用的最佳实践——硬件碎片化太严重，必须做适配层。

### 5. CustomTask 插件架构对 AI 应用开发有参考价值

想给 AI app 加新功能？实现一个 `CustomTask`：
- 定义任务元数据
- 写初始化/清理逻辑
- 写 Compose UI
- Hilt 注入

自动出现在主页、自动有模型选择器和配置面板。这个扩展模式对任何"多 AI 功能聚合"的应用都值得借鉴。

### 6. 20k Stars 的信号

这不只是技术 demo——它代表了 Google 在端侧 AI 生态的战略布局。把 Gemma 4 作为首页主推模型，配合 LiteRT-LM 运行时，目标是让"端侧 AI"成为 Android 的原生能力，而不只是云端 API 的补充。

## 参考资源

- [Google AI Edge 官方文档](https://ai.google.dev/edge)
- [LiteRT-LM (推理引擎)](https://github.com/google-ai-edge/LiteRT-LM)
- [HuggingFace LiteRT 社区](https://huggingface.co/litert-community)
- [Gallery Wiki (详细指南)](https://github.com/google-ai-edge/gallery/wiki)
- [Google Play 下载](https://play.google.com/store/apps/details?id=com.google.ai.edge.gallery)
- [App Store 下载](https://apps.apple.com/us/app/google-ai-edge-gallery/id6749645337)
