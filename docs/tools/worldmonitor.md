# worldmonitor Getting Started

> 整理日期：2026-03-10
> 仓库地址：https://github.com/koala73/worldmonitor
> 作者：Elie Habib (koala73)
> License：AGPL-3.0
> 在线版本：https://worldmonitor.app

---

## 项目简介

**World Monitor** 是一个实时全球态势感知仪表盘，集成了：
- AI 驱动的新闻聚合（435+ RSS feeds）
- 地缘政治监控（冲突、抗议、军事动态）
- 基础设施追踪（海底电缆、输油管道、军事基地）
- 金融市场数据（股票、加密货币、大宗商品）
- 互动地图（双引擎：3D 地球 + WebGL 平面地图，45 个可切换数据图层）

**定位**：免费开源的 OSINT（开源情报）工具，替代昂贵的商业情报平台。

**五大变体**（单一代码库 + 单一 Vercel 部署）：
| 变体 | URL | 专注领域 |
|------|-----|---------|
| World Monitor | worldmonitor.app | 地缘政治、军事、冲突 |
| Tech Monitor | tech.worldmonitor.app | AI/ML、初创公司、网络安全 |
| Finance Monitor | finance.worldmonitor.app | 全球市场、央行、海湾 FDI |
| Commodity Monitor | commodity.worldmonitor.app | 矿产、金属、能源大宗商品 |
| Happy Monitor | happy.worldmonitor.app | 正面新闻、保护、人类进步 |

---

## 项目结构

```
worldmonitor/
├── src/                    # 前端源码（Vanilla TypeScript）
│   ├── App.ts              # 应用入口
│   ├── components/         # UI 组件
│   ├── services/           # 数据服务层
│   ├── workers/            # Web Worker（ML 推理）
│   ├── config/             # 配置（地图图层定义等）
│   ├── generated/          # 从 .proto 自动生成的客户端/服务端代码
│   └── locales/            # 21 语言本地化文件
├── api/                    # 60+ Vercel Edge Functions（服务端）
├── server/                 # 共享服务器逻辑（gateway、缓存、handlers）
├── proto/                  # Protocol Buffer 定义（92 个 .proto 文件）
├── scripts/                # Railway relay、seed 脚本
├── src-tauri/              # Tauri 桌面应用（Rust）
├── docker/                 # Docker 镜像（frontend-only + nginx）
├── docs/                   # 详细文档（架构、算法、数据源等）
├── tests/                  # 单元测试（30 个文件，554 个测试用例）
├── data/                   # 静态数据（军事基地、金融中心等）
├── convex/                 # Convex 实时后端（可选）
└── vercel.json             # Vercel 部署配置
```

---

## 核心架构

### 1. 技术栈亮点

| 层次 | 技术选型 | 设计理由 |
|------|---------|---------|
| **前端** | Vanilla TypeScript（无框架）| 整个应用 shell < React 运行时体积 |
| **地图引擎** | globe.gl + Three.js（3D） + deck.gl + MapLibre（平面） | 运行时可切换，45 个共享数据图层 |
| **API 合约** | Protocol Buffers（proto-first）| 92 个 .proto 文件，自动生成 TypeScript client/server + OpenAPI 文档 |
| **部署** | 60+ Vercel Edge Functions | 每个 domain 独立入口，冷启动时间降低 85% |
| **缓存** | 3 层缓存（内存 → Upstash Redis → 上游） | 防止 thundering herd，stale-on-error 降级 |
| **AI** | Ollama（本地）→ Groq → OpenRouter → 浏览器 T5 | 4 级 fallback，本地优先，零 API key 也能工作 |
| **桌面端** | Tauri 2（Rust） | 原生 keychain 存储、本地 sidecar、OS 集成 |
| **浏览器 ML** | Transformers.js + ONNX Runtime | NER、情感分析、向量嵌入完全在浏览器运行 |

