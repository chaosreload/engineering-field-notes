# Lightpanda Browser Getting Started

> 整理日期：2026-03-22
> 仓库地址：https://github.com/lightpanda-io/browser
> ⭐ Stars：23,336 | 语言：Zig | License：AGPL-3.0

---

## 项目简介

Lightpanda 是一个**从零开始用 Zig 编写的 headless browser**，专为 AI agent、自动化、LLM 训练和爬虫设计。

核心卖点：
- **11x faster than Chrome**（相同任务执行速度）
- **9x less memory than Chrome**（内存占用）
- **Instant startup**（不需要 Chromium 那样的庞大初始化）
- 通过 CDP 协议兼容 Playwright、Puppeteer、chromedp

定位：Chrome 不是为 headless 设计的，它太重了。Lightpanda 是 headless-first，去掉了图形渲染，保留了 JS 执行和 Web API 覆盖。

---

## 核心架构

```
main.zig
  └── App.zig          # 应用入口，管理全局状态
      ├── browser/
      │   ├── Browser.zig        # Browser 实例（包含 JS Env + Session）
      │   ├── Page.zig           # 页面生命周期（导航、解析、脚本执行）
      │   ├── Session.zig        # 会话管理
      │   ├── ScriptManager.zig  # JS 脚本队列和执行调度
      │   ├── EventManager.zig   # 事件系统
      │   ├── HttpClient.zig     # HTTP 客户端（基于 libcurl）
      │   ├── js/                # V8 JS 引擎 Zig bindings
      │   │   ├── Env.zig        # V8 Isolate/Context 管理
      │   │   ├── Isolate.zig    # V8 Isolate 封装
      │   │   └── ...            # Value, Object, Promise 等类型
      │   ├── webapi/            # Web API 实现（72 个文件）
      │   │   ├── Window.zig, Document.zig, Element.zig
      │   │   ├── Fetch.zig, XHR.zig（Ajax 支持）
      │   │   ├── MutationObserver.zig, IntersectionObserver.zig
      │   │   └── ...（DOM API 完整实现）
      │   └── parser/            # HTML 解析（基于 html5ever）
      ├── cdp/                   # Chrome DevTools Protocol 服务端
      │   ├── cdp.zig            # CDP 协议入口
      │   └── domains/           # CDP Domains 实现
      │       ├── page.zig, runtime.zig, dom.zig
      │       ├── network.zig, fetch.zig, input.zig
      │       └── ...
      └── mcp/                   # MCP 协议支持（Model Context Protocol）
          ├── Server.zig
          ├── tools.zig, resources.zig
          └── protocol.zig
```

### 数据流：页面加载

```
用户调用（fetch/serve/mcp）
  → App 初始化（GPA allocator）
  → Browser.init()（V8 Env + HttpClient）
  → Page.navigate(url)
    → HttpClient.get(url)（libcurl）
    → Parser.parse(html)（html5ever）
    → DOM Tree 构建
    → ScriptManager 收集脚本标签
    → JS Env.execute(scripts)（V8）
      → XHR/Fetch API 触发新 HTTP 请求
      → DOM API 修改文档树
    → 等待 networkidle/load 事件
  → dump（html/markdown/semantic_tree）或 CDP server 接管
```

### 关键设计决策

1. **Zig 语言选择**：系统级语言，手动内存管理，在 Debug 模式用 GeneralPurposeAllocator 检测内存泄漏，Release 用 C allocator。
2. **V8 而不是自建 JS 引擎**：JS 覆盖率太重要，用 V8 确保兼容性，通过 zig-v8-fork 封装。
3. **html5ever 而不是自建 HTML 解析器**：Rust 生态成熟的 HTML 解析器，通过 Zig 的 C FFI 调用。
4. **libcurl**：成熟可靠的 HTTP 客户端，支持代理、Cookie、自定义 Header。

---

## 功能支持状态

已实现（Beta）：
- ✅ HTTP loader（libcurl，支持代理/Cookie/自定义 Header）
- ✅ HTML parser（html5ever）
- ✅ DOM tree + DOM APIs
- ✅ JavaScript 执行（V8）
- ✅ XHR API / Fetch API（Ajax 完整支持）
- ✅ CDP/WebSockets server（Playwright/Puppeteer 兼容）
- ✅ Click / Input form
- ✅ Cookies / Network interception
- ✅ robots.txt 遵守（`--obey_robots`）
- ✅ MCP Server 支持（AI agent 集成）

Web API 覆盖 72 个接口，包括：
- MutationObserver, IntersectionObserver, PerformanceObserver
- Shadow DOM, Custom Elements
- Storage API, History API
- Crypto, FileReader, ImageData

---

## 快速上手

### 安装

```bash
# Linux x86_64
curl -L -o lightpanda \
  https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-x86_64-linux
chmod a+x ./lightpanda

# macOS aarch64
curl -L -o lightpanda \
  https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-aarch64-macos
chmod a+x ./lightpanda

# Docker
docker run -d --name lightpanda -p 9222:9222 lightpanda/browser:nightly
```

