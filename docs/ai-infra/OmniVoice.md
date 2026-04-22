# OmniVoice Getting Started

> 整理日期：2026-04-22
> 仓库地址：https://github.com/k2-fsa/OmniVoice
> 论文：[arXiv:2604.00688](https://arxiv.org/abs/2604.00688)
> 作者团队：小米 AI 实验室 Han Zhu 等 + k2-fsa（Daniel Povey 所在组）

## 项目简介

OmniVoice 是 k2-fsa（Kaldi、icefall、sherpa-onnx 背后的研究组）在 2026 年 3 月底开源的**多语言零样本 TTS 模型**。主打三件事：

1. **646 种语言**，581k 小时训练数据——目前开源 TTS 里语言覆盖面最广的一个。
2. **Voice Cloning + Voice Design + Auto Voice** 三种生成模式共用一个 `model.generate()` API。
3. **推理快**：RTF 低到 0.025（40 倍实时），靠的是一条少见的路径——**Masked Diffusion Language Model 风格架构**。

模型大小：**812.9M** 参数（Qwen3-0.6B LLM backbone + 8 层 RVQ audio codebook heads），开源协议 Apache-2.0。22 天内拿到 4.1k⭐ / 645 fork。

适合场景：需要多语言 TTS 的产品、做语音克隆/播报/配音的开源项目、想研究非自回归 TTS 解码范式的研究者。

## 项目结构

```
OmniVoice/
├── omnivoice/
│   ├── models/omnivoice.py       # 核心模型（1600 行）+ generate/_generate_iterative
│   ├── cli/
│   │   ├── demo.py               # omnivoice-demo：Gradio Web UI
│   │   ├── infer.py              # omnivoice-infer：单条推理
│   │   └── infer_batch.py        # omnivoice-infer-batch：多 GPU 批量
│   ├── data/                     # dataset / collator / processor / batching
│   ├── training/                 # trainer / builder / config / checkpoint
│   ├── eval/                     # WER (Whisper/FunASR/HuBERT)、speaker sim (ECAPA-TDNN-WavLM)、UTMOS
│   ├── scripts/                  # 音频去噪、RVQ token 抽取、JSONL → WebDataset
│   └── utils/                    # 文本规范化、多语言 ID、voice-design 属性词典等
├── examples/                     # 训练/微调/评测脚本 + 5 份 JSON 配置
├── docs/                         # 语言清单、训练、数据准备、voice-design、tips 等
└── pyproject.toml                # hatchling + uv，发布到 PyPI: `omnivoice`
```

代码规模：45 个 Python 文件，约 **13.8k 行**。模块清晰，没有散架的 `utils/misc.py` 那种混乱感。

## 核心架构

一句话：**Qwen3-0.6B 当 LLM 骨干 → 输出 8 层 RVQ codebook 的 logits → 用 MaskGIT 式并行非自回归方式迭代解码 → 用音频 tokenizer 还原波形**。

### 模型组成（`OmniVoice` 类）

```
text tokens ─┐
              ├→ concat ─→ LLM (Qwen3-0.6B)
ref audio ──→ HiggsAudioV2 Tokenizer → RVQ tokens (C=8, V=1024) ┐
                                                                ↓
                                          hidden states ─→ audio_heads (Linear → C×V)
                                                                ↓
                                                      8-layer codebook logits
                                                                ↓
                                                 iterative unmasking × 16~32 step
                                                                ↓
                                            HiggsAudio tokenizer decode → 24kHz PCM
```

关键实现细节（`omnivoice/models/omnivoice.py`）：

- **音频词表**：`audio_vocab_size=1025`（1024 token + 1 个 `[MASK]` id=1024），`num_audio_codebook=8`，即 **Residual Vector Quantization** 的 8 层。
- **codebook 层权重**：`[8, 8, 6, 6, 4, 4, 2, 2]` —— 浅层语义更重要，损失加权也更大。
- **LLM backbone**：默认 `Qwen/Qwen3-0.6B`（训练时从 config 指定，不是用 Qwen3 预训练权重，是同构架构 + 自己从头训）。
- **支持的 attention 实现**：`flex_attention` / `flash_attention_2` / `sdpa`，老 GPU 可 fallback 到 SDPA。

### 不是经典 "Diffusion TTS"

这是 OmniVoice 最容易被误解的地方。名字里有 "Diffusion Language Model"，但它：

- **不是** Denoising Diffusion（像 NaturalSpeech2、SoundStorm）那种在连续 latent 上加噪声再去噪的 DDPM。
- **是** **Discrete Masked Diffusion**——和 MaskGIT / SUNDAE / D3PM 是同一条路线：把 RVQ 离散 token 按 cosine schedule 逐步 unmask，每步预测所有 mask 位置的 token 分布，然后按置信度 top-k 一次性解掉一批。

这就是它能做到 RTF 0.025 的根本原因：**16 步**迭代 vs AR 模型每步只能吐一个 token 的**数百步**。

### `_generate_iterative` 核心循环

```python
for step in range(gen_config.num_step):       # 默认 32，提速用 16
    logits = self(input_ids, audio_mask, attention_mask).logits  # 一次前向批掉 cond + uncond
    for i in range(B):
        c_logits = logits[i]            # 条件分支
        u_logits = logits[B + i]        # 无条件分支（CFG）
        log_probs = c + s * (c - u)     # classifier-free guidance
        scores = confidence - layer_penalty * layer_id   # 层惩罚：浅层优先 unmask
        scores = gumbel_sample(scores, position_temperature)
        topk_idx = torch.topk(scores, k)
        tokens[topk_idx] = predict_tokens[topk_idx]      # 一次解 k 个位置
```

几个值得注意的设计：

- **Classifier-Free Guidance (CFG)**：条件和无条件 batch 起来一次前向，`guidance_scale=2.0` 默认。
- **Layer Penalty**（`layer_penalty_factor=5.0`）：强制**浅层 codebook 优先 unmask**，因为浅层 RVQ 承载主要内容，深层是残差精修。
- **Position Temperature**（Gumbel 采样位置）+ **Class Temperature**（采样 token 值）分离，能分别控制"解哪里"和"解成啥"的随机性。
- **Time-step schedule + shift**：`t_shift=0.1` 让 schedule 偏向早期步骤，早期 mask 率高时解的少、晚期解的多。

## 核心工作流程

### 推理（voice cloning）

```
text + ref_audio + ref_text
    ↓
_prepare_inference_inputs   (文本 tokenize + ref audio → RVQ tokens + 拼 prompt)
    ↓
GenerationTask → 短句 batch + 长句走 chunking
    ↓
_generate_iterative          (16~32 步并行解 mask)
    ↓
audio_tokenizer.decode       (HiggsAudioV2 反向得到 24kHz 波形)
    ↓
postprocess                  (去静音 / fade / pad)
```

长文本（>30s 预估时长）会自动切成 15s/片段串联，显存基本恒定。

### 训练

`examples/run_emilia.sh`（3 阶段：校验 → tokenize → accelerate 多卡训）

- 数据集：Emilia（中英各一半），用 HuggingFace `zhu-han/Emilia-Manifests`
- 超参（`train_config_emilia.json`）：
  - 300k steps, batch_tokens=8192, lr=1e-4, warmup_ratio=0.03, bf16
  - DeepSpeed ZeRO-2（`ds_config_zero2.json`）
- 关键训练 trick（从 config 看）：
  - `drop_cond_ratio=0.1`：10% 概率丢弃 condition，让模型同时学会无条件生成 → CFG 必备
  - `prompt_ratio_range=[0, 0.3]`：参考音频长度随机在文本的 0~30%
  - `mask_ratio_range=[0, 1.0]`：每步 mask 比例完全随机
  - `language_ratio / use_pinyin_ratio / instruct_ratio`：训练时对语言 ID、pinyin、voice-design 指令随机 drop，鲁棒性

微调：从 `k2-fsa/OmniVoice` checkpoint 开，5000 steps，lr=5e-5。

## 部署步骤

### 环境

dev-server（Ubuntu 22.04，8 CPU，30GB RAM，**无 GPU**，Python 3.10.12）。

### 坑点 1：HF cache 默认在 `~/.cache`，根盘会爆

dev-server 根盘只有 3.3GB 空余，模型 + tokenizer 总共 3GB 左右，直接 OOD。

```bash
rm -rf ~/.cache/huggingface
mkdir -p /data/projects/chaosreload/hf-cache
export HF_HOME=/data/projects/chaosreload/hf-cache
export HF_HUB_CACHE=/data/projects/chaosreload/hf-cache/hub
```

### 坑点 2：CPU 不要用 float16

CPU 推理走 float16 会非常慢甚至数值不稳，必须显式 `dtype=torch.float32`。

### 安装（CPU）

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cpu
pip install omnivoice
```

装上的 transformers 会是 5.6.0，比项目 `>=5.3.0` 要求要新，实测兼容。

### 验证

```bash
python3 -c "from omnivoice import OmniVoice, OmniVoiceGenerationConfig; print('ok')"
```

## Demo 示例

### Demo 1：Auto Voice（最短路径，验证端到端）

```python
import os, time, torch, soundfile as sf
os.environ["HF_HOME"] = "/data/projects/chaosreload/hf-cache"

from omnivoice import OmniVoice, OmniVoiceGenerationConfig

model = OmniVoice.from_pretrained(
    "k2-fsa/OmniVoice", device_map="cpu", dtype=torch.float32
)
model.eval()

gen_config = OmniVoiceGenerationConfig(num_step=16, guidance_scale=2.0)
audio = model.generate(
    text="Hello, this is a test of OmniVoice on CPU.",
    generation_config=gen_config,
)
sf.write("out_auto.wav", audio[0], 24000)
```

实测：
- 首次加载：12.9s（含下载 3.1G 模型权重）
- 二次加载（缓存命中）：2.9s
- 生成 2.64s 音频耗时 5.3s → **CPU RTF ≈ 2.0**（8 核）

### Demo 2：Voice Cloning

```python
audio = model.generate(
    text="OmniVoice supports over six hundred languages.",
    ref_audio="out_auto.wav",
    ref_text="Hello, this is a test of OmniVoice on CPU.",
    generation_config=gen_config,
)
sf.write("out_clone.wav", audio[0], 24000)
```

实测：生成 3.28s 音频耗时 9.5s → CPU RTF ≈ 2.9（多了 ref_audio 的 RVQ tokenize）。

> 如果不传 `ref_text`，模型会自动拉 `openai/whisper-large-v3-turbo` 做转写（会多下 1.6G 模型）。

### Demo 3：Voice Design（属性描述式合成）

```python
audio = model.generate(
    text="Diffusion language models can decode non-autoregressively.",
    instruct="female, british accent",
    generation_config=gen_config,
)
sf.write("out_design.wav", audio[0], 24000)
```

支持的 instruct 属性（来自 `docs/voice-design.md`）：

| 类别 | 可选值 |
|------|--------|
| gender | male / female |
| age | child / teenager / young adult / middle-aged / elderly |
| pitch | very low / low / medium / high / very high |
| style | whisper |
| English accent | American / British / Australian / Indian / … |
| Chinese dialect | 四川话 / 陕西话 / 广东话 / … |

同类互斥，跨类任意组合。Voice Design 只在中英数据上训过，低资源语言可能不稳。

### 完整 demo 目录

- `/data/projects/chaosreload/study/demo/OmniVoice/demo.py` — auto voice
- `/data/projects/chaosreload/study/demo/OmniVoice/demo_clone.py` — cloning + design
- 输出：`out_auto.wav` / `out_clone.wav` / `out_design.wav` 均为 24kHz 16-bit mono PCM。

## 关键发现 / 学习心得

### 1. Masked Diffusion 是非自回归 TTS 的真正走向之一

业界最近两年的开源 TTS 主流是两条路：

- **AR 离散 codec**（VALL-E、XTTS、F5-TTS 某些变体、CosyVoice、Sesame、VibeVoice 部分）——每步吐一个 token，慢但质量稳。
- **Flow Matching / Rectified Flow**（F5-TTS、Spark-TTS）——在连续 latent 上做 ODE，少步数但实现复杂。

OmniVoice 走的第三条路——**离散 masked diffusion**——在开源 TTS 里比较少见（SoundStorm 是代表但没真正开源大模型）。它的优势是：
- 推理并行度高（16 步 × 每步批量 unmask）
- 对 AR 的错误累积天然免疫（不是一 token 接一 token）
- 实现简单到不需要 ODE solver，就是 `for step in range(16): batch_forward + topk_unmask`

VibeVoice（微软，之前在我们 `ai-infra/VibeVoice.md` 整理过）走的是 AR + diffusion head，和 OmniVoice 刚好形成对比——一个 AR+diff，一个 masked-diff-only。

### 2. 646 语言是怎么做到的？

答案是**训练数据多样化 + 语言 ID embedding + CFG drop**。看 `utils/lang_map.py` 里有 `LANG_IDS`，训练时 `language_ratio=0.0` 的配置其实是**完全不靠 language id**，模型纯靠文本字符分布学多语言（Unicode tokenizer + 覆盖面够广的训练数据）。

这一点和以前那种"每种语言一个微调模型"的做法差别很大——OmniVoice 一个 checkpoint 覆盖 646 种，代价是每种语言的质量不如专门微调的，但覆盖面是真没对手。

### 3. CPU RTF 2.0 已经"可用"

我在 8 核 CPU 上跑 16 步、3 秒音频耗时 5-10 秒，对于**本地批处理**或**离线字幕配音**场景是完全可接受的。如果是实时场景，官方说 A100 上 RTF 0.025（40 倍实时），意味着 1 秒 GPU 能生成 40 秒音频——足够做流式 TTS。

这种 CPU 可用性在 AR TTS 里很难实现（AR 必须一步步走）。

### 4. 生态已经很活跃（22 天）

`docs/community-projects.md` 列了 10+ 个社区项目：
- **vllm-omni**（vLLM 官方）：表明 vLLM 团队在做 omni 模态推理，把 OmniVoice 作为 TTS reference case。
- **omnivoice-rs**（Candle）：Rust + GPU 推理 + OpenAI 兼容 `/v1/audio/speech` 端点。
- **omnivoice-trtllm**：TensorRT-LLM 部署。
- **omnivoice-server**：OpenAI 兼容 HTTP 服务。
- **ComfyUI-OmniVoice-TTS** / **MLX-Audio** / **RealtimeTTS** / **TTS-WebUI** / **pyVideoTrans** 各种集成。

一个 22 天的项目能拉出这种生态密度，侧面说明多语言零样本 TTS 确实是个卡位问题。

### 5. 训练数据透明度 = 信任

`docs/languages.md` 把 646 种语言每种的训练小时数都列出来了，总数 581k 小时。这种透明度在 TTS 大模型里很难得——很多商用 TTS（ElevenLabs、OpenAI voice）根本不说数据来源、语言覆盖、每种语言多少小时。OmniVoice 这套做法对做**合规评估**（比如欧盟 AI Act 的训练数据披露要求）非常友好。

## 参考资源

- 论文：[OmniVoice: Towards Omnilingual Zero-Shot Text-to-Speech with Diffusion Language Models](https://arxiv.org/abs/2604.00688)
- 官方 demo 页：https://zhu-han.github.io/omnivoice
- HuggingFace Model：https://huggingface.co/k2-fsa/OmniVoice
- HuggingFace Space：https://huggingface.co/spaces/k2-fsa/OmniVoice
- Colab：[OmniVoice.ipynb](https://colab.research.google.com/github/k2-fsa/OmniVoice/blob/master/docs/OmniVoice.ipynb)
- k2-fsa org：https://github.com/k2-fsa（Kaldi/icefall/sherpa-onnx 家族）
- 相关范式：
  - MaskGIT（Chang et al., 2022，image gen 的并行非自回归）
  - SoundStorm（Google, 2023，音频 masked diffusion）
  - SUNDAE / D3PM（离散 diffusion 理论基础）
- 对比阅读：本 repo 下的 `ai-infra/VibeVoice.md`（微软 AR + diffusion head 路线的同类产品）
