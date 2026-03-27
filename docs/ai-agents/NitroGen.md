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

## 实测部署指南 — AWS 双机架构

> 实测日期：2026-03-27
> 测试人员：weichao luo
> 测试游戏：Brawlhalla（免费格斗平台游戏）

我们在 AWS 上完成了 NitroGen 的端到端部署验证。以下是完整的踩坑记录和部署步骤。

### 架构总览

```
┌──────────────────────┐         ZeroMQ (TCP:5555)        ┌──────────────────────┐
│   推理服务器 (Linux)   │ ◄──────────────────────────────► │  游戏客户端 (Windows)  │
│                      │         同 VPC 内网通信            │                      │
│  g6e.xlarge          │                                  │  g4dn.xlarge          │
│  NVIDIA L40S (48GB)  │                                  │  NVIDIA T4 (16GB)     │
│  Ubuntu 22.04        │                                  │  Windows Server 2022  │
│                      │                                  │  + NVIDIA Gaming 驱动  │
│  serve.py            │                                  │  play.py + Steam      │
│  (模型推理)           │                                  │  (截屏+手柄模拟+游戏)   │
└──────────────────────┘                                  └──────────────────────┘
```

### 硬件配置

| 角色 | 实例类型 | GPU | VRAM | 系统内存 | 区域 | 实际用量 |
|------|---------|-----|------|---------|------|---------|
| 推理服务器 | g6e.xlarge | L40S | 48 GB | 32 GiB | us-west-2 | ~2.3 GB VRAM |
| 游戏客户端 | g4dn.xlarge | T4 | 16 GB | 16 GiB | us-west-2 | 游戏渲染用 |

> 💡 推理服务器只用了 2.3 GB / 48 GB 显存，g4dn.xlarge（T4, 16GB）甚至 g4dn.xlarge 都绰绰有余。选 g6e 是为了后续可能的微调实验。

### 推理服务器搭建（Linux）

```bash
# 1. 安装 NVIDIA 驱动
sudo apt-get update
sudo apt-get install -y ubuntu-drivers-common
sudo apt-get install -y nvidia-driver-590
sudo reboot

# 2. 验证 GPU
nvidia-smi  # 应看到 L40S / T4

# 3. 安装 Python 依赖
pip3 install --upgrade pip
git clone https://github.com/MineDojo/NitroGen.git ~/NitroGen
cd ~/NitroGen
pip3 install -e ".[serve]"
pip3 install torchvision  # 必须额外装，pyproject.toml 漏了这个依赖

# 4. 下载模型（1.97 GB）
pip3 install huggingface_hub
hf download nvidia/NitroGen ng.pt --local-dir .

# 5. 启动推理服务（后台运行）
# game_mapping_cfg 为 null 时会提示选择游戏，直接回车跳过
printf '\n' | nohup python3 scripts/serve.py ng.pt --port 5555 > /tmp/serve.log 2>&1 &

# 6. 验证服务正常
ss -tlnp | grep 5555  # 应显示 LISTEN
python3 -c "
import zmq, pickle
ctx = zmq.Context()
sock = ctx.socket(zmq.REQ)
sock.connect('tcp://localhost:5555')
sock.setsockopt(zmq.RCVTIMEO, 5000)
sock.send(pickle.dumps({'type': 'reset'}))
print(pickle.loads(sock.recv()))
sock.close(); ctx.term()
"
# 应输出: {'status': 'ok'}
```

### 游戏客户端搭建（Windows Server）

推荐 AMI：`DCV-Windows-2023.1.17701-NVIDIA-gaming-560.81`（自带 NVIDIA Gaming 驱动 + NICE DCV 远程桌面）

#### ⚠️ Windows Server 踩坑集合

**坑 1：浏览器下载被拦截**

Windows Server 默认开启 IE Enhanced Security，浏览器下载任何文件都会报 "Your current security settings do not allow this file to be downloaded"。

解决：所有下载都用 PowerShell 的 `curl.exe`（注意不是 `curl`，那是 `Invoke-WebRequest` 的别名）：
```powershell
curl.exe -L -o C:\Temp\xxx.exe "https://..."
```

**坑 2：Invoke-WebRequest TLS 错误**

GitHub 下载链接会 302 重定向，`Invoke-WebRequest` 处理不好。用 `curl.exe -L` 替代。

**坑 3：ViGEmBus 不支持 Windows Server（最大的坑！）**

NitroGen 用 `vgamepad` 库模拟虚拟 Xbox 手柄，依赖 ViGEmBus 内核驱动。最新版（v1.22.0）的安装程序 **明确拒绝在 Windows Server 上安装**。

**解决方案**：用旧版 v1.17.333 的 MSI 安装包，MSI 格式不检查 OS 版本：
```powershell
curl.exe -L -o C:\Temp\ViGEmBusSetup_x64.msi "https://github.com/nefarius/ViGEmBus/releases/download/setup-v1.17.333/ViGEmBusSetup_x64.msi"
msiexec /i C:\Temp\ViGEmBusSetup_x64.msi /qn /norestart
```
或者直接 `pip install vgamepad`，它会自动触发 ViGEmBus 安装向导（同样是旧版 MSI，能在 Server 上装）。

装完后重启。

