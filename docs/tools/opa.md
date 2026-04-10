# OPA (Open Policy Agent) Getting Started

> 整理日期：2026-04-10
> 仓库地址：https://github.com/open-policy-agent/opa

## 项目简介

Open Policy Agent (OPA，读作 "oh-pa") 是一个**通用策略引擎**，由 CNCF 毕业项目。它将策略决策从业务逻辑中解耦，用声明式语言 Rego 编写策略规则，通过 REST API 或 Go SDK 为任意系统提供策略评估服务。

**一句话定位**：把散落在各系统代码里的 `if/else` 权限判断，统一抽出来变成可审计、可测试、可版本管理的 Policy-as-Code。

**适用场景**：Kubernetes 准入控制、API 网关授权、微服务间访问控制、CI/CD 流水线审批、Terraform/IaC 合规检查。

## 核心架构

```
┌──────────────────────────────────────────────────────────┐
│                    OPA (Policy Engine)                     │
│                                                           │
│  ┌─────────┐   ┌──────────┐   ┌───────────┐              │
│  │  Rego   │──▶│ Compiler │──▶│ Topdown   │──▶ Decision   │
│  │ Policy  │   │  (AST)   │   │ Evaluator │   (JSON)     │
│  └─────────┘   └──────────┘   └───────────┘              │
│                                     ▲                     │
│  ┌─────────┐                        │                     │
│  │  Input  │────────────────────────┘                     │
│  │ (JSON)  │                                              │
│  └─────────┘   ┌──────────┐   ┌───────────┐              │
│                │  Bundle  │──▶│  Storage  │              │
│                │  System  │   │ (In-mem)  │              │
│                └──────────┘   └───────────┘              │
│                                                           │
│  ┌─────────────────────────────────────────┐              │
│  │         Plugin System                    │              │
│  │  Discovery │ Bundle │ Status │ Decision  │              │
│  │            │  Sync  │ Report │   Logs    │              │
│  └─────────────────────────────────────────┘              │
│                                                           │
│  ┌─────────┐   ┌──────────┐                               │
│  │  REST   │   │   Go     │  ← 两种集成方式               │
│  │  API    │   │   SDK    │                               │
│  └─────────┘   └──────────┘                               │
└──────────────────────────────────────────────────────────┘
```

### 关键模块

| 模块 | 路径 | 职责 |
|------|------|------|
| **ast** | `ast/` | Rego 语言解析器，生成抽象语法树 |
| **topdown** | `topdown/` | 核心评估引擎，自顶向下搜索式求值 |
| **rego** | `rego/` | 高层 Go API，编译+评估的统一入口 |
| **bundle** | `bundle/` | Bundle 打包/加载/签名/验证 |
| **plugins** | `plugins/` | 插件系统（Bundle同步、Decision Log、Status上报、Discovery） |
| **server** | `server/` | REST API 服务器（HTTP + gRPC） |
| **sdk** | `sdk/` | 简化版 Go SDK，内嵌策略评估 |
| **storage** | `storage/` | 内存存储层，管理 data 文档 |
| **compile** | `compile/` | 策略编译为中间表示(IR)或 WASM |
| **wasm** | `wasm/` | WebAssembly 运行时支持 |

### 数据流

```
1. 服务发送请求 → OPA REST API (POST /v1/data/{path})
2. OPA 接收 input (JSON) + 已加载的 policy + data
3. Rego 编译器将 policy 编译为 AST
4. Topdown 评估器执行查询，搜索满足条件的变量绑定
5. 返回决策结果 (JSON) 给调用方
6. 调用方根据决策执行允许/拒绝
```

## Rego 语言

### 设计理念

Rego（读作 "ray-go"）受 Datalog 启发，专为**结构化数据的策略表达**而设计：

- **声明式**：描述"什么是合规的"，而非"如何检查合规"
- **确定性**：相同输入必产生相同输出，无副作用
- **数据感知**：原生支持 JSON/嵌套文档的引用和遍历
- **完备的集合操作**：内置集合推导(comprehension)、量化(every/some)
- **可组合**：规则可以互相引用，支持增量定义（多个 rule body 是 OR 关系）

### 语法要点

```rego
package example

import rego.v1

# 规则 = 条件满足时的赋值
# 多个同名规则体是 OR 关系（任一为真即为真）
default allow := false

# 简单规则
allow if {
    input.user.role == "admin"
}

# 增量规则（OR 语义）
allow if {
    input.action == "read"
    input.resource.public == true
}

# 集合推导 — 生成集合
violations contains msg if {
    some server in input.servers
    server.protocol == "http"
    msg := sprintf("server %v uses insecure protocol", [server.id])
}

# 对象推导 — 生成键值对
server_by_id[id] := server if {
    some server in input.servers
    id := server.id
}

# every 关键字 — 全称量化
all_servers_https if {
    every server in input.servers {
        server.protocol == "https"
    }
}

# 函数定义
is_allowed(user, action, resource) if {
    user.role == "admin"
}

# 字符串插值（v1 语法）
message := sprintf("User %v denied: %v on %v", [
    input.user.name, input.action, input.resource.name
])
```

