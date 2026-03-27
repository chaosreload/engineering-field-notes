# NitroGen — 通用游戏 Agent 基础模型

> 整理日期：2026-03-27
> 仓库地址：https://github.com/MineDojo/NitroGen
> ⭐ 1,897 Stars | 🍴 209 Forks
> 论文：https://arxiv.org/abs/2601.02427
> 团队：NVIDIA Research + Stanford + Caltech + UT Austin
> 首席：Jim Fan（NVIDIA）、Yuke Zhu、Yejin Choi、Yisong Yue

## 项目简介

**NitroGen 是一个开源的视觉-动作基础模型，能让 AI 直接看屏幕像素、输出手柄操作，跨 1000+ 款游戏玩各种类型的游戏。**

核心突破：**不需要游戏 API、不需要内部状态、不需要人工标注** — 纯粹从互联网上的游戏视频中学习。它从 YouTube 等平台的 40,000 小时游戏录像中，自动提取玩家的手柄操作（通过识别视频中的 "gamepad overlay"），然后用行为克隆训练一个 500M 参数的 DiT 模型。

**一句话定位**：游戏领域的 GPT — 像 LLM 从互联网文本学习语言一样，NitroGen 从互联网视频学习"如何玩游戏"。

## 为什么重要？

| 维度 | NitroGen 的突破 |
|------|----------------|
| **数据来源** | 互联网视频（零人工标注成本），而非昂贵的人工演示 |
| **泛化能力** | 单个模型跨 1000+ 游戏，覆盖 3D/2D/RPG/平台/Roguelike |
| **迁移学习** | 对未见游戏微调，比从零训练高 52% 任务完成率 |
| **开放性** | 模型权重、数据集、评测套件全部开源 |
| **通用接口** | 纯像素输入 → 手柄输出，无需游戏 API 或内部状态 |

## 核心架构

```
┌─────────────────────────────────────────────────────┐
│                    NitroGen 推理流程                    │
│                                                       │
│  游戏画面（像素）                                       │
│       ↓                                               │
│  SigLIP Vision Encoder                                │
│  (google/siglip-large-patch16-256)                    │
│       ↓                                               │
│  Visual-Language Self-Attention                       │
│  (视觉 token + 游戏 ID token 融合)                     │
│       ↓                                               │
│  DiT (Diffusion Transformer)  ← Flow Matching        │
│  (条件：视觉特征 + 时间步 + 噪声动作)                    │
│       ↓                                               │
│  Action Decoder (Multi-Embodiment MLP)                │
│       ↓                                               │
│  手柄动作 (左/右摇杆 + 按键)                            │
└─────────────────────────────────────────────────────┘
```

### 关键组件

1. **Vision Encoder**：SigLIP（Google 的视觉-语言预训练模型），将游戏画面编码为视觉 token
2. **Flow Matching DiT**：核心推理引擎，用 Flow Matching（而非传统扩散）生成动作序列
   - 训练时：对动作加噪，预测速度场（velocity）
   - 推理时：从噪声出发，通过多步 Euler 积分还原出动作
3. **Multi-Embodiment Action Encoder/Decoder**：支持多种游戏手柄（Xbox/PS4）的动作空间
4. **Game ID Embedding**：每个游戏一个 ID token，注入视觉特征中，实现游戏特定的行为调节
5. **Classifier-Free Guidance (CFG)**：推理时可用 CFG 增强动作质量

### 动作空间

输出统一的手柄动作格式：
- **左右摇杆**：各 2 维连续值（x, y）
- **按钮**：15 个离散按钮（A/B/X/Y、肩键、D-pad 等）
- **扳机**：左右扳机各 1 维连续值

## 项目结构

```
NitroGen/
├── nitrogen/
│   ├── cfg.py                          # 模型配置（CkptConfig、ModalityConfig）
│   ├── flow_matching_transformer/
│   │   ├── nitrogen.py                 # ⭐ 核心模型类（NitroGen、训练 forward、推理 get_action）
│   │   └── modules.py                  # DiT 和 SelfAttentionTransformer 模块
│   ├── game_env.py                     # 🎮 Windows 游戏环境封装（Gymnasium API）
│   ├── inference_client.py             # 推理客户端
│   ├── inference_session.py            # 推理会话管理
│   ├── inference_viz.py                # 推理可视化
│   ├── mm_tokenizers.py                # 多模态 tokenizer
│   └── shared.py                       # 共享工具
├── scripts/
│   ├── serve.py                        # 🚀 模型推理服务器
│   └── play.py                         # 🎮 连接游戏运行 agent
└── pyproject.toml
```

## 数据集 — 互联网规模的游戏视频

这是 NitroGen 最创新的部分：

### 数据采集流程

