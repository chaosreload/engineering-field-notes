# kiro2api Getting Started

> 整理日期：2026-04-01
> 仓库地址：https://github.com/caidaoli/kiro2api

## 项目简介

kiro2api 是一个用 Go 编写的高性能 AI API 代理服务器。它的核心功能是将标准的 **Anthropic Claude API** 和 **OpenAI ChatCompletion API** 请求，转换为 **AWS CodeWhisperer**（即 Kiro IDE 内置的 Claude 后端）的私有协议，从而让你用自己的 Kiro/CodeWhisperer 账号来驱动 Claude Code、OpenAI 兼容客户端等工具。

**一句话总结**：把 Kiro 的 Claude 额度变成一个通用的 Claude API 服务器。

### 适用场景

- 你有 Kiro IDE 的 Claude 使用额度，想在 Claude Code CLI 或其他工具中复用
- 需要一个多账号池 + 自动轮换的 Claude API 代理
- 想用 OpenAI 格式的客户端（如 ChatGPT UI 克隆）对接 Claude

## 项目结构

```
kiro2api/
├── main.go                  # 入口：加载 .env → 创建 AuthService → 启动 Server
├── auth/                    # 认证层
│   ├── auth.go              # AuthService 入口
│   ├── config.go            # 多账号 JSON 配置解析（Social / IdC）
│   ├── token_manager.go     # Token 池管理：缓存、顺序选择、故障转移
│   ├── refresh.go           # Token 刷新（Social SSO / IdC OIDC）
│   └── usage_checker.go     # 使用量查询（CREDIT 资源类型）
├── config/                  # 全局配置
│   ├── config.go            # 模型映射表、API URL 常量
│   ├── constants.go         # Token 管理/解析器常量
│   └── tuning.go            # 可调参数
├── converter/               # 协议转换层
│   ├── codewhisperer.go     # Anthropic → CodeWhisperer 请求构建（核心）
│   ├── openai.go            # OpenAI → Anthropic 格式转换
│   ├── content.go           # 多模态内容处理（图片 data URL）
│   └── tools.go             # 工具定义/工具结果转换
├── parser/                  # AWS EventStream 响应解析
│   ├── compliant_event_stream_parser.go  # 二进制 EventStream 解析器
│   ├── compliant_message_processor.go    # 消息处理与事件分发
│   ├── header_parser.go                  # EventStream Header 解析
│   ├── event_stream_types.go             # SSE 事件类型定义
│   ├── message_event_handlers.go         # 各事件类型处理器
│   ├── session_manager.go                # 会话状态管理
│   ├── sonic_streaming_aggregator.go     # 流式 JSON 聚合（bytedance/sonic）
│   ├── tool_lifecycle_manager.go         # 工具调用生命周期（start→delta→stop）
│   └── robust_parser.go                  # 容错解析器
├── server/                  # HTTP 服务层
│   ├── server.go            # 路由注册、Gin 启动
│   ├── handlers.go          # 流式/非流式请求处理、Token 池 API
│   ├── stream_processor.go  # SSE 流式处理核心（事件流转发+token 计算）
│   ├── sse_state_manager.go # SSE 状态机（content_block 开/关跟踪）
│   ├── stop_reason_manager.go # stop_reason 决策（end_turn / tool_use / max_tokens）
│   ├── openai_handlers.go   # OpenAI 格式适配
│   ├── middleware.go         # 认证中间件、CORS、RequestID
│   ├── error_mapper.go      # 上游错误 → Claude API 错误映射
│   └── common.go            # 公共工具函数
├── types/                   # 数据类型定义
│   ├── anthropic.go         # Anthropic API 请求/响应结构
│   ├── codewhisperer.go     # CodeWhisperer 请求/响应结构
│   ├── openai.go            # OpenAI 请求/响应结构
│   ├── model.go             # 模型元数据
│   ├── token.go             # Token 信息结构
│   └── usage_limits.go      # 使用限额结构
├── utils/                   # 工具函数
│   ├── client.go            # 共享 HTTP Client
│   ├── request_analyzer.go  # 请求分析
│   ├── token_estimator.go   # Token 数量估算
│   ├── image.go             # 图片 data URL 处理
│   ├── conversation_id.go   # 稳定会话 ID 生成
│   └── ...                  # JSON、HTTP、UUID 等工具
├── logger/                  # 结构化日志（支持 JSON/text 格式）
├── static/                  # Dashboard 前端（Token 池可视化）
├── Dockerfile               # 多阶段构建
└── docker-compose.yml       # Docker Compose 部署
```

## 核心架构

### 请求处理流程

