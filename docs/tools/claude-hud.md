# claude-hud Getting Started

> 整理日期：2026-03-24
> 仓库地址：https://github.com/jarrodwatts/claude-hud

## 项目简介

**claude-hud** 是一个 Claude Code 的 statusline 插件，在终端输入框下方实时显示 context 使用量、工具调用状态、subagent 运行情况和 todo 进度。无需额外窗口或 tmux，利用 Claude Code 的原生 statusline API 实现。

**解决的核心问题**：使用 Claude Code 时，你不知道 context window 还剩多少、当前有哪些工具在跑、subagent 在干什么。claude-hud 让这些信息"始终可见"。

**适合场景**：所有 Claude Code 用户，特别是重度使用 subagent、长 session 的场景。

## 项目结构

```
claude-hud/
├── .claude-plugin/
│   ├── plugin.json          # Claude Code 插件声明（名称、版本、命令注册）
│   └── marketplace.json     # 插件市场元数据
├── commands/
│   ├── setup.md             # /claude-hud:setup 命令（配置 statusline）
│   └── configure.md         # /claude-hud:configure 命令（调整显示选项）
├── src/
│   ├── index.ts             # 入口：编排所有模块，生成 RenderContext 并渲染
│   ├── stdin.ts             # 解析 Claude Code 通过 stdin 传入的 JSON（model、context、rate_limits）
│   ├── transcript.ts        # 解析 transcript JSONL 文件（工具调用、agent、todo）
│   ├── config.ts            # 配置加载与合并（支持 preset、migration、validation）
│   ├── config-reader.ts     # 读取 CLAUDE.md / rules / MCP / hooks 数量
│   ├── git.ts               # 获取 git 分支、dirty、ahead/behind 状态
│   ├── speed-tracker.ts     # 计算 output token 速率
│   ├── memory.ts            # 系统 RAM 使用量（可选显示）
│   ├── extra-cmd.ts         # 自定义外部命令输出
│   ├── version.ts           # 检测 Claude Code 版本
│   ├── types.ts             # 所有核心类型定义
│   └── render/
│       ├── index.ts          # 渲染引擎：布局计算、ANSI 颜色、终端宽度自适应
│       ├── colors.ts         # ANSI 256-color / hex 颜色工具
│       ├── session-line.ts   # compact 模式的单行渲染
│       ├── tools-line.ts     # 工具活动行
│       ├── agents-line.ts    # subagent 状态行
│       ├── todos-line.ts     # todo 进度行
│       └── lines/
│           ├── identity.ts   # context bar 渲染
│           ├── project.ts    # 项目路径 + git
│           ├── usage.ts      # rate limit 使用量
│           ├── environment.ts # 环境信息（config counts 等）
│           └── memory.ts     # RAM 使用量
├── dist/                     # 编译产出（TypeScript → JavaScript）
└── package.json              # 零运行时依赖，仅 devDependencies
```

## 核心架构

### 数据流

```
Claude Code 启动 statusline 子进程
        │
        ▼
   stdin (JSON)  ──→  stdin.ts 解析
        │                 │
        │         ┌───────┴───────┐
        │         │ model info    │ context window
        │         │ rate_limits   │ used_percentage
        │         └───────────────┘
        │
   transcript_path ──→ transcript.ts 解析 JSONL
        │                 │
        │         ┌───────┴───────────────┐
        │         │ tool_use/tool_result  │ → tools[]
        │         │ Task (subagent)       │ → agents[]
        │         │ TodoWrite/TaskCreate  │ → todos[]
        │         └───────────────────────┘
        │
   同时并行收集：
        ├── git.ts         → branch, dirty, ahead/behind
        ├── config-reader  → CLAUDE.md / rules / MCP / hooks 计数
        ├── speed-tracker  → output token/s
        └── memory.ts      → RAM 使用量
        │
        ▼
   RenderContext（聚合所有数据）
        │
        ▼
   render/index.ts
        ├── expanded 模式：每个 element 独立一行
        └── compact 模式：全部压缩成一行
        │
        ▼
   stdout（ANSI 彩色文本）→ 显示在 Claude Code 终端
```

### 关键设计决策

1. **零运行时依赖**：整个项目只有 `devDependencies`（TypeScript + c8），运行时不依赖任何 npm 包。这保证了启动速度（~300ms 刷新间隔）。

2. **原生 token 数据**：不做猜测。context usage 直接来自 Claude Code stdin 的 `context_window.used_percentage`（v2.1.6+），fallback 到手动计算。

3. **Transcript 缓存**：`transcript.ts` 用 SHA256(路径) 做缓存 key，比对文件 mtime + size 决定是否重新解析。避免每次刷新都重新遍历 JSONL。

4. **终端宽度自适应**：`render/index.ts` 实现了完整的 Unicode 宽字符处理（CJK、emoji、ZWJ 序列），超宽内容自动在 `│` 分隔符处折行。

5. **Claude Code Plugin 规范**：通过 `.claude-plugin/plugin.json` 声明，`commands/*.md` 注册斜杠命令。setup 命令自动检测平台/Shell/运行时，生成动态版本查找命令写入 `settings.json`。

## 核心工作流程

### 1. 安装流程

```bash
# 1. 添加插件市场
/plugin marketplace add jarrodwatts/claude-hud

# 2. 安装插件
/plugin install claude-hud

# 3. 配置 statusline（自动检测环境、生成命令、写入 settings.json）
/claude-hud:setup

# 4. 重启 Claude Code 生效
```

