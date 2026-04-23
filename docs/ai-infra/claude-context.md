# claude-context Getting Started

> 整理日期：2026-04-23
> 仓库地址：https://github.com/zilliztech/claude-context

## 项目简介

**claude-context** 是 Zilliz（Milvus 背后的公司）开源的一个 **MCP plugin**，给 Claude Code、Cursor、Gemini CLI、Codex、Qwen Code 等 AI coding agent 补上「语义代码搜索」能力——把整个 codebase 向量化塞进 Milvus/Zilliz Cloud，agent 遇到问题时一次性捞出相关代码片段作为上下文。

解决的核心问题是 **agent 读代码成本**：不走 grep+多轮 discovery、也不把整个目录塞 prompt，而是用 embedding + vector search 直接命中相关 chunk。按官方定位：

> *Your entire codebase as Claude's context.*

典型用法是跑在 `npx @zilliz/claude-context-mcp@latest`，通过 MCP 向 agent 暴露 4 个 tool：`index_codebase`、`search_code`、`get_indexing_status`、`clear_index`。

## 项目结构

monorepo（pnpm workspace），4 个 package + 1 个 python 桥接：

```
packages/
├── core/                  # 核心库 @zilliz/claude-context-core
│   └── src/
│       ├── context.ts     # Context 主类（编排 splitter + embedding + vectordb）
│       ├── embedding/     # OpenAI / Gemini / Ollama / VoyageAI 四家 provider
│       ├── vectordb/      # Milvus (gRPC + REST) + Zilliz 工具
│       ├── splitter/      # AST splitter（tree-sitter）+ LangChain fallback
│       └── sync/          # Merkle DAG 增量同步
├── mcp/                   # @zilliz/claude-context-mcp（MCP server，stdio）
├── vscode-extension/      # semanticcodesearch VS Code 插件
└── chrome-extension/      # 浏览器插件
python/                    # 纯桥接脚本（ts-node 执行），不是独立 SDK
```

最关键的是 `packages/core`——mcp / vscode-extension / python 都是围绕它的壳。

## 核心架构

```
┌─────────────────────┐
│  AI coding agent    │  Claude Code / Cursor / Codex / ...
│  (MCP client)       │
└──────────┬──────────┘
           │ stdio (MCP 协议)
┌──────────▼──────────┐
│  claude-context-mcp │  4 个 tool：index / search / status / clear
│  server             │
└──────────┬──────────┘
           │ 调用 Context 类
┌──────────▼──────────────────────────────────────┐
│  @zilliz/claude-context-core                    │
│                                                 │
│  ① Splitter (AST)  — tree-sitter 按 function /   │
│      class / interface 边界切 2500 字符 chunk    │
│      不支持的语言 → LangChain splitter fallback  │
│                                                 │
│  ② Embedding — OpenAI / Gemini / Ollama /        │
│      VoyageAI 任选                              │
│                                                 │
│  ③ VectorDB — Milvus / Zilliz Cloud             │
│      hybrid search（向量 + BM25）               │
│                                                 │
│  ④ FileSynchronizer — Merkle DAG 做增量          │
│      基于每个文件 SHA256 的 hash 构建 DAG        │
│      只重新 embed 变动 chunk                     │
└──────────────────────────────────────────────────┘
```

四条流水线互相解耦：你可以换 embedding provider（OpenAI → Ollama 本地模型）、换 vectordb（Milvus 自建 → Zilliz Cloud）、splitter 不支持的语言自动降级。

## 核心工作流程

### 1. 索引（index_codebase）

官方文档把它定位成「**asynchronous indexing**」：

1. Agent 调 `index_codebase(path)`，MCP server **立刻返回** `{status: "indexing", progress: 0}`
2. 后台启动索引：
   - `FileSynchronizer` 遍历目录，按 `DEFAULT_SUPPORTED_EXTENSIONS` + `.gitignore` 风格 `ignorePatterns` 筛文件
   - 每个文件算 SHA256 挂到 `MerkleDAG` 上，snapshot 落盘到 `~/.context/merkle/<md5(absolute path)>.json`
   - 每个文件过 `AstCodeSplitter`：tree-sitter 解析 AST，按 `SPLITTABLE_NODE_TYPES[lang]`（function / class / interface / method 等）切 chunk，默认 `chunkSize=2500`、`chunkOverlap=300`
   - 批量调 embedding provider 算向量
   - 写入 Milvus collection（名字来自 absolute path 的规范化 hash）
3. Agent 可以随时查 `get_indexing_status` 拿进度；索引中也可 `search_code` 拿部分结果

进度是**阶段性**的：0% 准备 collection → 5% 扫文件 → 10-100% chunk + embed + 写库。大库会在 10% 停很久再快速推到 100%，这是正常的。

### 2. 搜索（search_code）

