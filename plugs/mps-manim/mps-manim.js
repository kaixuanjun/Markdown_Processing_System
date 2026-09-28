/*!
 * MPS Mini-Manim v1.0
 * 浏览器端的轻量数学动画引擎（manim 理念的极简实现）。
 *
 * Markdown 用法：
 *   ```manim
 *   axes -4 4 -2 3
 *   text t1 "正弦函数" at 0 2.6
 *   plot f "sin(x)" -4 4 color=#58a6ff
 *   play write t1 run=1
 *   play create f run=1.5
 *   wait 0.4
 *   play indicate f
 *   ```
 *
 * 指令：
 *   size 16:9 | 4:3 | auto      画幅
 *   bg <color>                  背景色（默认透明）
 *   fg <color>                  默认前景色
 *   axes xmin xmax ymin ymax    显示坐标轴并以此为准设定视野
 *   grid                        显示网格（配合 axes）
 *   speed <倍率>                全局速度倍率
 *   loop                        循环播放
 *   text  <名> "内容"   at x y [color=] [size=]
 *   math  <名> "LaTeX" at x y [color=] [size=]
 *   dot   <名> at x y [color=] [r=]
 *   line  <名> x1 y1 x2 y2 [color=]
 *   arrow <名> x1 y1 x2 y2 [color=]
 *   circle<名> cx cy r [color=] [fill=]
 *   rect  <名> x y w h [color=] [fill=]
 *   polygon <名> x1 y1 x2 y2 ... [color=] [fill=]
 *   plot  <名> "f(x)" xmin xmax [color=]
 *   param <名> "x(t)" "y(t)" tmin tmax [color=]
 *   play create|write|fadein|fadeout|show|hide|indicate <名> [run=]
 *   play transform <名> -> <目标名> [run=]
 *   play MoveAlongPath <名> <路径名> [lo hi] [run=] [rate=linear|smooth]
 *     对应 manim 官方 MoveAlongPath(mobject, path, run_time, rate_func)
 *     rate_func 默认 linear（沿曲线匀速），可指定 smooth（缓入缓出）
 *     路径区间：plot 按 x 范围，param 按 t 范围，其他类型按 0~1 比例；省略则走完整路径
 *   play move <名> x y [run=]     相对位移
 *   play shift <名> dx dy [run=]
 *   play rotate <名> 角度 [run=]
 *   play scale <名> 倍率 [run=]
 *   wait <秒>
 *   clear [run=]
 */
