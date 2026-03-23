# e2b-dev/infra Getting Started

> 整理日期：2026-03-23  
> 仓库地址：https://github.com/e2b-dev/infra  
> 关联：[E2B SDK 笔记](./E2B.md)（上层 SDK，本文档聚焦底层基础设施）

## 项目简介

E2B Infra 是驱动 E2B 云端沙箱服务的完整基础设施代码。如果说 [E2B SDK](./E2B.md) 是用户的遥控器，那 infra 就是沙箱背后真实运行的机器——从 Terraform 部署脚本到 Firecracker 微虚拟机管理，从 Linux userfaultfd 内存恢复到 NBD 块设备 overlay，这里是整个系统最底层最核心的部分。

**技术栈**：Go（核心服务）+ Terraform + Nomad（调度）+ Consul（服务发现）+ Firecracker（VMM）+ Redis + PostgreSQL + ClickHouse

**自托管支持**：AWS（Beta）、GCP（GA）

---

## 项目结构

```
infra/
├── iac/                          # Infrastructure as Code
│   ├── modules/                  # Nomad job 模块（Terraform 管理）
│   │   ├── job-api/              # 控制平面 API
│   │   ├── job-orchestrator/     # 沙箱编排器
│   │   ├── job-client-proxy/     # 客户端代理（envd 流量转发）
│   │   ├── job-template-manager/ # 模板构建管理
│   │   ├── job-ingress/          # 流量入口
│   │   ├── job-clickhouse/       # 指标存储
│   │   ├── job-loki/             # 日志聚合
│   │   └── job-redis/            # 缓存/协调
│   ├── provider-gcp/             # GCP 特定 Terraform 配置
│   └── provider-aws/             # AWS 特定 Terraform 配置
│
└── packages/                     # Go 服务代码
    ├── api/                      # 控制平面 API（REST，面向 SDK）
    ├── orchestrator/             # 核心！沙箱编排器（管理 Firecracker VM）
    ├── envd/                     # 沙箱内守护进程（文件系统/进程 RPC）
    ├── client-proxy/             # SDK 与 envd 之间的代理层
    ├── auth/                     # 认证服务
    ├── db/                       # PostgreSQL 数据层（sqlc 生成）
    ├── clickhouse/               # 指标数据层
    ├── dashboard-api/            # 控制台 API
    ├── docker-reverse-proxy/     # Docker 镜像代理（模板构建用）
    ├── shared/                   # 跨服务共享代码（protobuf/grpc 定义等）
    ├── nomad-nodepool-apm/       # Nomad 节点池自动扩缩容插件
    └── local-dev/                # 本地开发环境
```

---

## 核心架构

```
                          ┌─────────────────────────────────────────┐
                          │           E2B Control Plane              │
                          │                                          │
SDK  ──REST──►   ┌────────┴──────────┐    ┌──────────────────────┐  │
                 │    API Service    │    │  Template Manager    │  │
                 │  (Go, OpenAPI)    │    │  (template builds)   │  │
                 └────────┬──────────┘    └──────────────────────┘  │
                          │ gRPC                                     │
                          │                                          │
                 ┌────────▼──────────────────────────────────────┐  │
                 │              Nomad Cluster                    │  │
                 │  ┌──────────┐  ┌──────────┐  ┌──────────┐   │  │
                 │  │ Orch     │  │ Orch     │  │ Orch     │   │  │
                 │  │ Node 1   │  │ Node 2   │  │ Node N   │   │  │
                 │  └────┬─────┘  └──────────┘  └──────────┘   │  │
                 └───────┼───────────────────────────────────────┘  │
                         │                                          │
                         └──────────────────────────────────────────┘
                         │
                 ┌───────▼────────────────────────────────────────────┐
                 │         Orchestrator Node (bare metal / VM)         │
                 │                                                     │
                 │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
                 │  │Firecrack │  │Firecrack │  │  Firecracker     │  │
                 │  │  er VM   │  │  er VM   │  │    VM (sandbox)  │  │
                 │  │  ┌─────┐ │  │  ┌─────┐ │  │  ┌──────────┐   │  │
                 │  │  │envd │ │  │  │envd │ │  │  │   envd   │   │  │
                 │  │  └─────┘ │  │  └─────┘ │  │  └──────────┘   │  │
                 │  └──────────┘  └──────────┘  └──────────────────┘  │
                 │                                                     │
                 │  NBD ◄────── block/overlay ──────── GCS/S3 Template │
                 │  UFFD ◄───── memory snapshot ──────── GCS/S3        │
                 └─────────────────────────────────────────────────────┘
                                     │
SDK 通过 client-proxy ──────────────► envd (port 49983, Connect Protocol)
```

