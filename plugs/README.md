# MPS 插件开发指南

> 适用版本：`MPSPlugins.version = "1.0"`
> 宿主：`engine.html`（纯演示引擎）、`presenter.html`（编辑器 / 预览 / 打包）

MPS 的幻灯片引擎本身只负责「Markdown 解析 → 分页 / 断点 → 渲染」，
所有**附加能力**（数学动画、图表、代码高亮、交互组件……）都以插件形式提供。

插件是**纯静态、零构建**的：一个目录 + 一个清单登记，浏览器运行时自动扫描、按需加载、可随时启停。

---

## 1. 一分钟上手

```
plugs/
├── manifest.json          # 唯一扫描入口：登记所有插件
└── hello/                 # 一个插件一个目录，目录名 = 插件 id
    ├── plugin.json        # 元数据（必填）
    └── index.js           # 入口（必填，调用 MPSPlugins.register）
```

`plugs/manifest.json`

```json
{
  "version": 1,
  "plugins": ["hello"]
}
```

`plugs/hello/plugin.json`

```json
{
  "id": "hello",
  "name": "问候卡片",
  "description": "把 ```hello 代码块渲染成一张卡片。",
  "version": "1.0.0",
  "author": "你的名字",
  "icon": "👋",
  "entry": "index.js",
  "files": ["plugin.json", "index.js"],
  "defaultEnabled": true
}
```

`plugs/hello/index.js`

```js
(function () {
    'use strict';

    MPSPlugins.register({
        id: 'hello',

        // 启用时调用：在这里做一切副作用（注册围栏、加样式、注入选项卡、订阅事件）
        setup: function (ctx) {
            ctx.registerFence('hello', function (token) {
                return '<div class="hello-card">' + token.content + '</div>';
            });
            ctx.addStyle('.hello-card{padding:.8em 1em;border:1px solid #d0d7de;border-radius:10px;}');
            ctx.log('已启用');
        },

        // 停用时调用：必须撤销 setup 的全部副作用
        teardown: function (ctx) {
            ctx.log('已停用');
        }
    });
})();
```

用 HTTP 打开 `presenter.html` → 「插件管理」选项卡 → 开启「问候卡片」→ 在 Markdown 里写：

````markdown
```hello
你好，世界
```
````

### 两条铁律

1. **入口脚本只做注册，不做副作用。**
   加载 ≠ 启用。宿主可能只加载脚本（比如重新扫描清单），是否生效完全由 `setup` 决定。
   这样插件「关闭」时零副作用、零开销，运行时文件也不会被下载（`runtime` 只在启用的那一刻注入）。
2. **`teardown` 要能干净撤销 `setup`。**
   宿主在停用时会先调用 `teardown`，再兜底清理你通过 `ctx` 登记的资源（围栏 / 事件 / 样式 / 选项卡）。
   若你直接 `document.head.appendChild` 而不走 `ctx.addStyle`，就需要自己删。

> ⚠️ **开发时必须通过 HTTP(S) 打开**：清单与插件是靠 `fetch()` 读取的，
> `file://` 下会被浏览器拦截，结果是「引擎正常、插件全部不可用」。本地起个静态服务器即可：
> `python -m http.server 8000`
>
> （打包产物不受此限：打包时会把清单与运行时要用的数据文件一并内嵌，双击 HTML 也能用，
> 见第 8 节。）

---

## 2. 元数据字段

### `plugs/manifest.json`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | number | 清单格式版本，当前为 `1` |
| `plugins` | string[] | 插件 id 列表，**顺序即插件管理界面的显示顺序** |

浏览器无法读取目录，所以这里是唯一的扫描入口；没登记在清单里的插件不会被加载。