**坑 4：Python 安装方式变更**

Python 3.12+ 在 Windows 上改用 pymanager，官网不再提供传统安装包。用 `winget` 或直接下载 3.13 安装包：
```powershell
# 方式 1：winget
winget install Python.Python.3.13

# 方式 2：直接下载
curl.exe -L -o C:\Temp\python-installer.exe "https://www.python.org/ftp/python/3.13.3/python-3.13.3-amd64.exe"
Start-Process C:\Temp\python-installer.exe -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1" -Wait
```

#### 完整安装步骤

```powershell
# 1. 安装 Python 3.13（勾选 Add to PATH）
winget install Python.Python.3.13
# 重开 PowerShell 让 PATH 生效

# 2. 安装 Git
curl.exe -L -o C:\Temp\git-installer.exe "https://github.com/git-for-windows/git/releases/download/v2.48.1.windows.1/Git-2.48.1-64-bit.exe"
Start-Process C:\Temp\git-installer.exe -ArgumentList "/VERYSILENT /NORESTART" -Wait
# 重开 PowerShell

# 3. 克隆 NitroGen 并安装（会自动触发 ViGEmBus 安装）
git clone https://github.com/MineDojo/NitroGen.git
cd NitroGen
pip install -e ".[play]"
# 弹出 ViGEmBus 安装向导，点 Next → Finish
# 重启

# 4. 安装 Steam + 下载游戏
# 安装 Steam → 登录 → 下载游戏

# 5. 启动游戏 → 手动操作到实际游戏画面 → 运行 play.py
python scripts/play.py --host '<推理服务器内网IP>' --process "Brawlhalla.exe"
```

### 网络配置

两台实例必须在 **同一个 VPC** 中。推理服务器安全组需要开放：

| 端口 | 协议 | 来源 | 用途 |
|------|------|------|------|
| 5555 | TCP | VPC CIDR（如 `172.31.0.0/16`）| ZeroMQ 推理通信 |
| 22 | TCP | 你的 IP | SSH |

Windows 实例安全组需要开放：

| 端口 | 协议 | 来源 | 用途 |
|------|------|------|------|
| 3389 | TCP | 你的 IP | RDP 远程桌面 |
| 8443 | TCP | 你的 IP | NICE DCV 远程桌面（推荐） |

> ⚠️ **安全组 CIDR 写错是最隐蔽的坑**：我们实测时 5555 端口的来源写成了 `173.31.0.0/16`（多了个 3），导致跨机器 ZMQ 连接超时，但 localhost 测试正常。

### 实测结果

**测试游戏**：Brawlhalla（免费 2D 格斗平台游戏，不在 NitroGen 训练集中）

| 阶段 | 模型表现 |
|------|---------|
| 菜单/大厅 | ❌ 乱按（预期行为，菜单不在训练数据中）|
| 实际战斗 | ⚠️ 能移动和跳跃，但无法有效攻击对手 |

这个结果符合预期：
1. **Brawlhalla 不在训练集中** — 模型是"零样本"泛化，表现有限
2. **模型只看最后一帧** — 格斗游戏需要判断对手位置和出招时机，System-1 模型做不到
3. **菜单乱按是正常的** — 需要人工先操作到实际游戏画面，再让 AI 接管

**关键发现**：
- 推理服务器 GPU 占用极低（2.3 GB / 48 GB），g4dn.xlarge 就完全够用
- 整条 pipeline 延迟可接受，ZMQ 同 VPC 内网通信几乎无感
- Windows Server 跑游戏可行但坑很多，建议用本地 Windows 10/11 桌面机更稳定

### 推荐的测试游戏

| 游戏 | 类型 | 价格 | NitroGen 预期表现 |
|------|------|------|-----------------|
| **Celeste** | 2D 平台跳跃 | $20 | ⭐⭐⭐ 论文主力测试，base model 能过关 |
| **Hollow Knight** | 2D 动作冒险 | $15 | ⭐⭐⭐ 训练集中有大量数据 |
| **Cuphead** | 2D 弹幕动作 | $20 | ⭐⭐ 代码里有专门的初始化逻辑 |
| **The Binding of Isaac** | 俯视角 Roguelike | $15 | ⭐⭐ 代码里有专门适配 |
| **Brawlhalla** | 2D 格斗 | 免费 | ⭐ 能跑通但表现一般 |

### 成本参考

| 资源 | 实例类型 | On-Demand 价格 | 备注 |
|------|---------|---------------|------|
| 推理服务器 | g6e.xlarge | ~$1.86/h | 大材小用，g4dn.xlarge ($0.526/h) 就够 |
| 游戏客户端 | g4dn.xlarge | ~$0.71/h (Windows) | DCV AMI 自带 Gaming 驱动 |
| **合计** | | **~$1.24/h**（优化后）| 用 Spot 可以更便宜 |

## 参考资源

- 项目官网：https://nitrogen.minedojo.org/
- 论文：https://arxiv.org/abs/2601.02427
- 模型权重：https://huggingface.co/nvidia/NitroGen
- 数据集：https://huggingface.co/datasets/nvidia/NitroGen
- 前作 MineDojo：https://minedojo.org/
- 前作 Voyager：https://voyager.minedojo.org/
