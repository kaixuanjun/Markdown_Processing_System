/*!
 * MPS 互动模拟 v1.0（id: mps-sim）· 运行时
 * -----------------------------------------------------------------------------
 * ```sim 代码块 → 可实时调节的动态模拟卡：
 *   - 内置模型库（弹簧振子 / 单摆 / 抛体 / SIR / 种群 / 捕食 / 洛伦兹 / 电容 / 波）
 *     与自定义方程（state / d 行）
 *   - 参数滑块实时生效；开始 / 暂停 / 重置；时间倍率；
 *   - 投影读数（画面上的大字 HUD）、快照条（手动 + 按模拟时间自动）、导出 PNG / JSON
 * ```sim-link 代码块 → 「链接序列」规则条：
 *   - next 目标页 / after 秒 或 done 自动前进 / inherit 首次访问目标页时继承参数
 *
 * 设计参考 Nano Interactive Slides（NIS）的模拟控制 / 链接序列两段式交互，
 * 针对 MPS「幻灯片即 HTML」的场景重写：模拟直接跑在页面上，控制面板与画面同页。
 * 纯静态、无外部依赖；engine / presenter / 打包产物（file://）通用。
 * ========================================================================== */
(function (global) {
    'use strict';
    if (global.MPSSim) return;

    const READY = 'data-mps-ready';
    const PAGE_OFF = 0.02;      // 历史采样间隔（模拟秒）
    const TRAIL_DT = 0.03;      // 轨迹采样间隔（模拟秒）
    const HIST_MAX = 6000;      // 历史样本上限（超出折半抽稀）
    const TRAIL_MAX = 4000;     // 轨迹点上限（超出折半抽稀）

    /* =========================================================
       0. 样式
       ========================================================= */
    const CSS = [
        '.mps-sim{position:relative;margin:.85em auto;border:1px solid var(--border-light,#e1e4e8);',
        'border-radius:12px;overflow:hidden;background:var(--bg-panel,#fff);max-width:100%;}',
        '.mps-sim .sim-head{display:flex;align-items:center;gap:8px;padding:7px 11px;',
        'border-bottom:1px solid var(--border-light,#e1e4e8);background:var(--code-bg,#f6f8fa);}',
        '.mps-sim .sim-title{font-weight:600;color:var(--text-primary,#1f2328);}',
        '.mps-sim .sim-badge{font-size:11px;color:var(--text-muted,#8b949e);border:1px solid currentColor;',
        'border-radius:20px;padding:1px 8px;white-space:nowrap;}',
        '.mps-sim .sim-note{font-size:11px;color:var(--accent,#0969da);opacity:0;transition:opacity .25s;}',
        '.mps-sim .sim-note.on{opacity:1;}',
        '.mps-sim .sim-warn{font-size:12px;color:#d29922;cursor:help;}',
        '.mps-sim .sim-clock{margin-left:auto;font-variant-numeric:tabular-nums;',
        'color:var(--text-secondary,#57606a);font-size:12px;white-space:nowrap;}',
        '.mps-sim .sim-stage{position:relative;width:100%;background:var(--code-bg,#f6f8fa);}',
        '.mps-sim .sim-canvas{display:block;width:100%;height:100%;touch-action:none;}',
        '.mps-sim .sim-hud{position:absolute;left:8px;top:8px;display:flex;flex-wrap:wrap;gap:6px;',
        'max-width:72%;pointer-events:none;}',
        '.mps-sim .sim-chip{display:inline-flex;align-items:baseline;gap:5px;padding:2px 8px;border-radius:8px;',
        'background:rgba(127,127,127,.16);border:1px solid var(--border-light,#e1e4e8);',
        'font-variant-numeric:tabular-nums;backdrop-filter:blur(3px);}',
        '.mps-sim .sim-chip b{font-weight:600;color:var(--text-muted,#8b949e);font-size:11px;}',
        '.mps-sim .sim-chip i{font-style:normal;font-size:15px;color:var(--text-primary,#1f2328);}',
        '.mps-sim.is-clean .sim-hud{display:none;}',
        '.mps-sim .sim-bar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:6px 9px;',
        'border-top:1px solid var(--border-light,#e1e4e8);background:var(--code-bg,#f6f8fa);}',
        '.mps-sim .sim-btn{border:1px solid var(--border-color,#d0d7de);background:var(--bg-panel,#fff);',
        'color:inherit;border-radius:6px;height:26px;padding:0 9px;cursor:pointer;font-size:12px;',
        'line-height:1;display:inline-flex;align-items:center;gap:4px;font-family:inherit;',
        'transition:background .15s,border-color .15s;}',
        '.mps-sim .sim-btn:hover{background:var(--hover-bg,#f3f4f6);border-color:var(--text-muted,#8b949e);}',
        '.mps-sim .sim-btn.on{background:var(--accent,#0969da);border-color:var(--accent,#0969da);color:#fff;}',
        '.mps-sim .sim-btn[disabled]{opacity:.45;cursor:not-allowed;}',
        '.mps-sim .sim-ctl{display:inline-flex;align-items:center;gap:5px;font-size:11px;',
        'color:var(--text-secondary,#57606a);white-space:nowrap;}',
        '.mps-sim .sim-ctl input[type=range]{width:96px;accent-color:var(--accent,#0969da);height:16px;}',
        '.mps-sim .sim-ctl b{font-variant-numeric:tabular-nums;font-weight:600;min-width:34px;text-align:right;}',
        '.mps-sim .sim-sp{flex:1;}',
        '.mps-sim .sim-params{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));',
        'gap:4px 16px;padding:7px 11px 9px;border-top:1px solid var(--border-light,#e1e4e8);}',
        '.mps-sim .sim-param{display:flex;align-items:center;gap:7px;font-size:12px;',
        'color:var(--text-secondary,#57606a);}',
        '.mps-sim .sim-param span{flex:0 0 auto;max-width:46%;overflow:hidden;text-overflow:ellipsis;',
        'white-space:nowrap;}',
        '.mps-sim .sim-param input[type=range]{flex:1;min-width:60px;accent-color:var(--accent,#0969da);height:16px;}',
        '.mps-sim .sim-param b{font-variant-numeric:tabular-nums;font-weight:600;min-width:44px;',
        'text-align:right;color:var(--text-primary,#1f2328);}',
        '.mps-sim .sim-shots{display:flex;align-items:center;gap:8px;padding:0 11px;',
        'max-height:0;overflow-x:auto;overflow-y:hidden;transition:max-height .25s,padding .25s;}',
        '.mps-sim .sim-shots.has{padding:8px 11px;max-height:120px;}',
        '.mps-sim .sim-shot{position:relative;flex:0 0 auto;border:1px solid var(--border-color,#d0d7de);',
        'border-radius:7px;overflow:hidden;cursor:zoom-in;background:var(--bg-panel,#fff);line-height:0;}',
        '.mps-sim .sim-shot img{display:block;width:118px;height:auto;}',
        '.mps-sim .sim-shot span{position:absolute;left:0;right:0;bottom:0;font-size:10px;line-height:1.5;',
        'text-align:center;color:#fff;background:rgba(0,0,0,.45);}',
        '.mps-sim .sim-shot b{position:absolute;right:3px;top:3px;font-size:10px;color:#fff;',
        'background:rgba(0,0,0,.45);border-radius:4px;padding:0 4px;line-height:1.5;font-weight:500;}',
        '.mps-sim .sim-warnbox{padding:7px 11px;font-size:12px;color:#d29922;background:rgba(210,153,34,.08);',
        'border-top:1px solid rgba(210,153,34,.25);white-space:pre-wrap;}',
        '.sim-lightbox{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.72);display:flex;',
        'align-items:center;justify-content:center;flex-direction:column;gap:10px;padding:24px;cursor:zoom-out;}',
        '.sim-lightbox img{max-width:min(92vw,980px);max-height:68vh;border-radius:10px;',
        'box-shadow:0 12px 40px rgba(0,0,0,.5);background:#fff;}',
        '.sim-lightbox .lb-meta{color:#e6edf3;font-size:12px;font-variant-numeric:tabular-nums;',
        'max-width:min(92vw,980px);text-align:center;line-height:1.9;font-family:Consolas,Menlo,monospace;}',
        '.sim-lightbox .lb-tip{color:#9aa4ad;font-size:11px;}',
        '.sim-link{display:flex;align-items:center;gap:8px;margin:.7em auto;padding:6px 11px;',
        'border:1px dashed var(--border-color,#d0d7de);border-radius:10px;',
        'background:var(--code-bg,#f6f8fa);font-size:12px;color:var(--text-secondary,#57606a);',
        'flex-wrap:wrap;max-width:100%;}',
        '.sim-link .sim-link-icon{flex:0 0 auto;}',
        '.sim-link .sim-link-text{flex:1;min-width:150px;}',
        '.sim-link .sim-link-text b{color:var(--text-primary,#1f2328);}',
        '.sim-link .sim-link-go{flex:0 0 auto;border:1px solid var(--border-color,#d0d7de);',
        'background:var(--bg-panel,#fff);color:inherit;border-radius:6px;height:24px;padding:0 10px;',
        'font-size:12px;cursor:pointer;font-family:inherit;}',
        '.sim-link .sim-link-go:hover{background:var(--hover-bg,#f3f4f6);}',
        '.sim-link .sim-link-go[disabled]{opacity:.45;cursor:not-allowed;}',
        '.sim-link.armed{border-style:solid;border-color:var(--accent,#0969da);}',
        '.sim-link .sim-count{font-variant-numeric:tabular-nums;color:var(--accent,#0969da);font-weight:600;}',
        '.mps-sim .sim-empty{padding:14px;color:var(--text-muted,#8b949e);}'
    ].join('');

    /* =========================================================
       1. 工具
       ========================================================= */
    function djb2(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
        return h.toString(36);
    }

    function fmt(v, d) {
        if (typeof v !== 'number' || !isFinite(v)) return '—';
        const a = Math.abs(v);
        let s;
        if (a >= 1000) s = v.toFixed(0);
        else if (a >= 100) s = v.toFixed(Math.min(1, d == null ? 1 : d));
        else s = v.toFixed(d == null ? 2 : d);
        if (s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, '');
        return s === '' || s === '-' ? '0' : s;
    }

    // 滑块步长：取量程的 1/100 再收敛到 1/2/5 × 10^n
    function niceStep(min, max) {
        const span = Math.abs(max - min) || 1;
        const raw = span / 100;
        const mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const n = raw / mag;
        const step = (n >= 5 ? 5 : n >= 2 ? 2 : 1) * mag;
        return step > 0 ? step : span / 100;
    }

    function pct(v, digits) {
        if (!isFinite(v)) return '—';
        return (v * 100).toFixed(digits == null ? 1 : digits) + '%';
    }

    // 主题色（从 CSS 变量取，兼容深色模式）
    function palette(node) {
        const cs = global.getComputedStyle(node);
        const pick = function (k, d) {
            const v = (cs.getPropertyValue(k) || '').trim();
            return v || d;
        };
        return {
            bg: pick('--bg-panel', '#ffffff'),
            panel: pick('--code-bg', '#f6f8fa'),
            text: pick('--text-primary', '#1f2328'),
            sub: pick('--text-secondary', '#57606a'),
            muted: pick('--text-muted', '#8b949e'),
            border: pick('--border-light', '#e1e4e8'),
            accent: pick('--accent', '#0969da'),
            dark: !!(global.document.body && global.document.body.classList.contains('dark-mode'))
        };
    }

    function series(n, P) {
        const base = ['#0969da', '#f78166', '#3fb950', '#a371f7', '#e3b341', '#58a6ff', '#db61a2'];
        const arr = [P.accent].concat(base.slice(1));
        const out = [];
        for (let i = 0; i < n; i++) out.push(arr[i % arr.length]);
        return out;
    }

    function download(name, href) {
        const a = global.document.createElement('a');
        a.href = href;
        a.download = name;
        a.style.display = 'none';
        global.document.body.appendChild(a);
        a.click();
        setTimeout(function () { a.remove(); }, 0);
    }

    function safeName(s) {
        return String(s || 'sim').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
    }

    /* =========================================================
       2. 表达式编译（递归下降；改编自本项目 mps-manim 的求值器）
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
        const re = /\s*(<=|>=|==|!=|&&|\|\||[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+|[+\-*/^%(),<>])/g;
        const out = [];
        let m;
        while ((m = re.exec(src))) out.push(m[1]);
        return out;
    }

    // 编译表达式；allow 为允许的变量名集合（state / param / t）——
    // 先扫一遍标识符，拼错的变量在编译期就报错，避免运行期静默 NaN
    function compileExpr(src, allow) {
        const toks = tokenizeExpr(src);
        for (let i = 0; i < toks.length; i++) {
            const t = toks[i];
            if (!/^[A-Za-z_]/.test(t)) continue;
            if (toks[i + 1] === '(') {
                if (!FUNCS[t]) throw new Error('未知函数 ' + t);
                continue;
            }
            if (CONSTS[t] !== undefined) continue;
            if (allow && allow[t] === undefined) throw new Error('未知变量 ' + t);
        }
        let i = 0;
        const peek = function () { return toks[i]; };
        const next = function () { return toks[i++]; };
        const isAtomStart = function (t) {
            return t !== undefined && (t === '(' || /^[0-9.]/.test(t) || /^[A-Za-z_]/.test(t));
        };

        // 优先级（低 → 高）：|| → && → 比较 → 加减 → 乘除 → 一元 → 幂 → 原子
        // 只有 finish 等「条件」会用到前两级，普通导数表达式不会碰到
        function parseExpr() {
            let fn = parseAnd();
            for (;;) {
                if (peek() === '||') { next(); const r = parseAnd(), l = fn; fn = function (s) { return l(s) || r(s); }; }
                else break;
            }
            return fn;
        }
        function parseAnd() {
            let fn = parseCmp();
            for (;;) {
                if (peek() === '&&') { next(); const r = parseCmp(), l = fn; fn = function (s) { return l(s) && r(s); }; }
                else break;
            }
            return fn;
        }
        function parseCmp() {
            let fn = parseAdd();
            for (;;) {
                const t = peek();
                if (t === '<' || t === '>' || t === '<=' || t === '>=' || t === '==' || t === '!=') {
                    next();
                    const r = parseAdd(), l = fn, op = t;
                    fn = function (s) {
                        const a = l(s), b = r(s);
                        if (op === '<') return a < b;
                        if (op === '>') return a > b;
                        if (op === '<=') return a <= b;
                        if (op === '>=') return a >= b;
                        if (op === '==') return a === b;
                        return a !== b;
                    };
                } else break;
            }
            return fn;
        }
        function parseAdd() {
            let fn = parseTerm();
            for (;;) {
                const t = peek();
                if (t === '+') { next(); const r = parseTerm(), l = fn; fn = function (s) { return l(s) + r(s); }; }
                else if (t === '-') { next(); const r = parseTerm(), l = fn; fn = function (s) { return l(s) - r(s); }; }
                else break;
            }
            return fn;
        }
        function parseTerm() {
            let fn = parseUnary();
            for (;;) {
                const t = peek();
                if (t === '*') { next(); const r = parseUnary(), l = fn; fn = function (s) { return l(s) * r(s); }; }
                else if (t === '/') { next(); const r = parseUnary(), l = fn; fn = function (s) { return l(s) / r(s); }; }
                else if (t === '%') { next(); const r = parseUnary(), l = fn; fn = function (s) { return l(s) % r(s); }; }
                else if (isAtomStart(t)) { const r = parseUnary(), l = fn; fn = function (s) { return l(s) * r(s); }; }
                else break;
            }
            return fn;
        }
        function parseUnary() {
            const t = peek();
            if (t === '-') { next(); const f = parseUnary(); return function (s) { return -f(s); }; }
            if (t === '+') { next(); return parseUnary(); }
            return parsePower();
        }
        function parsePower() {
            const base = parseAtom();
            if (peek() === '^') { next(); const ex = parseUnary(); return function (s) { return Math.pow(base(s), ex(s)); }; }
            return base;
        }
        function parseAtom() {
            const t = next();
            if (t === undefined) throw new Error('表达式不完整');
            if (t === '(') {
                const f = parseExpr();
                if (next() !== ')') throw new Error('缺少 )');
                return f;
            }
            if (/^[0-9.]/.test(t)) { const n = parseFloat(t); return function () { return n; }; }
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
                    return function (s) { return f.apply(null, args.map(function (a) { return a(s); })); };
                }
                if (CONSTS[name] !== undefined) { const c = CONSTS[name]; return function () { return c; }; }
                return function (s) { return s && s[name] !== undefined ? s[name] : NaN; };
            }
            throw new Error('无法解析: ' + t);
        }

        const fn = parseExpr();
        if (i < toks.length) throw new Error('多余内容: ' + toks[i]);
        return function (scope) {
            const v = fn(scope || {});
            if (typeof v === 'boolean') return v;   // 条件表达式（如 finish）保留真假
            return isFinite(v) ? v : 0;
        };
    }

    /* =========================================================
       3. 内置模型库
       ---------------------------------------------------------
       kind: 'ode'  状态 + 导数（RK4 积分）
             'wave' 无状态，画面由 t 与参数直接决定（波的叠加）
       ========================================================= */
    const MODELS = {
        spring: {
            name: '弹簧振子', kind: 'ode', view: 'spring',
            state: [['x', '1'], ['v', '0']],
            params: [
                { key: 'k', min: 0.2, max: 3, def: 1, label: '劲度系数 k' },
                { key: 'c', min: 0, max: 1, def: 0.12, label: '阻尼 c' },
                { key: 'm', min: 0.5, max: 2, def: 1, label: '质量 m' }
            ],
            d: { x: 'v', v: '(-k*x - c*v)/m' },
            project: ['x', 'v']
        },
        pendulum: {
            name: '单摆', kind: 'ode', view: 'pendulum',
            state: [['th', '2'], ['w', '0']],
            params: [
                { key: 'L', min: 0.4, max: 3, def: 1, label: '摆长 L' },
                { key: 'g', min: 1, max: 20, def: 9.8, label: '重力 g' },
                { key: 'damp', min: 0, max: 1, def: 0.05, label: '阻尼' }
            ],
            d: { th: 'w', w: '-(g/L)*sin(th) - damp*w' },
            project: ['th', 'w']
        },
        projectile: {
            name: '抛体运动', kind: 'ode', view: 'projectile',
            state: [['x', '0'], ['y', '0'], ['vx', 'v0*cos(ang*pi/180)'], ['vy', 'v0*sin(ang*pi/180)']],
            params: [
                { key: 'v0', min: 5, max: 60, def: 28, label: '初速度 v₀' },
                { key: 'ang', min: 5, max: 85, def: 45, label: '发射角 °' },
                { key: 'drag', min: 0, max: 0.6, def: 0.05, label: '空气阻力' },
                { key: 'g', min: 1, max: 20, def: 9.8, label: '重力 g' }
            ],
            d: {
                x: 'vx', y: 'vy',
                vx: '-drag*vx*sqrt(vx*vx+vy*vy)*0.6',
                vy: '-g - drag*vy*sqrt(vx*vx+vy*vy)*0.6'
            },
            project: ['x', 'y'],
            finish: 'y <= 0 && t > 0.3'
        },
        sir: {
            name: '传染病 SIR', kind: 'ode', view: 'bars',
            state: [['S', '0.999'], ['I', '0.001'], ['R', '0']],
            params: [
                { key: 'beta', min: 0.05, max: 2, def: 0.6, label: '传染率 β' },
                { key: 'gamma', min: 0.02, max: 1, def: 0.15, label: '恢复率 γ' }
            ],
            d: { S: '-beta*S*I', I: 'beta*S*I - gamma*I', R: 'gamma*I' },
            project: ['I', 'R']
        },
        logistic: {
            name: '种群增长', kind: 'ode', view: 'time',
            state: [['N', '0.02']],
            params: [
                { key: 'r', min: 0.1, max: 3, def: 1.2, label: '增长率 r' },
                { key: 'K', min: 0.2, max: 2, def: 1, label: '环境容量 K' }
            ],
            d: { N: 'r*N*(1 - N/K)' },
            project: ['N'],
            viewArgs: ['N'],
            finish: 'abs(N - K) < K*0.01'
        },
        lotka: {
            name: '捕食者与被捕食者', kind: 'ode', view: 'phase',
            state: [['prey', '4'], ['pred', '2']],
            params: [
                { key: 'a', min: 0.5, max: 2, def: 1.1, label: '繁殖率 α' },
                { key: 'b', min: 0.05, max: 0.8, def: 0.4, label: '捕食率 β' },
                { key: 'c', min: 0.05, max: 0.8, def: 0.1, label: '转化率 δ' },
                { key: 'd', min: 0.2, max: 2, def: 0.4, label: '死亡率 γ' }
            ],
            d: { prey: 'a*prey - b*prey*pred', pred: 'c*prey*pred - d*pred' },
            project: ['prey', 'pred'],
            viewArgs: ['prey', 'pred']
        },
        lorenz: {
            name: '洛伦兹吸引子', kind: 'ode', view: 'phase',
            state: [['x', '1'], ['y', '1'], ['z', '1']],
            params: [
                { key: 'sig', min: 2, max: 20, def: 10, label: 'σ' },
                { key: 'rho', min: 10, max: 45, def: 28, label: 'ρ' },
                { key: 'bet', min: 1, max: 6, def: 2.667, label: 'β' }
            ],
            d: { x: 'sig*(y-x)', y: 'x*(rho-z) - y', z: 'x*y - bet*z' },
            project: ['x', 'y', 'z'],
            viewArgs: ['x', 'z']
        },
        rc: {
            name: '电容充放电', kind: 'ode', view: 'time',
            state: [['V', '0']],
            params: [
                { key: 'E', min: 1, max: 12, def: 5, label: '电源电压 E' },
                { key: 'R', min: 1, max: 10, def: 2, label: '电阻 R' },
                { key: 'C', min: 0.5, max: 5, def: 1, label: '电容 C' }
            ],
            d: { V: '(E - V)/(R*C)' },
            project: ['V'],
            viewArgs: ['V'],
            finish: 'abs(V - E) < E*0.01'
        },
        wave: {
            name: '波的叠加', kind: 'wave', view: 'wave',
            state: [],
            params: [
                { key: 'A1', min: 0, max: 1.5, def: 1, label: '波1 振幅' },
                { key: 'f1', min: 0.5, max: 4, def: 1.5, label: '波1 频率' },
                { key: 'A2', min: 0, max: 1.5, def: 0.7, label: '波2 振幅' },
                { key: 'f2', min: 0.5, max: 4, def: 2.5, label: '波2 频率' },
                { key: 'phi', min: 0, max: 6.28, def: 0, label: '相位差 φ' }
            ],
            d: {},
            project: ['A1', 'f1', 'A2', 'f2'],
            viewArgs: []
        }
    };

    /* =========================================================
       4. DSL 解析
       ========================================================= */
    function parseSim(content) {
        const spec = {
            title: '', ratio: '16:9', model: null, kind: 'ode',
            states: [], params: [], deriv: {}, view: { kind: '', args: [] },
            project: null, snapSec: 0, rate: { min: 0.25, max: 4, def: 1 },
            hud: true, finish: null, warnings: []
        };
        const rawParams = [];
        const lines = String(content == null ? '' : content).replace(/\r\n?/g, '\n').split('\n');

        lines.forEach(function (raw, li) {
            const line = raw.trim();
            if (!line || line.charAt(0) === '#') return;
            const sp = line.search(/\s/);
            const key = (sp < 0 ? line : line.slice(0, sp)).toLowerCase();
            const rest = sp < 0 ? '' : line.slice(sp + 1).trim();
            const at = '第 ' + (li + 1) + ' 行';
            if (key === 'title') { spec.title = rest; return; }
            if (key === 'ratio') { spec.ratio = rest; return; }
            if (key === 'preset') { spec.model = rest.toLowerCase(); return; }
            if (key === 'param') {
                const tk = rest.split(/\s+/);
                const name = tk.shift();
                if (!name) { spec.warnings.push(at + '：param 缺少名称'); return; }
                const nums = [];
                while (tk.length && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(tk[0])) nums.push(parseFloat(tk.shift()));
                rawParams.push({ key: name, min: nums[0], max: nums[1], def: nums[2], label: tk.join(' ') });
                return;
            }
            if (key === 'state') {
                const tk = rest.split(/\s+/);
                if (tk.length < 2) { spec.warnings.push(at + '：state 需要「名称 初值」'); return; }
                spec.states.push({ name: tk[0], init: tk.slice(1).join(' ') });
                return;
            }
            if (key === 'd') {
                const m = rest.match(/^(\w+)\s*=\s*([\s\S]+)$/);
                if (!m) { spec.warnings.push(at + '：d 需要写成「d x = 表达式」'); return; }
                spec.deriv[m[1]] = m[2].trim();
                return;
            }
            if (key === 'view') {
                const tk = rest.split(/\s+/).filter(Boolean);
                spec.view.kind = (tk.shift() || '').toLowerCase();
                spec.view.args = tk;
                return;
            }
            if (key === 'project') { spec.project = rest.split(/[\s,]+/).filter(Boolean); return; }
            if (key === 'snap') { spec.snapSec = Math.max(0, parseFloat(rest) || 0); return; }
            if (key === 'rate') {
                const n = rest.split(/\s+/).map(parseFloat);
                if (isFinite(n[0])) spec.rate.min = Math.max(0.05, n[0]);
                if (isFinite(n[1])) spec.rate.max = Math.max(spec.rate.min + 0.05, n[1]);
                if (isFinite(n[2])) spec.rate.def = Math.min(spec.rate.max, Math.max(spec.rate.min, n[2]));
                return;
            }
            if (key === 'hud') { spec.hud = !/^(off|no|0|关|关闭)$/i.test(rest); return; }
            spec.warnings.push(at + '：未知指令 ' + key);
        });

        // —— 合并内置模型 ——
        const M = spec.model ? MODELS[spec.model] : null;
        if (spec.model && !M) throw new Error('未知模型 ' + spec.model + '（可用：' + Object.keys(MODELS).join(' / ') + '）');
        if (M) {
            if (spec.states.length || Object.keys(spec.deriv).length) {
                spec.warnings.push('preset 与 state/d 同时存在：state、d 行被忽略（自定义方程请去掉 preset）');
            }
            spec.kind = M.kind;
            spec.states = M.state.map(function (s) { return { name: s[0], init: s[1] }; });
            spec.deriv = Object.assign({}, M.d);
            spec.finish = M.finish || null;
            spec.params = M.params.map(function (p) { return Object.assign({}, p); });
            if (!spec.view.kind) {
                spec.view.kind = M.view;
                spec.view.args = (M.viewArgs || []).slice();
            }
            spec.project = spec.project || M.project.slice();
            spec.badge = M.name;
        } else {
            if (!spec.states.length) {
                throw new Error('缺少内容：写 preset <模型> 用内置模型，或用 state / d 定义自定义方程');
            }
            spec.kind = 'ode';
            spec.params = [];
            spec.badge = '自定义方程';
            // 自定义模型的导数缺省为 0
            const names = {};
            spec.states.forEach(function (s) {
                if (names[s.name]) spec.warnings.push('状态 ' + s.name + ' 重复声明');
                names[s.name] = 1;
                if (spec.deriv[s.name] === undefined) spec.warnings.push('状态 ' + s.name + ' 没有对应的 d 表达式（按 0 处理）');
            });
            Object.keys(spec.deriv).forEach(function (k) {
                if (!names[k]) spec.warnings.push('d ' + k + ' 没有对应的 state 声明，已忽略');
            });
            if (!spec.view.kind) spec.view.kind = spec.states.length >= 2 ? 'phase' : 'time';
            if (!spec.project) spec.project = spec.states.slice(0, 4).map(function (s) { return s.name; });
        }

        // —— 参数覆盖 / 追加 ——
        rawParams.forEach(function (rp) {
            const base = spec.params.find(function (p) { return p.key === rp.key; });
            if (base) {
                if (rp.min !== undefined) base.min = rp.min;
                if (rp.max !== undefined) base.max = rp.max;
                if (base.max <= base.min) base.max = base.min + 1;
                if (rp.def !== undefined) base.def = rp.def;
                if (rp.label) base.label = rp.label;
            } else {
                const min = rp.min === undefined ? 0 : rp.min;
                const max = rp.max === undefined ? Math.max(1, min + 1) : rp.max;
                const def = rp.def === undefined ? (min + max) / 2 : rp.def;
                spec.params.push({
                    key: rp.key, min: min, max: max > min ? max : min + 1,
                    def: def, label: rp.label || rp.key
                });
            }
        });
        // 预设参数被项目改名后：滑块顺序按预设来，自定义参数排后面
        spec.params.forEach(function (p) {
            if (p.max <= p.min) p.max = p.min + 1;
            if (p.def < p.min || p.def > p.max) p.def = (p.min + p.max) / 2;
            if (!p.label) p.label = p.key;
        });

        spec.project = (spec.project || []).filter(function (n) {
            const ok = spec.states.some(function (s) { return s.name === n; }) ||
                spec.params.some(function (p) { return p.key === n; });
            if (!ok) spec.warnings.push('project 的 ' + n + ' 既不是状态也不是参数，已忽略');
            return ok;
        });
        if (spec.project.length > 6) spec.project = spec.project.slice(0, 6);
        if (!spec.view.kind) spec.view.kind = 'time';
        if (!/^(spring|pendulum|projectile|wave|phase|time|bars)$/.test(spec.view.kind)) {
            spec.warnings.push('未知视图 ' + spec.view.kind + '，已回退到 time');
            spec.view.kind = 'time';
        }
        return spec;
    }

    /* =========================================================
       5. 引擎：状态 + RK4 积分 + 历史 / 轨迹
       ========================================================= */
    function makeSim(spec) {
        const sim = {
            spec: spec, t: 0, params: {}, state: {}, running: true, finished: false,
            rate: spec.rate.def, hist: [], trail: [], lastHist: -1, lastTrail: -1,
            derivFns: [], initFns: [], finishFn: null, trailFn: null
        };
        spec.params.forEach(function (p) { sim.params[p.key] = p.def; });

        const allow = {};
        spec.states.forEach(function (s) { allow[s.name] = 1; });
        spec.params.forEach(function (p) { allow[p.key] = 1; });
        allow.t = 1;

        if (spec.kind === 'ode') {
            sim.initFns = spec.states.map(function (s) {
                return compileExpr(s.init, allow);
            });
            sim.derivFns = spec.states.map(function (s) {
                return compileExpr(spec.deriv[s.name] === undefined ? '0' : spec.deriv[s.name], allow);
            });
            if (spec.finish) sim.finishFn = compileExpr(spec.finish, allow);
        }

        // 轨迹投影（不同视图取不同的两点）
        const va = spec.view.args;
        const v0 = va[0] || (spec.states[0] && spec.states[0].name);
        const v1 = va[1] || (spec.states[1] && spec.states[1].name);
        if (spec.view.kind === 'phase' && v0 && v1) {
            sim.trailFn = function (st) { return [st[v0], st[v1]]; };
        } else if (spec.view.kind === 'projectile') {
            sim.trailFn = function (st) { return [st.x, st.y]; };
        } else if (spec.view.kind === 'pendulum') {
            sim.trailFn = function (st, p) { return [Math.sin(st.th) * p.L, -Math.cos(st.th) * p.L]; };
        }

        simReset(sim);
        return sim;
    }

    function scopeOf(sim, st, t) {
        const sc = {};
        for (const k in sim.params) sc[k] = sim.params[k];
        for (const k in st) sc[k] = st[k];
        sc.t = t;
        return sc;
    }

    function simReset(sim) {
        const sc = scopeOf(sim, {}, 0);
        const st = {};
        sim.spec.states.forEach(function (s, i) {
            st[s.name] = sim.initFns[i] ? sim.initFns[i](sc) : 0;
        });
        sim.state = st;
        sim.t = 0;
        sim.finished = false;
        sim.hist = [];
        sim.trail = [];
        sim.lastHist = -1;
        sim.lastTrail = -1;
        sim.running = true;
    }

    // RK4 一步
    function simStep(sim, h) {
        const spec = sim.spec;
        if (spec.kind !== 'ode') { sim.t += h; return; }
        const names = spec.states.map(function (s) { return s.name; });
        const st = sim.state;
        const k1 = names.map(function (n, i) { return sim.derivFns[i](scopeOf(sim, st, sim.t)); });
        const tmp = {};
        function mid(k, f) {
            names.forEach(function (n, i) { tmp[n] = st[n] + k[i] * h * f; });
            return names.map(function (n, i) { return sim.derivFns[i](scopeOf(sim, tmp, sim.t + h * f)); });
        }
        const k2 = mid(k1, 0.5);
        const k3 = mid(k2, 0.5);
        names.forEach(function (n, i) { tmp[n] = st[n] + k3[i] * h; });
        const k4 = names.map(function (n, i) { return sim.derivFns[i](scopeOf(sim, tmp, sim.t + h)); });
        names.forEach(function (n, i) {
            const v = st[n] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
            st[n] = isFinite(v) ? v : st[n];
        });
        sim.t += h;

        // 历史采样（供时间曲线 / 堆叠图）
        if (sim.lastHist < 0 || sim.t - sim.lastHist >= PAGE_OFF) {
            sim.lastHist = sim.t;
            const row = { t: sim.t, v: names.map(function (n) { return st[n]; }) };
            sim.hist.push(row);
            if (sim.hist.length > HIST_MAX) sim.hist = sim.hist.filter(function (_, i) { return i % 2 === 0; });
        }
        // 轨迹采样
        if (sim.trailFn && (sim.lastTrail < 0 || sim.t - sim.lastTrail >= TRAIL_DT)) {
            sim.lastTrail = sim.t;
            const p = sim.trailFn(st, sim.params);
            if (isFinite(p[0]) && isFinite(p[1])) {
                sim.trail.push(p);
                if (sim.trail.length > TRAIL_MAX) sim.trail = sim.trail.filter(function (_, i) { return i % 2 === 0; });
            }
        }
        if (sim.finishFn && sim.finishFn(scopeOf(sim, st, sim.t))) {
            sim.finished = true;
            sim.running = false;
        }
    }

    // 推进 dtReal 秒（真实时间），按时间倍率换算为模拟时间
    function simAdvance(sim, dtReal) {
        if (!sim.running) return;
        if (sim.spec.kind === 'wave') {
            sim.t += dtReal * sim.rate;
            return;
        }
        const h = 0.004;
        let steps = Math.min(900, Math.round((dtReal * sim.rate) / h));
        if (!isFinite(steps) || steps < 0) steps = 0;
        for (let i = 0; i < steps && sim.running; i++) simStep(sim, h);
    }

    /* =========================================================
       6. 视图渲染
       ========================================================= */
    function makeScale(min, max, p0, p1) {
        if (!isFinite(min) || !isFinite(max) || max <= min) { max = min + 1; }
        const pad = (max - min) * 0.08;
        min -= pad; max += pad;
        const k = (p1 - p0) / (max - min);
        return {
            min: min, max: max, p0: p0, p1: p1,
            map: function (v) { return p0 + (v - min) * k; },
            inv: function (p) { return min + (p - p0) / k; }
        };
    }

    // 平滑跟随的自动量程（避免抖动）
    function fitRange(box, cur, min, max) {
        if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
        if (max - min < 1e-9) { max = min + 1; }
        if (!box) return { min: min, max: max };
        const f = 0.12;
        return {
            min: box.min + (min - box.min) * f,
            max: box.max + (max - box.max) * f
        };
    }

    function drawGrid(ctx, r, xr, yr, P, xlab, ylab) {
        ctx.save();
        ctx.strokeStyle = P.border;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.9;
        for (let i = 0; i <= 4; i++) {
            const px = r.x + (r.w * i) / 4;
            const py = r.y + (r.h * i) / 4;
            ctx.beginPath(); ctx.moveTo(px, r.y); ctx.lineTo(px, r.y + r.h); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(r.x, py); ctx.lineTo(r.x + r.w, py); ctx.stroke();
        }
        // 零线（y 轴需翻转：makeScale 的像素 y 与屏幕方向一致，视图里统一取反）
        const yFlip = function (v) { return r.y + r.h - (yr.map(v) - r.y); };
        ctx.strokeStyle = P.muted;
        ctx.globalAlpha = 0.8;
        if (yr.min < 0 && yr.max > 0) {
            const zy = yFlip(0);
            ctx.beginPath();
            ctx.moveTo(r.x, zy);
            ctx.lineTo(r.x + r.w, zy);
            ctx.stroke();
        }
        if (xr.min < 0 && xr.max > 0) {
            const px = xr.map(0);
            ctx.beginPath(); ctx.moveTo(px, r.y); ctx.lineTo(px, r.y + r.h); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = P.muted;
        ctx.font = '10px "Segoe UI",system-ui,sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(fmt(xr.min, 1), r.x, r.y + r.h + 3);
        ctx.textAlign = 'right';
        ctx.fillText(fmt(xr.max, 1), r.x + r.w, r.y + r.h + 3);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(fmt(yr.max, 1), r.x + 3, r.y + 9);
        ctx.fillText(fmt(yr.min, 1), r.x + 3, r.y + r.h - 2);
        if (xlab) {
            ctx.textAlign = 'right';
            ctx.fillText(xlab, r.x + r.w, r.y + r.h + 3);
        }
        ctx.restore();
    }

    function poly(ctx, pts, mapX, mapY) {
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
            const px = mapX(pts[i][0]), py = mapY(pts[i][1]);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
    }

    function drawAxesBox(ctx, W, H) {
        const padL = 44, padR = 16, padT = 14, padB = 20;
        return { x: padL, y: padT, w: Math.max(20, W - padL - padR), h: Math.max(20, H - padT - padB) };
    }

    // —— 相位图（轨迹 + 当前位置）
    function viewPhase(card, ctx, W, H, P) {
        const sim = card.sim, r = drawAxesBox(ctx, W, H);
        let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
        sim.trail.forEach(function (p) {
            mnX = Math.min(mnX, p[0]); mxX = Math.max(mxX, p[0]);
            mnY = Math.min(mnY, p[1]); mxY = Math.max(mxY, p[1]);
        });
        const va = sim.spec.view.args;
        const n0 = va[0] || (sim.spec.states[0] && sim.spec.states[0].name);
        const n1 = va[1] || (sim.spec.states[1] && sim.spec.states[1].name);
        if (n0 && sim.state[n0] !== undefined) {
            mnX = Math.min(mnX, sim.state[n0]); mxX = Math.max(mxX, sim.state[n0]);
        }
        if (n1 && sim.state[n1] !== undefined) {
            mnY = Math.min(mnY, sim.state[n1]); mxY = Math.max(mxY, sim.state[n1]);
        }
        card.rng = {
            x: fitRange(card.rng && card.rng.x, null, mnX, mxX),
            y: fitRange(card.rng && card.rng.y, null, mnY, mxY)
        };
        const xr = makeScale(card.rng.x.min, card.rng.x.max, r.x, r.x + r.w);
        const yr = makeScale(card.rng.y.min, card.rng.y.max, r.y, r.y + r.h);
        const myX = function (v) { return xr.map(v); };
        const myY = function (v) { return r.y + r.h - (yr.map(v) - r.y); };
        drawGrid(ctx, r, xr, yr, P, n0, n1);
        ctx.save();
        ctx.strokeStyle = P.accent;
        ctx.lineWidth = 1.6;
        ctx.globalAlpha = 0.85;
        poly(ctx, sim.trail, myX, myY);
        ctx.globalAlpha = 1;
        if (n0 && n1 && sim.state[n0] !== undefined && sim.state[n1] !== undefined) {
            ctx.fillStyle = P.accent;
            ctx.beginPath();
            ctx.arc(myX(sim.state[n0]), myY(sim.state[n1]), 4, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    // —— 时间曲线（可多序列）
    function viewTime(card, ctx, W, H, P) {
        const sim = card.sim, r = drawAxesBox(ctx, W, H);
        const spec = sim.spec;
        let names = spec.view.args.slice();
        if (!names.length) names = spec.project.slice();
        names = names.filter(function (n) { return sim.state[n] !== undefined; });
        if (!names.length) names = spec.states.map(function (s) { return s.name; });
        const idx = names.map(function (n) {
            return spec.states.findIndex(function (s) { return s.name === n; });
        });
        const hist = sim.hist;
        let mn = Infinity, mx = -Infinity;
        hist.forEach(function (row) {
            idx.forEach(function (i) {
                const v = row.v[i];
                if (!isFinite(v)) return;
                mn = Math.min(mn, v); mx = Math.max(mx, v);
            });
        });
        card.rng = {
            x: null,
            y: fitRange(card.rng && card.rng.y, null, mn, mx)
        };
        const xr = makeScale(0, Math.max(1, sim.t), r.x, r.x + r.w);
        const yr = makeScale(card.rng.y.min, card.rng.y.max, r.y, r.y + r.h);
        const myX = function (v) { return xr.map(v); };
        const myY = function (v) { return r.y + r.h - (yr.map(v) - r.y); };
        drawGrid(ctx, r, xr, yr, P, 't / s', null);
        const cols = series(idx.length, P);
        ctx.save();
        ctx.lineWidth = 1.8;
        idx.forEach(function (si, k) {
            if (si < 0) return;
            ctx.strokeStyle = cols[k];
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < hist.length; i++) {
                const v = hist[i].v[si];
                if (!isFinite(v)) continue;
                const px = myX(hist[i].t), py = myY(v);
                if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
            }
            ctx.stroke();
        });
        ctx.restore();
        legend(ctx, W, H, names, cols, sim, P);
    }

    // —— 堆叠面积（SIR 等：把前几个状态叠起来看构成）
    function viewBars(card, ctx, W, H, P) {
        const sim = card.sim, r = drawAxesBox(ctx, W, H);
        const spec = sim.spec;
        let names = spec.view.args.slice();
        if (!names.length) names = spec.states.slice(0, 3).map(function (s) { return s.name; });
        const idx = names.map(function (n) {
            return spec.states.findIndex(function (s) { return s.name === n; });
        }).filter(function (i) { return i >= 0; });
        const hist = sim.hist;
        let mx = 0;
        hist.forEach(function (row) {
            let s = 0;
            idx.forEach(function (i) { s += row.v[i] || 0; });
            mx = Math.max(mx, s);
        });
        card.rng = { x: null, y: fitRange(card.rng && card.rng.y, null, 0, mx) };
        const xr = makeScale(0, Math.max(1, sim.t), r.x, r.x + r.w);
        const yr = makeScale(card.rng.y.min, card.rng.y.max, r.y, r.y + r.h);
        const myX = function (v) { return xr.map(v); };
        const base = function (v) { return r.y + r.h - (yr.map(v) - r.y); };
        drawGrid(ctx, r, xr, yr, P, 't / s', null);
        const cols = series(idx.length, P);
        ctx.save();
        ctx.globalAlpha = 0.75;
        const acc = new Array(hist.length).fill(0);
        idx.forEach(function (si, k) {
            ctx.fillStyle = cols[k];
            ctx.beginPath();
            for (let i = 0; i < hist.length; i++) {
                const px = myX(hist[i].t);
                const py = base(acc[i] + (hist[i].v[si] || 0));
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            for (let i = hist.length - 1; i >= 0; i--) {
                ctx.lineTo(myX(hist[i].t), base(acc[i]));
            }
            ctx.closePath();
            ctx.fill();
            for (let i = 0; i < hist.length; i++) acc[i] += hist[i].v[si] || 0;
        });
        ctx.restore();
        legend(ctx, W, H, names, cols, sim, P);
    }

    function legend(ctx, W, H, names, cols, sim, P) {
        ctx.save();
        ctx.font = '11px "Segoe UI",system-ui,sans-serif';
        ctx.textBaseline = 'middle';
        let x = 52, y = H - 11;
        names.forEach(function (n, k) {
            ctx.fillStyle = cols[k];
            ctx.beginPath();
            ctx.arc(x, y, 3.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = P.sub;
            const txt = n + ' ' + fmt(sim.state[n] !== undefined ? sim.state[n] : NaN, 2);
            ctx.fillText(txt, x + 7, y);
            x += 7 + ctx.measureText(txt).width + 14;
        });
        ctx.restore();
    }

    // —— 弹簧振子示意
    function viewSpring(card, ctx, W, H, P) {
        const sim = card.sim;
        const x = sim.state.x || 0;
        const v = sim.state.v || 0;
        const cy = H * 0.52;
        const wallX = Math.max(18, W * 0.07);
        const eqX = W * 0.56;
        const pxPerM = Math.min((W * 0.26), 150);
        const bx = Math.max(wallX + 26, Math.min(W - 30, eqX + x * pxPerM));
        const bh = Math.min(64, H * 0.3), bw = Math.max(26, bh * 0.62);
        ctx.save();
        // 墙面
        ctx.fillStyle = P.muted;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(wallX - 8, cy - bh, 8, bh * 2);
        ctx.globalAlpha = 1;
        // 平衡位置
        ctx.strokeStyle = P.border;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(eqX, cy - bh); ctx.lineTo(eqX, cy + bh); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = P.muted;
        ctx.font = '10px "Segoe UI",system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('平衡位置', eqX, cy + bh + 14);
        // 弹簧（折线）
        const n = 12, x0 = wallX, x1 = bx - bw / 2;
        const amp = Math.min(12, (x1 - x0) * 0.14);
        ctx.strokeStyle = P.accent;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(x0, cy);
        for (let i = 1; i < n; i++) {
            const px = x0 + (x1 - x0) * (i / n);
            ctx.lineTo(px, cy + (i % 2 ? -amp : amp));
        }
        ctx.lineTo(x1, cy);
        ctx.stroke();
        // 物块
        ctx.fillStyle = P.accent;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        const rad = 6;
        ctx.moveTo(bx - bw / 2 + rad, cy - bh / 2);
        ctx.arcTo(bx + bw / 2, cy - bh / 2, bx + bw / 2, cy + bh / 2, rad);
        ctx.arcTo(bx + bw / 2, cy + bh / 2, bx - bw / 2, cy + bh / 2, rad);
        ctx.arcTo(bx - bw / 2, cy + bh / 2, bx - bw / 2, cy - bh / 2, rad);
        ctx.arcTo(bx - bw / 2, cy - bh / 2, bx + bw / 2, cy - bh / 2, rad);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        // 速度箭头
        if (Math.abs(v) > 0.01) {
            const len = Math.max(-W * 0.22, Math.min(W * 0.22, v * 26));
            ctx.strokeStyle = '#f78166';
            ctx.fillStyle = '#f78166';
            ctx.lineWidth = 1.6;
            const ay = cy - bh / 2 - 12;
            ctx.beginPath(); ctx.moveTo(bx, ay); ctx.lineTo(bx + len, ay); ctx.stroke();
            const dir = len > 0 ? 1 : -1;
            ctx.beginPath();
            ctx.moveTo(bx + len, ay);
            ctx.lineTo(bx + len - 6 * dir, ay - 4);
            ctx.lineTo(bx + len - 6 * dir, ay + 4);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#f78166';
            ctx.textAlign = 'left';
            ctx.fillText('v', bx + len + (dir > 0 ? 4 : -14), ay + 3);
        }
        ctx.restore();
    }

    // —— 单摆示意
    function viewPendulum(card, ctx, W, H, P) {
        const sim = card.sim;
        const th = sim.state.th || 0;
        const L = sim.params.L || 1;
        const px = Math.min(H * 0.72 / 3, W / 3) * L;
        const cx = W * 0.5, cy = Math.max(18, H * 0.12);
        const bx = cx + Math.sin(th) * px;
        const by = cy + Math.cos(th) * px;
        ctx.save();
        // 参考竖线
        ctx.strokeStyle = P.border;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + px * 1.05); ctx.stroke();
        ctx.setLineDash([]);
        // 轨迹
        ctx.strokeStyle = P.accent;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        const tr = sim.trail;
        for (let i = 0; i < tr.length; i++) {
            const x = cx + tr[i][0] * px;
            const y = cy - tr[i][1] * px;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        // 摆杆 + 支点 + 摆球
        ctx.strokeStyle = P.sub;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(bx, by); ctx.stroke();
        ctx.fillStyle = P.muted;
        ctx.beginPath(); ctx.arc(cx, cy, 3.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = P.accent;
        ctx.beginPath(); ctx.arc(bx, by, 9, 0, Math.PI * 2); ctx.fill();
        // 角度弧
        ctx.strokeStyle = P.muted;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.min(34, px * 0.42), Math.PI / 2, Math.PI / 2 - th, th > 0);
        ctx.stroke();
        ctx.fillStyle = P.muted;
        ctx.font = '11px "Segoe UI",system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('θ = ' + fmt(th, 2) + ' rad', cx, cy + Math.min(56, px * 0.72));
        ctx.restore();
    }

    // —— 抛体轨迹（自动适配范围）
    function viewProjectile(card, ctx, W, H, P) {
        const sim = card.sim;
        const tr = sim.trail;
        let mnX = 0, mxX = 1, mnY = 0, mxY = 1;
        tr.forEach(function (p) {
            mnX = Math.min(mnX, p[0]); mxX = Math.max(mxX, p[0]);
            mnY = Math.min(mnY, p[1]); mxY = Math.max(mxY, p[1]);
        });
        mnX = Math.min(mnX, sim.state.x || 0); mxX = Math.max(mxX, sim.state.x || 0);
        mnY = Math.min(mnY, sim.state.y || 0); mxY = Math.max(mxY, sim.state.y || 0);
        card.rng = {
            x: fitRange(card.rng && card.rng.x, null, mnX, mxX),
            y: fitRange(card.rng && card.rng.y, null, mnY, mxY)
        };
        const padL = 34, padR = 30, padT = 16, padB = 24;
        const r = { x: padL, y: padT, w: W - padL - padR, h: H - padT - padB };
        const xr = makeScale(card.rng.x.min, card.rng.x.max, r.x, r.x + r.w);
        const yr = makeScale(card.rng.y.min, card.rng.y.max, r.y, r.y + r.h);
        const myX = function (v) { return xr.map(v); };
        const myY = function (v) { return r.y + r.h - (yr.map(v) - r.y); };
        ctx.save();
        // 地面
        ctx.strokeStyle = P.muted;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(r.x, myY(0)); ctx.lineTo(r.x + r.w, myY(0)); ctx.stroke();
        ctx.fillStyle = P.muted;
        ctx.font = '10px "Segoe UI",system-ui,sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('地面', r.x + 2, myY(0) + 12);
        ctx.fillText('x / m', r.x, r.y - 4);
        // 轨迹
        ctx.strokeStyle = P.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < tr.length; i++) {
            const px = myX(tr[i][0]), py = myY(tr[i][1]);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        // 当前位置 + 速度矢量
        const px = myX(sim.state.x || 0), py = myY(sim.state.y || 0);
        ctx.fillStyle = P.accent;
        ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
        const vscale = 3.2 * (r.w / (xr.max - xr.min)) / 12;
        const ax = px + (sim.state.vx || 0) * vscale;
        const ay = py - (sim.state.vy || 0) * vscale;
        ctx.strokeStyle = '#f78166';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ax, ay); ctx.stroke();
        ctx.fillStyle = '#f78166';
        ctx.beginPath(); ctx.arc(ax, ay, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    // —— 波的叠加
    function viewWave(card, ctx, W, H, P) {
        const p = card.sim.params, t = card.sim.t;
        const padL = 34, padR = 16, padT = 16, padB = 22;
        const r = { x: padL, y: padT, w: W - padL - padR, h: H - padT - padB };
        const amp = Math.max(0.6, p.A1 + p.A2);
        const yr = makeScale(-amp, amp, r.y, r.y + r.h);
        const myY = function (v) { return r.y + r.h - (yr.map(v) - r.y); };
        const X = 3.2;   // 显示 0..3.2 个长度单位
        const myX = function (v) { return r.x + (v / X) * r.w; };
        ctx.save();
        // 基线 + 零线
        ctx.strokeStyle = P.border;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(r.x, myY(0)); ctx.lineTo(r.x + r.w, myY(0)); ctx.stroke();
        const y1 = function (x) { return p.A1 * Math.sin(2 * Math.PI * p.f1 * (x - 0.6 * t)); };
        const y2 = function (x) { return p.A2 * Math.sin(2 * Math.PI * p.f2 * (x - 0.6 * t) + p.phi); };
        const N = 220;
        // 分波（细线）
        ctx.lineWidth = 1.2;
        ctx.globalAlpha = 0.5;
        [[y1, '#8b949e'], [y2, '#e3b341']].forEach(function (item) {
            ctx.strokeStyle = item[1];
            ctx.beginPath();
            for (let i = 0; i <= N; i++) {
                const x = (i / N) * X;
                const px = myX(x), py = myY(item[0](x));
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.stroke();
        });
        // 合成波（粗线）
        ctx.globalAlpha = 1;
        ctx.strokeStyle = P.accent;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        for (let i = 0; i <= N; i++) {
            const x = (i / N) * X;
            const px = myX(x), py = myY(y1(x) + y2(x));
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.fillStyle = P.muted;
        ctx.font = '10px "Segoe UI",system-ui,sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('位置 x →', r.x, r.y + r.h + 14);
        ctx.fillText('合成波（粗） + 两列分波（细）', r.x + 86, r.y + r.h + 14);
        ctx.restore();
    }

    function drawView(card, ctx, W, H, P) {
        const kind = card.sim.spec.view.kind;
        ctx.clearRect(0, 0, W, H);
        if (kind === 'spring') return viewSpring(card, ctx, W, H, P);
        if (kind === 'pendulum') return viewPendulum(card, ctx, W, H, P);
        if (kind === 'projectile') return viewProjectile(card, ctx, W, H, P);
        if (kind === 'wave') return viewWave(card, ctx, W, H, P);
        if (kind === 'phase') return viewPhase(card, ctx, W, H, P);
        if (kind === 'bars') return viewBars(card, ctx, W, H, P);
        return viewTime(card, ctx, W, H, P);
    }

    /* =========================================================
       7. 卡片 UI
       ========================================================= */
    function mk(tag, cls, text) {
        const el = global.document.createElement(tag);
        if (cls) el.className = cls;
        if (text != null) el.textContent = text;
        return el;
    }

    function numInput(val, min, max, step) {
        const el = global.document.createElement('input');
        el.type = 'range';
        el.min = String(min);
        el.max = String(max);
        el.step = String(step);
        el.value = String(val);
        return el;
    }

    function buildCard(root, spec) {
        const card = {
            root: root, spec: spec, sim: makeSim(spec), canvas: null, ctx: null,
            running: true, dirty: true, shots: [], rng: null, page: curPage(),
            rateVal: spec.rate.def, hud: spec.hud, lastAuto: 0, dead: false
        };
        root.innerHTML = '';

        // —— 头部
        const head = mk('div', 'sim-head');
        head.appendChild(mk('span', 'sim-title', spec.title || '互动模拟'));
        head.appendChild(mk('span', 'sim-badge', spec.badge || '模拟'));
        const note = mk('span', 'sim-note');
        head.appendChild(note);
        if (spec.warnings.length) {
            const w = mk('span', 'sim-warn', '⚠ ' + spec.warnings.length + ' 条提示');
            w.title = spec.warnings.join('\n');
            head.appendChild(w);
        }
        const clock = mk('span', 'sim-clock', 't = 0.00 s');
        head.appendChild(clock);
        root.appendChild(head);

        // —— 画面 + HUD
        const stage = mk('div', 'sim-stage');
        const ar = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(spec.ratio);
        stage.style.aspectRatio = ar ? (ar[1] + ' / ' + ar[2]) : '16 / 9';
        const canvas = global.document.createElement('canvas');
        canvas.className = 'sim-canvas';
        stage.appendChild(canvas);
        const hud = mk('div', 'sim-hud');
        hud.appendChild(mk('span', 'sim-chip', '加载中…'));
        stage.appendChild(hud);
        root.appendChild(stage);

        // —— 控制条
        const bar = mk('div', 'sim-bar');
        const runBtn = mk('button', 'sim-btn on', '⏸ 暂停');
        runBtn.type = 'button';
        runBtn.title = '开始 / 暂停（不影响宿主翻页热键）';
        runBtn.addEventListener('click', function () {
            const sim = card.sim;
            if (sim.finished) { sim.finished = false; sim.running = true; }
            else sim.running = !sim.running;
            syncRun(card);
        });
        const resetBtn = mk('button', 'sim-btn', '↺ 重置');
        resetBtn.type = 'button';
        resetBtn.title = '回到初始状态（参数保持不变）';
        resetBtn.addEventListener('click', function () {
            simReset(card.sim);
            card.shots = [];
            card.lastAuto = 0;
            card.dirty = true;
            syncRun(card);
            renderShots(card);
        });
        bar.appendChild(runBtn);
        bar.appendChild(resetBtn);

        const rateCtl = mk('span', 'sim-ctl');
        rateCtl.appendChild(mk('span', null, '时间'));
        const rate = numInput(spec.rate.def, spec.rate.min, spec.rate.max, niceStep(spec.rate.min, spec.rate.max));
        const rateVal = mk('b', null, fmt(spec.rate.def, 2) + '×');
        rate.addEventListener('input', function () {
            card.sim.rate = parseFloat(rate.value) || 1;
            rateVal.textContent = fmt(card.sim.rate, 2) + '×';
        });
        rateCtl.appendChild(rate);
        rateCtl.appendChild(rateVal);
        bar.appendChild(rateCtl);

        bar.appendChild(mk('span', 'sim-sp'));

        const shotBtn = mk('button', 'sim-btn', '📸 快照');
        shotBtn.type = 'button';
        shotBtn.title = '把当前画面定格到快照条，用于前后对比';
        shotBtn.addEventListener('click', function () { takeShot(card); });
        const pngBtn = mk('button', 'sim-btn', 'PNG');
        pngBtn.type = 'button';
        pngBtn.title = '导出当前画面为 PNG';
        pngBtn.addEventListener('click', function () { exportPNG(card); });
        const jsonBtn = mk('button', 'sim-btn', 'JSON');
        jsonBtn.type = 'button';
        jsonBtn.title = '导出当前参数与状态为 JSON';
        jsonBtn.addEventListener('click', function () { exportJSON(card); });
        const hudBtn = mk('button', 'sim-btn' + (spec.hud ? ' on' : ''), '投影');
        hudBtn.type = 'button';
        hudBtn.title = '切换画面上的投影读数（关闭 = 纯净画面）';
        hudBtn.addEventListener('click', function () {
            card.hud = !card.hud;
            root.classList.toggle('is-clean', !card.hud);
            hudBtn.classList.toggle('on', card.hud);
        });
        bar.appendChild(shotBtn);
        bar.appendChild(pngBtn);
        bar.appendChild(jsonBtn);
        bar.appendChild(hudBtn);
        root.appendChild(bar);

        // —— 参数滑块
        if (spec.params.length) {
            const box = mk('div', 'sim-params');
            spec.params.forEach(function (p) {
                const row = mk('label', 'sim-param');
                row.appendChild(mk('span', null, p.label || p.key));
                const inp = numInput(p.def, p.min, p.max, niceStep(p.min, p.max));
                const val = mk('b', null, fmt(p.def, 2));
                inp.addEventListener('input', function () {
                    const v = parseFloat(inp.value);
                    card.sim.params[p.key] = v;
                    val.textContent = fmt(v, 2);
                    card.dirty = true;
                });
                row.appendChild(inp);
                row.appendChild(val);
                box.appendChild(row);
            });
            root.appendChild(box);
        }

        // —— 快照条
        const shots = mk('div', 'sim-shots');
        root.appendChild(shots);

        if (spec.warnings.length) {
            const wb = mk('div', 'sim-warnbox', spec.warnings.join('\n'));
            root.appendChild(wb);
        }

        // —— 交互隔离 ----
        // 1) 卡片内的按键一律不冒泡给宿主（否则空格 / 方向键会翻页）；
        //    前提是焦点在卡片内 —— 所以 2) 按下任意控件时主动聚焦它，
        //    这样拖动滑块后就能用方向键微调，且按键不会漏到宿主。
        root.addEventListener('keydown', function (e) { e.stopPropagation(); });
        root.addEventListener('pointerdown', function (e) {
            const t = e.target;
            const tag = t && t.tagName;
            if ((tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT') && t.focus) {
                try { t.focus({ preventScroll: true }); } catch (err) { t.focus(); }
            }
        });

        card.canvas = canvas;
        card.ctx = canvas.getContext('2d');
        card.head = head;
        card.clock = clock;
        card.hudEl = hud;      // 注意：card.hud 是「是否显示投影读数」的布尔开关，与 DOM 分开
        card.note = note;
        card.runBtn = runBtn;
        card.rate = rate;
        card.rateVal = rateVal;
        card.shotsEl = shots;

        root.classList.toggle('is-clean', !card.hud);
        root.setAttribute(READY, '1');
        root.setAttribute('data-sim-hash', djb2(spec.title + '|' + spec.view.kind + '|' + spec.params.map(function (p) { return p.key; }).join(',')));
        return card;
    }

    // 同步「开始/暂停」按钮外观；保证卡片在驱动队列里并唤醒循环
    function syncRun(card) {
        const r = card.sim.running;
        card.runBtn.textContent = r ? '⏸ 暂停' : (card.sim.finished ? '↻ 重播' : '▶ 开始');
        card.runBtn.classList.toggle('on', r);
        card.dirty = true;
        if (cards.indexOf(card) < 0) cards.push(card);
        wake();
    }

    function takeShot(card) {
        if (!card.canvas || !card.canvas.width) return;
        const w = 236, h = Math.round(w * card.canvas.height / card.canvas.width);
        const c = global.document.createElement('canvas');
        c.width = w; c.height = h;
        const cx = c.getContext('2d');
        cx.fillStyle = palette(card.root).bg;
        cx.fillRect(0, 0, w, h);
        cx.drawImage(card.canvas, 0, 0, w, h);
        const shot = {
            url: c.toDataURL('image/png'),
            t: card.sim.t,
            params: Object.assign({}, card.sim.params),
            state: Object.assign({}, card.sim.state)
        };
        card.shots.push(shot);
        if (card.shots.length > 8) card.shots.shift();
        renderShots(card);
    }

    function renderShots(card) {
        const box = card.shotsEl;
        box.innerHTML = '';
        box.classList.toggle('has', card.shots.length > 0);
        card.shots.forEach(function (shot) {
            const d = mk('div', 'sim-shot');
            d.title = 't = ' + fmt(shot.t, 2) + ' s · 点击放大对比';
            const img = global.document.createElement('img');
            img.src = shot.url;
            img.alt = 't=' + fmt(shot.t, 1) + 's';
            d.appendChild(img);
            d.appendChild(mk('span', null, 't = ' + fmt(shot.t, 1) + ' s'));
            d.appendChild(mk('b', null, String(card.shots.indexOf(shot) + 1)));
            d.addEventListener('click', function () { openShot(card, shot); });
            box.appendChild(d);
        });
        if (card.shots.length) {
            const clr = mk('button', 'sim-btn', '清空快照');
            clr.type = 'button';
            clr.addEventListener('click', function () { card.shots = []; renderShots(card); });
            box.appendChild(clr);
        }
    }

    function openShot(card, shot) {
        const P = palette(card.root);
        const lb = mk('div', 'sim-lightbox');
        const img = global.document.createElement('img');
        img.src = shot.url;
        lb.appendChild(img);
        const meta = mk('div', 'lb-meta');
        const parts = ['t = ' + fmt(shot.t, 2) + ' s'];
        Object.keys(shot.params).forEach(function (k) {
            const p = card.spec.params.find(function (q) { return q.key === k; });
            parts.push((p && p.label ? p.label : k) + ' = ' + fmt(shot.params[k], 2));
        });
        Object.keys(shot.state).forEach(function (k) {
            parts.push(k + ' = ' + fmt(shot.state[k], 3));
        });
        meta.textContent = parts.join('　·　');
        lb.appendChild(meta);
        lb.appendChild(mk('div', 'lb-tip', '点击任意处或按 Esc 关闭'));

        function close() {
            global.document.removeEventListener('keydown', onKey, true);
            lb.remove();
            if (card.canvas && card.canvas.focus) card.canvas.focus();
        }
        function onKey(e) {
            e.stopPropagation();
            if (e.key === 'Escape') { e.preventDefault(); close(); }
        }
        lb.addEventListener('click', close);
        global.document.addEventListener('keydown', onKey, true);
        global.document.body.appendChild(lb);
    }

    function exportPNG(card) {
        if (!card.canvas) return;
        const c = global.document.createElement('canvas');
        c.width = card.canvas.width;
        c.height = card.canvas.height;
        const cx = c.getContext('2d');
        cx.fillStyle = palette(card.root).bg;
        cx.fillRect(0, 0, c.width, c.height);
        cx.drawImage(card.canvas, 0, 0);
        const name = safeName(card.spec.title || 'sim') + '-t' + fmt(card.sim.t, 1) + 's.png';
        download(name, c.toDataURL('image/png'));
    }

    function exportJSON(card) {
        const data = {
            plugin: 'mps-sim',
            version: '1.0',
            title: card.spec.title,
            model: card.spec.model || 'custom',
            view: card.spec.view.kind,
            t: Number(card.sim.t.toFixed(4)),
            rate: card.sim.rate,
            params: card.sim.params,
            state: card.sim.state,
            exportedAt: new Date().toISOString()
        };
        const name = safeName(card.spec.title || 'sim') + '-t' + fmt(card.sim.t, 1) + 's.json';
        download(name, 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2)));
    }

    /* =========================================================
       8. 绘制 / 驱动循环
       ========================================================= */
    let cards = [];
    let rafId = 0;
    let lastTs = 0;
    let ticking = false;
    let deps = {};
    let enabled = true;

    function curPage() {
        return deps.nav ? deps.nav.slide : -1;
    }

    function wake() {
        if (!enabled || ticking || rafId) return;
        lastTs = 0;
        rafId = global.requestAnimationFrame(tick);
    }

    function tick(ts) {
        rafId = 0;
        ticking = true;
        const now = ts || global.performance.now();
        let dt = lastTs ? (now - lastTs) / 1000 : 0;
        lastTs = now;
        if (global.document.hidden) dt = 0;
        dt = Math.max(0, Math.min(0.12, dt));

        for (let i = 0; i < cards.length; i++) {
            const card = cards[i];
            if (card.dead) continue;
            if (!card.root.isConnected) { card.dead = true; continue; }
            if (card.sim.running) simAdvance(card.sim, dt);
            // 自动快照（按模拟时间）
            if (card.spec.snapSec > 0 && card.sim.running) {
                if (card.lastAuto <= 0 || card.sim.t - card.lastAuto >= card.spec.snapSec) {
                    card.lastAuto = card.sim.t;
                    takeShot(card);
                }
            }
            if (card.sim.running || card.dirty) drawCard(card);
        }
        if (cards.some(function (c) { return c.dead; })) prune();
        ticking = false;
        if (cards.length && enabled) rafId = global.requestAnimationFrame(tick);
        else lastTs = 0;
    }

    function resizeCanvas(card) {
        const node = card.canvas;
        const rect = node.parentNode.getBoundingClientRect();
        const w = Math.max(60, Math.round(rect.width));
        const h = Math.max(48, Math.round(rect.height || (w * 9 / 16)));
        const dpr = Math.min(2, global.devicePixelRatio || 1);
        if (node.width !== Math.round(w * dpr) || node.height !== Math.round(h * dpr)) {
            node.width = Math.round(w * dpr);
            node.height = Math.round(h * dpr);
        }
        card.cssW = w;
        card.cssH = h;
        card.dpr = dpr;
        card.dirty = true;
    }

    function drawCard(card) {
        resizeCanvas(card);
        const ctx = card.ctx;
        ctx.setTransform(card.dpr, 0, 0, card.dpr, 0, 0);
        drawView(card, ctx, card.cssW, card.cssH, palette(card.root));
        card.dirty = false;
        // 时钟 / HUD / 按钮
        card.clock.textContent = 't = ' + fmt(card.sim.t, 2) + ' s' + (card.sim.finished ? ' · 已结束' : '');
        if (card.runBtn.classList.contains('on') !== card.sim.running) syncRun(card);
        // HUD 投影读数
        const names = card.spec.project.length ? card.spec.project : card.spec.states.slice(0, 2).map(function (s) { return s.name; });
        const sig = card.spec.view.kind + '|' + names.join(',');
        if (card.hudSig !== sig) {
            card.hudSig = sig;
            card.hudEl.innerHTML = '';
            names.forEach(function (n) {
                const chip = mk('span', 'sim-chip');
                chip.appendChild(mk('b', null, n));
                const v = mk('i', null, '—');
                chip.appendChild(v);
                chip.dataset.name = n;
                card.hudEl.appendChild(chip);
            });
        }
        const chips = card.hudEl.children;
        for (let i = 0; i < chips.length; i++) {
            const n = chips[i].dataset.name;
            const raw = card.sim.state[n] !== undefined ? card.sim.state[n] : card.sim.params[n];
            chips[i].lastChild.textContent = fmt(raw, 2);
        }
    }

    /* =========================================================
       9. 会话（按页登记 + 参数继承）
       ========================================================= */
    const session = {
        pages: {},          // page -> { cards: [], links: [] }
        pending: {},        // targetPage -> payload（首次访问目标页时消费）
        visited: {},        // page -> 已访问
        lastPage: -1
    };

    function pageBucket(page, kind) {
        const key = String(page);
        if (!session.pages[key]) session.pages[key] = { cards: [], links: [] };
        return session.pages[key][kind];
    }

    // 宿主换文档 / 重渲染后，旧卡片与旧链接会脱离 DOM；
    // 这里把它们清出注册表并按页面重建索引，避免状态虚高与画已死的卡
    function prune() {
        const liveCards = [];
        for (let i = 0; i < cards.length; i++) {
            const c = cards[i];
            if (c.dead || !c.root.isConnected) {
                c.dead = true;
                if (c.noteTimer) clearTimeout(c.noteTimer);
            } else liveCards.push(c);
        }
        const liveLinks = [];
        Object.keys(session.pages).forEach(function (k) {
            session.pages[k].links.forEach(function (l) {
                if (l.root.isConnected) liveLinks.push(l);
                else {
                    disarmLink(l);
                    if (l.doneTimer) { clearInterval(l.doneTimer); l.doneTimer = 0; }
                }
            });
        });
        const changed = liveCards.length !== cards.length ||
            liveLinks.length !== Object.keys(session.pages).reduce(function (n, k) {
                return n + session.pages[k].links.length;
            }, 0);
        cards = liveCards;
        if (!changed) return;
        session.pages = {};
        cards.forEach(function (c) { pageBucket(c.page, 'cards').push(c); });
        liveLinks.forEach(function (l) { pageBucket(l.page, 'links').push(l); });
    }

    // 离开某页时捕获该页所有模拟卡的「实时设置」（供首次访问继承）
    function capturePage(page) {
        const list = pageBucket(page, 'cards');
        if (!list.length) return null;
        return list.map(function (card) {
            return {
                title: card.spec.title,
                params: Object.assign({}, card.sim.params),
                rate: card.sim.rate,
                hud: card.hud
            };
        });
    }

    function applyInherit(page, payload) {
        const list = pageBucket(page, 'cards');
        if (!list.length || !payload || !payload.length) return 0;
        let n = 0;
        list.forEach(function (card, i) {
            let from = payload.find(function (p) { return p.title && p.title === card.spec.title; });
            if (!from) from = payload[i] || payload[0];
            if (!from) return;
            let changed = false;
            Object.keys(from.params).forEach(function (k) {
                if (card.sim.params[k] !== undefined && card.sim.params[k] !== from.params[k]) {
                    card.sim.params[k] = from.params[k];
                    changed = true;
                    // 同步滑块显示
                    const inputs = card.root.querySelectorAll('.sim-params .sim-param');
                    const pid = card.spec.params.findIndex(function (q) { return q.key === k; });
                    if (pid >= 0 && inputs[pid]) {
                        const inp = inputs[pid].querySelector('input');
                        const val = inputs[pid].querySelector('b');
                        if (inp) inp.value = String(from.params[k]);
                        if (val) val.textContent = fmt(from.params[k], 2);
                    }
                }
            });
            if (from.rate && card.rate) {
                card.sim.rate = from.rate;
                card.rate.value = String(from.rate);
                card.rateVal.textContent = fmt(from.rate, 2) + '×';
                changed = true;
            }
            if (typeof from.hud === 'boolean') {
                card.hud = from.hud;
                card.root.classList.toggle('is-clean', !card.hud);
            }
            if (changed) {
                card.dirty = true;
                noteOnCard(card, '已继承上一页参数');
                n++;
            }
        });
        return n;
    }

    function noteOnCard(card, text) {
        if (!card.note) return;
        card.note.textContent = '· ' + text;
        card.note.classList.add('on');
        if (card.noteTimer) clearTimeout(card.noteTimer);
        card.noteTimer = setTimeout(function () { card.note.classList.remove('on'); }, 4200);
    }

    /* =========================================================
       10. 链接序列（sim-link）
       ========================================================= */
    function parseLink(content) {
        const rule = { next: 0, after: 0, done: false, inherit: false, label: '', warnings: [] };
        String(content == null ? '' : content).replace(/\r\n?/g, '\n').split('\n').forEach(function (raw, li) {
            const line = raw.trim();
            if (!line || line.charAt(0) === '#') return;
            const sp = line.search(/\s/);
            const key = (sp < 0 ? line : line.slice(0, sp)).toLowerCase();
            const rest = sp < 0 ? '' : line.slice(sp + 1).trim();
            if (key === 'next') { rule.next = Math.max(0, parseInt(rest, 10) || 0); return; }
            if (key === 'after') { rule.after = Math.max(0, parseFloat(rest) || 0); return; }
            if (key === 'done') { rule.done = true; return; }
            if (key === 'inherit') { rule.inherit = true; return; }
            if (key === 'label') { rule.label = rest; return; }
            rule.warnings.push('第 ' + (li + 1) + ' 行：未知指令 ' + key);
        });
        return rule;
    }

    function linkText(rule) {
        const parts = [];
        parts.push(rule.next > 0 ? '下一站 <b>第 ' + rule.next + ' 页</b>' : '下一站 <b>下一页</b>');
        if (rule.after > 0) parts.push('停留 ' + fmt(rule.after, 0) + ' 秒后自动前进');
        if (rule.done) parts.push('主模拟结束后自动前进');
        if (rule.inherit) parts.push('首次进入时继承本页参数');
        return parts.join(' · ');
    }

    function buildLink(root, rule) {
        const link = {
            root: root, rule: rule, page: curPage(), armed: false,
            timer: 0, deadline: 0, fired: false, go: null, textEl: null
        };
        root.innerHTML = '';
        root.appendChild(mk('span', 'sim-link-icon', '🔗'));
        const text = mk('span', 'sim-link-text');
        text.innerHTML = '<b>链接序列</b> · ' + linkText(rule) +
            (!deps.nav ? '（宿主未提供导航能力，无法自动翻页）' : '');
        if (rule.warnings.length) text.title = rule.warnings.join('\n');
        root.appendChild(text);
        const go = mk('button', 'sim-link-go', rule.label || '立即前往');
        go.type = 'button';
        go.disabled = !deps.nav;
        go.addEventListener('click', function () { advance(link, true); });
        root.appendChild(go);
        link.go = go;
        link.textEl = text;
        root.addEventListener('keydown', function (e) { e.stopPropagation(); });
        root.setAttribute(READY, '1');
        return link;
    }

    // 触发前进：next 指定页 → 精确跳页；未指定 → 下一页
    function advance(link, manual) {
        if (!deps.nav) return false;
        if (link.fired && !manual) return false;
        link.fired = true;
        if (link.rule.inherit) {
            const payload = capturePage(link.page);
            if (payload) session.pending[link.rule.next > 0 ? link.rule.next - 1 : link.page + 1] = payload;
        }
        if (link.rule.next > 0) deps.nav.goto(link.rule.next - 1);
        else deps.nav.next();
        return true;
    }

    function armLink(link) {
        link.fired = false;
        link.armed = true;
        link.root.classList.add('armed');
        link.go.disabled = false;
        if (link.rule.after > 0) {
            link.deadline = Date.now() + link.rule.after * 1000;
            if (link.timer) clearInterval(link.timer);
            link.timer = setInterval(function () {
                if (!link.root.isConnected) { disarmLink(link); return; }
                const left = (link.deadline - Date.now()) / 1000;
                if (left <= 0) {
                    if (advance(link, false)) flash(link, '⏱ 时间到，已自动前进');
                    disarmLink(link);
                    return;
                }
                updateCount(link, left);
            }, 200);
            updateCount(link, link.rule.after);
        }
        if (link.rule.done) watchDone(link);
    }

    function updateCount(link, left) {
        const c = link.textEl.querySelector('.sim-count');
        const txt = '⏱ ' + left.toFixed(1) + ' 秒后自动前进';
        if (c) c.textContent = txt;
        else {
            const s = mk('span', 'sim-count', txt);
            link.textEl.appendChild(s);
        }
    }

    function flash(link, msg) {
        try { console.log('[mps-sim] ' + msg); } catch (e) { /* 忽略 */ }
    }

    function disarmLink(link) {
        link.armed = false;
        link.root.classList.remove('armed');
        if (link.timer) { clearInterval(link.timer); link.timer = 0; }
        const c = link.textEl && link.textEl.querySelector('.sim-count');
        if (c) c.remove();
    }

    function watchDone(link) {
        if (link.doneTimer) clearInterval(link.doneTimer);
        link.doneTimer = setInterval(function () {
            if (!link.root.isConnected) { disarmLink(link); clearInterval(link.doneTimer); link.doneTimer = 0; return; }
            const list = pageBucket(link.page, 'cards');
            const fin = list.some(function (c) { return c.sim.finished; });
            if (fin && !link.fired) {
                advance(link, false);
                disarmLink(link);
                clearInterval(link.doneTimer);
                link.doneTimer = 0;
            }
        }, 300);
        link.doneWatcher = true;
    }

    function onSlideChanged(ev) {
        prune();
        const page = ev.slide;
        const prev = session.lastPage;
        // 「首次访问继承」：只有第一次进入目标页才消费继承来的参数
        const firstVisit = !session.visited[page];
        session.lastPage = page;
        session.visited[page] = true;

        // 1) 离开上一页：清除该页链接的计时；若有 inherit，捕获参数留给目标页
        (session.pages[String(prev)] ? session.pages[String(prev)].links : []).forEach(function (link) {
            if (link.rule.inherit && prev >= 0 && !link.fired) {
                const payload = capturePage(prev);
                if (payload) session.pending[link.rule.next > 0 ? link.rule.next - 1 : prev + 1] = payload;
            }
            disarmLink(link);
            if (link.doneTimer) { clearInterval(link.doneTimer); link.doneTimer = 0; }
        });

        // 2) 到达新页：武装该页链接；消费继承
        (session.pages[String(page)] ? session.pages[String(page)].links : []).forEach(function (link) {
            if (!deps.nav) return;
            armLink(link);
        });
        const payload = session.pending[String(page)];
        if (payload) {
            delete session.pending[String(page)];
            if (firstVisit) {
                const n = applyInherit(page, payload);
                if (n) flash(null, '已向第 ' + (page + 1) + ' 页的 ' + n + ' 个模拟卡继承参数');
            }
        }
    }

    /* =========================================================
       11. 扫描与初始化
       ========================================================= */
    function initSimsIn(el) {
        el.querySelectorAll('.mps-sim[data-spec]:not([' + READY + '])').forEach(function (root) {
            let spec;
            try {
                spec = parseSim(decodeURIComponent(root.getAttribute('data-spec') || ''));
            } catch (e) {
                root.innerHTML = '<div class="sim-warnbox">模拟无法启动：' + String(e.message) + '\n（修正后重新编辑代码块即可）</div>';
                root.setAttribute(READY, '1');
                return;
            }
            let card;
            try {
                card = buildCard(root, spec);
            } catch (e) {
                root.innerHTML = '<div class="sim-warnbox">模拟无法启动：' + String(e.message) + '</div>';
                root.setAttribute(READY, '1');
                return;
            }
            cards.push(card);
            pageBucket(card.page, 'cards').push(card);
            renderShots(card);
            resizeCanvas(card);
            card.dirty = true;
            wake();
        });
    }

    function initLinksIn(el) {
        el.querySelectorAll('.sim-link[data-spec]:not([' + READY + '])').forEach(function (root) {
            let rule;
            try { rule = parseLink(decodeURIComponent(root.getAttribute('data-spec') || '')); }
            catch (e) { root.textContent = '链接序列解析失败：' + e.message; root.setAttribute(READY, '1'); return; }
            const link = buildLink(root, rule);
            pageBucket(link.page, 'links').push(link);
            if (link.page === session.lastPage) armLink(link);
        });
    }

    /* =========================================================
       12. 公开 API
       ========================================================= */
    function status() {
        prune();
        const page = curPage();
        const all = cards;
        const here = all.filter(function (c) { return c.page === page; });
        const run = here.filter(function (c) { return c.sim.running; }).length;
        if (!all.length) return '互动模拟：本页没有模拟卡';
        return '互动模拟：本页 ' + here.length + ' 个模拟（' + run + ' 个运行中） · 全卷 ' + all.length + ' 个' +
            (deps.nav ? ' · 第 ' + (page + 1) + '/' + deps.nav.total + ' 页' : '');
    }

    global.MPSSim = {
        CSS: CSS,
        configure: function (opts) {
            deps = opts || {};
            if (deps.nav !== undefined && deps.nav) {
                // 首次拿到导航能力时补一次位置广播
                session.lastPage = deps.nav.slide;
            }
            return global.MPSSim;
        },
        renderSim: function (content) {
            return '<div class="mps-sim" data-spec="' + encodeURIComponent(content || '') + '">' +
                '<div class="sim-empty">模拟加载中…</div></div>';
        },
        renderLink: function (content) {
            return '<div class="sim-link" data-spec="' + encodeURIComponent(content || '') + '">' +
                '<span class="sim-link-icon">🔗</span><span class="sim-link-text">链接序列加载中…</span></div>';
        },
        initIn: function (el) {
            initSimsIn(el);
            initLinksIn(el);
        },
        onSlideChanged: onSlideChanged,
        status: status,
        resetPage: function () {
            prune();
            const page = curPage();
            let n = 0;
            cards.forEach(function (c) {
                if (c.page === page) { simReset(c.sim); c.shots = []; c.lastAuto = 0; renderShots(c); c.dirty = true; syncRun(c); n++; }
            });
            return n;
        },
        pausePage: function (pause) {
            prune();
            const page = curPage();
            let n = 0;
            cards.forEach(function (c) {
                if (c.page === page) {
                    c.sim.running = pause === undefined ? !c.sim.running : !!pause;
                    if (!c.sim.running) c.sim.finished = false;
                    syncRun(c);
                    n++;
                }
            });
            wake();
            return n;
        },
        prune: prune,
        cards: function () { prune(); return cards.slice(); },
        pageOf: function (card) { return card.page; },
        modelList: function () { return Object.keys(MODELS).map(function (k) { return { id: k, name: MODELS[k].name }; }); },
        setEnabled: function (on) {
            enabled = !!on;
            if (!enabled) {
                cancelAnimationFrame(rafId);
                rafId = 0;
                lastTs = 0;
            } else wake();
        },
        shutdown: function () {
            enabled = false;
            if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
            cards.forEach(function (c) {
                if (c.noteTimer) clearTimeout(c.noteTimer);
            });
            cards = [];
            Object.keys(session.pages).forEach(function (k) {
                session.pages[k].links.forEach(function (link) {
                    disarmLink(link);
                    if (link.doneTimer) { clearInterval(link.doneTimer); link.doneTimer = 0; }
                });
            });
            session.pages = {};
            session.pending = {};
            session.visited = {};
            session.lastPage = -1;
        }
    };
})(window);