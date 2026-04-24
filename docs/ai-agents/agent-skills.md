# agent-skills Getting Started

> 整理日期：2026-04-24
> 仓库地址：https://github.com/addyosmani/agent-skills

## 项目简介

`addyosmani/agent-skills` 是 Google Chrome 工程师 Addy Osmani 开源的一套**给 AI 编码 agent 用的"工程规范包"**。它把资深工程师在定义、规划、构建、测试、评审、发布每个阶段的工作流和质量门，打包成 20 个结构化 skill + 7 个 slash command + 3 个 persona，让 Claude Code / Cursor / Gemini CLI / OpenCode / Copilot 在写代码时强制走同一套流程——写 spec 再写代码、小步提交、测试即证据、code review 五轴打分、ship 前跑 checklist。

和"prompt 工程"的区别：prompt 是散的、一次性的；skill 是**可 discovery、可复用、带触发条件和退出标准的 markdown workflow**，由宿主 agent（Claude Code 等）按意图自动选 skill 装入上下文。

## 项目结构

```
agent-skills/
├── skills/                            # 20 个核心 skill（每个一个 SKILL.md）
│   ├── idea-refine/                   #   Define：发散/收敛想点子
│   ├── spec-driven-development/       #   Define：写 PRD 再写代码
│   ├── planning-and-task-breakdown/   #   Plan：拆成可验证小任务
│   ├── incremental-implementation/    #   Build：小步纵向切片
│   ├── test-driven-development/       #   Build：红-绿-重构 + 测试金字塔
│   ├── context-engineering/           #   Build：会话上下文管理
│   ├── source-driven-development/     #   Build：引用官方文档
│   ├── frontend-ui-engineering/       #   Build：UI 设计体系
│   ├── api-and-interface-design/      #   Build：契约优先
│   ├── browser-testing-with-devtools/ #   Verify：Chrome DevTools MCP 实测
│   ├── debugging-and-error-recovery/  #   Verify：五步 triage
│   ├── code-review-and-quality/       #   Review：五轴评审
│   ├── code-simplification/           #   Review：Chesterton 栅栏 + 500 行法则
│   ├── security-and-hardening/        #   Review：OWASP Top 10
│   ├── performance-optimization/      #   Review：Core Web Vitals
│   ├── git-workflow-and-versioning/   #   Ship：trunk-based + 原子提交
│   ├── ci-cd-and-automation/          #   Ship：Shift Left + 特性开关
│   ├── deprecation-and-migration/     #   Ship：代码即负债
│   ├── documentation-and-adrs/        #   Ship：架构决策记录
│   ├── shipping-and-launch/           #   Ship：灰度 + 回滚
│   └── using-agent-skills/            #   Meta：怎么用这个包
├── .claude/commands/                  # 7 个 slash command 入口
│   ├── spec.md  plan.md  build.md  test.md
│   └── review.md  code-simplify.md  ship.md
├── agents/                            # 3 个 persona
│   ├── code-reviewer.md               #   资深 staff engineer 视角
│   ├── test-engineer.md               #   QA 视角
│   └── security-auditor.md            #   安全工程师视角
├── references/                        # 4 份辅助 checklist（被 skill 动态加载）
│   ├── testing-patterns.md  performance-checklist.md
│   ├── security-checklist.md accessibility-checklist.md
│   └── orchestration-patterns.md
├── hooks/                             # 会话级生命周期钩子
│   ├── session-start.sh               #   启动时注入上下文
│   ├── sdd-cache-{pre,post}.sh        #   WebFetch 结果带 ETag 缓存
│   └── simplify-ignore.sh             #   /code-simplify 排除规则
└── docs/                              # 各宿主 agent 的接入指南
    ├── cursor-setup.md gemini-cli-setup.md
    ├── windsurf-setup.md opencode-setup.md
    └── copilot-setup.md  skill-anatomy.md
```

## 核心架构

### 三层编排：Command / Skill / Persona

这个 repo 明确把"工作流"切成三个正交的层，互不替代：

