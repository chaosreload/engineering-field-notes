# ai-hedge-fund Getting Started

> 整理日期：2026-03-13
> 仓库地址：https://github.com/virattt/ai-hedge-fund

## 项目简介

AI Hedge Fund 是一个 **教育目的** 的 AI 驱动模拟对冲基金。核心思路是：用多个 LLM Agent 模拟不同投资大师的分析风格，对股票发出 bullish/bearish/neutral 信号，再经过 Risk Manager 控仓，最终由 Portfolio Manager 做出交易决策（不实际交易）。

适合场景：
- 学习 LangGraph 多 Agent 工作流
- 了解量化投资信号生成逻辑
- 研究如何用 LLM 模拟真实投资哲学

**注意**：不适合实际投资，仅供研究学习。

---

## 项目结构

```
ai-hedge-fund/
├── src/
│   ├── main.py              # 入口，构建并运行 LangGraph workflow
│   ├── backtester.py        # 回测入口
│   ├── agents/              # 各投资大师 Agent（16个+）
│   │   ├── warren_buffett.py
│   │   ├── ben_graham.py
│   │   ├── cathie_wood.py
│   │   ├── portfolio_manager.py
│   │   ├── risk_manager.py
│   │   └── ... (共18个文件)
│   ├── graph/
│   │   └── state.py         # AgentState TypedDict 定义
│   ├── tools/
│   │   └── api.py           # 金融数据 API 封装（financial-datasets.ai）
│   ├── backtesting/         # 回测引擎（engine/portfolio/metrics/trader）
│   ├── llm/
│   │   ├── models.py        # 多模型支持（OpenAI/Anthropic/Groq/DeepSeek/Ollama/xAI等）
│   │   ├── api_models.json  # 云端模型列表
│   │   └── ollama_models.json
│   ├── data/
│   │   ├── cache.py         # API 结果缓存
│   │   └── models.py        # Pydantic 数据模型
│   ├── utils/
│   │   ├── analysts.py      # ANALYST_CONFIG 注册表（单一数据源）
│   │   ├── llm.py           # call_llm 统一接口
│   │   └── ...
│   └── cli/
│       └── input.py         # CLI 参数解析
├── app/                     # FastAPI 后端 + Web UI（全栈应用）
├── tests/                   # 测试（含 API rate limiting 测试）
├── docker/                  # Docker 部署方案
├── pyproject.toml           # Poetry 依赖管理
└── .env.example
```

---

## 核心架构

### 整体架构：LangGraph StateGraph

```
                     ┌─────────────────────────────┐
                     │         start_node           │
                     └────────────┬────────────────┘
                                  │ (fan-out)
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                   ▼
    warren_buffett_agent   ben_graham_agent   cathie_wood_agent ...
    (并行执行，16个分析师 Agent)
              │                  │                   │
              └──────────────────┼──────────────────┘
                                  │ (fan-in)
                     ┌────────────▼────────────────┐
                     │     risk_management_agent    │
                     └────────────┬────────────────┘
                                  │
                     ┌────────────▼────────────────┐
                     │      portfolio_manager       │
                     └────────────┬────────────────┘
                                  │
                                 END
```

### 状态模型（AgentState）

```python
class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], operator.add]  # 消息追加
    data: Annotated[dict, merge_dicts]    # tickers/portfolio/analyst_signals 等
    metadata: Annotated[dict, merge_dicts]  # model_name/provider/show_reasoning
```

### 数据流

1. 用户输入 tickers + 时间段
2. 各分析师 Agent **并行**拉取金融数据（financial-datasets.ai API）
3. 每个 Agent 做量化分析 → 调用 LLM → 输出 `{signal, confidence, reasoning}`
4. 所有信号写入 `state["data"]["analyst_signals"]`
5. Risk Manager 汇总所有信号，计算 position limits
6. Portfolio Manager 获得完整信号 + 风险限制 → LLM 最终决策 → 输出交易指令 JSON

---

## 投资 Agent 列表（16个）

| Agent | 原型 | 分析风格 |
|-------|------|---------|
| Warren Buffett | 奥马哈先知 | 基本面 + 护城河 + 内在价值 DCF |
| Ben Graham | 价值投资之父 | 低 P/B、安全边际 |
| Charlie Munger | 芒格 | 优质企业 + 合理价格 |
| Bill Ackman | 激进投资者 | 激进主义 + 逆向 |
| Cathie Wood | ARK | 颠覆性创新 + 高成长 |
| Michael Burry | 大空头 | 深度逆向 + 做空 |
| Peter Lynch | 10-bagger | 生活中找投资，PEG |
| Phil Fisher | 费雪 | 深度尽调（scuttlebutt） |
| Mohnish Pabrai | Dhandho | 低风险双倍回报 |
| Aswath Damodaran | 估值教授 | 故事+数字，严格 DCF |
| Stanley Druckenmiller | 宏观传奇 | 宏观 + 非对称机会 |
| Rakesh Jhunjhunwala | 印度大牛 | 新兴市场 + 宏观 |
| Technical Analyst | — | 技术指标 + 形态 |
| Fundamentals Analyst | — | 财务报表分析 |
| Growth Analyst | — | 成长趋势 + 估值 |
| News Sentiment Analyst | — | 新闻情绪分析 |
| Sentiment Analyst | — | 市场情绪 |
| Valuation Analyst | — | 多模型估值 |

---

## Warren Buffett Agent 的分析逻辑（作为代表示例）

每个分析师的分析流程大体相似：

