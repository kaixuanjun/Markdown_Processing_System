# MPS · Markdown 写作与演示工具集

**MPS（Markdown Processing System）** 是一个**纯前端、零构建、零后端**的 Markdown 工具系列，包含**两个并列的应用**：

> 写文档用 **MPS·文字**，做演示用 **MPS·演示**。两者**共用同一套渲染内核 [`lib/`](lib/)**（无构建、无副本、无需安装依赖），各自独立、可单独使用。

```
MPS（Markdown Processing System）
│
├── MPS·文字   editor.html       —— 写作 / 笔记 / 知识整理
│
└── MPS·演示   presenter.html    —— 幻灯片 / 课堂 / 现场演示
                 └── engine.html    放映引擎（演示侧；打包产物模板）

共用内核：lib/（markdown-it · KaTeX · Mermaid，两个应用共享同一份）
插件扩展：plugs/ + lib/mps-plugins.js（仅 MPS·演示 一侧）
```

## 系列总览

| 对比项 | MPS·文字 | MPS·演示 |
| --- | --- | --- |
| 入口文件 | [editor.html](editor.html) | [presenter.html](presenter.html) |
| 定位 | 写作、笔记、知识整理 | 幻灯片、课堂讲授、现场演示 |
| 界面 | 编辑器 + 实时预览（左右 / 上下分屏、同步滚动） | Markdown 编辑器 + 幻灯片舞台（实时预览 + 放映模式） |
| 输出 | 保存为 `.md` 下载 | 一键打包 `<名字>-演示.zip`（演示 HTML + lib + plugs + 文档 + 插件启动捷径），双击离线放映 |
| 插件 | **不加载插件**，专注写作 | **支持插件**：`./plugs/` 即插即用 + 「插件管理」随时启停；放映引擎 [engine.html](engine.html) 为打包模板 |
| 多端同步 | — | MQTT over WebSocket（主控 / 被控同步翻页与文档） |
| 共用内核 | [`lib/`](lib/)，同一份 | [`lib/`](lib/)，同一份 |

[`index.html`](index.html) 是两者共用的入口导航页；示例文档集中在 [`example/`](example/)：演示侧 [`example_presenter.md`](example/example_presenter.md)、文字侧 [`example_editor.md`](example/example_editor.md)。

## 快速开始

```bash
# 方式一：HTTP 环境（推荐；示例读取、插件扫描与打包都依赖 fetch）
python -m http.server 8000
# 打开 http://localhost:8000/ 进入导航页（index.html），
# 或直接访问 editor.html（文字）/ presenter.html（演示）/ engine.html（放映）

# 方式二：直接双击
# editor.html    —— 编辑器功能完全可用；「示例」按钮的完整示例需 HTTP
#                   （file:// 下显示内置的简易示例）
# presenter.html —— 写作与预览可用；示例、插件与打包需 HTTP 环境
#                   （file:// 下打包会降级为需联网的 CDN 单文件版）
```

> 示例文档（`example/`）是按需 `fetch` 读取的，因此 **file:// 直开时读不到**，
> 两侧都会回退为一段简短的提示示例——这不影响编辑、预览、放映等任何实际功能。
> 想看到完整示例，用上面的 HTTP 方式打开即可。

## MPS·文字（editor.html）

写作向的高级 Markdown 编辑器，与演示侧共享全部排版语法：

- **格式工具栏**：标题、粗体 / 斜体 / 删除线 / 高亮 / 上下标；列表（无序 / 有序 / 任务 / 引用 / 嵌套 / 缩进 / 自动接续）；表格与对齐；Mermaid 图表；行内 / 块级公式；链接 / 图片 / 代码
- **视图**：左右或上下分屏、同步滚动、浅色 / 深色主题、字数 / 行数统计
- **文件**：新建 / 打开 / 保存 `.md`、加载示例（示例正文独立在 [`example/example_editor.md`](example/example_editor.md)，改示例不用动代码）
- **快捷键**：`Ctrl+N` 新建 · `Ctrl+O` 打开 · `Ctrl+S` 保存 · `Ctrl+B` / `Ctrl+I` / `Ctrl+K` · `Ctrl+Z` / `Ctrl+Y`
- **离线**：纯静态、不依赖后端与网络，双击即可使用（完整示例需 HTTP，见上方「快速开始」）

