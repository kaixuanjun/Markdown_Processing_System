/*!
 * MPS 插件 · Python 笔记本（id: marimo）
 * -----------------------------------------------------------------------------
 * 把 ```marimo 代码块渲染成 marimo 风格的反应式 Python 笔记本，并在 presenter 的
 * Ribbon 中注入「Python 笔记本」选项卡（插入模板 / 预加载运行时 / 关于 marimo）。
 *
 * 目录：
 *   runtime.js      运行时（单元格解析、依赖分析、Pyodide 执行、笔记本 UI）
 *   pyodide/        内置的 Pyodide(WASM) Python 运行时，全部为本地文件，不联网
 *   index.js        本文件：只做注册，实际副作用全部在 setup/teardown 内
 * ========================================================================== */
(function () {
    'use strict';

    var SITE = 'https://marimo.io/';

    var TEMPLATES = {
        // 最简：两个单元格，后者依赖前者
        basic: [
            '```marimo',
            '# %% 定义数据',
            'import math',
            'radius = 2.5',
            'area = math.pi * radius ** 2',
            '',
            '# %% 使用数据（改上面的 radius，这里会自动重算）',
            'print(f"半径 {radius} 的圆面积 = {area:.3f}")',
            'area',
            '```',
            ''
        ].join('\n'),

        // 反应式演示：改上游 → 下游自动重算
        reactive: [
            '```marimo',
            '# %% 输入（试着把 n 改成别的值）',
            'n = 12',
            '',
            '# %% 计算：依赖上面的 n',
            'squares = [i ** 2 for i in range(1, n + 1)]',
            'total = sum(squares)',
            '',
            '# %% 输出：依赖 squares 与 total',
            'print("前", n, "个平方数：", squares)',
            'print("它们的和 =", total)',
            '```',
            ''
        ].join('\n'),

        // 表格 + _repr_html_
        table: [
            '```marimo',
            '# %% 准备数据',
            'rows = [("苹果", 3, 4.5), ("香蕉", 5, 2.0), ("樱桃", 12, 0.8)]',
            '',
            '# %% 生成 HTML 表格（单元格最后一行会被展示）',
            'class Table:',
            '    def __init__(self, rows):',
            '        self.rows = rows',
            '    def _repr_html_(self):',
            '        head = "<tr><th>品名</th><th>数量</th><th>单价</th></tr>"',
            '        body = "".join(',
            '            f"<tr><td>{n}</td><td>{c}</td><td>{p}</td></tr>" for n, c, p in self.rows)',
            '        return f"<table>{head}{body}</table>"',
            'Table(rows)',
            '```',
            ''
        ].join('\n'),

        // marimo 原生格式：可直接从 .py 笔记本粘贴（样板行会被自动忽略）
        native: [
            '```marimo',
            'import marimo',
            '',
            '__generated_with = "0.9.0"',
            'app = marimo.App(width="medium")',
            '',
            '',
            '@app.cell',
            'def _():',
            '    greeting = "你好，marimo"',
            '    return (greeting,)',
            '',
            '',
            '@app.cell',
            'def _(greeting):',
            '    print(greeting)',
            '    return',
            '',
            '',
            'if __name__ == "__main__":',
            '    app.run()',
            '```',
            ''
        ].join('\n')
    };

    var tab = null;

    function insert(ctx, text) {
        if (ctx.insertAtCursor) ctx.insertAtCursor('\n' + text + '\n');
    }

    MPSPlugins.register({
        id: 'marimo',

        setup: function (ctx) {
            // 1) 围栏渲染：```marimo 先落一个空壳，真正的笔记本在块入 DOM 后由运行时接管
            ctx.registerFence('marimo', function (token) {
                return '<div class="mrm-host" data-mps-marimo="' +
                    encodeURIComponent(token.content) + '"></div>';
            });

            // 2) 每个内容块渲染进 DOM 后初始化其中的笔记本（会自动运行）
            ctx.on('blockRendered', function (el) {
                if (!window.MPSMarimo) return;
                try { window.MPSMarimo.initIn(el); }
                catch (e) { ctx.log('笔记本初始化失败: ' + e.message); }
            });
            // 幻灯片重绘后回收已离开文档的旧笔记本
            ctx.on('slideReset', function () { if (window.MPSMarimo) window.MPSMarimo.cleanup(); });

            if (ctx.host !== 'presenter' || !ctx.ribbon) return;
            tab = ctx.ribbon.addTab({ id: 'marimo', label: 'Python 笔记本', order: 58 });
            if (!tab) return;

            tab.addGroupLabel('插入笔记本');
            tab.addButton({
                id: 'mrmBasicBtn', icon: '🐍', label: '基础示例',
                title: '插入两个单元格的最小示例（下游依赖上游）',
                onClick: function () { insert(ctx, TEMPLATES.basic); }
            });
            tab.addButton({
                id: 'mrmReactiveBtn', icon: '⚡', label: '反应式演示',
                title: '插入反应式示例：改上游单元格，下游自动重算',
                onClick: function () { insert(ctx, TEMPLATES.reactive); }
            });
            tab.addButton({
                id: 'mrmTableBtn', icon: '📊', label: 'HTML 表格',
                title: '插入返回 HTML 表格的示例（单元格最后一行会展示）',
                onClick: function () { insert(ctx, TEMPLATES.table); }
            });
            tab.addButton({
                id: 'mrmNativeBtn', icon: '📄', label: 'marimo 原生格式',
                title: '插入 marimo .py 笔记本的 @app.cell 格式（可直接粘贴真实笔记本）',
                onClick: function () { insert(ctx, TEMPLATES.native); }
            });
            tab.addDivider();

            tab.addGroupLabel('运行时');
            tab.addButton({
                id: 'mrmPreloadBtn', icon: '⏳', label: '预加载 Python',
                title: '提前把内置的 Pyodide 运行时载入内存（首次运行约需 1~3 秒）',
                onClick: function () {
                    if (!window.MPSMarimo) return;
                    ctx.setStatus('🐍 正在预加载 Python 运行时 …');
                    window.MPSMarimo.loadRuntime().then(function () {
                        ctx.setStatus('✔ Python 运行时已就绪（下次运行无需等待）');
                    }).catch(function (e) {
                        ctx.setStatus('✕ Python 运行时载入失败：' + e.message +
                            '（需通过 HTTP 打开，且 plugs/marimo/pyodide/ 完整）');
                    });
                }
            });
            tab.addButton({
                id: 'mrmSiteBtn', icon: '🔗', label: '关于 marimo',
                title: '在新标签页打开 marimo 官网',
                onClick: function () { window.open(SITE, '_blank', 'noopener'); }
            });

            tab.addHint('单元格用 <code># %%</code> 分隔，也可直接粘贴 marimo 的 <code>@app.cell</code> 格式。<br>' +
                '依赖关系自动推导，按依赖顺序运行；改上游单元格，下游会自动重算；' +
                '打开幻灯片即自动跑一次，顶栏的「↻ 重跑」用于手动从头再来。<br>' +
                'Python 由随插件内置的 Pyodide 执行，完全离线；仅含标准库，' +
                '因此 <code>import marimo</code>、<code>app = marimo.App()</code> 这类样板行会被自动忽略。<br>' +
                '运行时以压缩版投放（<code>pyodide.asm.wasm.gz</code> 约 3MB，运行时本地解压），' +
                '便于放进有单文件大小限制的托管平台。');
            ctx.log('已注入「Python 笔记本」选项卡');
        },

        teardown: function (ctx) {
            if (tab) { tab.remove(); tab = null; }
            ctx.log('已停用');
        }
    });
})();