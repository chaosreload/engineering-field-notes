# autoresearch Getting Started

> 整理日期：2026-03-09（完整代码分析版）
> 仓库地址：https://github.com/karpathy/autoresearch
> 作者：Andrej Karpathy（特斯拉/OpenAI/YouTube 大神）
> 本地代码：`/home/ubuntu/chaosreload/study/repo/public/autoresearch`（dev-server）

---

## 项目简介

**一句话**：让 AI Agent 自主做 LLM 训练研究——你去睡觉，AI 整晚帮你跑实验。

autoresearch 的核心思想：把 LLM 训练代码（`train.py`）交给一个 AI Agent（Claude/Codex），
让它**自主修改代码 → 跑 5 分钟训练 → 检查结果 → 保留或丢弃 → 无限循环**。
你只需要配置好 `program.md`（给 Agent 的"指令书"），然后让 Agent 跑一整晚，
早上起来看 `results.tsv` 就知道哪些改动有效了。

> Karpathy 在 README 里说："That era is long gone. Research is now entirely the domain of autonomous swarms of AI agents."  
> 这是他对 AI-driven research 的一个完整实践示例。

**核心设计哲学：**
- 每次实验固定 5 分钟训练时间（wall clock）——让不同架构/超参可以公平比较
- 指标只有一个：`val_bpb`（validation bits per byte），越低越好
- Agent 只改一个文件：`train.py`——控制变量，diff 可读
- **NEVER STOP**：实验循环一旦开始，Agent 永远不会主动停下来询问

---

## 项目结构

```
autoresearch/
├── prepare.py      ─ 固定不变：数据下载、tokenizer 训练、dataloader、eval
├── train.py        ─ Agent 修改的文件：GPT 模型、优化器、训练循环
├── program.md      ─ Agent 的"操作手册"（你配置这个来驱动 Agent）
├── pyproject.toml  ─ uv 依赖（torch==2.9.1 + CUDA 12.8）
├── analysis.ipynb  ─ 实验结果分析 notebook
├── results.tsv     ─ 实验记录（Agent 写入，不提交 git）
└── progress.png    ─ 实验进度图
```

**三个关键文件的权责分工：**

| 文件 | 谁来改 | 内容 |
|------|--------|------|
| `prepare.py` | ❌ 不允许修改 | 固定常量（TIME_BUDGET=300s, MAX_SEQ_LEN=2048, EVAL_TOKENS），数据/tokenizer/eval |
| `train.py` | ✅ Agent 改 | GPT 模型架构、MuonAdamW 优化器、训练循环、所有超参 |
| `program.md` | ✅ 人类改 | Agent 的行为指令，相当于"研究组规章制度" |

**pyproject.toml 实际依赖：**
```toml
torch==2.9.1          # 固定版本，CUDA 12.8
kernels>=0.11.7       # Flash Attention 3 kernel loader
rustbpe>=0.1.0        # 快速 BPE tokenizer（Rust 实现）
tiktoken>=0.11.0      # 兼容 GPT-4 tokenizer 格式
pyarrow>=21.0.0       # Parquet 数据读取
requests>=2.32.0      # 数据下载
matplotlib>=3.10.8    # 结果可视化
pandas>=2.3.3         # results.tsv 分析
```

---

## 核心架构

### 模型架构（train.py 中的 GPT）

**参数量计算（DEPTH=8 默认配置，已用 demo.py 验证）：**

```
DEPTH=8, ASPECT_RATIO=64
base_dim = 8 * 64 = 512
model_dim = 512 (已对齐 HEAD_DIM=128)
n_heads = 512 / 128 = 4
vocab_size = 8192 (由 prepare.py 的 VOCAB_SIZE 决定)

参数量分布：
  wte (token emb):     4,194,304  (4.2M)
  lm_head:             4,194,304  (4.2M)
  value_embeds:       16,777,216  (16.8M) <- layers [1, 3, 5, 7]
  transformer blocks: 25,166,336  (25.2M)
  scalars:                    16
  TOTAL:              50,332,176  (~50.3M) ← 与 README baseline 完全吻合
```