### `plugs/<id>/plugin.json`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | ✅ | 必须与目录名、`register({id})` 三者一致 |
| `name` | string | ✅ | 插件管理界面显示名 |
| `description` | string | | 一句话说明，显示在插件卡片上 |
| `version` | string | | 版本号 |
| `author` | string | | 作者 |
| `icon` | string | | 卡片图标，通常是一个 emoji |
| `entry` | string | | 入口脚本，默认 `index.js` |
| `runtime` | string[] | | 运行时依赖，**先于 entry** 顺序加载（如 `["mps-manim.js"]`） |
| `styles` | string[] | | 样式表，会在加载脚本前以 `<link>` 注入 |
| `preload` | string[] | | 需以**经典 `<script>`** 预载的脚本，仅打包产物会用到（见第 8 节） |
| `files` | string[] | | 打包时需随包的文件，**不要漏**（见第 8 节） |
| `defaultEnabled` | boolean | | 插件自报的默认启用状态，默认 `false` |
| `tabs` | string[] | | 声明式描述插件会注入哪些选项卡，仅用于界面展示 |
| `packShortcuts` | object[] | | 打包时在 ZIP **根目录**生成跳转桩（快捷方式），`{name, kind: "bat"\|"sh", target}`；`target` 是插件目录内的相对路径。真身留在插件目录里、根目录只放一个几十字节的桩，双击体验和目录整洁兼得（见 §8） |

加载顺序固定为：`styles` → `runtime` → `entry`。

`plugin.json` 里宿主不认识的**自定义字段会被原样保留**在 `ctx.meta` 中，插件可以自用
（例：`slide-quiz` 用 `defaultVoteUrl` 声明内置投票页地址，运行时经 `ctx.meta.defaultVoteUrl` 读取）。

`files` / `runtime` / `styles` / `entry` / `plugin.json` 会做并集，所以 `runtime` 和 `styles` 里的文件即使没写进 `files` 也会随包。

---

## 3. 宿主上下文 `ctx`

`setup(ctx)` 与 `teardown(ctx)` 收到同一个上下文对象。

### 通用能力

| 成员 | 说明 |
| --- | --- |
| `ctx.host` | `'engine'` 或 `'presenter'`，用于区分宿主行为 |
| `ctx.id` | 当前插件 id |
| `ctx.meta` | 该插件的 `plugin.json` 解析结果 |
| `ctx.md` | markdown-it 实例（一般不用直接碰） |
| `ctx.registerFence(lang, fn)` | 注册围栏代码块渲染器，返回 `unregister()` |
| `ctx.addStyle(cssText)` | 注入 `<style>`，停用时自动移除 |
| `ctx.on(event, fn)` | 订阅宿主事件，返回 `off()` |
| `ctx.refresh()` | 让宿主重新渲染当前幻灯片 |
| `ctx.getSlideEl()` | 当前幻灯片根元素（**不要硬编码 `#slide`**，宿主自己决定） |
| `ctx.getDeckSource()` | 当前生效的**整份 Markdown 源**（可选能力：宿主未提供时返回空串）。需要「整卷」信息的插件（如课堂测验的累计计分）用它解析全文档，而不是只统计已经渲染过的页 |
| `ctx.nav` | 宿主导航能力（可选能力：宿主未提供时为 `null`，用前先判空）。实时读数 `nav.slide` / `nav.step` / `nav.total` / `nav.steps`（均 0 起）；动作 `nav.next()` / `nav.prev()` / `nav.goto(slide, step)`。enable 时会重建对象，但读数与动作始终指向宿主的实时状态 |
| `ctx.log(...)` | 带插件名前缀的日志，输出为 `[plug:<id>] ...` |
| `ctx.store.get(key, def)` | 插件私有持久化（localStorage，按插件隔离） |
| `ctx.store.set(key, value)` | 同上，值会被 `JSON.stringify` |

### 仅 presenter 可用

| 成员 | 说明 |
| --- | --- |
| `ctx.ribbon` | 选项卡 API 入口，见第 6 节；engine 下为 `undefined` |
| `ctx.setStatus(text)` | 写编辑器底部状态栏 |
| `ctx.insertAtCursor(text)` | 向 Markdown 编辑器光标处插入文本 |

**写跨宿主插件时，请先判断宿主**：

```js
setup: function (ctx) {
    // 两个宿主都要做的事：围栏、样式、事件
    ...

    // 只有 presenter 有 UI 值得扩展
    if (ctx.host !== 'presenter' || !ctx.ribbon) return;
    const tab = ctx.ribbon.addTab({ id: 'hello', label: '问候卡片', order: 50 });
    ...
}
```

