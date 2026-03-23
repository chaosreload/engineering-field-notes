# ACP (Agent Client Protocol) — Getting Started 学习笔记

> 文档生成时间：2026-03-04  
> 仓库：https://github.com/agentclientprotocol/agent-client-protocol  
> 操作环境：dev-server (Ubuntu 22.04, Node v24.14.0)

---

## 一、项目概述

### 是什么？

**Agent Client Protocol (ACP)** 是一个标准化协议，用于统一**代码编辑器/IDE**（Client）与 **AI 编码 Agent**（Agent）之间的通信。由 [Zed](https://zed.dev) 发起，目标类似于 LSP（Language Server Protocol）之于语言服务器，让任何兼容 ACP 的 Agent 能与任何支持 ACP 的编辑器互通。

**核心价值：** 打破编辑器与 Agent 的一对一集成困境 → 任意 Agent × 任意编辑器。

### 和 MCP 的区别

| 维度 | ACP | MCP |
|------|-----|-----|
| 定位 | 编辑器 ↔ AI 编码 Agent | AI 应用 ↔ 工具/资源服务器 |
| 方向 | Client 调用 Agent | LLM 调用工具 |
| 会话模型 | 多轮对话 Session | 无状态工具调用 |
| 传输 | stdio (本地) / HTTP/WS (远程) | stdio / HTTP/SSE |
| 设计重心 | 代码编辑器 UX（diff显示、权限确认） | 工具扩展 |
| 复用关系 | **复用 MCP 数据类型**，可通过 Agent 转发 MCP servers | 独立协议 |

> ACP 可以在内部复用 MCP：编辑器把配置好的 MCP servers 传给 Agent，Agent 直接连接 MCP 服务。

---

## 二、项目结构（仓库：agent-client-protocol）

```
agent-client-protocol/
├── src/                    # Rust schema crate（协议类型定义）
│   ├── lib.rs              # 模块入口
│   ├── agent.rs            # Agent 侧类型：InitializeRequest/Response, PromptRequest/Response, NewSessionRequest 等
│   ├── client.rs           # Client 侧类型：SessionNotification, CurrentModeUpdate 等
│   ├── rpc.rs              # JSON-RPC 底层消息格式
│   ├── content.rs          # 内容类型：TextContent, DiffContent, ImageContent 等
│   ├── tool_call.rs        # Tool Call 类型：kind(read/edit/shell), status, permissions
│   ├── plan.rs             # Agent Plan（任务规划展示）
│   ├── protocol_level.rs   # 协议版本管理
│   ├── error.rs            # 错误码定义
│   ├── ext.rs              # 扩展机制（_meta, 自定义方法）
│   └── bin/generate.rs     # Schema JSON 生成器（cargo run → schema/*.json）
├── schema/
│   ├── schema.json         # 稳定版 JSON Schema
│   └── schema.unstable.json # 实验性特性
├── docs/                   # 官方文档（MDX，部署在 agentclientprotocol.com）
│   ├── get-started/        # 入门文档
│   ├── protocol/           # 协议详细规范（overview, session-setup, prompt-turn 等）
│   ├── libraries/          # SDK 文档（TypeScript, Python, Rust, Kotlin）
│   └── rfds/               # RFD（Request for Discussion）设计提案
├── Cargo.toml              # Rust crate: agent-client-protocol-schema v0.10.8
└── package.json            # Docs 工具链（Mintlify）
```

**知识图谱统计（gitnexus analyze 结果）：**

| 类型 | 数量 |
|------|------|
| Function | 195 |
| Impl | 137 |
| Struct | 128 |
| File | 92 |
| Enum | 31 |
| Const | 29 |
| Module | 17 |

核心文件：`src/agent.rs`（2500+ 行，定义所有 Agent 侧协议类型）

---

## 三、架构设计

### 通信模型

```
┌─────────────────┐    JSON-RPC 2.0 over stdio    ┌─────────────────┐
│                 │ ──────────────────────────────▶ │                 │
│  Client（编辑器） │                                 │  Agent（AI程序） │
│  (Zed/VSCode等) │ ◀────────────────────────────── │  (Claude Code,  │
│                 │         流式 Notification         │   Gemini CLI等) │
└─────────────────┘                                └─────────────────┘
         │                                                  │
         │ 可选：提供 MCP server 给 Agent                     │
         └──────────────────────────────────────────────────┘
```

- **本地模式（主流）**：Client 将 Agent 作为子进程启动，通过 stdin/stdout 通信（NDJSON 格式）
- **远程模式（WIP）**：HTTP 或 WebSocket，适合云托管 Agent

### 消息格式

所有消息均为 **NDJSON（换行分隔的 JSON）**，基于 JSON-RPC 2.0：

- **Methods（请求/响应）**：需要等待返回值
- **Notifications（通知）**：单向，无需响应

---

## 四、核心工作流程

### 完整交互时序

```
Client                          Agent
  │                               │
  │── initialize ────────────────▶│  协商协议版本 + 能力
  │◀─ InitializeResponse ─────────│  返回 protocolVersion, agentCapabilities
  │                               │
  │── session/new ───────────────▶│  创建新会话
  │◀─ NewSessionResponse ─────────│  返回 sessionId
  │                               │
  │── session/prompt ────────────▶│  发送用户消息
  │◀─ session/update (notify) ────│  Agent 推送：思考/消息块/Tool Call
  │◀─ session/update (notify) ────│  流式更新...
  │◀─ session/request_permission ─│  （可选）请求权限
  │── permission response ───────▶│
  │◀─ PromptResponse ─────────────│  完成，返回 stopReason
  │                               │
  │── session/cancel (notify) ───▶│  （可选）取消正在进行的操作
```

### Session Update 类型（Agent → Client 通知）

| updateType | 说明 |
|-----------|------|
| `agent_message_chunk` | Agent 回复文本（流式） |
| `agent_thought_chunk` | Agent 思考过程（流式） |
| `user_message_chunk` | 用户消息回显 |
| `tool_call` | 工具调用开始（带 kind: read/edit/shell） |
| `tool_call_update` | 工具调用状态更新/完成 |
| `plan` | Agent 展示任务规划 |
| `available_commands_update` | 可用斜杠命令变化 |
| `current_mode_update` | Session 模式变化 |

---

## 五、SDK 生态

| 语言 | 包名 | 安装 |
|------|------|------|
| TypeScript | `@agentclientprotocol/sdk` | `npm install @agentclientprotocol/sdk` |
| Python | `acp-sdk` | `pip install acp-sdk` |
| Rust | `agent-client-protocol` | `cargo add agent-client-protocol` |
| Kotlin | `acp-kotlin` | Maven/Gradle |

**知名实现：**
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) - Google 官方，TypeScript
- [Zed Editor](https://zed.dev) - ACP 发起方，Rust

---

## 六、在 dev-server 的部署和 Demo

### 环境信息

- dev-server：Ubuntu 22.04，Node.js v24.14.0
- Demo 目录：`/home/ubuntu/chaosreload/acp-demo/`
- 仓库目录：`/home/ubuntu/chaosreload/study/repo/public/agent-client-protocol/`

### 步骤 1：克隆项目

```bash
git clone https://github.com/agentclientprotocol/agent-client-protocol \
  /home/ubuntu/chaosreload/study/repo/public/agent-client-protocol
```

### 步骤 2：gitnexus 建索引分析

```bash
cd /home/ubuntu/chaosreload/study/repo/public/agent-client-protocol
gitnexus analyze .

# 查看状态
gitnexus status
# → Status: ✅ up-to-date

# 查询知识图谱（多仓库时需指定 --repo）
gitnexus query --repo agent-client-protocol "session lifecycle"
gitnexus cypher --repo agent-client-protocol "MATCH (n) RETURN labels(n) as type, count(n) as count ORDER BY count DESC LIMIT 15"
```

### 步骤 3：创建 TypeScript Demo 项目

```bash
mkdir -p /home/ubuntu/chaosreload/acp-demo/src
cd /home/ubuntu/chaosreload/acp-demo
```

**package.json：**
```json
{
  "name": "acp-demo",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@agentclientprotocol/sdk": "*"
  },
  "devDependencies": {
    "tsx": "*",
    "@types/node": "*"
  }
}
```

```bash
npm install
```

### 步骤 4：实现 Echo Agent（src/agent.ts）

ACP Agent 的最小实现——需实现 `acp.Agent` 接口的 5 个方法：

```typescript
import * as acp from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';

class EchoAgent implements acp.Agent {
  constructor(private connection: acp.AgentSideConnection) {}

  // 1. 协议握手
  async initialize(_p: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    return { protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { loadSession: false } };
  }

  // 2. 创建会话
  async newSession(_p: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    return { sessionId: crypto.randomUUID() };
  }

  // 3. 认证（可选）
  async authenticate(_p: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse | void> {
    return {};
  }

  // 4. 设置模式（可选）
  async setSessionMode(_p: acp.SetSessionModeRequest): Promise<acp.SetSessionModeResponse> {
    return {};
  }

  // 5. 核心：处理用户 prompt
  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const userText = params.prompt
      .filter(p => p.type === 'text')
      .map(p => (p as acp.TextContent).text)
      .join(' ');

    // 推送思考过程
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '处理中...' } }
    });

    // 推送回复
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `Echo: ${userText}` } }
    });

    return { stopReason: 'end_turn' };
  }

  async cancel(params: acp.CancelNotification): Promise<void> {}
}

// 启动 Agent（stdio 模式）
const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
const stream = acp.ndJsonStream(input, output);
new acp.AgentSideConnection((conn) => new EchoAgent(conn), stream);
```

### 步骤 5：实现 Client（src/client.ts）

Client 启动 Agent 子进程，发起对话：

```typescript
import { spawn } from 'node:child_process';
import * as acp from '@agentclientprotocol/sdk';

class DemoClient implements acp.Client {
  async requestPermission(p: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    console.log('🔐 Permission:', p.toolCall.title);
    return { outcome: { outcome: 'selected', optionId: p.options[0].optionId } };
  }
  async sessionUpdate(p: acp.SessionNotification): Promise<void> {
    const u = p.update;
    if (u.sessionUpdate === 'agent_message_chunk' && u.content.type === 'text')
      console.log('💬 Agent:', u.content.text);
  }
  async writeTextFile(p: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse> { return {}; }
  async readTextFile(p: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse> {
    return { content: 'mock content' };
  }
}

async function main() {
  // 1. 启动 Agent 子进程
  const agent = spawn('node', ['--import', 'tsx/esm', 'src/agent.ts'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  const stream = acp.ndJsonStream(
    Writable.toWeb(agent.stdin!),
    Readable.toWeb(agent.stdout!) as ReadableStream<Uint8Array>
  );
  const conn = new acp.ClientSideConnection(() => new DemoClient(), stream);

  // 2. initialize
  const init = await conn.initialize({
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
  });
  console.log('✅ Protocol version:', init.protocolVersion);

  // 3. 创建 session
  const { sessionId } = await conn.newSession({ cwd: process.cwd(), mcpServers: [] });
  console.log('📝 Session:', sessionId);

  // 4. 发送 prompt
  const result = await conn.prompt({
    sessionId,
    prompt: [{ type: 'text', text: 'Hello ACP!' }],
  });
  console.log('✅ Stop reason:', result.stopReason);

  agent.kill();
}
main();
```

### 步骤 6：运行 Demo

```bash
cd /home/ubuntu/chaosreload/acp-demo
node --import tsx/esm src/client.ts
```

### ✅ 实际运行输出

```
=== ACP Demo Client ===
Launching agent subprocess...

✅ Connected! Protocol version: 1
📝 Session created: 6db2d3b3-1954-48d9-9176-f04ceb2fdd80

---
👤 User: Hello, ACP Agent! 你好！

💭 Thought: 正在处理消息: Hello, ACP Agent! 你好！
🔧 Tool: Reading context file [pending]
   └─ Completed: tc_read_1

💬 Agent: [ACP Echo Agent] 收到你的消息: "Hello, ACP Agent! 你好！" | 协议版本: 1
✅ Turn complete, stop reason: end_turn

---
👤 User: ACP 协议和 MCP 协议有什么区别？
...（3轮对话全部成功）

=== Demo completed successfully! ===
```

---

## 七、核心概念速查

### Protocol Version

当前稳定版：**`1`**（`acp.PROTOCOL_VERSION`）

### Agent 必须实现的接口

```typescript
interface Agent {
  initialize(params: InitializeRequest): Promise<InitializeResponse>
  newSession(params: NewSessionRequest): Promise<NewSessionResponse>
  authenticate(params: AuthenticateRequest): Promise<AuthenticateResponse | void>
  setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse>
  prompt(params: PromptRequest): Promise<PromptResponse>
  cancel(params: CancelNotification): Promise<void>
}
```

### Client 必须实现的接口

```typescript
interface Client {
  requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse>
  sessionUpdate(params: SessionNotification): Promise<void>
  // 可选（根据声明的 capabilities）：
  writeTextFile?(params: WriteTextFileRequest): Promise<WriteTextFileResponse>
  readTextFile?(params: ReadTextFileRequest): Promise<ReadTextFileResponse>
  // terminal.* 方法...
}
```

### PromptResponse stopReason

| 值 | 含义 |
|----|------|
| `end_turn` | 正常完成 |
| `cancelled` | 被 cancel notification 中止 |
| `max_tokens` | token 超限 |
| `tool_use` | 需要工具结果（特殊场景） |

---

## 八、扩展机制

1. **`_meta` 字段**：在任何请求/响应中附加自定义元数据
2. **自定义方法**：以下划线 `_` 开头命名（如 `_myEditor/specialOp`）
3. **自定义 Capabilities**：在 `initialize` 时声明扩展能力

---

## 九、生态支持的编辑器 & Agent

**Clients（编辑器）：** Zed、Cursor（实验中）、其他支持 ACP 的 IDE  
**Agents：** Claude Code、Gemini CLI（官方参考实现）、OpenClaw ACP Sessions

**OpenClaw 特别说明：** OpenClaw 自身实现了 ACP harness，通过 `sessions_spawn(runtime="acp")` 可以在 OpenClaw 中启动 ACP coding agents（如 Claude Code、Gemini CLI 等）并进行交互。

---

## 十、参考资料

- 官方文档：https://agentclientprotocol.com
- GitHub：https://github.com/agentclientprotocol/agent-client-protocol
- TypeScript SDK：https://github.com/agentclientprotocol/typescript-sdk
- Python SDK：https://github.com/agentclientprotocol/python-sdk
- Gemini CLI 实现参考：https://github.com/google-gemini/gemini-cli
- JSON Schema：https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/schema.json