```
agent → search_code(path, query, limit=10)
      → Context 拿 query embedding
      → Milvus hybrid search（vector similarity + BM25 keyword）
      → 返回 top N chunk，每条带：
         - 代码内容
         - 文件路径 + 起止行号
         - 相似度分数
```

Hybrid search 里 BM25 分量是为了召回那些 embedding 模型容易丢掉的精确关键词（变量名、错误字符串、API 名）。

### 3. 增量同步（Merkle DAG）

这个是 claude-context 比「普通 RAG」讲究的地方：

- 每次索引/搜索前，`FileSynchronizer.checkForChanges()` 重新遍历目录生成新 DAG
- `MerkleDAG.compare(oldDAG, newDAG)` 拿到 `{added, removed}` 集合
- 只对差集做：
  - 新增文件 → split + embed + insert
  - 删除文件 → 按 filePath 从 collection 删
  - 修改文件 → 先按 filePath 删旧 chunk，再 split + embed + insert 新 chunk

大仓库第一次索引慢，但之后每次都只处理变动文件，不会整库重算。

### 4. Codebase 身份识别

Collection 是按 **resolved absolute path** 区分的。同一仓库从不同路径（symlink / 不同 clone / mount）访问会被当成两个 codebase，各自独立索引。这个设计简单粗暴但可预测——dive-deep 文档专门强调：`index_codebase` / `search_code` / `clear_index` / `get_indexing_status` 都用**同一个绝对路径**，不然拿不到正确结果。

## 部署步骤

### 环境要求

- Node.js **≥ 20.0.0 且 < 24.0.0**（README 明确写了，Node 24 不兼容）
- pnpm ≥ 10
- 一个 Milvus 实例：**Zilliz Cloud free tier** 最省事，或自建 Milvus `localhost:19530`
- 一个 embedding provider 的 key：OpenAI / Gemini / VoyageAI 或本地 Ollama

### 最快的玩法（给 Claude Code 加能力）

```bash
claude mcp add claude-context \
  -e OPENAI_API_KEY=sk-your-openai-api-key \
  -e MILVUS_ADDRESS=your-zilliz-cloud-public-endpoint \
  -e MILVUS_TOKEN=your-zilliz-cloud-api-key \
  -- npx @zilliz/claude-context-mcp@latest
```

然后在 Claude Code 里一句「index this codebase」，后台就开始跑了。

### 本地开发构建（我本次用的方式）

本次我只做了 core package 的本地构建 + 一个不需要外部依赖的 demo，没拉起完整 MCP server：

```bash
# dev-server 上
cd /data/projects/chaosreload/study/repo/public/claude-context
nvm use 22.22.0
pnpm install
pnpm approve-builds --all   # tree-sitter-* 需要 native build
pnpm rebuild                 # 编译 tree-sitter 原生模块
pnpm build:core              # 编译 @zilliz/claude-context-core
```

**踩坑 1**：dev-server 默认是 Node 24.14.0，直接跑会在 tree-sitter native addon 加载时报错。`nvm use 22.22.0` 切过去就好。

**踩坑 2**：pnpm 10 默认不跑 `postinstall` 脚本（出于安全考虑），需要显式 `pnpm approve-builds --all` + `pnpm rebuild`，否则 tree-sitter 的 `.node` 二进制不会被构建，splitter 一调就崩。

**踩坑 3**：完整体验需要 Milvus 实例。Zilliz Cloud free tier 最省，但生产/评测时要注意 embedding 成本——OpenAI `text-embedding-3-small` 对中等 codebase（~10 万 chunk）一次全量索引也就几块钱量级，但大仓库（monorepo、million LoC）要小心 rate limit 和预算。

## Demo 示例

跳过「要 OpenAI key + Milvus」的完整路径，我做了一个**纯本地 demo**，直接跑 core 里最独立的一个组件——`AstCodeSplitter`，展示「代码怎么被切块」这一步：

`demo-splitter.mjs`：喂 Python / TypeScript / Ruby 三段代码，看 splitter 产出什么。

关键代码：

```js
import { AstCodeSplitter } from '@zilliz/claude-context-core';

const splitter = new AstCodeSplitter(2500, 300);

const pyChunks = await splitter.split(pythonSource, 'python', 'sample.py');
// chunkSize=2500 chars, chunkOverlap=300 chars
```

### 实际运行结果