---

## 4. 围栏渲染器

````js
ctx.registerFence('hello', function (token, info) { return '<div>…</div>'; });
````

| 参数 | 说明 |
| --- | --- |
| `token.content` | 代码块正文（不含 ``` 围栏） |
| `token.info` | 围栏信息串，如 `hello` 或 `manim size=16:9` |
| `info.lang` | 已归一化为小写的语言名 |

返回值是 **HTML 字符串**，宿主会自动包一层：

```html
<div data-mps-plugin="hello">…你的 HTML…</div>
```

这层包装承担了两件事，请不要绕过它：

- **点击穿透防护**：舞台是「点哪儿都翻页」的，宿主对 `[data-mps-plugin]` 内部做了豁免。
  你的插件在围栏里放按钮 / 播放器 / 滑块时，点击不会误触发翻页。
- **错误兜底**：渲染函数抛异常时，宿主会退化为显示源码，并在控制台给出 `[plug:<id>] 渲染 \`\`\`hello 失败: ...`。

### ⚠️ 渲染时序（最容易踩的坑）

围栏函数返回的只是**占位 HTML**，这时候它还没进 DOM。
真正把占位变成活的组件，要靠 `blockRendered` 事件：

```js
setup: function (ctx) {
    ctx.registerFence('hello', function (token) {
        // 把数据挂到 data-* 上，等入 DOM 后再取
        return '<div class="hello-card" data-src="' + encodeURIComponent(token.content) + '"></div>';
    });

    ctx.on('blockRendered', function (blockEl) {
        blockEl.querySelectorAll('.hello-card').forEach(function (node) {
            renderCard(node, decodeURIComponent(node.dataset.src));
        });
    });
}
```

原因：幻灯片是**逐块渲染**的（`##` 及更深层级是页内断点，点一次出现一块），
每个块渲染进 DOM 后宿主才会派发 `blockRendered`。所以初始化逻辑必须写在这里。
另外请在节点上打去重标记（如 `data-ready`），避免重复初始化。

### 关闭时的行为

插件停用后，围栏注册被撤销，同样的代码块会**回退为宿主内置规则**——
对未知语言就是普通源码块（`<pre><code class="language-hello">`）。
这是有意的：关掉插件后内容依然可读、可复制。

---

## 5. 事件

订阅方式：`const off = ctx.on('blockRendered', fn);`（`ctx` 会登记 `off`，停用时自动调用）。

| 事件 | 载荷 | 触发时机 |
| --- | --- | --- |
| `blockRendered` | 块的 DOM 元素 | 每个内容块插入 DOM 之后 |
| `slideChanged` | `{slide, step, total, steps}` | 当前页 / 断点位置**真的变化**之后（宿主内部按位置去重，重渲染不会重复触发）。用于自动前进、按页继承状态等联动 |
| `slideReset` | — | 幻灯片被清空 / 重建前 |
| `deckChanged` | — | Markdown 源发生变化 |
| `pluginRegistered` | `{id, meta}` | 插件入口完成注册 |
| `pluginEnabled` | `{id, meta}` | 插件启用完成后 |
| `pluginDisabled` | `{id, meta}` | 插件停用完成后 |
| `pluginsReady` | `{list}` | 清单扫描与自动安装结束（宿主据此做首次重渲染） |

宿主的 `pluginsReady` 处理里会调用一次 `refresh()` 重渲染当前页——
**所以围栏注册后你通常不需要自己调 `ctx.refresh()`**。
只有在「运行过程中动态改变围栏规则」时才需要手动调。

---

## 6. 选项卡 API（presenter）

```js
const tab = ctx.ribbon.addTab({ id: 'manim', label: '数学动画', order: 50 });
if (!tab) return;                       // 已存在同名选项卡时返回 null

tab.addGroupLabel('插入场景');           // 分组标题
tab.addButton({
    id: 'mmPlotBtn',                    // 可选，便于外部定位
    icon: '📈',
    label: '函数图像',
    title: '插入函数图像动画',            // hover 提示
    onClick: function () { /* ... */ }
});
tab.addDivider();                        // 分隔线
tab.addHint('支持 HTML 的说明文字');

tab.remove();                            // 移除整个选项卡（teardown 时调用）
```

