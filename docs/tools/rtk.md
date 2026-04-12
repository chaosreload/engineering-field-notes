# RTK (Rust Token Killer) Getting Started

> 整理日期：2026-04-11
> 仓库地址：https://github.com/rtk-ai/rtk
> Stars: 快速增长中 | License: MIT | Language: Rust

## 项目简介

RTK 是一个用 Rust 编写的高性能 CLI 代理，拦截 AI 编码工具（Claude Code、Cursor、Copilot、Gemini CLI 等）执行的 shell 命令，对输出进行智能过滤和压缩，将 LLM token 消耗降低 **60-90%**。

**核心价值**：AI 编码工具在工作时会频繁调用 `git status`、`cat`、`cargo test` 等命令，原始输出充满冗余信息（时间戳、权限位、通过的测试用例等）。RTK 作为透明代理，只把 LLM 真正需要的信息传递过去。

**一句话概括**：给 AI 编码助手装一个"信息过滤器"，让它用更少的 token 做更多的事。

## 项目结构

```
rtk/
├── src/
│   ├── main.rs              # CLI 入口，2537行，Clap 路由所有子命令
│   ├── cmds/                # 命令过滤模块（按生态系统组织）
│   │   ├── git/             # git status/diff/log/add/commit/push + gh CLI
│   │   ├── rust/            # cargo test/build/clippy
│   │   ├── js/              # eslint/tsc/vitest/playwright/next/prettier/prisma/pnpm
│   │   ├── python/          # ruff/pytest/pip/mypy
│   │   ├── go/              # go test/build/vet + golangci-lint
│   │   ├── ruby/            # rake/rspec/rubocop/bundle
│   │   ├── dotnet/          # dotnet build/test/binlog
│   │   ├── cloud/           # aws/docker/kubectl/curl/wget/psql
│   │   └── system/          # ls/read/grep/find/json/log/env/deps/summary
│   ├── core/                # 基础设施
│   │   ├── runner.rs        # 命令执行骨架（run_filtered 函数）
│   │   ├── filter.rs        # 代码过滤（None/Minimal/Aggressive 三级）
│   │   ├── tracking.rs      # SQLite token 追踪
│   │   ├── tee.rs           # 失败时保存原始输出
│   │   ├── config.rs        # 配置加载
│   │   └── telemetry.rs     # 匿名遥测（每日一次）
│   ├── hooks/               # AI 工具集成钩子
│   │   ├── init.rs          # rtk init 安装钩子（支持 10+ 工具）
│   │   ├── rewrite_cmd.rs   # 命令重写逻辑
│   │   ├── hook_cmd.rs      # Copilot/Gemini 钩子处理
│   │   └── permissions.rs   # 安全权限控制（allow/deny/ask）
│   ├── discover/            # 发现未使用 RTK 的命令
│   ├── analytics/           # 经济分析（token 成本计算）
│   ├── learn/               # 学习模式
│   └── parser/              # 通用解析器
├── hooks/                   # 预构建的钩子脚本
├── openclaw/                # OpenClaw 插件
├── tests/                   # 集成测试
└── Cargo.toml               # 22 个依赖，优化的 release profile
```

**规模**：64 个模块（42 个命令模块 + 22 个基础设施模块），单二进制 ~4.1MB。

## 核心架构

### 代理模式（Proxy Pattern）

```
  无 RTK:                                     有 RTK:

  AI Agent  --git status-->  Shell  -->  git     AI Agent  --git status-->  RTK  -->  git
    ^                                    |         ^                        |          |
    |      ~2,000 tokens（原始输出）      |         |   ~200 tokens         | 过滤     |
    +------------------------------------+         +------- (压缩输出) -----+----------+
```

### 六阶段执行流程

```
1. PARSE   → Clap 解析命令和标志（-v, -u）
2. ROUTE   → main.rs match 路由到对应模块
3. EXECUTE → std::process::Command 执行原始命令
4. FILTER  → 按策略过滤输出（核心价值所在）
5. PRINT   → 输出压缩结果
6. TRACK   → 记录到 SQLite（token 统计）
```

### 12 种过滤策略

RTK 不是简单的 `| head`，而是针对不同命令类型使用不同的过滤策略：

| # | 策略 | 适用场景 | 压缩率 |
|---|------|----------|--------|
| 1 | **Stats Extraction** | git status/log/diff | 90-99% |
| 2 | **Error Only** | err 模式，只保留错误 | 60-80% |
| 3 | **Grouping by Pattern** | lint/tsc/grep 按规则/文件分组 | 80-90% |
| 4 | **Deduplication** | 日志去重 + 计数 | 70-85% |
| 5 | **Structure Only** | JSON 只保留 schema | 80-95% |
| 6 | **Code Filtering** | read 三级过滤（none/minimal/aggressive） | 0-90% |
| 7 | **Failure Focus** | 测试只显示失败用例 | 94-99% |
| 8 | **Tree Compression** | ls 目录树压缩 | 50-70% |
| 9 | **Progress Filtering** | wget 去除进度条 | 85-95% |
| 10 | **JSON/Text Dual Mode** | ruff/pip 优先用 JSON | 80%+ |
| 11 | **State Machine Parsing** | pytest 状态机解析 | 90%+ |
| 12 | **NDJSON Streaming** | go test 逐行 JSON | 90%+ |

