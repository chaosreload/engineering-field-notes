# E2B Getting Started

> 整理日期：2026-03-23  
> 仓库地址：https://github.com/e2b-dev/E2B

## 项目简介

E2B（Environment to Build）是一个开源的云端代码沙箱基础设施，专为 AI Agent 和 AI 应用设计。它允许 LLM 生成的代码在安全、隔离的云端 Linux 环境中执行，提供文件系统、命令执行、PTY 终端、Git 操作、网络访问等完整的系统能力。

**核心价值**：让 AI Agent 拥有和人类一样使用工具的能力——可以运行代码、操作文件、访问互联网，而且完全隔离安全。

**生态定位**：
- **控制层**：E2B Cloud API（`api.e2b.app`）负责沙箱生命周期管理
- **数据层**：envd 守护进程在每个沙箱内部运行，提供文件/进程操作 RPC
- **SDK 层**：Python SDK + JS SDK 封装两层通信
- **扩展层**：100+ 内置 MCP Server 配置（Postgres、GitHub、Slack 等），可直接在沙箱内运行

---

## 项目结构

```
E2B/
├── packages/
│   ├── js-sdk/           # TypeScript/JavaScript SDK
│   │   └── src/
│   │       ├── sandbox/  # 核心沙箱实现（commands/filesystem/git/mcp）
│   │       ├── envd/     # envd 通信层（Connect 协议，protobuf）
│   │       ├── api/      # 控制平面 REST API 客户端（自动生成）
│   │       └── template/ # 自定义模板构建工具
│   ├── python-sdk/       # Python SDK（同步 + 异步双 API）
│   │   └── e2b/
│   │       ├── sandbox_sync/   # 同步 Sandbox 实现
│   │       ├── sandbox_async/  # 异步 AsyncSandbox 实现
│   │       ├── envd/           # envd RPC 客户端（filesystem/process）
│   │       ├── api/            # 自动生成的 REST API 客户端
│   │       └── template_sync/  # Template 构建
│   ├── connect-python/   # Connect 协议 Python 实现（Go + Python 混合）
│   └── cli/              # e2b CLI（模板管理）
└── spec/
    └── openapi.yml       # 控制平面 API 规范
```

---

## 核心架构

```
┌─────────────────────────────────────────────────┐
│                  AI Agent / App                  │
└──────────────┬──────────────────────────────────┘
               │  Python/JS SDK
               ▼
┌─────────────────────────────────────────────────┐
│            E2B Control Plane                     │
│         api.e2b.app  (REST API)                  │
│  POST /sandboxes   GET /sandboxes/{id}           │
│  POST /snapshots   DELETE /sandboxes/{id}        │
└──────────────┬──────────────────────────────────┘
               │  创建/管理沙箱
               ▼
┌─────────────────────────────────────────────────┐
│        Sandbox (隔离 Linux 容器)                  │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │   envd daemon  (port 49983)              │   │
│  │   Connect Protocol (HTTP/2 + protobuf)   │   │
│  │   ┌──────────┐  ┌──────────┐            │   │
│  │   │Filesystem│  │ Process  │            │   │
│  │   │ Service  │  │ Service  │            │   │
│  │   └──────────┘  └──────────┘            │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  URL: {port}-{sandbox_id}.e2b.app               │
└─────────────────────────────────────────────────┘
```