(function (global) {
    'use strict';
    if (global.MPSManim) return;

    const READY_ATTR = 'data-mps-ready';

    /* =========================================================
       0. 样式注入
       ========================================================= */
    const CSS = [
        '.mps-manim{position:relative;margin:.85em auto;border-radius:10px;overflow:hidden;',
        'border:1px solid var(--border-light,#e1e4e8);background:transparent;max-width:100%;}',
        '.mps-manim .mm-stage{position:relative;width:100%;overflow:hidden;}',
        '.mps-manim .mm-canvas{display:block;width:100%;height:100%;}',
        '.mps-manim .mm-layer{position:absolute;inset:0;pointer-events:none;}',
        '.mps-manim .mm-txt{position:absolute;left:0;top:0;white-space:nowrap;display:block;',
        'transform:translate(-50%,-50%);transform-origin:50% 50%;line-height:1;}',
        '.mps-manim .mm-bar{display:flex;align-items:center;gap:8px;padding:6px 9px;',
        'background:var(--code-bg,#f6f8fa);border-top:1px solid var(--border-light,#e1e4e8);',
        'font-size:12px;color:var(--text-secondary,#57606a);}',
        '.mps-manim .mm-btn{border:1px solid var(--border-color,#d0d7de);background:var(--bg-panel,#fff);',
        'color:inherit;border-radius:6px;min-width:28px;height:24px;padding:0 7px;cursor:pointer;',
        'font-size:12px;line-height:1;display:inline-flex;align-items:center;justify-content:center;',
        'font-family:inherit;transition:background .15s,border-color .15s;}',
        '.mps-manim .mm-btn:hover{background:var(--hover-bg,#f3f4f6);border-color:var(--text-muted,#8b949e);}',
        '.mps-manim .mm-track{flex:1;height:4px;min-width:40px;border-radius:2px;overflow:hidden;',
        'background:var(--border-light,#e1e4e8);cursor:pointer;}',
        '.mps-manim .mm-fill{height:100%;width:0%;border-radius:2px;background:var(--accent,#0969da);}',
        '.mps-manim .mm-time{font-variant-numeric:tabular-nums;white-space:nowrap;opacity:.85;font-size:11px;}',
        '.mps-manim .mm-tag{font-size:10px;letter-spacing:.5px;text-transform:uppercase;opacity:.6;',
        'border:1px solid currentColor;border-radius:20px;padding:1px 7px;white-space:nowrap;}',
        '.mps-manim.is-off{background:var(--code-bg,#f6f8fa);}',
        '.mps-manim .mm-off-head{padding:6px 10px;font-size:12px;color:var(--text-muted,#8b949e);',
        'border-bottom:1px dashed var(--border-light,#e1e4e8);}',
        '.mps-manim .mm-off-pre{margin:0;padding:.7em .9em;background:none;border:none;',
        'font-family:Consolas,Menlo,monospace;font-size:.82em;line-height:1.6;overflow-x:auto;',
        'color:var(--text-secondary,#57606a);white-space:pre;}'
    ].join('');

    function injectCss() {
        if (document.getElementById('mps-manim-css')) return;
        const s = document.createElement('style');
        s.id = 'mps-manim-css';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    /* =========================================================
       1. 表达式求值（递归下降，支持隐式乘法）
       ========================================================= */
    const FUNCS = {
        sin: Math.sin, cos: Math.cos, tan: Math.tan,
        asin: Math.asin, acos: Math.acos, atan: Math.atan,
        sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
        exp: Math.exp, ln: Math.log, log: Math.log, log10: Math.log10, log2: Math.log2,
        sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
        floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
        min: Math.min, max: Math.max, pow: Math.pow, atan2: Math.atan2,
        hypot: Math.hypot
    };
    const CONSTS = { pi: Math.PI, PI: Math.PI, tau: Math.PI * 2, e: Math.E };

    function tokenizeExpr(src) {
        const re = /\s*([A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+|[+\-*/^%(),])/g;
        const out = [];
        let m;
        while ((m = re.exec(src))) out.push(m[1]);
        return out;
    }

    function compileExpr(src) {
        const toks = tokenizeExpr(src);
        let i = 0;
        const peek = () => toks[i];
        const next = () => toks[i++];
        const isAtomStart = (t) => t !== undefined && (t === '(' || /^[0-9.]/.test(t) || /^[A-Za-z_]/.test(t));

        function parseExpr() {
            let fn = parseTerm();
            for (;;) {
                const t = peek();
                if (t === '+') { next(); const r = parseTerm(), l = fn; fn = (s) => l(s) + r(s); }
                else if (t === '-') { next(); const r = parseTerm(), l = fn; fn = (s) => l(s) - r(s); }
                else break;
            }
            return fn;
        }
        function parseTerm() {
            let fn = parseUnary();
            for (;;) {
                const t = peek();
                if (t === '*') { next(); const r = parseUnary(), l = fn; fn = (s) => l(s) * r(s); }
                else if (t === '/') { next(); const r = parseUnary(), l = fn; fn = (s) => l(s) / r(s); }
                else if (t === '%') { next(); const r = parseUnary(), l = fn; fn = (s) => l(s) % r(s); }
                else if (isAtomStart(t)) { const r = parseUnary(), l = fn; fn = (s) => l(s) * r(s); }
                else break;
            }
            return fn;
        }
        function parseUnary() {
            const t = peek();
            if (t === '-') { next(); const f = parseUnary(); return (s) => -f(s); }
            if (t === '+') { next(); return parseUnary(); }
            return parsePower();
        }
        function parsePower() {
            const base = parseAtom();
            if (peek() === '^') { next(); const ex = parseUnary(); return (s) => Math.pow(base(s), ex(s)); }
            return base;
        }
        function parseAtom() {
            const t = next();
            if (t === undefined) throw new Error('表达式不完整');
            if (t === '(') { const f = parseExpr(); if (next() !== ')') throw new Error('缺少 )'); return f; }
            if (/^[0-9.]/.test(t)) { const n = parseFloat(t); return () => n; }
            if (/^[A-Za-z_]/.test(t)) {
                const name = t;
                if (peek() === '(') {
                    next();
                    const args = [];
                    if (peek() !== ')') {
                        args.push(parseExpr());
                        while (peek() === ',') { next(); args.push(parseExpr()); }
                    }
                    if (next() !== ')') throw new Error('缺少 )');
                    const f = FUNCS[name];
                    if (!f) throw new Error('未知函数 ' + name);
                    return (s) => f.apply(null, args.map((a) => a(s)));
                }
                if (CONSTS[name] !== undefined) { const c = CONSTS[name]; return () => c; }
                return (s) => (s && s[name] !== undefined ? s[name] : NaN);
            }
            throw new Error('无法解析: ' + t);
        }

        const fn = parseExpr();
        if (i < toks.length) throw new Error('多余内容: ' + toks[i]);
        return (scope) => {
            const v = fn(scope || {});
            return isFinite(v) ? v : NaN;
        };
    }

    /* =========================================================
       2. 行内词法
       ========================================================= */
    function tokenizeLine(line) {
        const out = [];
        let i = 0;
        const n = line.length;
        while (i < n) {
            const c = line[i];
            if (c === ' ' || c === '\t') { i++; continue; }
            if (c === '"' || c === "'") {
                const q = c; i++;
                let s = '';
                while (i < n && line[i] !== q) {
                    if (line[i] === '\\' && i + 1 < n) { s += line[i] + line[i + 1]; i += 2; }
                    else { s += line[i]; i++; }
                }
                i++;
                out.push({ v: s, q: true });
                continue;
            }
            if (c === '-') {
                const nx = line[i + 1] || '';
                if (nx === '>') { out.push({ v: '->', q: false }); i += 2; continue; }
                if (/[0-9.]/.test(nx)) {
                    let s = '-'; i++;
                    while (i < n && /[0-9.eE+\-]/.test(line[i])) { s += line[i]; i++; }
                    out.push({ v: s, q: false });
                    continue;
                }
                out.push({ v: '-', q: false }); i++;
                continue;
            }
            let s = '';
            while (i < n && !/\s/.test(line[i])) { s += line[i]; i++; }
            out.push({ v: s, q: false });
        }
        return out;
    }

    function optsOf(tokens) {
        const o = {};
        tokens.forEach((t) => {
            if (t.q) return;
            const k = t.v.indexOf('=');
            if (k > 0) o[t.v.slice(0, k).toLowerCase()] = t.v.slice(k + 1);
        });
        return o;
    }

    function numbersOf(tokens) {
        const out = [];
        tokens.forEach((t) => {
            if (t.q) return;
            if (t.v.indexOf('=') > 0) return;
            if (!/^[-+]?[\d.]/.test(t.v)) return;
            const f = parseFloat(t.v);
            if (!isNaN(f)) out.push(f);
        });
        return out;
    }

    function quotedOf(tokens) {
        const out = [];
        tokens.forEach((t) => { if (t.q) out.push(t.v); });
        return out;
    }

    /* =========================================================
       3. 几何工具
       ========================================================= */
    function centroidOf(pts) {
        if (!pts.length) return [0, 0];
        let x = 0, y = 0;
        for (let i = 0; i < pts.length; i++) { x += pts[i][0]; y += pts[i][1]; }
        return [x / pts.length, y / pts.length];
    }

    function circlePoints(cx, cy, r, n) {
        const pts = [];
        n = n || 96;
        for (let i = 0; i <= n; i++) {
            const a = (i / n) * Math.PI * 2;
            pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        return pts;
    }

    function resample(pts, n) {
        if (!pts || pts.length < 2) return pts && pts.length ? [pts[0].slice(), pts[0].slice()] : [];
        const d = [0];
        let total = 0;
        for (let i = 1; i < pts.length; i++) {
            total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
            d.push(total);
        }
        if (total === 0) {
            const out = [];
            for (let i = 0; i < n; i++) out.push(pts[0].slice());
            return out;
        }
        const out = [];
        let j = 0;
        for (let i = 0; i < n; i++) {
            const target = (total * i) / (n - 1);
            while (j < d.length - 2 && d[j + 1] < target) j++;
            const len = d[j + 1] - d[j];
            const f = len > 0 ? (target - d[j]) / len : 0;
            out.push([
                pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f,
                pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f
            ]);
        }
        return out;
    }

    /* =========================================================
       4. 场景解析
       ========================================================= */
    function parseSize(tok) {
        if (!tok) return null;
        const v = String(tok).toLowerCase();
        if (v === 'auto') return 'auto';
        const m = v.match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/);
        if (m) return parseFloat(m[1]) / parseFloat(m[2]);
        const f = parseFloat(v);
        return isFinite(f) && f > 0 ? f : null;
    }

    const ANIM_DEFAULT_RUN = {
        create: 1.2, write: 1.2, fadein: 0.8, fadeout: 0.8,
        show: 0, hide: 0, indicate: 0.8, transform: 1.5,
        move: 1, shift: 1, rotate: 1, scale: 1, movealongpath: 1.5
    };

    function parseScene(src) {
        const scene = {
            aspect: 16 / 9, aspectAuto: false, bg: null, fg: '#58a6ff',
            axes: null, grid: false, speed: 1, loop: false,
            objs: [], map: {}, raw: [], total: 0
        };
        const raw = scene.raw;
        let t = 0;
        const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');

        for (let li = 0; li < lines.length; li++) {
            const line = lines[li].trim();
            if (!line || line.charAt(0) === '#') continue;
            let tk;
            try { tk = tokenizeLine(line); } catch (e) { continue; }
            if (!tk.length) continue;
            const head = tk[0].v.toLowerCase();
            const cmp = (s) => s.toLowerCase() === head;

            if (cmp('size')) { const a = parseSize(tk[1] && tk[1].v); if (a === 'auto') scene.aspectAuto = true; else if (a) scene.aspect = a; continue; }
            if (cmp('bg')) { scene.bg = tk[1] ? tk[1].v : null; continue; }
            if (cmp('fg')) { if (tk[1]) scene.fg = tk[1].v; continue; }
            if (cmp('axes')) { const n = numbersOf(tk.slice(1)); if (n.length >= 4) scene.axes = [n[0], n[1], n[2], n[3]]; continue; }
            if (cmp('grid')) { scene.grid = true; continue; }
            if (cmp('speed')) { const s = parseFloat(tk[1] && tk[1].v); if (s > 0) scene.speed = s; continue; }
            if (cmp('loop')) { scene.loop = true; continue; }
            if (cmp('wait')) { t += Math.max(0, parseFloat(tk[1] && tk[1].v) || 0); continue; }

            if (cmp('clear')) {
                const o = optsOf(tk.slice(1));
                raw.push({ kind: 'clear', t0: t, dur: o.run != null ? parseFloat(o.run) : 0.6 });
                t += raw[raw.length - 1].dur;
                continue;
            }
            if (cmp('play')) {
                try { t = parsePlay(tk, raw, t); }
                catch (e) { console.warn('[manim] 第' + (li + 1) + '行动画解析失败:', e.message); }
                continue;
            }
            try { scene.objs.push(parseObject(tk, li + 1)); }
            catch (e) { console.warn('[manim] 第' + (li + 1) + '行对象解析失败:', e.message); }
        }

        scene.total = t;
        scene.objs.forEach((o) => { scene.map[o.name] = o; });
        return scene;
    }

    function parseObject(tk, lineNo) {
        const type = tk[0].v.toLowerCase();
        const name = tk[1] && !tk[1].q ? tk[1].v : null;
        if (!name) throw new Error('缺少对象名');
        const rest = tk.slice(2);
        const opts = optsOf(rest);
        const quoted = quotedOf(rest);
        const nums = numbersOf(rest);
        const o = {
            name: name, type: type, line: lineNo,
            style: { color: opts.color || null, fill: opts.fill || null },
            size: opts.size ? parseFloat(opts.size) : 1,
            hasPoints: false, isText: false
        };
        if (!(o.size > 0)) o.size = 1;

        const atIdx = rest.findIndex((x) => !x.q && x.v === 'at');
        const at = atIdx >= 0 ? numbersOf(rest.slice(atIdx + 1)) : [];

        switch (type) {
            case 'text':
            case 'math':
                if (!quoted.length) throw new Error('缺少内容');
                o.isText = true;
                o.text = quoted[0];
                o.math = (type === 'math');
                o.pos = [at[0] || 0, at[1] || 0];
                if (opts.align) o.align = opts.align;
                break;
            case 'dot': {
                const p = at.length >= 2 ? at : nums;
                o.shape = { kind: 'dot', x: p[0] || 0, y: p[1] || 0, r: opts.r ? parseFloat(opts.r) : null };
                break;
            }
            case 'line':
            case 'arrow':
                if (nums.length < 4) throw new Error('需要 x1 y1 x2 y2');
                o.shape = { kind: type, x1: nums[0], y1: nums[1], x2: nums[2], y2: nums[3] };
                break;
            case 'circle':
                if (nums.length < 3) throw new Error('需要 cx cy r');
                o.shape = { kind: 'circle', cx: nums[0], cy: nums[1], r: Math.abs(nums[2]) };
                break;
            case 'rect':
                if (nums.length < 4) throw new Error('需要 x y w h');
                o.shape = { kind: 'rect', x: nums[0], y: nums[1], w: nums[2], h: nums[3] };
                break;
            case 'polygon':
                if (nums.length < 6) throw new Error('至少需要 3 个顶点');
                o.shape = { kind: 'polygon', pts: pairs(nums) };
                break;
            case 'plot':
                if (!quoted.length) throw new Error('缺少函数表达式');
                o.shape = {
                    kind: 'plot', expr: compileExpr(quoted[0]),
                    xmin: nums[0] != null ? nums[0] : -5,
                    xmax: nums[1] != null ? nums[1] : 5,
                    samples: opts.samples ? parseInt(opts.samples, 10) : 320
                };
                break;
            case 'param':
                if (quoted.length < 2) throw new Error('需要 "x(t)" "y(t)"');
                o.shape = {
                    kind: 'param', fx: compileExpr(quoted[0]), fy: compileExpr(quoted[1]),
                    tmin: nums[0] != null ? nums[0] : 0,
                    tmax: nums[1] != null ? nums[1] : Math.PI * 2,
                    samples: opts.samples ? parseInt(opts.samples, 10) : 320
                };
                break;
            default:
                throw new Error('未知对象类型 ' + type);
        }
        return o;
    }

    function pairs(nums) {
        const out = [];
        for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
        return out;
    }

    function parsePlay(tk, raw, t) {
        const anim = (tk[1] && tk[1].v || '').toLowerCase();
        const name = tk[2] && !tk[2].q ? tk[2].v : null;
        const rest = tk.slice(3);
        const opts = optsOf(tk.slice(2));
        if (!ANIM_DEFAULT_RUN.hasOwnProperty(anim)) throw new Error('未知动画 ' + anim);
        if (!name) throw new Error('缺少对象名');
        const dur = opts.run != null ? Math.max(0, parseFloat(opts.run)) : ANIM_DEFAULT_RUN[anim];
        const step = { kind: anim, name: name, t0: t, dur: dur };
        const nums = numbersOf(rest);
        if (anim === 'transform') {
            const arrowIdx = rest.findIndex((x) => !x.q && x.v === '->');
            const target = arrowIdx >= 0 && rest[arrowIdx + 1] ? rest[arrowIdx + 1].v : null;
            if (!target) throw new Error('transform 需要 -> 目标对象');
            step.target = target;
        } else if (anim === 'movealongpath') {
            // MoveAlongPath(mobject, path) —— 对应 manim 官方 MoveAlongPath
            //   DSL: play MoveAlongPath <名> <路径名> [lo hi] [run=] [rate=linear|smooth]
            //   rate_func 默认 linear（沿曲线匀速），可指定 smooth（缓入缓出）
            const path = rest[0] && !rest[0].q ? rest[0].v : null;
            if (!path) throw new Error('MoveAlongPath 需要路径对象名');
            step.path = path;
            step.range = nums.length >= 2 ? [nums[0], nums[1]] : null;
            const rateVal = opts.rate != null ? opts.rate : (opts.rate_func != null ? opts.rate_func : null);
            step.rate = rateVal != null ? String(rateVal).toLowerCase() : 'linear';
        } else if (anim === 'move' || anim === 'shift') {
            step.dx = nums[0] || 0; step.dy = nums[1] || 0;
        } else if (anim === 'rotate') {
            step.deg = nums[0] || 0;
        } else if (anim === 'scale') {
            step.factor = nums[0] != null ? nums[0] : 1;
        }
        raw.push(step);
        return t + dur;
    }

    /* =========================================================
       5. 播放器
       ========================================================= */
    function createPlayer(root, src) {
        const scene = parseScene(src);
        root.classList.add('mps-manim');

        // —— 画布与文本层 ——
        const stage = document.createElement('div');
        stage.className = 'mm-stage';
        const canvas = document.createElement('canvas');
        canvas.className = 'mm-canvas';
        const layer = document.createElement('div');
        layer.className = 'mm-layer';
        stage.appendChild(canvas);
        stage.appendChild(layer);

        const bar = document.createElement('div');
        bar.className = 'mm-bar';
        const replayBtn = document.createElement('button');
        replayBtn.className = 'mm-btn';
        replayBtn.type = 'button';
        replayBtn.title = '重播';
        replayBtn.textContent = '↺';
        const playBtn = document.createElement('button');
        playBtn.className = 'mm-btn';
        playBtn.type = 'button';
        playBtn.title = '播放 / 暂停';
        playBtn.textContent = '⏸';
        const track = document.createElement('div');
        track.className = 'mm-track';
        const fill = document.createElement('div');
        fill.className = 'mm-fill';
        track.appendChild(fill);
        const time = document.createElement('span');
        time.className = 'mm-time';
        const tag = document.createElement('span');
        tag.className = 'mm-tag';
        tag.textContent = 'manim';
        bar.appendChild(replayBtn);
        bar.appendChild(playBtn);
        bar.appendChild(track);
        bar.appendChild(time);
        bar.appendChild(tag);

        root.innerHTML = '';
        root.appendChild(stage);
        root.appendChild(bar);

        const ctx = canvas.getContext('2d');
        let dpr = 1, W = 0, H = 0, scale = 1;
        let view = { xmin: -6, xmax: 6, ymin: -3.375, ymax: 3.375 };
        const baseLW = () => Math.max(1.6, H / 170);
        const dotPx = () => Math.max(3, H * 0.013);
        const fontPx = (o) => Math.max(9, H * 0.055 * (o.size || 1));

        // —— 编译对象 ——
        scene.objs.forEach((o) => {
            if (o.isText) {
                o.el = document.createElement('span');
                o.el.className = 'mm-txt';
                o.el.style.color = o.style.color || scene.fg;
                o.el.style.display = 'none';
                layer.appendChild(o.el);
                return;
            }
            buildShape(o, H);
        });

        function buildShape(o, h) {
            const s = o.shape;
            let runs = [];
            if (s.kind === 'dot') {
                const r = s.r != null ? s.r : (dotPx() / (scale || 1));
                o.dotFill = true;
                runs = [circlePoints(s.x, s.y, r || 0.08, 48)];
                o.hasPoints = true;
            } else if (s.kind === 'line' || s.kind === 'arrow') {
                runs = [[[s.x1, s.y1], [s.x2, s.y2]]];
                if (s.kind === 'arrow') o.arrow = true;
                o.hasPoints = true;
            } else if (s.kind === 'circle') {
                runs = [circlePoints(s.cx, s.cy, s.r, 96)];
                o.hasPoints = true;
            } else if (s.kind === 'rect') {
                const x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
                runs = [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
                o.hasPoints = true;
            } else if (s.kind === 'polygon') {
                runs = [s.pts.concat([s.pts[0]])];
                o.hasPoints = true;
            } else if (s.kind === 'plot') {
                let cur = [];
                const N = Math.max(40, s.samples || 320);
                for (let i = 0; i <= N; i++) {
                    const x = s.xmin + ((s.xmax - s.xmin) * i) / N;
                    const y = s.expr({ x: x });
                    if (!isFinite(y)) { if (cur.length > 1) runs.push(cur); cur = []; continue; }
                    cur.push([x, y]);
                }
                if (cur.length > 1) runs.push(cur);
                o.hasPoints = true;
            } else if (s.kind === 'param') {
                const N = Math.max(40, s.samples || 320);
                const cur = [];
                for (let i = 0; i <= N; i++) {
                    const tt = s.tmin + ((s.tmax - s.tmin) * i) / N;
                    const x = s.fx({ t: tt }), y = s.fy({ t: tt });
                    if (isFinite(x) && isFinite(y)) cur.push([x, y]);
                }
                if (cur.length > 1) runs.push(cur);
                o.hasPoints = true;
            }
            o.runs = runs;
            o.sample = o.hasPoints ? resample(runs.flat(), 128) : [];
            o.centroid = centroidOf(o.sample);
            if (!o.style.fill) o.style.fill = null;
        }

        // —— 视野计算 ——
        function computeView() {
            let xmin, xmax, ymin, ymax;
            if (scene.axes) {
                xmin = scene.axes[0]; xmax = scene.axes[1]; ymin = scene.axes[2]; ymax = scene.axes[3];
            } else {
                let pts = [];
                scene.objs.forEach((o) => { if (o.hasPoints) pts = pts.concat(o.sample); });
                if (pts.length) {
                    xmin = Math.min.apply(null, pts.map((p) => p[0]));
                    xmax = Math.max.apply(null, pts.map((p) => p[0]));
                    ymin = Math.min.apply(null, pts.map((p) => p[1]));
                    ymax = Math.max.apply(null, pts.map((p) => p[1]));
                } else {
                    xmin = -6; xmax = 6; ymin = -3.375; ymax = 3.375;
                }
                // 预留文字
                const texts = scene.objs.filter((o) => o.isText);
                if (texts.length && W > 0 && H > 0) {
                    const rx = Math.max(1e-6, (xmax - xmin));
                    const ry = Math.max(1e-6, (ymax - ymin));
                    const scX = W / rx, scY = H / ry;
                    texts.forEach((o) => {
                        const w = (o.elW || 60) / scX, h = (o.elH || 24) / scY;
                        xmin = Math.min(xmin, o.pos[0] - w / 2); xmax = Math.max(xmax, o.pos[0] + w / 2);
                        ymin = Math.min(ymin, o.pos[1] - h / 2); ymax = Math.max(ymax, o.pos[1] + h / 2);
                    });
                }
                const padX = Math.max((xmax - xmin) * 0.1, 0.3);
                const padY = Math.max((ymax - ymin) * 0.12, 0.3);
                xmin -= padX; xmax += padX; ymin -= padY; ymax += padY;
            }
            // 对齐画布比例，保证 x/y 等比
            const ar = H > 0 ? W / H : scene.aspect;
            let w = xmax - xmin, h = ymax - ymin;
            if (w / h > ar) { const nh = w / ar; ymin -= (nh - h) / 2; ymax += (nh - h) / 2; }
            else { const nw = h * ar; xmin -= (nw - w) / 2; xmax += (nw - w) / 2; }
            return { xmin: xmin, xmax: xmax, ymin: ymin, ymax: ymax };
        }

        function layout() {
            const cw = Math.max(120, root.clientWidth || 480);
            const ar = scene.aspectAuto ? Math.max(0.5, (H > 0 ? W / H : 16 / 9)) : scene.aspect;
            const ch = Math.max(80, Math.round(cw / ar));
            dpr = Math.min(2, global.devicePixelRatio || 1);
            W = cw; H = ch;
            canvas.style.width = cw + 'px';
            canvas.style.height = ch + 'px';
            canvas.width = Math.round(cw * dpr);
            canvas.height = Math.round(ch * dpr);
            stage.style.height = ch + 'px';

            scene.objs.forEach((o) => {
                if (o.isText) o.el.style.fontSize = fontPx(o) + 'px';
                else if (o.shape && o.shape.kind === 'dot' && o.shape.r == null) {
                    // 点半径随尺寸重算
                    const r = dotPx() / (scale || dotPx());
                    o.runs = [circlePoints(o.shape.x, o.shape.y, r, 48)];
                    o.sample = resample(o.runs.flat(), 128);
                    o.centroid = centroidOf(o.sample);
                }
            });
            // 测量文本尺寸后计算视野
            scene.objs.forEach((o) => {
                if (!o.isText) return;
                o.el.style.display = 'block';
                o.el.style.left = '0px'; o.el.style.top = '0px';
                o.elW = o.el.offsetWidth || 60;
                o.elH = o.el.offsetHeight || 24;
                o.el.style.display = 'none';
            });
            view = computeView();
            scale = W / (view.xmax - view.xmin);
            // 点的半径依赖 scale，重算一次
            scene.objs.forEach((o) => {
                if (!o.isText && o.shape && o.shape.kind === 'dot' && o.shape.r == null) {
                    const r = dotPx() / (scale || 1);
                    o.runs = [circlePoints(o.shape.x, o.shape.y, r, 48)];
                    o.sample = resample(o.runs.flat(), 128);
                    o.centroid = centroidOf(o.sample);
                }
            });
        }

        /* ---- 时间轴编译 ---- */
        const rt = new Map();
        function resetStates() {
            scene.objs.forEach((o) => {
                const st = rt.get(o);
                st.points = (o.sample || []).map((p) => p.slice());
                st.offset = [0, 0];
                st.rot = 0;
                st.scale = 1;
                st.opacity = 1;
                st.progress = 1;
                st.color = o.style.color || scene.fg;
                st.fill = o.style.fill || null;
                st.text = o.text;
                st.visible = !!scene.revealAll;
            });
        }
        scene.revealAll = false;
        scene.objs.forEach((o) => rt.set(o, {}));

        const segs = [];
        scene.raw.forEach((step) => {
            if (step.kind === 'clear') {
                const targets = scene.objs.slice();
                segs.push({
                    t0: step.t0, dur: step.dur, apply: (p) => {
                        targets.forEach((o) => {
                            const st = rt.get(o);
                            if (st.visible) { st.opacity = 1 - p; if (p >= 1) { st.visible = false; st.opacity = 1; } }
                        });
                    }
                });
                return;
            }
            const o = scene.map[step.name];
            if (!o) { console.warn('[manim] 未找到对象 ' + step.name); return; }
            const st = rt.get(o);
            const A = step.kind;
            if (A === 'show' || A === 'hide') {
                segs.push({ t0: step.t0, dur: 0, apply: (p) => { st.visible = (A === 'show'); st.opacity = 1; } });
                return;
            }
            if (A === 'transform') {
                const tb = scene.map[step.target];
                if (!tb) { console.warn('[manim] transform 目标不存在: ' + step.target); return; }
                const tst = rt.get(tb);
                const vs = o.sample, vt = tb.sample;
                segs.push({
                    t0: step.t0, dur: step.dur, apply: (p) => {
                        if (vs.length && vt.length) {
                            st.points = vs.map((q, i) => {
                                const r = vt[i % vt.length];
                                return [q[0] + (r[0] - q[0]) * p, q[1] + (r[1] - q[1]) * p];
                            });
                            st.color = mixColor(o.style.color || scene.fg, tb.style.color || scene.fg, p);
                            st.visible = true; st.opacity = 1;
                            tst.visible = false;
                        } else if (o.isText && tb.isText) {
                            st.offset = [(tb.pos[0] - o.pos[0]) * p, (tb.pos[1] - o.pos[1]) * p];
                            st.text = p < 0.5 ? o.text : tb.text;
                            st.visible = true; st.opacity = 1;
                            tst.visible = false;
                        } else {
                            st.opacity = Math.max(0, 1 - p * 2);
                            st.visible = p < 0.5 && st.opacity > 0;
                            tst.opacity = Math.max(0, p * 2 - 1);
                            tst.visible = p >= 0.5 && tst.opacity > 0;
                        }
                    }
                });
                return;
            }
            if (A === 'movealongpath') {
                const pb = scene.map[step.path];
                if (!pb) { console.warn('[manim] MoveAlongPath 路径不存在: ' + step.path); return; }
                let raw2 = (pb.runs && pb.runs.length) ? pb.runs.flat() : (pb.sample || []).slice();
                if (step.range && pb.shape && raw2.length > 1) {
                    const lo = Math.min(step.range[0], step.range[1]);
                    const hi = Math.max(step.range[0], step.range[1]);
                    const k = pb.shape.kind;
                    let sub = null;
                    if (k === 'plot') {
                        sub = raw2.filter((q) => q[0] >= lo - 1e-6 && q[0] <= hi + 1e-6);
                    } else if (k === 'param') {
                        const t0 = pb.shape.tmin, t1 = pb.shape.tmax, n = raw2.length;
                        sub = raw2.filter((q, i) => {
                            const tt = t0 + (t1 - t0) * (i / Math.max(1, n - 1));
                            return tt >= lo - 1e-6 && tt <= hi + 1e-6;
                        });
                    } else {
                        const n = raw2.length;
                        const i0 = Math.round(lo * (n - 1)), i1 = Math.round(hi * (n - 1));
                        sub = raw2.slice(Math.max(0, i0), Math.min(n, i1 + 1));
                    }
                    if (sub && sub.length > 1) raw2 = sub;
                }
                const path = resample(raw2, 200);
                if (path.length < 2) { console.warn('[manim] MoveAlongPath 路径点不足: ' + step.path); return; }
                const lastIdx = path.length - 1;
                const rf = step.rate || 'linear';
                segs.push({
                    t0: step.t0, dur: step.dur, apply: (p) => {
                        const ep = rf === 'smooth' ? p * p * (3 - 2 * p) : p;
                        const idx = Math.max(0, Math.min(lastIdx, ep * lastIdx));
                        const i0 = Math.floor(idx), i1 = Math.min(lastIdx, i0 + 1);
                        const f = idx - i0;
                        const x = path[i0][0] + (path[i1][0] - path[i0][0]) * f;
                        const y = path[i0][1] + (path[i1][1] - path[i0][1]) * f;
                        st.offset = [x - o.centroid[0], y - o.centroid[1]];
                        st.visible = true; st.opacity = 1;
                    }
                });
                return;
            }
            segs.push({
                t0: step.t0, dur: step.dur, apply: (p) => {
                    switch (A) {
                        case 'create':
                        case 'write':
                            st.visible = true;
                            st.progress = p;
                            if (o.isText) { st.opacity = 1; st.progress = p; }
                            else { st.opacity = 1; }
                            break;
                        case 'fadein':
                            st.visible = p > 0; st.opacity = p; break;
                        case 'fadeout':
                            st.visible = true; st.opacity = 1 - p;
                            if (p >= 1) { st.visible = false; st.opacity = 1; }
                            break;
                        case 'indicate':
                            st.visible = true; st.opacity = 1;
                            st.scale = 1 + 0.22 * Math.sin(Math.PI * p);
                            break;
                        case 'move': {
                            const cur = st.offset.slice();
                            st.offset = [cur[0] + step.dx * p, cur[1] + step.dy * p];
                            st.visible = true;
                            break;
                        }
                        case 'shift': {
                            const cur2 = st.offset.slice();
                            st.offset = [cur2[0] + step.dx * p, cur2[1] + step.dy * p];
                            st.visible = true;
                            break;
                        }
                        case 'rotate':
                            st.rot = step.deg * p; st.visible = true; break;
                        case 'scale': {
                            const f = 1 + (step.factor - 1) * p;
                            st.scale = f; st.visible = true;
                            break;
                        }
                    }
                }
            });
        });
        segs.sort((a, b) => a.t0 - b.t0 || a.dur - b.dur);
        if (!segs.length) scene.revealAll = true;

        /* ---- 颜色插值 ---- */
        function hex2rgb(c) {
            if (!c) return [88, 166, 255];
            c = String(c).trim();
            if (c.charAt(0) === '#') {
                let h = c.slice(1);
                if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
                const n = parseInt(h, 16);
                return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
            }
            const m = c.match(/rgba?\(([^)]+)\)/);
            if (m) { const a = m[1].split(',').map(Number); return [a[0] || 0, a[1] || 0, a[2] || 0]; }
            return [88, 166, 255];
        }
        function mixColor(a, b, p) {
            const A1 = hex2rgb(a), B1 = hex2rgb(b);
            return 'rgb(' + Math.round(A1[0] + (B1[0] - A1[0]) * p) + ',' +
                Math.round(A1[1] + (B1[1] - A1[1]) * p) + ',' +
                Math.round(A1[2] + (B1[2] - A1[2]) * p) + ')';
        }

        /* ---- 投影 ---- */
        function toPx(p) {
            return [(p[0] - view.xmin) * scale, (view.ymax - p[1]) * scale];
        }
        function xform(o, st, p) {
            const c = o.centroid;
            const a = (st.rot || 0) * Math.PI / 180;
            const s = st.scale || 1;
            const dx = p[0] - c[0], dy = p[1] - c[1];
            const rx = dx * Math.cos(a) - dy * Math.sin(a);
            const ry = dx * Math.sin(a) + dy * Math.cos(a);
            return [c[0] + rx * s + st.offset[0], c[1] + ry * s + st.offset[1]];
        }

        /* ---- 绘制 ---- */
        function strokeProgressive(pts, progress, closed) {
            if (pts.length < 2) return;
            const full = closed ? pts.concat([pts[0]]) : pts;
            const seg = [];
            let L = 0;
            for (let i = 1; i < full.length; i++) {
                const d = Math.hypot(full[i][0] - full[i - 1][0], full[i][1] - full[i - 1][1]);
                seg.push(d); L += d;
            }
            const lim = L * Math.max(0, Math.min(1, progress));
            ctx.beginPath();
            ctx.moveTo(full[0][0], full[0][1]);
            let acc = 0;
            for (let i = 1; i < full.length; i++) {
                if (acc + seg[i - 1] <= lim) {
                    ctx.lineTo(full[i][0], full[i][1]);
                    acc += seg[i - 1];
                } else {
                    const f = seg[i - 1] > 0 ? (lim - acc) / seg[i - 1] : 0;
                    ctx.lineTo(full[i - 1][0] + (full[i][0] - full[i - 1][0]) * f,
                        full[i - 1][1] + (full[i][1] - full[i - 1][1]) * f);
                    break;
                }
            }
            ctx.stroke();
        }

        function drawAxes() {
            const ax = scene.axes;
            if (!ax) return;
            const col = 'rgba(140,148,158,.55)';
            const gridCol = 'rgba(140,148,158,.18)';
            const zero = 'rgba(140,148,158,.75)';
            ctx.save();
            ctx.lineWidth = 1;
            if (scene.grid) {
                ctx.strokeStyle = gridCol;
                for (let x = Math.ceil(ax[0]); x <= ax[1]; x++) {
                    const a = toPx([x, view.ymin]), b = toPx([x, view.ymax]);
                    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
                }
                for (let y = Math.ceil(ax[2]); y <= ax[3]; y++) {
                    const a = toPx([view.xmin, y]), b = toPx([view.xmax, y]);
                    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
                }
            }
            ctx.strokeStyle = zero;
            const ox = Math.min(Math.max(0, view.xmin), view.xmax);
            const oy = Math.min(Math.max(0, view.ymin), view.ymax);
            const A = toPx([view.xmin, oy]), B = toPx([view.xmax, oy]);
            ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
            const C = toPx([ox, view.ymin]), D = toPx([ox, view.ymax]);
            ctx.beginPath(); ctx.moveTo(C[0], C[1]); ctx.lineTo(D[0], D[1]); ctx.stroke();
            ctx.fillStyle = col;
            ctx.font = Math.max(9, H * 0.032) + 'px system-ui,sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            for (let x = Math.ceil(ax[0]); x <= ax[1]; x++) {
                if (x === 0) continue;
                const p = toPx([x, oy]);
                ctx.fillText(String(x), p[0], p[1] + 4);
            }
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            for (let y = Math.ceil(ax[2]); y <= ax[3]; y++) {
                if (y === 0) continue;
                const p = toPx([ox, y]);
                ctx.fillText(String(y), p[0] - 5, p[1]);
            }
            ctx.restore();
        }

        function paint() {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, W, H);
            if (scene.bg) { ctx.fillStyle = scene.bg; ctx.fillRect(0, 0, W, H); }
            drawAxes();
            scene.objs.forEach((o) => {
                const st = rt.get(o);
                if (!o.hasPoints || !st.visible || st.opacity <= 0.001) return;
                ctx.save();
                ctx.globalAlpha = st.opacity;
                const prog = st.progress == null ? 1 : st.progress;
                o.runs.forEach((run) => {
                    const px = run.map((p) => toPx(xform(o, st, p)));
                    if (px.length < 2) return;
                    const closed = (o.shape.kind === 'circle' || o.shape.kind === 'rect' || o.shape.kind === 'polygon' || o.dotFill);
                    if (o.dotFill) {
                        ctx.fillStyle = st.color;
                        ctx.beginPath();
                        ctx.moveTo(px[0][0], px[0][1]);
                        for (let i = 1; i < px.length; i++) ctx.lineTo(px[i][0], px[i][1]);
                        ctx.closePath();
                        ctx.fill();
                        return;
                    }
                    ctx.strokeStyle = st.color;
                    ctx.lineWidth = baseLW();
                    ctx.lineJoin = 'round';
                    ctx.lineCap = 'round';
                    if (st.fill && prog >= 1) {
                        ctx.save();
                        ctx.globalAlpha = st.opacity * 0.85;
                        ctx.fillStyle = st.fill;
                        ctx.beginPath();
                        ctx.moveTo(px[0][0], px[0][1]);
                        for (let i = 1; i < px.length; i++) ctx.lineTo(px[i][0], px[i][1]);
                        ctx.closePath();
                        ctx.fill();
                        ctx.restore();
                    }
                    strokeProgressive(px, prog, closed);
                    if (o.arrow && prog >= 1) {
                        const a = px[px.length - 2], b = px[px.length - 1];
                        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
                        const hl = Math.max(7, H * 0.028);
                        ctx.beginPath();
                        ctx.moveTo(b[0], b[1]);
                        ctx.lineTo(b[0] - hl * Math.cos(ang - 0.4), b[1] - hl * Math.sin(ang - 0.4));
                        ctx.lineTo(b[0] - hl * Math.cos(ang + 0.4), b[1] - hl * Math.sin(ang + 0.4));
                        ctx.closePath();
                        ctx.fillStyle = st.color;
                        ctx.fill();
                    }
                });
                ctx.restore();
            });
        }

        function renderTextContent(o, text) {
            if (o.math && global.katex) {
                try {
                    return global.katex.renderToString(text, { displayMode: false, throwOnError: false });
                } catch (e) { /* fallthrough */ }
            }
            return String(text == null ? '' : text)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        function paintTexts() {
            scene.objs.forEach((o) => {
                if (!o.isText) return;
                const st = rt.get(o);
                const show = st.visible && st.opacity > 0.001;
                o.el.style.display = show ? 'block' : 'none';
                if (!show) return;
                const x = o.pos[0] + st.offset[0];
                const y = o.pos[1] + st.offset[1];
                const p = toPx([x, y]);
                o.el.style.left = p[0].toFixed(2) + 'px';
                o.el.style.top = p[1].toFixed(2) + 'px';
                o.el.style.opacity = st.opacity.toFixed(3);
                o.el.style.transform = 'translate(-50%,-50%) rotate(' + (st.rot || 0) + 'deg) scale(' + (st.scale || 1) + ')';
                const prog = st.progress == null ? 1 : st.progress;
                o.el.style.clipPath = prog >= 1 ? 'none' : 'inset(0 ' + ((1 - prog) * 100).toFixed(1) + '% 0 0)';
                if (o._lastText !== st.text) {
                    o.el.innerHTML = renderTextContent(o, st.text);
                    o._lastText = st.text;
                }
            });
        }

        const total = Math.max(0.001, scene.total);
        const speed = scene.speed > 0 ? scene.speed : 1;
        let t = 0, playing = false, raf = 0, last = 0, seekDrag = false;

        function renderAt(tt) {
            resetStates();
            for (let i = 0; i < segs.length; i++) {
                const s = segs[i];
                if (tt < s.t0) break;
                const p = s.dur > 0 ? Math.min(1, (tt - s.t0) / s.dur) : 1;
                s.apply(p, tt);
            }
            paint();
            paintTexts();
            fill.style.width = ((tt / total) * 100).toFixed(2) + '%';
            time.textContent = tt.toFixed(1) + 's / ' + scene.total.toFixed(1) + 's';
        }

        function stop() { playing = false; playBtn.textContent = '▶'; if (raf) cancelAnimationFrame(raf); raf = 0; }
        function frame(now) {
            if (!root.isConnected) { stop(); return; }
            if (!playing) return;
            const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
            last = now;
            t += dt * speed;
            if (t >= total) {
                if (scene.loop) { t = 0; }
                else { t = total; renderAt(t); stop(); return; }
            }
            renderAt(t);
            raf = requestAnimationFrame(frame);
        }
        function play() {
            if (playing) return;
            if (t >= total - 1e-4) t = 0;
            playing = true; last = 0;
            playBtn.textContent = '⏸';
            raf = requestAnimationFrame(frame);
        }
        function pause() { stop(); }
        function replay() { t = 0; renderAt(0); play(); }

        playBtn.addEventListener('click', (e) => { e.stopPropagation(); playing ? pause() : play(); });
        replayBtn.addEventListener('click', (e) => { e.stopPropagation(); replay(); });
        function seekFromEvent(e) {
            const r = track.getBoundingClientRect();
            const x = Math.min(Math.max((e.clientX != null ? e.clientX : e.touches[0].clientX) - r.left, 0), r.width);
            t = (x / Math.max(1, r.width)) * total;
            renderAt(t);
        }
        track.addEventListener('pointerdown', (e) => {
            e.stopPropagation(); seekDrag = true;
            if (track.setPointerCapture) { try { track.setPointerCapture(e.pointerId); } catch (err) {} }
            seekFromEvent(e);
        });
        track.addEventListener('pointermove', (e) => { if (seekDrag) { e.stopPropagation(); seekFromEvent(e); } });
        track.addEventListener('pointerup', () => { seekDrag = false; });

        // 阻止点击穿透到舞台（避免误翻页）
        ['click', 'pointerdown', 'mousedown', 'dblclick'].forEach((ev) => {
            root.addEventListener(ev, (e) => e.stopPropagation());
        });

        // 布局与重绘
        let ro = null;
        function relayout() {
            layout();
            renderAt(Math.min(t, total));
        }
        if (global.ResizeObserver) {
            ro = new ResizeObserver(() => relayout());
            ro.observe(root);
        } else {
            global.addEventListener('resize', relayout);
        }

        layout();
        renderAt(0);

        const player = {
            play: play, pause: pause, replay: replay, root: root,
            destroy: function () { stop(); if (ro) ro.disconnect(); }
        };
        root.__mpsManim = player;
        // 延迟启动，等布局稳定
        setTimeout(() => { if (root.isConnected) play(); }, 60);
        return player;
    }

    /* =========================================================
       6. 降级渲染
       ========================================================= */
    function renderFallback(node, src, note) {
        node.classList.add('mps-manim', 'is-off');
        node.innerHTML = '';
        const head = document.createElement('div');
        head.className = 'mm-off-head';
        head.textContent = note;
        const pre = document.createElement('pre');
        pre.className = 'mm-off-pre';
        pre.textContent = src;
        node.appendChild(head);
        node.appendChild(pre);
    }

    /* =========================================================
       7. 对外接口
       ========================================================= */
    global.MPSManim = {
        version: '1.0',
        enabled: true,
        initIn: function (root) {
            injectCss();
            if (!root || !root.querySelectorAll) return;
            const nodes = root.querySelectorAll('.manim-scene');
            Array.prototype.forEach.call(nodes, function (node) {
                if (node.getAttribute(READY_ATTR)) return;
                node.setAttribute(READY_ATTR, '1');
                const src = decodeURIComponent(node.getAttribute('data-mps-manim') || '');
                if (!global.MPSManim.enabled) {
                    renderFallback(node, src, '🧩 Manim 动画 · 插件未启用');
                    return;
                }
                try { createPlayer(node, src); }
                catch (e) {
                    console.warn('[manim] 场景构建失败:', e);
                    renderFallback(node, src, '🧩 Manim 动画 · 场景有误：' + e.message);
                }
            });
        },
        replayIn: function (root) {
            if (!root || !root.querySelectorAll) return 0;
            const nodes = root.querySelectorAll('.manim-scene');
            let n = 0;
            Array.prototype.forEach.call(nodes, function (node) {
                if (node.__mpsManim) { node.__mpsManim.replay(); n++; }
            });
            return n;
        },
        countIn: function (root) {
            if (!root || !root.querySelectorAll) return 0;
            let n = 0;
            const nodes = root.querySelectorAll('.manim-scene');
            Array.prototype.forEach.call(nodes, function (node) { if (node.__mpsManim) n++; });
            return n;
        },
        setEnabled: function (v) { this.enabled = !!v; }
    };
})(typeof window !== 'undefined' ? window : this);
