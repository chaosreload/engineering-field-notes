# zeroboot Getting Started

> 整理日期：2026-03-22
> 仓库地址：https://github.com/zerobootdev/zeroboot

## 项目简介

zeroboot 是一个**亚毫秒级 VM 沙箱引擎**，专为 AI Agent 代码执行设计。

**核心创新**：利用 Linux `mmap(MAP_PRIVATE)` 的 Copy-on-Write 特性，从 Firecracker VM 快照 fork 出新虚拟机，把传统的 150-300ms 冷启动压缩到 **0.8ms**。每个 sandbox 是真正的 KVM 虚拟机（硬件级隔离），不是容器或 seccomp sandbox。

**解决的问题**：AI Agent 需要频繁、高并发地执行用户生成的代码。E2B 等现有方案启动太慢（150ms+），成本高。zeroboot 以极低延迟和内存占用（~265KB/sandbox）实现大规模并发代码执行。

---

## 项目结构

```
zeroboot/
├── src/
│   ├── main.rs                 # CLI 入口：template/serve/bench/test-exec 4个命令
│   ├── api/
│   │   ├── mod.rs              # axum 路由注册
│   │   └── handlers.rs         # HTTP 处理器：exec/batch/health/metrics + 认证 + 限流
│   └── vmm/
│       ├── kvm.rs              # 核心 Fork Engine：KVM VM 创建 + CoW mmap + CPU state 恢复
│       ├── vmstate.rs          # Firecracker vmstate 二进制解析（auto-detect offset）
│       ├── firecracker.rs      # Template 创建：调 Firecracker API 启动 VM + 拍快照
│       ├── serial.rs           # 16550 UART 仿真：Host↔Guest 通信
│       └── mod.rs
├── guest/
│   └── init.c                  # Guest Agent：C 语言 PID 1，监听 serial，执行命令
├── sdk/
│   ├── python/                 # Python SDK（零依赖）
│   └── node/                   # TypeScript SDK（零依赖，用 fetch）
├── demo/
│   └── agent.py               # AI Agent Demo：Claude + zeroboot 并行执行
├── deploy/
│   ├── deploy.sh               # 部署脚本
│   ├── zeroboot.service        # systemd 单元文件
│   └── grafana-dashboard.json  # Grafana 监控面板
└── docs/
    ├── ARCHITECTURE.md
    ├── API.md
    └── DEPLOYMENT.md
```

---

## 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│  AI Agent / 客户端                                          │
│  POST /v1/exec  {"code": "import numpy..."}                 │
└──────────────────────┬──────────────────────────────────────┘
                       │ Bearer Token 认证（100 req/s 限流）
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  API Server（axum + tokio，Rust）                           │
│  handlers.rs：exec / batch / health / metrics               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Fork Engine（kvm.rs）                                      │
│                                                             │
│  启动时（一次性）:                                          │
│  Firecracker 冷启动 VM → 预加载 Python/numpy → 拍快照       │
│  → snapshot/mem（内存镜像）+ snapshot/vmstate（CPU状态）    │
│  → 创建 memfd（anonymous memory file，CoW 源）              │
│                                                             │
│  每次请求（~0.8ms）:                                        │
│  KVM_CREATE_VM                                              │
│    → KVM_CREATE_IRQCHIP + KVM_CREATE_PIT2                   │
│    → 从快照恢复 IOAPIC redirect table                       │
│    → mmap(MAP_PRIVATE) on memfd  ← CoW 魔法在这里          │
│    → set_user_memory_region（注册为 guest 物理内存）         │
│    → 恢复 CPU 状态（顺序严格）:                             │
│       sregs → XCRS → XSAVE → regs → LAPIC → MSRs → MP_STATE│
│    → vCPU 开始运行（guest 从快照断点处恢复执行）            │
└────────────┬────────────────────────────────────────────────┘
             │  Serial I/O（16550 UART 仿真）
             │  发送代码 → 等待 "ZEROBOOT_DONE" 标记
             ▼
