# OpenScreen Getting Started

> 整理日期：2026-04-08
> 仓库地址：https://github.com/siddharthvaddem/openscreen
> Stars: 25,217 ⭐ | Forks: 1,674 | License: MIT

## 项目简介

OpenScreen 是一个**免费、开源的屏幕录制 + 视频编辑桌面应用**，定位为 Screen Studio（$29/月）的平替。核心场景是制作**产品 Demo 和功能演示视频**——录屏后添加自动缩放、运动模糊、注释、裁剪等效果，导出高质量的演示视频。

**关键词**：免费、无水印、可商用、跨平台（macOS/Windows/Linux）。

**技术栈**：Electron + React + TypeScript + Vite + PixiJS（GPU 渲染）。

## 项目结构

```
openscreen/
├── electron/                    # Electron 主进程
│   ├── main.ts                  # 应用入口、窗口管理、系统托盘
│   ├── preload.ts               # 预加载脚本（IPC bridge）
│   ├── windows.ts               # 窗口创建（编辑器/源选择器/HUD overlay）
│   ├── ipc/handlers.ts          # IPC 通信处理
│   └── i18n.ts                  # 主进程国际化
├── src/                         # 渲染进程（React UI）
│   ├── components/
│   │   ├── launch/              # 启动界面 & 录制源选择
│   │   ├── video-editor/        # ⭐ 核心：视频编辑器
│   │   │   ├── VideoEditor.tsx  # 主编辑器组件（状态管理中枢）
│   │   │   ├── VideoPlayback.tsx # PixiJS 渲染的视频播放器
│   │   │   ├── SettingsPanel.tsx # 右侧设置面板
│   │   │   ├── ExportDialog.tsx # 导出对话框
│   │   │   ├── timeline/        # 时间线编辑器（dnd-timeline 拖拽）
│   │   │   └── videoPlayback/   # 缩放变换、运动模糊、焦点跟踪等
│   │   └── ui/                  # Radix UI 基础组件
│   ├── hooks/
│   │   ├── useScreenRecorder.ts # ⭐ 核心：屏幕录制逻辑
│   │   ├── useEditorHistory.ts  # Undo/Redo 状态管理
│   │   └── useCameraDevices.ts  # 摄像头设备管理
│   ├── lib/
│   │   ├── exporter/            # ⭐ 核心：视频导出管线
│   │   │   ├── videoExporter.ts # 导出主流程（WebCodecs 编码）
│   │   │   ├── frameRenderer.ts # PixiJS 逐帧渲染
│   │   │   ├── muxer.ts        # 视频封装（mp4box）
│   │   │   ├── audioEncoder.ts  # 音频编码
│   │   │   ├── gifExporter.ts   # GIF 导出
│   │   │   └── streamingDecoder.ts # 流式视频解码
│   │   ├── compositeLayout.ts   # 画布合成布局（视频+摄像头+背景）
│   │   └── webcamMaskShapes.ts  # 摄像头裁剪形状
│   ├── contexts/                # I18n + 快捷键上下文
│   └── i18n/                    # 国际化配置
├── electron-builder.json5       # 打包配置（macOS/Windows/Linux）
├── package.json                 # 依赖 & 脚本
└── vite.config.ts               # Vite 构建配置
```

**源码规模**：~19,900 行 TypeScript/TSX。

## 核心架构

### 整体数据流

```
录制阶段：
  Electron desktopCapturer → MediaRecorder → WebM Blob → 本地文件

编辑阶段：
  WebM 文件 → VideoPlayback (PixiJS 实时预览) → 用户交互编辑
                                                    ↓
  缩放区域 / 裁剪 / 注释 / 变速 / 修剪 → EditorState（Undo/Redo）

导出阶段：
  StreamingDecoder (逐帧解码)
    → FrameRenderer (PixiJS 离屏渲染：背景+视频+缩放+注释+摄像头)
      → VideoEncoder (WebCodecs H.264/VP9)
        → VideoMuxer (mp4box 封装 MP4)
          → 最终文件
```

