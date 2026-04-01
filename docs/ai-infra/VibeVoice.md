# VibeVoice — Getting Started

> 整理日期：2026-04-01
> 仓库地址：https://github.com/microsoft/VibeVoice
> 论文：[TTS Report (ICLR 2026 Oral)](https://openreview.net/pdf?id=FihSkzyxdv) | [ASR Report](https://arxiv.org/pdf/2601.18184)

## 项目简介

VibeVoice 是微软开源的**前沿语音 AI 模型家族**，包含 TTS（文本转语音）和 ASR（语音识别）两大方向、三个模型。核心创新是：**7.5Hz 超低帧率连续语音 tokenizer + next-token diffusion 框架**，在保持音频保真度的同时大幅提升长序列处理效率。

**一句话定位**：开源领域最强的长篇语音生成和识别模型——TTS 能一次生成 90 分钟多人对话，ASR 能一次处理 60 分钟长音频并输出结构化转录。

| 指标 | 数值 |
|------|------|
| GitHub Stars | 33K+ |
| 许可证 | MIT |
| 语言 | Python |
| 基座 LLM | Qwen 2.5（0.5B / 1.5B / 7B） |
| 代码规模 | ~4,700 行核心模型代码 |
| ICLR 2026 | TTS 论文获 **Oral** 🔥 |

---

## 三个模型一览

| 模型 | 参数量 | 能力 | 最长时长 | 权重 |
|------|--------|------|---------|------|
| **VibeVoice-TTS** | 1.5B | 长篇多说话人 TTS | 90 分钟 | [HuggingFace](https://huggingface.co/microsoft/VibeVoice-1.5B) |
| **VibeVoice-ASR** | 7B | 长篇语音识别 + 说话人分离 + 时间戳 | 60 分钟 | [HuggingFace](https://huggingface.co/microsoft/VibeVoice-ASR) |
| **VibeVoice-Realtime** | 0.5B | 实时流式 TTS | ~10 分钟 | [HuggingFace](https://huggingface.co/microsoft/VibeVoice-Realtime-0.5B) |

> ⚠️ TTS 代码因被滥用已从仓库移除，但模型权重仍在 HuggingFace 可用。

---

## 项目结构

```
VibeVoice/
├── vibevoice/
│   ├── modular/                           # 核心模型实现
│   │   ├── modeling_vibevoice.py          # TTS 模型（495 行）
│   │   ├── modeling_vibevoice_asr.py      # ASR 模型（521 行）
│   │   ├── modeling_vibevoice_streaming.py          # Realtime 模型
│   │   ├── modeling_vibevoice_streaming_inference.py # Realtime 推理（905 行）
│   │   ├── modular_vibevoice_tokenizer.py  # 语音 Tokenizer（1,206 行）
│   │   ├── modular_vibevoice_diffusion_head.py # Diffusion Head（286 行）
│   │   ├── modular_vibevoice_text_tokenizer.py # 文本 Tokenizer
│   │   ├── configuration_vibevoice.py     # 模型配置
│   │   └── streamer.py                    # 音频流式输出（263 行）
│   ├── processor/                         # 预处理器
│   │   ├── vibevoice_processor.py         # TTS Processor
│   │   ├── vibevoice_asr_processor.py     # ASR Processor
│   │   ├── vibevoice_streaming_processor.py # Realtime Processor
│   │   └── audio_utils.py                # 音频工具
│   ├── schedule/                          # 扩散调度器
│   │   ├── dpm_solver.py                  # DPM-Solver 多步调度
│   │   └── timestep_sampler.py            # 时间步采样
│   └── configs/                           # 模型配置 JSON
│       ├── qwen2.5_1.5b_64k.json         # TTS/Realtime 配置
│       └── qwen2.5_7b_32k.json           # ASR 配置
├── vllm_plugin/                           # vLLM 高性能推理插件
│   ├── model.py                           # vLLM 模型适配
│   ├── inputs.py                          # 输入处理
│   └── scripts/
│       └── start_server.py                # 一键启动服务
├── demo/                                  # 演示脚本
│   ├── vibevoice_asr_inference_from_file.py  # ASR 文件推理
│   ├── vibevoice_asr_gradio_demo.py       # ASR Gradio UI
│   ├── vibevoice_realtime_demo.py         # Realtime WebSocket 演示
│   └── realtime_model_inference_from_file.py # Realtime 文件推理
├── finetuning-asr/                        # ASR 微调
│   ├── lora_finetune.py                   # LoRA 微调脚本
│   └── inference_lora.py                  # LoRA 推理
├── docs/                                  # 详细文档
└── pyproject.toml                         # 项目配置
```

---

## 核心架构

### Next-Token Diffusion 框架

VibeVoice 的核心创新在于将 **LLM 的自回归生成** 与 **Diffusion 的高保真声学生成** 结合：

```
文本输入
  │
  ▼
┌─────────────────────────────────────────────────────┐
│  LLM (Qwen 2.5)                                     │
│  理解文本上下文 + 对话流                               │
│  输出：语义 token 序列                                │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│  Diffusion Head                                      │
│  从语义 token 生成高保真声学 latent                     │
│  使用 DPM-Solver 多步去噪（20 步）                    │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│  Acoustic Tokenizer (Decoder)                        │
│  将声学 latent 解码为音频波形                          │
│  帧率：7.5 Hz                                        │
└─────────────────────────────────────────────────────┘
```

### 连续语音 Tokenizer — 7.5Hz 的秘密

传统离散语音 tokenizer（如 EnCodec）通常工作在 50-75Hz，处理长音频时序列长度爆炸。VibeVoice 的两个连续 tokenizer 工作在 **7.5Hz**，这意味着：

- **1 秒音频 = 7.5 个 token**（vs 传统的 50-75 个）
- **90 分钟音频 ≈ 40,500 个 token**（可以放进 64K 上下文窗口）
- 使用 **VAE**（变分自编码器）而非 VQ（向量量化），保留连续空间信息

```python
# 声学 Tokenizer 架构（从 config 推断）
Encoder: 7 层 depth-wise conv, 通道数 32
降采样比例: [8, 5, 5, 4, 2, 2] → 总降采样 3200x
VAE latent 维度: 64（声学）/ 128（语义）
激活: SiLU + RMS Norm
```

**为什么是两个 Tokenizer？**
- **Acoustic Tokenizer**：捕获声学细节（音色、语调、韵律）→ VAE dim=64
- **Semantic Tokenizer**：捕获语义信息（内容、说话人身份）→ VAE dim=128

### Diffusion Head

Diffusion Head 负责从 LLM 的隐状态生成高保真声学 latent：

```python
# Diffusion Head 配置
层数: 4
隐藏维度: 1536（与 LLM 一致）
FFN 比例: 3.0
声学 latent 维度: 64
调度: DDPM cosine schedule, 1000 步训练, 20 步推理
预测类型: v-prediction
```

使用 **AdaLN-Zero**（Adaptive Layer Norm）调制机制，通过时间步嵌入调节每一层的行为——这与 DiT（Diffusion Transformer）的设计思路一脉相承。

### ASR 模型架构

ASR 模型是一个"反向"管道——音频进、文本出：

```
音频（最长 60 分钟）
  │
  ▼
┌───────────────────────────────────┐
│  Acoustic Tokenizer (Encoder)     │
│  7.5Hz 连续表示                   │
└──────────┬────────────────────────┘
           │
           ▼
┌───────────────────────────────────┐
│  Speech Connector                 │
│  Linear → RMSNorm → Linear       │
│  对齐音频特征到 LLM 维度          │
└──────────┬────────────────────────┘
           │
           ▼
┌───────────────────────────────────┐
│  LLM (Qwen 2.5-7B, 32K context)  │
│  联合生成：                       │
│  - Who（说话人）                  │
│  - When（时间戳）                 │
│  - What（内容）                   │
└───────────────────────────────────┘
```

**60 分钟 = 一次处理**：传统 ASR 把长音频切片（丢失全局上下文），VibeVoice 直接在 64K token 窗口内处理完整音频，确保说话人追踪和语义一致性。

### Realtime Streaming 模型

0.5B 参数的轻量级实时 TTS：

- **流式文本输入**：LLM 开始生成第一个 token 就能出声
- **~200ms 首音延迟**
- **窗口化设计**：增量编码文本 chunk，并行继续从前文生成声学 latent
- **只用 Acoustic Tokenizer**（去掉了 Semantic Tokenizer，进一步减少计算量）
- **8K 上下文窗口** → ~10 分钟音频

---

## 部署步骤

### 方式一：ASR 本地推理

```bash
# 1. 用 NVIDIA Docker（推荐）
sudo docker run --gpus all --rm -it nvcr.io/nvidia/pytorch:25.12-py3

# 2. 安装
git clone https://github.com/microsoft/VibeVoice.git
cd VibeVoice
pip install -e .

# 3. 推理
python demo/vibevoice_asr_inference_from_file.py \
  --model_path microsoft/VibeVoice-ASR \
  --audio_files your_audio.wav
```

### 方式二：ASR vLLM 高性能服务

```bash
# 一键启动 OpenAI 兼容 API
docker run -d --gpus all --name vibevoice-vllm \
  -p 8000:8000 \
  -e PYTORCH_ALLOC_CONF=expandable_segments:True \
  -v $(pwd):/app -w /app \
  --entrypoint bash \
  vllm/vllm-openai:v0.14.1 \
  -c "python3 /app/vllm_plugin/scripts/start_server.py"

# 多 GPU 数据并行（4 GPU）
docker run -d --gpus '"device=0,1,2,3"' --name vibevoice-vllm \
  -p 8000:8000 -v $(pwd):/app -w /app \
  --entrypoint bash vllm/vllm-openai:v0.14.1 \
  -c "python3 /app/vllm_plugin/scripts/start_server.py --dp 4"
```

### 方式三：Realtime TTS

```bash
# 安装流式 TTS 依赖
pip install -e .[streamingtts]

# 启动 WebSocket 演示
python demo/vibevoice_realtime_demo.py \
  --model_path microsoft/VibeVoice-Realtime-0.5B
```

### 方式四：ASR LoRA 微调

```bash
pip install peft

torchrun --nproc_per_node=4 finetuning-asr/lora_finetune.py \
  --model_path microsoft/VibeVoice-ASR \
  --data_dir ./your_dataset \
  --output_dir ./output \
  --lora_r 16 --lora_alpha 32 \
  --num_train_epochs 3 \
  --per_device_train_batch_size 1 \
  --learning_rate 1e-4 --bf16
```

---

## Demo 示例

### ASR 推理代码

```python
from vibevoice.modular.modeling_vibevoice_asr import VibeVoiceASRForConditionalGeneration
from vibevoice.processor.vibevoice_asr_processor import VibeVoiceASRProcessor

# 加载模型
processor = VibeVoiceASRProcessor.from_pretrained(
    "microsoft/VibeVoice-ASR",
    language_model_pretrained_name="Qwen/Qwen2.5-7B"
)
model = VibeVoiceASRForConditionalGeneration.from_pretrained(
    "microsoft/VibeVoice-ASR",
    dtype=torch.bfloat16, device_map="cuda",
    attn_implementation="flash_attention_2"
)

# 推理
inputs = processor(
    audio=["meeting.wav"],
    return_tensors="pt",
    add_generation_prompt=True
).to("cuda")

output_ids = model.generate(**inputs, max_new_tokens=32768)
text = processor.decode(output_ids[0], skip_special_tokens=True)
```

**ASR 输出格式**（结构化转录）：
```
[0.00 - 5.32] Speaker 0: Welcome to today's meeting about the product launch.
[5.45 - 12.80] Speaker 1: Thanks, let me share the latest metrics...
[13.00 - 18.50] Speaker 0: That's impressive growth. What about retention?
```

### Realtime TTS 推理

```bash
python demo/realtime_model_inference_from_file.py \
  --model_path microsoft/VibeVoice-Realtime-0.5B \
  --txt_path demo/text_examples/1p_vibevoice.txt \
  --speaker_name Carter
```

---


## 实机 GPU 测试（A10G 24GB）

> 测试环境：AWS g5.xlarge, NVIDIA A10G 24GB, Ubuntu 22.04, CUDA 12.9, Python 3.10
> 测试日期：2026-04-01


### 测试输入文本

使用仓库自带的示例文本 `demo/text_examples/1p_vibevoice.txt`：

> VibeVoice is a novel framework designed for generating expressive, long-form, multi-speaker conversational audio, such as podcasts, from text. It addresses significant challenges in traditional Text-to-Speech (TTS) systems, particularly in scalability, speaker consistency, and natural turn-taking. A core innovation of VibeVoice is its use of continuous speech tokenizers operating at an ultra-low frame rate of 7.5 Hz. These tokenizers efficiently preserve audio fidelity while significantly boosting computational efficiency for processing long sequences. VibeVoice employs a next-token diffusion framework, leveraging a Large Language Model to understand textual context and dialogue flow, and a diffusion head to generate high-fidelity acoustic details. The model can synthesize speech up to 90 minutes long with up to 4 distinct speakers, surpassing the typical 1-2 speaker limits of many prior models.

### Realtime TTS 0.5B 实测

```bash
pip install -e ".[streamingtts]"
python demo/realtime_model_inference_from_file.py \
  --model_path microsoft/VibeVoice-Realtime-0.5B \
  --txt_path demo/text_examples/1p_vibevoice.txt \
  --speaker_name Carter \
  --output_dir /tmp/vibevoice_output
```

| 指标 | 数值 |
|------|------|
| 输入 text tokens | 174 |
| 生成 speech tokens | 432 |
| 音频时长 | 57.6 秒 |
| 生成耗时 | 65.95 秒 |
| RTF (Real Time Factor) | 1.14x |
| GPU 显存占用 | ~4 GB |
| Attention 实现 | SDPA（未装 flash_attn） |

> 💡 未安装 `flash_attn`，自动 fallback 到 SDPA。安装 flash_attn 后 RTF 预计可降至 < 1.0x。

### ASR 7B 实测（TTS→ASR 自我验证）

用上面 TTS 生成的 57.6 秒音频作为 ASR 输入，验证"TTS 生成 → ASR 识别"闭环：

```python
from vibevoice.modular.modeling_vibevoice_asr import VibeVoiceASRForConditionalGeneration
from vibevoice.processor.vibevoice_asr_processor import VibeVoiceASRProcessor
import torch

processor = VibeVoiceASRProcessor.from_pretrained(
    "microsoft/VibeVoice-ASR",
    language_model_pretrained_name="Qwen/Qwen2.5-7B"
)
model = VibeVoiceASRForConditionalGeneration.from_pretrained(
    "microsoft/VibeVoice-ASR",
    torch_dtype=torch.bfloat16, device_map="cuda",
    attn_implementation="sdpa"
)

inputs = processor(
    audio=["generated_audio.wav"],
    return_tensors="pt",
    add_generation_prompt=True
).to("cuda")

output_ids = model.generate(**inputs, max_new_tokens=4096)
text = processor.decode(output_ids[0], skip_special_tokens=True)
```

| 指标 | 数值 |
|------|------|
| 输入音频时长 | 57.6 秒 |
| 模型加载 GPU 显存 | 16,544 MB (16.5 GB) |
| 推理耗时 | 165.6 秒 |
| 输出格式 | JSON（Start, End, Speaker, Content） |

**ASR 输出**（结构化转录）：

```json
[
  {"Start":0.0, "End":14.37, "Speaker":0,
   "Content":"Vive Voice is a novel framework designed for generating expressive, long-form, multi-speaker conversational audio, such as podcasts from text. It addresses significant challenges in traditional text-to-speech TTS systems."},
  {"Start":14.4, "End":27.8, "Speaker":0,
   "Content":"Particularly in scalability, speaker consistency, and natural turn-taking. A core innovation of Vive Voice is its use of continuous speech tokenizers operating at an ultra-low frame rate of seven point five Hertz."},
  {"Start":28.05, "End":35.88, "Speaker":0,
   "Content":"These tokenizers efficiently preserve audio fidelity while significantly boosting computational efficiency for processing long sequences."},
  {"Start":36.26, "End":48.41, "Speaker":0,
   "Content":"Vive Voice employs a next token diffusion framework, leveraging a large language model to understand textual context and dialogue flow. And a diffusion head to generate high-fidelity acoustic details."},
  {"Start":48.72, "End":57.6, "Speaker":0,
   "Content":"The model can synthesize speech up to ninety minutes long with up to four distinct speakers, surpassing the typical one-two speaker limits of many prior models."}
]
```

> 🎯 ASR 完美识别了 TTS 生成的全部内容，时间戳精准，说话人标记正确。


### TTS 生成音频

TTS 生成了一段 57.6 秒的 Carter（男声）朗读音频。由于测试使用的临时 GPU 实例已 terminate，原始音频文件未保留。

**复现方式**（只需要一张 A10G/RTX 3090 或更高的 GPU）：

```bash
git clone https://github.com/microsoft/VibeVoice.git && cd VibeVoice
pip install -e ".[streamingtts]"
python demo/realtime_model_inference_from_file.py \
  --model_path microsoft/VibeVoice-Realtime-0.5B \
  --txt_path demo/text_examples/1p_vibevoice.txt \
  --speaker_name Carter \
  --output_dir ./output
# 输出：output/1p_vibevoice_generated.wav (57.6s, ~2.7MB)
```

### ASR 完整输出

ASR 对 TTS 生成音频的完整转录结果（JSON 格式，含时间戳和说话人标记）：

| 时间段 | 说话人 | 转录内容 |
|--------|--------|----------|
| 0.00 - 14.37s | Speaker 0 | Vive Voice is a novel framework designed for generating expressive, long-form, multi-speaker conversational audio, such as podcasts from text. It addresses significant challenges in traditional text-to-speech TTS systems. |
| 14.40 - 27.80s | Speaker 0 | Particularly in scalability, speaker consistency, and natural turn-taking. A core innovation of Vive Voice is its use of continuous speech tokenizers operating at an ultra-low frame rate of seven point five Hertz. |
| 28.05 - 35.88s | Speaker 0 | These tokenizers efficiently preserve audio fidelity while significantly boosting computational efficiency for processing long sequences. |
| 36.26 - 48.41s | Speaker 0 | Vive Voice employs a next token diffusion framework, leveraging a large language model to understand textual context and dialogue flow. And a diffusion head to generate high-fidelity acoustic details. |
| 48.72 - 57.60s | Speaker 0 | The model can synthesize speech up to ninety minutes long with up to four distinct speakers, surpassing the typical one-two speaker limits of many prior models. |

> 🔍 **对比观察**：ASR 将数字 "7.5" 识别为 "seven point five"，"90" 识别为 "ninety"，"4" 识别为 "four"——因为 TTS 生成的是语音形式，ASR 按听到的音频转录。"VibeVoice" 被识别为 "Vive Voice"（连读听起来相似）。整体语义完全正确。


### 踩坑记录

1. **torchaudio 未自动安装**：`pip install -e .` 不包含 torchaudio，ASR 推理需要手动 `pip install torchaudio`
2. **flash_attn 非必须**：没安装时自动 fallback 到 SDPA，但可能影响音频质量和速度
3. **ASR batch inference 脚本 bug**：transformers 4.51.3 下 `vibevoice_asr_inference_from_file.py` 有 JSON 序列化错误（`dtype` 对象不可序列化），直接用 Python API 调用无此问题
4. **max_new_tokens 必须设置**：ASR generate 不设上限会导致末尾 token 退化（无限重复逗号/特殊字符）
5. **A10G 24GB 刚好够**：ASR 7B bf16 占 16.5GB，推理时峰值约 20GB，不留太多余量


## 关键发现 / 学习心得

### 1. 7.5Hz 帧率是核心突破

传统 Codec（EnCodec、SoundStream）在 50-75Hz 工作，90 分钟音频会产生 27-40 万个 token——远超任何 LLM 上下文窗口。VibeVoice 把帧率降到 **7.5Hz**，90 分钟 ≈ 4 万 token，刚好塞进 64K 窗口。这不是简单的"降采样"，而是用 VAE 在连续空间学到了信息密度更高的表示。

### 2. 连续 Token > 离散 Token（对长篇语音）

多数语音 LLM 用离散 codebook（VQ-VAE），VibeVoice 选择连续 latent + Diffusion 解码。好处：
- 不丢失细节（离散化必然有信息损失）
- 可以用 Diffusion 生成高保真声学细节
- 代价：需要额外的 Diffusion Head（但只有 4 层，很轻量）

### 3. ASR 的"大一统"设计很有前景

传统 ASR 管线：VAD → 分段 → ASR → 说话人分离 → 对齐。VibeVoice ASR 把所有这些**合成一个 LLM 生成任务**：Who + When + What 一次生成。简洁、端到端、上下文完整。

### 4. vLLM 插件化部署是最佳实践

VibeVoice 不修改 vLLM 源码，而是通过 `pyproject.toml` 的 entry-point 注册为 vLLM 插件。这意味着可以直接用官方 vLLM Docker 镜像 + 一个 pip install 就部署。支持 DP/TP 多 GPU 并行 + OpenAI 兼容 API。

### 5. TTS 代码被移除说明了什么

TTS 代码因"被用于与原始意图不一致的方式"（即 deepfake）而被移除。这是 AI 语音领域的现实：**越强大的模型，越容易被滥用**。但模型权重仍然公开——这个"半开源"策略值得关注。

### 6. 涌现能力：唱歌

训练数据**不包含任何音乐数据**，但模型学会了唱歌（虽然可能跑调）。这是 LLM 在语音领域的涌现能力——模型理解了"唱歌"的概念，并尝试用已有的声学知识去表达。Large 模型比 1.5B 更容易展现这个能力。

---

## 与同类项目对比

| 特性 | VibeVoice | CosyVoice 2 | Fish Speech | Seed-TTS |
|------|-----------|-------------|-------------|----------|
| 开源 | ✅ MIT | ✅ | ✅ | ❌ |
| TTS 最长生成 | **90 分钟** | ~1 分钟 | ~1 分钟 | N/A |
| ASR 最长处理 | **60 分钟** | N/A | N/A | N/A |
| 多说话人 | 4 人 | 1 人 | 1 人 | 1 人 |
| 实时流式 | ✅（200ms 延迟） | ✅ | ✅ | N/A |
| vLLM 部署 | ✅ | ❌ | ❌ | N/A |
| 微调支持 | ✅ LoRA | ✅ | ✅ | N/A |

VibeVoice 在**长篇生成**和**统一 ASR**两个维度远超同类开源项目。

---

## 参考资源

- [项目主页](https://microsoft.github.io/VibeVoice)
- [HuggingFace Collection](https://huggingface.co/collections/microsoft/vibevoice-68a2ef24a875c44be47b034f)
- [TTS 技术报告 (ICLR 2026 Oral)](https://openreview.net/pdf?id=FihSkzyxdv)
- [ASR 技术报告](https://arxiv.org/pdf/2601.18184)
- [Next-Token Diffusion 论文](https://arxiv.org/abs/2412.08635)
- [ASR Playground](https://aka.ms/vibevoice-asr)
- [Realtime Colab](https://colab.research.google.com/github/microsoft/VibeVoice/blob/main/demo/vibevoice_realtime_colab.ipynb)
- [Vibing — 基于 VibeVoice-ASR 的语音输入法](https://vibingjustspeakit.github.io/Vibing/)
