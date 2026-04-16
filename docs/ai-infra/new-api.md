# New API Getting Started

> 整理日期：2026-04-16
> 仓库地址：https://github.com/QuantumNous/new-api

## 项目简介

**New API** 是一个**下一代 LLM 网关和 AI 资产管理系统**，基于 [One API](https://github.com/songquanpeng/one-api) 演进而来，由 QuantumNous（原 Calcium-Ion）维护。

**一句话定位**：统一的 AI 模型聚合分发网关——接入 40+ 家 LLM 供应商，对外暴露 OpenAI/Claude/Gemini 兼容接口，附带完整的计费、权限和运营管理。

**项目数据**（截至 2026-04-16）：
- ⭐ 27,000 Stars / 5,551 Forks
- 📦 Go 后端 + React 前端，Docker 一键部署
- 📅 2023-11 创建，v0.12.10（2026-04-15），几乎每天发版
- 📝 AGPLv3 License
- 🏢 合作方：Cherry Studio、北大数据分析中心、阿里云、UCloud、IO.NET

## 核心架构

```
┌─────────────────────────────────────────────────────────┐
│                    客户端请求                              │
│   (OpenAI SDK / Claude SDK / Gemini SDK / 任意 HTTP)     │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────┐
│                   Gin HTTP Router                        │
│  relay-router.go: /v1/chat/completions, /v1/images, ... │
│  api-router.go:   /api/user, /api/channel, ...          │
└──────────────────────┬───────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────┐
│                  Middleware 层                            │
│  Auth → RateLimit → Billing(预扣费) → BodyStorage       │
└──────────────────────┬───────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────┐
│               Relay Handler 层                           │
│  chat_completions / claude / gemini / responses /        │
│  image / audio / embedding / rerank / websocket          │
│  ┌────────────────────────────────────────────────┐     │
│  │        Format Conversion Engine                 │     │
│  │  OpenAI ⇄ Claude Messages                      │     │
│  │  OpenAI → Gemini / Gemini → OpenAI             │     │
│  │  OpenAI ⇄ Responses (WIP)                      │     │
│  │  Thinking → Content 转换                        │     │
│  └────────────────────────────────────────────────┘     │
└──────────────────────┬───────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────┐
│            Channel Adaptor 层 (核心抽象)                  │
│                                                          │
│  interface Adaptor {                                     │
│    Init / GetRequestURL / SetupRequestHeader             │
│    ConvertOpenAIRequest / ConvertClaudeRequest /         │
│    ConvertGeminiRequest / ConvertImageRequest / ...      │
│    DoRequest / DoResponse                                │
│  }                                                       │
│                                                          │
│  40+ 实现：OpenAI / Claude / Gemini / AWS Bedrock /      │
│  DeepSeek / Ali(通义) / Baidu(文心) / Zhipu(智谱) /      │
│  Tencent(混元) / Moonshot / xAI / Coze / Ollama /       │
│  Cloudflare / SiliconFlow / Vertex AI / Mistral /       │
│  Cohere / Jina / Replicate / MiniMax / ...              │
└──────────────────────┬───────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────┐
│              上游 LLM Provider API                       │
└──────────────────────────────────────────────────────────┘
```

## 项目结构

```
new-api/
├── main.go              # 入口，embed 前端 dist，启动 Gin
├── router/              # 路由定义
│   ├── api-router.go    # 管理 API（用户/渠道/日志/设置）
│   ├── relay-router.go  # 转发 API（/v1/chat/completions 等）
│   └── web-router.go    # 前端静态文件
├── relay/               # ⭐ 核心：请求转发引擎
│   ├── channel/         # Adaptor 接口 + 40+ 供应商实现
│   │   ├── adapter.go   # Adaptor + TaskAdaptor 接口定义
│   │   ├── openai/      # OpenAI 适配器
│   │   ├── claude/      # Claude Messages 适配器
│   │   ├── gemini/      # Google Gemini 适配器
│   │   ├── aws/         # AWS Bedrock 适配器
│   │   ├── deepseek/    # DeepSeek 适配器
│   │   └── ...          # 30+ 其他供应商
│   ├── common/          # RelayInfo、通用工具
│   ├── helper/          # 计费、重试、流处理
│   └── reasonmap/       # Reasoning effort 映射
├── controller/          # API 业务逻辑
├── model/               # GORM 数据模型
├── middleware/           # Auth、RateLimit、Billing
├── constant/            # 渠道类型、API 类型常量
├── dto/                 # 请求/响应 DTO
├── service/             # 后台服务（签到、缓存计费等）
├── oauth/               # OAuth 集成（GitHub/Discord/OIDC/Telegram）
├── web/                 # React 前端
│   └── src/pages/       # Dashboard/Channel/Pricing/Playground/...
├── i18n/                # 多语言（中/英/法/日/繁中）
└── docker-compose.yml   # 一键部署
```

## 核心工作流程

### 1. 请求转发流程（以 Chat Completions 为例）

```
1. 客户端 POST /v1/chat/completions（OpenAI 格式）
2. TokenAuth 中间件：验证 API Key → 查询用户/组/配额
3. RateLimit：用户级模型限速检查
4. Channel Selection：按模型名匹配可用渠道 → 加权随机选择
5. Relay Handler：
   a. 解析请求体为 GeneralOpenAIRequest
   b. 根据目标渠道类型获取对应 Adaptor
   c. Adaptor.ConvertOpenAIRequest() → 转换为供应商格式
   d. 预扣费（基于模型价格 × 预估 token）
   e. Adaptor.DoRequest() → 发送到上游
   f. Adaptor.DoResponse() → 流式/非流式响应处理
6. 结算：实际 token 用量 × 价格，多退少补
7. 失败重试：自动切换备用渠道（可配置次数）
```

### 2. Adaptor 模式（设计精髓）

每个供应商只需实现 `Adaptor` 接口的 10 个方法：

| 方法 | 职责 |
|------|------|
| `Init` | 初始化适配器 |
| `GetRequestURL` | 构建目标 URL |
| `SetupRequestHeader` | 设置认证头 |
| `ConvertOpenAIRequest` | OpenAI → 供应商格式转换 |
| `ConvertClaudeRequest` | Claude → 供应商格式转换 |
| `ConvertGeminiRequest` | Gemini → 供应商格式转换 |
| `DoRequest` | 发送 HTTP 请求 |
| `DoResponse` | 解析响应 + 流式处理 |
| `GetModelList` | 返回支持的模型列表 |
| `GetChannelName` | 返回渠道名称 |

**新增供应商 = 新建一个目录 + 实现 Adaptor 接口**，零改动核心代码。

### 3. 格式转换矩阵

```
         输入格式            →        输出格式
    ┌────────────────┐      ┌────────────────────┐
    │ OpenAI Chat    │ ───→ │ Claude Messages     │
    │ Claude Messages│ ───→ │ OpenAI Chat         │
    │ OpenAI Chat    │ ───→ │ Gemini              │
    │ Gemini         │ ───→ │ OpenAI Chat (部分)  │
    │ OpenAI Chat    │ ⇄   │ OpenAI Responses(WIP)│
    │ Thinking       │ ───→ │ Content (展平)      │
    └────────────────┘      └────────────────────┘
```

## 支持的 40+ LLM 供应商

| 类别 | 供应商 |
|------|--------|
| 国际大厂 | OpenAI, Anthropic(Claude), Google(Gemini/PaLM/Vertex), AWS(Bedrock), xAI, Mistral |
| 中国厂商 | 阿里(通义千问), 百度(文心), 智谱(GLM), 腾讯(混元), 月之暗面(Moonshot), DeepSeek, 豆包(火山引擎), 零一万物, 讯飞 |
| 聚合平台 | OpenRouter, SiliconFlow, Coze, Dify, Cloudflare AI, MokaAI, Submodel |
| 本地/开源 | Ollama, Xinference, Replicate |
| 搜索/嵌入 | Perplexity, Cohere, Jina |
| 多媒体 | Midjourney(Proxy), Suno(音乐), Kling(可灵), Jimeng(即梦), Vidu, Sora, 海螺AI |

## 部署方式

### 最简 Docker Compose

```bash
git clone https://github.com/QuantumNous/new-api.git
cd new-api
docker-compose up -d
# 访问 http://localhost:3000
```

默认栈：PostgreSQL + Redis + New API 应用（单命令全部拉起）。

### 存储选项

| 组件 | 选项 |
|------|------|
| 数据库 | SQLite（默认/单机）/ MySQL ≥ 5.7.8 / PostgreSQL ≥ 9.6 |
| 缓存 | Redis（推荐）/ 内存缓存（单机） |
| 文件 | 挂载 `/data` 目录 |

### 多机部署要点

- **必须设置** `SESSION_SECRET`（登录状态一致性）
- **必须设置** `CRYPTO_SECRET`（Redis 加密密钥共享）

## 运营功能全景

### 计费体系

- 按量计费：input/output token 分别定价
- 缓存计费：支持 OpenAI/Azure/DeepSeek/Claude/Qwen 的缓存 token
- 预扣费 + 结算：请求前预估扣费，完成后按实际 token 多退少补
- Reasoning effort：`o3-mini-high/medium/low`、`gpt-5-high/medium/low` 等后缀自动映射

### 支付集成

- EPay（国内支付）
- Stripe（国际支付）
- Creem、Waffo
- 兑换码充值

### 认证方式

- 用户名密码 + 2FA(TOTP)
- Passkey（WebAuthn）
- OAuth：GitHub / Discord / LinuxDO / Telegram / WeChat / OIDC

### 管理功能

- 数据 Dashboard（可视化统计）
- 渠道管理（增删改查 + 批量测试 + 自动禁用）
- Token 管理（按组分配、模型限制）
- 日志审计（请求日志、错误日志、Midjourney 日志）
- 模型定价管理（倍率设置、分组定价）

## 关键发现 / 学习心得

### 1. 🎯 Adaptor 模式是扩展性的关键

New API 能支持 40+ 供应商的秘密在于**干净的 Adaptor 接口**。每个供应商独立一个包，只需实现 10 个方法，零耦合。这个设计值得在任何多供应商网关项目中借鉴。

### 2. 💰 「AI 资产管理」比「API 网关」定位更高

New API 不只是转发请求——它是一套完整的 **AI 使用成本管控系统**：预扣费→结算→配额→分组→定价→支付。对企业来说，这解决的是"谁用了多少 AI、花了多少钱"的管理痛点。

### 3. 🔄 格式转换是真正的护城河

OpenAI ⇄ Claude ⇄ Gemini 的双向格式转换极其复杂（thinking tokens、tool calling、流式处理的差异），New API 在这上面积累了大量边界情况处理。这也是 27K Stars 的核心原因——用户不想自己处理这些差异。

### 4. 📊 与同类项目对比

| 项目 | Stars | 定位差异 |
|------|:-----:|----------|
| **New API** | 27K | 全功能网关 + 运营管理 + 计费系统 |
| [One API](https://github.com/songquanpeng/one-api) | 20K+ | 原始项目，功能较少 |
| [LiteLLM](https://github.com/BerriAI/litellm) | 20K+ | Python 生态，偏开发者工具 |
| [OpenRouter](https://openrouter.ai) | 商业 | SaaS 服务，不开源 |

### 5. 🔗 与 OpenClaw 的关联

- OpenClaw 用的 model routing（`amazon-bedrock/global.anthropic.claude-opus-4-6-v1`）本质上就是 New API 在做的事
- 如果需要给多个 agent 做成本分账，New API 的 Token 分组 + 按量计费是现成方案
- New API 已支持 Codex channel type（`ChannelTypeCodex = 57`），说明它在跟进 AI coding agent 生态

## 参考资源

- [官方文档](https://docs.newapi.pro/en/docs)
- [DeepWiki 分析](https://deepwiki.com/QuantumNous/new-api)
- [上游项目 One API](https://github.com/songquanpeng/one-api)
- [API Key 查询工具 neko-api-key-tool](https://github.com/Calcium-Ion/neko-api-key-tool)
- [高性能优化版 new-api-horizon](https://github.com/Calcium-Ion/new-api-horizon)