### 关键技术选型

| 层 | 技术 | 选择理由 |
|---|---|---|
| 集群调度 | **Hashicorp Nomad** | 比 K8s 更轻量，适合单一工作负载（VM 管理）|
| 服务发现 | **Consul** | 与 Nomad 原生集成 |
| 虚拟化 | **Firecracker** | AWS 开源的轻量 VMM，毫秒级启动，内存开销极低 |
| 内存快照恢复 | **userfaultfd (UFFD)** | Linux 内核机制，按需页面加载，实现极速 VM 恢复 |
| 块存储 | **NBD (Network Block Device)** | 支持 overlay，沙箱读写层分离，模板共享 |
| 服务通信 | **gRPC (Protobuf)** | orchestrator ↔ API 高性能 RPC |
| 沙箱内通信 | **Connect Protocol** | HTTP/2 + protobuf，envd ↔ SDK 低延迟双向流 |

---

## 核心工作流程

### 1. 沙箱创建流程（Create Sandbox）

```
SDK.create()
  └─► API Service (REST POST /sandboxes)
        └─► 选择 Orchestrator 节点（Consul 服务发现 + 负载均衡）
              └─► gRPC: orchestrator.Create(SandboxCreateRequest)
                    └─► Orchestrator.Server.Create()
                          ├─► 检查节点沙箱上限（Feature Flags 控制）
                          ├─► 分配网络 slot（IP + TAP 设备）
                          ├─► 加载 Template 文件（内核 + rootfs）
                          │     └─► NFS / GCS / 本地缓存 → NBD device
                          ├─► 创建 overlay rootfs（写时复制）
                          ├─► 启动 Firecracker 进程（fc.Process）
                          │     ├─► 配置 vCPU + 内存
                          │     ├─► 挂载 rootfs（NBD 设备）
                          │     ├─► 配置网络（TAP + iptables）
                          │     └─► 启动 VM（KVM）
                          ├─► 等待 envd 就绪（HTTP /init 轮询）
                          └─► 返回 sandbox_id + domain
```

### 2. 沙箱暂停/快照流程（Pause / Snapshot）

这是 E2B 最精妙的设计之一：

```
SDK.pause() / SDK.create_snapshot()
  └─► API ──gRPC──► Orchestrator.Pause()
        └─► 暂停 Firecracker VM（fc.CreateSnapshot）
              ├─► 生成 snapfile（VM 状态/寄存器）
              ├─► 生成 memfile（内存镜像 diff）
              │     └─► build.Diff：只保存变更页面（非全量）
              ├─► 生成 rootfs diff（文件系统变更层）
              └─► 上传到 GCS/S3（templateBuild.Upload）
                    ├─► snapfile → storage
                    ├─► memfile diff → storage（增量！）
                    └─► rootfs diff → storage（增量！）
```

**关键优化**：快照只存 diff（增量），不存全量。恢复时基础层从模板读取，diff 从快照读取，两者 overlay 合并。

### 3. 沙箱恢复流程（Resume）

```
SDK.connect(sandbox_id) 或自动 auto_resume
  └─► API ──gRPC──► Orchestrator.Create(snapshot=true)
        └─► 从存储加载快照文件
              ├─► 加载 snapfile（VM 状态）
              ├─► 配置 UFFD（userfaultfd）内存后端
              │     └─► UFFD 拦截内存访问缺页 → 按需从 memfile 加载
              ├─► Firecracker VM Resume（从快照恢复，毫秒级）
              └─► UFFD 后台 prefetch（预加载热点内存页）
```

