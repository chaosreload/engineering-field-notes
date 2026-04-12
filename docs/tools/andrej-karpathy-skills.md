# andrej-karpathy-skills Getting Started

> 整理日期：2026-04-12
> 仓库地址：https://github.com/forrestchang/andrej-karpathy-skills
> Stars: 14.5k+ | Forks: 1k+ | License: MIT

## 项目简介

一个把 Andrej Karpathy 对 LLM 编程痛点的观察，提炼成 **4 条可执行准则** 的 Claude Code 插件/CLAUDE.md 文件。

Karpathy 的原始观察（来自 [X 帖子](https://x.com/karpathy/status/2015883857489522876)）：

> "The models make wrong assumptions on your behalf and just run along with them without checking. They don't manage their confusion, don't seek clarifications, don't surface inconsistencies, don't present tradeoffs, don't push back when they should."
>
> "They really like to overcomplicate code and APIs, bloat abstractions, don't clean up dead code... implement a bloated construction over 1000 lines when 100 would do."
>
> "They still sometimes change/remove comments and code they don't sufficiently understand as side effects, even if orthogonal to the task."

一句话总结：**LLM 写代码的三大问题 = 乱假设 + 过度设计 + 改不该改的东西。** 这个项目用 4 条准则逐一解决。

## 项目结构

```
andrej-karpathy-skills/
├── CLAUDE.md                           # 核心准则文件（放到项目根目录即可生效）
├── README.md                           # 项目说明 + 安装方式
├── EXAMPLES.md                         # 每条准则的正反示例
├── skills/karpathy-guidelines/
│   └── SKILL.md                        # Claude Code Plugin 格式的技能文件
└── .claude-plugin/
    ├── plugin.json                     # Claude Code 插件元数据
    └── marketplace.json                # 插件市场注册信息
```

**只有 6 个文件，零依赖，零代码。** 核心内容全在 `CLAUDE.md` 一个文件里。

## 四条核心准则

### 准则 1：Think Before Coding（先想再写）

**解决问题**：LLM 默默做假设然后一路狂奔，不确认、不提问。

**具体要求**：
- 明确说出你的假设。不确定就问
- 存在多种解读时，列出来让用户选，不要自己悄悄挑一个
- 如果有更简单的方案，主动提出。该 push back 就 push back
- 搞不清楚就停下来，说出哪里困惑，然后问

**反面案例**：用户说"导出用户数据"，LLM 直接假设了文件格式、导出范围、存储位置、字段列表，一气呵成写了 30 行代码——但没问过一个问题。

**正面做法**：先列出 4 个需要确认的点（范围、格式、字段、数据量），给出最简方案建议，然后等用户回复。

### 准则 2：Simplicity First（简单优先）

**解决问题**：LLM 热爱过度设计——策略模式、配置系统、缓存层，写个折扣计算要 200 行。

**具体要求**：
- 不加没要求的功能
- 不为只用一次的代码做抽象
- 不加没要求的"灵活性"和"可配置性"
- 不为不可能的场景加错误处理
- 200 行能用 50 行解决的，重写

**检验标准**："一个高级工程师会说这太复杂了吗？" 如果是，简化。

**反面案例**：用户要个折扣计算函数，LLM 写了 ABC 抽象类 + Strategy Pattern + DataClass Config + Calculator Class。

**正面做法**：一个 2 行函数 `return amount * (percent / 100)`。等真正需要多种折扣类型时再重构。

### 准则 3：Surgical Changes（精准修改）

**解决问题**：LLM 改一个 bug 顺手"改进"了一堆无关代码——换引号风格、加 type hints、删注释。

**具体要求**：
- 不"改进"旁边的代码、注释、格式
- 不重构没坏的东西
- 匹配现有风格，即使你觉得不好
- 发现无关死代码，提一嘴，但不删
- 你的改动造成的孤儿代码（unused imports 等）要清理
- 别人留下的死代码除非被要求，不动

**检验标准**："每一行改动都能追溯到用户的请求吗？" 如果有不能追溯的，撤掉。

**反面案例**：修个空邮箱崩溃的 bug，diff 里还出现了 username 校验、docstring、引号风格变更。

**正面做法**：只改空邮箱处理那两行。

### 准则 4：Goal-Driven Execution（目标驱动执行）

**解决问题**：LLM 拿到模糊指令后直接动手，没有可验证的完成标准。

**核心洞察**（Karpathy 原话）：

> "LLMs are exceptionally good at looping until they meet specific goals... Don't tell it what to do, give it success criteria and watch it go."

**具体做法**：把命令式任务转成可验证的目标——

| 不要这样说 | 转化为 |
|------------|--------|
| "加验证" | "写无效输入的测试，然后让它们通过" |
| "修这个 bug" | "写一个复现 bug 的测试，然后让它通过" |
| "重构 X" | "确保重构前后测试都通过" |

多步任务要列计划：
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
```

## 安装方式

**方式 A：Claude Code Plugin（推荐，全局生效）**

```bash
# 先添加 marketplace
/plugin marketplace add forrestchang/andrej-karpathy-skills
# 安装插件
/plugin install andrej-karpathy-skills@karpathy-skills
```

**方式 B：CLAUDE.md（按项目）**

```bash
# 新项目
curl -o CLAUDE.md https://raw.githubusercontent.com/forrestchang/andrej-karpathy-skills/main/CLAUDE.md

# 已有 CLAUDE.md 的项目（追加）
echo "" >> CLAUDE.md
curl https://raw.githubusercontent.com/forrestchang/andrej-karpathy-skills/main/CLAUDE.md >> CLAUDE.md
```

## 如何判断准则生效了

- **diff 里不再出现无关改动** — 只有被请求的改动
- **不再需要因为过度设计而重写** — 第一版就够简单
- **澄清问题先于实现** — 而不是犯错之后才问
- **PR 干净、最小化** — 没有顺手重构

## 关键发现 / 学习心得

### 1. 本质是"约束 LLM 的过度热心"

LLM 的核心倾向是 **"多做比少做好"**——多加抽象总没坏处、顺手改进风格是好习惯、不确定就先做了再说。这 4 条准则本质上都在对抗同一个倾向：**做得刚好够，不多不少。**

### 2. 准则 4 是最有杠杆的

Think / Simplicity / Surgical 都是约束性准则（"不要做 X"），而 Goal-Driven 是一个 **范式转换**——从"告诉 LLM 怎么做"变成"告诉 LLM 什么算做完了"。这实际上利用了 LLM 最擅长的能力：给定明确目标后的循环迭代。

### 3. 对 OpenClaw / 所有 AI Agent 都适用

虽然项目名带"Claude Code"，但这 4 条准则完全通用。对任何 LLM 编程 agent 都有价值：
- **OpenClaw AGENTS.md** 可以嵌入这些原则
- **Cursor rules / Windsurf rules** 同样适用
- **Code review prompt** 也可以参考"Surgical Changes"标准

### 4. 14.5k Stars 说明痛点真实

这个项目只有一个 Markdown 文件，却拿到了 14.5k stars。说明 Karpathy 描述的痛点（乱假设、过度设计、顺手乱改）是开发者与 LLM 编程协作中最普遍的摩擦。

### 5. 与 OpenClaw SOUL.md 的联系

Scout 的 SOUL.md 里有一条 Lesson Learned："源码分析优先用 GitNexus query 或 ACP，不要直接 grep minified dist 文件"。这本质上就是 **Think Before Coding** 的体现——先确认方法是否合理，而不是拿到任务就开干。

## 参考资源

- [Andrej Karpathy 原帖 (X)](https://x.com/karpathy/status/2015883857489522876)
- [forrestchang/andrej-karpathy-skills (GitHub)](https://github.com/forrestchang/andrej-karpathy-skills)
- [Claude Code Plugin 系统文档](https://docs.anthropic.com/en/docs/claude-code)
