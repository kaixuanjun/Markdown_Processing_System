/*!
 * MPS 纳米模式 v1.0（id: mps-sim）· 运行时
 * -----------------------------------------------------------------------------
 * ```nano 代码块 → 纳米绘图卡（参考 Nano Interactive Slides 的 Nano Mode）：
 *   - 风格主题 / 种子 / 提示词，可现场「重新生成」；同一组输入结果确定且命中缓存
 *   - 内置确定性占位生成器：纯 Canvas 程序化抽象画，离线可用（无外部依赖）
 *   - 可插拔真实 AI 绘图服务：定义 window.MPSNano.generateImage = async (req) => dataUrl
 *     （req = { style, seed, prompt, width, height, hash }），失败时自动回退内置
 * ========================================================================== */
(function (global) {
    'use strict';
    if (global.MPSNano) return;

    const READY = 'data-mps-ready';

    /* =========================================================
       0. 样式
       ========================================================= */
    const CSS = [
        '.mps-nano{position:relative;margin:.85em auto;border:1px solid var(--border-light,#e1e4e8);',
        'border-radius:12px;overflow:hidden;background:var(--bg-panel,#fff);max-width:100%;}',
        '.mps-nano .nano-head{display:flex;align-items:center;gap:8px;padding:7px 11px;',
        'border-bottom:1px solid var(--border-light,#e1e4e8);background:var(--code-bg,#f6f8fa);}',
        '.mps-nano .nano-title{font-weight:600;color:var(--text-primary,#1f2328);}',
        '.mps-nano .nano-badge{font-size:11px;color:var(--text-muted,#8b949e);border:1px solid currentColor;',
        'border-radius:20px;padding:1px 8px;white-space:nowrap;}',
        '.mps-nano .nano-meta{margin-left:auto;font-size:11px;color:var(--text-muted,#8b949e);',
        'font-variant-numeric:tabular-nums;white-space:nowrap;}',
        '.mps-nano .nano-stage{position:relative;width:100%;background:var(--code-bg,#f6f8fa);}',
        '.mps-nano .nano-canvas{display:block;width:100%;height:100%;}',
        '.mps-nano .nano-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
        'font-size:12px;color:var(--text-muted,#8b949e);background:rgba(127,127,127,.08);}',
        '.mps-nano .nano-bar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:7px 9px;',
        'border-top:1px solid var(--border-light,#e1e4e8);background:var(--code-bg,#f6f8fa);}',
        '.mps-nano .nano-bar label{display:inline-flex;align-items:center;gap:4px;font-size:11px;',
        'color:var(--text-secondary,#57606a);}',
        '.mps-nano .nano-bar select,.mps-nano .nano-bar input{border:1px solid var(--border-color,#d0d7de);',
        'background:var(--bg-panel,#fff);color:inherit;border-radius:6px;height:24px;padding:0 6px;',
        'font-size:12px;font-family:inherit;max-width:170px;}',
        '.mps-nano .nano-bar input[type=number]{width:76px;}',
        '.mps-nano .nano-bar input[type=text]{flex:1;min-width:110px;}',
        '.mps-nano .nano-btn{border:1px solid var(--border-color,#d0d7de);background:var(--bg-panel,#fff);',
        'color:inherit;border-radius:6px;height:24px;padding:0 9px;cursor:pointer;font-size:12px;',
        'line-height:1;display:inline-flex;align-items:center;gap:4px;font-family:inherit;}',
        '.mps-nano .nano-btn:hover{background:var(--hover-bg,#f3f4f6);border-color:var(--text-muted,#8b949e);}',
        '.mps-nano .nano-btn[disabled]{opacity:.45;cursor:not-allowed;}',
        '.mps-nano .nano-sp{flex:1;}',
        '.mps-nano .nano-warn{padding:7px 11px;font-size:12px;color:#d29922;background:rgba(210,153,34,.08);',
        'border-top:1px solid rgba(210,153,34,.25);white-space:pre-wrap;}'
    ].join('');

    /* =========================================================
       1. 工具 + 简易 PRNG
       ========================================================= */
    function djb2(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
        return h.toString(36);
    }

    function mulberry32(a) {
        return function () {
            a |= 0;
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function mk(tag, cls, text) {
        const el = global.document.createElement(tag);
        if (cls) el.className = cls;
        if (text != null) el.textContent = text;
        return el;
    }

    function safeName(s) {
        return String(s || 'nano').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
    }

    /* =========================================================
       2. 内置确定性生成器（按风格哈希出图）
       ========================================================= */
    const STYLES = {
        '极简线条': { kind: 'minimal', bg: ['#f7f5f0', '#eceadf'], palette: ['#1f2328', '#8b949e', '#b9b2a5'] },
        '渐变流体': { kind: 'fluid', bg: ['#0e1b2a', '#123a4d'], palette: ['#2ec5ff', '#7b61ff', '#ff5da2', '#39d98a'] },
        '赛博霓虹': { kind: 'neon', bg: ['#0b1020', '#161d3a'], palette: ['#00e5ff', '#ff2e88', '#7cf5a0', '#ffd166'] },
        '星空': { kind: 'stars', bg: ['#05070f', '#101a38'], palette: ['#ffffff', '#9db4ff', '#ffd9a0', '#7be0ff'] },
        '水墨': { kind: 'ink', bg: ['#f6f3ec', '#efe9dc'], palette: ['#2b2b2b', '#5a5a5a', '#8d9096'] },
        '蒙德里安': { kind: 'mondrian', bg: ['#f4f1e8'], palette: ['#d62828', '#f0b429', '#1d3fbb', '#141414'] },
        '几何拼贴': { kind: 'collage', bg: ['#fdf6e3', '#e9f2ff'], palette: ['#ff6b6b', '#4dabf7', '#ffd43b', '#51cf66', '#845ef7'] },
        '手绘素描': { kind: 'sketch', bg: ['#fbfaf7'], palette: ['#333333', '#6b6b6b', '#a9a9a9'] }
    };
    const STYLE_NAMES = Object.keys(STYLES);

    function drawBuiltin(canvas, styleName, seed, prompt) {
        const st = STYLES[styleName] || STYLES['极简线条'];
        const W = canvas.width, H = canvas.height;
        const ctx = canvas.getContext('2d');
        const rnd = mulberry32(((seed | 0) >>> 0) ^ parseInt(djb2(styleName + '|' + prompt), 36));
        const pick = function (arr) { return arr[Math.floor(rnd() * arr.length) % arr.length]; };
        const rr = function (a, b) { return a + rnd() * (b - a); };

        // 背景
        const g = ctx.createLinearGradient(rr(0, W), 0, W, H);
        g.addColorStop(0, st.bg[0]);
        g.addColorStop(1, st.bg[1] || st.bg[0]);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        const ink = st.palette[0];
        let i, n;

        if (st.kind === 'minimal') {
            ctx.strokeStyle = ink;
            ctx.globalAlpha = 0.85;
            n = 5 + Math.floor(rnd() * 5);
            for (i = 0; i < n; i++) {
                ctx.lineWidth = rr(1, 3.2) * (W / 600);
                ctx.beginPath();
                const x0 = rr(0.05, 0.95) * W, y0 = rr(0.05, 0.95) * H;
                const len = rr(0.1, 0.6) * W;
                const ang = Math.floor(rnd() * 4) * Math.PI / 2 + rr(-0.2, 0.2);
                ctx.moveTo(x0, y0);
                ctx.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
                ctx.stroke();
            }
            ctx.globalAlpha = 0.55;
            n = 2 + Math.floor(rnd() * 3);
            for (i = 0; i < n; i++) {
                ctx.beginPath();
                ctx.arc(rr(0.15, 0.85) * W, rr(0.15, 0.85) * H, rr(0.04, 0.13) * Math.min(W, H), 0, Math.PI * 2);
                ctx.fillStyle = pick(st.palette);
                ctx.fill();
            }
        } else if (st.kind === 'fluid') {
            n = 7 + Math.floor(rnd() * 6);
            for (i = 0; i < n; i++) {
                const cx = rr(0, W), cy = rr(0, H), r = rr(0.12, 0.42) * Math.max(W, H);
                const rg = ctx.createRadialGradient(cx, cy, r * 0.05, cx, cy, r);
                const c = pick(st.palette);
                rg.addColorStop(0, c);
                rg.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.globalAlpha = rr(0.35, 0.75);
                ctx.fillStyle = rg;
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (st.kind === 'neon') {
            ctx.globalCompositeOperation = 'lighter';
            n = 6 + Math.floor(rnd() * 6);
            for (i = 0; i < n; i++) {
                const c = pick(st.palette);
                ctx.strokeStyle = c;
                ctx.shadowColor = c;
                ctx.shadowBlur = rr(8, 26) * (W / 600);
                ctx.lineWidth = rr(1.4, 4) * (W / 600);
                ctx.globalAlpha = rr(0.5, 0.95);
                ctx.beginPath();
                const x0 = rr(0.05, 0.9) * W, y0 = rr(0.05, 0.9) * H;
                if (rnd() < 0.5) {
                    ctx.moveTo(x0, y0);
                    ctx.lineTo(x0 + rr(-0.5, 0.5) * W, y0 + rr(-0.5, 0.5) * H);
                } else {
                    ctx.arc(x0, y0, rr(0.05, 0.24) * Math.min(W, H), 0, Math.PI * (1 + rnd()));
                }
                ctx.stroke();
            }
            ctx.shadowBlur = 0;
            ctx.globalCompositeOperation = 'source-over';
        } else if (st.kind === 'stars') {
            n = 90 + Math.floor(rnd() * 80);
            for (i = 0; i < n; i++) {
                const s = rr(0.4, 2.2) * (W / 600);
                ctx.globalAlpha = rr(0.25, 1);
                ctx.fillStyle = pick(st.palette);
                ctx.beginPath();
                ctx.arc(rr(0, W), rr(0, H * 0.94), s, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 0.5;
            for (i = 0; i < 3; i++) {
                const cx = rr(0, W), cy = rr(0, H), r = rr(0.2, 0.5) * Math.max(W, H);
                const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
                const c = pick(st.palette);
                rg.addColorStop(0, c);
                rg.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = rg;
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (st.kind === 'ink') {
            n = 5 + Math.floor(rnd() * 5);
            for (i = 0; i < n; i++) {
                ctx.globalAlpha = rr(0.14, 0.42);
                ctx.fillStyle = pick(st.palette);
                ctx.beginPath();
                const cx = rr(0.1, 0.9) * W, cy = rr(0.1, 0.9) * H;
                const r = rr(0.08, 0.3) * Math.min(W, H);
                ctx.moveTo(cx + r, cy);
                for (let a = 0; a < Math.PI * 2; a += 0.35) {
                    const rad = r * rr(0.55, 1.4);
                    ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
                }
                ctx.closePath();
                ctx.fill();
            }
            ctx.globalAlpha = 0.75;
            ctx.strokeStyle = pick(st.palette);
            ctx.lineWidth = rr(1, 3) * (W / 600);
            ctx.beginPath();
            ctx.moveTo(rr(0.1, 0.3) * W, rr(0.5, 0.9) * H);
            ctx.bezierCurveTo(W * 0.4, rr(0.1, 0.5) * H, W * 0.6, rr(0.5, 0.9) * H, W * 0.9, rr(0.2, 0.6) * H);
            ctx.stroke();
        } else if (st.kind === 'mondrian') {
            const cols = 4 + Math.floor(rnd() * 3), rows = 3 + Math.floor(rnd() * 3);
            const xs = [0], ys = [0];
            for (i = 1; i < cols; i++) xs.push(rr(0.12, 0.88));
            for (i = 1; i < rows; i++) ys.push(rr(0.12, 0.88));
            xs.push(1); ys.push(1);
            xs.sort(function (a, b) { return a - b; });
            ys.sort(function (a, b) { return a - b; });
            for (let xi = 0; xi < xs.length - 1; xi++) {
                for (let yi = 0; yi < ys.length - 1; yi++) {
                    if (rnd() < 0.42) {
                        ctx.fillStyle = pick(st.palette.slice(0, 3));
                        ctx.fillRect(xs[xi] * W, ys[yi] * H, (xs[xi + 1] - xs[xi]) * W, (ys[yi + 1] - ys[yi]) * H);
                    }
                }
            }
            ctx.strokeStyle = st.palette[3];
            ctx.lineWidth = Math.max(3, 5 * (W / 600));
            xs.forEach(function (x) { ctx.beginPath(); ctx.moveTo(x * W, 0); ctx.lineTo(x * W, H); ctx.stroke(); });
            ys.forEach(function (y) { ctx.beginPath(); ctx.moveTo(0, y * H); ctx.lineTo(W, y * H); ctx.stroke(); });
        } else if (st.kind === 'collage') {
            n = 9 + Math.floor(rnd() * 8);
            for (i = 0; i < n; i++) {
                ctx.globalAlpha = rr(0.6, 0.95);
                ctx.fillStyle = pick(st.palette);
                const cx = rr(0.05, 0.95) * W, cy = rr(0.05, 0.95) * H;
                const size = rr(0.08, 0.3) * Math.min(W, H);
                const kind = Math.floor(rnd() * 3);
                if (kind === 0) {
                    ctx.beginPath();
                    ctx.moveTo(cx, cy - size);
                    ctx.lineTo(cx + size, cy + size * 0.7);
                    ctx.lineTo(cx - size, cy + size * 0.7);
                    ctx.closePath();
                    ctx.fill();
                } else if (kind === 1) {
                    ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
                } else {
                    ctx.beginPath();
                    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.globalAlpha = 0.25;
            ctx.strokeStyle = '#1f2328';
            ctx.lineWidth = 1.5;
            for (i = 0; i < 14; i++) {
                ctx.beginPath();
                ctx.moveTo(rr(0, W), rr(0, H));
                ctx.lineTo(rr(0, W), rr(0, H));
                ctx.stroke();
            }
        } else {   // sketch
            ctx.strokeStyle = ink;
            ctx.lineCap = 'round';
            n = 16 + Math.floor(rnd() * 12);
            for (i = 0; i < n; i++) {
                ctx.globalAlpha = rr(0.25, 0.7);
                ctx.lineWidth = rr(0.6, 2) * (W / 600);
                const x0 = rr(0.08, 0.92) * W, y0 = rr(0.08, 0.92) * H;
                const len = rr(0.06, 0.34) * W;
                const ang = rr(0, Math.PI * 2);
                for (let j = 0; j < 3; j++) {   // 同一条线画三次 → 素描的毛感
                    ctx.beginPath();
                    ctx.moveTo(x0 + rr(-3, 3), y0 + rr(-3, 3));
                    ctx.lineTo(
                        x0 + Math.cos(ang) * len + rr(-4, 4),
                        y0 + Math.sin(ang) * len + rr(-4, 4)
                    );
                    ctx.stroke();
                }
            }
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }

    /* =========================================================
       3. 缓存（按「风格|种子|提示词|第几版」哈希）
       ========================================================= */
    const cache = new Map();
    const CACHE_MAX = 24;

    function cacheKey(style, seed, prompt, rev) {
        return djb2(style + '|' + seed + '|' + prompt + '|' + rev);
    }

    function cachePut(key, url) {
        if (cache.size >= CACHE_MAX) {
            const first = cache.keys().next().value;
            cache.delete(first);
        }
        cache.set(key, url);
    }

    /* =========================================================
       4. DSL 解析
       ========================================================= */
    function parseNano(content) {
        const spec = {
            title: '', ratio: '1:1', style: STYLE_NAMES[2], seed: 42, prompt: '',
            warnings: []
        };
        String(content == null ? '' : content).replace(/\r\n?/g, '\n').split('\n').forEach(function (raw, li) {
            const line = raw.trim();
            if (!line || line.charAt(0) === '#') return;
            const sp = line.search(/\s/);
            const key = (sp < 0 ? line : line.slice(0, sp)).toLowerCase();
            const rest = sp < 0 ? '' : line.slice(sp + 1).trim();
            if (key === 'title') { spec.title = rest; return; }
            if (key === 'ratio') { spec.ratio = rest; return; }
            if (key === 'style') { spec.style = rest; return; }
            if (key === 'seed') { spec.seed = parseInt(rest, 10) || 0; return; }
            if (key === 'prompt') { spec.prompt = rest; return; }
            spec.warnings.push('第 ' + (li + 1) + ' 行：未知指令 ' + key);
        });
        if (!STYLES[spec.style]) {
            spec.warnings.push('未知风格「' + spec.style + '」，已用「' + STYLE_NAMES[2] + '」（可用：' + STYLE_NAMES.join(' / ') + '）');
            spec.style = STYLE_NAMES[2];
        }
        return spec;
    }

    /* =========================================================
       5. 卡片
       ========================================================= */
    let cards = [];
    let deps = {};
    let enabled = true;
    let seq = 0;

    function curPage() {
        return deps.nav ? deps.nav.slide : -1;
    }

    function hook() {
        return typeof global.MPSNano.generateImage === 'function' ? global.MPSNano.generateImage : null;
    }

    function loadImage(url) {
        return new Promise(function (resolve, reject) {
            const img = new global.Image();
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('图片加载失败')); };
            img.src = url;
        });
    }

    // 生成：优先自定义接口，失败回退内置；结果写入 canvas 并返回 dataURL
    function generate(card) {
        const spec = card.spec;
        const c = card.canvas;
        const W = c.width, H = c.height;
        const key = cacheKey(spec.style, spec.seed, spec.prompt, card.rev);
        card.meta.textContent = '生成中…';
        const t0 = Date.now();

        if (cache.has(key)) {
            return loadImage(cache.get(key)).then(function (img) {
                const cx = c.getContext('2d');
                cx.clearRect(0, 0, W, H);
                cx.drawImage(img, 0, 0, W, H);
                card.meta.textContent = '风格哈希 ' + key + ' · 缓存命中 · ' + (Date.now() - t0) + ' ms';
                card.loading.style.display = 'none';
            }).catch(function () { cache.delete(key); return generate(card); });
        }

        const my = ++seq;
        card.revToken = my;
        const custom = hook();
        const run = custom ? Promise.resolve().then(function () {
            return custom({
                style: spec.style, seed: spec.seed, prompt: spec.prompt,
                width: W, height: H, hash: key
            });
        }).then(function (res) {
            const url = typeof res === 'string' ? res
                : res && (res.dataUrl || res.dataURL || res.url) ? (res.dataUrl || res.dataURL || res.url) : null;
            if (!url) throw new Error('接口未返回图片（应为 dataURL 字符串或 { dataUrl }）');
            return loadImage(url);
        }) : Promise.reject(new Error('未接入自定义接口'));

        return run.then(function (img) {
            if (card.revToken !== my) return;          // 期间又触发了新生成
            return paint(img, '自定义接口');
        }).catch(function (e) {
            if (card.revToken !== my) return;
            drawBuiltin(c, spec.style, spec.seed, spec.prompt);
            const why = custom ? '自定义接口不可用（' + e.message + '），已用内置占位生成器' : '内置占位生成器（未接入 AI 接口）';
            card.meta.textContent = '风格哈希 ' + key + ' · ' + (Date.now() - t0) + ' ms · ' + why;
            card.loading.style.display = 'none';
            cachePut(key, c.toDataURL('image/png'));
        });

        function paint(img, who) {
            const cx = c.getContext('2d');
            cx.clearRect(0, 0, W, H);
            const sc = Math.max(W / img.width, H / img.height);
            const w = img.width * sc, h = img.height * sc;
            cx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
            card.meta.textContent = '风格哈希 ' + key + ' · ' + who + ' · ' + (Date.now() - t0) + ' ms';
            card.loading.style.display = 'none';
            cachePut(key, c.toDataURL('image/png'));
        }
    }

    function resize(card) {
        const node = card.canvas;
        const rect = node.parentNode.getBoundingClientRect();
        const w = Math.max(60, Math.round(rect.width));
        const h = Math.max(48, Math.round(rect.height || w));
        const dpr = Math.min(2, global.devicePixelRatio || 1);
        const need = node.width !== Math.round(w * dpr) || node.height !== Math.round(h * dpr);
        node.width = Math.round(w * dpr);
        node.height = Math.round(h * dpr);
        card.dirty = need;
        return need;
    }

    function buildCard(root, spec) {
        const card = {
            root: root, spec: spec, page: curPage(), rev: 0, dirty: true, dead: false,
            revToken: 0, genTimer: 0
        };
        root.innerHTML = '';

        const head = mk('div', 'nano-head');
        head.appendChild(mk('span', 'nano-title', spec.title || '纳米绘图'));
        head.appendChild(mk('span', 'nano-badge', '纳米模式'));
        const meta = mk('span', 'nano-meta', '');
        head.appendChild(meta);
        root.appendChild(head);

        const stage = mk('div', 'nano-stage');
        const ar = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(spec.ratio);
        stage.style.aspectRatio = ar ? (ar[1] + ' / ' + ar[2]) : '1 / 1';
        const canvas = global.document.createElement('canvas');
        canvas.className = 'nano-canvas';
        stage.appendChild(canvas);
        const loading = mk('div', 'nano-loading', '正在生成…');
        stage.appendChild(loading);
        root.appendChild(stage);

        const bar = mk('div', 'nano-bar');
        const styleSel = global.document.createElement('select');
        STYLE_NAMES.forEach(function (n) {
            const o = global.document.createElement('option');
            o.value = n;
            o.textContent = n;
            if (n === spec.style) o.selected = true;
            styleSel.appendChild(o);
        });
        const styleWrap = mk('label');
        styleWrap.appendChild(mk('span', null, '风格'));
        styleWrap.appendChild(styleSel);
        bar.appendChild(styleWrap);

        const seedWrap = mk('label');
        seedWrap.appendChild(mk('span', null, '种子'));
        const seedInp = global.document.createElement('input');
        seedInp.type = 'number';
        seedInp.value = String(spec.seed);
        seedWrap.appendChild(seedInp);
        bar.appendChild(seedWrap);

        const dice = mk('button', 'nano-btn', '🎲');
        dice.type = 'button';
        dice.title = '随机换一个种子';
        dice.addEventListener('click', function () {
            spec.seed = Math.floor(Math.random() * 1000000);
            seedInp.value = String(spec.seed);
            regen();
        });
        bar.appendChild(dice);

        const promptInp = global.document.createElement('input');
        promptInp.type = 'text';
        promptInp.placeholder = '提示词（接真实 AI 接口时作为 prompt，内置生成器只影响构图）';
        promptInp.value = spec.prompt;
        bar.appendChild(promptInp);

        bar.appendChild(mk('span', 'nano-sp'));

        const regenBtn = mk('button', 'nano-btn', '↻ 重新生成');
        regenBtn.type = 'button';
        regenBtn.title = '换一版（同一组输入会命中缓存，此按钮会强制出新图）';
        regenBtn.addEventListener('click', function () { regen(); });
        const pngBtn = mk('button', 'nano-btn', 'PNG');
        pngBtn.type = 'button';
        pngBtn.title = '导出当前图片为 PNG';
        pngBtn.addEventListener('click', function () {
            const a = global.document.createElement('a');
            a.href = canvas.toDataURL('image/png');
            a.download = safeName(spec.title || 'nano') + '-' + spec.style + '-' + spec.seed + '.png';
            a.style.display = 'none';
            global.document.body.appendChild(a);
            a.click();
            setTimeout(function () { a.remove(); }, 0);
        });
        bar.appendChild(regenBtn);
        bar.appendChild(pngBtn);
        root.appendChild(bar);

        if (spec.warnings.length) {
            const wb = mk('div', 'nano-warn', spec.warnings.join('\n'));
            root.appendChild(wb);
        }

        root.addEventListener('keydown', function (e) { e.stopPropagation(); });
        root.addEventListener('pointerdown', function (e) {
            const t = e.target;
            const tag = t && t.tagName;
            if ((tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT') && t.focus) {
                try { t.focus({ preventScroll: true }); } catch (err) { t.focus(); }
            }
        });

        card.canvas = canvas;
        card.meta = meta;
        card.loading = loading;
        card.styleSel = styleSel;
        card.seedInp = seedInp;
        card.promptInp = promptInp;

        styleSel.addEventListener('change', function () {
            spec.style = styleSel.value;
            regen();
        });
        seedInp.addEventListener('change', function () {
            const v = parseInt(seedInp.value, 10);
            spec.seed = isFinite(v) ? v : 0;
            regen();
        });
        promptInp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { spec.prompt = promptInp.value.trim(); regen(); }
        });
        promptInp.addEventListener('change', function () {
            spec.prompt = promptInp.value.trim();
            regen();
        });

        function regen() {
            card.rev++;
            card.dirty = true;
            if (card.genTimer) clearTimeout(card.genTimer);
            card.loading.style.display = 'flex';
            card.genTimer = setTimeout(function () { generate(card); }, 30);
        }
        card.regen = regen;

        root.setAttribute(READY, '1');
        return card;
    }

    // 宿主换文档 / 重渲染后清掉脱离 DOM 的卡片，避免状态虚高
    function prune() {
        const live = cards.filter(function (c) {
            if (c.dead || !c.root.isConnected) {
                c.dead = true;
                if (c.genTimer) clearTimeout(c.genTimer);
                return false;
            }
            return true;
        });
        if (live.length !== cards.length) cards = live;
    }

    /* =========================================================
       6. 扫描初始化
       ========================================================= */
    function initNanosIn(el) {
        el.querySelectorAll('.mps-nano[data-spec]:not([' + READY + '])').forEach(function (root) {
            let spec;
            try {
                spec = parseNano(decodeURIComponent(root.getAttribute('data-spec') || ''));
            } catch (e) {
                root.innerHTML = '<div class="nano-warn">纳米绘图无法启动：' + String(e.message) + '</div>';
                root.setAttribute(READY, '1');
                return;
            }
            let card;
            try {
                card = buildCard(root, spec);
            } catch (e) {
                root.innerHTML = '<div class="nano-warn">纳米绘图无法启动：' + String(e.message) + '</div>';
                root.setAttribute(READY, '1');
                return;
            }
            cards.push(card);
        });
        // 首帧布局完成后统一缩放 + 生成
        const pending = cards.filter(function (c) { return c.canvas && c.dirty && !c.started; });
        if (pending.length) {
            global.requestAnimationFrame(function () {
                pending.forEach(function (c) {
                    if (!c.root.isConnected || c.started) return;
                    c.started = true;
                    resize(c);
                    generate(c);
                });
            });
        }
    }

    /* =========================================================
       7. 公开 API
       ========================================================= */
    global.MPSNano = {
        CSS: CSS,
        styles: function () { return STYLE_NAMES.slice(); },
        configure: function (opts) { deps = opts || {}; return global.MPSNano; },
        renderNano: function (content) {
            return '<div class="mps-nano" data-spec="' + encodeURIComponent(content || '') + '">' +
                '<div class="nano-warn">纳米绘图加载中…</div></div>';
        },
        initIn: function (el) { initNanosIn(el); },
        // 重掷当前页所有插图的种子（对应 NIS 的「重新生成选中项」）
        rerollPage: function () {
            prune();
            const page = curPage();
            let n = 0;
            cards.forEach(function (c) {
                if (c.page !== page) return;
                c.spec.seed = Math.floor(Math.random() * 1000000);
                if (c.seedInp) c.seedInp.value = String(c.spec.seed);
                c.regen();
                n++;
            });
            return n;
        },
        status: function () {
            prune();
            const page = curPage();
            const all = cards;
            const here = all.filter(function (c) { return c.page === page; }).length;
            return '纳米绘图：本页 ' + here + ' 张 · 全卷 ' + all.length + ' 张 · 缓存 ' + cache.size + ' 张' +
                (hook() ? ' · 已接入自定义接口' : ' · 内置占位生成器');
        },
        prune: prune,
        cacheSize: function () { return cache.size; },
        setEnabled: function (on) { enabled = !!on; },
        shutdown: function () {
            enabled = false;
            cards.forEach(function (c) { if (c.genTimer) clearTimeout(c.genTimer); });
            cards = [];
        }
    };
    void enabled;
})(window);