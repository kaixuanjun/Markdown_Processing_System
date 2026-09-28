/*!
 * MPS 插件 · 互动模拟（id: mps-sim）
 * -----------------------------------------------------------------------------
 * 参考 Nano Interactive Slides（NIS）的三段式交互，重写为适合 MPS 的插件：
 *   1) 模拟控制   ```sim       实时滑块 + 开始/暂停/重置 + 时间倍率 + 投影读数
 *                              + 快照条（手动 / 按模拟时间自动）+ 导出 PNG / JSON
 *   2) 链接序列   ```sim-link  指定下一站、按秒或按模拟结束自动前进、首次访问继承参数
 *   3) 纳米模式   ```nano      风格 / 种子 / 提示词 → 现场重绘；可接入真实 AI 接口
 * 在 presenter 的 Ribbon 中注入「互动模拟」选项卡（插入模板 / 现场控制 / 模型清单）。
 *
 * 目录：
 *   mps-sim.js    模拟运行时（DSL / 表达式编译 / RK4 / 视图 / 卡片 UI / 链接序列）
 *   mps-nano.js   纳米绘图运行时（内置确定性生成器 + 可插拔 AI 接口 + 缓存）
 *   index.js      本文件：只做注册，实际副作用全部在 setup/teardown 内
 * ========================================================================== */