`order` 决定选项卡插入位置，宿主选项卡的 `data-order` 如下：

| 选项卡 | order |
| --- | --- |
| 文件 | 10 |
| 插入 | 20 |
| 视图 | 30 |
| **插件管理** | 80 |
| 控制 | 90 |

插件一般取 `40`–`70`，即落在「视图」与「插件管理」之间。典型取值 `50`。

**约定：一个插件最多注入一个选项卡**，并把插件自己的所有按钮收进去。
插件管理面板由宿主统一维护，插件不要往里加东西。

选项卡由插件动态注入 → 插件关闭时整个选项卡消失，宿主不需要知道它的存在。
（宿主的选项卡切换是事件委托实现的，动态节点也能正常工作。）

---

## 7. 启用状态是怎么决定的

优先级从高到低：

| 优先级 | 来源 | 使用场景 |
| --- | --- | --- |
| 1 | `window.MPS_PLUGINS_ENABLED`（页面内烘焙的数组） | 打包产物：让观众端开箱即用 |
| 2 | `localStorage["mps.plugins.state"]` 里该插件的记录 | 用户在本机的开关选择 |
| 3 | `boot({auto: true})` 的宿主默认 | engine 这类没有管理界面的宿主：扫描到即安装 |
| 4 | `plugin.json` 的 `defaultEnabled` | 插件作者自报的默认值 |

对插件作者的含义：

- 在 presenter 里「关掉插件」会**写入第 2 级**（用户覆盖），之后即使 `defaultEnabled: true` 也不会自动开启——这是用户意图，正常行为。
- 插件独占的持久化数据请用 `ctx.store`，键前缀由宿主加（`mps.plug.<id>.<key>`），不要自己往 `mps.plugins.state` 里写。

---

## 8. 打包与纯净版

presenter 的「打包」会生成一个 ZIP：`<名字>-演示.html` + `lib/` + `plugs/` + `README.md` + `THIRD-PARTY-NOTICES.md`（后两者缺失时静默跳过），离线可用。

规则：

1. **只打启用中的插件**。`plugs/manifest.json` 会被同步裁剪为只含随包的 id，避免纯净版去加载不存在的目录。
2. **随包文件 = `plugin.json` ∪ `files` ∪ `runtime` ∪ `styles` ∪ `entry`。**
   所以请把运行时需要的**所有**文件写进 `files`（或 `runtime`），漏掉就会出现「本机正常、打包后失效」。
3. 纯净 HTML 内会烘焙 `window.MPS_PLUGINS_ENABLED = ["你的id"]`，并内联宿主 + `MPSPlugins` 引导代码，以 `host: "engine"` 初始化。
   **打包产物里插件跑在 engine 模式**：没有编辑器、没有状态栏、没有选项卡，所有 presenter 专属 API 都不可用。
   插件的「能看能播」能力必须不依赖 presenter。
4. 因此：**插件在 engine 下也要能正常工作**，这是硬性要求，不是可选项。
5. 如果插件声明了 `packShortcuts`，打包器会在 ZIP **根目录**生成同名跳转桩（`.bat` / `.sh`），
   内容只有一行转发命令，指向 `plugs/<id>/<target>`；同时会把运行目录（`%~dp0` / `$HERE`）
   作为参数传给真身。这样「插件文件都收在自己的目录里」与「老师双击根目录一个文件就能用」可以同时满足。
   （`slide-quiz` 的局域网启动器就是这么做的。）

### 双击可用：file:// 下怎么办

`file://` 只拦截 `fetch()` / `XMLHttpRequest`，**不拦** `<script>` / `<link>` / `<img>`。
打包器据此做三件事，所以产物双击也能跑：