### Rego v1 变化

OPA 1.x 默认使用 Rego v1 语法，主要变化：
- `if` 关键字在规则体中变为**必须**（之前可省略）
- `contains` 关键字在集合规则中变为**必须**
- `import rego.v1` 或 `import future.keywords` 不再需要（默认启用）
- 更严格的变量作用域检查

## 主要使用场景

### 1. Kubernetes Admission Control

通过 [OPA Gatekeeper](https://github.com/open-policy-agent/gatekeeper) 集成：

```
kubectl apply → K8s API Server → Admission Webhook → OPA Gatekeeper
                                                          │
                                                    Rego Policy
                                                          │
                                                   Allow / Deny
```

典型策略：禁止特权容器、强制镜像签名、限制资源配额、要求标签。

### 2. API Gateway 授权

```
Client → API Gateway (Envoy/Kong/Nginx) → OPA → 决策
                                                  │
                                            Allow + HTTP headers
```

OPA 作为外部授权服务(External Authorization)，对每个 API 请求做细粒度权限判断。

### 3. 微服务间授权

```
Service A → HTTP/gRPC → Service B
                           │
                      OPA (sidecar/library)
                           │
                     Check: A 是否有权调用 B 的此接口？
```

### 4. IaC 合规（Terraform/CloudFormation）

```
terraform plan → JSON → OPA/Conftest → 违规报告
```

在 CI/CD 阶段检查基础设施配置是否符合安全策略。

## 部署模式

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| **Daemon (Server)** | `opa run --server`，独立进程提供 REST API | 多语言环境、中心化策略服务 |
| **Sidecar** | 与业务容器同 Pod 部署 | K8s 微服务、低延迟要求 |
| **Go Library** | `import "github.com/open-policy-agent/opa/rego"` 嵌入应用 | Go 应用、零网络开销 |
| **WASM** | 编译策略为 WebAssembly 模块 | 边缘计算、浏览器、非 Go 语言嵌入 |

### Bundle 机制

Bundle 是 OPA 的策略分发系统：

```
Policy Repo → CI Build → Bundle Server (S3/HTTP) → OPA 实例
                              (tar.gz)                 │
                                                  定期拉取更新
```

- Bundle = 策略文件 + 数据文件的 tar.gz 包
- 支持签名验证（防篡改）
- OPA 定期轮询 Bundle Server 获取更新
- 支持多 Bundle 配置（不同来源的策略分开管理）

## 项目结构

```
opa/
├── ast/          # Rego 解析器 + AST 定义
├── bundle/       # Bundle 打包/加载/验证
├── cmd/          # CLI 入口 (opa run/eval/test/fmt/build...)
├── compile/      # 编译为 IR/WASM
├── config/       # 配置解析
├── internal/     # 内部实现细节
├── ir/           # 中间表示(IR)
├── plugins/      # 插件系统
│   ├── bundle/   #   Bundle 同步插件
│   ├── discovery/#   服务发现插件
│   ├── logs/     #   Decision Log 插件
│   ├── rest/     #   REST 客户端
│   └── status/   #   状态上报插件
├── rego/         # 高层评估 API
├── repl/         # 交互式 REPL
├── runtime/      # 运行时管理
├── sdk/          # 简化 Go SDK
├── server/       # REST API 服务器
├── storage/      # 内存存储层
├── topdown/      # 核心评估引擎
├── types/        # 类型系统
├── v1/           # v1 API 实现（实际逻辑所在）
└── wasm/         # WebAssembly 支持
```

## 部署步骤

### 安装 OPA CLI

```bash
# Linux amd64
curl -L -o opa https://openpolicyagent.org/downloads/latest/opa_linux_amd64_static
chmod +x opa
./opa version

# macOS
brew install opa

# Docker
docker pull openpolicyagent/opa:latest
docker run openpolicyagent/opa:latest version
```

### 作为服务运行

```bash
# 启动 OPA Server（加载策略和数据）
opa run --server --addr :8181 policy.rego data.json

# 查询策略决策
curl -X POST http://localhost:8181/v1/data/authz/allow \
  -H "Content-Type: application/json" \
  -d '{"input": {"user": {"role": "admin"}, "action": "delete"}}'

# 健康检查
curl http://localhost:8181/health
```

## Demo 示例

### 策略文件 (`policy.rego`)

一个 API 授权策略，支持三种角色：

```rego
package authz

import rego.v1

# 默认拒绝所有请求
default allow := false

# 允许 admin 角色访问任何资源
allow if {
    input.user.role == "admin"
}

# 允许用户读取自己的资源
allow if {
    input.action == "read"
    input.user.id == input.resource.owner
}

# 允许 viewer 角色只读公开资源
allow if {
    input.user.role == "viewer"
    input.action == "read"
    input.resource.public == true
}

# 生成拒绝原因
reason contains msg if {
    not allow
    input.user.role != "admin"
    msg := sprintf("用户 %v (角色: %v) 无权对资源 %v 执行 %v 操作", [
        input.user.name, input.user.role,
        input.resource.name, input.action
    ])
}
```

### 运行结果

**场景 1：Admin 删除资源 → 允许**

```bash
$ opa eval -i input-allow.json -d policy.rego 'data.authz.allow'
# 输入: {"user": {"role": "admin"}, "action": "delete", ...}
# 结果:
{
  "result": [{"expressions": [{"value": true, "text": "data.authz.allow"}]}]
}
```

**场景 2：Viewer 写入私有资源 → 拒绝 + 原因**

```bash
$ opa eval -i input-deny.json -d policy.rego 'data.authz'
# 输入: {"user": {"role": "viewer", "name": "Bob"}, "action": "write", ...}
# 结果:
{
  "result": [{
    "expressions": [{
      "value": {
        "allow": false,
        "reason": ["用户 Bob (角色: viewer) 无权对资源 project-config 执行 write 操作"]
      }
    }]
  }]
}
```

**场景 3：Owner 读取自己的资源 → 允许**

```bash
$ opa eval -i input-owner.json -d policy.rego 'data.authz.allow'
# 输入: {"user": {"id": "user-456"}, "action": "read", "resource": {"owner": "user-456"}}
# 结果:
{
  "result": [{"expressions": [{"value": true, "text": "data.authz.allow"}]}]
}
```

**REST API 模式**

```bash
# 启动服务
$ opa run --server --addr :8181 policy.rego data.json

# 查询决策
$ curl -s -X POST http://localhost:8181/v1/data/authz/allow \
  -H 'Content-Type: application/json' \
  -d '{"input":{"user":{"id":"u1","name":"Alice","role":"admin"},"action":"delete","resource":{"name":"cfg","owner":"u2","public":false}}}'

{"result":true}
```

## 关键发现 / 学习心得

### 1. 策略解耦是核心价值

OPA 最大的价值不是"又一个权限框架"，而是**策略与业务代码的彻底解耦**。策略变更不需要重新部署应用——更新 Bundle 即可热加载。这在大规模微服务架构中是巨大优势。

### 2. Rego 的声明式思维需要转换

习惯命令式编程的开发者需要思维转换：
- **没有循环**：用集合推导 + `some` 取代 for 循环
- **没有 if/else**：用多个同名规则体表达 OR，规则体内的多个表达式表达 AND
- **没有赋值**：`:=` 是绑定不是赋值，一个变量只能绑定一次
- **undefined 不是 false**：规则不匹配时结果是 undefined，需要用 `default` 处理

### 3. Bundle 机制的 GitOps 亲和性

Bundle + 签名验证的设计天然适合 GitOps：
```
Git Push → CI 构建 Bundle → 推送到 S3 → OPA 自动拉取
```
策略变更有完整的 Git 审计记录，签名防止中间人篡改。

### 4. 性能考量

- OPA 将策略编译为内部 IR，评估速度通常在**微秒级**
- 对于延迟敏感场景，Go Library 嵌入 > Sidecar > 远程调用
- WASM 编译可在非 Go 环境获得接近原生的性能

### 5. 与同类项目对比

| 特性 | OPA | Casbin | Cedar |
|------|-----|--------|-------|
| 策略语言 | Rego (Datalog-inspired) | PERM 模型配置 | Cedar 语言 |
| 通用性 | 任意 JSON 策略 | 主要 RBAC/ABAC | AWS 生态 |
| 部署方式 | Server/Library/WASM | Library | Library/Service |
| CNCF 状态 | Graduated | - | - |
| K8s 集成 | Gatekeeper (成熟) | 需自行集成 | 无 |

## 参考资源

- [官方文档](https://www.openpolicyagent.org/docs)
- [Rego Playground](https://play.openpolicyagent.org) — 在线编写和测试 Rego
- [OPA Gatekeeper](https://github.com/open-policy-agent/gatekeeper) — K8s 准入控制
- [Conftest](https://github.com/open-policy-agent/conftest) — IaC 策略测试工具
- [Regal](https://github.com/StyraInc/regal) — Rego 代码检查器
- [Rego v1 迁移指南](https://www.openpolicyagent.org/docs/latest/opa-1/)
- [OPA Ecosystem](https://www.openpolicyagent.org/ecosystem) — 社区集成项目
