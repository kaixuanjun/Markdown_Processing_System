/*!
 * MPS 插件运行时 · 摄像头窗口（window.MPSCamera）
 * -----------------------------------------------------------------------------
 * 把 ```camera 代码块变成一块浮在舞台上的摄像头画面：
 *   · 拖动画面 = 移动；拖动四边 / 四角 = 缩放（圆形 / 星形遮罩自动保持正方形）
 *   · 悬停出现工具条：遮罩形状（8 种）、左右镜像、切换摄像头
 *   · 位置 / 尺寸 / 遮罩按「代码块内容哈希」持久化，改 DSL 即换一套独立配置
 *   · 位置尺寸用百分比，舞台缩放（换画幅 / 进放映 / 全屏）时按比例跟随
 *
 * DSL（代码块正文，全部可选）：
 *   mask circle      遮罩：rounded / squircle / circle / oval / square / hex / blob / star
 *   at 68 6          左上角位置（≤100 视为百分比，>100 视为像素）
 *   size 26 38       宽 / 高（规则同上）
 *   mirror off       是否左右镜像，默认 on
 *   label 讲师画面    画面左上角角标
 *
 * 宿主依赖：ctx.store（持久化）、ctx.getSlideEl（定位舞台）、ctx.log
 * 本文件只在加载期定义 window.MPSCamera，不产生任何副作用。
 * ========================================================================== */
