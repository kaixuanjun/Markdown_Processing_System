/*!
 * MPS 插件 · 数学动画（id: mps-manim）
 * -----------------------------------------------------------------------------
 * 把 ```manim 代码块渲染为可播放的浏览器端数学动画，并在 presenter 的 Ribbon
 * 中注入「数学动画」选项卡（插入模板 / 官方教程 / 重播动画）。
 *
 * 目录：
 *   mps-manim.js   运行时（Canvas 几何 + DOM/KaTeX 公式 + 时间轴播放器）
 *   index.js       本文件：只做注册，实际副作用全部在 setup/teardown 内
 * ========================================================================== */
(function () {
    'use strict';

    var TUTORIAL_URL = 'https://docs.manim.community/en/stable/tutorials/index.html';

    var TEMPLATES = {
        blank: [
            '```manim',
            'axes -4 4 -2 2.4',
            'grid',
            'text title "标题" at 0 1.9',
            'dot p at 0 0 color=#f78166',
            'play write title run=0.8',
            'play fadein p run=0.6',
            'play move p 2 1 run=1.2',
            '```',
            ''
        ].join('\n'),
        plot: [
            '```manim',
            'axes -4 4 -2 2.4',
            'grid',
            'plot f "sin(x)" -4 4 color=#58a6ff',
            'math lb "y=\\sin(x)" at -2.2 1.85',
            'dot d at 0 0 color=#f78166 r=0.09',
            'line l 1.57 0 1.57 1 color=#8b949e',
            'play create f run=1.6',
            'play write lb run=0.8',
            'play fadein d run=0.5',
            'play MoveAlongPath d f 0 1.57 run=1.6 rate=linear',
            'play create l run=0.3',
            '```',
            ''
        ].join('\n'),
        math: [
            '```manim',
            'math e1 "a^2+b^2=c^2" at 0 1.1',
            'math e2 "(a+b)^2=a^2+2ab+b^2" at 0 -0.3',
            'line bar -2.4 -1.1 2.4 -1.1 color=#8b949e',
            'play write e1 run=1',
            'wait 0.3',
            'play write e2 run=1.3',
            'play create bar run=0.5',
            '```',
            ''
        ].join('\n'),
        transform: [
            '```manim',
            'text title "圆的面积" at 0 2.4',
            'rect r -1 -1 2 2 color=#3fb950 fill=#3fb950',
            'circle c 0 0 1 color=#58a6ff',
            'play write title run=0.8',
            'play create r run=1',
            'play transform r -> c run=1.6',
            'play indicate c run=0.9',
            '```',
            ''
        ].join('\n')
    };

    var tab = null;   // 当前注入的选项卡 API（teardown 时移除）

    function insert(ctx, text) {
        if (ctx.insertAtCursor) ctx.insertAtCursor('\n' + text + '\n');
    }

    function replay(ctx) {
        var slide = ctx.getSlideEl();
        if (!slide || !window.MPSManim) return;
        var n = window.MPSManim.replayIn(slide);
        if (ctx.setStatus) ctx.setStatus(n ? '已重播 ' + n + ' 个动画' : '当前页没有动画');
    }

    MPSPlugins.register({
        id: 'mps-manim',

        setup: function (ctx) {
            // 1) 围栏渲染：```manim → 场景容器（真正的播放器在块入 DOM 后由运行时接管）
            ctx.registerFence('manim', function (token) {
                return '<div class="manim-scene" data-mps-manim="' +
                    encodeURIComponent(token.content) + '"></div>';
            });

            // 2) 样式
            ctx.addStyle('.slide .manim-scene{margin:.85em 0;}');

            // 3) 每个内容块渲染进 DOM 后初始化其中的场景
            ctx.on('blockRendered', function (el) {
                if (!el || !window.MPSManim) return;
                try { window.MPSManim.initIn(el); }
                catch (e) { ctx.log('场景初始化失败: ' + e.message); }
            });

            if (window.MPSManim) window.MPSManim.setEnabled(true);

            // 4) presenter 专属：注入「数学动画」选项卡
            if (ctx.host !== 'presenter' || !ctx.ribbon) return;
            tab = ctx.ribbon.addTab({ id: 'manim', label: '数学动画', order: 50 });
            if (!tab) return;

            tab.addGroupLabel('参考');
            tab.addButton({
                id: 'manimTutorialBtn', icon: '📖', label: '官方教程',
                title: '在新标签页打开 Manim 官方教程',
                onClick: function () { window.open(TUTORIAL_URL, '_blank', 'noopener'); }
            });
            tab.addHint('本插件实现的是 manim 语法的浏览器端轻量子集。');
            tab.addDivider();

            tab.addGroupLabel('插入场景');
            tab.addButton({
                id: 'mmInsertBtn', icon: '🎬', label: 'Manim 动画',
                title: '插入 Manim 动画场景',
                onClick: function () { insert(ctx, TEMPLATES.blank); }
            });
            tab.addButton({
                id: 'mmPlotBtn', icon: '📈', label: '函数图像',
                title: '插入函数图像动画',
                onClick: function () { insert(ctx, TEMPLATES.plot); }
            });
            tab.addButton({
                id: 'mmMathBtn', icon: '🧮', label: '公式推导',
                title: '插入公式推导动画',
                onClick: function () { insert(ctx, TEMPLATES.math); }
            });
            tab.addButton({
                id: 'mmTransformBtn', icon: '🔷', label: '几何变换',
                title: '插入几何变换动画',
                onClick: function () { insert(ctx, TEMPLATES.transform); }
            });
            tab.addDivider();

            tab.addGroupLabel('播放');
            tab.addButton({
                id: 'replayAnimBtn', icon: '↻', label: '重播动画',
                title: '重播当前页的所有动画',
                onClick: function () { replay(ctx); }
            });

            ctx.log('已注入「数学动画」选项卡');
        },

        teardown: function (ctx) {
            if (tab) { tab.remove(); tab = null; }
            if (window.MPSManim) window.MPSManim.setEnabled(false);
            ctx.log('已停用');
        }
    });
})();