**两层通信协议**：
1. **控制平面**：标准 REST/HTTP，通过 `api.e2b.app` 管理沙箱生命周期
2. **数据平面**：[Connect Protocol](https://connectrpc.com)（HTTP/2 + protobuf streaming），直接与沙箱内 envd 通信，实现低延迟的文件/进程操作

---

## 核心工作流程

### 1. 沙箱生命周期

```python
# 创建沙箱（调用控制平面 API，分配 Linux 容器）
sandbox = Sandbox.create(timeout=300_000)  # 默认 5 分钟

# 使用沙箱...

# 暂停沙箱（保留内存状态，可恢复）
sandbox.pause()
sbx_id = sandbox.sandbox_id

# 恢复沙箱
sandbox = Sandbox.connect(sbx_id)

# 快照（持久化沙箱状态，可用于创建新沙箱）
snapshot = sandbox.create_snapshot()

# 终止沙箱
sandbox.kill()
```

**生命周期配置**：
```python
sandbox = Sandbox.create(
    lifecycle={
        "on_timeout": "pause",   # timeout 后暂停而非销毁
        "auto_resume": True,     # 有流量时自动恢复
    }
)
```

### 2. 文件系统操作

```python
# 写文件（通过 envd Filesystem Service RPC）
sandbox.files.write("/home/user/hello.py", "print('Hello, World!')")

# 读文件
content = sandbox.files.read("/home/user/hello.py")

# 目录操作
sandbox.files.make_dir("/home/user/project")
entries = sandbox.files.list("/home/user/")

# 文件监听（实时事件流）
with sandbox.files.watch_dir("/home/user/") as watcher:
    for event in watcher:
        print(f"{event.type}: {event.path}")
```

### 3. 命令执行

```python
# 同步执行（等待完成）
result = sandbox.commands.run("python3 hello.py", cwd="/home/user")
print(result.stdout)   # "Hello, World!\n"
print(result.exit_code)  # 0

# 异步执行（后台进程）
proc = sandbox.commands.run("python3 server.py", background=True)
# 获取输出流...

# PTY 终端（交互式）
pty = sandbox.pty.create(cols=80, rows=24)
pty.send_stdin("ls -la\n")
output = pty.read()
```

### 4. Git 集成

```python
# 在沙箱内执行 Git 操作
sandbox.git.clone("https://github.com/user/repo", "/home/user/repo")
sandbox.git.add(paths=["/home/user/repo/main.py"])
sandbox.git.commit("feat: add new feature")
sandbox.git.push()
```

### 5. 自定义模板（Template）

通过 e2b CLI 构建自定义沙箱镜像：

```dockerfile
# e2b.Dockerfile
FROM e2b/code-interpreter:latest

# 安装项目依赖
RUN pip install pandas numpy matplotlib
RUN apt-get install -y nodejs npm

# 设置启动命令
CMD ["python3", "-m", "e2b.sandbox"]
```

```bash
# 构建并部署模板
e2b template build --name my-template -d e2b.Dockerfile
e2b template list
```

```python
# 使用自定义模板
sandbox = Sandbox.create(template="my-template")
```

### 6. MCP Server 集成（核心特性）

E2B 支持在沙箱内直接运行 MCP Server，让 AI Agent 通过标准化接口使用各种工具：

```python
# 使用内置 MCP Server（100+ 预配置）
sandbox = Sandbox.create(
    mcp={
        "postgres": {"url": "postgresql://localhost:5432/mydb"},
        "github": {"personalAccessToken": "ghp_xxx"},
        "slack": {"botToken": "xoxb-xxx", "teamId": "T0xxx"},
    }
)

# 通过 GitHub MCP Server（动态安装 GitHub 仓库中的 MCP）
sandbox = Sandbox.create(
    mcp={
        "github/modelcontextprotocol/servers": {
            "runCmd": "npx @modelcontextprotocol/server-memory",
        }
    }
)
```

### 7. 网络访问控制

```python
# 细粒度网络控制
sandbox = Sandbox.create(
    network={
        "allow_out": ["1.1.1.1", "8.8.8.0/24"],   # 白名单出站
        # "deny_out": ["1.1.1.1"],                   # 或黑名单
        "allow_public_traffic": False,              # 沙箱 URL 需认证访问
    }
)

# 访问沙箱运行的服务
url = sandbox.get_host(port=8080)
# => "8080-{sandbox_id}.e2b.app"
```

---

## 部署/安装步骤

E2B 是云端 SaaS，SDK 调用远程 API，**本地无需部署服务**。

### 安装 SDK

```bash
# Python
pip install e2b

# JavaScript/TypeScript
npm install e2b
# 或安装 Code Interpreter SDK（扩展版）
npm install @e2b/code-interpreter
```

### 获取 API Key

1. 注册：https://e2b.dev
2. 获取 API Key：https://e2b.dev/dashboard?tab=keys
3. 设置环境变量：`export E2B_API_KEY=e2b_***`

### 安装 CLI

```bash
npm install -g @e2b/cli
e2b auth login
```

### 自托管（可选）

E2B 基础设施代码在 [e2b-dev/infra](https://github.com/e2b-dev/infra)，使用 Terraform 部署：
- 支持 AWS（已 GA）
- 支持 GCP（已 GA）
- Azure、通用 Linux 机器（开发中）

---

## Demo 示例

### Python 示例（需要 E2B API Key）

```python
# demo.py - E2B 沙箱基本用法演示
import os
from e2b import Sandbox

# 确保设置了 E2B_API_KEY 环境变量
# export E2B_API_KEY=e2b_xxx

def demo_basic():
    """基本代码执行 + 文件操作演示"""
    with Sandbox.create(timeout=60_000) as sbx:
        print(f"沙箱创建成功: {sbx.sandbox_id}")
        
        # 写入 Python 脚本
        sbx.files.write("/tmp/fibonacci.py", """
def fib(n):
    if n <= 1:
        return n
    return fib(n-1) + fib(n-2)

result = [fib(i) for i in range(10)]
print("Fibonacci:", result)
""")
        
        # 执行脚本
        result = sbx.commands.run("python3 /tmp/fibonacci.py")
        print(f"执行结果: {result.stdout}")
        # => Fibonacci: [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]
        
        # 读取文件
        content = sbx.files.read("/tmp/fibonacci.py")
        print(f"文件大小: {len(content)} 字节")
        
        # 系统信息
        info = sbx.commands.run("uname -a && python3 --version")
        print(f"系统信息: {info.stdout}")

def demo_async():
    """异步 API 演示"""
    import asyncio
    from e2b import AsyncSandbox
    
    async def run():
        async with await AsyncSandbox.create(timeout=60_000) as sbx:
            # 并发执行多个命令
            results = await asyncio.gather(
                sbx.commands.run("echo 'task 1'"),
                sbx.commands.run("echo 'task 2'"),
                sbx.commands.run("echo 'task 3'"),
            )
            for r in results:
                print(r.stdout.strip())
    
    asyncio.run(run())

if __name__ == "__main__":
    demo_basic()
```

### 运行方式

```bash
export E2B_API_KEY=e2b_your_key_here
pip install e2b python-dotenv
python3 demo.py
```

### 预期输出

```
沙箱创建成功: sbx_abc123xyz
执行结果: Fibonacci: [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]
文件大小: 153 字节
系统信息: Linux sbx-abc123 5.15.0 #1 SMP x86_64 GNU/Linux
Python 3.11.x
```

---

## 关键发现 / 学习心得

### 1. 双层通信设计很精妙

控制平面（REST API）和数据平面（Connect/gRPC）分离：
- REST 适合低频的生命周期操作（创建/删除/列表）
- Connect Protocol 适合高频的 I/O 操作（文件读写、命令输出流）
- 这让延迟和吞吐都得到优化，不走同一个 API endpoint

### 2. 同步/异步双 API 是工程考量

Python SDK 提供 `Sandbox`（同步）和 `AsyncSandbox`（异步）两套 API，代码逻辑完全镜像，通过代码生成保持一致。这是专业 Python 库的标准做法，避免用户因 async 复杂性阻碍采用。

### 3. MCP Server 内置是差异化优势

`spec/openapi.yml` 中有完整的 `mcp-server.json` schema，内置 100+ MCP Server 配置（Postgres、GitHub、Slack、Redis、MongoDB 等）。AI Agent 可以直接在沙箱内运行这些 MCP Server，实现"带工具的代码执行"。这比竞品（Modal、Runpod）高一个维度。

### 4. Template 机制类似 Dockerfile + CI

自定义模板本质上是 Docker 镜像，通过 e2b CLI 构建并推送到 E2B 注册表。`ReadyCmd` 机制（`wait_for_port`、`wait_for_process` 等）允许等待模板内服务就绪后再返回沙箱，类似 Docker health check。

### 5. Snapshot 是持久化 AI 工作会话的关键

Snapshot 允许保存整个沙箱状态（内存 + 文件系统），后续可从 Snapshot 创建新沙箱。这对长时间运行的 AI Agent 很重要：可以随时保存"检查点"，故障恢复不用重头来。

### 6. 与竞品对比

| 特性 | E2B | Modal | Daytona | Fly.io |
|------|-----|-------|---------|--------|
| 针对 AI Agent | ✅ 核心场景 | 部分 | 部分 | 通用 |
| MCP 内置 | ✅ 100+ | ❌ | ❌ | ❌ |
| Snapshot 恢复 | ✅ | ✅ | ❌ | ✅ |
| 开源基础设施 | ✅ | ❌ | ✅ | ❌ |
| Python SDK async | ✅ | ✅ | ❌ | N/A |

---

## 参考资源

- 官方文档：https://e2b.dev/docs
- Code Interpreter SDK（扩展版）：https://github.com/e2b-dev/code-interpreter
- 基础设施代码（自托管）：https://github.com/e2b-dev/infra
- Cookbook 示例：https://github.com/e2b-dev/e2b-cookbook
- PyPI：https://pypi.org/project/e2b/
- NPM：https://www.npmjs.com/package/e2b
- OpenAPI 规范：`spec/openapi.yml`（控制平面 API）
