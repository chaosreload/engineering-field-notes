# OmniVoice Getting Started

> 整理日期：2026-04-22
> 仓库地址：https://github.com/k2-fsa/OmniVoice
> 论文：[arXiv:2604.00688](https://arxiv.org/abs/2604.00688)
> 作者团队：小米 AI 实验室 Han Zhu 等 + k2-fsa（Daniel Povey 所在组）

## 项目简介

OmniVoice 是 k2-fsa（Kaldi、icefall、sherpa-onnx 背后的研究组）在 2026 年 3 月底开源的**多语言零样本 TTS 模型**。主打三件事：

1. **646 种语言**，581k 小时训练数据——目前开源 TTS 里语言覆盖面最广的一个。
2. **Voice Cloning + Voice Design + Auto Voice** 三种生成模式共用一个 `model.generate()` API。
3. **推理快**：官方宣称 RTF 低到 0.025（40 倍实时），靠的是一条少见的路径——**Masked Diffusion Language Model 风格架构**。（**实测更新**：L40S + 默认配置下我们复现到 RTF 0.041 / 24.5× 实时，达不到官方值；详见下文「GPU 实测（L40S）」。）

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

## GPU 实测（L40S，2026-04-23 更新）

前面 CPU 部分跑的是 RTF ≈ 2.0（8 核 fp32，慢于实时），只验证了"能跑"。要判断能不能上生产 / 多路并发，必须补 GPU 数据。这次在 **AWS g6e.4xlarge（1× NVIDIA L40S 48GB）/ us-west-2** 上跑了 3 模式 × 3 dtype × 3 trial 的基准测试。**结论先行**：

- **最快 RTF 0.041（voice clone, fp16），约 24.5× 实时**；auto / design 模式 fp16 在 15–16× 之间。
- **官方 "RTF 0.025 / 40×" 在 L40S + 默认配置下没复现**，实测只有官方值的 60%。差距更可能来自硬件和参数口径差，不是虚假宣传。
- **L40S 对 dev-server CPU 提速 33×–50×**（取决于模式）。OmniVoice 从"不能实时"变成"可多路并发实时合成"，48 GB 显存给 batch 扩展留了很大空间。
- 单次 benchmark 实例在线 17 分钟，**成本 < $1**。

### 三模式 RTF（L40S fp16，median over 3 trials）

| 模式 | wall (s) | audio (s) | **RTF** | 实时倍数 | 对 CPU 提速 |
|---|---|---|---|---|---|
| **voice clone** | 1.00 | 24.50 | **0.041** | **24.5×** | ~49× |
| auto | 0.96 | 15.64 | 0.061 | 16.3× | ~33× |
| voice design | 1.01 | 15.38 | 0.066 | 15.2× | ~30× |

clone 模式 RTF 最低不是因为推理更快（wall time 几乎一样都 ~1s），而是生成的音频最长——clone 模式会把 ref_text 拼进生成序列，输出更长的 token 序列摊薄了固定开销。

### 三模式音频 Demo

实际听起来什么效果？下面三段是 **dev-server CPU 上用上文 demo 脚本生成的原始输出**（24 kHz, 16-bit mono WAV，未后处理）。模型权重和 L40S 完全一致，只是推理慢——所以音质就是线上 RTF 0.04 档位的真实水准。

**Auto Voice**（模型自选音色）

> 文本：_"Hello, this is a test of OmniVoice on CPU."_

<audio controls preload="none" style="width: 100%; max-width: 480px;">
  <source src="/audio/omnivoice/out_auto.wav" type="audio/wav">
  你的浏览器不支持 audio 播放。
</audio>

**Voice Cloning**（以 Auto 的输出作为参考音色，换一句话）

> 参考音色：上面那段 Auto 输出（`out_auto.wav` 当 `ref_audio`）
> 克隆文本：_"OmniVoice supports over six hundred languages."_

参考：

<audio controls preload="none" style="width: 100%; max-width: 480px;">
  <source src="/audio/omnivoice/out_auto.wav" type="audio/wav">
</audio>

克隆输出：

<audio controls preload="none" style="width: 100%; max-width: 480px;">
  <source src="/audio/omnivoice/out_clone.wav" type="audio/wav">
</audio>

连着听能听出音色基本保留，但韵律和语速被新文本重新规划了——这正是 voice cloning 想要的行为（音色迁移，不是照搬）。

**Voice Design**（属性描述式合成）

> 文本：_"Diffusion language models can decode non-autoregressively."_
> Instruct：`female, british accent`

<audio controls preload="none" style="width: 100%; max-width: 480px;">
  <source src="/audio/omnivoice/out_design.wav" type="audio/wav">
</audio>

提示：Voice Design 的 instruct 不是自由文本，必须走官方属性词典，下一节「Voice Design 的 instruct 不是自由文本」会展开讲。


### 三方对比：官方 claim / L40S 实测 / CPU

| 场景 | RTF | 倍数 | 备注 |
|---|---|---|---|
| 官方 README | **0.025** | 40× | 未注明硬件 / dtype / num_step / batch |
| L40S fp16 · clone（本次最佳） | **0.041** | 24.5× | num_step=32（默认），batch=1 |
| L40S fp16 · auto | 0.061 | 16.3× | |
| L40S fp32 · clone | 0.108 | 9.3× | fp32 拖垮吞吐 |
| dev-server CPU fp32 · auto（上文） | ≈ 2.0 | 0.5× | 慢于实时 |

### 为什么没到官方 0.025？

不是官方造假，是口径没说清。把几个可能因素列清楚：

1. **GPU 差别**：官方大概率用 H100（fp16 算力 ~2× L40S），40×→25× 的比例对得上。
2. **num_step**：官方 `docs/tips.md` 提到步数可降到 16 甚至 8，我们用了默认 32；降步近似线性降 RTF（16 步就约 0.020，直接超官方值）。
3. **Batch**：单条推理 vs batch=4/8 吞吐 RTF 能差 2–3 倍，48 GB 显存有空间堆 batch。
4. **文本长度**：短音频（3–5 s）固定开销占比高，长音频 RTF 低；官方测试文本可能更长。

所以官方 "RTF 0.025" 不是假的，是**没标硬件 + 没标参数**——读者默认按 README 抄默认配置会到不了。生产决策上记住"L40S 默认配置 ~25× 实时 / H100 或调 num_step 可能更快"就够了。

### dtype 对比（clone 模式）

| dtype | RTF | wall (s) | peak mem |
|---|---|---|---|
| **fp16** | **0.041** | 1.00 | **2.29 GB** |
| bf16 | 0.041 | 1.03 | 3.06 GB |
| fp32 | 0.108 | 2.74 | 5.15 GB |

**fp16 ≈ bf16 >> fp32**：fp16 和 bf16 几乎等速，但 fp16 显存省 25%；fp32 wall 是 fp16 的 2.7 倍。**生产直接上 fp16**，除非碰到 bf16 有显著更稳的模型行为。

注意一个坑：官方 `omnivoice-infer` CLI **硬编码 fp16**（`cli/infer.py` 里写死），不暴露 `--dtype`。要测 bf16/fp32 必须绕过 CLI，直接调 `OmniVoice.from_pretrained(..., dtype=torch.bfloat16)`。

### Voice Design 的 instruct 不是自由文本（重要使用限制）

上面 CPU 部分 Demo 3 的 instruct 是 `"female, british accent"`——看起来像自由英文 prompt，其实**不是**。

Design 模式的 instruct **有严格白名单**，不是任意英文描述。在 pre-check 里，任何白名单以外的词都会被拒绝。合法 token 是**逗号+空格分隔**的枚举值：

- **英文（24 个）**：`american accent, australian accent, british accent, canadian accent, child, chinese accent, elderly, female, high pitch, indian accent, japanese accent, korean accent, low pitch, male, middle-aged, moderate pitch, portuguese accent, russian accent, teenager, very high pitch, very low pitch, whisper, young adult`
- **中文（25 个，必须用全角逗号 `，`）**：`东北话，中年，中音调，云南话，低音调，儿童，四川话，女，宁夏话，少年，极低音调，极高音调，桂林话，河南话，济南话，甘肃话，男，石家庄话，老年，耳语，贵州话，陕西话，青岛话，青年，高音调`
- **中英不能混用**。

我第一次 benchmark 传的是一句正常英文描述 `"A young female speaker with a calm, clear, neutral English accent."`，被 pre-check 直接拒了。最终要改成 `"female, british accent, young adult"` 才能过。

这是**产品化的安全设计**——限定可控的属性组合，避免用户传任意 prompt 导致不可预期的输出（以及避开 prompt injection 类攻击）。但对使用者来说是个必须知道的限制：**design 模式不是 "prompt to voice"，是 "attribute to voice"**。CPU 部分 Demo 3 的示例代码其实正好踩在白名单上所以跑通了，没触发报错。

### 环境与成本

| 项 | 值 |
|---|---|
| Instance | g6e.4xlarge (16 vCPU / 128 GB / 1× L40S 48 GB) |
| Region / AZ | us-west-2b（2a 当时 capacity 不足） |
| AMI | Deep Learning OSS Nvidia Driver AMI GPU PyTorch 2.7（Ubuntu 22.04） |
| PyTorch | 2.7.0+cu128，venv 在 `/opt/pytorch` |
| 运行时长 | 17 分 7 秒 |
| **EC2 费用** | **≈ $0.97**（g6e.4xlarge on-demand ~$3.397/h） |
| GPU 监控 | `nvidia-smi dmon`：平均 SM util 10.2%（脉冲式），峰值 100% |
| 峰值显存 | fp16 最高 2.29 GB / fp32 最高 5.15 GB（48 GB 富裕度巨大） |

48 GB 显存对这个 812M 参数模型是**严重过剩**——单条推理只占 4–5%。可以直接堆 batch 做吞吐优化，或者单卡并发多个请求。

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