```
YouTube 游戏视频（带 gamepad overlay）
        ↓
1. SIFT + XFeat 特征匹配 → 定位视频中的手柄区域
        ↓
2. 裁剪手柄区域 → 分类/分割网络预测按钮和摇杆状态
        ↓
3. 质量验证（摇杆 R²=0.84，按钮帧准确率=0.96）
        ↓
40,000 小时 × 1,000+ 游戏的视频-动作数据集
```

### 数据集特征

- **规模**：40,000 小时游戏视频
- **覆盖**：1,000+ 款游戏
- **类型分布**：Action-RPG 34.9%、Platformer 18.4%、Action-Adventure 9.2%
- **数据深度**：846 款游戏 >1 小时数据，91 款 >100 小时，15 款 >1,000 小时
- **开源**：HuggingFace 上可下载（`nvidia/NitroGen`）

## 运行环境

### 系统要求

- **推理服务器**：Linux 或 Windows，需要 GPU（模型 500M 参数）
- **游戏端**：**仅 Windows 11**，Python ≥ 3.12
- **关键依赖**：需要自己拥有游戏，项目不分发游戏

### 运行流程

```bash
# 1. 安装
git clone https://github.com/MineDojo/NitroGen.git && cd NitroGen
pip install -e .

# 2. 下载模型
hf download nvidia/NitroGen ng.pt

# 3. 启动推理服务器（可以在 Linux GPU 机器上）
python scripts/serve.py <path_to_ng.pt>

# 4. 运行 agent（必须在 Windows 上，游戏正在运行）
python scripts/play.py --process 'game.exe'
```

### 游戏环境封装

`GamepadEnv` 是一个 Gymnasium 兼容的环境，它：
1. 通过进程名找到游戏窗口（win32 API）
2. 用 `dxcam` 或 `pyautogui` 截取游戏画面
3. 用 `vgamepad` 模拟 Xbox/PS4 手柄输入
4. 用 `xspeedhack` DLL 注入控制游戏暂停/加速（用于同步 step）

## 实验结果

### 预训练直接玩（零样本）

单个 500M 模型在多款游戏上的表现：
- **3D 动作游戏**：能执行战斗操作
- **2D 平台游戏**：能做高精度跳跃控制
- **程序生成世界**：能探索未知环境

### 迁移到新游戏

- 用完整数据微调：平均 **+10% 任务完成率**（vs 从零训练）
- 少量数据（30h）微调：最高 **+52% 任务完成率**
- **数据量越少，预训练的优势越大** — 经典的 foundation model 迁移特征

## 当前局限（作者明确标注）

> ⚠️ 重要：当前模型是 500M 参数 DiT，**只看最后一帧**。因此：
> - 不能做长期规划
> - 不能端到端通关
> - 不能自我改进
> - 不能玩完全没见过的游戏
> - 它是一个**快速反应的 System-1 感觉模型**

这个定位非常诚实 — NitroGen 解决的是"从互联网数据学习游戏操作"的基础问题，还不是完整的游戏 AI。

## 关键洞察 — 与 ARC-AGI-3 的关系

NitroGen 和昨天发布的 ARC-AGI-3 形成了有趣的对比：

| 维度 | NitroGen | ARC-AGI-3 |
|------|----------|-----------|
| **方法** | 行为克隆（模仿人类操作） | 测量探索/学习/适应能力 |
| **输入** | 像素 → 手柄动作 | 交互式环境 → 任意动作 |
| **核心能力** | System-1 快速反应 | System-2 推理+规划 |
| **目标** | 复现人类玩法 | 超越记忆，真正理解 |
| **AI 分数** | 多款游戏非平凡表现 | 0.26%（人类 100%） |

**连接点思维**：NitroGen 证明了"从互联网视频学习操作"是可行的，但 ARC-AGI-3 暴露了当前 AI 在"从探索中学习"上的巨大差距。下一步可能是将 NitroGen 式的操作能力与更强的推理/规划能力结合。

## 团队背景

这个项目来自 NVIDIA Research 的 Jim Fan 团队（MineDojo/Voyager 的创造者），联合了：
- **Jim Fan**（NVIDIA Senior Research Scientist）— 具身 AI 领域的明星研究者
- **Yuke Zhu**（UT Austin）— 机器人学习
- **Yejin Choi**（NVIDIA/UW）— NLP/常识推理
- **Ludwig Schmidt**（Stanford）— 数据集/基准测试

MineDojo 系列的演进路线：MineDojo（Minecraft 环境）→ Voyager（LLM Agent）→ **NitroGen（通用游戏基础模型）**

## 参考资源

- 项目官网：https://nitrogen.minedojo.org/
- 论文：https://arxiv.org/abs/2601.02427
- 模型权重：https://huggingface.co/nvidia/NitroGen
- 数据集：https://huggingface.co/datasets/nvidia/NitroGen
- 前作 MineDojo：https://minedojo.org/
- 前作 Voyager：https://voyager.minedojo.org/