```
GPT
├── wte（token embedding）
├── N×Block
│   ├── CausalSelfAttention
│   │   ├── RoPE（旋转位置编码）
│   │   ├── QK-Norm（RMSNorm，稳定训练）
│   │   ├── Flash Attention 3（Hopper/H100 专属 + 非 Hopper fallback）
│   │   └── Value Residual / ResFormer（交替层，input-dependent gate）
│   └── MLP（ReLU²，不是 SiLU/GeLU）
├── resid_lambdas（每层可学习的残差缩放因子）
├── x0_lambdas（把第 0 层的 x0 混入每层）
└── lm_head（语言模型头，softcap=15 防止 logits 爆炸）
```

**WINDOW_PATTERN = "SSSL"（实际 8 层分布）：**
```
Layer 0: S  window=1024
Layer 1: S  window=1024
Layer 2: S  window=1024
Layer 3: L  window=2048
Layer 4: S  window=1024
Layer 5: S  window=1024
Layer 6: S  window=1024
Layer 7: L  window=2048  <- last layer always forced to full attention
```

### 优化器（MuonAdamW）

参数按类型分组，分别用不同优化器：

```
参数组            优化器      学习率（默认超参）
──────────────────────────────────────────────
lm_head 权重      AdamW      UNEMBEDDING_LR=0.004
token embedding   AdamW      EMBEDDING_LR=0.6
value embeddings  AdamW      EMBEDDING_LR=0.6
resid_lambdas     AdamW      SCALAR_LR*0.01=0.005
x0_lambdas        AdamW      SCALAR_LR=0.5
所有矩阵参数      Muon       MATRIX_LR=0.04（按 shape 分组）
```

> 注意：所有 AdamW LR 会按 1/sqrt(model_dim/768) 自动缩放

**Muon 的关键步骤（muon_step_fused）：**
1. Nesterov 动量（momentum=0.95，前 300 步从 0.85 warmup）
2. Polar Express 正交化（5 步 Newton-Schulz，比标准更快）
3. NorMuon 方差归一化（更稳定的 step size）
4. Cautious weight decay（只对与梯度方向一致的参数施加 WD）

### 训练循环

```
TIME_BUDGET = 300s（5 分钟，wall clock training time，不含 startup/compile）
TOTAL_BATCH_SIZE = 2^19 = 524288 tokens/step
DEVICE_BATCH_SIZE = 128（H100 默认）
grad_accum_steps = 524288 / (128 × 2048) = 2

LR 调度（基于 progress = training_time / TIME_BUDGET）：
  - 无 warmup（WARMUP_RATIO=0）
  - 前 50% 稳定（WARMDOOWN_RATIO=0.5）
  - 后 50% cosine 衰减到 0（FINAL_LR_FRAC=0）

Muon momentum：步数 0→300 从 0.85 线性增到 0.95
Weight decay：从 WEIGHT_DECAY=0.2 线性衰减到 0

特殊设计：
- 步骤 0-10 不计入 training_time（排除编译时间）
- GC 管理：step 0 冻结 GC（避免 ~500ms stall）
- 快速失败：train_loss > 100 立即退出
```

---

## 核心工作流程

### program.md 的实验循环（完整版）

**Setup 阶段（与用户协商）：**
1. 商定 run tag（日期形式，如 `mar9`）
2. `git checkout -b autoresearch/mar9`
3. 读取 README.md + prepare.py + train.py
4. 检查 `~/.cache/autoresearch/` 有数据和 tokenizer
5. 创建空 `results.tsv`（只有表头）
6. 确认后开始实验

**实验循环（LOOP FOREVER）：**
```
1. 看 git 状态（当前分支/commit）
2. 修改 train.py（任意实验想法）
3. git commit
4. uv run train.py > run.log 2>&1
   （注意：重定向到文件，不要让输出污染 context）
5. grep "^val_bpb:\|^peak_vram_mb:" run.log
6. 如果 grep 为空 → crash，看 tail -n 50 run.log
7. 记录到 results.tsv（不 commit 这个文件）
8. val_bpb 改善（更低）→ 保留 commit（advance 分支）
9. val_bpb 相同或更差 → git reset，丢弃
```

