/*!
 * MPS 插件 · Python 笔记本（marimo 风格）运行时
 * -----------------------------------------------------------------------------
 * 在幻灯片里渲染「反应式 Python 笔记本」：
 *   - ```marimo 代码块按 `# %%` 分隔单元格；也可直接粘贴 marimo 的 `@app.cell` 格式
 *   - 依赖关系由静态分析推导（单元格定义的名字 → 其它单元格引用的名字）
 *   - 按依赖顺序执行；上游出错时其下游单元格自动跳过
 *   - Python 由随插件内置的 Pyodide(WASM) 在本地执行，全程离线、不联网
 * ========================================================================== */
(function () {
    'use strict';

    /* 本文件所在目录：开发环境与打包后的相对路径一致，故可据此定位内置 Pyodide */
    var SELF = (function () {
        var s = document.currentScript;
        if (!s || !s.src) return './plugs/marimo/';
        return s.src.replace(/[^/?#]*$/, '');
    })();
    var PYODIDE_DIR = SELF + 'pyodide/';

    /* =====================================================================
       0. 超大运行时文件的「压缩投放」
       ---------------------------------------------------------------------
       pyodide.asm.wasm 原始体积 9.6MB，常超过静态托管平台的单文件上限。
       因此投放的是压缩版 pyodide.asm.wasm.gz（约 3.0MB），由运行时在本地解压
       后交给 Pyodide（Pyodide 内部用 fetch 取 wasm，这里拦截该请求）。
       同目录若仍有未压缩的 pyodide.asm.wasm，会自动回退为直接使用它。
       ===================================================================== */

    var baseFetch = null, shimFetch = null;

    function gzResponse(url) {
        return baseFetch(url, { credentials: 'same-origin' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            if (typeof DecompressionStream !== 'function') {
                throw new Error('浏览器不支持 DecompressionStream');
            }
            return new Response(r.body.pipeThrough(new DecompressionStream('gzip')), {
                headers: { 'Content-Type': 'application/wasm' }
            });
        });
    }

    // 取 fetch 的请求地址：可能是字符串、URL 对象或 Request 对象
    function urlOf(input) {
        try {
            if (typeof input === 'string') return input;
            if (input instanceof URL) return input.href;
            if (input && typeof input.url === 'string') return input.url;
            if (input && typeof input.href === 'string') return input.href;
            return String(input);
        } catch (e) { return ''; }
    }

    // 只在「Pyodide 取 wasm」这一小段时间里接管 fetch，取完立即还原。
    // 常驻接管会连带影响宿主与打包器：它们请求 pyodide.asm.wasm 时会拿到解压后的
    // 10MB 数据，导致打包产物无谓地变大（真实踩过的坑）。
    function installWasmShim() {
        // 在安装时才抓取当前 fetch：打包产物里宿主的「随包资产」shim 已经就位，
        // 这里要套在它外面，才能取到内嵌的 pyodide.asm.wasm.gz
        if (!baseFetch) baseFetch = window.fetch ? window.fetch.bind(window) : null;
        if (!baseFetch) return;
        if (!shimFetch) {
            shimFetch = function (input, init) {
                var url = urlOf(input);
                // 只接管 Pyodide 对 wasm 的取用，其它请求原样透传
                if (url.indexOf('pyodide.asm.wasm') < 0 || url.indexOf('.gz') >= 0) {
                    return baseFetch(input, init);
                }
                return gzResponse(url + '.gz').catch(function (e) {
                    console.warn('[plug:marimo] 未能使用压缩运行时（' + e.message + '），回退为原始 pyodide.asm.wasm');
                    return baseFetch(url, init);
                });
            };
        }
        if (window.fetch !== shimFetch) window.fetch = shimFetch;
    }

    function restoreFetch() {
        if (shimFetch && baseFetch && window.fetch === shimFetch) window.fetch = baseFetch;
    }

    /* =====================================================================
       1. Pyodide 载入（本地文件；首次用到笔记本时才载入）
       ===================================================================== */

    var PY = null, pyPromise = null, pyScriptLoaded = false;

    function injectScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.async = false;
            s.onload = function () { resolve(); };
            s.onerror = function () { reject(new Error('无法载入 ' + src)); };
            document.head.appendChild(s);
        });
    }

    // 注入 Python 侧的辅助函数：执行一个单元格并回传 JSON（stdout / stderr / 最后表达式 / 异常）
    var PY_HELPERS = [
        'import sys, io, ast, json, traceback',
        '_mps_ns = {}',
        'def _mps_reset():',
        '    global _mps_ns',
        '    _mps_ns = {}',
        'def _mps_exec(src):',
        '    out = io.StringIO()',
        '    err = io.StringIO()',
        '    old_out, old_err = sys.stdout, sys.stderr',
        '    sys.stdout, sys.stderr = out, err',
        '    res = {"stdout": "", "stderr": "", "text": "", "html": "", "error": ""}',
        '    try:',
        '        tree = ast.parse(src, mode="exec")',
        '        last = None',
        '        if tree.body and isinstance(tree.body[-1], ast.Expr):',
        '            last = ast.Expression(tree.body.pop().value)',
        '        if tree.body:',
        '            exec(compile(tree, "<cell>", "exec"), _mps_ns)',
        '        if last is not None:',
        '            val = eval(compile(last, "<cell>", "eval"), _mps_ns)',
        '            if val is not None:',
        '                res["text"] = repr(val)',
        '                h = getattr(val, "_repr_html_", None)',
        '                if callable(h):',
        '                    try: res["html"] = h()',
        '                    except Exception: pass',
        '    except Exception:',
        '        res["error"] = traceback.format_exc(limit=4)',
        '    finally:',
        '        sys.stdout, sys.stderr = old_out, old_err',
        '    res["stdout"] = out.getvalue()',
        '    res["stderr"] = err.getvalue()',
        '    return json.dumps(res)'
    ].join('\n');

    function ensurePyodide() {
        if (PY) return Promise.resolve(PY);
        if (pyPromise) return pyPromise;
        var head = pyScriptLoaded ? Promise.resolve()
            : injectScript(PYODIDE_DIR + 'pyodide.js').then(function () { pyScriptLoaded = true; });
        pyPromise = head.then(function () {
            if (!window.loadPyodide) throw new Error('pyodide.js 未提供 loadPyodide()');
            installWasmShim();                  // 必须在 loadPyodide 取 wasm 之前装好
            return window.loadPyodide({ indexURL: PYODIDE_DIR }).then(function (py) {
                restoreFetch();                 // wasm 已取完，立刻还原，避免影响宿主
                py.runPython(PY_HELPERS);
                PY = py;
                return py;
            }, function (e) {
                restoreFetch();
                throw e;
            });
        }).catch(function (e) {
            pyPromise = null;               // 允许下次重试
            throw e;
        });
        return pyPromise;
    }

    function runCellCode(py, code) {
        py.globals.set('_mps_src', code);
        return JSON.parse(py.runPython('_mps_exec(_mps_src)'));
    }

    /* =====================================================================
       2. 单元格解析
       ===================================================================== */

    function dedent(line) {
        if (/^ {4}/.test(line)) return line.slice(4);
        if (/^\t/.test(line)) return line.slice(1);
        return line;
    }

    function normCell(code) {
        var l = code.replace(/\s+$/, '').replace(/^\s*\n/, '').split('\n');
        while (l.length && l[0].trim() === '') l.shift();
        while (l.length && l[l.length - 1].trim() === '') l.pop();
        return l.join('\n');
    }

    // marimo 的样板代码：浏览器里没有 marimo 包，这些行必须剔除，
    // 否则粘贴真实 .py 笔记本会立刻 ModuleNotFoundError。
    function stripBoilerplate(lines) {
        var out = [], depth = 0, i, line, t;
        for (i = 0; i < lines.length; i++) {
            line = lines[i];
            t = line.trim();
            if (depth > 0) {                                     // 正在跳过一个多行调用
                depth += parens(line, '(') - parens(line, ')');
                if (depth < 0) depth = 0;
                continue;
            }
            if (/^import\s+marimo\b/.test(t) || /^from\s+marimo\b/.test(t)) continue;
            if (/^(?:app\s*=\s*)?(?:marimo|mo)\.App\s*\(/.test(t)) {
                depth = parens(line, '(') - parens(line, ')');
                if (depth < 0) depth = 0;
                continue;
            }
            out.push(line);
        }
        return out;
    }

    function parens(s, ch) {
        var n = 0, i;
        for (i = 0; i < s.length; i++) if (s.charAt(i) === ch) n++;
        return n;
    }

    // marimo 原生格式：@app.cell 装饰的函数，函数体即单元格
    function parseAppCells(lines) {
        var cells = [], i = 0;
        while (i < lines.length) {
            if (!/^\s*@app\.cell\b/.test(lines[i])) { i++; continue; }
            i++;
            while (i < lines.length && /^\s*@/.test(lines[i])) i++;             // 其它装饰器
            if (i >= lines.length || !/^\s*def\s/.test(lines[i])) continue;
            i++;
            var body = [];
            while (i < lines.length) {
                var ln = lines[i];
                if (ln.trim() === '') { body.push(''); i++; continue; }
                if (!/^( {4}|\t)/.test(ln)) break;                              // 回到顶层 → 单元格结束
                body.push(dedent(ln));
                i++;
            }
            while (body.length && body[body.length - 1].trim() === '') body.pop();
            while (body.length && /^return\b/.test(body[body.length - 1].trim())) {
                body.pop();                                                     // 去掉 marimo 的依赖声明
                while (body.length && body[body.length - 1].trim() === '') body.pop();
            }
            body = stripBoilerplate(body);
            while (body.length && body[body.length - 1].trim() === '') body.pop();
            if (body.length && body.some(function (l) { return l.trim() !== ''; })) {
                cells.push({ title: '', code: body.join('\n') });
            }
        }
        return cells;
    }

    // 幻灯简写：用 `# %%` 分隔（可选标题写在后面）
    function parseMarkerCells(lines) {
        var cells = [], cur = { title: '', code: [] };
        lines.forEach(function (ln) {
            var m = /^\s*#\s*%%\s*(.*)$/.exec(ln);
            if (m) {
                cells.push(cur);
                cur = { title: m[1].replace(/^\[|\]$/g, '').trim(), code: [] };
                return;
            }
            cur.code.push(ln);
        });
        cells.push(cur);
        return cells.map(function (c) {
            return { title: c.title, code: normCell(c.code.join('\n')) };
        }).filter(function (c) { return c.code !== ''; });
    }

    function parseCells(src) {
        var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
        var cells = /^\s*@app\.cell\b/m.test(src) ? parseAppCells(lines) : parseMarkerCells(lines);
        if (!cells.length) cells = [{ title: '', code: normCell(String(src || '')) }];
        return cells;
    }

    /* =====================================================================
       3. 依赖分析（静态近似：定义的名字 ∩ 其它单元格引用的名字）
       ===================================================================== */

    var PY_KEYWORDS = ('False None True and as assert async await break class continue def del elif else '
        + 'except finally for from global if import in is lambda nonlocal not or pass raise return try '
        + 'while with yield match case self').split(' ');

    function stripLiterals(code) {
        return String(code)
            .replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, '""')
            .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
            .replace(/'(?:\\.|[^'\\\n])*'/g, '""')
            .replace(/#[^\n]*/g, '');
    }

    function namesOf(text) {
        var ids = text.match(/[A-Za-z_]\w*/g) || [];
        var seen = {};
        ids.forEach(function (n) {
            if (PY_KEYWORDS.indexOf(n) < 0) seen[n] = 1;
        });
        return seen;
    }

    function defsOf(code) {
        var out = {};
        stripLiterals(code).split('\n').forEach(function (line) {
            if (/^\s/.test(line)) return;                       // 只统计顶层定义
            var m;
            if ((m = /^([A-Za-z_]\w*)\s*(?::[^=]*)?=(?!=)/.exec(line))) out[m[1]] = 1;
            if ((m = /^(?:async\s+)?def\s+([A-Za-z_]\w*)/.exec(line))) out[m[1]] = 1;
            if ((m = /^class\s+([A-Za-z_]\w*)/.exec(line))) out[m[1]] = 1;
            if ((m = /^import\s+(.+)$/.exec(line))) {
                m[1].split(',').forEach(function (p) {
                    var n = p.trim().split(/\s+as\s+/).pop();
                    if (n) out[n.split('.')[0]] = 1;
                });
            }
            if ((m = /^from\s+[\w.]+\s+import\s+(.+)$/.exec(line))) {
                m[1].replace(/[()]/g, '').split(',').forEach(function (p) {
                    var n = p.trim().split(/\s+as\s+/).pop();
                    if (n && n !== '*') out[n] = 1;
                });
            }
        });
        return out;
    }

    // 返回 { deps, next, order, cyclic }：索引均指单元格在源码中的位置
    function analyze(cells) {
        var n = cells.length, defs = [], refs = [], i, j;
        for (i = 0; i < n; i++) {
            defs[i] = defsOf(cells[i].code);
            refs[i] = namesOf(stripLiterals(cells[i].code).replace(/\.[A-Za-z_]\w*/g, '.'));
        }
        var deps = [], next = [];
        for (i = 0; i < n; i++) { deps[i] = []; next[i] = []; }
        for (j = 0; j < n; j++) {
            for (i = 0; i < n; i++) {
                if (i === j) continue;
                var hit = false;
                for (var name in refs[j]) {
                    // 本单元格自己定义的名字不算「对上游的依赖」。
                    // 否则演示现场新加的 `base = 99` 会和上面的 `base = 10`
                    // 互相指认，凭空造出一个循环依赖，整本全红。
                    if (defs[j][name]) continue;
                    if (defs[i][name]) { hit = true; break; }
                }
                if (hit) { deps[j].push(i); next[i].push(j); }
            }
        }
        // Kahn 拓扑排序（同层按源码顺序，保证结果稳定）
        var indeg = deps.map(function (d) { return d.length; });
        var order = [], done = {}, guard = 0;
        while (order.length < n && guard++ <= n * n) {
            var picked = -1;
            for (i = 0; i < n; i++) {
                if (!done[i] && indeg[i] === 0) { picked = i; break; }
            }
            if (picked < 0) break;
            done[picked] = 1;
            order.push(picked);
            next[picked].forEach(function (k) { indeg[k]--; });
        }
        var cyclic = {};
        for (i = 0; i < n; i++) if (!done[i]) { cyclic[i] = 1; order.push(i); }   // 成环的排在最后
        return { deps: deps, next: next, order: order, cyclic: cyclic };
    }

    /* =====================================================================
       4. 笔记本：DOM + 运行调度
       ===================================================================== */

    var notebooks = [];

    // 会话级记忆：演示现场用「＋ 新增单元格」加的单元格按 Markdown 原文记账，
    // 翻到别的幻灯片再翻回来时原样恢复；刷新页面即清空（不落盘）。
    var extrasByKey = {};

    function h(tag, cls, text) {
        var el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text != null) el.textContent = text;
        return el;
    }

    var STAT = { idle: '待运行', loading: '正在启动 Python 运行时…', running: '运行中…' };

    function Notebook(host) {
        this.host = host;
        this.src = decodeURIComponent(host.getAttribute('data-mps-marimo') || '');
        this.key = this.src;                       // 同一段 Markdown = 同一本笔记本
        this.cells = parseCells(this.src);
        this.baseCount = this.cells.length;        // 原文里的单元格数，之后的都是现场加的
        var extra = extrasByKey[this.key] || [];
        for (var e = 0; e < extra.length; e++) {
            this.cells.push({ title: '', code: extra[e] });
        }
        this.nodes = [];
        this.busy = false;
        this.dirty = false;
        this.failedCount = 0;
        this.timer = 0;
        this.destroyed = false;
        this.build();
        notebooks.push(this);
    }

    Notebook.prototype.build = function () {
        var self = this;
        this.root = h('div', 'mrm');
        this.root.addEventListener('keydown', stopKeyBubble);   // 内部打字不触发宿主翻页

        var head = h('div', 'mrm-head');
        head.appendChild(h('span', 'mrm-name', '🐍 Python 笔记本'));
        this.stateEl = h('span', 'mrm-state', STAT.idle + ' · ' + this.cells.length + ' 个单元格');
        head.appendChild(this.stateEl);
        var runBtn = h('button', 'mrm-btn', '↻ 重跑');
        runBtn.type = 'button';
        runBtn.title = '手动重跑：重置命名空间后按依赖顺序重新执行全部单元格。' +
            '打开幻灯片时已经自动跑过一次，这里用于「想从头再来一遍」（例如清掉单元格里累积的状态）。';
        runBtn.addEventListener('click', function (e) { e.stopPropagation(); self.schedule(0); });
        head.appendChild(runBtn);
        this.root.appendChild(head);

        this.box = h('div', 'mrm-cells');
        this.cells.forEach(function (cell) { self.buildCell(cell); });
        this.root.appendChild(this.box);

        // 演示现场加单元格：新单元格是普通单元格，参与依赖分析、上游改动时会跟着重算
        var foot = h('div', 'mrm-foot');
        var addBtn = h('button', 'mrm-add', '＋ 新增单元格');
        addBtn.type = 'button';
        addBtn.title = '在末尾新增一个空单元格：输入代码后自动运行；' +
            '它引用了上面的变量时，改动上游也会连带重算。' +
            '本次会话内翻页来回都会保留（刷新页面后清空）。';
        addBtn.addEventListener('click', function (e) {
            e.stopPropagation();                     // 舞台是「点哪儿都翻页」，按钮要拦住
            self.addCell();
        });
        foot.appendChild(addBtn);
        this.root.appendChild(foot);

        this.host.appendChild(this.root);
    };

    // 建一个单元格行（构造函数与「新增单元格」共用）
    Notebook.prototype.buildCell = function (cell) {
        var self = this;
        var i = this.nodes.length;                   // 追加在末尾，已有编号无需变动
        var row = h('div', 'mrm-cell');
        var gutter = h('div', 'mrm-gutter');
        gutter.title = '运行到此单元格' + (cell.title ? '（' + cell.title + '）' : '');
        var dot = h('span', 'mrm-dot');
        gutter.appendChild(h('span', 'mrm-idx', String(i + 1)));
        gutter.appendChild(dot);
        gutter.addEventListener('click', function (e) {
            e.stopPropagation();
            self.runTo(i);
        });

        var body = h('div', 'mrm-body');
        var ta = document.createElement('textarea');
        ta.className = 'mrm-code';
        ta.spellcheck = false;
        ta.value = cell.code;
        ta.placeholder = '在这里输入 Python…';
        self.syncRows(ta);
        ta.addEventListener('input', function () {
            self.syncRows(ta);
            self.rememberExtra(i, ta.value);
            self.schedule(600);
        });
        ta.addEventListener('keydown', function (e) {
            if (e.key === 'Tab') {                        // Tab 插入 4 空格，不跳焦点
                e.preventDefault();
                var s = ta.selectionStart, t = ta.selectionEnd;
                ta.value = ta.value.slice(0, s) + '    ' + ta.value.slice(t);
                ta.selectionStart = ta.selectionEnd = s + 4;
                self.syncRows(ta);
                self.schedule(600);
            }
        });
        var out = h('div', 'mrm-out');
        body.appendChild(ta);
        body.appendChild(out);

        row.appendChild(gutter);
        row.appendChild(body);
        this.box.appendChild(row);
        this.nodes.push({ row: row, dot: dot, ta: ta, out: out });
        return row;
    };

    // 末尾追加一个空单元格，并把焦点放进去，方便直接开打
    Notebook.prototype.addCell = function () {
        if (this.destroyed) return null;
        var cell = { title: '', code: '' };
        this.cells.push(cell);
        this.rememberExtra(this.cells.length - 1, '');
        this.buildCell(cell);
        this.setState('共 ' + this.cells.length + ' 个单元格' +
            (this.failedCount ? ' · ' + this.failedCount + ' 个出错' : ''),
            this.failedCount ? 'err' : 'ok');
        var n = this.nodes[this.nodes.length - 1];
        n.ta.focus();
        return n;
    };

    // 现场加的单元格（下标 ≥ baseCount）记进会话记忆，翻页回来还在
    Notebook.prototype.rememberExtra = function (i, code) {
        if (i < this.baseCount) return;
        var arr = extrasByKey[this.key] || (extrasByKey[this.key] = []);
        arr[i - this.baseCount] = code;
    };

    Notebook.prototype.syncRows = function (ta) {
        ta.rows = Math.max(1, ta.value.split('\n').length);
    };

    Notebook.prototype.syncFromDom = function () {
        var self = this;
        this.nodes.forEach(function (n, i) { self.cells[i].code = n.ta.value; });
    };

    Notebook.prototype.setState = function (text, cls) {
        this.stateEl.textContent = text;
        this.stateEl.className = 'mrm-state' + (cls ? ' mrm-' + cls : '');
    };

    Notebook.prototype.mark = function (i, state) {
        var n = this.nodes[i];
        if (!n) return;
        n.row.className = 'mrm-cell' + (state ? ' ' + state : '');
    };

    Notebook.prototype.clearOut = function (i) {
        var out = this.nodes[i].out;
        out.innerHTML = '';
        out.className = 'mrm-out';
    };

    Notebook.prototype.showResult = function (i, res) {
        var out = this.nodes[i].out;
        out.innerHTML = '';
        if (res.stdout) out.appendChild(h('pre', 'mrm-pre', res.stdout));
        if (res.stderr) out.appendChild(h('pre', 'mrm-pre mrm-warn', res.stderr));
        if (res.html) {
            var d = h('div', 'mrm-html');
            d.innerHTML = res.html;
            out.appendChild(d);
        }
        if (res.text) out.appendChild(h('div', 'mrm-repr', res.text));
        if (!out.childNodes.length) out.appendChild(h('div', 'mrm-empty', '（无输出）'));
    };

    Notebook.prototype.showError = function (i, text) {
        var out = this.nodes[i].out;
        out.innerHTML = '';
        out.className = 'mrm-out mrm-err';
        out.appendChild(h('pre', 'mrm-pre', text.replace(/\s+$/, '')));
    };

    Notebook.prototype.showSkip = function (i) {
        var out = this.nodes[i].out;
        out.innerHTML = '';
        out.className = 'mrm-out mrm-err';
        out.appendChild(h('pre', 'mrm-pre', '已跳过：上游单元格出错'));
    };

    Notebook.prototype.schedule = function (delay) {
        var self = this;
        if (this.destroyed) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(function () { self.run(); }, delay == null ? 500 : delay);
    };

    Notebook.prototype.run = function (upto) {
        var self = this;
        if (this.destroyed) return;
        if (this.busy) { this.dirty = true; this.pendingUpto = upto; return; }
        this.busy = true;
        this.setState(PY ? STAT.running : STAT.loading, 'run');
        ensurePyodide().then(function (py) {
            return self.execAll(py, upto);
        }).then(function () {
            self.busy = false;
            var st = self.failedCount
                ? '完成 · ' + self.failedCount + ' 个单元格出错 · ' + self.lastMs + ' ms'
                : '就绪 · ' + self.cells.length + ' 个单元格 · ' + self.lastMs + ' ms';
            self.setState(st, self.failedCount ? 'err' : 'ok');
            if (self.dirty) {
                self.dirty = false;
                var u = self.pendingUpto;
                self.pendingUpto = undefined;
                self.run(u);
            }
        }).catch(function (e) {
            self.busy = false;
            self.setState('Python 运行时启动失败：' + e.message, 'err');
            self.nodes.forEach(function (n, i) { self.showError(i, 'Python 运行时启动失败：' + e.message); });
        });
    };

    Notebook.prototype.runTo = function (i) {
        this.run(i);
    };

    Notebook.prototype.execAll = function (py, upto) {
        var self = this;
        this.syncFromDom();
        var info = analyze(this.cells);
        py.runPython('_mps_reset()');
        var order = info.order.slice();
        if (upto != null) {
            var pos = order.indexOf(upto);
            if (pos >= 0) order = order.slice(0, pos + 1);
        }
        var failed = {};
        var t0 = Date.now();
        this.failedCount = 0;

        function step(k) {
            if (k >= order.length) return null;
            var i = order[k];
            self.mark(i, 'run');
            if (info.cyclic[i]) {
                failed[i] = true;
                self.failedCount++;
                self.showError(i, '循环依赖：该单元格与其它单元格互相引用，无法确定运行顺序');
                self.mark(i, 'err');
                return step(k + 1);
            }
            if (info.deps[i].some(function (u) { return failed[u]; })) {
                failed[i] = true;
                self.showSkip(i);
                self.mark(i, 'skip');
                return step(k + 1);
            }
            var res;
            try {
                res = runCellCode(py, self.cells[i].code);
            } catch (e) {
                res = { error: String(e && e.message || e) };
            }
            if (res.error) {
                failed[i] = true;
                self.failedCount++;
                self.showError(i, res.error);
                self.mark(i, 'err');
            } else {
                self.showResult(i, res);
                self.mark(i, 'ok');
            }
            return step(k + 1);
        }
        return Promise.resolve(step(0)).then(function () {
            self.lastMs = Date.now() - t0;
        });
    };

    Notebook.prototype.destroy = function () {
        this.destroyed = true;
        clearTimeout(this.timer);
        if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
        var k = notebooks.indexOf(this);
        if (k >= 0) notebooks.splice(k, 1);
    };

    /* =====================================================================
       5. 对外接口
       ===================================================================== */

    // 键盘事件隔离：舞台是文档级的「点哪儿都翻页」，所以在笔记本根节点上于**冒泡阶段**
    // 截住，宿主就收不到；必须用冒泡而非 document 捕获——捕获阶段就截会让事件根本到不了
    // textarea，连正常打字都会被拦掉。
    function stopKeyBubble(e) { e.stopPropagation(); }

    function initIn(root) {
        if (!root || !root.querySelectorAll) return 0;
        var hosts = root.querySelectorAll('.mrm-host:not([data-mrm-ready])');
        var n = 0;
        Array.prototype.forEach.call(hosts, function (hostEl) {
            hostEl.setAttribute('data-mrm-ready', '1');
            try {
                var nb = new Notebook(hostEl);
                nb.schedule(80);        // 首次出现在舞台上即自动运行
                n++;
            } catch (e) {
                hostEl.textContent = 'Python 笔记本初始化失败：' + e.message;
            }
        });
        return n;
    }

    // 幻灯片重绘后，清掉已不在文档里的旧笔记本
    function cleanup() {
        notebooks.slice().forEach(function (nb) {
            if (!document.body.contains(nb.host)) nb.destroy();
        });
    }

    window.MPSMarimo = {
        initIn: initIn,
        cleanup: cleanup,
        loadRuntime: ensurePyodide,     // 供插件的「预加载运行时」按钮使用
        isReady: function () { return !!PY; },
        count: function () { return notebooks.length; }
    };
})();