```
客户端请求（Anthropic/OpenAI 格式）
       │
       ▼
┌─────────────────────────────────┐
│  Gin Router + Auth Middleware   │  认证：Bearer Token / x-api-key
│  PathBasedAuthMiddleware        │  只对 /v1/* 端点认证
└──────────┬──────────────────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
  /v1/messages   /v1/chat/completions
  (Anthropic)    (OpenAI → Anthropic 转换)
     │                    │
     └────────┬───────────┘
              ▼
┌─────────────────────────────────┐
│  Token Manager                  │  从多账号池中选择可用 Token
│  （顺序选择 + 故障转移）          │  自动刷新过期 Token
└──────────┬──────────────────────┘
           ▼
┌─────────────────────────────────┐
│  Converter                      │  Anthropic → CodeWhisperer 格式
│  BuildCodeWhispererRequest()    │  处理：消息历史、system prompt、
│                                 │  工具定义、图片、tool_result
└──────────┬──────────────────────┘
           ▼
┌─────────────────────────────────┐
│  HTTP POST → CodeWhisperer API  │  us-east-1.amazonaws.com
│  generateAssistantResponse      │  返回 AWS EventStream 二进制流
└──────────┬──────────────────────┘
           ▼
┌─────────────────────────────────┐
│  Parser (EventStream → SSE)     │  解析 AWS 二进制 EventStream
│  CompliantEventStreamParser     │  提取 assistantResponseEvent
│  ToolLifecycleManager           │  管理工具调用生命周期
└──────────┬──────────────────────┘
           ▼
┌─────────────────────────────────┐
│  Stream Processor               │  转发 SSE 事件给客户端
│  SSEStateManager                │  跟踪 content_block 状态
│  StopReasonManager              │  决策 stop_reason
│  TokenEstimator                 │  累计 output token 数
└──────────┬──────────────────────┘
           ▼
  Claude API 格式的 SSE 流 → 客户端
```

### 关键设计决策

#### 1. 双协议兼容

项目同时支持 Anthropic 和 OpenAI 两种 API 格式。OpenAI 请求先被转换为 Anthropic 格式，再统一走 CodeWhisperer 后端：

```
OpenAI Request → converter.ConvertOpenAIToAnthropic() → Anthropic Request → CodeWhisperer
```

#### 2. 多账号池 + 顺序选择

Token 管理采用**顺序选择策略**（不是随机或加权）：
- 按配置顺序依次使用账号
- 当前账号额度耗尽后自动切换到下一个
- 支持 Social（AWS SSO）和 IdC（Identity Center）两种认证方式混合使用

#### 3. AWS EventStream 二进制解析

CodeWhisperer 返回的不是标准 SSE 文本流，而是 **AWS EventStream 二进制协议**。项目实现了完整的解析器：
- 消息头解析（`:message-type`、`:event-type`、`:content-type`）
- CRC32 校验
- JSON payload 提取
- 流式聚合（使用 bytedance/sonic 高性能 JSON 库）

#### 4. 工具调用完整支持

实现了完整的工具调用生命周期：
- `content_block_start` (tool_use) → `content_block_delta` (input_json_delta) → `content_block_stop`
- 自动跟踪 tool_use_id，正确设置 `stop_reason: "tool_use"`
- 支持多工具并行调用

#### 5. Token 计数精度修复

针对流式响应中 `input_json_delta` 的 token 估算，项目做了精度修复：
- 问题：每个分段单独 `len(json)/4` 会因整除丢失精度
- 解决：累加所有分段的字节数，在 `content_block_stop` 时一次性向上取整计算

## 模型映射

| 客户端请求模型 | CodeWhisperer 内部模型 ID |
|-------------|---------------------------|
| `claude-sonnet-4-5-20250929` | `CLAUDE_SONNET_4_5_20250929_V1_0` |
| `claude-sonnet-4-20250514` | `CLAUDE_SONNET_4_20250514_V1_0` |
| `claude-3-7-sonnet-20250219` | `CLAUDE_3_7_SONNET_20250219_V1_0` |
| `claude-3-5-haiku-20241022` | `auto` |
| `claude-haiku-4-5-20251001` | `auto` |

## 部署步骤

### 方式一：源码编译

```bash
# 克隆
git clone https://github.com/caidaoli/kiro2api.git
cd kiro2api

# 编译
go build -o kiro2api .

# 配置
cp .env.example .env
# 编辑 .env，设置 KIRO_AUTH_TOKEN 和 KIRO_CLIENT_TOKEN

# 启动
./kiro2api
```

### 方式二：Docker

```bash
# Docker Compose（推荐）
docker-compose up -d

# 或直接 docker run
docker run -d \
  --name kiro2api \
  -p 8080:8080 \
  -e KIRO_AUTH_TOKEN='[{"auth":"Social","refreshToken":"your_token"}]' \
  -e KIRO_CLIENT_TOKEN="your-api-key" \
  ghcr.io/caidaoli/kiro2api:latest
```

### 环境变量说明