**UFFD 加速恢复**：VM 恢复后不等内存全部加载就返回（lazy loading）。首次访问未加载页面时，UFFD 处理缺页中断，从存储按需加载。后台 prefetcher 并发预取，减少后续缺页。

### 4. envd 守护进程

envd 运行在每个 Firecracker VM 内部（port 49983），是 SDK 与沙箱的数据平面接口：

```
envd 启动流程：
  1. 接收 orchestrator 初始化请求（HTTP /init）
     - 设置环境变量
     - 配置 HyperloopIP（到 orchestrator 的内部网络）
     - 设置 access token
  2. 启动 Connect RPC 服务（Filesystem + Process）
  3. 监听来自 SDK 的请求

envd 服务：
  ├── FilesystemService  # 文件读写/目录操作/文件监听（inotify）
  ├── ProcessService     # 命令执行/PTY 终端/进程管理
  └── HTTP API           # 健康检查/文件上传下载
```

### 5. NBD + Overlay 文件系统

```
Template (基础层, 只读)
  ├─ rootfs.ext4   ──────────────────────────────────► NFS / GCS
  └─ kernel                                              ↑
                                                         │ NBD (Network Block Device)
Sandbox (读写层, Copy-on-Write)                          │
  └─ overlay diff  ── 写入变更页面 ─────────────────────►│
                                                         │
Firecracker VM 看到:  base + overlay = 完整 rootfs ◄────►│
```

---

## 部署架构（自托管）

### 前提条件

- **Terraform v1.5.7**（注意：1.6+ 改了 License，须用 MPL 版本）
- Packer（构建 Nomad 节点磁盘镜像）
- Cloudflare 账号 + 域名
- PostgreSQL（推荐 Supabase）
- GCP 项目（或 AWS 账号）

### 核心基础设施组件

```
Nomad 集群 (orchestrator 节点):
  ├── job-orchestrator    # 沙箱编排器（每个节点一个）
  ├── job-api             # REST API（多副本）
  ├── job-client-proxy    # 客户端流量代理
  ├── job-template-manager # 模板构建
  ├── job-ingress         # 入口（Nginx/Traefik）
  ├── job-redis           # Redis（网络 slot 分配/协调）
  ├── job-clickhouse      # ClickHouse（指标存储）
  ├── job-loki            # Loki（日志聚合）
  └── job-otel-collector  # OpenTelemetry（追踪）

存储:
  ├── GCS/S3              # 模板文件 + 快照 diff
  └── PostgreSQL          # 元数据（用户/团队/模板/沙箱）
```

### GCP 部署步骤（概要）

```bash
# 1. 创建 GCP 项目，确保配额充足（2500G SSD, 24 vCPUs）
# 2. 配置环境变量
cp .env.template .env.prod
# 填写：PROJECT_ID, POSTGRES_URL, CLOUDFLARE_ZONE_ID 等

# 3. 设置环境 + 登录
make set-env ENV=prod
make provider-login

# 4. 初始化 Terraform（可能需要运行两次）
make init

# 5. 构建并上传 Firecracker 内核 + rootfs 镜像
make build-and-upload
make copy-public-builds

# 6. 在 GCP Secret Manager 添加密钥值
# - e2b-cloudflare-api-token
# - e2b-postgres-connection-string

# 7. 分两阶段部署（等待 TLS 证书签发）
make plan-without-jobs && make apply
make plan && make apply

# 8. 初始化集群数据
cd packages/shared && make prep-cluster
```

---

## Demo：理解沙箱启动时序

E2B infra 本身不提供直接可运行的 demo（需要完整云基础设施），但以下代码展示了 **orchestrator gRPC 接口**的核心调用逻辑：