## MPS·演示（presenter.html）

演示向的完整工作流：写作 → 预览 → 放映 → 打包。

- **分页模型**：`#` 一级标题开启新页；`##` 及更深层级标题是页内断点，单击舞台逐块推进
- **放映**：全屏放映模式（隐藏编辑区）；单击舞台推进，`空格` / `→` 前进、`←` 回退、`Home` / `End` 首末页、`F` 全屏
- **多端同步**：「控制」选项卡经 MQTT over WebSocket 同步（主控 / 被控）
- **打包**：「文件 → 打包演示」导出 ZIP（`<名字>-演示.html` + `lib/` + `plugs/` + `README.md` + `THIRD-PARTY-NOTICES.md`），插件声明的启动捷径会生成在 ZIP 根目录（如课堂投票的「启动课堂投票（局域网）」）；双击离线放映，`file://` 下自动降级为 CDN 单文件版
- **放映引擎**：[engine.html](engine.html) 无编辑界面、打开即放映，是打包产物的模板（含临时改源的编辑抽屉，`E` 开合）
- **示例文档**：打开 presenter 默认载入 [`example/example_presenter.md`](example/example_presenter.md)（含全部插件用法），改示例不用动代码

### 插件系统（仅 MPS·演示）

插件是演示侧独有的扩展能力（`./plugs/` + [lib/mps-plugins.js](lib/mps-plugins.js)）：

- 运行时扫描清单、按需加载、随时启停；**关闭插件或未启用时，对应代码块回退为可读源码**
- 「插件管理」选项卡管理开关；打包时仅随包「启用中」的插件，并内嵌资产以支持 `file://`
- 完整开发规范（生命周期、ctx API、打包要求）见 [plugs/README.md](plugs/README.md)

所有第一方插件均由本项目自研：