### 2. 数据流架构

```
外部数据源 (GDELT, ACLED, OpenSky, AIS, RSS...)
      ↓
Railway Relay（WebSocket 持久连接、Telegram MTProto、OREF 导弹警报）
      ↓
Vercel Edge Functions（60+ 端点，API key 隔离、Redis 缓存）
      ↓
Bootstrap Hydration（页面加载时 38 个数据集 = 2 次 HTTP 请求）
      ↓
SmartPollLoop（自适应轮询：指数退避 + 隐藏标签节流 + 断路器）
      ↓
Panel 系统（Vanilla TS Panel 基类，事件委托，虚拟滚动）
      ↓
双地图引擎（globe.gl 3D + deck.gl 平面，运行时切换）
```

### 3. 核心算法

**国家不稳定指数（CII）**：
```
CII = 基线风险(40%) + 骚乱(20%) + 安全(20%) + 信息速度(20%)
```
- 分数 0-100，颜色从绿（低）到深红（严重）
- 民主国家用 log(抗议次数)，威权国家用线性缩放（避免民主噪声）
- 使用 Welford 在线算法维护 Redis 中的滚动基线（O(1) 时空复杂度）

**热点升级评分**：
```
热点分 = 新闻(35%) + CII(25%) + 地理汇聚(25%) + 军事信号(15%)
```

**Bootstrap 水合**（首屏加速）：
```
38 个数据集 → 单次 Redis pipeline → 2 次 HTTP 请求 → 首屏快 2-4 秒
```

---

## 部署方式

### 方式一：直接访问线上版本（推荐，零配置）
访问 https://worldmonitor.app 即可，无需任何 API key。

### 方式二：Docker 部署（前端 + 使用公开 API）

```bash
# 拉取官方镜像（amd64/arm64 均支持）
docker pull ghcr.io/koala73/worldmonitor:latest

# 运行（默认使用 api.worldmonitor.app 作为后端）
docker run -d --name worldmonitor -p 3000:80 ghcr.io/koala73/worldmonitor:latest

# 访问
open http://localhost:3000
```

> Docker 镜像是 **前端 only**（nginx + 静态文件），通过反向代理将 `/api/*` 转发给上游 API。
> 地图交互、静态图层、浏览器端 ML 完全可用；实时数据需要上游 API 连接。

### 方式三：Vercel 部署（推荐自托管完整版）

```bash
git clone https://github.com/koala73/worldmonitor.git
cd worldmonitor
npm install -g vercel
cp .env.example .env.local   # 按需填写 API keys
vercel                       # 首次部署，跟随提示操作
```

⚠️ 必须用 `vercel dev`（本地开发），不能用 `npm run dev`——后者只启动 Vite 前端，所有 `/api/*` 边缘函数不会运行。

### 方式四：静态前端（地图 + 客户端 ML，无新闻数据）

```bash
npm install
npm run dev     # http://localhost:5173，仅前端
```

### 环境变量（可选）

| 分组 | 变量 | 免费额度 |
|------|------|---------|
| **AI（本地）** | `OLLAMA_API_URL`, `OLLAMA_MODEL` | 免费（本地运行） |
| **AI（云端）** | `GROQ_API_KEY`, `OPENROUTER_API_KEY` | 14,400 req/day (Groq) |
| **缓存** | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | 10K 命令/天 |
| **市场数据** | `FINNHUB_API_KEY`, `FRED_API_KEY`, `EIA_API_KEY` | 全部免费 |
| **地缘政治** | `ACLED_ACCESS_TOKEN`, `NASA_FIRMS_API_KEY` | 研究用途免费 |

---

## Demo 示例

### 公开 API 调用（无需 API key）

使用 `api.worldmonitor.app`（注意不是 `worldmonitor.app`，后者需要浏览器 Origin 头）：

