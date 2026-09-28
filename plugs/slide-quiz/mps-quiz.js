/*!
 * MPS 插件运行时 · 课堂测验（window.MPSQuiz）
 * -----------------------------------------------------------------------------
 * 把 ```quiz 代码块变成可交互的课堂测验，把 ```quiz-summary 变成全卷成绩单：
 *   · 题型：单选 / 多选 / 判断 / 填空（填空支持多空、每空多种可接受写法）
 *   · 交互：选完点「提交」再判定；判定后显示对错、参考答案与解析，可「重答」
 *   · 计分：作答按题持久化（ctx.store），翻页 / 重开浏览器都保留，跨页累计；
 *           成绩单汇总全卷题数、已答、正确与得分
 *
 * DSL（```quiz 代码块正文，一行一条指令，空行随意）：
 *   title 第一章随堂测验        可选：本组标题
 *   q 题干文字                 开始一道题（题干支持行内 Markdown 与 \( ... \) 公式）
 *   type single|multi|judge|fill    题型；缺省按选项 / 答案自动推断
 *   opt 选项文字 *             选项；行尾 * 表示正确选项（多选可标多个）
 *   ans 对  /  ans 错          判断题的正确答案
 *   ans H2O | H₂O ; 氢 | H     填空题答案：用 ; 分空，用 | 分隔同一空的多种写法
 *   explain 解析文字            可选：判定后显示
 *   points 2                   可选：本题分值，默认 1
 *
 * ```quiz-summary 代码块：只认 title（可选），其余行忽略。
 *
 * 宿主依赖：ctx.store（作答持久化）、ctx.getDeckSource（整卷题册，用于累计计分；
 *           未提供时退化为「只统计出现过的题」）、ctx.refresh（重置后重渲染）、
 *           ctx.md（行内 Markdown）、window.katex（可选，渲染公式）。
 * 本文件只在加载期定义 window.MPSQuiz，不产生任何副作用。
 * ========================================================================== */