| 插件 | id | 说明 | 参考的开源项目 |
| --- | --- | --------- | --- |
| iframe 播放器 | `iframe` | 嵌入哔哩哔哩 / 网易云音乐（单曲 / 歌单）/ YouTube / Vimeo 或任意 iframe 地址，支持直接粘贴其他平台复制的 `<iframe>` 嵌入代码（自动识别 src / 宽高 / allow） | 无（纯平台 embed 拼接） |
| 数学动画 | `mps-manim` | manim 风格的 DSL（`axes` / `plot` / `play` / `MoveAlongPath`…）渲染可播放的 Canvas 动画，KaTeX 排版公式，带可拖动时间轴 | 设计理念与 DSL 参考 **[Manim Community](https://github.com/ManimCommunity/manim)（MIT）**；是「浏览器端极简重实现」，未使用 Manim 代码 |
| Python 笔记本 | `marimo` | `marimo` 代码块 → marimo 风格反应式笔记本：`# %%` 分隔单元格、依赖分析、自动重算、现场可加单元格 | 交互范式参考 **[marimo](https://github.com/marimo-team/marimo)（Apache-2.0）**；实现为原创，未使用其代码 |
| 摄像头画面 | `camera` | `camera` 代码块 → 可拖动 / 缩放的摄像头窗口，8 种遮罩形状、镜像、多摄像头切换 | 无（基于 WebRTC `getUserMedia` 自研） |
| 课堂测验 + 现场投票 | `slide-quiz` | `quiz` 代码块 → 可交互测验（单选 / 多选 / 判断 / 填空，提交判定、跨页累计、全卷成绩单）；`poll` 代码块 → 现场投票卡 + 二维码，观众手机扫码投票，票数 / 词云实时刷新；自带局域网投票页启动器 | 无（自研实现） |
| 互动模拟 | `mps-sim` | `sim` 代码块 → **可现场操控的动态模拟**：实时滑块调参、开始 / 暂停 / 重置、时间倍率、投影读数、快照对比、导出 PNG / JSON；内置 9 个模型（弹簧振子 / 单摆 / 抛体 / SIR / 种群 / 捕食 / 洛伦兹 / RC / 波的叠加）并支持自定义方程；`sim-link` → 链接序列（指定下一站、按秒或按模拟结束自动前进、首次访问继承参数）；`nano` → 纳米绘图（风格 / 种子 / 提示词现场重绘，可挂接真实 AI 接口，未接入时用内置确定性生成器） | 交互设计参考 **Nano Interactive Slides（NIS，MIT）**；本项目为原创实现（Canvas 自绘视图 + RK4 积分 + 自研表达式编译器），未使用其代码 |

各插件**内置的第三方库**（与共用内核无关）：

| 插件 | 内置第三方库 | 许可 |
| --- | --- | --- |
| `iframe` | — | — |
| `mps-manim` | —（公式排版复用共用内核的 KaTeX） | — |
| `marimo` | [Pyodide](https://github.com/pyodide/pyodide) 0.27.2（浏览器内 Python 运行时，含 CPython 3.12，本地 WASM 执行、完全离线） | MPL-2.0（CPython：PSF-2.0） |
| `camera` | — | — |
| `slide-quiz` | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4（投票二维码）；[MQTT.js](https://github.com/mqttjs/MQTT.js) 5.10.1（MQTT over WebSocket，兼容 HiveMQ 等任意 broker） | MIT |
| `mps-sim` | —（纯自研；纳米绘图内置确定性生成器，无外部依赖） | — |

各库的版权声明与许可全文见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 共用内核 lib/

两个应用都以 `<script>` / `<link>` 直接引用 `lib/`（浏览器原生加载，无需构建），排版能力完全一致：

| 能力 | 实现 | 文字 | 演示 |
| --- | --- | :-: | :-: |
| Markdown 渲染 | markdown-it + 扩展（上标 / 下标 / 高亮 / 多行表格） | ✓ | ✓ |
| LaTeX 公式 | KaTeX（行内 / 块级，含字体） | ✓ | ✓ |
| 图表 | Mermaid（流程图 / 时序图 / 甘特图） | ✓ | ✓ |
| 插件宿主 | `lib/mps-plugins.js`（自研） | — | ✓ |

### 语法速览（两应用共用）

```markdown
# 第一页标题

正文……

## 第二次点击出现的断点          ← MPS·演示：断点（点击出现）；MPS·文字：普通标题

行内公式 $E = mc^2$，高亮 ==重点==，代码 `inline`，表格 / 任务列表均支持。

代码围栏 manim / marimo / quiz / poll / iframe / camera / sim / nano
在 MPS·演示 中由插件渲染（关闭插件时回退为源码）；MPS·文字 中始终显示为代码。
```

## 目录结构

```
MPS/
├── index.html                # 入口导航（文字 / 演示）
│
├── editor.html               # ① MPS·文字 —— 写作编辑器
│
├── presenter.html            # ② MPS·演示 —— 幻灯片编辑器 / 预览 / 打包
├── engine.html               #    └ 放映引擎（演示侧；打包产物模板）
│
├── lib/                      # 共用内核（两个应用共享同一份）
│   ├── mps-plugins.js        # 插件宿主（自研；仅演示侧加载）
│   ├── markdown-it*.js       # 第三方：markdown-it 及扩展
│   ├── katex.min.js / .css   # 第三方：KaTeX
│   ├── mermaid.min.js        # 第三方：Mermaid
│   ├── fonts/                # KaTeX 字体
│   └── logo.png
│
├── plugs/                    # 插件目录（仅 MPS·演示 使用）
│   ├── manifest.json         # 插件清单（唯一扫描入口）
│   ├── README.md             # 插件开发指南
│   ├── iframe/               # iframe 播放器
│   ├── mps-manim/            # 数学动画
│   ├── marimo/               # Python 笔记本
│   ├── camera/               # 摄像头画面
│   ├── slide-quiz/           # 课堂测验 + 现场投票（server/ 为局域网投票页启动器）
│   └── mps-sim/              # 互动模拟（sim / sim-link / nano）
│
├── example/                  # 示例文档（改示例不用动代码）
│   ├── example_presenter.md  #   MPS·演示 的示例（默认载入）
│   └── example_editor.md     #   MPS·文字 的示例
├── THIRD-PARTY-NOTICES.md    # 第三方库许可声明与全文
└── README.md                 # 本文档
```

## 第三方依赖（共用内核 lib/）

`lib/` 内置的第三方库（两个应用共用；**各插件内置的第三方库见「插件系统」**）：

| 库 | 版本 | 用途 | 协议 |
| --- | --- | --- | --- |
| [markdown-it](https://github.com/markdown-it/markdown-it) | 13.0.2 | Markdown 解析渲染 | MIT |
| [markdown-it-sub](https://github.com/markdown-it/markdown-it-sub) | 1.0.0 | 下标 `~x~` | MIT |
| [markdown-it-sup](https://github.com/markdown-it/markdown-it-sup) | 1.0.0 | 上标 `^x^` | MIT |
| [markdown-it-mark](https://github.com/markdown-it/markdown-it-mark) | 3.0.1 | 高亮 `==x==` | MIT |
| [markdown-it-multimd-table](https://github.com/redbug312/markdown-it-multimd-table) | 4.2.3 | 多行 / 多表头表格 | MIT |
| [KaTeX](https://github.com/KaTeX/KaTeX) | 0.16.9 | LaTeX 公式排版（含字体） | MIT |
| [Mermaid](https://github.com/mermaid-js/mermaid) | 10.6.1 | 流程图 / 时序图 / 甘特图 | MIT |

> 上表版本为随仓库内置的构建版本；演示侧打包器在纯 CDN 兜底模式下会引用各库的更新版本（如 markdown-it 14.x、KaTeX 0.16.11、Mermaid 11.x），协议不变。各库的版权声明与许可全文见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 开源协议

本项目源码（两个应用及其插件）采用 **MIT 协议**，见 [LICENSE](LICENSE)。

| 部分 | 协议 |
| --- | --- |
| 项目源码（`index.html` / `editor.html` / `presenter.html` / `engine.html` / `lib/mps-plugins.js` / `plugs/*` 第一方插件代码） | **MIT** |
| 内置第三方库 | 各自协议：共用内核均为 MIT（见「第三方依赖」）；插件内置的 Pyodide 为 MPL-2.0、其内嵌 CPython 为 PSF-2.0（见「插件系统」）。**版权声明与许可全文见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)** |

「自有代码 MIT」与「内置库各归其主」并不冲突：

- **Manim / marimo / Nano Interactive Slides**（MIT / Apache-2.0 / MIT）仅被「参考理念与风格」，本项目未包含其源码，不产生再分发义务；如将来引入其中代码，只需在该部分保留原文署名与许可（均可与 MIT 作品共存）。
- **Pyodide（MPL-2.0）** 以未修改的独立文件形式内置（`plugs/marimo/pyodide/`）。MPL-2.0 是「文件级 copyleft」：这些文件本身仍按 MPL-2.0 提供，但不会传染到项目自有代码，整体作品（Larger Work）允许以 MIT 分发（MPL-2.0 §3.3）；其内嵌的 CPython 遵循 PSF-2.0。
- 再分发本项目或打包产物时，请连同 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) 一并保留内置第三方库的许可声明。