```
=== Python 示例 ===
🌳 Using AST splitter for python file: sample.py
分出 6 个 chunk
--- chunk[0] lines 5-20 (440 chars) ---  # class TaskQueue 整体
--- chunk[1] lines 1-9 (409 chars) ---   # __init__ + push
--- chunk[2] lines 8-15 (265 chars) ---  # __init__ + push 片段（overlap）
--- chunk[3] lines 12-20 (269 chars) --- # push + pop
--- chunk[4] lines 18-25 (263 chars) --- # pop + async process_task
--- chunk[5] lines 23-35 (312 chars) --- # process_task + main

=== TypeScript 示例 ===
🌳 Using AST splitter for typescript file: sample.ts
分出 8 个 chunk  (interface User / class UserRepo / fetchUser / type UserId)

=== 不支持的语言会 fallback 到 LangChainCodeSplitter ===
📝 Language ruby not supported by AST, using LangChain splitter for: sample.rb
Ruby fallback 分出 1 个 chunk
```

有几个细节从输出里能看出来：

1. **Chunk 边界卡 AST 节点**，不是简单按行切。Python 里一个 `class TaskQueue { ... }` 作为独立 chunk（chunk[0]）；TS 里 `interface User`、`class UserRepo`、顶层 `fetchUser`、`type UserId` 都各自成块。
2. **chunkOverlap=300 真的有效**。chunk[1] 末尾 `self.tasks.append(task)` 和 chunk[2] 开头的 `__init__` 段是重叠的——这样搜索时跨边界的语义不会断裂。
3. **不支持的语言 silently fallback**，不是硬报错。AST splitter 识别 js/ts/py/java/cpp/go/rust/csharp/scala 共 9 种，剩下的（ruby/php/swift/kotlin/...）走 LangChain 的 `RecursiveCharacterTextSplitter` 按字符递归切。

完整输出在 `dev-server:/data/projects/chaosreload/study/demo/claude-context/demo-output.txt`。

## 关键发现 / 学习心得

**1. 把「代码 RAG」的工程细节都摊开写清楚了。** 相比很多 vibe-based「给 agent 接个 vector search 就行了」的项目，claude-context 在几个具体问题上有明确的决策：
- **切块**走 AST 而不是按行/字符，保证 chunk 是语义完整单元
- **增量**用 Merkle DAG，不用 git diff（因为有些场景没 git，或者用户改了没提交）
- **召回**用 hybrid search（向量 + BM25），关键词类 query 不会被 dense embedding 吃掉
- **路径**按 absolute path 作为 codebase 身份，牺牲灵活性换可预测

**2. Node 版本 < 24 是强约束，不是「建议」。** README 专门写了一行。原因是 tree-sitter 的 native binding 在 Node 24 上有兼容问题。任何人部署这类 native-module 密集型 MCP server，都该提前锁 Node 版本。

**3. Snapshot 0/0 是坑。** 我在 `handlers.ts` 里看到一段 Issue #295 相关的长注释：老版本 MCP 在 snapshot 里写过 `{ indexedFiles: 0, totalChunks: 0, status: 'completed' }`，客户端会把 0/0 当「没索引」，触发 force reindex，又把 0/0 写回去——无限循环。现在的版本有 `validateLegacyZeroEntries()` 启动时专门扫这种幽灵 entry，要么从 Milvus 实际行数里修复、要么删掉。

这个 issue 本身不算大 bug，但暴露了**本地 snapshot ↔ 远端向量库**的状态同步是这类产品最难做对的地方。可以单独写一篇 post-mortem。

**4. Python SDK 其实是「TS 桥接器」。** `python/README.md` 写得很直白：*"不是完整 SDK，只是一个简单的 bridge for testing purposes"*。真要用 Python 原生调 Milvus 做 codebase RAG，claude-context 不是你要找的项目——这本质是一个 Node/TS 生态里的产品。

**5. 和 GitNexus / aider 那种 AST 索引 + 调用图的路线不同。** claude-context 只做 embedding search，不建 call graph / symbol graph。好处是简单、语言无关、对 LLM 召回友好；坏处是回答「这个函数谁调用了」这种结构性问题没 GitNexus 那么直接。两个路线各有定位，可以互补。

## 参考资源

- 官方文档（dive-deep）：
  - <https://github.com/zilliztech/claude-context/blob/main/docs/dive-deep/asynchronous-indexing-workflow.md> — 异步索引生命周期
  - <https://github.com/zilliztech/claude-context/blob/main/docs/dive-deep/file-inclusion-rules.md> — ignore/supported-extensions 规则
- DeepWiki AI 文档：<https://deepwiki.com/zilliztech/claude-context>
- npm 包：[@zilliz/claude-context-core](https://www.npmjs.com/package/@zilliz/claude-context-core) · [@zilliz/claude-context-mcp](https://www.npmjs.com/package/@zilliz/claude-context-mcp)
- VS Code 插件：[semanticcodesearch](https://marketplace.visualstudio.com/items?itemName=zilliz.semanticcodesearch)
- Zilliz Cloud（最简部署的 Milvus）：<https://cloud.zilliz.com/>
- 关键 issue：[#295 — 0/0 snapshot 自我毁灭](https://github.com/zilliztech/claude-context/issues/295)