1. **量化打分**（规则驱动）
   - `analyze_fundamentals()` — ROE、债务/净资产、营业利润率、流动比率
   - `analyze_moat()` — ROE 一致性、利润率稳定性、资产效率
   - `analyze_management_quality()` — 回购 vs 增发、分红
   - `analyze_pricing_power()` — 毛利率趋势
   - `analyze_book_value_growth()` — 每股净资产 CAGR
   - `calculate_intrinsic_value()` — 三阶段 DCF（Owner Earnings 法）

2. **LLM 生成最终信号**
   - 将量化结果作为 `facts` 传给 LLM
   - LLM 扮演 Warren Buffett 角色，输出 `{signal, confidence, reasoning}`

3. **Pydantic 结构化输出验证**

---

## 核心工作流程

```
用户执行：poetry run python src/main.py --ticker AAPL,MSFT,NVDA

1. parse_cli_inputs()  →  获取参数（tickers, dates, model, analysts）
2. 构建 portfolio dict（初始资金, positions, realized_gains）
3. create_workflow()   →  注册分析师节点到 StateGraph
4. agent.invoke()      →  驱动整个图执行
   ├── [并行] 16个分析师 Agent → 各自拉数据 + LLM分析 → 存 analyst_signals
   ├── risk_management_agent → 读取所有信号 → 计算 position limits / VaR
   └── portfolio_management_agent → 综合决策 → 输出 JSON 交易指令
5. print_trading_output()  →  格式化打印结果
```

### 回测模式

```
poetry run python src/backtester.py --ticker AAPL --start-date 2024-01-01 --end-date 2024-12-31

backtesting/engine.py 按日期遍历：
  每日 → run_hedge_fund() → 生成决策 → backtesting/trader.py 模拟成交
  结束 → backtesting/metrics.py 计算 Sharpe/最大回撤/总收益 等
  结果 vs benchmark（SPY 等）对比
```

---

## 部署步骤

### 环境要求
- Python ^3.11
- Poetry
- LLM API Key（至少一个：OpenAI / Anthropic / Groq / DeepSeek 等）
- Financial Datasets API Key（AAPL/GOOGL/MSFT/NVDA/TSLA 免费，其他需要）

### 安装

```bash
git clone https://github.com/virattt/ai-hedge-fund.git
cd ai-hedge-fund

# 安装 Poetry（如未安装）
curl -sSL https://install.python-poetry.org | python3 -

# 安装依赖
poetry install

# 配置 API Keys
cp .env.example .env
# 编辑 .env，填入 OPENAI_API_KEY 等
```

### CLI 运行

```bash
# 基本运行（使用所有分析师）
poetry run python src/main.py --ticker AAPL,MSFT,NVDA

# 指定时间段
poetry run python src/main.py --ticker AAPL --start-date 2024-01-01 --end-date 2024-03-01

# 使用本地 LLM（Ollama）
poetry run python src/main.py --ticker AAPL --ollama

# 显示推理过程
poetry run python src/main.py --ticker AAPL --show-reasoning

# 回测
poetry run python src/backtester.py --ticker AAPL,MSFT --start-date 2024-01-01 --end-date 2024-12-31
```

### Web 应用

```bash
# 详见 app/README.md
# FastAPI 后端 + 前端 Web UI
```

### Docker

```bash
# 见 docker/ 目录
```

---

## 关键发现 / 学习心得

### 1. 架构亮点：LangGraph Fan-out/Fan-in
所有分析师 Agent 从 `start_node` 并行 fan-out，汇聚到 `risk_manager` 做 fan-in。这是 LangGraph 最典型的多 Agent 并行模式，代码非常简洁：
```python
for analyst_key in selected_analysts:
    workflow.add_edge("start_node", node_name)  # fan-out
    workflow.add_edge(node_name, "risk_management_agent")  # fan-in
```

### 2. 分析逻辑分离得很好
每个分析师 Agent 分两步：
- **量化分析**（纯 Python 规则，可测试）
- **LLM 生成信号**（传入 facts，不让 LLM 幻觉数据）

这种"规则提取数据 → LLM 只做判断"的模式值得学习。

### 3. 单一数据源设计
`ANALYST_CONFIG` 字典是分析师注册的唯一数据源，UI、API、workflow 都从这里取，避免了多处维护的问题。典型的 DRY 原则。

### 4. 模型支持全面
支持 OpenAI、Anthropic、Groq、DeepSeek、xAI、Google Gemini、GigaChat、Ollama（本地），通过 LangChain 统一封装。切换模型只需改 `--model` 和 `--provider` 参数。

### 5. Warren Buffett Agent 的 DCF 细节
用"Owner Earnings"而不是净利润做 DCF 基础（更接近 Buffett 原意），三阶段增长模型（高速→过渡→终值），并对历史增长率做 30% haircut + cap。这些细节相当讲究。

### 6. 局限性
- 金融数据 API 依赖 `financial-datasets.ai`，免费 tickers 只有 5 个（AAPL/GOOGL/MSFT/NVDA/TSLA）
- 每次调用都会消耗大量 LLM tokens（16个 Agent × N个 tickers）
- "模拟"投资大师风格有一定戏剧性成分，不可过度信任信号质量

---

## 参考资源

- 仓库：https://github.com/virattt/ai-hedge-fund
- LangGraph 文档：https://langchain-ai.github.io/langgraph/
- financial-datasets API：https://financial-datasets.ai
- 作者 Twitter：https://twitter.com/virattt
