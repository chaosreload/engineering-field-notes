# kiro-gateway Getting Started

> 整理日期：2026-03-22
> 仓库地址：https://github.com/jwadow/kiro-gateway

## 项目简介

kiro-gateway 是一个**代理网关**，将 Kiro IDE（Amazon Q Developer / AWS CodeWhisperer）的 Claude 模型 API 封装成标准的 OpenAI 兼容接口和 Anthropic 兼容接口。

**解决的问题：** Kiro IDE 免费提供 Claude 模型的使用额度，但这些额度只能在 IDE 内部使用。kiro-gateway 把这个能力"解放"出来，让 Claude Code、Cursor、Cline 等任意工具都能通过它使用 Kiro 的免费 Claude 额度。

**典型使用场景：** 本地跑 `python main.py` → Claude Code 设置 `ANTHROPIC_BASE_URL=http://localhost:8000` → 白嫖 Claude Sonnet 4.5 做编程辅助。

---

## 项目结构

```
kiro-gateway/
├── main.py                 # 入口：FastAPI 应用创建、lifespan、启动逻辑
├── kiro/
│   ├── config.py           # 所有配置：环境变量加载、常量定义
│   ├── auth.py             # 认证管理器：token 获取/刷新
│   ├── cache.py            # 模型信息缓存（TTL 1小时）
│   ├── model_resolver.py   # 模型名称解析（标准化、别名、pass-through）
│   ├── routes_openai.py    # OpenAI 兼容路由 /v1/chat/completions, /v1/models
│   ├── routes_anthropic.py # Anthropic 兼容路由 /v1/messages
│   ├── converters_core.py  # 核心转换器（API格式 → Kiro格式，共用层）
│   ├── converters_openai.py    # OpenAI → Kiro 转换
│   ├── converters_anthropic.py # Anthropic → Kiro 转换
│   ├── streaming_core.py   # 流式响应核心处理
│   ├── streaming_openai.py # Kiro 流 → OpenAI SSE 转换
│   ├── streaming_anthropic.py  # Kiro 流 → Anthropic SSE 转换
│   ├── thinking_parser.py  # Extended Thinking 标签解析
│   ├── http_client.py      # 共享 httpx client 封装（连接池）
│   ├── truncation_recovery.py  # 截断恢复：注入合成消息
│   ├── truncation_state.py     # 截断状态追踪
│   ├── tokenizer.py        # Token 计数（基于 tiktoken）
│   ├── network_errors.py   # 网络错误处理
│   ├── kiro_errors.py      # Kiro API 特定错误处理
│   ├── debug_logger.py     # 调试日志写文件
│   ├── debug_middleware.py # 请求/响应调试中间件
│   ├── exceptions.py       # 全局异常处理
│   └── utils.py            # 工具函数（机器指纹等）
├── tests/
│   ├── unit/               # 单元测试（覆盖所有核心模块）
│   └── integration/        # 集成测试
├── docs/                   # 多语言 README
├── Dockerfile
└── docker-compose.yml
```

---

## 核心架构

```
┌─────────────────────────────────────────────────────────┐
│  客户端 (Claude Code / Cursor / Cline / OpenAI SDK)      │
│  POST http://localhost:8000/v1/chat/completions          │
│  POST http://localhost:8000/v1/messages                  │
└────────────────────┬────────────────────────────────────┘
                     │ PROXY_API_KEY 认证
                     ▼
┌─────────────────────────────────────────────────────────┐
│  kiro-gateway (FastAPI)                                  │
│                                                          │
│  ┌─────────────┐  ┌─────────────────────────────────┐   │
│  │  OpenAI     │  │  Anthropic                      │   │
│  │  Router     │  │  Router                         │   │
│  └──────┬──────┘  └──────────────┬──────────────────┘   │
│         │                        │                       │
│         └──────────┬─────────────┘                       │
│                    ▼                                     │
│         ┌──────────────────────┐                        │
│         │  Converter (Core)    │  格式转换               │
│         │  - 消息格式统一化    │  OpenAI/Anthropic       │
│         │  - Tool Call 处理    │  → Kiro 格式            │
│         │  - Image 处理        │                        │
│         │  - System Prompt     │                        │
│         └──────────┬───────────┘                        │
│                    ▼                                     │
│         ┌──────────────────────┐                        │
│         │  Model Resolver      │  模型名称解析           │
│         │  - 标准化 (- → .)    │  claude-sonnet-4-5     │
│         │  - 别名映射          │  → claude-sonnet-4.5   │
│         │  - Cache 查询        │                        │
│         └──────────┬───────────┘                        │
│                    ▼                                     │
│         ┌──────────────────────┐                        │
│         │  Auth Manager        │  Token 管理            │
│         │  - 自动刷新          │  到期前 10 分钟刷新     │
│         │  - SQLite/JSON/ENV   │                        │
│         └──────────┬───────────┘                        │
└────────────────────┼────────────────────────────────────┘
                     │ Bearer Token (Access Token)
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Kiro API (Amazon Q Developer)                          │
│  https://q.us-east-1.amazonaws.com/generateAssistant...  │
│  https://q.us-east-1.amazonaws.com/ListAvailableModels   │
└─────────────────────────────────────────────────────────┘
```

