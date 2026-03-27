# AI Game DevTools — AI 游戏开发工具全景图

> 整理日期：2026-03-27
> 仓库地址：https://github.com/Yuan-ManX/ai-game-devtools
> ⭐ 1,108 Stars | 🍴 106 Forks | 持续更新中（最近更新：2026-02）

## 项目简介

**AI Game DevTools (AI-GDT)** 是一份持续维护的 AI 游戏开发工具目录，覆盖了从底层模型到上层创作工具的完整链路。这不是一个可运行的项目，而是一份**资源索引** — 帮助游戏开发者快速找到适合自己需求的 AI 工具。

**核心价值**：把散落在各处的 AI 游戏工具按功能分类汇总，让你不用在 GitHub/HuggingFace/Product Hunt 之间反复搜索。

## 覆盖范围 — 16 大分类

这份列表按游戏开发的实际需求组织，覆盖了完整的 AI 辅助游戏开发管线（pipeline）：

| # | 分类 | 工具数量（估） | 说明 |
|---|------|------------|------|
| 1 | **LLM & Tool** | ~120+ | 大语言模型及工具，包括 Unity/UE 集成 |
| 2 | **VLM (Visual)** | ~40+ | 视觉语言模型，多模态理解 |
| 3 | **Game (World Model & Agent)** | ~60+ | 世界模型、游戏 Agent、模拟环境 |
| 4 | **Code** | ~20+ | AI 辅助编程工具 |
| 5 | **Image** | ~80+ | 文生图、图像编辑、风格迁移 |
| 6 | **Texture** | ~18 | 纹理生成、PBR 材质、Mesh 处理 |
| 7 | **Shader** | 1 | ChatGPT 驱动的 Shader 生成（Unity） |
| 8 | **3D Model** | ~60+ | 文生3D、图生3D、3D 重建、高斯溅射 |
| 9 | **Avatar** | ~40+ | 数字人、虚拟形象、唇形同步 |
| 10 | **Animation** | ~30+ | 动作生成、角色动画、卡通插值 |
| 11 | **Video** | ~100+ | 文生视频、视频编辑、视频理解 |
| 12 | **Audio** | ~30+ | 音效生成、Foley 音频、音频编辑 |
| 13 | **Music** | ~25+ | AI 作曲、背景音乐生成 |
| 14 | **Singing Voice** | 4 | 歌声合成、声音转换 |
| 15 | **Speech** | ~50+ | TTS、语音克隆、语音对话 |
| 16 | **Analytics** | 1 | 游戏设计辅助分析 |

**总计 500+ 工具/项目**，涵盖开源项目、商业 SaaS 和学术论文。

## 按游戏引擎筛选 — 关键亮点

列表的一个特色是标注了**游戏引擎兼容性**，对游戏开发者特别实用：

### Unity 生态