```
┌────────────────────────────────────────────────────────────┐
│  User 输入                                                  │
│     │                                                       │
│     ▼                                                       │
│  ┌─────────────┐    Command = "什么时候"                    │
│  │ Slash Cmd   │    用户/CI 触发的入口                       │
│  │ /spec /plan │    /ship 触发并行 fan-out                   │
│  │ /build /... │                                             │
│  └──────┬──────┘                                             │
│         │ invokes                                            │
│         ▼                                                    │
│  ┌─────────────┐    Skill = "怎么做"                        │
│  │ SKILL.md    │    带步骤、检查点、退出标准的 workflow      │
│  │ 20 个       │    意图匹配即自动加载                        │
│  └──────┬──────┘                                             │
│         │ may invoke                                          │
│         ▼                                                    │
│  ┌─────────────┐    Persona = "谁在看"                       │
│  │ agents/*.md │    角色视角 + 输出格式                        │
│  │ 3 个        │    persona 不互相调用（防止 router 反模式）   │
│  └─────────────┘                                              │
└────────────────────────────────────────────────────────────┘
```

> 关键约束：**只有 user 或 slash command 是 orchestrator**。persona 可以调 skill，但 persona 不能调其他 persona。唯一认可的多 persona 模式是 `/ship` 里的 "parallel fan-out + merge"——并行跑 code-reviewer / security-auditor / test-engineer，最后汇总报告。

### SKILL.md 标准结构

每个 skill 都按同一张骨架写：

```
┌─ YAML Frontmatter ─────────────────────┐
│ name: kebab-case-name                  │
│ description: 第三人称动词开头 +          │
│              "Use when..."触发条件       │
└────────────────────────────────────────┘
# Skill Name
## Overview           — 这个 skill 做什么
## When to Use        — 触发条件 + 不适用的场景
## Process            — 带步骤的 workflow
## Common Rationalizations  — 常见借口表 + 反驳
## Red Flags          — 做错了的信号
## Verification       — 退出标准：要交什么证据
```

最特别的是 **Common Rationalizations（反合理化）** 这一节。它专门列 agent 偷懒时最常用的借口（"这个太小不用 spec"、"我先加测试后面补"），并配一句反驳。这是硬编码的"不准跳步骤"机制。

### Hooks：会话级增强

```
SessionStart hook → session-start.sh → 注入项目上下文
PreToolUse(WebFetch) → sdd-cache-pre.sh  ┐
                                          ├─ HTTP ETag 级缓存：304 才走缓存，
PostToolUse(WebFetch) → sdd-cache-post.sh ┘    不破坏 "用最新官方文档" 的承诺
```

`sdd-cache` 这个 hook 设计很漂亮：缓存能省 token，但会违反 `source-driven-development` 的 "每次都要 verify 官方文档" 原则。作者的解法是**带 If-None-Match 重验证**——服务器回 304 才用缓存，等于每次都做了一次新鲜度校验。

## 工作流程

生命周期是一条流水线，每个阶段一个 command 触发对应 skill：

```
 DEFINE         PLAN          BUILD         VERIFY         REVIEW         SHIP
┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐
│ Idea │ ───▶ │ Spec │ ───▶ │ Code │ ───▶ │ Test │ ───▶ │  QA  │ ───▶ │  Go  │
│Refine│      │  PRD │      │ Impl │      │Debug │      │ Gate │      │ Live │
└──────┘      └──────┘      └──────┘      └──────┘      └──────┘      └──────┘
 /spec          /plan          /build        /test         /review       /ship
```

典型路径：用户说"加一个导出 CSV 功能" →
1. `/spec` 触发 `spec-driven-development`，agent 反问用户需求、列假设、写 SPEC.md
2. `/plan` 触发 `planning-and-task-breakdown`，把 spec 拆成 5 个 ≤100 行的原子任务
3. `/build` 触发 `incremental-implementation` + `test-driven-development`，一次一个 slice，红-绿-重构
4. `/test` 触发 `browser-testing-with-devtools` 跑端到端
5. `/review` 触发 `code-review-and-quality`（五轴打分）
6. `/ship` 触发 `shipping-and-launch`（灰度 + 回滚方案）

每一步都是 **gated**——上一步没过审，不许进下一步。

## 使用方式

不是传统意义的"部署"，这个项目的"运行"就是把 skill 装到宿主 agent 能读到的位置。

### Claude Code（推荐）

```bash
/plugin marketplace add addyosmani/agent-skills
/plugin install agent-skills@addy-agent-skills
```

装完后 Claude 会自动索引每个 `SKILL.md` 的 frontmatter `description`，用户的意图匹配到关键词就自动加载对应 skill。

### Cursor / Windsurf

把 `SKILL.md` 复制到 `.cursor/rules/` 或 Windsurf rules 目录。

### Gemini CLI

```bash
gemini skills install https://github.com/addyosmani/agent-skills.git --path skills
```

### OpenCode / Copilot

通过 `AGENTS.md` / `.github/copilot-instructions.md` 把 intent→skill 映射写进持久上下文。OpenCode 不支持 slash command，所以 intent 匹配得靠 agent 自己判断。