### Hook 系统（自动重写）

RTK 最强大的功能是**透明重写钩子**：AI 工具执行 `git status` 时，钩子自动将其改写为 `rtk git status`，AI 完全无感知。

```
Hook 拦截流程:
1. AI Agent 发出 Bash 命令 "git status"
2. PreToolUse hook 拦截
3. rtk rewrite "git status" → "rtk git status"（exit 0 = 允许, 1 = 透传, 2 = 拒绝）
4. 执行重写后的命令
5. AI 收到压缩输出（不知道发生了重写）
```

支持 10 个 AI 工具：Claude Code、Copilot（VS Code + CLI）、Cursor、Gemini CLI、Codex、Windsurf、Cline/Roo Code、OpenCode、OpenClaw。

## 核心工作流程

### 用户视角

```bash
# 1. 安装
brew install rtk          # 或 cargo install --git

# 2. 一键集成 AI 工具
rtk init -g               # Claude Code（默认）
rtk init -g --copilot     # GitHub Copilot
rtk init -g --gemini      # Gemini CLI
rtk init -g --agent cursor  # Cursor

# 3. 重启 AI 工具，开始省钱
# 所有 Bash 命令自动走 RTK，无需改变使用习惯
```

### 开发者视角（添加新命令过滤器）

1. 在 `src/cmds/{ecosystem}/` 创建 `xxx_cmd.rs`
2. 实现过滤函数 `fn filter_xxx(output: &str) -> String`
3. 在 `main.rs` 添加 `Commands::Xxx` 枚举
4. 在 `discover/registry.rs` 注册重写规则
5. 编写测试

## 部署步骤

### 编译

```bash
git clone https://github.com/rtk-ai/rtk.git
cd rtk
cargo build --release    # ~1m43s（首次编译含依赖）
./target/release/rtk --version   # rtk 0.35.0
```

Release profile 优化配置：
- `opt-level = 3`：最高优化
- `lto = true`：链接时优化
- `codegen-units = 1`：单编译单元
- `strip = true`：去除调试符号
- `panic = "abort"`：更小的二进制

### 验证

```bash
rtk --version    # 确认版本
rtk ls .         # 测试基本功能
rtk gain         # 查看 token 统计
```

## Demo 示例

### Demo 1: 目录列表压缩

```bash
$ rtk ls src/
analytics/
cmds/
core/
discover/
filters/
hooks/
learn/
parser/
main.rs  82.9K
```

对比原始 `ls -la`（包含权限、所有者、时间等冗余信息），压缩率 ~75%。

### Demo 2: Git 操作压缩

```bash
$ rtk git status
* master...origin/master
~ Modified: 2 files
   .gitignore
   CLAUDE.md
? Untracked: 2 files
   .claude/skills/gitnexus/
   AGENTS.md
```

```bash
$ rtk git push    # 原始输出 15 行 → 1 行
ok main
```

### Demo 3: 智能代码阅读

```bash
$ rtk read src/core/filter.rs -l aggressive --max-lines 20
# 只保留函数签名，去除所有函数体
pub enum FilterLevel { ... }
pub trait FilterStrategy {
    fn filter(&self, content: &str, lang: &Language) -> String;
}
pub enum Language { ... }
```

### Demo 4: Token 节省统计

```bash
$ rtk gain
RTK Token Savings (Global Scope)
═══════════════════════════════════════════
Total commands:    12
Tokens saved:      9.6K (79.1%)
Efficiency meter: ███████████████████░░░░░ 79.1%
```

## 关键发现 / 学习心得

### 1. 极简但有效的设计哲学

RTK 不用 ML、不用 LLM，纯粹靠**针对每种命令的规则化过滤**。12 种策略覆盖了绝大多数开发场景。这比用 AI 来压缩 AI 输出更靠谱，因为：
- 延迟极低（5-15ms 额外开销）
- 确定性输出（不会丢失关键信息）
- 零成本（不需要额外 API 调用）

### 2. Hook 系统是杀手锏

`rtk init -g` 一键安装后，所有 AI 工具的 Bash 命令自动走 RTK，用户和 AI 都无需改变习惯。这种**透明代理 + 自动重写**的模式值得学习。

### 3. 经济账很清楚

一个 30 分钟的 Claude Code session 大约消耗 118K tokens，用 RTK 后降到 24K。按 Claude Sonnet 的定价（$3/$15 per 1M tokens），每个 session 能省约 $1.4。重度用户一天 10 个 session 就是 $14/天。

### 4. 生态系统覆盖全面

支持 8 个语言生态（Git、Rust、JS/TS、Python、Go、Ruby、.NET、Cloud），42 个命令模块，100+ 条具体命令。基本覆盖了全栈开发者日常使用的所有 CLI 工具。

### 5. 安全设计合理

Hook 系统内置了权限控制（allow/deny/ask），防止恶意命令通过重写绕过安全检查。Tee 机制在命令失败时保存原始输出，确保调试信息不丢失。