┌─────────────────────────────────────────────────────────────┐
│  Guest VM（KVM 虚拟机，硬件隔离）                           │
│                                                             │
│  Guest Agent（init.c，C语言 PID 1）:                       │
│  监听 /dev/ttyS0（serial）→ 读命令 → 执行 → 输出结果       │
│  → 打印 "ZEROBOOT_DONE" 标记                               │
│                                                             │
│  写入任何内存页 → 触发 CoW page fault → 私有页             │
│  其他 fork 的内存完全独立，互不可见                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心工作流程

### 1. Template 创建（一次性，~15秒）

```bash
zeroboot template <kernel> <rootfs> <workdir>
```

内部流程：
1. 通过 Firecracker API 启动一个微型 VM
2. VM 内预加载 Python 解释器 + numpy + pandas 等库
3. 等待 guest 完成初始化（Python import 等耗时操作完成）
4. 调用 Firecracker 快照 API，保存：
   - `snapshot/mem`：完整内存镜像（~256MB）
   - `snapshot/vmstate`：CPU 所有寄存器状态（CPUID、sregs、xcrs、xsave、regs、LAPIC、MSRs、IOAPIC）
5. 把内存镜像载入 `memfd`（匿名内存文件，支持 CoW mmap）

### 2. Fork 请求（每次 ~0.8ms）

```
收到 POST /v1/exec
  → API Key 验证 + 限流检查
  → ForkedVm::fork_cow(snapshot, memfd)
      → KVM_CREATE_VM（2μs）
      → 恢复 IOAPIC（从快照覆盖 redirect table）
      → mmap(MAP_PRIVATE, MAP_NORESERVE, fd=memfd)（<1μs，lazy allocation）
        ← 此时 256MB 虚拟内存映射完成，物理内存 ~0KB
      → set_user_memory_region（注册为 guest 物理内存）
      → set_cpuid2（从快照恢复，保证 XSAVE 布局一致）
      → set_sregs / set_xcrs / set_xsave / set_regs / set_lapic / set_msrs（严格顺序）
      → set_mp_state(RUNNABLE)  ← vCPU 就绪
  → 通过 Serial 发送代码到 guest
  → 运行 vCPU 直到收到 "ZEROBOOT_DONE" 标记
  → 收集 stdout/stderr，返回响应
  → Drop ForkedVm → munmap 释放 CoW 内存
```

### 3. 内存隔离验证

每个 fork 的写操作触发 CoW page fault，OS 分配私有物理页。其他 fork 仍然看到快照原始数据。**Benchmark 中有 Phase 5 显式验证**：Fork A 写入 `0xDEADBEEF_CAFEBABE`，Fork B 读取同一地址应读到快照原始值，不是 Fork A 写入的值。

---

## 部署步骤

### 前提条件

- Linux + KVM（Intel VT-x 或 AMD-V）
- Rust 1.70+
- Firecracker 二进制（用于 template 创建）

```bash
# 1. 编译
git clone https://github.com/zerobootdev/zeroboot
cd zeroboot
cargo build --release

# 2. 准备 kernel 和 rootfs（Firecracker 格式）
# 参考 docs/DEPLOYMENT.md

# 3. 创建 template（~15秒）
./target/release/zeroboot template \
  vmlinux-5.10 \
  rootfs-python.ext4 \
  ./workdir-python

# 4. 启动服务
./target/release/zeroboot serve ./workdir-python 8080

# 5. 或者多语言模板
./target/release/zeroboot serve "python:./workdir-python,node:./workdir-node" 8080
```

### 配置 API Keys

```json
// api_keys.json
["zb_live_key1", "zb_live_key2"]
```

```bash
export ZEROBOOT_API_KEYS_FILE=./api_keys.json
```

### 使用 Managed API（无需自托管）