| 工具 | 功能 |
|------|------|
| [AICommand](https://github.com/keijiro/AICommand) | ChatGPT 集成到 Unity Editor |
| [LLMUnity](https://github.com/undreamai/LLMUnity) | 在 Unity 中用 LLM 创建角色 |
| [AI Shader](https://github.com/keijiro/AIShader) | ChatGPT 驱动的 Shader 生成器 |
| [Hugging Face Unity API](https://github.com/huggingface/unity-api) | HuggingFace 推理 API 集成 |
| [SimpleOllamaUnity](https://github.com/HardCodeDev777/SimpleOllamaUnity) | Ollama 本地 LLM 集成 |
| [Unity ML Stable Diffusion](https://github.com/keijiro/UnityMLStableDiffusion) | Core ML Stable Diffusion |
| [UnityGaussianSplatting](https://github.com/aras-p/UnityGaussianSplatting) | 3D 高斯溅射可视化 |
| [UnityNeuroSpeech](https://github.com/HardCodeDev777/UnityNeuroSpeech) | 实时本地 AI 语音对话 |

### Unreal Engine 生态

| 工具 | 功能 |
|------|------|
| [UnrealGPT](https://github.com/TREE-Ind/UnrealGPT) | UE5 Editor 中的 GPT3/4 工具集 |
| [UE5 Llama LoRA](https://github.com/bublint/ue5-llama-lora) | 本地训练 LLM 用于文档工具 |
| [InteractML-UE](https://github.com/Interactml/iml-ue4) | 机器学习可视化脚本 |
| [Dash (Polygonflow)](https://www.polygonflow.io/) | UE 中的世界构建 Copilot |
| [MetaShoot](https://metashoot.vinzi.xyz/) | UE 中的 AI 照片工作室 |

### Blender 生态

| 工具 | 功能 |
|------|------|
| [BlenderGPT](https://github.com/gd3kr/BlenderGPT) | 自然语言控制 Blender |
| [BlenderMCP](https://github.com/ahujasid/blender-mcp) | Claude AI 通过 MCP 控制 Blender |
| [Dream Textures](https://github.com/carson-katri/dream-textures) | Stable Diffusion 生成纹理 |
| [Blender-ControlNet](https://github.com/coolzilj/Blender-ControlNet) | 在 Blender 中使用 ControlNet |

## 核心观察 — 值得关注的趋势

### 1. 🎯 World Model 是热点方向

列表中 Game 分类下出现了多个重量级世界模型项目：
- **NVIDIA Cosmos** — 世界基础模型平台
- **Google Genie** — 交互式环境生成
- **GameNGen** — 完整游戏引擎的神经网络替代
- **DIAMOND** — 扩散模型驱动的世界模型
- **Oasis** — 实时世界生成

这与 ARC-AGI-3 的方向高度吻合 — **AI 需要在交互式环境中理解和推理**。

### 2. 🎯 3D 生成已进入实用阶段

2024-2026 年 3D 生成工具大爆发，从学术 Demo 进入可用产品：
- **Hunyuan3D 系列**（腾讯）— 从 1.0 到 2.1，支持 PBR 材质
- **Step1X-3D**（StepFun）— 可控纹理 3D
- **Edify 3D**（NVIDIA）— 工业级 3D 资产
- **Direct3D-S2**（DreamTech）— 高效大规模 3D 生成
- **Meshy / Sloyd / CSM** — 即插即用的商业方案

### 3. 🎯 视频生成与游戏融合

视频生成模型开始和游戏场景打通：
- **Wan2.1 / Wan2.2** — 开源大规模视频生成
- **HunyuanVideo 1.5** — 轻量级视频生成
- **Step-Video-T2V** — 阶跃星辰的视频模型
- **Index-AniSora**（B站）— 专注动漫风格视频

### 4. 🎯 语音/数字人趋于成熟

Avatar + Speech 赛道工具极其丰富：
- **CosyVoice / ChatTTS / GPT-SoVITS** — 开源 TTS
- **Hallo / LivePortrait / EchoMimic** — 驱动数字人
- **HunyuanPortrait / HunyuanVideo-Avatar** — 腾讯全家桶
- **Step-Audio 2**（阶跃）— 端到端语音理解+生成

### 5. 🎯 中国团队贡献显著

列表中大量项目来自中国团队：
- **腾讯 Hunyuan** 系列（3D、视频、图像、Avatar、音频）
- **阿里 Qwen** 系列（LLM、VLM、Audio、Image）
- **字节 Seed-OSS / USO / deer-flow**
- **B站 Index-AniSora / Index-1.9B**
- **智谱 GLM-4/4.5 / CogVLM**
- **美团 LongCat-Flash**
- **快手 Kolors / Keye-VL**
- **月之暗面 Kimi K2**
- **阶跃 Step-Video / Step-Audio / Step1X-3D**

## 适合谁用？

| 角色 | 使用方式 |
|------|---------|
| **独立游戏开发者** | 找到免费/开源的 AI 工具替代传统美术和音频制作 |
| **Unity/UE 开发者** | 直接筛选引擎兼容的插件和集成方案 |
| **AI 研究者** | 追踪游戏 AI 领域的最新论文和开源实现 |
| **游戏公司技术总监** | 评估 AI 工具链，规划技术选型 |
| **内容创作者** | 找到图像/视频/音乐生成工具快速出素材 |

## 局限性

- **广而不深**：列表追求覆盖面，每个工具只有一行描述，无深度评测
- **更新不完全一致**：部分工具已停更或改名，但列表中未及时标注
- **缺少对比维度**：没有性能、成本、许可证的系统化对比
- **分类边界模糊**：有些工具同时出现在多个分类中（如 Video-LLaVA）

## 推荐搭配

如果你要认真选型，建议搭配以下资源：
- [Awesome AIGC 3D](https://github.com/hitcslj/Awesome-AIGC-3D) — 3D 生成专题
- [Awesome Game AI](https://github.com/datamllab/awesome-game-ai) — 传统游戏 AI（行为树、寻路等）
- [ARC-AGI-3](https://arcprize.org/arc-agi/3) — AI Agent 在交互环境中的基准测试
- [Papers With Code](https://paperswithcode.com/) — 各类 AI 模型的性能排行

## 参考资源

- 仓库首页：https://github.com/Yuan-ManX/ai-game-devtools
- François Chollet, *On the Measure of Intelligence*: https://arxiv.org/abs/1911.01547
- NVIDIA Cosmos: https://github.com/NVIDIA/Cosmos
- Google Genie: https://arxiv.org/abs/2402.15391
