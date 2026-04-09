# TimesFM Getting Started

> 整理日期：2026-04-09
> 仓库地址：https://github.com/google-research/timesfm

## 项目简介

TimesFM（Time Series Foundation Model）是 Google Research 开发的**预训练时间序列基础模型**，用于零样本时间序列预测。核心思路：借鉴 LLM 的 decoder-only 架构，在海量时间序列数据上预训练，使其无需针对特定数据集微调即可直接预测。

**关键特征：**
- 200M 参数（2.5 版本，相比 2.0 的 500M 大幅精简）
- 支持最长 16K context（从 2048 大幅提升）
- 连续分位数预测（最长 1K horizon）
- 支持 PyTorch 和 Flax 两个后端
- 已集成到 Google BigQuery 作为正式产品
- 论文：[A decoder-only foundation model for time-series forecasting](https://arxiv.org/abs/2310.10688)，ICML 2024

**适合场景：**
- 需要对大量异构时间序列做快速预测（零样本，无需逐个训练）
- 需要不确定性估计（分位数预测）
- 已有时间序列数据但缺少标注/历史预测模型

**⭐ 15.7K stars，1.4K forks，Apache-2.0 协议**

## 项目结构

```
timesfm/
├── src/timesfm/                    # 核心源码（2.5 版本）
│   ├── __init__.py                 # API 入口，导出 TimesFM_2p5_200M_torch/flax
│   ├── configs.py                  # 所有配置类（ForecastConfig、TransformerConfig 等）
│   ├── timesfm_2p5/                # 2.5 版本模型实现
│   │   ├── timesfm_2p5_base.py     # 框架无关的基类（forecast、forecast_with_covariates）
│   │   ├── timesfm_2p5_torch.py    # PyTorch 实现
│   │   └── timesfm_2p5_flax.py     # Flax/JAX 实现
│   ├── torch/                      # PyTorch 底层组件
│   │   ├── transformer.py          # Transformer + Multi-Head Attention + RoPE
│   │   ├── dense.py                # ResidualBlock
│   │   ├── normalization.py        # RMSNorm
│   │   └── util.py                 # RevIN、running stats、DecodeCache
│   ├── flax/                       # Flax 底层组件（对称结构）
│   └── utils/
│       └── xreg_lib.py             # 外部回归（XReg）协变量支持
├── v1/                             # 旧版本（1.0/2.0）存档
├── timesfm-forecasting/            # Agent SKILL + 示例脚本
│   ├── SKILL.md                    # AI Agent 可调用的技能描述
│   ├── scripts/                    # forecast_csv.py, check_system.py
│   └── references/                 # API 参考文档
└── pyproject.toml                  # 包配置，依赖声明
```

**代码量极精简**：核心推理代码约 2000 行 Python，模型定义 + 推理 + Transformer 全部自包含。

## 核心架构

### 总体设计：Decoder-Only Patched Transformer

TimesFM 的核心设计理念是把时间序列预测问题转化为**序列到序列的 token 生成问题**，借鉴了 GPT 的 decoder-only 架构：

```
时间序列 → 分 Patch → Tokenizer → Stacked Transformers → Output Projection → 预测值 + 分位数
```

### 架构参数（2.5 版本 - 200M）

| 参数 | 值 | 说明 |
|------|----|------|
| input_patch_len | 32 | 每个输入 patch 的长度 |
| output_patch_len | 128 | 每个输出 patch 的长度（4× 输入） |
| output_quantile_len | 1024 | 连续分位数头的最大长度 |
| model_dims | 1280 | Transformer 隐藏层维度 |
| num_layers | 20 | Transformer 层数 |
| num_heads | 16 | 注意力头数 |
| head_dim | 80 | 每个头的维度 |
| context_limit | 16384 | 最大 context 长度 |
| quantiles | 10th-90th | 9 个分位数 + 中位数 |

### 数据流详解

```
输入时间序列 (batch, context)
    │
    ├─ strip_leading_nans → linear_interpolation   # 预处理：去 NaN + 线性插值
    │
    ├─ 按 patch_len=32 切分 → (batch, num_patches, 32)
    │
    ├─ RevIN 归一化（per-patch running mean/std）
    │    └─ update_running_stats: Welford 算法在线计算 μ/σ
    │
    ├─ Tokenizer (ResidualBlock)
    │    └─ [input(64) → hidden(1280) → output(1280), Swish]
    │    └─ 输入 = concat(patch_values, mask)  ← 64 = 32 + 32
    │
    ├─ 20× Transformer Layer
    │    ├─ Pre-Attention RMSNorm
    │    ├─ Fused QKV Linear → Multi-Head Attention (16 heads)
    │    │    ├─ RoPE 位置编码
    │    │    ├─ Per-Dim Scale (替代 1/√d 的 softplus scaling)
    │    │    ├─ QK RMSNorm
    │    │    └─ Causal Mask + Padding Mask
    │    ├─ Post-Attention RMSNorm + Residual
    │    ├─ Pre-FF RMSNorm
    │    ├─ FFN (1280 → 1280, Swish)
    │    └─ Post-FF RMSNorm + Residual
    │
    ├─ Output Projection (Point)
    │    └─ ResidualBlock → (batch, num_patches, 1280)
    │    └─ reshape → (batch, num_patches, 128, 10)  # 128 步 × 10 分位数
    │
    ├─ Output Projection (Quantile)
    │    └─ ResidualBlock → (batch, num_patches, 10240)
    │    └─ reshape → (batch, num_patches, 1024, 10)  # 连续分位数头
    │
    ├─ RevIN 反归一化
    │
    └─ 自回归解码（如果 horizon > 128）
         └─ 把上一步输出当作新输入，重复 Transformer 推理
```

### 关键设计决策

**1. Patched Input（而非逐点 token）**

不像 NLP 的 token-by-token，TimesFM 把时间序列按固定长度 32 切成 patch。这大幅减少了序列长度（200 个时间点 → 6-7 个 patch），让 Transformer 注意力计算可控。

**2. RevIN（Reversible Instance Normalization）**

每个 patch 用 Welford 在线算法跟踪 running mean/std，归一化后送入 Transformer，输出再反归一化。这解决了时间序列量纲差异巨大的问题（股价 vs 温度 vs IoT 传感器）。

**3. 连续分位数头**

独立的 30M 参数量化头，支持最长 1024 步的连续分位数预测，避免了传统分位数回归中常见的分位数交叉问题（quantile crossing）。

**4. Flip Invariance**

保证 `TimesFM(aX + b) = a * TimesFM(X) + b`。对 `a < 0` 的情况，通过 `(f(x) - f(-x))/2` 对称化实现。

**5. KV Cache 自回归解码**

对 horizon > 128 的预测，使用 KV cache 避免重复计算前面 patch 的注意力。

## 部署步骤

### 环境要求

- Python >= 3.10
- PyTorch >= 2.0（CPU 或 CUDA）
- ~800MB 磁盘空间（模型权重 ~400MB）

### 安装（CPU 模式）

```bash
# 1. 创建虚拟环境
python3 -m venv venvs/timesfm
source venvs/timesfm/bin/activate

# 2. 安装 CPU-only PyTorch（节省空间）
pip install torch --index-url https://download.pytorch.org/whl/cpu

# 3. 安装 timesfm
git clone https://github.com/google-research/timesfm.git
cd timesfm
pip install -e .
```

### 安装（GPU 模式）

```bash
pip install -e ".[torch]"  # 自动拉取 CUDA 版 PyTorch
```

### 踩坑记录

- `huggingface-hub` 的 `[cli]` extra 在最新版已废弃，安装时会有 WARNING 但不影响使用
- CPU-only PyTorch 约 200MB，CUDA 版约 2.5GB — 如果只做推理，CPU 版够用
- 根盘空间不足时，需要用 `TMPDIR` 指向大磁盘的临时目录，否则 pip 安装过程会因为临时文件撑满

## Demo 示例

### 基础预测

```python
import torch
import numpy as np
import timesfm

torch.set_float32_matmul_precision("high")

# 加载预训练模型
model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(
    "google/timesfm-2.5-200m-pytorch"
)

# 编译（设置推理参数）
model.compile(
    timesfm.ForecastConfig(
        max_context=512,
        max_horizon=128,
        normalize_inputs=True,
        use_continuous_quantile_head=True,
        force_flip_invariance=True,
        infer_is_positive=False,
        fix_quantile_crossing=True,
    )
)

# 准备输入（3 条不同类型的时间序列）
t = np.linspace(0, 10, 200)
inputs = [
    np.sin(2 * np.pi * t / 2.5) + 0.05 * t,   # 正弦 + 趋势
    np.cumsum(np.random.normal(0, 1, 150)),      # 随机游走
    np.exp(np.linspace(0, 2, 100)),              # 指数增长
]

# 预测
point_forecast, quantile_forecast = model.forecast(horizon=24, inputs=inputs)
# point_forecast.shape = (3, 24)        → 3 条序列，24 步预测
# quantile_forecast.shape = (3, 24, 10) → 含中位数 + 9 个分位数
```

### 实际运行输出（dev-server CPU，200M 模型）

```
模型加载：14.6s（首次下载权重 + 加载到 CPU）
推理时间：0.75s（3 条序列，24 步 horizon）

[Sine+Trend] 最后 3 个观测值: [0.260, 0.377, 0.386]
  → 预测前 5 步: [0.587, 0.738, 0.863, 0.981, 1.088]  ✓ 延续上升趋势

[Random Walk] 最后 3 个观测值: [9.031, 8.312, 8.099]
  → 预测前 5 步: [7.951, 7.759, 7.504, 7.318, 7.033]  ✓ 延续下降趋势

[Exp Growth] 最后 3 个观测值: [6.908, 7.139, 7.177]
  → 预测前 5 步: [7.265, 7.337, 7.527, 7.527, 7.670]  ✓ 延续增长但增速放缓
```

### 带协变量预测（XReg）

```python
# 需要额外安装: pip install -e ".[xreg]"
model.compile(
    timesfm.ForecastConfig(
        max_context=512, max_horizon=128,
        normalize_inputs=True, return_backcast=True,  # XReg 必须开启 return_backcast
    )
)

point, quantile = model.forecast_with_covariates(
    inputs=[sales_history],
    dynamic_numerical_covariates={"temperature": [temp_full]},  # 包含未来值
    static_categorical_covariates={"region": ["north"]},
    xreg_mode="xreg + timesfm",  # 先拟合协变量，再用 TimesFM 预测残差
)
```

## 关键发现 / 学习心得

### 1. 时间序列的 "GPT 时刻"

TimesFM 验证了一个重要假说：**时间序列预测可以像 NLP 一样用大规模预训练 + 零样本推理**。200M 参数的模型在多个 benchmark 上已经打败了传统的 per-dataset 训练方法（ARIMA、Prophet、甚至部分 DNN）。

### 2. Patching 是核心创新

把时间序列切成固定长度的 patch 而非逐点处理，是 TimesFM 能 scale 到 16K context 的关键。这个思路来自 Vision Transformer 的 patch embedding，但在时间序列上的效果同样出色。

### 3. 代码极度精简

整个核心推理只有 ~2000 行 Python，没有复杂的训练循环、数据加载器或分布式逻辑。这说明时间序列基础模型的**推理侧**已经非常成熟，门槛很低。

### 4. 与 LLM 生态深度整合

- HuggingFace Hub 托管权重（`PyTorchModelHubMixin`）
- `safetensors` 格式存储
- BigQuery 已集成为正式产品
- 自带 AI Agent SKILL.md（可被 AI coding agent 直接调用）

### 5. 实际可用性

从 demo 来看，CPU 上 14s 加载 + 0.75s 推理，已经完全可以用于生产。对于需要批量预测（库存、流量、传感器）的场景，比逐个训练模型高效得多。

### 6. RevIN 设计的巧妙

Welford 在线算法计算 running stats + 归一化/反归一化，让模型能处理任意量纲的时间序列。这比简单的 Z-score 更适合在线/流式场景。

## 与同类项目对比

| 维度 | TimesFM 2.5 | Chronos (Amazon) | Lag-Llama |
|------|-------------|-------------------|-----------|
| 参数量 | 200M | 710M (large) | 100M |
| Context | 16K | 512 | 1024 |
| 预训练数据 | Google 内部 + 公开 | 公开时序数据 | 公开时序数据 |
| 推理框架 | PyTorch / Flax | PyTorch | PyTorch |
| 分位数 | 连续分位数头 | 通过 sampling | 分布参数 |
| 协变量 | 支持（XReg） | 不支持 | 不支持 |
| BigQuery 集成 | ✅ | ❌ | ❌ |

## 参考资源

- [论文 - A decoder-only foundation model for time-series forecasting (ICML 2024)](https://arxiv.org/abs/2310.10688)
- [Google Research Blog](https://research.google/blog/a-decoder-only-foundation-model-for-time-series-forecasting/)
- [HuggingFace Model Collection](https://huggingface.co/collections/google/timesfm-release-66e4be5fdb56e960c1e482a6)
- [TimesFM in BigQuery](https://cloud.google.com/bigquery/docs/timesfm-model)
- [PyTorch 权重](https://huggingface.co/google/timesfm-2.5-200m-pytorch)