---

## 核心工作流程

### 1. 启动流程

```
main.py 启动
  → validate_configuration()  # 检查凭证配置
  → FastAPI lifespan 初始化:
      → 创建共享 httpx.AsyncClient（连接池：max 100 连接）
      → 创建 KiroAuthManager（加载凭证）
      → 创建 ModelInfoCache
      → 调用 Kiro ListAvailableModels API，填充缓存
        （失败时 fallback 到内置模型列表）
      → 添加 HIDDEN_MODELS 到缓存
      → 创建 ModelResolver
  → 开始接受请求
```

### 2. 请求处理流程（以 OpenAI /v1/chat/completions 为例）

```
收到请求
  → DebugLoggerMiddleware（记录请求）
  → API Key 验证（比对 PROXY_API_KEY）
  → Pydantic 模型验证
  → ModelResolver.resolve(model_name)
      → 别名映射（auto-kiro → auto）
      → 名称标准化（claude-sonnet-4-5 → claude-sonnet-4.5）
      → Cache 查询（验证模型是否存在）
  → Converter（OpenAI → Kiro 格式）
      → 提取 messages（合并相邻同角色消息）
      → 处理 tool_calls 和 tool_results
      → 处理图片（base64）
      → Fake Reasoning 注入（添加 <thinking_mode> 标签）
      → 构建 Kiro API payload
  → AuthManager.get_access_token()
      → 未过期：直接返回
      → 即将过期（<10min）：自动 refresh
  → HTTP 请求到 Kiro API
      → 失败时最多重试 3 次（403 强制刷新 token）
  → 流式响应处理（SSE）：
      → Kiro 原始流 → StreamParser → OpenAI SSE 格式
      → Thinking 标签检测和提取（→ reasoning_content）
      → 截断检测（Truncation Recovery：注入合成消息）
  → 返回客户端
```

### 3. Token 管理

```
KiroAuthManager 支持 3 种认证方式（优先级由高到低）：
  1. SQLite DB（kiro-cli 数据库）：~/.local/share/kiro-cli/data.sqlite3
  2. JSON 凭证文件：~/.aws/sso/cache/kiro-auth-token.json
  3. 环境变量：REFRESH_TOKEN

两种认证类型：
  - KIRO_DESKTOP：Kiro IDE 个人账号
    → POST prod.{region}.auth.desktop.kiro.dev/refreshToken
    → JSON body: {"refreshToken": "..."}
  
  - AWS_SSO_OIDC：kiro-cli 企业/Builder ID 账号（有 clientId + clientSecret）
    → POST oidc.{region}.amazonaws.com/token
    → JSON body: {grantType, clientId, clientSecret, refreshToken}

自动写回：刷新后的 token 写回 SQLite/JSON 文件
```

---

## 部署步骤

### 方法一：Native Python（推荐调试用）

```bash
# 1. 克隆
git clone https://github.com/jwadow/kiro-gateway.git
cd kiro-gateway

# 2. 安装依赖
pip install -r requirements.txt

# 3. 配置凭证
cp .env.example .env
# 编辑 .env：

# 方式A：有 Kiro IDE（最简单）
KIRO_CREDS_FILE=~/.aws/sso/cache/kiro-auth-token.json
PROXY_API_KEY=your-secret-password

# 方式B：有 kiro-cli
KIRO_CLI_DB_FILE=~/.local/share/kiro-cli/data.sqlite3
PROXY_API_KEY=your-secret-password

# 方式C：手动 refresh token
REFRESH_TOKEN=your_refresh_token
PROXY_API_KEY=your-secret-password

# 4. 启动
python main.py
# 或指定端口：
python main.py --port 9000
```