### 2. 每次 Claude Code 启动后的 HUD 刷新流程

1. Claude Code 以子进程方式启动 statusline 命令
2. 通过 stdin 传入 JSON（model、context_window、rate_limits、transcript_path、cwd）
3. `index.ts` 依次调用各模块收集数据
4. 构建 `RenderContext` 对象
5. 根据配置（compact/expanded）渲染 ANSI 输出到 stdout
6. Claude Code 将 stdout 内容显示在输入框下方

### 3. Transcript 解析逻辑

transcript 是 Claude Code 的会话日志（JSONL 格式），每行一个 JSON 对象：

- `tool_use` block → 记录工具开始（name + target）
- `tool_result` block → 匹配 tool_use_id，标记完成/出错
- `Task` 工具 → 识别 subagent（type, model, description）
- `TodoWrite` / `TaskCreate` / `TaskUpdate` → 跟踪 todo 列表

只保留最近 20 个工具 + 10 个 agent 的状态，避免内存无限增长。

## 部署步骤

```bash
# 克隆
git clone https://github.com/jarrodwatts/claude-hud
cd claude-hud

# 安装依赖 + 构建
npm ci && npm run build

# 运行测试（265 pass / 0 fail）
npm test

# 手动测试 HUD 输出
echo '{"model":{"display_name":"Opus"},"context_window":{"current_usage":{"input_tokens":45000},"context_window_size":200000}}' | node dist/index.js
# 输出：
# [Opus]
# Context ███░░░░░░░ 29%
```

**环境要求**：
- Claude Code v1.0.80+
- Node.js 18+（或 Bun）

**无需额外配置**，零运行时依赖。

## Demo 示例

### 默认 2 行显示（expanded 模式）

```
[Opus] │ my-project git:(main*)
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (1h 30m / 5h)
```

- **第 1 行**：模型名 + 项目路径 + git 分支
- **第 2 行**：context bar（绿→黄→红渐变）+ 订阅用量

### 完整模式（启用所有可选项）

```
[Opus] │ my-project git:(main*)
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (1h 30m / 5h)
◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2
◐ explore [haiku]: Finding auth code (2m 15s)
▸ Fix authentication bug (2/5)
```

### 实际运行输出（stdin 模拟）

```bash
$ echo '{"model":{"display_name":"Opus"},"context_window":{"current_usage":{"input_tokens":45000},"context_window_size":200000},"transcript_path":"/tmp/test.jsonl"}' | node dist/index.js

[Opus]
Context ███░░░░░░░ 29%
```

### 配置示例

通过 `/claude-hud:configure` 交互式配置，或直接编辑 `~/.claude/plugins/claude-hud/config.json`：

```json
{
  "lineLayout": "expanded",
  "display": {
    "showTools": true,
    "showAgents": true,
    "showTodos": true,
    "showDuration": true
  },
  "colors": {
    "context": "cyan",
    "model": "cyan"
  }
}
```

支持三种预设：
- **Full**：所有功能开启
- **Essential**：活动行 + git，信息精简
- **Minimal**：仅模型名和 context bar

## 关键发现 / 学习心得

### 1. Claude Code Plugin 体系

claude-hud 是 Claude Code 插件系统的典型实现：
- **`.claude-plugin/plugin.json`**：声明元数据（name, version, commands）
- **`commands/*.md`**：用 Markdown 定义斜杠命令的执行逻辑（由 Claude 解释执行）
- **`statusline` API**：Claude Code 作为父进程，stdin 传 JSON，子进程 stdout 输出显示内容

这个插件体系的设计思路是"**让 AI 成为安装脚本的执行者**"——setup.md 并不是传统的 shell 脚本，而是一份详细的指令文档，由 Claude 阅读后自动执行每一步（检测环境 → 生成命令 → 写入配置）。

### 2. 纯函数 + 依赖注入的测试友好架构

`main()` 接受 `Partial<MainDeps>` 参数，所有 I/O 操作（readStdin, parseTranscript, getGitStatus 等）都可以被 mock。这使得 266 个测试全部是纯单元测试，不需要真实的 Claude Code 环境。

### 3. Unicode 宽字符处理的工程实践

`render/index.ts` 实现了完整的终端宽字符计算：
- 使用 `Intl.Segmenter` 做 grapheme 分割
- CJK / Emoji / ZWJ 序列正确计算为 2 列宽
- ANSI escape 序列在计算宽度时被正确跳过
- 超宽内容在 `│` 分隔符处自动折行，而非粗暴截断

### 4. 版本动态查找

setup 命令生成的 statusline command 不硬编码版本号，而是用 shell 脚本动态查找最新版本目录。这意味着插件更新后无需重新运行 setup。

### 5. 与 Bedrock 的兼容

stdin 解析自动识别 Bedrock 模型 ID（`anthropic.claude-*` 格式），提取友好名称（如 `Claude Opus 4`），并隐藏不适用的订阅用量显示。这对 AWS 用户很友好。

## 参考资源

- **GitHub 仓库**：https://github.com/jarrodwatts/claude-hud
- **Claude Code Plugins 文档**：Claude Code 插件系统（statusline API、commands 注册）
- **Claude Code Plugin Marketplace**：`/plugin marketplace add jarrodwatts/claude-hud`
- **相关 Issue**：[Linux EXDEV 问题](https://github.com/anthropics/claude-code/issues/14799)
