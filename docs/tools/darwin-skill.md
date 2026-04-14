# darwin-skill Getting Started

> 整理日期：2026-04-14
> 仓库地址：https://github.com/alchaincyf/darwin-skill

## 项目简介

darwin-skill（达尔文.skill）是一个 **Agent Skill 自动优化器**——一个用来优化其他 SKILL.md 的 meta-skill。灵感直接来自 Andrej Karpathy 的 [autoresearch](https://github.com/karpathy/autoresearch)，核心理念是把「自主实验循环」从模型训练搬到 Skill 优化领域。

**核心主张**：传统 Skill 审查是纯结构性的（格式对不对、步骤有没有编号），但格式完美的 Skill 跑出来效果可能很差。darwin-skill 同时评估 **结构质量**（60分）和 **实际效果**（40分），用 hill-climbing + git 棘轮只保留真正有改进的修改。

**作者**：花叔（[@AlchainHust](https://x.com/AlchainHust)），国内 AI 工具领域的活跃创作者。

**适用场景**：你有 10+ 个 Agent Skills 需要系统性地审查和优化质量。

## 项目结构

```
darwin-skill/
├── SKILL.md                    # 核心！整个项目的灵魂（~500行）
├── README.md                   # 中文说明
├── README_EN.md                # 英文说明
├── templates/
│   ├── result-card.html        # 成果卡片模板（3 种视觉风格）
│   ├── result-card-dark.html   # 暗色版
│   └── result-card-white.html  # 白色版
├── scripts/
│   └── screenshot.mjs          # Playwright 高清截图脚本
├── docs/
│   └── index.html              # 项目官网（Swiss-style 单页）
└── assets/                     # 图表和 banner
    ├── chart-loop.png           # 核心循环图
    ├── chart-rubric.png         # 评估体系图
    ├── chart-phases.png         # 优化阶段图
    └── chart-ratchet.png        # 棘轮机制图
```

**关键认知**：这不是一个需要 `npm install` 和 `npm start` 的传统软件项目。它是一个**纯 Skill 文件**——SKILL.md 就是全部核心逻辑，由 AI Agent 运行时解释执行。

## 核心架构

### 设计映射：autoresearch → darwin-skill

| autoresearch | darwin-skill | 映射逻辑 |
|:---|:---|:---|
| `program.md` | SKILL.md 本身 | 定义评估标准和约束规则 |
| `train.py` | 每个待优化的 SKILL.md | 被优化的资产 |
| `val_bpb`（loss） | 8 维加权总分（满分100） | 可量化的优化目标 |
| `git ratchet` | keep / revert 机制 | 只保留有改进的 commit |
| `test set` | test-prompts.json | 验证改进是否真的有效 |
| 全自主运行 | **人在回路** | Skill 的好坏比 loss 更微妙 |

### 五条核心原则

1. **单一可编辑资产** — 每次只改一个 SKILL.md，变量可控，改进可归因
2. **双重评估** — 结构评分（静态分析）+ 效果验证（跑测试看输出）
3. **棘轮机制** — 只保留改进，自动回滚退步，分数只升不降
4. **独立评分** — 评分用子 agent，避免「自己改自己评」的偏差
5. **人在回路** — 每个 Skill 优化完后暂停，用户确认再继续

### 8 维度评估体系（总分 100）

#### 结构维度（60 分）— 静态分析

| 维度 | 权重 | 评什么 |
|------|------|--------|
| Frontmatter 质量 | 8 | name 规范、description 含触发词、≤1024 字符 |
| 工作流清晰度 | 15 | 步骤有序号、每步有明确输入/输出 |
| 边界条件覆盖 | 10 | 异常处理、fallback 路径 |
| 检查点设计 | 7 | 关键决策前有用户确认 |
| 指令具体性 | 15 | 不模糊、有具体参数/格式/示例 |
| 资源整合度 | 5 | references/scripts 引用正确 |

#### 效果维度（40 分）— 需要实测

| 维度 | 权重 | 评什么 |
|------|------|--------|
| 整体架构 | 15 | 结构层次清晰、不冗余不遗漏 |
| **实测表现** | **25** | 用测试 prompt 跑一遍，输出质量是否匹配宣称能力 |

**关键设计**：实测表现权重最高（25 分）。Skill 写得再漂亮，跑出来效果不好就是零。

## 核心工作流程

### 完整优化循环：5 个阶段

```
Phase 0: 初始化
  └→ 确认优化范围 → 创建 git 分支 → 初始化 results.tsv

Phase 0.5: 测试 Prompt 设计
  └→ 为每个 skill 设计 2-3 个测试 prompt → 保存到 test-prompts.json
  └→ 展示给用户确认 ← 人工检查点

Phase 1: 基线评估
  └→ 结构维度打分（主 agent）
  └→ 效果维度打分（子 agent 独立跑测试 prompt）
  └→ 展示评分卡 ← 人工检查点

Phase 2: 优化循环（每个 skill 最多 3 轮）
  └→ 诊断最低维度 → 提出改进方案 → 编辑 SKILL.md → git commit
  └→ 子 agent 重新评分
  └→ 新分 > 旧分 → keep ；否则 → git revert
  └→ 展示 diff + 分数变化 ← 人工检查点

Phase 2.5: 探索性重写（可选）
  └→ hill-climbing 卡住时，尝试从头重写
  └→ 需用户同意

Phase 3: 汇总报告 + 成果卡片
  └→ 生成分数变化表 + 视觉成果卡片 PNG
```

### 棘轮机制详解

```
Round 1: 78 分 → 82 分 → keep ✓
Round 2: 82 分 → 75 分 → revert ✗（回到 82）
Round 3: 82 分 → 87 分 → keep ✓
```

分数只能上升或不变，不会随时间退化。用 `git revert`（创建新 commit）而非 `git reset --hard`，保留完整历史。

### 成果卡片

优化完成后自动生成视觉成果卡片，3 种随机风格：

| 风格 | 特点 |
|------|------|
| Warm Swiss | 暖白底 + 赤陶橙，Inter 字体，干净网格 |
| Dark Terminal | 近黑底 + 荧光绿，等宽字体，扫描线效果 |
| Newspaper | 暖白纸 + 深红，衬线字体，双栏编辑风 |

通过 Playwright 截图生成高清 PNG（2x deviceScaleFactor）。

## 部署步骤

这是一个纯 Skill 项目，「部署」就是安装 SKILL.md：

### 方式一：通过 skills CLI

```bash
npx skills add alchaincyf/darwin-skill
```

### 方式二：手动安装

```bash
git clone https://github.com/alchaincyf/darwin-skill
cp darwin-skill/SKILL.md ~/.claude/skills/darwin-skill/SKILL.md
```

### 使用

在任何支持 Skill 的 Agent 工具（Claude Code、OpenClaw、Codex 等）中：

```
# 全量优化
用户："优化所有 skills"

# 单个优化
用户："优化 xxx 这个 skill"

# 仅评估
用户："评估所有 skills 的质量"

# 查看历史
用户："看看 skill 优化历史"
```

## 关键发现 / 学习心得

### 1. 「Meta-Skill」是 Skill 生态成熟的标志

当 Skill 数量足够多时，自然会出现「管理 Skill 的 Skill」。darwin-skill 做的事情本质上是 **Skill 的 CI/CD**——对每个 Skill 做质量检测、自动修复、回归测试。这是生态成熟的信号。

### 2. 「实测 > 结构」的评估理念值得借鉴

大多数 Skill 审查工具只看静态结构（格式、编号、路径）。darwin-skill 的 8 维评估中，实测表现占 25 分（最高单项），这意味着它真的会用子 agent 跑测试 prompt 来验证 Skill 的实际效果。这个理念可以迁移到很多场景。

### 3. autoresearch 范式的泛化

Karpathy 的 autoresearch 用于优化代码（loss 下降就保留）。darwin-skill 把同样的循环搬到了 Skill 优化。这个范式可以继续泛化：任何有「可量化目标 + 可自动修改 + 可自动验证」的场景都能用。

### 4. 人在回路的务实选择

autoresearch 是全自主的，但 darwin-skill 选择了人在回路。原因很实际：Skill 的「好坏」比 loss 数值更微妙。一个 Skill 可能评分更高但实际使用体验变差（过度约束、风格不匹配）。这个决策说明作者对 AI 编辑的局限性有清醒认识。

### 5. 设计品质很高

虽然核心只是一个 SKILL.md 文件，但配套的视觉设计（成果卡片 3 种风格、Swiss-style 项目官网、精美图表）体现了作者的产品意识。结果卡片本身就是传播素材——用户会主动分享「我的 Skill 从 72 分优化到 87 分」。

### 6. 与 OpenClaw skill-creator 的对比

| 维度 | darwin-skill | OpenClaw skill-creator |
|------|-------------|----------------------|
| 定位 | 优化已有 Skill | 创建新 Skill |
| 评估 | 8 维评分（含实测） | 格式规范检查 |
| 改进 | hill-climbing 循环 | 一次性创建/编辑 |
| 棘轮 | git commit + revert | 无 |
| 视觉 | 成果卡片 PNG | 无 |

两者互补：skill-creator 负责「从 0 到 1」，darwin-skill 负责「从 1 到 N」的持续优化。

### 7. 与花叔的 nuwa-skill 关系

README 底部写道：「**女娲**造 Skill，**达尔文**让 Skill 进化」。nuwa-skill 是创建 Skill 的工具，darwin-skill 是优化 Skill 的工具，构成完整的 Skill 生命周期管理。

## 参考资源

- **GitHub 仓库**：[github.com/alchaincyf/darwin-skill](https://github.com/alchaincyf/darwin-skill)
- **灵感来源**：[karpathy/autoresearch](https://github.com/karpathy/autoresearch)
- **姐妹项目**：[alchaincyf/nuwa-skill](https://github.com/alchaincyf/nuwa-skill)（女娲，Skill 创建工具）
- **Skill 生态**：[skills.sh](https://skills.sh)（Skill 分发平台）
- **作者 X**：[@AlchainHust](https://x.com/AlchainHust)
- **作者 B 站**：[花叔](https://space.bilibili.com/14097567)