### 6. 与 OpenClaw 的集成

RTK 已经有 OpenClaw 插件（`openclaw/` 目录），使用 `before_tool_call` hook 实现自动重写。安装方式：`openclaw plugins install ./openclaw`。

## 性能数据

| 指标 | 数值 |
|------|------|
| 二进制大小 | ~4.1 MB |
| 冷启动时间 | ~5-10ms |
| 内存占用 | ~2-5 MB |
| 命令额外延迟 | 5-15ms |
| 平均 token 压缩率 | 60-90% |
| 支持的命令数 | 100+ |
| 支持的 AI 工具 | 10 个 |

## 参考资源

- **官方网站**：https://www.rtk-ai.app
- **GitHub**：https://github.com/rtk-ai/rtk
- **Discord**：https://discord.gg/RySmvNF5kF
- **架构文档**：[ARCHITECTURE.md](https://github.com/rtk-ai/rtk/blob/master/docs/contributing/ARCHITECTURE.md)
- **安装指南**：[INSTALL.md](https://github.com/rtk-ai/rtk/blob/master/INSTALL.md)
- **故障排除**：[TROUBLESHOOTING.md](https://github.com/rtk-ai/rtk/blob/master/docs/TROUBLESHOOTING.md)
- **Homebrew**：`brew install rtk`

## 实测验证：RTK + Claude Code Token 消耗对比

_测试日期：2026-04-12 | 测试环境：AWS EC2 (dev-server) | Claude Code 2.1.104 + Bedrock Opus_

### 测试设计

在 RTK 自己的 Rust 仓库上，让 Claude Code 完成一个真实编码任务：**添加 docker build 输出过滤模块**（读源码 → 写代码 → cargo check → cargo test → 修复 → 重复）。分别在启用和禁用 RTK hook 的条件下跑同一个 prompt，对比 token 消耗和费用。

**测试 Prompt：**
> Add docker build output filtering support to RTK. Look at how container.rs handles docker ps/images/logs, then add a DockerBuild variant that filters verbose build output (layer hashes, download progress, cache messages) into a compact summary showing only the final image tag and any errors. Include unit tests. Run cargo check and cargo test to verify everything compiles and passes.

### 结果对比

#### 总体数据

| 指标 | ✅ 有 RTK | ❌ 无 RTK | 差异 |
|------|-----------|-----------|------|
| 总 Turns | 26 (max) | 26 (max) | 相同 |
| 总耗时 | 240s | 295s | RTK 快 18% |
| input_tokens | 10,185 | 586 | — |
| cache_creation | 63,458 | 52,483 | +20.9% ⬆️ |
| cache_read | 1,220,189 | 1,272,396 | -4.1% |
| output_tokens | 12,611 | 13,907 | -9.3% |
| **总费用** | **$1.373** | **$1.315** | **+4.4% ⬆️** |

#### 早期单命令测试（参考）

| 命令 | 原始输出 | RTK 输出 | 压缩率 |
|------|----------|----------|--------|
| `find` (全量文件) | 106,222 B | 909 B | 99.1% |
| `cargo check` | 7,013 B | 2,696 B | 61.6% |
| `git status` | 464 B | 134 B | 71.1% |

### 关键发现

**1. 单命令压缩效果显著，但端到端 session 费用基本持平**

RTK 在单条命令上的压缩率确实惊人（`find` 压缩 99%），但在 Claude Code 的完整编码 session 中，这个优势被以下因素稀释：

- Claude Code 的 Read/Write/Edit 工具不走 Bash，不经过 RTK
- 中等规模项目的 cargo check/test 输出本身不算特别大（几 KB 级别）
- RTK hook 的执行开销（rewrite 元数据 + 输出包装）会增加 context

**2. Bedrock cache 计费放大了 overhead**

RTK 改变了命令输出内容，导致 cache_creation tokens 增加 21%（63K vs 52K）。在 Bedrock 的计费模型下，cache_creation 比 cache_read 贵得多，这个差异被放大了。

**3. 有趣的副作用：RTK 版本快了 18%**

虽然费用略高，但 API 调用时间从 276s 降到 221s。压缩后的 context 减少了模型的处理时间，这在长 session 中可能更有实际价值（开发者等待时间更短）。

### RTK 的真正甜区

基于测试数据推断，RTK 的最大价值场景是：

| 场景 | 预期效果 | 原因 |
|------|----------|------|
| 大型 monorepo（数千文件） | ⭐⭐⭐ 高 | `find`/`ls` 输出巨大，压缩率 99%+ |
| 重编译项目（C++/大 Rust workspace） | ⭐⭐⭐ 高 | build log 几十~几百 KB |
| CI 调试循环 | ⭐⭐ 中高 | 反复查看长测试输出 |
| 中小型项目日常开发 | ⭐ 一般 | 输出本身不大，overhead 抵消收益 |

### 建议

- **保留 RTK hook**：不碍事，在遇到大输出时自动发挥作用
- **对于 Bedrock 用户**：注意 cache 计费模型的影响，RTK 的"省 token"不等于"省钱"
- **关注速度提升**：18% 的速度提升在长 session 中是实质性的开发体验改善