(function (global) {
    'use strict';

    var doc = global.document;

    /* ======================= 遮罩形状 ======================= */

    var MASKS = {
        rounded:  { label: '圆角矩形', icon: '▢', radius: '10%' },
        squircle: { label: '超椭圆',   icon: '◪', radius: '26%' },
        circle:   { label: '圆形',     icon: '◯', clip: 'circle(closest-side at 50% 50%)', square: true },
        oval:     { label: '椭圆',     icon: '⬭', clip: 'ellipse(closest-side closest-side at 50% 50%)' },
        square:   { label: '直角方形', icon: '◻', radius: '0' },
        hex:      { label: '六边形',   icon: '⬡', clip: 'polygon(25% 1%,75% 1%,99% 50%,75% 99%,25% 99%,1% 50%)' },
        blob:     { label: '有机形',   icon: '◗', radius: '46% 54% 60% 40% / 44% 42% 58% 56%' },
        star:     { label: '星形',     icon: '★', clip: 'polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)', square: true }
    };
    var MASK_ORDER = ['rounded', 'squircle', 'circle', 'oval', 'square', 'hex', 'blob', 'star'];

    var MIN_W = 96;            // 最小宽度（px）
    var MIN_H = 72;            // 最小高度（px）
    var IDLE_RELEASE = 4000;   // 无窗口后延迟释放摄像头，避免来回翻页反复重启
    var DETACH_GRACE = 1200;   // 窗口脱离文档后的复用宽限期（翻页复用节点，画面不闪断）

    /* ======================= 样式 ======================= */

    var BASE_CSS = [
        /* 围栏占位：只作为锚点，不占版面 */
        '.cam-host{display:none;}',

        /* 窗口本体：绝对定位在舞台上，位置 / 尺寸用百分比 */
        '.cam-win{position:absolute;z-index:30;touch-action:none;user-select:none;-webkit-user-select:none;',
        'font:inherit;color:var(--text-primary,#1f2328);}',
        '.cam-win,.cam-win *{box-sizing:border-box;}',

        /* clip-path 会裁掉 box-shadow，所以投影放在外层用 drop-shadow 贴着形状画 */
        '.cam-shadow{position:relative;z-index:1;width:100%;height:100%;cursor:move;',
        'filter:drop-shadow(0 8px 22px rgba(0,0,0,.26));}',
        '.cam-frame{width:100%;height:100%;padding:3px;background:var(--bg-slide,#fff);}',
        '.cam-clip{position:relative;width:100%;height:100%;overflow:hidden;background:#0b0f14;}',
        '.cam-video{position:absolute;left:0;top:0;display:block;width:100%;height:100%;object-fit:cover;}',
        '.cam-video.mirror{transform:scaleX(-1);}',

        /* 角标 */
        '.cam-label{position:absolute;left:7px;top:7px;max-width:calc(100% - 14px);overflow:hidden;',
        'text-overflow:ellipsis;white-space:nowrap;padding:1px 8px;border-radius:20px;font-size:11px;line-height:1.7;',
        'background:rgba(0,0,0,.42);color:#fff;letter-spacing:.3px;}',
        '.cam-label[hidden]{display:none;}',

        /* 状态层：加载中 / 出错 */
        '.cam-state{position:absolute;left:0;right:0;top:0;bottom:0;display:none;flex-direction:column;gap:8px;',
        'align-items:center;justify-content:center;padding:10px;text-align:center;font-size:11.5px;line-height:1.6;',
        'color:#c9d1d9;background:rgba(13,17,23,.88);}',
        '.cam-win.cam-loading .cam-state,.cam-win.cam-err .cam-state{display:flex;}',
        '.cam-state button{display:none;padding:3px 11px;border-radius:6px;font:inherit;font-size:11px;cursor:pointer;',
        'border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;}',
        '.cam-win.cam-err .cam-state button{display:inline-block;}',
        '.cam-state button:hover{background:rgba(255,255,255,.16);}',

        /* 拖拽把手：四边 + 四角 */
        '.cam-h{position:absolute;z-index:4;}',
        '.cam-h[data-dir="n"]{left:12px;right:12px;top:-5px;height:10px;cursor:ns-resize;}',
        '.cam-h[data-dir="s"]{left:12px;right:12px;bottom:-5px;height:10px;cursor:ns-resize;}',
        '.cam-h[data-dir="w"]{top:12px;bottom:12px;left:-5px;width:10px;cursor:ew-resize;}',
        '.cam-h[data-dir="e"]{top:12px;bottom:12px;right:-5px;width:10px;cursor:ew-resize;}',
        '.cam-h.corner{width:16px;height:16px;}',
        '.cam-h[data-dir="nw"]{left:-6px;top:-6px;cursor:nwse-resize;}',
        '.cam-h[data-dir="ne"]{right:-6px;top:-6px;cursor:nesw-resize;}',
        '.cam-h[data-dir="sw"]{left:-6px;bottom:-6px;cursor:nesw-resize;}',
        '.cam-h[data-dir="se"]{right:-6px;bottom:-6px;cursor:nwse-resize;}',
        '.cam-h.corner::after{content:"";position:absolute;left:50%;top:50%;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;',
        'border-radius:50%;background:#fff;border:1px solid rgba(0,0,0,.42);opacity:0;transition:opacity .15s;}',
        '.cam-win:hover .cam-h.corner::after{opacity:1;}',

        /* 工具条（悬停显示，位于画面底部居中，不会被遮罩裁掉） */
        '.cam-tools{position:absolute;left:50%;bottom:6px;transform:translateX(-50%);z-index:5;display:flex;',
        'align-items:center;gap:2px;padding:3px;border-radius:9px;background:rgba(22,27,34,.72);',
        'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;pointer-events:none;transition:opacity .16s;}',
        '.cam-win:hover .cam-tools,.cam-win.cam-show .cam-tools,.cam-win.cam-pick .cam-tools{opacity:1;pointer-events:auto;}',
        '.cam-win.cam-drag .cam-tools{opacity:0;pointer-events:none;}',
        '.cam-tools button,.cam-masks button{display:flex;align-items:center;justify-content:center;padding:0;border:0;',
        'background:transparent;color:#e6edf3;font-family:inherit;cursor:pointer;}',
        '.cam-tools button{width:24px;height:24px;border-radius:6px;font-size:13px;line-height:1;}',
        '.cam-tools button:hover,.cam-masks button:hover{background:rgba(255,255,255,.18);}',

        /* 遮罩选择面板 */
        '.cam-masks{position:absolute;left:50%;bottom:36px;transform:translateX(-50%);z-index:6;display:grid;',
        'grid-template-columns:repeat(4,1fr);gap:3px;padding:5px;border-radius:10px;background:rgba(22,27,34,.9);',
        'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);box-shadow:0 6px 18px rgba(0,0,0,.32);',
        'opacity:0;pointer-events:none;transition:opacity .16s;}',
        '.cam-win.cam-pick .cam-masks{opacity:1;pointer-events:auto;}',
        '.cam-masks button{width:22px;height:20px;border-radius:6px;}',
        '.cam-masks button.on{background:rgba(88,166,255,.55);}',
        '.cam-mk{display:block;width:15px;height:12px;background:#dbe4ee;}',
        '.cam-masks button.on .cam-mk{background:#fff;}'
    ].join('');

    // 把遮罩定义展开成形状规则（窗口外描边 + 选择面板里的迷你图标共用同一套路径）
    function maskRules() {
        var out = [];
        MASK_ORDER.forEach(function (k) {
            var d = MASKS[k];
            var sel = '.cam-win[data-mask="' + k + '"] .cam-frame,' +
                '.cam-win[data-mask="' + k + '"] .cam-clip,' +
                '.cam-mk[data-m="' + k + '"]';
            out.push(sel + (d.clip ? '{clip-path:' + d.clip + ';}' : '{border-radius:' + (d.radius || '0') + ';}'));
        });
        return out.join('');
    }

    /* ======================= 状态 ======================= */

    var cfg = { store: null, getSlideEl: null, log: null };
    var wins = [];          // 已挂载的窗口记录
    var stream = null;      // 所有窗口共用的一条摄像头流
    var pending = null;     // 进行中的 getUserMedia
    var deviceId = '';      // 当前摄像头（全局，所有窗口同步）
    var devices = [];       // 可用的视频输入设备
    var idleTimer = 0;
    var pruneTimer = 0;
    var observer = null;
    var docBound = false;
    var memStore = {};      // ctx.store 不可用时的兜底

    function log(msg) { if (cfg.log) cfg.log(msg); }
    function clamp(n, a, b) { return n < a ? a : (n > b ? b : n); }
    function r2(n) { return Math.round(n * 100) / 100; }

    function storeGet(k, def) {
        if (cfg.store) return cfg.store.get(k, def);
        return Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : def;
    }
    function storeSet(k, v) {
        if (cfg.store) cfg.store.set(k, v); else memStore[k] = v;
    }

    // 代码块内容 → 稳定短哈希，用作该窗口的配置键（改 DSL = 换一套配置）
    function hash(str) {
        var h = 5381, i = String(str).length;
        while (i) h = (h * 33 ^ String(str).charCodeAt(--i)) >>> 0;
        return h.toString(36);
    }

    /* ======================= DSL 解析 ======================= */

    function maskKey(v) {
        v = String(v == null ? '' : v).trim();
        if (!v) return '';
        var low = v.toLowerCase();
        if (MASKS[low]) return low;
        for (var k in MASKS) { if (MASKS[k].label === v) return k; }   // 允许写中文名
        return '';
    }

    function twoNums(s) {
        var m = /^(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)/.exec(String(s || '').replace(/[,%]/g, ' ').trim());
        return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
    }

    function parseSpec(src) {
        var spec = { mask: '', maskSet: false, x: 68, y: 6, w: 26, h: 38, mirror: true, mirrorSet: false, label: '' };
        var lines = String(src || '').split(/\r?\n/);

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line || line.charAt(0) === '#') continue;

            // 裸写遮罩名：```camera / circle
            var bare = maskKey(line);
            if (bare) { spec.mask = bare; spec.maskSet = true; continue; }

            var m = /^([A-Za-z][\w-]*)\s*([\s\S]*)$/.exec(line);
            if (!m) { log('忽略无法识别的一行：' + line); continue; }
            var key = m[1].toLowerCase(), rest = (m[2] || '').trim();

            if (key === 'mask' || key === 'shape') {
                var mk = maskKey(rest);
                if (mk) { spec.mask = mk; spec.maskSet = true; }
                else log('未知遮罩：' + rest);
            } else if (key === 'at' || key === 'pos') {
                var a = twoNums(rest);
                if (a) { spec.x = a[0]; spec.y = a[1]; }
            } else if (key === 'size' || key === 'box') {
                var b = twoNums(rest);
                if (b) { spec.w = b[0]; spec.h = b[1]; }
            } else if (key === 'mirror') {
                spec.mirror = !/^(off|false|no|0|关|否)$/i.test(rest);
                spec.mirrorSet = true;
            } else if (key === 'label' || key === 'title') {
                spec.label = rest.replace(/^["']|["']$/g, '');
            } else {
                log('忽略无法识别的一行：' + line);
            }
        }
        return spec;
    }

    /* ======================= 几何 / DOM ======================= */

    // 舞台：幻灯片根元素的父级（若已定位），窗口挂在这里 → 不随正文滚动、可覆盖整页
    function containerOf() {
        var slide = cfg.getSlideEl ? cfg.getSlideEl() : null;
        if (!slide) return null;
        var p = slide.parentNode;
        if (p && p.nodeType === 1 && global.getComputedStyle(p).position !== 'static') return p;
        return slide;
    }

    function containerBox() {
        var c = containerOf();
        return { w: (c && c.clientWidth) || 0, h: (c && c.clientHeight) || 0 };
    }

    // ≤100 视为百分比，>100 视为像素
    function pct(v, base) { return v > 100 ? (v / base) * 100 : v; }

    function resolveState(key, spec, box) {
        var st = {
            x: pct(spec.x, box.w),
            y: pct(spec.y, box.h),
            w: pct(spec.w, box.w),
            h: pct(spec.h, box.h),
            // 未显式写 mask 时用「上次在面板里选的形状」当默认值
            mask: spec.maskSet ? spec.mask : (maskKey(storeGet('defaultMask', '')) || 'rounded'),
            mirror: spec.mirror,
            label: spec.label
        };
        var saved = storeGet('win.' + key, null);
        if (saved && typeof saved === 'object') {
            // 位置 / 尺寸：作者只给初值，用户拖过的结果优先
            ['x', 'y', 'w', 'h'].forEach(function (k) {
                if (typeof saved[k] === 'number' && isFinite(saved[k])) st[k] = saved[k];
            });
            // 遮罩 / 镜像：DSL 里显式写过就听作者的，否则用用户上次的选择
            if (!spec.maskSet && maskKey(saved.mask)) st.mask = maskKey(saved.mask);
            if (!spec.mirrorSet && typeof saved.mirror === 'boolean') st.mirror = saved.mirror;
        }
        if (!MASKS[st.mask]) st.mask = 'rounded';
        return st;
    }

    function applyBox(rec) {
        var box = containerBox();
        if (!box.w || !box.h) return;
        var st = rec.state;
        var def = MASKS[st.mask] || MASKS.rounded;

        // 圆形 / 星形：强制正方形容器，否则遮罩会变形
        if (def.square) {
            var side = Math.max(st.w / 100 * box.w, st.h / 100 * box.h);
            st.w = side / box.w * 100;
            st.h = side / box.h * 100;
        }
        st.w = clamp(st.w, Math.min(100, MIN_W / box.w * 100), 100);
        st.h = clamp(st.h, Math.min(100, MIN_H / box.h * 100), 100);
        st.x = clamp(st.x, 0, 100 - st.w);
        st.y = clamp(st.y, 0, 100 - st.h);

        var s = rec.root.style;
        s.left = r2(st.x) + '%';
        s.top = r2(st.y) + '%';
        s.width = r2(st.w) + '%';
        s.height = r2(st.h) + '%';
    }

    function save(rec) {
        storeSet('win.' + rec.key, {
            x: r2(rec.state.x), y: r2(rec.state.y),
            w: r2(rec.state.w), h: r2(rec.state.h),
            mask: rec.state.mask, mirror: rec.state.mirror
        });
    }

    /* ======================= 摄像头流 ======================= */

    function isLive(s) {
        var t = s && s.getVideoTracks ? s.getVideoTracks() : [];
        return !!(t.length && t[0].readyState === 'live');
    }

    function friendly(e) {
        var n = (e && e.name) || '';
        if (n === 'NotAllowedError' || n === 'SecurityError') {
            return '摄像头权限被拒绝：请在地址栏允许摄像头，然后点「重新连接」。';
        }
        if (n === 'NotFoundError' || n === 'OverconstrainedError') return '没有找到可用的摄像头设备。';
        if (n === 'NotReadableError' || n === 'AbortError') return '摄像头被其他程序占用，无法读取。';
        return '摄像头启动失败：' + ((e && e.message) || n || '未知错误');
    }

    function setAllState(kind, msg) {
        wins.forEach(function (r) {
            r.root.classList.toggle('cam-loading', kind === 'loading');
            r.root.classList.toggle('cam-err', kind === 'error');
            if (msg != null) r.msgEl.textContent = msg;
        });
    }

    function bindAll() {
        if (!stream) return;
        wins.forEach(function (r) {
            if (!r.dead && r.video && r.video.srcObject !== stream) r.video.srcObject = stream;
            if (r.video && r.video.paused) {
                var p = r.video.play();
                if (p && p.catch) p.catch(function () {});
            }
        });
    }

    function startStream(force) {
        if (!force && isLive(stream)) { bindAll(); return Promise.resolve(stream); }
        if (pending && !force) return pending;
        if (!global.navigator || !global.navigator.mediaDevices || !global.navigator.mediaDevices.getUserMedia) {
            setAllState('error', '当前页面无法调用摄像头：请用 https 或 http://localhost 打开（file:// 不支持）。');
            return Promise.reject(new Error('mediadevices unavailable'));
        }

        var nav = global.navigator;
        var video = deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } };

        setAllState('loading', '正在启动摄像头…');

        pending = nav.mediaDevices.getUserMedia({ video: video, audio: false }).then(function (s) {
            pending = null;
            clearTimeout(idleTimer);
            stopStream();
            stream = s;
            var track = s.getVideoTracks()[0];
            if (track) {
                var settings = track.getSettings ? track.getSettings() : {};
                if (settings.deviceId) deviceId = settings.deviceId;
                track.addEventListener('ended', function () {
                    if (stream === s) { stream = null; setAllState('error', '摄像头已断开，点「重新连接」重试。'); }
                });
            }
            bindAll();
            setAllState('ok', '');
            refreshDevices();
            return s;
        }).catch(function (e) {
            pending = null;
            setAllState('error', friendly(e));
            console.warn('[MPSCamera] getUserMedia 失败:', e);
            throw e;
        });
        return pending;
    }

    function stopStream() {
        if (!stream) return;
        stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* 忽略 */ } });
        wins.forEach(function (r) { if (r.video) r.video.srcObject = null; });
        stream = null;
    }

    function scheduleIdleRelease() {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(function () { if (!wins.length) stopStream(); }, IDLE_RELEASE);
    }

    function refreshDevices() {
        var nav = global.navigator;
        if (!nav || !nav.mediaDevices || !nav.mediaDevices.enumerateDevices) return;
        nav.mediaDevices.enumerateDevices().then(function (list) {
            devices = list.filter(function (d) { return d.kind === 'videoinput'; });
            updateDeviceTitles();
        }).catch(function () { /* 忽略 */ });
    }

    function deviceLabel() {
        for (var i = 0; i < devices.length; i++) {
            if (devices[i].deviceId === deviceId) return devices[i].label || ('摄像头 ' + (i + 1));
        }
        return devices.length ? (devices[0].label || '摄像头 1') : '默认摄像头';
    }

    function updateDeviceTitles() {
        wins.forEach(function (r) {
            if (r.devBtn) r.devBtn.title = '切换摄像头（当前：' + deviceLabel() + '，共 ' + (devices.length || 1) + ' 个）';
        });
    }

    // 轮换到下一个摄像头；返回提示文字
    function cycleDevice() {
        if (!devices.length) { refreshDevices(); return '未发现摄像头设备'; }
        if (devices.length < 2) return '只检测到一个摄像头：' + deviceLabel();
        var at = 0;
        for (var i = 0; i < devices.length; i++) { if (devices[i].deviceId === deviceId) at = i; }
        var next = devices[(at + 1) % devices.length];
        deviceId = next.deviceId;
        startStream(true).catch(function () { /* 已在窗口内提示 */ });
        return '已切换到：' + (next.label || ('摄像头 ' + ((at + 1) % devices.length + 1)));
    }

    /* ======================= 交互 ======================= */

    // 拖拽：dir 为空 = 整体移动，否则按方位缩放
    function startDrag(rec, ev, dir) {
        if (ev.button !== undefined && ev.button !== 0) return;
        if (ev.target && ev.target.closest && ev.target.closest('button')) return;

        ev.preventDefault();
        ev.stopPropagation();

        var box = containerBox();
        if (!box.w || !box.h) return;
        var st = rec.state;
        var s = { cx: ev.clientX, cy: ev.clientY, x: st.x, y: st.y, w: st.w, h: st.h };
        var moved = false;

        rec.root.classList.add('cam-drag');

        function onMove(e2) {
            if (Math.abs(e2.clientX - s.cx) > 2 || Math.abs(e2.clientY - s.cy) > 2) moved = true;
            var dx = (e2.clientX - s.cx) / box.w * 100;
            var dy = (e2.clientY - s.cy) / box.h * 100;

            if (!dir) {
                st.x = s.x + dx;
                st.y = s.y + dy;
            } else {
                var x = s.x, y = s.y, w = s.w, h = s.h;
                if (dir.indexOf('e') >= 0) w = s.w + dx;
                if (dir.indexOf('w') >= 0) { w = s.w - dx; x = s.x + dx; }
                if (dir.indexOf('s') >= 0) h = s.h + dy;
                if (dir.indexOf('n') >= 0) { h = s.h - dy; y = s.y + dy; }
                var def = MASKS[st.mask];
                if (def && def.square) {
                    var side = Math.max(w / 100 * box.w, h / 100 * box.h);
                    w = side / box.w * 100;
                    h = side / box.h * 100;
                    if (dir.indexOf('w') >= 0) x = s.x + s.w - w;
                    if (dir.indexOf('n') >= 0) y = s.y + s.h - h;
                }
                st.x = x; st.y = y; st.w = w; st.h = h;
            }
            applyBox(rec);
        }

        function onUp() {
            doc.removeEventListener('pointermove', onMove);
            doc.removeEventListener('pointerup', onUp);
            doc.removeEventListener('pointercancel', onUp);
            rec.root.classList.remove('cam-drag');
            if (!moved) {
                // 只是点了一下画面：把工具条固定住（触摸屏 / 无鼠标放映时唯一能点到按钮的途径）
                rec.root.classList.toggle('cam-show');
                return;
            }
            save(rec);
            // 拖拽可能在窗口外结束 → 吞掉随之而来的那次 click，避免舞台误翻页
            var swallow = function (e3) {
                e3.stopPropagation();
                e3.preventDefault();
                doc.removeEventListener('click', swallow, true);
            };
            doc.addEventListener('click', swallow, true);
            setTimeout(function () { doc.removeEventListener('click', swallow, true); }, 400);
        }

        doc.addEventListener('pointermove', onMove);
        doc.addEventListener('pointerup', onUp);
        doc.addEventListener('pointercancel', onUp);
    }

    function applyMask(rec, mask) {
        if (!MASKS[mask]) mask = 'rounded';
        rec.state.mask = mask;
        rec.root.setAttribute('data-mask', mask);
        rec.maskBtn.innerHTML = '<i class="cam-mk" data-m="' + mask + '"></i>';
        rec.maskBtn.title = '遮罩形状：' + MASKS[mask].label;
        var btns = rec.masksEl.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
            btns[i].classList.toggle('on', btns[i].getAttribute('data-m') === mask);
        }
        applyBox(rec);
        save(rec);
    }

    /* ======================= 挂载 / 回收 ======================= */

    function buildRoot() {
        var root = doc.createElement('div');
        root.className = 'cam-win';
        // 舞台的「点哪儿都翻页」守卫看这个属性：窗口内的一切交互都不翻页
        root.setAttribute('data-mps-plugin', 'camera');
        root.setAttribute('data-mps-camera-window', '1');

        var picks = MASK_ORDER.map(function (k) {
            return '<button type="button" data-m="' + k + '" title="' + MASKS[k].label + '">' +
                '<i class="cam-mk" data-m="' + k + '"></i></button>';
        }).join('');

        root.innerHTML =
            '<div class="cam-shadow">' +
            '<div class="cam-frame"><div class="cam-clip">' +
            '<video class="cam-video" playsinline autoplay muted></video>' +
            '<div class="cam-label" hidden></div>' +
            '<div class="cam-state"><span class="cam-msg"></span><button type="button">重新连接</button></div>' +
            '</div></div>' +
            '</div>' +
            '<div class="cam-tools">' +
            '<button type="button" data-act="mask" title="遮罩形状"></button>' +
            '<button type="button" data-act="mirror" title="左右镜像">⇋</button>' +
            '<button type="button" data-act="device" title="切换摄像头">🎥</button>' +
            '</div>' +
            '<div class="cam-masks">' + picks + '</div>' +
            '<div class="cam-h" data-dir="n"></div><div class="cam-h" data-dir="s"></div>' +
            '<div class="cam-h" data-dir="w"></div><div class="cam-h" data-dir="e"></div>' +
            '<div class="cam-h corner" data-dir="nw"></div><div class="cam-h corner" data-dir="ne"></div>' +
            '<div class="cam-h corner" data-dir="sw"></div><div class="cam-h corner" data-dir="se"></div>';
        return root;
    }

    function createWin(key, spec, container) {
        var root = buildRoot();
        var rec = {
            key: key, root: root, anchor: null, dead: 0, state: null,
            shadow: root.querySelector('.cam-shadow'),
            video: root.querySelector('.cam-video'),
            labelEl: root.querySelector('.cam-label'),
            msgEl: root.querySelector('.cam-msg'),
            masksEl: root.querySelector('.cam-masks'),
            maskBtn: root.querySelector('.cam-tools button[data-act="mask"]'),
            mirrorBtn: root.querySelector('.cam-tools button[data-act="mirror"]'),
            devBtn: root.querySelector('.cam-tools button[data-act="device"]')
        };

        rec.state = resolveState(key, spec, containerBox());
        root.setAttribute('data-mask', rec.state.mask);

        if (rec.state.label) {
            rec.labelEl.hidden = false;
            rec.labelEl.textContent = rec.state.label;
        }
        rec.video.muted = true;
        rec.video.classList.toggle('mirror', !!rec.state.mirror);
        rec.mirrorBtn.classList.toggle('on', !!rec.state.mirror);

        // —— 交互绑定（工具条 / 选择面板不在 .cam-shadow 内，不会触发拖拽）——
        rec.shadow.addEventListener('pointerdown', function (e) { startDrag(rec, e, ''); });
        var handles = root.querySelectorAll('.cam-h');
        for (var i = 0; i < handles.length; i++) {
            (function (h) {
                h.addEventListener('pointerdown', function (e) { startDrag(rec, e, h.getAttribute('data-dir')); });
            })(handles[i]);
        }

        rec.maskBtn.addEventListener('click', function () {
            rec.root.classList.toggle('cam-pick');
            this.blur();
        });
        rec.mirrorBtn.addEventListener('click', function () {
            rec.state.mirror = !rec.state.mirror;
            rec.video.classList.toggle('mirror', rec.state.mirror);
            this.classList.toggle('on', rec.state.mirror);
            save(rec);
            this.blur();
        });
        rec.devBtn.addEventListener('click', function () {
            cycleDevice();
            this.blur();
        });
        rec.masksEl.addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('button[data-m]') : null;
            if (!b) return;
            applyMask(rec, b.getAttribute('data-m'));
            storeSet('defaultMask', rec.state.mask);
            rec.root.classList.remove('cam-pick');
        });
        rec.root.querySelector('.cam-state button').addEventListener('click', function () {
            this.blur();
            startStream(true).catch(function () { /* 已在窗口内提示 */ });
        });

        container.appendChild(root);
        wins.push(rec);
        applyMask(rec, rec.state.mask);
        updateDeviceTitles();
        return rec;
    }

    function mount(anchor) {
        if (!anchor || anchor.__camMounted) return;
        var container = containerOf();
        var box = containerBox();
        if (!container || !box.w || !box.h) return;

        var raw = '';
        try { raw = decodeURIComponent(anchor.getAttribute('data-mps-camera') || ''); } catch (e) { raw = ''; }
        var key = hash(raw);

        // 同键窗口若刚脱离文档（翻页重建），直接复用节点 → 画面不闪断
        var rec = null;
        for (var i = 0; i < wins.length; i++) {
            if (wins[i].key === key && !(wins[i].anchor && wins[i].anchor.isConnected)) { rec = wins[i]; break; }
        }

        if (!rec) {
            rec = createWin(key, parseSpec(raw), container);
        } else {
            if (rec.root.parentNode !== container) container.appendChild(rec.root);
            applyBox(rec);
        }

        rec.anchor = anchor;
        rec.dead = 0;
        anchor.__camMounted = 1;

        if (isLive(stream)) bindAll(); else startStream(false).catch(function () { /* 已在窗口内提示 */ });
    }

    function destroy(rec) {
        if (rec.root.parentNode) rec.root.parentNode.removeChild(rec.root);
        if (rec.video) { try { rec.video.srcObject = null; } catch (e) { /* 忽略 */ } }
        var i = wins.indexOf(rec);
        if (i >= 0) wins.splice(i, 1);
        if (!wins.length) scheduleIdleRelease();
    }

    // 回收：锚点已离开文档的窗口先脱离（留出复用宽限期），超期后彻底销毁
    function prune(force) {
        var now = Date.now();
        var waiting = false;
        for (var i = wins.length - 1; i >= 0; i--) {
            var rec = wins[i];
            if (rec.anchor && rec.anchor.isConnected) { rec.dead = 0; continue; }
            if (!rec.dead) {
                rec.dead = now;
                if (rec.root.parentNode) rec.root.parentNode.removeChild(rec.root);
            }
            if (force || now - rec.dead >= DETACH_GRACE) destroy(rec);
            else waiting = true;
        }
        clearTimeout(pruneTimer);
        if (waiting) pruneTimer = setTimeout(function () { prune(false); }, DETACH_GRACE);
    }

    function initIn(el) {
        if (!el || !el.querySelectorAll) return;
        ensureObserver();
        var hosts = el.querySelectorAll('.cam-host[data-mps-camera]');
        for (var i = 0; i < hosts.length; i++) mount(hosts[i]);
        prune(false);
    }

    // 幻灯片被清空 / 换页时不一定会派发事件，用观察者兜底
    function ensureObserver() {
        var slide = cfg.getSlideEl ? cfg.getSlideEl() : null;
        if (!slide || observer || !global.MutationObserver) return;
        observer = new global.MutationObserver(function () { prune(false); });
        observer.observe(slide, { childList: true });
    }

    function bindDoc() {
        if (docBound) return;
        docBound = true;
        doc.addEventListener('pointerdown', function (e) {
            wins.forEach(function (r) {
                if (r.root.contains(e.target)) return;
                r.root.classList.remove('cam-pick', 'cam-show');
            });
        }, true);
    }

    /* ======================= 对外 API ======================= */

    function applyMaskAll(mask) {
        if (!MASKS[mask]) return 0;
        storeSet('defaultMask', mask);
        var n = 0;
        wins.forEach(function (r) {
            applyMask(r, mask);
            if (!r.dead) n++;
        });
        return n;
    }

    global.MPSCamera = {
        MASKS: MASKS,
        MASK_ORDER: MASK_ORDER,
        CSS: BASE_CSS + maskRules(),

        configure: function (o) {
            o = o || {};
            if (o.store) cfg.store = o.store;
            if (o.getSlideEl) cfg.getSlideEl = o.getSlideEl;
            if (o.log) cfg.log = o.log;
            bindDoc();
        },

        initIn: initIn,
        prune: function () { prune(true); },

        // presenter 侧使用：当前页所有窗口换遮罩 / 重连 / 轮换摄像头
        applyMask: applyMaskAll,
        restart: function () { return startStream(true); },
        cycleDevice: cycleDevice,
        deviceCount: function () { return devices.length; },
        deviceLabel: deviceLabel,

        shutdown: function () {
            if (observer) { observer.disconnect(); observer = null; }
            clearTimeout(pruneTimer);
            clearTimeout(idleTimer);
            wins.slice().forEach(destroy);
            wins = [];
            stopStream();
            pending = null;
            devices = [];
            log('摄像头窗口已全部销毁');
        }
    };
})(window);