| 变量 | 必需 | 说明 |
|------|------|------|
| `KIRO_AUTH_TOKEN` | ✅ | JSON 数组，包含一个或多个认证配置 |
| `KIRO_CLIENT_TOKEN` | ✅ | 客户端访问 API 的密钥（自定义） |
| `PORT` | ❌ | 服务端口，默认 8080 |
| `GIN_MODE` | ❌ | Gin 运行模式，默认 release |
| `LOG_LEVEL` | ❌ | 日志级别：debug/info/warn/error |

### Token 获取

Social Token 通常在 `~/.aws/sso/cache/kiro-auth-token.json` 中。

### 编译验证

在 dev-server 上使用 Go 1.24 编译通过，无错误：

```
$ go build -o kiro2api .
# 下载依赖后一次编译成功
BUILD_OK
```

## API 端点

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/` | Dashboard 首页 | 无 |
| GET | `/api/tokens` | Token 池状态查询 | 无 |
| GET | `/v1/models` | 可用模型列表 | 需要 |
| POST | `/v1/messages` | Anthropic Claude API | 需要 |
| POST | `/v1/messages/count_tokens` | Token 计数 | 需要 |
| POST | `/v1/chat/completions` | OpenAI ChatCompletion API | 需要 |

## 使用示例

### Claude Code 集成

```bash
export ANTHROPIC_BASE_URL="http://localhost:8080/v1"
export ANTHROPIC_API_KEY="your-kiro-client-token"
claude-code --model claude-sonnet-4 "帮我重构这段代码"
```

### cURL 测试

```bash
# Anthropic 格式
curl -X POST http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1000,
    "messages": [{"role": "user", "content": "你好"}]
  }'

# OpenAI 格式
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "你好"}]
  }'

# 流式请求
curl -N -X POST http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "stream": true,
    "messages": [{"role": "user", "content": "讲个故事"}]
  }'
```

## 关键发现 / 学习心得

### 1. AWS CodeWhisperer 的私有协议细节

项目揭示了 Kiro IDE 背后的 Claude 调用链路：Kiro → AWS SSO/IdC 认证 → CodeWhisperer `generateAssistantResponse` API → AWS EventStream 二进制响应。这不是标准的 Bedrock Converse API，而是 CodeWhisperer 独有的内部协议。

### 2. EventStream 二进制格式的复杂性

AWS EventStream 是一个带 CRC32 校验的二进制帧协议，每个帧包含：总长度（4B）+ 头部长度（4B）+ 头部 CRC（4B）+ Headers + Payload + 消息 CRC（4B）。项目实现了从头解析这个协议，而不是依赖 AWS SDK。

### 3. 消息历史的严格配对要求

CodeWhisperer API 要求消息历史严格按 user → assistant 交替配对。项目处理了多种边界情况：
- 连续多条 user 消息 → 合并后配对一条 assistant
- 孤立的 user 消息 → 自动添加 "OK" 占位 assistant 响应
- tool_result 消息 → content 置空，工具结果放入 `UserInputMessageContext.ToolResults`

### 4. 工程质量亮点

- 使用 `bytedance/sonic` 替代标准 `encoding/json`，JSON 性能提升显著
- 结构化日志系统，支持 JSON/text 格式切换
- SSE 状态机保证 `content_block_start` / `content_block_stop` 严格配对
- Token 计算的进一法修复（避免小分段整除精度丢失）
- 完善的 stop_reason 决策：`end_turn`（正常结束）、`tool_use`（需要工具调用）、`max_tokens`（超长映射）

### 5. 与类似项目的对比

| 维度 | kiro2api | 通用 Claude Proxy |
|------|---------|-------------------|
| 后端 | AWS CodeWhisperer（Kiro 额度）| Anthropic 官方 API |
| 协议 | EventStream 二进制 | 标准 SSE 文本 |
| 认证 | AWS SSO / IdC Token | Anthropic API Key |
| 额外功能 | 多账号池、使用量监控、Dashboard | 通常只做转发 |

## 技术栈

- **语言**: Go 1.24
- **Web 框架**: gin-gonic/gin v1.11.0
- **JSON**: bytedance/sonic v1.14.1（高性能 JSON）
- **配置**: joho/godotenv v1.5.1
- **容器化**: Docker + Docker Compose
- **CI/CD**: GitHub Actions（release-build.yml）

## 参考资源

- [GitHub 仓库](https://github.com/caidaoli/kiro2api)
- [CLAUDE.md — 开发指南](https://github.com/caidaoli/kiro2api/blob/main/CLAUDE.md)
- [AWS EventStream 规范](https://docs.aws.amazon.com/transcribe/latest/dg/event-stream.html)
- [Anthropic API 文档](https://docs.anthropic.com/en/api)
- [OpenAI API 文档](https://platform.openai.com/docs/api-reference)