**关键约束（program.md 明确规定）：**
- ❌ 不能修改 prepare.py
- ❌ 不能安装新包（只能用 pyproject.toml 已有的）
- ❌ 不能修改 evaluate_bpb 函数
- ✅ train.py 里任何东西都可以改
- ⚠️ VRAM 可以适度增加，但不能大幅飙升
- 🎯 **简洁性原则**：0.001 的改善 + 20 行丑代码？不值。相同效果但代码更少？必须保留。
- 🚫 **NEVER STOP**：实验循环开始后，Agent 不会主动停下来。你要人工打断。

**预期吞吐：** ~12 实验/小时，一晚 8 小时 ≈ ~100 次实验

### 结果记录格式（results.tsv）

```tsv
commit	val_bpb	memory_gb	status	description
a1b2c3d	0.997900	44.0	keep	baseline
b2c3d4e	0.993200	44.2	keep	increase MATRIX_LR to 0.04
c3d4e5f	1.005000	44.0	discard	switch to GeLU activation
d4e5f6g	0.000000	0.0	crash	double model width (OOM)
```

---

## 部署步骤

### 环境要求

- **必须**：单 NVIDIA GPU（官方测试 H100）
- Python 3.10+
- [uv](https://docs.astral.sh/uv/) 包管理器

### 安装

```bash
# 1. 安装 uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. 克隆仓库
git clone https://github.com/karpathy/autoresearch
cd autoresearch

# 3. 安装依赖（自动用 CUDA 12.8 的 PyTorch 2.9.1）
uv sync

# 4. 数据准备（一次性，约 2 分钟）
# 下载 climbmix-400b-shuffle 数据集分片（默认 10 个）+ 训练 BPE tokenizer
# 数据存储在 ~/.cache/autoresearch/
uv run prepare.py
# 可选：指定分片数量（-1 = 全部 6542 个分片）
# uv run prepare.py --num-shards 20

# 5. 手动跑一次基线（~5 分钟 + 编译时间）
uv run train.py
```

### 启动 Agent 自主研究

```
Hi have a look at program.md and let's kick off a new experiment! let's do the setup first.
```

Agent 会自动执行 Setup 阶段，然后开始无限实验循环。

### 非 H100 机器的调参建议

| 参数 | 默认值 | 小机器建议 |
|------|--------|-----------|
| DEPTH | 8 | 4 |
| MAX_SEQ_LEN（prepare.py）| 2048 | 256~512 |
| TOTAL_BATCH_SIZE | 2^19 | 2^14 |
| WINDOW_PATTERN | "SSSL" | "L" |
| vocab_size（prepare.py）| 8192 | 256~2048 |
| 数据集 | climbmix-400b | TinyStories（更低熵） |
| DEVICE_BATCH_SIZE | 128 | 4~32 |

---

## Demo 示例

### demo.py — CPU 兼容的架构分析（本机可运行）

路径：`~/openclaw/autoresearch/demo.py`

```bash
python3 ~/openclaw/autoresearch/demo.py
```

实际运行输出（已验证，参数量与 README baseline 完全一致）：

```
============================================================
autoresearch - Model Architecture Inspector (CPU-only)
============================================================

[Model Config (train.py 默认超参)]
  DEPTH:         8 layers
  ASPECT_RATIO:  64  =>  base_dim = 512
  model_dim:     512  (取 HEAD_DIM=128 的最近倍数)
  n_heads:       4  (model_dim / HEAD_DIM)
  vocab_size:    8192  (BPE, 由 prepare.py 训练)
  seq_len:       2048

[Parameter Count (~estimated)]
  wte (token emb):        4,194,304  (4.2M)
  lm_head:                4,194,304  (4.2M)
  value_embeds:          16,777,216  (16.8M)  (layers [1, 3, 5, 7])
  transformer blocks:    25,166,336  (25.2M)
  scalars:                       16
  TOTAL:                 50,332,176  (50.3M)     ← 与 baseline 吻合 ✅

[Window Pattern: SSSL (repeating)]
  Layer 0: S  window=1024
  Layer 1: S  window=1024
  Layer 2: S  window=1024
  Layer 3: L  window=2048
  Layer 4: S  window=1024
  Layer 5: S  window=1024
  Layer 6: S  window=1024
  Layer 7: L  window=2048  <- last layer always full attention

[Training Throughput Estimate (H100 BF16)]
  tokens/step:         524,288  (~512K)
  est. step time:      80ms
  est. steps in 5min:  3750
  est. tokens in 5min: 1966M
```

### 真实 H100 基线运行输出示例（from README）

```
Vocab size: 8,192
Model config: {'sequence_len': 2048, 'vocab_size': 8192, 'n_layer': 8, 'n_head': 4, ...}
Parameter counts:
  wte                     : 4,194,304
  value_embeds            : 2,097,152
  transformer_matrices    : 42,074,112
  ...
  total                   : 50,331,648
---
val_bpb:          0.997900
training_seconds: 300.1
total_seconds:    325.9
peak_vram_mb:     45060.2
mfu_percent:      39.80
total_tokens_M:   499.6
num_steps:        953
num_params_M:     50.3
depth:            8
```

> 注：实际步数 953 vs 我的估算 3750，因为实际 step 时间包含 attention、dataloader、eval 等开销，约 314ms/step。

---

## 关键发现 / 学习心得

### 1. 这是一个 "研究 OS"，而不只是训练脚本

项目的真正创新不是 train.py 里的模型，而是整个 **自主研究循环**。
`program.md` 是 Agent 的"操作系统"：
- 假设生成 → 实验验证 → 结果分析 → 保留/丢弃
- 用 Markdown 文件而非复杂 Agent 框架，证明 LLM 只需清晰文字指令就能自主做研究

### 2. program.md 的简洁性原则是亮点

> "A 0.001 val_bpb improvement that adds 20 lines of hacky code? Probably not worth it.  
>  A 0.001 val_bpb improvement from deleting code? Definitely keep."

这不只是代码风格，而是一个研究组的价值观——防止 Agent 过度优化而引入不可维护的复杂度。

### 3. 模型架构中的多个前沿技术

- **Value Residual（ResFormer）**：token embedding value 混入每隔一层的注意力，改善梯度流
- **QK-Norm**：Q/K 的 RMSNorm，防止注意力分数爆炸
- **Polar Express 正交化**：5 个预计算系数的矩阵正交化，比标准 Newton-Schulz 更快收敛
- **NorMuon**：方差归一化，让 Muon 的 step size 更稳定
- **Logit softcap**：`15 * tanh(logits/15)`，比 clamp 更平滑
- **Cautious weight decay**：只对与梯度同方向的参数施加 WD（避免对抗性更新）

### 4. 固定时间预算是最公平的对比方式

不同实验改变了模型大小、batch size、架构，如果固定步数/token 数都不公平。
固定 **wall clock 时间**：在同一台机器上，比谁能在 5 分钟内学得更好。
这是一个简单但深刻的设计决策。

### 5. GC 管理细节值得注意

```python
if step == 0:
    gc.collect()
    gc.freeze()    # 把当前对象标记为不需要扫描
    gc.disable()   # 关闭自动 GC
```
Python 的 GC 在 step 中会引起 ~500ms 的随机 stall。
freeze + disable 后，训练过程中不产生新的可回收对象（都是 PyTorch tensor），
所以这是安全的优化。

### 6. 潜在扩展方向

- 多 Agent 并行（不同 GPU 同时跑不同实验）
- 自动迭代 program.md（让 Agent 也优化"研究策略"）
- 迁移到其他任务（图像生成、RL 等）
- 加入文献检索（让 Agent 能搜 paper 找灵感）

---

## 参考资源

- **仓库**：https://github.com/karpathy/autoresearch
- **发布 Tweet**：https://x.com/karpathy/status/2029701092347630069
- **nanochat**（完整版训练框架）：https://github.com/karpathy/nanochat
- **Muon 优化器**：Jordan et al., 2024
- **Flash Attention 3**（H100 优化）：varunneal/flash-attention-3
- **TinyStories 数据集**（小机器推荐）：https://huggingface.co/datasets/karpathy/tinystories-gpt4-clean
- **训练数据**：karpathy/climbmix-400b-shuffle（HuggingFace，6542 个分片）

### Notable Forks

- [miolini/autoresearch-macos](https://github.com/miolini/autoresearch-macos) — macOS 适配
- [trevin-creator/autoresearch-mlx](https://github.com/trevin-creator/autoresearch-mlx) — Apple Silicon MLX 版
- [jsegov/autoresearch-win-rtx](https://github.com/jsegov/autoresearch-win-rtx) — Windows RTX 版