### 三个核心模块

#### 1. 屏幕录制（`useScreenRecorder.ts`）

- 使用 Electron 的 `desktopCapturer` API 获取屏幕/窗口源
- 支持同时录制：屏幕视频 + 麦克风 + 系统音频 + 摄像头
- 录制参数：
  - 目标分辨率：最高 4K (3840×2160)
  - 目标帧率：60fps（最低 30fps）
  - 码率自适应：4K=45Mbps、QHD=28Mbps、基础=18Mbps
  - 高帧率自动提升码率 1.7x
- 输出格式：WebM（后续用 `fix-webm-duration` 修正时长元数据）
- 摄像头独立录制（1280×720@30fps），最终合成

#### 2. 视频编辑器（`VideoEditor.tsx` + `VideoPlayback.tsx`）

**编辑能力**：
| 功能 | 实现方式 |
|------|---------|
| 缩放效果（Zoom） | 6 级深度 + 手动/自动焦点 + 可拖拽时间线 |
| 运动模糊（Motion Blur） | PixiJS MotionBlurFilter，基于相机速度实时计算 |
| 裁剪（Crop） | 四边可调裁剪区域 |
| 注释（Annotation） | 文本、图片、箭头，可设置时间范围和位置 |
| 变速（Speed） | 分段变速 |
| 修剪（Trim） | 剪掉不需要的片段 |
| 摄像头叠加 | 画中画/并排/多种布局 + 圆形/方形/圆角蒙版 |
| 背景 | 壁纸/纯色/渐变/自定义 |
| Undo/Redo | 完整的状态历史管理 |

**PixiJS 渲染引擎**：
- 视频播放和编辑预览都通过 PixiJS GPU 加速渲染
- `FrameRenderer` 创建一个 PixiJS `Application` 实例
- 视频帧作为 `Sprite` 纹理，叠加在背景 `Container` 上
- 缩放变换通过 `cameraContainer` 的 `scale` 和 `position` 实现
- 运动模糊基于相机位移速度计算：速度 > 12px/s 时触发，峰值 1400px/s，最大模糊 14px

#### 3. 导出管线（`lib/exporter/`）

导出是整个项目技术含量最高的部分：

```
StreamingVideoDecoder（逐帧解码原始视频）
  → AsyncVideoFrameQueue（异步帧队列，控制内存）
    → FrameRenderer（PixiJS 离屏渲染每一帧）
      → VideoEncoder（WebCodecs API，支持硬件加速）
        → VideoMuxer（mp4box 封装）
```

**关键设计**：
- **编码器自动降级**：先尝试硬件加速，失败后回退到软件编码
- **内存控制**：编码队列最大 120 帧（软件编码时防止 Windows 内存膨胀）
- **超时保护**：编码器 15s 无输出判定卡死，flush 超时 20s
- **音频独立处理**：`AudioProcessor` 使用 WebCodecs AudioEncoder，支持 voice (128kbps) 和 system audio (192kbps) 混合
- **GIF 导出**：独立的 `GifExporter`，使用 gif.js 库

### 窗口架构（Electron）

```
主窗口（HUD Overlay）  ← 录制控制界面（浮窗）
源选择器窗口          ← 选择录制的屏幕/窗口
编辑器窗口            ← 录制完成后打开，核心编辑界面
系统托盘              ← 后台运行，快速启动
```

## 安装与使用

### 从 Release 安装（推荐）