(function (global) {
    'use strict';

    var doc = global.document;

    /* ======================= 样式 ======================= */

    var BASE_CSS = [
        '.quiz,.quiz-board{margin:.9em 0;border:1px solid var(--border-color,#d0d7de);border-radius:12px;',
        'background:var(--bg-slide,#fff);padding:.78em .95em .6em;}',
        '.quiz *,.quiz-board *{box-sizing:border-box;}',

        /* 组标题 / 题干 */
        '.quiz-head{font-weight:700;font-size:1.02em;margin:0 0 .5em;padding-bottom:.38em;',
        'border-bottom:1px dashed var(--border-light,#e1e4e8);}',
        '.quiz-q{margin:.5em 0 .65em;}',
        '.quiz-q:last-of-type{margin-bottom:.3em;}',
        '.quiz-stem{line-height:1.8;}',
        '.quiz-no{display:inline-block;min-width:1.5em;height:1.5em;line-height:1.5em;text-align:center;',
        'border-radius:50%;background:var(--accent-soft,#ddf4ff);color:var(--accent,#0969da);',
        'font-size:.8em;font-weight:700;margin-right:.42em;vertical-align:1px;}',

        /* 选项 */
        '.quiz-opts{display:flex;flex-direction:column;gap:.32em;margin:.42em 0 0 .2em;}',
        '.quiz-opt{display:flex;align-items:center;gap:.5em;width:100%;text-align:left;padding:.35em .62em;',
        'border:1px solid var(--border-color,#d0d7de);border-radius:8px;background:transparent;color:inherit;',
        'font:inherit;line-height:1.65;cursor:pointer;transition:background .12s,border-color .12s;}',
        '.quiz-opt:hover:not(:disabled){background:var(--code-bg,#f6f8fa);}',
        '.quiz-opt:disabled{cursor:default;}',
        '.quiz-key{font-style:normal;flex:none;width:1.4em;height:1.4em;line-height:1.4em;text-align:center;',
        'border-radius:5px;background:var(--code-bg,#f6f8fa);color:var(--text-muted,#8b949e);',
        'font-size:.8em;font-weight:700;}',
        '.quiz-opt.sel{border-color:var(--accent,#0969da);background:var(--accent-soft,#ddf4ff);}',
        '.quiz-opt.sel .quiz-key{background:var(--accent,#0969da);color:#fff;}',
        '.quiz-opt.ok{border-color:#1a7f37;background:rgba(26,127,55,.09);}',
        '.quiz-opt.ok .quiz-key{background:#1a7f37;color:#fff;}',
        '.quiz-opt.bad{border-color:#cf222e;background:rgba(207,34,46,.08);}',
        '.quiz-opt.bad .quiz-key{background:#cf222e;color:#fff;}',
        '.quiz-opt.ok::after{content:"✓";margin-left:auto;color:#1a7f37;font-weight:700;}',
        '.quiz-opt.bad::after{content:"✕";margin-left:auto;color:#cf222e;font-weight:700;}',
        '.quiz-opt.ok,.quiz-opt.bad{opacity:1;}',
        '.quiz-opt:disabled:not(.sel):not(.ok):not(.bad){opacity:.62;}',

        /* 填空输入 */
        '.quiz-blank{font:inherit;color:inherit;text-align:center;padding:0 .25em;border:0;',
        'border-bottom:1.6px solid var(--accent,#0969da);background:transparent;outline:none;}',
        '.quiz-blank:focus{background:var(--accent-soft,#ddf4ff);}',
        '.quiz-blank.ok{border-bottom-color:#1a7f37;color:#1a7f37;}',
        '.quiz-blank.bad{border-bottom-color:#cf222e;color:#cf222e;}',
        '.quiz-blank:disabled{opacity:1;}',
        '.quiz-blank-ref{color:var(--text-muted,#8b949e);letter-spacing:.12em;}',

        /* 操作行 / 结果 / 解析 */
        '.quiz-act{display:flex;align-items:center;gap:.6em;margin:.48em 0 0 .95em;flex-wrap:wrap;}',
        '.quiz-btn{font:inherit;font-size:.86em;padding:.3em 1em;border-radius:7px;',
        'border:1px solid var(--border-color,#d0d7de);background:var(--code-bg,#f6f8fa);color:inherit;',
        'cursor:pointer;transition:background .12s,border-color .12s,opacity .12s;}',
        '.quiz-btn:hover:not(:disabled){border-color:var(--accent,#0969da);color:var(--accent,#0969da);}',
        '.quiz-submit:not(:disabled){border-color:var(--accent,#0969da);background:var(--accent,#0969da);color:#fff;}',
        '.quiz-submit:not(:disabled):hover{color:#fff;opacity:.88;}',
        '.quiz-btn:disabled{opacity:.42;cursor:not-allowed;}',
        '.quiz-btn.armed{border-color:#cf222e;color:#cf222e;background:rgba(207,34,46,.08);}',
        '.quiz-res{font-size:.86em;line-height:1.6;}',
        '.quiz-res.ok{color:#1a7f37;font-weight:700;}',
        '.quiz-res.bad{color:#cf222e;font-weight:700;}',
        '.quiz-res .quiz-ans{color:var(--text-muted,#8b949e);font-weight:400;}',
        '.quiz-explain{margin:.42em 0 0 .95em;padding:.42em .68em;border-left:.25em solid var(--border-color,#d0d7de);',
        'border-radius:0 6px 6px 0;background:var(--code-bg,#f6f8fa);color:var(--text-secondary,#57606a);',
        'font-size:.88em;line-height:1.75;}',
        '.quiz-explain[hidden]{display:none;}',
        '.quiz-exic{font-style:normal;font-weight:700;color:var(--accent,#0969da);margin-right:.45em;}',
        '.quiz-warn{margin:.4em 0 0;padding:.38em .62em;border-radius:6px;background:rgba(154,103,0,.12);',
        'color:#9a6700;font-size:.84em;line-height:1.65;}',
        '.quiz-warn code{background:rgba(154,103,0,.12);}',

        /* 组脚注 */
        '.quiz-foot{margin-top:.15em;padding-top:.42em;border-top:1px dashed var(--border-light,#e1e4e8);',
        'color:var(--text-muted,#8b949e);font-size:.82em;line-height:1.9;}',
        '.quiz-foot[hidden]{display:none;}',
        '.quiz-foot-all{float:right;margin-left:1em;}',

        /* 成绩单 */
        '.qb-head{font-weight:700;margin:0 0 .6em;}',
        '.qb-stats{display:flex;gap:1.6em;flex-wrap:wrap;margin-bottom:.6em;}',
        '.qb-item{display:flex;flex-direction:column;gap:.08em;}',
        '.qb-item b{font-size:1.5em;line-height:1.15;color:var(--accent,#0969da);font-variant-numeric:tabular-nums;}',
        '.qb-item span{font-size:.78em;color:var(--text-muted,#8b949e);}',
        '.qb-track{height:6px;border-radius:3px;background:var(--code-bg,#f6f8fa);',
        'border:1px solid var(--border-light,#e1e4e8);overflow:hidden;}',
        '.qb-fill{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--accent,#0969da),#6cb6ff);',
        'transition:width .3s cubic-bezier(.3,.9,.3,1);}',
        '.qb-foot{display:flex;align-items:center;gap:.65em;margin-top:.62em;flex-wrap:wrap;}',
        '.qb-hint{font-size:.8em;color:var(--text-muted,#8b949e);}',

        /* 深色主题微调（两个宿主都通过 body.dark-mode 切换） */
        'body.dark-mode .quiz-opt.ok{border-color:#3fb950;background:rgba(63,185,80,.14);}',
        'body.dark-mode .quiz-opt.ok .quiz-key{background:#3fb950;}',
        'body.dark-mode .quiz-opt.ok::after{color:#3fb950;}',
        'body.dark-mode .quiz-opt.bad{border-color:#f85149;background:rgba(248,81,73,.14);}',
        'body.dark-mode .quiz-opt.bad .quiz-key{background:#f85149;}',
        'body.dark-mode .quiz-opt.bad::after{color:#f85149;}',
        'body.dark-mode .quiz-blank.ok{color:#3fb950;border-bottom-color:#3fb950;}',
        'body.dark-mode .quiz-blank.bad{color:#f85149;border-bottom-color:#f85149;}',
        'body.dark-mode .quiz-res.ok{color:#3fb950;}',
        'body.dark-mode .quiz-res.bad{color:#f85149;}',
        'body.dark-mode .quiz-warn{color:#d29922;background:rgba(210,153,34,.14);}'
    ].join('');

    /* ======================= 配置与状态 ======================= */

    var cfg = { md: null, store: null, getDeckSource: null, refresh: null, log: null };
    var memStore = {};       // ctx.store 不可用时的兜底
    var invCache = { src: null, list: null };   // 整卷题册缓存（按源文本命中）
    var armTimers = [];      // 「再点一次确认」的定时器（shutdown 时清理）

    function log(msg) { if (cfg.log) cfg.log(msg); }

    function storeGet(k, def) {
        if (cfg.store) return cfg.store.get(k, def);
        return Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : def;
    }
    function storeSet(k, v) {
        if (cfg.store) cfg.store.set(k, v); else memStore[k] = v;
    }
    function hasDeckSource() {
        try { return !!(cfg.getDeckSource && cfg.getDeckSource()); } catch (e) { return false; }
    }
    function deckSource() {
        try { return cfg.getDeckSource ? String(cfg.getDeckSource() || '') : ''; } catch (e) { return ''; }
    }

    // 稳定短哈希（djb2，与 camera 插件同款），用于题目身份
    function hash(str) {
        var s = String(str), h = 5381, i = s.length;
        while (i) h = (h * 33 ^ s.charCodeAt(--i)) >>> 0;
        return h.toString(36) + '-' + s.length.toString(36);
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
        });
    }

    function b64(s) {
        try {
            var bytes = new global.TextEncoder().encode(String(s));
            var bin = '';
            for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
            return global.btoa(bin);
        } catch (e) {
            var s2 = String(s), out = '';
            for (var j = 0; j < s2.length; j++) out += String.fromCharCode(s2.charCodeAt(j) & 0xff);
            try { return global.btoa(out); } catch (e2) { return ''; }
        }
    }
    function unb64(s) {
        try {
            var bin = global.atob(String(s || ''));
            var bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return new global.TextDecoder().decode(bytes);
        } catch (e) { return ''; }
    }

    function fmt(n) { return String(Math.round(Number(n) * 100) / 100); }

    /* ======================= 行内文本渲染 ======================= */

    // 私有区标记：先占位、后替换，避免被 markdown-it / 宿主公式管线改动
    function ph(i) { return '\uE000' + i + '\uE001'; }

    function renderTeX(body, display) {
        try {
            if (global.katex) {
                return global.katex.renderToString(body, { displayMode: !!display, throwOnError: false });
            }
        } catch (e) { /* 落回纯文本 */ }
        return '<code>' + esc((display ? '\\[' : '\\(') + body + (display ? '\\]' : '\\)')) + '</code>';
    }

    // 题干 / 选项 / 解析统一走这里：\( ... \) 公式 + 行内 Markdown
    // opts.blanks：填空题的空位定义（数组），把题干里的 ____ 换成正的输入框
    function inlineText(text, opts) {
        var parts = [];
        var work = String(text == null ? '' : text);

        // 1) 公式：\( ... \)（行内）与 \[ ... \]（独立行）
        work = work.replace(/\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g, function (m, a, b) {
            var html = renderTeX(a != null ? a : b, b != null);
            return ph(parts.push(html) - 1);
        });

        // 2) 填空位：连续 3 个以上下划线
        var blanks = (opts && opts.blanks) || null;
        if (blanks) {
            var bi = 0;
            work = work.replace(/_{3,}/g, function () {
                var def = blanks[bi] || [];
                var len = 0;
                for (var k = 0; k < def.length; k++) len = Math.max(len, String(def[k]).length);
                var w = Math.round(Math.min(16, Math.max(4, len + 1)));
                var html = '<input class="quiz-blank" data-b="' + bi + '" type="text" ' +
                    'autocomplete="off" spellcheck="false" style="width:' + w + 'em">';
                bi++;
                return ph(parts.push(html) - 1);
            });
        } else if (opts && opts.ghostBlanks) {
            // 配置有误的填空题：只把下划线换成中性占位，避免被 Markdown 当成强调语法吞掉
            work = work.replace(/_{3,}/g, function () {
                return ph(parts.push('<span class="quiz-blank-ref">___</span>') - 1);
            });
        }

        // 3) 其余交给宿主 markdown-it 做行内渲染
        //    （宿主生成的公式占位符注释 <!--MPSMATH*--> 会原样保留，由宿主在最后一步替换）
        var html;
        try {
            html = cfg.md ? cfg.md.renderInline(work) : esc(work);
        } catch (e) { html = esc(work); }

        // 4) 还原占位
        for (var i = 0; i < parts.length; i++) html = html.split(ph(i)).join(parts[i]);
        return html;
    }

    /* ======================= DSL 解析 ======================= */

    var TYPES = {
        single: 'single', '单选': 'single', radio: 'single', choice: 'single',
        multi: 'multi', '多选': 'multi', multiple: 'multi', checkbox: 'multi',
        judge: 'judge', '判断': 'judge', tf: 'judge', truefalse: 'judge',
        fill: 'fill', '填空': 'fill', blank: 'fill', text: 'fill'
    };
    var KEY_TRUE = ['对', '正确', '是', '√', '✓', 't', 'true', 'y', 'yes', '1', 'right'];
    var KEY_FALSE = ['错', '错误', '否', '×', '✗', 'x', 'f', 'false', 'n', 'no', '0', 'wrong'];

    function countBlanks(text) { return (String(text).match(/_{3,}/g) || []).length; }

    function parseJudge(arg) {
        var s = String(arg || '').trim().toLowerCase();
        if (KEY_TRUE.indexOf(s) >= 0) return 0;
        if (KEY_FALSE.indexOf(s) >= 0) return 1;
        return null;
    }

    function parseFill(arg) {
        var groups = String(arg || '').split(';').map(function (g) {
            return g.split('|').map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; });
        });
        // 去掉整体为空的尾组（允许 author 多写分号）
        while (groups.length && !groups[groups.length - 1].length) groups.pop();
        return groups;
    }

    // 题干 / 选项文本的规范化：折叠空白、把公式（两种形态）折叠成同一标记
    // 注意：围栏里看到的是宿主替换后的 <!--MPSMATH*--> 占位符，
    //       整卷题册里看到的是原始 $...$ / $$...$$，两侧必须折叠一致才能对上身份
    function canonText(t) {
        return String(t == null ? '' : t)
            .replace(/<!--MPSMATH[BI]\d+-->/g, '\u0001')
            .replace(/\$\$[\s\S]+?\$\$/g, '\u0001')
            .replace(/\$[^$\n]+?\$/g, '\u0001')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function qidOf(q) {
        var canon = [
            q.type,
            canonText(q.text),
            q.options.map(function (o) { return (o.correct ? '*' : '') + canonText(o.text); }).join('\u0003'),
            q.type === 'judge' ? String(q.judgeIdx) : '',
            q.type === 'fill' ? (q.blanks || []).map(function (g) { return g.join('|'); }).join(';') : ''
        ].join('\u0002');
        return hash(canon);
    }

    // 解析 ```quiz 代码块正文 → { title, questions: [...] }
    function parse(src, opts) {
        var emitWarn = !!(opts && opts.warn);
        var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
        var set = { title: '', questions: [] };
        var cur = null, field = '';

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].replace(/\s+$/, '');
            var m = line.match(/^\s*([A-Za-z][A-Za-z-]*)\s+([\s\S]*)$/);

            if (!m) {
                var plain = line.trim();
                if (plain && cur && field === 'explain') cur.explain += ' ' + plain;
                else if (plain && emitWarn && !/^\s*$/.test(line)) {
                    log('第 ' + (i + 1) + ' 行无法识别（题目正文请写在 q 行内）: ' + plain.slice(0, 40));
                }
                continue;
            }

            var name = m[1].toLowerCase(), arg = m[2].replace(/^\s+/, '').replace(/\s+$/, '');
            if (name === 'title') { set.title = arg; field = ''; continue; }
            if (name === 'q' || name === 'question') {
                cur = { type: '', text: arg, options: [], judgeIdx: null, blanks: null, points: 1, explain: '', warn: '' };
                set.questions.push(cur);
                field = '';
                continue;
            }
            if (!cur) continue;   // 题目之前的其它指令一律忽略

            if (name === 'type') {
                cur.type = TYPES[arg.toLowerCase()] || TYPES[arg] || '';
                if (!cur.type && emitWarn) log('未知题型「' + arg + '」，可用 single / multi / judge / fill');
            } else if (name === 'opt' || name === 'option') {
                var raw = arg.replace(/\s+$/, ''), text = raw, correct = false;
                if (/\\\*$/.test(raw)) text = raw.slice(0, -2) + '*';            // \* 转义为字面星号
                else if (/\*$/.test(raw)) { correct = true; text = raw.slice(0, -1).replace(/\s+$/, ''); }
                cur.options.push({ text: text, correct: correct });
            } else if (name === 'ans' || name === 'answer') {
                cur.rawAns = arg;
            } else if (name === 'explain') {
                cur.explain = arg; field = 'explain';
            } else if (name === 'points') {
                var p = parseFloat(arg);
                if (isFinite(p) && p >= 0 && p <= 100) cur.points = p;
                else if (emitWarn) log('points 需要 0-100 的数字，已按 1 分处理: ' + arg);
            } else if (emitWarn) {
                log('未知指令「' + m[1] + '」，已忽略');
            }
        }

        // 校验 + 补全
        set.questions.forEach(function (q) {
            if (!q.type) {
                if (q.options.length) q.type = 'single';
                else if (countBlanks(q.text)) q.type = 'fill';
                else if (parseJudge(q.rawAns) !== null) q.type = 'judge';
                else q.type = 'fill';
            }
            if (q.type === 'single' || q.type === 'multi') {
                var right = 0;
                q.options.forEach(function (o) { if (o.correct) right++; });
                if (q.options.length < 2) q.warn = '选项太少：至少写 2 条 opt 行';
                else if (q.type === 'single' && right !== 1) q.warn = '单选题需要恰好 1 个正确选项（行尾加 *）';
                else if (q.type === 'multi' && right < 1) q.warn = '多选题至少要有 1 个正确选项（行尾加 *）';
            } else if (q.type === 'judge') {
                q.judgeIdx = parseJudge(q.rawAns);
                if (q.judgeIdx === null) q.warn = '判断题需要写 ans 对 或 ans 错';
            } else if (q.type === 'fill') {
                q.blanks = parseFill(q.rawAns);
                var nb = countBlanks(q.text);
                if (!nb) q.warn = '题干里需要空位：连续 3 个以上下划线，例如 ____';
                else if (!q.blanks || !q.blanks.length) q.warn = '填空题需要写 ans，多个空用 ; 分隔';
                else if (q.blanks.length !== nb) q.warn = '答案组数（' + q.blanks.length + '）与空数（' + nb + '）不一致，用 ; 分空';
                else if (q.blanks.some(function (g) { return !g.length; })) q.warn = '存在没有写答案的空';
            }
            if (!q.warn) q.id = qidOf(q);
        });

        return set;
    }

    // 从整卷 Markdown 里收集指定语言的代码块正文
    function collectFences(src, langs) {
        var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
        var out = [], inF = false, ch = '', lang = '', buf = [];
        for (var i = 0; i < lines.length; i++) {
            var m = lines[i].match(/^\s*(`{3,}|~{3,})\s*([^\s`]*)\s*$/);
            if (m) {
                var c = m[1].charAt(0);
                if (!inF) {
                    inF = true; ch = c; lang = m[2].toLowerCase(); buf = [];
                } else if (c === ch) {
                    if (langs.indexOf(lang) >= 0) out.push(buf.join('\n'));
                    inF = false; lang = ''; buf = [];
                }
                continue;
            }
            if (inF && langs.indexOf(lang) >= 0) buf.push(lines[i]);
        }
        return out;
    }

    /* ======================= 整卷题册与成绩统计 ======================= */

    function inventory() {
        var src = hasDeckSource() ? deckSource() : '';
        if (invCache.src === src && invCache.list) return invCache.list;
        var list = [];
        if (src) {
            collectFences(src, ['quiz']).forEach(function (content) {
                parse(content).questions.forEach(function (q) {
                    if (!q.warn) list.push({ id: q.id, points: q.points });
                });
            });
        } else {
            // 兜底：宿主没提供整卷源时，用页面上出现过的题（持久化 seen）
            var seenMap = storeGet('seen', {}) || {};
            for (var k in seenMap) {
                if (Object.prototype.hasOwnProperty.call(seenMap, k)) {
                    list.push({ id: k, points: (seenMap[k] && seenMap[k].points) || 1 });
                }
            }
        }
        invCache = { src: src, list: list };
        return list;
    }

    function deckStats() {
        var inv = inventory();
        var prog = storeGet('progress', {}) || {};
        if (typeof prog !== 'object' || prog == null) prog = {};
        var st = { total: inv.length, points: 0, answered: 0, correct: 0, score: 0 };
        inv.forEach(function (q) {
            st.points += q.points;
            var r = prog[q.id];
            if (r && r.done !== false) {
                st.answered++;
                if (r.ok) { st.correct++; st.score += q.points; }
            }
        });
        st.points = Math.round(st.points * 100) / 100;
        st.score = Math.round(st.score * 100) / 100;
        return st;
    }

    /* ======================= 渲染（围栏） ======================= */

    function answerOf(q) {
        if (q.type === 'multi') {
            var idx = [];
            q.options.forEach(function (o, i) { if (o.correct) idx.push(i); });
            return { c: idx };
        }
        if (q.type === 'judge') return { c: q.judgeIdx };
        if (q.type === 'fill') return { b: q.blanks };
        var one = 0;
        q.options.forEach(function (o, i) { if (o.correct) one = i; });
        return { c: one };
    }

    function renderQuestion(q, idx) {
        var no = '<span class="quiz-no">' + (idx + 1) + '</span>';
        if (q.warn) {
            return '<div class="quiz-q quiz-bad">' +
                '<div class="quiz-stem">' + no +
                inlineText(q.text, q.type === 'fill' ? { ghostBlanks: true } : null) + '</div>' +
                '<div class="quiz-warn">⚙ 题目配置有误：' + esc(q.warn) + '</div></div>';
        }

        var stem = '<div class="quiz-stem">' + no +
            inlineText(q.text, q.type === 'fill' ? { blanks: q.blanks } : null) + '</div>';

        var body = '';
        if (q.type === 'single' || q.type === 'multi' || q.type === 'judge') {
            var opts = q.type === 'judge'
                ? [{ text: '对' }, { text: '错' }]
                : q.options;
            body = '<div class="quiz-opts"' + (q.type === 'multi' ? ' data-multi="1"' : '') + '>';
            opts.forEach(function (o, i) {
                var key = q.type === 'judge' ? (i === 0 ? '✓' : '✗') : String.fromCharCode(65 + i);
                body += '<button type="button" class="quiz-opt" data-i="' + i + '">' +
                    '<i class="quiz-key">' + key + '</i>' +
                    '<span class="quiz-otext">' + inlineText(o.text) + '</span></button>';
            });
            body += '</div>';
        }

        return '<div class="quiz-q" data-qid="' + q.id + '" data-type="' + q.type + '"' +
            ' data-ans="' + esc(b64(JSON.stringify(answerOf(q)))) + '"' +
            ' data-points="' + fmt(q.points) + '">' +
            stem + body +
            '<div class="quiz-act">' +
            '<button type="button" class="quiz-btn quiz-submit" disabled>提交</button>' +
            '<span class="quiz-res" data-quiz-res></span></div>' +
            '<div class="quiz-explain" data-quiz-explain hidden>' +
            (q.explain ? '<i class="quiz-exic">解析</i>' + inlineText(q.explain) : '') +
            '</div></div>';
    }

    function renderSet(src) {
        var set = parse(src, { warn: true });
        if (!set.questions.length) {
            return '<div class="quiz"><div class="quiz-warn">这个 quiz 代码块里没有题目：' +
                '用 <code>q 题干</code> 起一道题，用 <code>type</code> / <code>opt</code> / <code>ans</code> 补充内容。</div></div>';
        }
        var valid = 0;
        set.questions.forEach(function (q) { if (!q.warn) valid++; });
        var html = '<div class="quiz">';
        if (set.title) html += '<div class="quiz-head">' + inlineText(set.title) + '</div>';
        set.questions.forEach(function (q, i) { html += renderQuestion(q, i); });
        html += '<div class="quiz-foot" data-quiz-foot' + (valid ? '' : ' hidden') + '></div>';
        html += '</div>';
        return html;
    }

    function renderBoard(src) {
        var title = '';
        String(src || '').split('\n').forEach(function (line) {
            var m = line.match(/^\s*title\s+([\s\S]*)$/);
            if (m) title = m[1].trim();
        });
        return '<div class="quiz-board">' +
            '<div class="qb-head">' + (title ? inlineText(title) : '全卷成绩') + '</div>' +
            '<div class="qb-stats">' +
            '<div class="qb-item"><b data-qb-total>0</b><span>总题数</span></div>' +
            '<div class="qb-item"><b data-qb-done>0</b><span>已答</span></div>' +
            '<div class="qb-item"><b data-qb-right>0</b><span>正确</span></div>' +
            '<div class="qb-item"><b data-qb-score>0 / 0</b><span>得分</span></div>' +
            '</div>' +
            '<div class="qb-track"><i class="qb-fill"></i></div>' +
            '<div class="qb-foot">' +
            '<button type="button" class="quiz-btn qb-reset">重新作答</button>' +
            '<span class="qb-hint" data-qb-hint></span>' +
            '</div></div>';
    }

    /* ======================= 交互 ======================= */

    function elQ(qEl) { return qEl.getAttribute('data-type'); }
    function ansOf(qEl) {
        try { return JSON.parse(unb64(qEl.getAttribute('data-ans'))) || {}; } catch (e) { return {}; }
    }

    function normFill(s) {
        return String(s == null ? '' : s)
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '')
            .replace(/[０-９Ａ-Ｚａ-ｚ]/g, function (c) {
                return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
            });
    }

    function collectGiven(qEl) {
        var type = elQ(qEl), out = [], i;
        if (type === 'fill') {
            var inputs = qEl.querySelectorAll('.quiz-blank');
            for (i = 0; i < inputs.length; i++) out.push(inputs[i].value);
            return out;
        }
        var opts = qEl.querySelectorAll('.quiz-opt');
        for (i = 0; i < opts.length; i++) {
            if (opts[i].classList.contains('sel')) out.push(Number(opts[i].getAttribute('data-i')));
        }
        return out;
    }

    function isAnswered(qEl) {
        var type = elQ(qEl);
        if (type === 'fill') {
            var inputs = qEl.querySelectorAll('.quiz-blank');
            for (var i = 0; i < inputs.length; i++) if (inputs[i].value.trim() !== '') return true;
            return false;
        }
        return qEl.querySelectorAll('.quiz-opt.sel').length > 0;
    }

    function grade(qEl, given) {
        var type = elQ(qEl), ans = ansOf(qEl), i, j;
        if (type === 'fill') {
            var groups = ans.b || [];
            if (!groups.length) return false;
            for (i = 0; i < groups.length; i++) {
                var g = normFill(given[i]);
                var hit = false;
                for (j = 0; j < groups[i].length; j++) {
                    if (normFill(groups[i][j]) === g && g !== '') { hit = true; break; }
                }
                if (!hit) return false;
            }
            return true;
        }
        if (type === 'multi') {
            var a = given.slice().sort().join(','), b = (ans.c || []).slice().sort().join(',');
            return a === b && a !== '';
        }
        return given.length === 1 && Number(given[0]) === Number(ans.c);
    }

    // 参考答案的展示文本
    function answerText(qEl) {
        var type = elQ(qEl), ans = ansOf(qEl);
        if (type === 'fill') {
            return (ans.b || []).map(function (g) { return g.join(' / '); }).join(' · ');
        }
        if (type === 'judge') return Number(ans.c) === 0 ? '对' : '错';
        return (ans.c || []).map(function (i) { return String.fromCharCode(65 + i); }).join('、');
    }

    function syncSubmit(qEl) {
        var btn = qEl.querySelector('.quiz-submit');
        if (!btn || qEl.getAttribute('data-locked')) return;
        btn.disabled = !isAnswered(qEl);
    }

    function lockQuestion(qEl, given, ok, reveal) {
        var type = elQ(qEl), i;
        qEl.setAttribute('data-locked', '1');

        var ans = ansOf(qEl);
        var correct = type === 'multi' ? (ans.c || []) : (type === 'fill' ? [] : [Number(ans.c)]);
        var opts = qEl.querySelectorAll('.quiz-opt');
        for (i = 0; i < opts.length; i++) {
            opts[i].disabled = true;
            var idx = Number(opts[i].getAttribute('data-i'));
            opts[i].classList.remove('sel', 'ok', 'bad');
            if (correct.indexOf(idx) >= 0) opts[i].classList.add('ok');
            else if (given.indexOf(idx) >= 0) opts[i].classList.add('bad');
        }
        var inputs = qEl.querySelectorAll('.quiz-blank');
        for (i = 0; i < inputs.length; i++) {
            inputs[i].disabled = true;
            inputs[i].classList.remove('ok', 'bad');
            if (type === 'fill' && given[i] != null) inputs[i].value = given[i];
            var groups = (ans.b || [])[i] || [];
            var hit = false;
            for (var j = 0; j < groups.length; j++) {
                if (normFill(groups[j]) === normFill(given[i])) { hit = true; break; }
            }
            if (type === 'fill') inputs[i].classList.add(hit ? 'ok' : 'bad');
        }

        var res = qEl.querySelector('[data-quiz-res]');
        if (res) {
            res.className = 'quiz-res ' + (ok ? 'ok' : 'bad');
            res.innerHTML = (ok ? '✓ 正确' : '✕ 错误') +
                '<span class="quiz-ans">　参考答案：' + esc(answerText(qEl)) + '</span>';
        }
        if (reveal) {
            var ex = qEl.querySelector('[data-quiz-explain]');
            if (ex && ex.innerHTML.trim()) ex.hidden = false;
        }
        var btn = qEl.querySelector('.quiz-submit');
        if (btn) {
            btn.disabled = false;
            btn.textContent = '重答';
            btn.classList.add('quiz-again');
        }
    }

    function resetQuestion(qEl) {
        qEl.removeAttribute('data-locked');
        var opts = qEl.querySelectorAll('.quiz-opt');
        for (var i = 0; i < opts.length; i++) {
            opts[i].disabled = false;
            opts[i].classList.remove('sel', 'ok', 'bad');
        }
        var inputs = qEl.querySelectorAll('.quiz-blank');
        for (i = 0; i < inputs.length; i++) {
            inputs[i].disabled = false;
            inputs[i].value = '';
            inputs[i].classList.remove('ok', 'bad');
        }
        var res = qEl.querySelector('[data-quiz-res]');
        if (res) { res.className = 'quiz-res'; res.innerHTML = ''; }
        var ex = qEl.querySelector('[data-quiz-explain]');
        if (ex) ex.hidden = true;
        var btn = qEl.querySelector('.quiz-submit');
        if (btn) {
            btn.textContent = '提交';
            btn.classList.remove('quiz-again');
            btn.disabled = true;
        }
    }

    function saveRecord(qid, ok, given) {
        var rec = storeGet('progress', {}) || {};
        if (typeof rec !== 'object' || rec === null) rec = {};
        rec[qid] = { ok: !!ok, given: given, ts: Date.now() };
        storeSet('progress', rec);
        return rec;
    }
    function dropRecord(qid) {
        var rec = storeGet('progress', {}) || {};
        if (typeof rec !== 'object' || rec === null) return;
        if (Object.prototype.hasOwnProperty.call(rec, qid)) {
            delete rec[qid];
            storeSet('progress', rec);
        }
    }

    function submitQuestion(qEl) {
        if (qEl.getAttribute('data-locked') || !isAnswered(qEl)) return;
        var given = collectGiven(qEl);
        var ok = grade(qEl, given);
        lockQuestion(qEl, given, ok, true);
        saveRecord(qEl.getAttribute('data-qid'), ok, given);
        refreshAll();
    }

    function bindSet(setEl) {
        // 键盘事件不冒泡到宿主：否则填空时敲空格 / 字母会触发翻页、(engine) 抽屉等全局热键
        setEl.addEventListener('keydown', function (e) {
            e.stopPropagation();
            var t = e.target;
            if (e.key === 'Enter' && t && t.classList && t.classList.contains('quiz-blank')) {
                e.preventDefault();
                var qEl = t.closest ? t.closest('.quiz-q') : null;
                if (qEl && !qEl.getAttribute('data-locked')) submitQuestion(qEl);
            }
        });
        Array.prototype.forEach.call(setEl.querySelectorAll('.quiz-q[data-qid]'), bindQuestion);
    }

    function bindQuestion(qEl) {
        var opts = qEl.querySelectorAll('.quiz-opt');
        Array.prototype.forEach.call(opts, function (btn) {
            btn.addEventListener('click', function () {
                if (qEl.getAttribute('data-locked')) return;
                var multi = qEl.querySelector('.quiz-opts[data-multi]') != null;
                if (multi) btn.classList.toggle('sel');
                else {
                    Array.prototype.forEach.call(opts, function (o) { o.classList.remove('sel'); });
                    btn.classList.add('sel');
                }
                syncSubmit(qEl);
            });
        });
        Array.prototype.forEach.call(qEl.querySelectorAll('.quiz-blank'), function (inp) {
            inp.addEventListener('input', function () { syncSubmit(qEl); });
        });
        var btn = qEl.querySelector('.quiz-submit');
        btn.addEventListener('click', function () {
            if (qEl.getAttribute('data-locked')) {
                dropRecord(qEl.getAttribute('data-qid'));
                resetQuestion(qEl);
                refreshAll();
            } else {
                submitQuestion(qEl);
            }
        });
    }

    function restoreQuestion(qEl, rec) {
        if (!rec) return;
        var type = elQ(qEl), i;
        var given = rec.given || [];
        if (type === 'fill') {
            var inputs = qEl.querySelectorAll('.quiz-blank');
            for (i = 0; i < inputs.length; i++) {
                if (given[i] != null) inputs[i].value = given[i];
            }
        } else {
            var opts = qEl.querySelectorAll('.quiz-opt');
            for (i = 0; i < given.length; i++) {
                var idx = Number(given[i]);
                if (opts[idx]) opts[idx].classList.add('sel');
            }
        }
        lockQuestion(qEl, given, grade(qEl, given), false);
    }

    function restoreSet(setEl) {
        var prog = storeGet('progress', {}) || {};
        Array.prototype.forEach.call(setEl.querySelectorAll('.quiz-q[data-qid]'), function (qEl) {
            var qid = qEl.getAttribute('data-qid');
            if (prog[qid]) restoreQuestion(qEl, prog[qid]);
            else syncSubmit(qEl);
        });
    }

    function updateFoot(setEl) {
        var foot = setEl.querySelector('[data-quiz-foot]');
        if (!foot) return;
        var qEls = setEl.querySelectorAll('.quiz-q[data-qid]');
        var total = qEls.length, done = 0, right = 0;
        Array.prototype.forEach.call(qEls, function (qEl) {
            if (qEl.getAttribute('data-locked')) {
                done++;
                if (qEl.querySelector('.quiz-res.ok')) right++;
            }
        });
        foot.hidden = total === 0;
        if (!total) { foot.innerHTML = ''; return; }
        var html = '本组：已答 ' + done + ' / ' + total + ' · 正确 ' + right;
        var st = deckStats();
        if (st.total > 0) {
            html += '<span class="quiz-foot-all">全卷：已答 ' + st.answered + ' / ' + st.total +
                ' · 得分 ' + fmt(st.score) + ' / ' + fmt(st.points) + '</span>';
        }
        foot.innerHTML = html;
    }

    // 记录「出现过的题」，供宿主没提供整卷源时兜底统计
    function recordSeen(setEl) {
        var seenMap = storeGet('seen', {}) || {};
        if (typeof seenMap !== 'object' || seenMap === null) seenMap = {};
        var changed = false;
        Array.prototype.forEach.call(setEl.querySelectorAll('.quiz-q[data-qid]'), function (qEl) {
            var qid = qEl.getAttribute('data-qid');
            var pts = parseFloat(qEl.getAttribute('data-points')) || 1;
            if (!seenMap[qid] || seenMap[qid].points !== pts) {
                seenMap[qid] = { points: pts, ts: Date.now() };
                changed = true;
            }
        });
        if (changed) storeSet('seen', seenMap);
    }

    function updateBoard(bEl) {
        var st = deckStats();
        var map = {
            total: st.total, done: st.answered, right: st.correct,
            score: fmt(st.score) + ' / ' + fmt(st.points)
        };
        Object.keys(map).forEach(function (k) {
            var n = bEl.querySelector('[data-qb-' + k + ']');
            if (n) n.textContent = map[k];
        });
        var fill = bEl.querySelector('.qb-fill');
        if (fill) fill.style.width = (st.total ? Math.round(st.answered / st.total * 100) : 0) + '%';
        var hint = bEl.querySelector('[data-qb-hint]');
        if (hint) {
            if (st.total === 0) hint.textContent = '本卷还没有 quiz 题目';
            else if (st.answered === 0) hint.textContent = '还没有作答记录';
            else if (st.answered >= st.total) {
                hint.textContent = '全部作答完成，答对率 ' + Math.round(st.correct / st.total * 100) + '%';
            } else {
                hint.textContent = '答对率 ' + Math.round(st.correct / st.answered * 100) +
                    '%（已答 ' + st.answered + ' 题）';
            }
        }
    }

    function armConfirm(btn, hintEl, onConfirm) {
        if (btn.getAttribute('data-arm')) {
            btn.removeAttribute('data-arm');
            btn.classList.remove('armed');
            clearArmTimers();
            onConfirm();
            return;
        }
        btn.setAttribute('data-arm', '1');
        btn.classList.add('armed');
        var old = btn.textContent;
        btn.textContent = '确认重新作答？';
        if (hintEl) hintEl.textContent = '3 秒内再点一次，清空本卷全部作答';
        armTimers.push(setTimeout(function () {
            btn.removeAttribute('data-arm');
            btn.classList.remove('armed');
            btn.textContent = old;
            if (hintEl) hintEl.textContent = '';
        }, 3000));
    }
    function clearArmTimers() {
        armTimers.forEach(function (t) { clearTimeout(t); });
        armTimers = [];
    }

    function bindBoard(bEl) {
        var btn = bEl.querySelector('.qb-reset');
        if (btn) {
            btn.addEventListener('click', function () {
                armConfirm(btn, bEl.querySelector('[data-qb-hint]'), function () {
                    resetDeck();
                });
            });
        }
    }

    /* ======================= 刷新与重置 ======================= */

    function refreshAll() {
        invCache = { src: null, list: null };   // 源可能已变化，作废题册缓存
        var sets = doc.querySelectorAll('.quiz');
        Array.prototype.forEach.call(sets, updateFoot);
        var boards = doc.querySelectorAll('.quiz-board');
        Array.prototype.forEach.call(boards, updateBoard);
    }

    // 清除本卷（题册中的题）的作答；宿主不支持整卷源时清空全部
    function resetDeck() {
        var rec = storeGet('progress', {}) || {};
        if (typeof rec !== 'object' || rec === null) rec = {};
        if (hasDeckSource()) {
            inventory().forEach(function (q) { delete rec[q.id]; });
            storeSet('progress', rec);
        } else {
            storeSet('progress', {});
        }
        if (cfg.refresh) {
            cfg.refresh();          // 宿主重渲染当前页 → 所有题回到未作答
        } else {
            var sets = doc.querySelectorAll('.quiz');
            Array.prototype.forEach.call(sets, function (setEl) {
                Array.prototype.forEach.call(setEl.querySelectorAll('.quiz-q[data-qid]'), resetQuestion);
                updateFoot(setEl);
            });
        }
    }

    /* ======================= 对外 API ======================= */

    global.MPSQuiz = {
        CSS: BASE_CSS,

        configure: function (o) {
            o = o || {};
            cfg.md = o.md || null;
            cfg.store = o.store || null;
            cfg.getDeckSource = o.getDeckSource || null;
            cfg.refresh = o.refresh || null;
            cfg.log = o.log || null;
            log('运行时已就绪');
        },

        renderSet: renderSet,
        renderBoard: renderBoard,
        // 供同一插件的其它运行时（如现场投票）复用行内渲染（含公式占位符处理）
        inline: inlineText,

        initIn: function (root) {
            if (!root || !root.querySelectorAll) return;
            Array.prototype.forEach.call(root.querySelectorAll('.quiz'), function (setEl) {
                if (setEl.getAttribute('data-ready')) return;
                setEl.setAttribute('data-ready', '1');
                try {
                    bindSet(setEl);
                    restoreSet(setEl);
                    updateFoot(setEl);
                } catch (e) { log('测验初始化失败: ' + e.message); }
            });
            Array.prototype.forEach.call(root.querySelectorAll('.quiz-board'), function (bEl) {
                if (bEl.getAttribute('data-ready')) return;
                bEl.setAttribute('data-ready', '1');
                try {
                    bindBoard(bEl);
                    updateBoard(bEl);
                } catch (e) { log('成绩单初始化失败: ' + e.message); }
            });
            if (!hasDeckSource()) {
                Array.prototype.forEach.call(root.querySelectorAll('.quiz'), function (setEl) {
                    if (setEl.getAttribute('data-ready') === '1') recordSeen(setEl);
                });
            }
        },

        refresh: refreshAll,
        resetDeck: resetDeck,

        // 给 presenter 选项卡用：整卷进度摘要
        progress: function () {
            var st = deckStats();
            return {
                total: st.total, answered: st.answered, correct: st.correct,
                score: st.score, points: st.points,
                text: st.total === 0 ? '本卷还没有 quiz 题目'
                    : '本卷共 ' + st.total + ' 题（满分 ' + fmt(st.points) + ' 分）· 已答 ' + st.answered +
                      ' · 正确 ' + st.correct + ' · 得分 ' + fmt(st.score)
            };
        },

        shutdown: function () {
            clearArmTimers();
            invCache = { src: null, list: null };
        }
    };
})(window);