```bash
# 有免费 demo key 可以直接试
curl -X POST https://api.zeroboot.dev/v1/exec \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer zb_demo_hn2026' \
  -d '{"code":"import numpy as np; print(np.random.rand(3))"}'
```

---

## Demo 示例

### Python SDK

```python
from zeroboot import Sandbox

sb = Sandbox("zb_live_your_key")

# 单次执行
result = sb.run("print(1 + 1)")
print(result.stdout)  # "2\n"
print(f"fork: {result.fork_time_ms}ms, exec: {result.exec_time_ms}ms")

# 并行执行（每个独立隔离 VM）
results = sb.run_batch([
    "import numpy as np; print(np.mean([1,2,3]))",
    "print(sum(range(100)))",
])
```

### TypeScript SDK

```typescript
import { Sandbox } from "@zeroboot/sdk";
const result = await new Sandbox("zb_live_your_key").run("console.log(1+1)");
```

### AI Agent Demo（Claude + zeroboot）

`demo/agent.py` 展示了 AI Agent 使用 zeroboot 并行执行代码的完整场景：Claude 调用 `run_parallel` tool，在 5 个独立 VM 中同时执行 5 种不同算法，全部在 ~10ms 内完成并返回结果。

---

## 关键发现 / 学习心得

### 1. CPU State 恢复顺序是硬约束

必须严格按照 `sregs → XCRS → XSAVE → regs → LAPIC → MSRs → MP_STATE` 顺序：
- `XCRS` 依赖 `sregs.cr4` 中的 `OSXSAVE` bit 已设置
- `XSAVE`（FPU/SSE/AVX 状态）依赖 `XCRS` 已设置
- `MP_STATE` 必须最后设置，否则 vCPU 状态不对

### 2. IOAPIC 恢复不能 zero-init

必须先 `KVM_GET_IRQCHIP` 获取 KVM 初始化好的 IOAPIC 状态，再只覆盖 redirect table entries，然后 `KVM_SET_IRQCHIP`。如果直接 zero-init 会损坏其他 irqchip 状态，导致中断路由失效。

### 3. CPUID 必须从快照恢复

不能用宿主机的 CPUID，要用 Firecracker 快照里的 CPUID。原因：numpy 在 fork 快照里已经做过 SIMD feature detection，如果 KVM 呈现不同 CPUID，XSAVE 布局就对不上，会 SIGILL。

### 4. Guest 通信只有 Serial I/O

为了极致简化，guest 和 host 只通过 16550 UART serial 通信。没有 virtio-net，没有文件系统挂载（代码通过 serial 发送），用 `ZEROBOOT_DONE` 作为执行完成标记。这是 latency 低的关键之一。

### 5. `MAP_NORESERVE` 是内存效率的关键

`mmap(MAP_PRIVATE | MAP_NORESERVE)` 的 `MAP_NORESERVE` 意味着不预先 reserve swap 空间。256MB 的 guest 内存，实际 RSS 只有 ~265KB，因为大部分页面根本没被访问（或者和快照共享），只有实际写入的页面才分配物理内存。

### 6. vmstate 解析用锚点定位

Firecracker 的 vmstate 是二进制 blob，不同版本 offset 不同。解析器用 IOAPIC base address（`0xFEC00000`）作为锚点自动定位字段，而不是硬编码 offset——这是工程上的正确做法。

---

## 参考资源

- GitHub: https://github.com/zerobootdev/zeroboot
- API 文档: https://github.com/zerobootdev/zeroboot/blob/main/docs/API.md
- 架构文档: https://github.com/zerobootdev/zeroboot/blob/main/docs/ARCHITECTURE.md
- 部署文档: https://github.com/zerobootdev/zeroboot/blob/main/docs/DEPLOYMENT.md
- Firecracker snapshot 文档: https://github.com/firecracker-microvm/firecracker/blob/main/docs/snapshotting/
- 对标竞品 E2B: https://e2b.dev