从 [GitHub Releases](https://github.com/siddharthvaddem/openscreen/releases) 下载对应平台安装包：
- macOS：DMG（x64/arm64）
- Windows：NSIS 安装程序
- Linux：AppImage

macOS 需要额外步骤绕过 Gatekeeper：
```bash
xattr -rd com.apple.quarantine /Applications/Openscreen.app
# 然后在 系统设置 > 隐私与安全 中授权"屏幕录制"和"辅助功能"权限
```

### 从源码构建

```bash
git clone https://github.com/siddharthvaddem/openscreen.git
cd openscreen
npm install
npm run dev           # 开发模式
npm run build:mac     # 构建 macOS 版
npm run build:win     # 构建 Windows 版
npm run build:linux   # 构建 Linux 版
```

要求：Node.js 22.22.1 + npm 10.9.4（严格版本锁定）

### 平台限制

| 平台 | 系统音频 | 备注 |
|------|---------|------|
| macOS 13+ | ✅ | macOS 14.2+ 需授权弹窗 |
| macOS 12- | ❌ 仅麦克风 | 系统级不支持 |
| Windows | ✅ 开箱即用 | — |
| Linux | ✅ 需 PipeWire | Ubuntu 22.04+ / Fedora 34+ 默认支持 |

## 关键发现 / 学习心得

### 1. PixiJS 在视频编辑中的巧妙应用

大多数 Web 视频编辑器用 Canvas 2D 或直接操作 DOM。OpenScreen 选择 **PixiJS**（WebGL GPU 渲染引擎），这带来了几个优势：
- **GPU 加速**的实时预览——缩放、运动模糊、阴影等效果不卡顿
- **滤镜系统**直接复用 pixi-filters（MotionBlurFilter、DropShadowFilter）
- **容器嵌套**模型天然适合"背景 → 视频 → 摄像头 → 注释"的图层堆叠
- 导出时同一套渲染代码离屏跑，预览和导出效果一致

### 2. WebCodecs API 的实战使用

OpenScreen 是一个很好的 WebCodecs API 实战案例：
- `StreamingVideoDecoder` 流式解码，避免一次性加载整个视频
- `VideoEncoder` 支持硬件/软件自动切换
- `AudioEncoder` 独立处理音频流
- 整个导出管线全在浏览器端完成，**不依赖 FFmpeg**

### 3. 运动模糊的物理模拟

`zoomTransform.ts` 中的运动模糊实现很有意思：
- 不是简单的静态模糊，而是基于**相机位移速度**的动态计算
- 速度 < 12px/s 时不模糊（避免静止状态抖动）
- 速度到 1400px/s 时达到最大模糊 14px
- 模糊方向跟随运动方向（不是径向，是方向性的）
- 还有"amount response"曲线，让滑块低端可用、高端有更大空间

### 4. 25K Star 的增长启示

这个项目 2025 年 10 月创建，不到 6 个月拿到 25K star。作者是 ASU 学生（svaddem@asu.edu），自述"I'm new to open source, idk what I'm doing lol"。增长密码：
- **精准定位痛点**：Screen Studio 好但贵（$29/月），大量人需要免费版
- **视觉冲击力**：演示截图直接展示效果
- **零门槛**：下载即用，不需要配置
- **MIT 协议 + 可商用**：打消所有顾虑

### 5. 与 Screen Studio 的差异

| 维度 | OpenScreen | Screen Studio |
|------|-----------|---------------|
| 价格 | 免费 | $29/月 |
| 平台 | macOS/Win/Linux | macOS only |
| 缩放效果 | 6 级手动/自动 | 更智能的自动跟踪 |
| 导出格式 | MP4/GIF | MP4/GIF/ProRes |
| 性能 | WebCodecs（浏览器端） | 原生 + Metal |
| 成熟度 | Beta（有 bug） | 生产级 |

OpenScreen 覆盖了 Screen Studio 约 70-80% 的核心功能，对于"做个产品 demo"这个场景够用了。

## 参考资源

- [GitHub Releases](https://github.com/siddharthvaddem/openscreen/releases) — 下载安装包
- [项目 Roadmap](https://github.com/users/siddharthvaddem/projects/3) — 开发计划
- [DeepWiki 文档](https://deepwiki.com/siddharthvaddem/openscreen) — 自动生成的项目文档
- [Discord 社区](https://discord.gg/yAQQhRaEeg)
- [Screen Studio](https://www.screen.studio/) — 商业版对标产品
- [WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) — 核心编解码技术
- [PixiJS](https://pixijs.com/) — GPU 渲染引擎
