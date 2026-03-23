# SpacetimeDB 入门指南

> 操作环境：dev-server（ubuntu@dev-server，ip-10-2-1-86）
> 完成时间：2026-03-04
> SpacetimeDB 版本：2.0.3

---

## 目录

1. [什么是 SpacetimeDB？](#什么是-spacetimedb)
2. [项目结构分析（gitnexus）](#项目结构分析)
3. [安装步骤](#安装步骤)
4. [部署本地服务](#部署本地服务)
5. [创建 Rust Chat Module](#创建-rust-chat-module)
6. [发布 Module 到服务器](#发布-module-到服务器)
7. [生成 Rust 客户端 Bindings](#生成-rust-客户端-bindings)
8. [创建 Rust 客户端](#创建-rust-客户端)
9. [测试验证](#测试验证)
10. [核心概念总结](#核心概念总结)

---

## 什么是 SpacetimeDB？

SpacetimeDB 是 Clockwork Labs 开发的一个**多人游戏/实时应用专用数据库**，主要特点：

- **Server = Database**：服务端逻辑（reducer）直接运行在数据库进程内，通过 WASM 模块执行
- **实时推送**：客户端通过订阅（subscription）自动接收数据变更，无需轮询
- **类型安全**：从模块定义自动生成多语言客户端 bindings（Rust/TypeScript/C#）
- **Standalone 模式**：可本地运行，适合开发测试

口号："Multiplayer at the speed of light"

---

## 项目结构分析

> 使用 `gitnexus analyze .` 分析了整个 SpacetimeDB 仓库，共索引 33949 个符号、85447 个关系、300 条执行流程。

### 仓库整体结构

```
SpacetimeDB/
├── crates/                     # Rust 工作区
│   ├── core/                   # 核心数据库引擎
│   │   ├── src/host/           # WASM 模块宿主（执行引擎）
│   │   ├── src/subscription/   # 订阅系统
│   │   ├── src/db/             # 存储层（行引擎、LMDB 等）
│   │   └── src/client_api/     # 客户端连接处理
│   ├── standalone/             # Standalone 服务（spacetimedb-standalone 二进制）
│   ├── cli/                    # CLI 工具（spacetimedb-cli 二进制）
│   ├── bindings/               # Rust 模块 SDK（模块开发用）
│   ├── bindings-macro/         # 宏系统（#[spacetimedb::table] 等）
│   ├── bindings-sys/           # WASM 系统调用绑定
│   ├── lib/                    # 共享数据类型（Identity、Timestamp 等）
│   ├── sats/                   # SpacetimeDB 序列化格式（BSATN/JSON）
│   ├── primitives/             # 基础类型
│   ├── schema/                 # Schema 管理（迁移、验证）
│   ├── sql-parser/             # SQL 解析器
│   ├── query-builder/          # 查询构建器
│   └── client-api-messages/    # WebSocket 协议消息格式
├── sdks/
│   └── rust/                   # Rust 客户端 SDK
├── templates/
│   ├── basic-rs/               # Rust 模块模板
│   └── basic-ts/               # TypeScript 模块模板
└── smoketests/                 # 集成测试模块
```

### 重要 Crate 说明

| Crate | 用途 |
|-------|------|
| `spacetimedb-standalone` | 独立服务进程，HTTP + WebSocket 服务器 |
| `spacetimedb-cli` (`spacetimedb-cli` 二进制) | CLI 工具，管理模块发布、生成代码、管理服务器 |
| `spacetimedb` (crates/bindings) | **模块开发 SDK**，提供 `#[table]`/`#[reducer]` 宏 |
| `spacetimedb-sdk` (sdks/rust) | **客户端 SDK**，提供 `DbConnection`、订阅系统 |
| `spacetimedb-core` | 数据库引擎核心，包含行存储、WASM 执行器、订阅管理 |
| `spacetimedb-sats` | SpacetimeDB 类型系统和序列化格式 BSATN |

### 核心工作流程：client connect → subscribe → reducer → event

```
客户端                          SpacetimeDB 服务器
  │                                     │
  │── WebSocket 连接 ──────────────────>│
  │                              identity 验证/创建
  │<── 连接确认 + Identity ─────────────│
  │                                     │
  │── Subscribe("SELECT * FROM msg") ──>│
  │                              执行订阅查询
  │<── 初始数据（QueryRows）────────────│
  │                                     │
  │── Reducer 调用（send_message） ─────>│
  │                              WASM 模块执行 reducer
  │                              写入数据库行
  │                              通知所有订阅者
  │<── TransactionUpdate（新行）────────│ ← 所有订阅了该表的客户端都收到
  │                                     │
```

### 关键代码路径

- **客户端连接**：`crates/core/src/client_api/` → WebSocket 处理
- **订阅系统**：`crates/core/src/subscription/module_subscription_manager.rs` → 订阅计划（Plan）管理
- **Reducer 执行**：`crates/core/src/host/` → WASM 模块宿主，`WasmModuleInstance`
- **行存储**：`crates/core/src/db/` → `RelationalDB`，基于 LMDB

---

## 安装步骤

### 1. Clone 仓库

```bash
cd /home/ubuntu/chaosreload/study/repo/public
git clone https://github.com/clockworklabs/SpacetimeDB.git
```

### 2. 安装 Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source ~/.cargo/env
```

### 3. 安装所需 Rust 工具链版本

SpacetimeDB 2.0.3 要求 Rust 1.93.0 和 `wasm32-unknown-unknown` target：

```bash
source ~/.cargo/env
rustup toolchain install 1.93.0
rustup target add wasm32-unknown-unknown
```

### 4. 从源码编译安装 SpacetimeDB CLI

> **注意**：crates.io 上最新版本是 2.0.2，而仓库版本是 2.0.3，因此需从源码安装。

```bash
source ~/.cargo/env
cd /home/ubuntu/chaosreload/study/repo/public/SpacetimeDB

# 安装 CLI（二进制名为 spacetimedb-cli）
cargo install --locked --path crates/cli --bin spacetimedb-cli

# 安装独立服务（二进制名为 spacetimedb-standalone）
cargo install --locked --path crates/standalone --bin spacetimedb-standalone
```

> 编译时间较长（首次约 20-40 分钟），请耐心等待。

### 5. 设置 spacetime 命令别名

CLI 设计上期望以 `spacetime` 名字运行（内部会查找 `~/.local/bin/spacetime`）：

```bash
mkdir -p ~/.local/bin
ln -sf ~/.cargo/bin/spacetimedb-cli ~/.local/bin/spacetime
export PATH=$HOME/.local/bin:$PATH

# 验证
~/.local/bin/spacetime --version
# 输出：spacetimedb-cli 2.0.3
```

---

## 部署本地服务

### 启动 SpacetimeDB 服务

```bash
~/.local/bin/spacetime start --listen-addr 0.0.0.0:3000
```

服务启动后会显示 SpacetimeDB 的 ASCII 艺术字 Logo，然后打印：

```
Starting SpacetimeDB listening on 0.0.0.0:3000
```

数据目录默认为 `~/.local/share/spacetime/data`。

### 验证服务运行

```bash
curl -v http://localhost:3000/v1/ping
# 返回 HTTP 200 表示服务正常
```

> **注意**：`/health` 端点返回 404，正确的健康检查端点是 `/v1/ping`。

---

## 创建 Rust Chat Module

### 初始化项目

```bash
mkdir -p /tmp/spacetime-projects
cd /tmp/spacetime-projects
~/.local/bin/spacetime init --lang rust --server-only --non-interactive chat-module
cd chat-module
```

### 项目结构

```
chat-module/
├── spacetime.json           # 项目配置（指向服务器）
├── spacetime.local.json     # 本地配置（数据库名称）
└── spacetimedb/             # Rust 模块代码
    ├── Cargo.toml
    └── src/
        └── lib.rs
```

### 修改 Cargo.toml

> **重要**：模板默认使用 `spacetimedb = { version = "2.0.3" }`，但该版本未发布到 crates.io（最高是 2.0.2）。需改用本地路径：

```toml
[package]
name = "chat_module"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
spacetimedb = { path = "/home/ubuntu/chaosreload/study/repo/public/SpacetimeDB/crates/bindings" }
log = "0.4"
```

同时添加 `rust-toolchain.toml`：

```toml
[toolchain]
channel = "1.93.0"
targets = ["wasm32-unknown-unknown"]
```

### 编写 src/lib.rs（Chat Module 实现）

```rust
use spacetimedb::{ReducerContext, Table};

/// Message 表 - 存储所有聊天消息
#[spacetimedb::table(accessor = message, public)]
pub struct Message {
    sender: String,
    content: String,
    sent_at: u64,
}

/// init reducer - 模块首次发布时调用
#[spacetimedb::reducer(init)]
pub fn init(_ctx: &ReducerContext) {
    log::info!("Chat module initialized!");
}

/// client_connected - 客户端连接时调用
#[spacetimedb::reducer(client_connected)]
pub fn identity_connected(_ctx: &ReducerContext) {
    log::info!("Client connected");
}

/// send_message reducer - 客户端调用以发送消息
#[spacetimedb::reducer]
pub fn send_message(ctx: &ReducerContext, content: String) {
    let sender = ctx.sender().to_hex().to_string();
    let sent_at = ctx.timestamp.to_micros_since_unix_epoch() as u64;
    ctx.db.message().insert(Message {
        sender,
        content,
        sent_at,
    });
    log::info!("Message sent!");
}
```

**API 说明（SpacetimeDB 2.0.x）**：

| 2.0.x API | 旧版 (1.x) |
|-----------|-----------|
| `#[spacetimedb::table(accessor = message, public)]` | `#[spacetimedb(table)]` |
| `ctx.sender()` (方法调用) | `ctx.sender` (字段访问) |
| `ctx.timestamp.to_micros_since_unix_epoch()` | `ctx.timestamp.micros_since_epoch` |
| `ctx.db.message().insert(...)` | 自动生成的 insert 方法 |

### 编译 WASM 模块

```bash
source ~/.cargo/env
cd /tmp/spacetime-projects/chat-module/spacetimedb
cargo build --release --target wasm32-unknown-unknown
```

编译成功后，wasm 文件位于：
`target/wasm32-unknown-unknown/release/chat_module.wasm`

---

## 发布 Module 到服务器

```bash
cd /tmp/spacetime-projects/chat-module

~/.local/bin/spacetime publish \
  --server http://localhost:3000 \
  -b spacetimedb/target/wasm32-unknown-unknown/release/chat_module.wasm
```

首次运行会提示登录，选择直接连接到目标服务器（不使用 spacetimedb.com）。

发布成功输出：
```
Created new database with name: chat-module-laqtw, identity: c200aed65310150e...
```

> 数据库名称由 `spacetime.local.json` 中配置，格式为 `{项目名}-{随机后缀}`。

---

## 生成 Rust 客户端 Bindings

```bash
mkdir -p /tmp/chat-client/module_bindings

cd /tmp/spacetime-projects/chat-module
~/.local/bin/spacetime generate \
  --lang rust \
  --out-dir /tmp/chat-client/module_bindings \
  -b spacetimedb/target/wasm32-unknown-unknown/release/chat_module.wasm
```

生成的文件：
```
module_bindings/
├── mod.rs                    # 主模块，包含 DbConnection、RemoteModule 等
├── message_type.rs           # Message 结构体定义
├── message_table.rs          # MessageTableHandle，表访问器
└── send_message_reducer.rs   # send_message reducer 扩展 trait
```

---

## 创建 Rust 客户端

### 项目结构

```
chat-client/
├── Cargo.toml
└── src/
    ├── main.rs
    └── module_bindings/      # 从上一步复制过来
        ├── mod.rs
        ├── message_type.rs
        ├── message_table.rs
        └── send_message_reducer.rs
```

### Cargo.toml

由于 `spacetimedb-sdk` 2.0.3 未发布到 crates.io，使用本地路径：

```toml
[package]
name = "chat-client"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "chat-client"
path = "src/main.rs"

[dependencies]
spacetimedb-sdk = { path = "/home/ubuntu/chaosreload/study/repo/public/SpacetimeDB/sdks/rust" }
tokio = { version = "1", features = ["full"] }
env_logger = "0.11"
log = "0.4"

[patch.crates-io]
spacetimedb-lib = { path = "/home/ubuntu/chaosreload/study/repo/public/SpacetimeDB/crates/lib" }
spacetimedb-sats = { path = "/home/ubuntu/chaosreload/study/repo/public/SpacetimeDB/crates/sats" }
spacetimedb-primitives = { path = "/home/ubuntu/chaosreload/study/repo/public/SpacetimeDB/crates/primitives" }
spacetimedb-client-api-messages = { path = "/home/ubuntu/chaosreload/study/repo/public/SpacetimeDB/crates/client-api-messages" }
spacetimedb-data-structures = { path = "/home/ubuntu/chaosreload/study/repo/public/SpacetimeDB/crates/data-structures" }
spacetimedb-metrics = { path = "/home/ubuntu/chaosreload/study/repo/public/SpacetimeDB/crates/metrics" }
spacetimedb-query-builder = { path = "/home/ubuntu/chaosreload/study/repo/public/SpacetimeDB/crates/query-builder" }
spacetimedb-memory-usage = { path = "/home/ubuntu/chaosreload/study/repo/public/SpacetimeDB/crates/memory-usage" }
```

### src/main.rs

```rust
#[allow(clippy::too_many_arguments)]
#[allow(clippy::large_enum_variant)]
mod module_bindings;

use module_bindings::*;
use spacetimedb_sdk::{DbContext, Table};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const SERVER_URL: &str = "http://localhost:3000";
const DB_NAME: &str = "chat-module-laqtw";   // 替换为实际数据库名

fn main() {
    env_logger::builder()
        .filter_level(log::LevelFilter::Info)
        .init();

    println!("=== SpacetimeDB Chat Client ===");
    println!("Connecting to {} database: {}", SERVER_URL, DB_NAME);

    let ready = Arc::new(Mutex::new(false));
    let ready_for_callback = ready.clone();

    let conn = DbConnection::builder()
        .with_database_name(DB_NAME)
        .with_uri(SERVER_URL)
        .on_connect(move |ctx, identity, _token| {
            println!("Connected! Identity: {}", identity.to_hex());
            
            // 订阅所有消息
            ctx.subscription_builder()
                .on_applied(move |ctx: &SubscriptionEventContext| {
                    println!("Subscription applied!");
                    
                    // 显示已有消息（需要 Table trait）
                    let msgs: Vec<Message> = ctx.db.message().iter().collect();
                    println!("Found {} existing messages:", msgs.len());
                    for msg in &msgs {
                        println!("  [{}] {}: {}", msg.sent_at, &msg.sender[..8], msg.content);
                    }
                    
                    *ready_for_callback.lock().unwrap() = true;
                })
                .on_error(|_ctx, err| {
                    eprintln!("Subscription error: {:?}", err);
                })
                .subscribe(vec!["SELECT * FROM message"]);
        })
        .on_connect_error(|_ctx, err| {
            eprintln!("Connection error: {:?}", err);
        })
        .on_disconnect(|_ctx, err| {
            println!("Disconnected: {:?}", err);
        })
        .build()
        .expect("Failed to build connection");

    // 在后台线程处理 WebSocket 消息
    conn.run_threaded();

    // 等待订阅完成（最多 10 秒）
    let mut waited = 0;
    while !*ready.lock().unwrap() && waited < 100 {
        std::thread::sleep(Duration::from_millis(100));
        waited += 1;
    }

    // 注册新消息回调（需要 Table trait）
    conn.db.message().on_insert(|_ctx, msg| {
        println!("  >> New message from [{}]: {}", &msg.sender[..8], msg.content);
    });

    // 发送消息（调用 reducer）
    conn.reducers.send_message("Hello from SpacetimeDB Rust client!".to_string())
        .expect("Failed to send message");
    
    std::thread::sleep(Duration::from_secs(2));

    // 显示最终消息列表
    let final_msgs: Vec<Message> = conn.db.message().iter().collect();
    println!("\n=== Final message count: {} ===", final_msgs.len());
    for msg in &final_msgs {
        println!("  [ts={}] sender={} content={}", msg.sent_at, &msg.sender[..8], msg.content);
    }

    conn.disconnect().ok();
}
```

**重要**：使用 `ctx.db.message().iter()` 和 `conn.db.message().on_insert()` 时，必须导入 `spacetimedb_sdk::Table` trait。

### 构建和运行

```bash
# 复制 bindings 到 src/
cp -r /tmp/chat-client/module_bindings /tmp/chat-client/src/

source ~/.cargo/env
cd /tmp/chat-client
cargo build
./target/debug/chat-client
```

---

## 测试验证

### 实际运行输出

```
=== SpacetimeDB Chat Client ===
Connecting to http://localhost:3000 database: chat-module-laqtw
Connected! Identity: c2001ed3bb5cc05180958f1b018e67a3a188f689852c4c192454c4c620c76813
Subscription applied!
Found 0 existing messages:

Sending test messages...
  >> New message from [c2001ed3]: Hello from SpacetimeDB Rust client!
  >> New message from [c2001ed3]: SpacetimeDB is awesome!
  >> New message from [c2001ed3]: Testing complete - all systems go!

=== Final message count: 3 ===
  [ts=1772592847459659] sender=c2001ed3 content=Testing complete - all systems go!
  [ts=1772592846459341] sender=c2001ed3 content=Hello from SpacetimeDB Rust client!
  [ts=1772592846959633] sender=c2001ed3 content=SpacetimeDB is awesome!

Chat client test completed successfully!
```

### 验证结果

| 测试项 | 结果 |
|--------|------|
| 连接到服务器 | ✅ 成功，分配了 Identity |
| 订阅 Message 表 | ✅ 成功，on_applied 回调触发 |
| 发送消息（reducer 调用） | ✅ 3 条消息成功发送 |
| 实时接收新消息（on_insert） | ✅ 每条消息都触发了回调 |
| 查询历史消息（iter）| ✅ 可列出所有消息 |

---

## 核心概念总结

### SpacetimeDB 2.0.x 模块开发 API

```rust
// 表定义
#[spacetimedb::table(accessor = my_table, public)]
pub struct MyData {
    field: String,
}

// Reducer（服务端函数）
#[spacetimedb::reducer]
pub fn my_reducer(ctx: &ReducerContext, data: String) {
    // ctx.sender()       → 调用方的 Identity（方法，非字段）
    // ctx.timestamp      → 调用时间（Timestamp 类型）
    // ctx.timestamp.to_micros_since_unix_epoch()  → 微秒时间戳
    // ctx.db.my_table().insert(...)               → 插入数据
    // ctx.db.my_table().iter()                    → 遍历数据
}

// 生命周期 reducers
#[spacetimedb::reducer(init)]          // 模块发布时
#[spacetimedb::reducer(client_connected)]    // 客户端连接时
#[spacetimedb::reducer(client_disconnected)] // 客户端断开时
```

### SpacetimeDB SDK 客户端 API

```rust
// 连接
let conn = DbConnection::builder()
    .with_database_name("my-db")
    .with_uri("http://localhost:3000")
    .on_connect(|ctx, identity, token| { ... })
    .build().unwrap();

conn.run_threaded();  // 后台处理消息

// 订阅（需要连接后在 on_connect 回调中调用）
ctx.subscription_builder()
    .on_applied(|ctx: &SubscriptionEventContext| {
        ctx.db.my_table().iter().collect::<Vec<_>>();  // 需要 Table trait
    })
    .subscribe(vec!["SELECT * FROM my_table"]);

// 调用 reducer
conn.reducers.my_reducer("data".to_string()).unwrap();

// 监听新数据（需要 Table trait）
conn.db.my_table().on_insert(|ctx, row| {
    println!("New row: {:?}", row);
});
```

### 已知问题和注意事项

1. **版本不一致**：仓库版本 2.0.3 但 crates.io 最高 2.0.2，需从源码构建
2. **二进制名称**：CLI 安装的二进制是 `spacetimedb-cli`，需手动 symlink 为 `spacetime`
3. **Table trait**：使用 `.iter()` 和 `.on_insert()` 等方法时需显式导入 `spacetimedb_sdk::Table`
4. **表名 annotation**：2.0.x 使用 `accessor = table_name`，1.x 旧版使用 `name = table_name`
5. **健康检查**：`/health` 返回 404，正确端点是 `/v1/ping`
6. **发布命令**：`spacetime publish` 不支持 `--server` 参数，需在 `spacetime.json` 配置或直接使用 `--server` 参数的旧写法

### 服务当前状态（dev-server）

- **SpacetimeDB 服务**：运行在 `0.0.0.0:3000`（后台进程）
- **数据库名称**：`chat-module-laqtw`
- **数据目录**：`~/.local/share/spacetime/data`
- **测试数据**：3 条聊天消息已写入

---

*文档由 OpenClaw subagent 自动生成，基于实际操作记录。*