### 本地 dev 模式

```bash
git clone https://github.com/addyosmani/agent-skills.git
claude --plugin-dir /path/to/agent-skills
```

## Demo 示例

我们选 `idea-refine`（20 个 skill 里**唯一带可执行脚本**的）做 demo：

```bash
# /data/projects/chaosreload/study/demo/agent-skills/
├── idea-refine-SKILL.md       # 从上游复制的 skill 定义
├── idea-refine.sh             # 上游 repo 里的初始化脚本
├── README.md                  # 这个 demo 的说明
└── docs/ideas/                # 脚本创建的默认输出目录
```

跑脚本：

```bash
$ bash idea-refine.sh
Created directory: docs/ideas
{"status": "ready", "directory": "docs/ideas"}
```

脚本极简——只做两件事：`mkdir -p docs/ideas` + 吐一行 JSON 告诉 agent 目录就绪。这是 skill 哲学的缩影：**skill 是工作流，不是程序**，真正的"智能"在 SKILL.md 的流程描述里，脚本只处理文件系统副作用。

在 Claude Code 里激活后，用户说 "Help me ideate on X" 就触发。Claude 读完 `SKILL.md` 后会走三阶段 workflow：Understand & Expand（发散）→ Evaluate & Converge（收敛）→ Sharpen & Ship（写一页 markdown 到 `docs/ideas/`）。

## 关键发现 / 学习心得

### 1. Skill > Prompt：有触发条件、有退出标准、有反合理化

AI agent 使用社区经常纠结 "prompt 怎么写"，其实写得再好也是**一次性、静态、无结构**的。agent-skills 的核心洞察是把"写好提示词"升级成"写工程化 workflow"：

- **触发条件显式写在 frontmatter `description`** → agent discovery 机制可检索
- **每个阶段有退出标准（verification）** → "看起来对" 不算过关，必须给证据（测试输出、构建日志、运行截图）
- **每个 skill 都带 Common Rationalizations 表** → 硬编码"不准跳步骤"，提前堵住 agent 偷懒路径

这三条叠加起来，skill 就变成了**可执行的"senior engineer 行为规范"**，而不是一段"希望你做得好一点"的祷文。

### 2. 三层正交编排（Command / Skill / Persona）防止意大利面式调用

Anthropic 的 skill 生态早期常见反模式是写一个 "router agent" 决定调哪个 sub-agent。addyosmani 直接把这种模式标记成**反模式**，用三条硬约束切干净：

- User 或 slash command 是**唯一**的 orchestrator
- Persona 可以调 skill，但 persona 不调 persona
- 唯一多 persona 模式是 "parallel fan-out + merge"（`/ship` 用 3 个 persona 同时评审再汇总）

这对比下来，OpenClaw 自带的 skill 机制（`available_skills`）目前更轻量——只有 skill 概念，没有严格的 persona/command 分层。agent-skills 的编排模型值得借鉴：**让层级清楚，让 agent 之间的调用图变成 DAG 而不是图**。

### 3. Hook 层做"诚实缓存"：304 才信，不然重验证

`sdd-cache` hook 解决了一个典型矛盾：skill 要求"每次都查官方最新文档"，但 WebFetch 贵又慢。作者的方案：
- 缓存抓回来的内容
- 但**每次命中缓存都带 `If-None-Match` 重打 HTTP**
- 服务器回 304 才复用，200 就重抓

这在 AI agent 工具链里是罕见的"**诚实缓存**"设计——没有牺牲 skill 的承诺来换性能。对比很多 LLM gateway 的"结果缓存"是无视内容新鲜度的，容易让 agent 用到过期文档。这个模式值得套用到别的 LLM tool wrapper（比如 gitnexus 索引、MCP server 结果）。

## 参考资源

- 官方仓库：[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
- Claude Code plugin marketplace：[agent-skills@addy-agent-skills](https://docs.anthropic.com/claude-code/plugins)
- 配套的 Google 工程文化读物：[Software Engineering at Google (abseil.io/resources/swe-book)](https://abseil.io/resources/swe-book)、[Google eng-practices](https://google.github.io/eng-practices/)
- Skill 格式规范：`docs/skill-anatomy.md`（仓库内）
- 多 agent 编排模式：`references/orchestration-patterns.md`（仓库内）
- 作者博客：[addyosmani.com](https://addyosmani.com/)（Chrome DevRel，性能优化经典著作《Learning JavaScript Design Patterns》作者）
