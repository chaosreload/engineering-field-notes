# hermes-agent Getting Started

> 整理日期：2026-04-10
> 仓库地址：https://github.com/NousResearch/hermes-agent
> 版本：v0.8.0（2026-04-08 发布）
> 许可证：MIT

## 项目简介

Hermes Agent 是 [Nous Research](https://nousresearch.com) 开源的 **自我进化 AI Agent 框架**。它的核心卖点是 **闭环学习机制**——agent 能从使用经验中自动创建 skill、在使用过程中改进 skill、主动维护长期记忆、搜索历史对话，并跨会话建立用户画像。

**一句话总结**：一个可以跑在 $5 VPS 上、支持 10+ 消息平台、内置 40+ 工具、能自我学习的通用 AI Agent。

**与 OpenClaw 的关系**：Hermes Agent 直接 fork 自 OpenClaw（有完整的 `hermes claw migrate` 迁移命令），在 OpenClaw 基础上增加了 Nous Research 的 RL 训练集成（Atropos）、Nous Portal 原生支持、以及更多 provider 适配。代码结构、核心理念（MEMORY.md/SOUL.md/skills/gateway 架构）基本一致。

## 适合谁用

- 想要一个 **自托管、多平台（CLI + Telegram + Discord + Slack + WhatsApp + Signal…）** 的 AI 助手
- 需要 Agent **长期记忆 + 自动学习** 能力
- 研究者需要 **批量生成 tool-calling 轨迹** 用于 RL 训练
- 想用任意模型提供商（OpenAI / Anthropic / OpenRouter / Nous Portal / GLM / Kimi / MiniMax / 本地 Ollama）

## 项目结构

```
hermes-agent/                  # ~15,800 行 Python（核心 + 工具），~3000 测试
├── run_agent.py               # AIAgent 类 — 核心对话循环（9845 行，最大文件）
├── cli.py                     # HermesCLI — prompt_toolkit TUI 交互界面
├── model_tools.py             # 工具编排：发现、注册、分发
├── toolsets.py                # 工具集定义（web/terminal/file/browser/…）
├── hermes_state.py            # SessionDB — SQLite + FTS5 会话存储
│
├── agent/                     # Agent 内部模块
│   ├── prompt_builder.py      # 系统提示词组装（身份、平台提示、skills 索引、上下文文件）
│   ├── context_compressor.py  # 自动上下文压缩（保护头尾，摘要中间）
│   ├── memory_manager.py      # 记忆管理器（内置 + 插件 provider 编排）
│   ├── skill_utils.py         # Skill 元数据工具（frontmatter 解析、平台匹配）
│   ├── credential_pool.py     # 多凭证池，同 provider 故障转移
│   ├── smart_model_routing.py # 轻/重模型路由（cheap vs strong）
│   ├── prompt_caching.py      # Anthropic prompt caching 支持
│   ├── error_classifier.py    # API 错误分类与 failover 策略
│   └── trajectory.py          # 轨迹保存（用于 RL 训练）
│
├── tools/                     # 40+ 工具实现（每文件一个工具）
│   ├── registry.py            # 中央工具注册表（schema/handler/dispatch）
│   ├── terminal_tool.py       # 终端执行（6 种后端：local/Docker/SSH/Modal/Daytona/Singularity）
│   ├── delegate_tool.py       # 子 Agent 委派（隔离上下文，限制工具集，并行模式）
│   ├── code_execution_tool.py # PTC — 用 Python 脚本 RPC 调用工具（压缩多步到一轮）
│   ├── skill_manager_tool.py  # 技能创建/编辑/删除（agent 的程序化记忆）
│   ├── memory_tool.py         # MEMORY.md + USER.md 持久化记忆
│   ├── session_search_tool.py # FTS5 历史对话搜索 + LLM 摘要
│   ├── browser_tool.py        # 浏览器自动化
│   ├── mcp_tool.py            # MCP 客户端（~1050 行，OAuth 2.1 支持）
│   └── environments/          # 终端后端实现（local, docker, ssh, modal, daytona, singularity）
│
├── gateway/                   # 消息平台网关
│   ├── run.py                 # 主循环、斜杠命令、消息分发
│   ├── session.py             # 会话持久化
│   └── platforms/             # 15+ 平台适配器
│       ├── telegram.py        # Telegram Bot
│       ├── discord.py         # Discord Bot
│       ├── slack.py           # Slack Bolt
│       ├── whatsapp.py        # WhatsApp
│       ├── signal.py          # Signal
│       ├── matrix.py          # Matrix (E2E 加密)
│       ├── feishu.py          # 飞书
│       ├── dingtalk.py        # 钉钉
│       ├── wecom.py           # 企业微信
│       ├── email.py           # 邮件
│       ├── homeassistant.py   # Home Assistant
│       ├── bluebubbles.py     # iMessage (via BlueBubbles)
│       ├── mattermost.py      # Mattermost
│       ├── sms.py             # SMS
│       └── webhook.py         # Webhook
│
├── acp_adapter/               # ACP (Agent Client Protocol) 服务器
│   ├── server.py              # ACP 协议实现（VS Code / Zed / JetBrains 集成）
│   └── session.py             # 会话管理
│
├── skills/                    # 内置 Skills（25+ 分类）
│   ├── research/              # 研究类
│   ├── software-development/  # 软件开发
│   ├── creative/              # 创意类
│   ├── devops/                # DevOps
│   └── ...                    # gaming, media, social-media, smart-home 等
│
├── plugins/memory/            # 记忆插件（可选）
│   ├── honcho/                # Honcho AI — 辩证用户建模
│   ├── mem0/                  # Mem0
│   ├── holographic/           # 全息记忆
│   └── ...                    # byterover, hindsight, supermemory 等
│
├── environments/              # RL 训练环境（Atropos 集成）
│   ├── hermes_base_env.py     # 基础环境类
│   ├── agent_loop.py          # 可复用的多轮 Agent 引擎
│   └── tool_call_parsers/     # 工具调用解析器
│
├── cron/                      # 内置 Cron 调度器
├── hermes_cli/                # CLI 子命令（setup, model, tools, skills, config…）
├── batch_runner.py            # 并行批量处理
├── tests/                     # ~3000 测试
└── website/                   # 文档站 (VitePress)
```

## 核心架构

### 1. Agent 循环（run_agent.py）

核心循环在 `AIAgent.run_conversation()` 中，完全同步：

```
用户消息 → 构建系统提示（身份 + 记忆 + Skills + 上下文文件）
         → 调用 LLM（OpenAI 兼容格式）
         → 如果有 tool_calls → 分发到 handle_function_call() → 收集结果 → 继续循环
         → 没有 tool_calls → 返回最终响应
```

**关键设计**：
- 所有消息走 OpenAI 格式（system/user/assistant/tool），即使是 Anthropic 也通过 adapter 转换
- 系统提示在会话内冻结（保护 prompt cache），记忆写入立即生效但下次会话才刷新
- 支持 reasoning/thinking 内容（Anthropic thinking signatures 跨轮保持）
- 超大工具结果自动持久化到文件，避免破坏性截断

### 2. 闭环学习机制

这是 Hermes Agent 最核心的差异化能力，由三层组成：

**Layer 1: 文件记忆（MEMORY.md + USER.md）**
- `MEMORY.md`：agent 的个人笔记（环境事实、项目惯例、工具技巧）
- `USER.md`：关于用户的认知（偏好、沟通风格、工作习惯）
- 用 `§` 作为条目分隔符，支持 add/replace/remove/read
- 内置 prompt injection 扫描（10+ 威胁模式 + 隐形 Unicode 检测）

**Layer 2: 自动 Skill 创建（skill_manager_tool.py）**
- 完成复杂任务后，agent 自主将成功方法转化为可复用 Skill
- Skill = 目录结构（SKILL.md + references/ + templates/ + scripts/）
- 兼容 [agentskills.io](https://agentskills.io) 开放标准
- 创建后自动安全扫描（和社区 Hub 安装相同标准）
- Skill 在使用过程中可自我改进（patch 动作）

**Layer 3: 跨会话搜索（session_search_tool.py）**
- SQLite FTS5 全文搜索历史对话
- 找到匹配后，用廉价模型（Gemini Flash）生成聚焦摘要
- 返回的是摘要而非原始记录，保护主模型上下文窗口

**Layer 3.5: 辩证用户建模（Honcho 插件）**
- 可选接入 Honcho AI，提供语义搜索、peer card、conclusion 等高级用户建模

### 3. 多平台 Gateway

Gateway 是一个单进程，同时驱动所有已配置的平台适配器：

```
消息进入 → 平台适配器接收 → 路由到对应会话 → AIAgent 处理 → 结果回传平台
```

**15+ 平台支持**：Telegram、Discord、Slack、WhatsApp、Signal、Matrix（E2E 加密）、飞书、钉钉、企业微信、Email、Home Assistant、BlueBubbles (iMessage)、Mattermost、SMS、Webhook。

**v0.8.0 新增**：
- 所有平台支持 `/model` 实时切模型
- Telegram/Discord 有 inline button 模型选择器
- Slack/Telegram 有审批按钮（代替手动输入 `/approve`）
- 自适应文本批处理（防止长消息被分割成碎片）

### 4. 工具系统

**40+ 内置工具**，通过 `tools/registry.py` 统一管理：

| 工具集 | 包含 |
|--------|------|
| web | web_search, web_extract |
| terminal | terminal（6 种后端）, process |
| file | read_file, write_file, patch, search_files |
| browser | navigate, snapshot, click, type, scroll, vision 等 |
| planning | todo, memory |
| code | execute_code（PTC 模式，Python RPC） |
| delegation | delegate_task（子 Agent，最多 3 并发） |
| skills | skills_list, skill_view, skill_manage |
| cron | cronjob 管理 |
| messaging | send_message（跨平台） |
| tts | text_to_speech（Edge TTS 免费 + ElevenLabs 付费） |
| mcp | MCP 客户端（OAuth 2.1） |
| vision | vision_analyze, image_generate |

**注册模式**（三文件修改）：
1. 创建 `tools/your_tool.py`，调用 `registry.register()`
2. 在 `model_tools.py` 的 `_discover_tools()` 添加 import
3. 在 `toolsets.py` 添加到对应工具集

### 5. 终端后端

支持 6 种执行环境，通过 `TERMINAL_ENV` 切换：

| 后端 | 特点 |
|------|------|
| **local** | 直接在主机执行（默认，最快） |
| **Docker** | 容器隔离 |
| **SSH** | 远程服务器 |
| **Modal** | 云沙箱（serverless，空闲休眠） |
| **Daytona** | 云 workspace（serverless 持久化） |
| **Singularity** | HPC 容器 |

### 6. RL 训练集成（Atropos）

这是 Hermes Agent 相比 OpenClaw 最独特的部分：

```
environments/
├── hermes_base_env.py   # 抽象基类（Atropos 集成）
├── agent_loop.py        # 可复用多轮 Agent 引擎
├── web_research_env.py  # 网络研究评估环境
├── agentic_opd_env.py   # OPD 环境
└── tool_call_parsers/   # 工具调用解析器
```

- 子类只需实现 `setup()`, `get_next_item()`, `format_prompt()`, `compute_reward()`, `evaluate()`
- 支持两种模式：OpenAI server（Phase 1）+ VLLM ManagedServer（Phase 2）
- `batch_runner.py` 提供并行批量轨迹生成
- `trajectory_compressor.py` 做轨迹压缩用于训练下一代工具调用模型

### 7. ACP 适配器

通过 Agent Client Protocol 把 Hermes Agent 暴露给 IDE（VS Code Copilot Chat、Zed、JetBrains）：
- 完整的 ACP session 生命周期管理
- 支持 fork session、list sessions、load session
- 工具进度回调、thinking 回调、审批回调

## 安全设计

Hermes Agent 在安全方面做了大量工作：

1. **上下文文件注入检测**（prompt_builder.py）：10 个威胁模式 + 6 个隐形 Unicode 字符检测
2. **记忆内容扫描**（memory_tool.py）：防止通过记忆注入 prompt injection
3. **Skill 安全扫描**（skills_guard.py）：agent 创建的 skill 和社区安装同等审查
4. **命令审批系统**（approval.py）：危险命令需用户确认
5. **凭证泄露防护**（redact.py）：自动脱敏 API keys
6. **SSRF 防护 + URL 安全检查**（url_safety.py）
7. **MCP OAuth 2.1 PKCE** + **OSV 恶意包扫描**（osv_check.py）

## 快速安装

```bash
# 一键安装（Linux/macOS/WSL2/Termux）
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
source ~/.bashrc

# 开始使用
hermes              # 交互式 CLI
hermes model        # 选择 LLM 提供商
hermes setup        # 完整设置向导
hermes gateway      # 启动消息网关
```

**开发者安装**：
```bash
git clone https://github.com/NousResearch/hermes-agent.git
cd hermes-agent
uv venv venv --python 3.11
source venv/bin/activate
uv pip install -e ".[all,dev]"
python -m pytest tests/ -q  # ~3000 测试
```

## 关键发现 / 学习心得

### 1. 与 OpenClaw 的关系：Fork + 研究方向扩展

Hermes Agent 保留了 OpenClaw 的全部核心架构（agent loop、gateway、skills、memory、context files），并新增了：
- **Nous Portal** 原生集成（免费 MiMo v2 Pro 辅助模型）
- **Atropos RL 训练环境**（这是最大的差异化——可以用 agent 轨迹训练模型）
- **轨迹压缩器**（训练数据预处理）
- **批量 runner**（并行轨迹生成）
- 提供了 `hermes claw migrate` 一键从 OpenClaw 迁移

### 2. Programmatic Tool Calling (PTC) — 压缩多步到单轮

`execute_code` 工具允许 LLM 写一段 Python 脚本，通过 RPC 调用 Hermes 工具。好处是多步操作只消耗一轮上下文（中间结果不进入上下文窗口）。这对于需要大量工具调用的复杂任务非常有价值。

支持两种传输方式：
- **本地**：Unix Domain Socket
- **远程**：文件系统 RPC（请求/响应文件轮询）

### 3. Smart Model Routing — 轻重分离

通过关键词检测（debug、implement、analyze 等 30+ 关键词）+ URL 检测，自动决定用便宜模型还是强模型。这个设计简单但实用，可以显著降低成本。

### 4. 安全扫描设计值得学习

在系统提示注入、记忆内容、Skill 创建三个入口都设置了扫描。特别是 `_CONTEXT_THREAT_PATTERNS` 和 `_MEMORY_THREAT_PATTERNS` 的模式列表，值得参考。

### 5. 记忆管理器的插件化架构

`MemoryManager` 支持一个内置 provider + 最多一个外部 provider。外部 provider 包括 Honcho、Mem0、RetainDB 等 8 个选项。这种"一内一外"的限制设计简洁有效，避免了多个记忆后端冲突。

### 6. v0.8.0 的工程质量

一个版本 209 个 PR、82 个 issue，release notes 极其详尽。项目有完整的 AGENTS.md（给 AI 编码助手的指南）、~3000 测试、profile 隔离机制、skin 主题系统。工程成熟度很高。

## 与 OpenClaw 的详细对比

| 维度 | OpenClaw | Hermes Agent |
|------|----------|-------------|
| 语言 | TypeScript (Node.js) | Python |
| Agent 循环 | 异步 | 同步 (with async bridges) |
| RL 训练 | ❌ | ✅ Atropos 集成 |
| 轨迹生成 | ❌ | ✅ batch_runner + trajectory_compressor |
| 消息平台 | ~8 个 | 15+ 个（多了飞书、钉钉、企业微信、Matrix、SMS 等） |
| 终端后端 | local, Docker | 6 种（+SSH, Modal, Daytona, Singularity） |
| Skills Hub | clawhub.com | agentskills.io |
| 记忆插件 | 内置 | 内置 + 8 个可选外部 provider |
| ACP | ✅ | ✅ |
| PTC (代码执行) | ❌ | ✅ |
| Skin 主题 | ❌ | ✅ |
| 安全扫描 | 基本 | 全面（注入检测、OSV、SSRF、凭证脱敏） |
| Profile 多实例 | ✅ | ✅ |

## 参考资源

- 📖 **官方文档**：https://hermes-agent.nousresearch.com/docs/
- 🔧 **GitHub**：https://github.com/NousResearch/hermes-agent
- 💬 **Discord**：https://discord.gg/NousResearch
- 🛍️ **Skills Hub**：https://agentskills.io
- 📦 **Nous Portal**：https://portal.nousresearch.com
- 🧪 **Atropos (RL)**：通过 git submodule `tinker-atropos`
