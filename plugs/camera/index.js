/*!
 * MPS 插件 · 摄像头画面（id: camera）
 * -----------------------------------------------------------------------------
 * 把 ```camera 代码块变成一块浮在幻灯片上的摄像头窗口：拖拽移动、拖拽边缘 / 四角
 * 缩放、工具条里切换遮罩形状（8 种，可圆形 / 星形）、左右镜像、切换摄像头。
 *
 * 目录：
 *   mps-camera.js   运行时（窗口 UI、拖拽交互、遮罩、getUserMedia 管理）
 *   index.js        本文件：只做注册，实际副作用全部在 setup/teardown 内
 *
 * 注意：全程不触碰 presenter / engine 本体，只通过 MPSPlugins 提供的 ctx 接口接入。
 * ========================================================================== */
(function () {
    'use strict';

    var TEMPLATES = {
        corner: [
            '```camera',
            'at 70 6',
            'size 26 38',
            'mask rounded',
            '```',
            ''
        ].join('\n'),

        circle: [
            '```camera',
            'at 74 8',
            'size 20 20',
            'mask circle',
            'label 讲师',
            '```',
            ''
        ].join('\n'),

        big: [
            '```camera',
            'at 52 10',
            'size 44 60',
            'mask squircle',
            '```',
            ''
        ].join('\n')
    };

    var tab = null;   // 当前注入的选项卡 API（teardown 时移除）

    function insert(ctx, text) {
        if (ctx.insertAtCursor) ctx.insertAtCursor('\n' + text + '\n');
    }

    // 把当前页所有窗口换成指定遮罩；遮罩名同时记为该插件的默认形状
    function maskAll(ctx, name) {
        if (!window.MPSCamera) return;
        var n = window.MPSCamera.applyMask(name);
        if (ctx.setStatus) {
            ctx.setStatus(n ? '已把 ' + n + ' 个摄像头窗口的遮罩改为「' + window.MPSCamera.MASKS[name].label + '」'
                : '当前页没有摄像头窗口');
        }
    }

    MPSPlugins.register({
        id: 'camera',

        setup: function (ctx) {
            var C = window.MPSCamera;
            if (!C) { ctx.log('运行时 mps-camera.js 未加载，插件不可用'); return; }

            // 运行时只认 ctx 暴露的能力，不直接依赖宿主实现细节
            C.configure({
                store: ctx.store,
                getSlideEl: ctx.getSlideEl,
                log: ctx.log
            });

            // 围栏：```camera → 一个隐藏锚点；真正的窗口由运行时挂到舞台上
            ctx.registerFence('camera', function (token) {
                return '<div class="cam-host" data-mps-camera="' +
                    encodeURIComponent(token.content) + '"></div>';
            });

            ctx.addStyle(C.CSS);

            // 块入 DOM 后挂载窗口（此时才拿得到舞台尺寸）
            ctx.on('blockRendered', function (el) {
                try { C.initIn(el); }
                catch (e) { ctx.log('摄像头窗口初始化失败: ' + e.message); }
            });
            // 幻灯片重建 / 换页：回收已离开文档的窗口
            ctx.on('slideReset', function () { C.prune(); });
            ctx.on('deckChanged', function () { C.prune(); });

            // presenter 专属：注入「摄像头」选项卡
            if (ctx.host !== 'presenter' || !ctx.ribbon) return;
            tab = ctx.ribbon.addTab({ id: 'camera', label: '摄像头', order: 52 });
            if (!tab) return;

            tab.addGroupLabel('插入画面');
            tab.addButton({
                id: 'camCornerBtn', icon: '🎥', label: '右上角画面',
                title: '插入一个位于右上角的圆角摄像头画面',
                onClick: function () { insert(ctx, TEMPLATES.corner); }
            });
            tab.addButton({
                id: 'camCircleBtn', icon: '⭕', label: '圆形头像',
                title: '插入一个圆形的摄像头画面（适合讲师头像）',
                onClick: function () { insert(ctx, TEMPLATES.circle); }
            });
            tab.addButton({
                id: 'camBigBtn', icon: '🖵', label: '大幅画面',
                title: '插入一个较大的摄像头画面（适合演示实物）',
                onClick: function () { insert(ctx, TEMPLATES.big); }
            });
            tab.addDivider();

            tab.addGroupLabel('遮罩形状');
            C.MASK_ORDER.forEach(function (key) {
                tab.addButton({
                    id: 'camMask_' + key,
                    icon: C.MASKS[key].icon,
                    label: C.MASKS[key].label,
                    title: '把当前页所有摄像头窗口改成「' + C.MASKS[key].label + '」',
                    onClick: function () { maskAll(ctx, key); }
                });
            });
            tab.addDivider();

            tab.addGroupLabel('设备');
            tab.addButton({
                id: 'camSwitchBtn', icon: '🔄', label: '切换摄像头',
                title: '在本机的多个摄像头之间轮换',
                onClick: function () {
                    var msg = C.cycleDevice();
                    if (ctx.setStatus) ctx.setStatus(msg);
                }
            });
            tab.addButton({
                id: 'camRetryBtn', icon: '🔌', label: '重新连接',
                title: '重新申请摄像头权限并重连（权限被拒或设备被占用时使用）',
                onClick: function () {
                    if (ctx.setStatus) ctx.setStatus('正在重新连接摄像头…');
                    C.restart().then(function () {
                        if (ctx.setStatus) ctx.setStatus('✔ 摄像头已连接');
                    }).catch(function () {
                        if (ctx.setStatus) ctx.setStatus('✕ 摄像头连接失败，请检查浏览器权限设置');
                    });
                }
            });

            tab.addHint('画面可直接拖动移动；拖四边 / 四角缩放；悬停画面底部工具条可改遮罩、镜像、切换摄像头' +
                '（触摸屏或无鼠标时，点一下画面即可固定工具条）。<br>' +
                '位置与尺寸会记住（改代码块内容即视为新窗口）。<br>' +
                '摄像头需 <b>https</b> 或 <b>http://localhost</b> 才能调用，<code>file://</code> 下浏览器会拒绝。');
            ctx.log('已注入「摄像头」选项卡');
        },

        teardown: function (ctx) {
            if (tab) { tab.remove(); tab = null; }
            if (window.MPSCamera) window.MPSCamera.shutdown();
            ctx.log('已停用');
        }
    });
})();