| 做法 | 解决什么 |
| --- | --- |
| 内嵌 `window.MPS_PLUGINS_BAKED = [元数据…]` | 宿主不再 `fetch` 清单与 `plugin.json`，直接按内嵌元数据登记 |
| 数据型文件（`.wasm` `.gz` `.zip` `.json`…）转 base64 生成 `<rel>.asset.js`，用 `<script src>` 载入，登记进宿主的随包资产表 | 插件运行时 `fetch()` 这些文件时，由宿主的 fetch 回退按 URL 命中资产表直接返回；这些文件**不再重复原样随包**（避免体积翻倍） |
| `preload` 声明的脚本以经典 `<script>` 预载 | 有些库内部用**动态 `import()`** 加载自己的 glue，`file://` 下会被 CORS 拦；预载后它检测到全局已就绪就会跳过 import |

配套的插件侧约定只有一条：**运行时用 `fetch` 读的必须是「数据型」文件**（上表第二行的扩展名）。
`.js` / `.css` / 图片 / 字体沿用 `<script>` `<link>` `<img>`，原样随包即可，不用管。

`plugs/marimo/` 是最完整的例子：`plugin.json` 里把 `pyodide/pyodide.asm.js` 写进 `preload`
（Pyodide 用动态 `import()` 加载它，且该文件末尾有 `globalThis._createPyodideModule = …`，
预载后 Pyodide 会直接跳过 import），其余 `pyodide/*.gz|.zip|.json` 由打包器自动转成
`.asset.js` 内嵌。

> 实测：`file://` 下打开打包产物，iframe / 数学动画 / Python 笔记本 / 摄像头 四个插件
> 全部正常渲染，无回退、无 CORS 报错，`MPSPlugins.assetCount()` 为 3。

### 体积：超大运行时文件怎么随包发布

`files` 里的每个文件都会被原样打进 ZIP，也会被原样上传到你的托管平台。托管平台常有
**单文件大小上限**（5MB / 10MB / 25MB 不等），这时用「压缩投放 + 运行时解压」可以绕过去。

`plugs/marimo/` 就是这么做的：

1. 投放压缩版 `pyodide/pyodide.asm.wasm.gz`（9.6MB → **3.0MB**），原始 `.wasm` 不投放；
2. 运行时把 `window.fetch` 包一层，只拦截 Pyodide 对 `pyodide.asm.wasm` 的请求，
   取同名的 `.gz` → `DecompressionStream('gzip')` 解压 → 以 `Content-Type: application/wasm`
   构造 `Response` 交回（`WebAssembly.instantiateStreaming` 需要这个 MIME）；
3. 拦截失败或同目录存在原始 `.wasm` 时自动回退，两条路都能跑。

三个坑：

1. `fetch` 的入参可能是**字符串 / `URL` 对象 / `Request` 对象**，判 URL 时要三种都兼容
   （`URL` 对象只有 `.href`，没有 `.url`）。
2. **拦截必须是临时的**：装好 → `loadPyodide()` → 立刻还原 `window.fetch`。
   常驻接管会连带劫持宿主和**打包器**的 fetch —— 打包器读到解压后的 10MB 原始 wasm，
   于是 ZIP 里同时出现 `.gz` 和 `.wasm`，体积翻倍（这个坑真踩过）。
3. `DecompressionStream` 需要 Chrome/Edge 103+、Firefox 113+、Safari 16.4+。

> 参考收益：marimo 的核心 wasm 单文件 9.63MB → **3.01MB**（gzip 后 31%）。
> 注意 base64 会再回到 4.02MB（见上节「双击可用」），所以 ZIP 整体约 11.8MB，
> 主要体积来自 Python 运行时本身（wasm + stdlib），已接近下限。

---

## 9. 宿主集成（给引擎维护者）

宿主侧只需三步。