### 方法二：Docker

```bash
# 使用 credentials 文件
docker run -d \
  -p 8000:8000 \
  -v ~/.aws/sso/cache:/home/kiro/.aws/sso/cache:ro \
  -e KIRO_CREDS_FILE=/home/kiro/.aws/sso/cache/kiro-auth-token.json \
  -e PROXY_API_KEY="your-secret" \
  --name kiro-gateway \
  ghcr.io/jwadow/kiro-gateway:latest
```

### 配合 Claude Code 使用

```bash
# 方法一：环境变量
export ANTHROPIC_BASE_URL=http://localhost:8000
export ANTHROPIC_API_KEY=your-secret-password
claude  # 启动 Claude Code

# 方法二：claude code 配置文件
# ~/.claude/settings.json 或等效位置
```

### 验证运行

```bash
# 健康检查
curl http://localhost:8000/health

# 模型列表
curl http://localhost:8000/v1/models \
  -H "Authorization: Bearer your-secret"

# 测试推理（OpenAI 格式）
curl http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer your-secret" \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-sonnet-4.5", "messages": [{"role": "user", "content": "Hi"}], "stream": true}'
```

---

## Demo 示例

Demo 文件：`/home/ubuntu/chaosreload/study/demo/kiro-gateway/demo.py`

运行结果（无需真实凭证）：

```
应用: Kiro Gateway v2.3
默认监听: 0.0.0.0:8000
Fake Reasoning: 开启 (max_tokens=4000)

内置 fallback 模型 (5 个):
  - auto, claude-sonnet-4, claude-haiku-4.5, claude-sonnet-4.5, claude-opus-4.5

模型名称标准化测试:
  'claude-sonnet-4-5'   → claude-sonnet-4.5  (连字符自动转点)
  'claude-3.7-sonnet'   → claude-3.7-sonnet  (hidden 模型)
  'auto-kiro'           → auto               (别名解析)
  'CLAUDE_SONNET_4_5_V1_0' → passthrough     (未知格式直传)

/v1/models 返回 6 个模型（去掉 auto，加入 auto-kiro 别名）
```

---

## 关键发现 / 学习心得

### 1. 设计亮点：Fake Reasoning（独家功能）

不是 native extended thinking，而是往 prompt 里注入 `<thinking_mode>enabled</thinking_mode>` 标签。模型会回复 `<thinking>...</thinking>` 块，gateway 解析后转换成 OpenAI 的 `reasoning_content` 字段。这个 trick 在其他 Kiro proxy 里没有，是 kiro-gateway 的独特竞争力。

### 2. 截断恢复机制（Truncation Recovery）

Kiro API 对长上下文有截断限制。gateway 检测到截断后会自动注入"合成消息"，告知模型发生了截断，让模型能优雅降级而不是返回垃圾输出。

### 3. 模型名称标准化

Kiro 官方用 `.` 分隔（`claude-sonnet-4.5`），但很多工具用 `-` 分隔（`claude-sonnet-4-5`）。gateway 自动标准化，对用户完全透明。

### 4. 连接池优化

startup 时创建单一共享 `httpx.AsyncClient`（max 100 连接，20 keep-alive），所有请求复用，解决了高并发下内存激增的 issue #24。

### 5. 凭证写回持久化

每次 token 刷新后自动写回 SQLite/JSON 文件，这样即使 gateway 重启，token 也不会失效。

### 6. 与 KiroaaS 的关系

KiroaaS（桌面 GUI 版）是在 kiro-gateway 的 Python backend 上套了一层 Tauri（Rust + React）桌面 App，核心逻辑完全依赖 kiro-gateway。

---

## 参考资源

- GitHub: https://github.com/jwadow/kiro-gateway
- KiroaaS（桌面版）: https://github.com/hnewcity/KiroaaS
- Kiro IDE: https://kiro.dev
- kiro-cli: https://kiro.dev/cli
- API Docs: http://localhost:8000/docs（服务启动后）