```go
// 这是 API Service 调用 Orchestrator 的核心 gRPC 调用
// packages/api/internal/orchestrator/client.go

// 1. 创建沙箱（调用任意可用 orchestrator 节点）
resp, err := orchestratorClient.Create(ctx, &orchestrator.SandboxCreateRequest{
    Sandbox: &orchestrator.SandboxConfig{
        SandboxId:   sandboxId,
        TemplateId:  templateId,
        BuildId:     buildId,
        TeamId:      teamId,
        Vcpu:        2,
        MemoryMb:    512,
        // 快照恢复：设置 Snapshot = true + SnapshotId
        Snapshot:    false,
    },
})

// 2. 暂停沙箱（保存快照）
_, err = orchestratorClient.Pause(ctx, &orchestrator.SandboxPauseRequest{
    SandboxId: sandboxId,
    SnapshotId: newSnapshotId,
})

// 3. 从快照恢复（Snapshot=true）
resp, err = orchestratorClient.Create(ctx, &orchestrator.SandboxCreateRequest{
    Sandbox: &orchestrator.SandboxConfig{
        SandboxId:  sandboxId,
        SnapshotId: snapshotId,
        Snapshot:   true,  // 标记为从快照恢复
    },
})
```

---

## 关键发现 / 学习心得

### 1. Firecracker + UFFD = 沙箱快速冷启动的核心秘密

E2B 能做到"秒级"启动沙箱，背后组合拳：
- **Firecracker**：亚秒级 microVM 启动（vs Docker 的秒级，vs 完整 VM 的分钟级）
- **快照 + UFFD**：不等内存全部加载，VM 立即恢复。内存页懒加载 + 后台 prefetch

这和 AWS Lambda 的实现思路相同（Firecracker 就是 AWS Lambda 团队开源的）。

### 2. Nomad 而非 Kubernetes 的选择

选 Nomad 不是随意的。K8s 以 Pod/容器为调度单位，调度 Firecracker VM 需要特殊处理。Nomad 的任务驱动模型更灵活，可以直接以 raw_exec + 二进制的方式运行 Firecracker 进程，不需要在容器里套 VM（DinD 那种嵌套虚拟化问题）。

### 3. 增量 Diff 快照设计

快照不是全量备份，而是 **diff（增量）**：
- `memfile diff`：只保存自基础模板以来变化的内存页
- `rootfs diff`：只保存文件系统变化块

恢复时：base（模板 NFS/GCS）+ diff（快照存储）= 完整状态

这让快照文件极小，上传/下载快，存储成本低。

### 4. Template Peer-to-Peer 分发

`packages/orchestrator/pkg/sandbox/template/peerclient` + `peerserver` 实现了节点间的 P2P 模板文件分发。新节点不需要全从 GCS 下载，可以从同集群其他已有缓存的节点流式拉取 — 减少存储带宽，加速冷启动。

### 5. cgroup v2 资源隔离

`packages/orchestrator/pkg/sandbox/cgroup` 实现了每个沙箱独立的 cgroup 配置，控制 CPU/内存配额。在 Firecracker VM 之上再加一层 cgroup，防止 VM 逃逸或异常消耗宿主资源。

### 6. 与 E2B SDK 的关系总结

```
用户代码
  └─► e2b Python/JS SDK
        ├─► REST API ──► packages/api（控制平面）
        │                  └─► gRPC ──► packages/orchestrator（编排 Firecracker）
        └─► Connect Protocol ──► packages/client-proxy
                                   └─► packages/envd（VM 内守护进程）
```

SDK 是用户接口，infra 是执行引擎。SDK 的每一个 `sandbox.files.write()` 都通过 Connect Protocol → client-proxy → envd → Linux 文件系统写入 Firecracker VM。

---

## 参考资源

- E2B 自托管指南：[self-host.md](https://github.com/e2b-dev/infra/blob/main/self-host.md)
- Firecracker VMM：https://github.com/firecracker-microvm/firecracker
- userfaultfd 原理：https://www.kernel.org/doc/html/latest/admin-guide/mm/userfaultfd.html
- Nomad 文档：https://developer.hashicorp.com/nomad/docs
- E2B Dashboard（前端）：https://github.com/e2b-dev/dashboard
- E2B SDK 笔记：[E2B.md](./E2B.md)