```bash
# 地震数据
curl -s 'https://api.worldmonitor.app/api/seismology/v1/list-earthquakes' | python3 -m json.tool | head -30

# 机场延误
curl -s 'https://api.worldmonitor.app/api/aviation/v1/list-airport-delays'

# 气候异常
curl -s 'https://api.worldmonitor.app/api/climate/v1/list-climate-anomalies'

# 公司信息查询
curl -s 'https://api.worldmonitor.app/api/enrichment/company?domain=stripe.com'

# 公司信号（融资/裁员/高管变动）
curl -s 'https://api.worldmonitor.app/api/enrichment/signals?company=Stripe&domain=stripe.com'
```

### 实际 API 响应示例（地震数据）

```json
{
  "earthquakes": [
    {
      "id": "us7000s398",
      "place": "249 km WNW of Houma, Tonga",
      "magnitude": 4.8,
      "depthKm": 561.355,
      "location": { "latitude": -20.3054, "longitude": -177.5134 },
      "occurredAt": 1773093827360,
      "sourceUrl": "https://earthquake.usgs.gov/earthquakes/eventpage/us7000s398"
    }
  ]
}
```

所有端点模式：`POST /api/{domain}/v1/{rpc-name}`，支持 GET（只读 RPC）。

---

## 关键发现 / 学习心得

### 1. 「无框架」是刻意的设计决策
整个前端不用 React/Vue/Svelte，完全 Vanilla TypeScript + 直接 DOM 操作。理由很务实：
- 应用 shell 比 React 运行时还小
- 更好的 Tauri WebView 兼容性
- 无框架升级负担

用 `Panel` 基类 + 事件委托 + `SmartPollLoop` 自建了一套轻量级"框架"。

### 2. Proto-First 的工程化价值
92 个 .proto 文件定义所有 API 合约，自动生成 TypeScript 客户端/服务端 + OpenAPI 文档。这让 22 个服务域的 schema 永远不会漂移，并且 CI 中用 `buf breaking` 自动检测破坏性变更。

### 3. Bootstrap 水合是首屏性能关键
页面加载时把 38 个常用数据集压缩成 2 次 HTTP 请求（fast tier + slow tier），通过单次 Upstash Redis pipeline 完成。相比 38 次独立请求，节省 2-4 秒首屏时间。

### 4. 智能算法细节值得借鉴
- **Welford 在线算法**：O(1) 时空维护统计基线，避免在 Redis 中存历史数据
- **H3 六边形网格**：GPS 干扰检测用六边形而非方形网格，因为六边形相邻性均匀（6 邻居 vs 方形的 4/8）
- **对数缩放抗议**：民主国家抗议用 log 缩放，威权国家用线性，防止民主"噪声"淹没真正的不稳定信号

### 5. 多变体单部署架构
5 个不同主题的仪表盘（World/Tech/Finance/Commodity/Happy）共享单一 Vercel 部署，通过 hostname 运行时路由。构建时 `VITE_VARIANT` 做 tree-shaking。这让 CDN 命中率提升 4x，CI pipeline 也只需维护一套。

### 6. 完整的安全防御体系
从 CORS origin 白名单、RSS domain 白名单、服务端 API key 隔离，到桌面端 Tauri IPC 窗口硬化 + OS keychain 存储。SSRF 防护做了两阶段校验（协议白名单 → 私有 IP 拒绝 → DNS rebinding 检测）。

---

## 参考资源

- 官方文档：https://github.com/koala73/worldmonitor/blob/main/docs/DOCUMENTATION.md
- 架构详解：`docs/ARCHITECTURE.md`
- AI 智能系统：`docs/AI_INTELLIGENCE.md`
- 算法文档：`docs/ALGORITHMS.md`
- 数据源：`docs/DATA_SOURCES.md`
- 地图引擎：`docs/MAP_ENGINE.md`
- 桌面应用：`docs/DESKTOP_APP.md`
- API 公开端点：https://api.worldmonitor.app