```js
// 1) 首页引入插件管理器
// <script src="./lib/mps-plugins.js"></script>

// 2) 自定义 fence 规则：宿主语言自己处理，其余交给插件管理器
const hostFence = function (tokens, idx, options, env, self) {
    const token = tokens[idx];
    if (token.info.trim() === 'mermaid') {
        return '<div class="mermaid">' + token.content + '</div>';
    }
    const prev = md.renderer.rules.__mpsHostPrev;
    if (prev) return prev(tokens, idx, options, env, self);
    return self.renderToken(tokens, idx, options);
};
md.renderer.rules.__mpsHostPrev = md.renderer.rules.fence || null;
md.renderer.rules.fence = hostFence;

MPSPlugins.init({
    host: 'presenter',                       // 'engine' | 'presenter'
    md: md,
    fence: hostFence,                        // 兜底规则
    refresh: refreshAll,                     // 强制整页重渲染
    getSlideEl: function () { return el.slide; },
    getDeckSource: function () { return editor.value; },   // 可选：整份 Markdown 源
    getNav: function () { return nav; },                   // 可选：导航对象（插件经 ctx.nav 使用）
    setStatus: function (t) { ... },         // 仅 presenter
    insertAtCursor: function (t) { ... }     // 仅 presenter
});

// 3) 每个内容块入 DOM 后通知插件
function appendBlock(block) {
    const div = document.createElement('div');
    div.innerHTML = renderMarkdown(block.content);
    el.slide.appendChild(div);
    MPSPlugins.blockRendered(div);
}

// 4) 引导：扫描清单并安装启用的插件
MPSPlugins.on('pluginsReady', function () { refreshAll(); });
MPSPlugins.boot();                 // presenter：按状态解析结果安装
// MPSPlugins.boot({ auto: true }); // engine：扫描到即安装
```

另外两点别忘：

- 舞台点击守卫：`if (e.target.closest('[data-mps-plugin]')) return;`
- `refresh()` 要能忽略「已渲染索引」缓存，强制重渲染当前页（插件启停后围栏规则会变）：

```js
function refreshAll() {
    renderedSlideIndex = -1;
    renderedStepIndex = -1;
    renderCurrent();
}
```

### 对外 API 一览

| 方法 | 说明 |
| --- | --- |
| `MPSPlugins.init(cfg)` | 宿主注入上下文、安装 fence 规则（幂等） |
| `MPSPlugins.boot(opts)` | 扫描 `plugs/manifest.json` 并安装启用的插件；`{base, auto}`；重复调用幂等。若已在 `init`/`boot` 前设置 `window.MPS_PLUGINS_BAKED`，则直接用它、完全不 fetch（打包产物走这条） |
| `MPSPlugins.register(def)` | 插件入口调用 |
| `MPSPlugins.setEnabled(id, on)` | 开关插件，返回 Promise（会持久化） |
| `MPSPlugins.enable(id)` / `disable(id)` | 同上，不区分语义 |
| `MPSPlugins.isEnabled(id)` | boolean |
| `MPSPlugins.list()` | `[{id, name, description, version, author, icon, tabs, defaultEnabled, declared, loaded, enabled}]` |
| `MPSPlugins.on(evt, fn)` / `fire(evt, payload)` | 事件总线 |
| `MPSPlugins.blockRendered(el)` / `slideReset()` / `deckChanged()` | 宿主通知插件 |
| `MPSPlugins.slideChanged()` | 宿主在页 / 断点位置变化后调用（内部按位置去重），插件据此收到 `slideChanged` 事件 |
| `MPSPlugins.refresh()` | 让宿主重渲染 |
| `MPSPlugins.base()` | 当前插件根路径，默认 `./plugs/` |
| `MPSPlugins.bake(url, base64, mime)` | 登记一份随包资产（由打包产物生成的 `*.asset.js` 调用，插件作者不用管） |
| `MPSPlugins.bakeManifest(list)` | 登记内嵌清单（同上；通常直接用 `window.MPS_PLUGINS_BAKED`） |
| `MPSPlugins.assetCount()` | 已登记的随包资产数量，排错用 |

---

## 10. 调试与排错

| 现象 | 原因 / 处理 |
| --- | --- |
| 插件管理里一个插件都没有 | 不是 HTTP 环境，或 `plugs/manifest.json` 路径不对；控制台会有 `[plug] 插件清单加载失败…` |
| 控制台 `[plug:<id>] 插件未在 plugs/manifest.json 中声明` | 脚本被加载了但清单里没有它，请补登记 |
| 控制台 `[plug:<id>] 入口脚本已加载但未调用 MPSPlugins.register()` | `index.js` 里没写 `register`，或 `id` 拼错 |
| 代码块显示成源码 | 插件未启用；或围栏语言名与 `registerFence` 不一致；或渲染函数抛异常（看控制台） |
| 本机正常，打包后失效 | `plugin.json` 的 `files` / `runtime` 漏了文件 |
| 关了插件还有残留样式 / 监听 | 直接操作了 DOM 而没走 `ctx.addStyle` / `ctx.on` |
| `MPSPlugins.setEnabled(...).then` 报 undefined | 老版本 bug（v1.0 已修）；请用最新 `lib/mps-plugins.js` |

