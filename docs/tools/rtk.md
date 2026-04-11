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