(function () {
    'use strict';

    var NANO_HOOK_DOC = [
        'window.MPSNano.generateImage = async function (req) {',
        '    // req = { style, seed, prompt, width, height, hash }',
        '    // 返回 dataURL 字符串，或 { dataUrl: "..." }；抛错/返回空则自动回退内置生成器',
        '    const res = await fetch("/api/draw", {',
        '        method: "POST",',
        '        headers: { "Content-Type": "application/json" },',
        '        body: JSON.stringify(req)',
        '    });',
        '    const data = await res.json();',
        '    return data.dataUrl;',
        '};'
    ].join('\n');

    var TEMPLATES = {
        spring: [
            '```sim',
            'title 弹簧振子',
            'preset spring',
            'project x v',
            'snap 2',
            '```',
            ''
        ].join('\n'),

        pendulum: [
            '```sim',
            'title 单摆',
            'preset pendulum',
            'project th w',
            '```',
            ''
        ].join('\n'),

        projectile: [
            '```sim',
            'title 抛体运动',
            'preset projectile',
            'project x y',
            '```',
            ''
        ].join('\n'),

        sir: [
            '```sim',
            'title 传染病 SIR',
            'preset sir',
            'view bars S I R',
            'project I R',
            '```',
            ''
        ].join('\n'),

        logistic: [
            '```sim',
            'title 种群增长',
            'preset logistic',
            '```',
            ''
        ].join('\n'),

        lotka: [
            '```sim',
            'title 捕食者与被捕食者',
            'preset lotka',
            '```',
            ''
        ].join('\n'),

        lorenz: [
            '```sim',
            'title 洛伦兹吸引子',
            'preset lorenz',
            'view phase x z',
            'project x y z',
            '```',
            ''
        ].join('\n'),

        rc: [
            '```sim',
            'title RC 电路充电',
            'preset rc',
            '```',
            ''
        ].join('\n'),

        wave: [
            '```sim',
            'title 波的叠加',
            'preset wave',
            'project A1 f1 A2 f2',
            '```',
            ''
        ].join('\n'),

        custom: [
            '```sim',
            'title 自定义模型：阻尼受迫振动',
            '# 状态：每个 state 一行；导数：每个 d 一行（可用 t 与参数）',
            'state x 1',
            'state v 0',
            'param w 0.2 4 1.4 驱动频率 ω',
            'param damp 0 1 0.1 阻尼',
            'param F 0 3 0.8 驱动幅值 F',
            'd x = v',
            'd v = -x - damp*v + F*sin(w*t)',
            'view time',
            'project x v',
            '```',
            ''
        ].join('\n'),

        phase: [
            '```sim',
            'title 相图：捕食者系统',
            'preset lotka',
            'view phase prey pred',
            'project prey pred',
            '```',
            ''
        ].join('\n'),

        link: [
            '```sim-link',
            '# 本页演示结束后：停 6 秒自动前进，并把本页参数继承给第 5 页',
            'next 5',
            'after 6',
            'inherit',
            '```',
            ''
        ].join('\n'),

        linkDone: [
            '```sim-link',
            '# 主模拟一结束就前进（页面上的模拟卡报了「已结束」即触发）',
            'next 3',
            'done',
            '```',
            ''
        ].join('\n'),

        nano: [
            '```nano',
            'title 概念插图',
            'ratio 16:9',
            'style 渐变流体',
            'seed 42',
            'prompt 在正式接图之前，这里用内置确定性生成器出图',
            '```',
            ''
        ].join('\n')
    };

    var tab = null;   // 当前注入的选项卡 API（teardown 时移除）

    function insert(ctx, text) {
        if (ctx.insertAtCursor) ctx.insertAtCursor('\n' + text + '\n');
    }

    function pageStatus(ctx) {
        var lines = [];
        if (window.MPSSim) lines.push(window.MPSSim.status());
        if (window.MPSNano) lines.push(window.MPSNano.status());
        if (ctx.setStatus) ctx.setStatus(lines.join('　|　') || '互动模拟未就绪');
    }

    function togglePage(ctx, pause) {
        if (!window.MPSSim) return;
        var n = window.MPSSim.pausePage(pause);
        if (ctx.setStatus) {
            ctx.setStatus(n
                ? (pause ? '⏸ 已暂停本页 ' + n + ' 个模拟' : '▶ 已启动本页 ' + n + ' 个模拟')
                : '当前页没有模拟卡（先翻到模拟页再点）');
        }
    }

    function resetPage(ctx) {
        if (!window.MPSSim) return;
        var n = window.MPSSim.resetPage();
        if (ctx.setStatus) {
            ctx.setStatus(n ? '↺ 已重置本页 ' + n + ' 个模拟（参数保持不变）' : '当前页没有模拟卡');
        }
    }

    function rerollNano(ctx) {
        if (!window.MPSNano) return;
        var n = window.MPSNano.rerollPage();
        if (ctx.setStatus) {
            ctx.setStatus(n ? '🎲 已为本页 ' + n + ' 张纳米插图换新种子' : '当前页没有纳米插图');
        }
    }

    function showNanoHook(ctx) {
        if (ctx.setStatus) ctx.setStatus('纳米绘图接口写法已打印到控制台（window.MPSNano.generateImage）');
        try {
            console.log('%c[mps-sim] 接入真实 AI 绘图服务\n' + NANO_HOOK_DOC, 'font-family:monospace');
        } catch (e) { /* 忽略 */ }
    }

    function listModels(ctx) {
        if (!window.MPSSim) return;
        var list = window.MPSSim.modelList().map(function (m) { return m.id + '（' + m.name + '）'; }).join('、');
        if (ctx.setStatus) ctx.setStatus('内置模型：' + list);
        try { console.log('[mps-sim] 内置模型：\n' + list.replace(/、/g, '\n')); } catch (e) { /* 忽略 */ }
    }

    MPSPlugins.register({
        id: 'mps-sim',

        setup: function (ctx) {
            var S = window.MPSSim;
            var N = window.MPSNano;
            if (!S) ctx.log('运行时 mps-sim.js 未加载，互动模拟不可用');
            if (!N) ctx.log('运行时 mps-nano.js 未加载，纳米模式不可用');

            /* —— 模拟 + 链接序列 —— */
            if (S) {
                S.configure({
                    host: ctx.host,
                    meta: ctx.meta,
                    nav: ctx.nav,
                    store: ctx.store,
                    getDeckSource: ctx.getDeckSource,
                    getSlideEl: ctx.getSlideEl,
                    refresh: ctx.refresh,
                    log: ctx.log
                });
                ctx.registerFence('sim', function (token) { return S.renderSim(token.content); });
                ctx.registerFence('sim-link', function (token) { return S.renderLink(token.content); });
                ctx.addStyle(S.CSS);
                S.setEnabled(true);
            }

            /* —— 纳米模式 —— */
            if (N) {
                N.configure({
                    host: ctx.host,
                    meta: ctx.meta,
                    nav: ctx.nav,
                    store: ctx.store,
                    log: ctx.log
                });
                ctx.registerFence('nano', function (token) { return N.renderNano(token.content); });
                ctx.addStyle(N.CSS);
                N.setEnabled(true);
            }

            // 块入 DOM 后初始化卡片交互
            ctx.on('blockRendered', function (el) {
                if (S) { try { S.initIn(el); } catch (e) { ctx.log('模拟初始化失败: ' + e.message); } }
                if (N) { try { N.initIn(el); } catch (e) { ctx.log('纳米绘图初始化失败: ' + e.message); } }
            });

            // 页 / 断点变化：链接序列的自动前进与参数继承靠这个事件
            ctx.on('slideChanged', function (ev) {
                if (S) { try { S.onSlideChanged(ev); } catch (e) { ctx.log('链接序列处理失败: ' + e.message); } }
            });

            if (ctx.host !== 'presenter' || !ctx.ribbon) return;
            tab = ctx.ribbon.addTab({ id: 'mps-sim', label: '互动模拟', order: 56 });
            if (!tab) return;

            tab.addGroupLabel('插入模拟（内置模型）');
            [
                ['🎛️', '弹簧振子', 'spring'],
                ['⏱', '单摆', 'pendulum'],
                ['🎯', '抛体运动', 'projectile'],
                ['🦠', '传染病 SIR', 'sir'],
                ['📈', '种群增长', 'logistic'],
                ['🐇', '捕食者系统', 'lotka'],
                ['🌀', '洛伦兹吸引子', 'lorenz'],
                ['🔋', 'RC 充电', 'rc'],
                ['🌊', '波的叠加', 'wave']
            ].forEach(function (m) {
                tab.addButton({
                    id: 'msBtn-' + m[2], icon: m[0], label: m[1],
                    title: '插入「' + m[1] + '」模拟卡（参数滑块可现场调节）',
                    onClick: function () { insert(ctx, TEMPLATES[m[2]]); }
                });
            });
            tab.addButton({
                id: 'msBtn-custom', icon: '🧩', label: '自定义方程',
                title: '用 state / d 行自己写微分方程（含阻尼受迫振动示例）',
                onClick: function () { insert(ctx, TEMPLATES.custom); }
            });
            tab.addButton({
                id: 'msBtn-models', icon: '📚', label: '模型清单',
                title: '在状态栏与控制台列出全部内置模型 id',
                onClick: function () { listModels(ctx); }
            });
            tab.addDivider();

            tab.addGroupLabel('链接序列（翻页联动）');
            tab.addButton({
                id: 'msBtn-link', icon: '🔗', label: '按秒自动前进',
                title: '插入链接序列规则：停留指定秒数后自动翻到目标页，并可选继承本页参数',
                onClick: function () { insert(ctx, TEMPLATES.link); }
            });
            tab.addButton({
                id: 'msBtn-linkDone', icon: '✅', label: '按模拟结束前进',
                title: '插入链接序列规则：本页模拟一结束就自动前进',
                onClick: function () { insert(ctx, TEMPLATES.linkDone); }
            });
            tab.addDivider();

            tab.addGroupLabel('纳米模式（AI 绘图）');
            tab.addButton({
                id: 'msBtn-nano', icon: '🖼️', label: '纳米插图',
                title: '插入纳米绘图卡：风格 / 种子 / 提示词，现场重新生成',
                onClick: function () { insert(ctx, TEMPLATES.nano); }
            });
            tab.addButton({
                id: 'msBtn-nanoReroll', icon: '🎲', label: '重掷种子',
                title: '为当前页所有纳米插图换一个随机种子并重新生成',
                onClick: function () { rerollNano(ctx); }
            });
            tab.addButton({
                id: 'msBtn-nanoHook', icon: '🔌', label: '接入 AI 接口',
                title: '在控制台打印 window.MPSNano.generateImage 的接入写法',
                onClick: function () { showNanoHook(ctx); }
            });
            tab.addDivider();

            tab.addGroupLabel('现场控制');
            tab.addButton({
                id: 'msBtn-play', icon: '▶', label: '启动本页',
                title: '启动当前页的所有模拟卡',
                onClick: function () { togglePage(ctx, false); }
            });
            tab.addButton({
                id: 'msBtn-pause', icon: '⏸', label: '暂停本页',
                title: '暂停当前页的所有模拟卡',
                onClick: function () { togglePage(ctx, true); }
            });
            tab.addButton({
                id: 'msBtn-reset', icon: '↺', label: '重置本页',
                title: '把本页模拟卡重置到初始状态（参数保持不变）',
                onClick: function () { resetPage(ctx); }
            });
            tab.addButton({
                id: 'msBtn-status', icon: '📡', label: '模拟状态',
                title: '在状态栏显示本页与全卷的模拟 / 纳米插图数量',
                onClick: function () { pageStatus(ctx); }
            });

            tab.addHint('把幻灯片变成「可操控的模拟」：插入任意内置模型即可现场拖滑块调参，画面实时响应；' +
                '「快照」定格画面用于前后对比，「PNG / JSON」导出当前状态。<br>' +
                '链接序列让演示自动流转：<code>next</code> 指定下一站、<code>after 6</code> 停 6 秒自动前进、' +
                '<code>done</code> 等模拟结束再前进、<code>inherit</code> 把本页参数继承给目标页（首次访问时生效）。<br>' +
                '自定义方程：<code>state x 1</code> 声明状态，<code>d x = ...</code> 写导数，' +
                '可用 <code>t</code> 与 <code>param</code> 定义的参数；内置模型见「模型清单」。');
            ctx.log('已注入「互动模拟」选项卡');
        },

        teardown: function (ctx) {
            if (tab) { tab.remove(); tab = null; }
            if (window.MPSSim) { window.MPSSim.setEnabled(false); window.MPSSim.shutdown(); }
            if (window.MPSNano) { window.MPSNano.setEnabled(false); window.MPSNano.shutdown(); }
            ctx.log('已停用');
        }
    });
})();