### 三种运行模式

#### 1. fetch 模式 — 抓取并导出内容

```bash
# Markdown 导出（AI-friendly）
./lightpanda fetch --dump markdown --log_level warn https://example.com

# HTML 导出
./lightpanda fetch --dump html https://example.com

# Semantic tree（DOM 结构 JSON，适合 AI agent 分析页面）
./lightpanda fetch --dump semantic_tree https://example.com

# 等待 JS 完全加载
./lightpanda fetch --dump markdown --wait_until networkidle https://spa-site.com

# 禁用 telemetry
LIGHTPANDA_DISABLE_TELEMETRY=true ./lightpanda fetch --dump markdown https://example.com
```

#### 2. serve 模式 — CDP 服务端（Puppeteer/Playwright 兼容）

```bash
# 启动 CDP server
./lightpanda serve --host 127.0.0.1 --port 9222

# 验证运行
curl http://127.0.0.1:9222/json/version
# 返回：{"webSocketDebuggerUrl": "ws://127.0.0.1:9222/"}
```

Puppeteer 连接示例：

```javascript
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({
  browserWSEndpoint: "ws://127.0.0.1:9222",
});

const context = await browser.createBrowserContext();
const page = await context.newPage();
await page.goto('https://example.com', {waitUntil: "networkidle0"});

const links = await page.evaluate(() =>
  Array.from(document.querySelectorAll('a')).map(a => a.href)
);
console.log(links);

await page.close();
await context.close();
await browser.disconnect();
```

#### 3. mcp 模式 — Model Context Protocol Server

```bash
./lightpanda mcp
# 通过 stdio 提供 MCP server，AI agent 可直接调用
```

---

## Demo 运行结果

**环境**：dev-server（Linux x86_64），nightly binary

```bash
# Demo 1: Markdown Dump
$ ./lightpanda fetch --dump markdown --log_level warn https://example.com

# Example Domain
This domain is for use in documentation examples...
[Learn more](https://iana.org/domains/example)

# Demo 2: HN JS 执行测试（networkidle 等待）
$ ./lightpanda fetch --dump markdown --wait_until networkidle https://news.ycombinator.com
# → 成功渲染 30 条新闻，JS 完全执行（XHR/fetch 请求完成）

# Demo 3: CDP Server
$ ./lightpanda serve --host 127.0.0.1 --port 9222 &
$ curl -s http://127.0.0.1:9222/json/version
{
    "webSocketDebuggerUrl": "ws://127.0.0.1:9222/"
}
```

Demo 脚本：`/home/ubuntu/chaosreload/study/demo/browser/demo.sh`

---

## 源码编译

> ⚠️ 需要 Zig 0.15.2，编译时间较长（需要编译 V8）

```bash
# 依赖（Ubuntu/Debian）
sudo apt install xz-utils ca-certificates pkg-config libglib2.0-dev clang make curl git
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh  # Rust for html5ever

# 构建
zig build run

# Release 构建（更快）
zig build -Doptimize=ReleaseFast run

# 嵌入 V8 snapshot（加快启动）
zig build snapshot_creator -- src/snapshot.bin
zig build -Dsnapshot_path=../../snapshot.bin
```

---

## 关键发现 / 学习心得

1. **真正的性能优势来自架构选择**：不做图形渲染，砍掉浏览器里 AI/自动化场景不需要的一切（扩展、UI 线程、GPU 合成等）。Zig 的零开销抽象让内存管理更精确。

2. **Web API 覆盖是最大挑战**：Web API 有数百个。72 个文件、每个文件一个接口的设计很工整，但距离完全覆盖还有很长的路。Beta 阶段的真实含义：常用网站基本跑通，边缘 case 可能崩溃。

3. **MCP 支持是 AI 时代的好棋**：新增了 `mcp` 命令，让 AI agent 直接调用浏览器能力，不需要通过 CDP 间接调用。这是对 AI 用例的直接支持。

4. **V8 依赖是把双刃剑**：保证了 JS 兼容性，但编译复杂度和 binary 大小都因此提升。zig-v8-fork 是个独立项目维护，有版本耦合风险。

5. **Playwright 兼容性是概率问题**：README 有明确 disclaimer —— Playwright 根据浏览器特性动态选择代码路径，Lightpanda 增加新 Web API 后，Playwright 可能走新路径。这不是 bug，是架构本质。

6. **AGPL-3.0 是商业限制**：不是 MIT/Apache，用于商业产品时需要开源或获得商业授权。这是个重要的许可证选择。

---

## 参考资源

- [GitHub 仓库](https://github.com/lightpanda-io/browser)
- [官方 Docker Hub](https://hub.docker.com/r/lightpanda/browser)
- [性能 Benchmark](https://github.com/lightpanda-io/demo)
- [nightly releases](https://github.com/lightpanda-io/browser/releases/tag/nightly)
- [Discord 社区](https://discord.gg/K63XeymfB5)