调试快捷键：

- `MPSPlugins.list()` 看当前登记与启用状态
- `localStorage.getItem('mps.plugins.state')` 看用户覆盖记录
- 日志前缀：`[plug]` 为宿主，`[plug:<id>]` 为插件

---

## 11. 交付检查清单

- [ ] 目录名、`plugin.json` 的 `id`、`register({id})` 三者一致
- [ ] 已登记进 `plugs/manifest.json`
- [ ] `setup` 之外没有任何副作用（脚本加载后不应改动宿主状态）
- [ ] `teardown` 能完整撤销 `setup`（含 `tab.remove()`）
- [ ] 围栏初始化写在 `blockRendered` 里，并做了去重标记
- [ ] **在 engine 下验证过**（打包产物就是 engine 模式）
- [ ] presenter 专属 API 都有 `ctx.host === 'presenter'` 判断
- [ ] `files` / `runtime` 列全，打包 ZIP 里能找齐插件文件
- [ ] 插件关闭后代码块回退为源码可读，无残留样式与报错
- [ ] 用 HTTP 打开验证，且已强刷（Ctrl+F5）避开缓存

---

## 12. 参考实现

`plugs/iframe/` 是最小的完整示例：单文件、无运行时依赖、纯字符串渲染（`iframe` 是声明式的，不需要 `blockRendered`）。
建议从它开始读，再对照 `plugs/mps-manim/` 看复杂场景。

`plugs/mps-manim/` 是最完整的示例，覆盖了：

| 能力 | 位置 |
| --- | --- |
| 清单 + 元数据 | [manifest.json](manifest.json) / [mps-manim/plugin.json](mps-manim/plugin.json) |
| 入口注册与生命周期 | [mps-manim/index.js](mps-manim/index.js) |
| 运行时与围栏渲染 | [mps-manim/mps-manim.js](mps-manim/mps-manim.js) |
| 跨宿主（engine + presenter） | `index.js` 的 `ctx.host !== 'presenter'` 分支 |
| 选项卡注入与撤销 | `index.js` 的 `setup` / `teardown` |
| 块入 DOM 后初始化 | `index.js` 的 `ctx.on('blockRendered', …)` |
| 私有持久化与状态栏 | `ctx.store.*` / `ctx.setStatus` |

`plugs/slide-quiz/` 是「交互 + 持久化 + 整卷统计」的示例，覆盖了：

| 能力 | 位置 |
| --- | --- |
| 围栏渲染完整 UI（而不是只放占位节点） | `mps-quiz.js` 的 `renderSet` / `renderBoard` |
| 交互绑定与事件冒泡拦截（不触发宿主翻页 / 热键） | `mps-quiz.js` 的 `bindSet` / `bindQuestion` |
| 私有持久化恢复作答状态 | `ctx.store` + `restoreSet` |
| 读取整卷 Markdown 做跨页统计 | `ctx.getDeckSource()` + `inventory()` |
| 重置后借宿主重渲染刷新界面 | `ctx.refresh()` + `resetDeck()` |
| 现场投票：MQTT over WebSocket + 二维码 + 实时图表 | `mps-poll.js` 的 `renderPoll` / `applyDeck` / 投票聚合 |
| 手机端投票页（独立静态页，靠 URL 参数携带连接配置） | `plugs/slide-quiz/vote.html` |

`plugs/mps-sim/` 是「交互模拟 + 导航联动」的示例：链接序列（`sim-link`）用
`ctx.nav.goto(slide)` / `ctx.nav.next()` 自动前进，并用 `ctx.nav.slide` / `ctx.nav.total`
做位置判断与提示（见 `mps-sim.js` 的链接序列部分）。