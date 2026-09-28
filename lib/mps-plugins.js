/* =============================================================================
 * MPS 插件管理器（mps-plugins.js）
 * -----------------------------------------------------------------------------
 * engine 与 presenter 共用的插件宿主。负责：扫描清单 → 加载 → 启停 → 事件分发。
 *
 * 一、目录约定
 *   plugs/manifest.json                 清单（唯一扫描入口，浏览器无法读目录）
 *     { "version": 1, "plugins": ["mps-manim", "xxx"] }
 *   plugs/<id>/plugin.json              插件元数据
 *     {
 *       "id": "mps-manim",              必须与清单中的 id 一致
 *       "name": "数学动画",              插件管理界面显示名
 *       "description": "...",           一句话说明
 *       "version": "1.0.0",
 *       "author": "...",
 *       "entry": "index.js",            入口脚本（相对插件目录）
 *       "runtime": ["mps-manim.js"],    运行时依赖（可选，先于入口加载）
 *       "styles": ["plugin.css"],       样式表（可选）
 *       "files": ["plugin.json","index.js","mps-manim.js"],  打包时需随包的文件
 *       "defaultEnabled": false,        插件自报的默认启用状态
 *       "tabs": ["数学动画"]            声明式描述（仅用于插件管理界面展示）
 *     }
 *   plugs/<id>/index.js                 入口：调用 MPSPlugins.register({...})
 *
 * 二、插件写法
 *   MPSPlugins.register({
 *     id: 'mps-manim',
 *     setup(ctx) { ... },      启用时调用（注册 fence、注入选项卡、监听事件）
 *     teardown(ctx) { ... }    停用时调用（应撤销 setup 的一切副作用）
 *   });
 *   入口脚本只做注册，不要在加载期直接改动宿主状态——由宿主按启用状态决定是否
 *   调用 setup，这样插件「关闭」时不会产生任何副作用、也不需要下载运行时代码。
 *
 * 三、宿主上下文 ctx
 *   ctx.host                     'engine' | 'presenter'
 *   ctx.md                       markdown-it 实例
 *   ctx.registerFence(lang, fn)  注册围栏代码块渲染器；fn(token) 返回 HTML 字符串
 *                                lang 命中时优先于宿主内置规则（如 mermaid）
 *   ctx.addStyle(cssText)        注入一段 CSS（停用时自动移除）
 *   ctx.on(event, fn)            监听宿主事件，返回取消订阅函数
 *   ctx.refresh()                让宿主重新渲染当前幻灯片（fence 变更后必须调用）
 *   ctx.getSlideEl()             当前幻灯片根元素（不要硬编码 #slide）
 *   ctx.getDeckSource()          当前生效的整份 Markdown 源（可选能力；宿主未提供时为空串）
 *   ctx.nav                      宿主导航能力（可选能力；宿主未提供时为 null）
 *                                nav.slide/step/total/steps 实时读数（0 起；total 为总页数）
 *                                nav.next() / nav.prev() / nav.goto(slide, step)
 *                                仅当宿主每次翻页后调用 MPSPlugins.slideChanged() 时可用
 *   ctx.log(...)                 带插件名前缀的日志
 *   ctx.store.get(k, def)        插件私有持久化（localStorage，按插件隔离）
 *   ctx.store.set(k, v)
 *   ctx.ribbon                   仅 presenter 可用，见下
 *   ctx.setStatus(text)          仅 presenter 可用：写状态栏
 *   ctx.insertAtCursor(text)     仅 presenter 可用：向编辑器插入文本
 *
 *   事件：'blockRendered'(el) 每个内容块渲染进 DOM 后
 *         'slideChanged'({slide,step,total,steps}) 当前页/断点位置真正变化后
 *         'slideReset'()      幻灯片被清空/重建前
 *         'deckChanged'()     Markdown 源变化
 *         'pluginEnabled'/'pluginDisabled'/'pluginsReady'
 *
 * 四、选项卡 API（presenter）
 *   const tab = ctx.ribbon.addTab({ id:'manim', label:'数学动画', order:50 });
 *   tab.addGroupLabel('插入场景');
 *   tab.addButton({ id, icon, label, title, onClick });
 *   tab.addDivider();
 *   tab.addHint('说明文字（可含 HTML）');
 *   tab.remove();                停用时移除整个选项卡（由 teardown 调用）
 *   宿主选项卡自带 data-order（10/20/30…），插件按 order 插入到合适位置。
 *
 * 五、启用状态解析优先级
 *   1) 页面内置 window.MPS_PLUGINS_ENABLED（打包产物烘焙，保证观众端开箱可用）
 *   2) localStorage 中用户在本机的开关记录
 *   3) boot({ auto: true }) 的宿主默认（engine 等无管理界面者：扫描到即安装）
 *   4) plugin.json 的 defaultEnabled
 * ========================================================================== */
(function (global) {
    'use strict';

    var HOST = null;          // 'engine' | 'presenter'
    var BASE = './plugs/';    // 清单与插件目录根
    var STATE_KEY = 'mps.plugins.state';
    var ctxBase = null;       // 宿主注入的上下文基座

    var registry = {};        // id -> 记录（meta/def/state/loaded/资源引用）
    var order = [];           // id 顺序（按清单）
    var pluginFences = {};    // lang -> { id, fn }
    var listeners = {};       // event -> [fn]
    var hostFence = null;     // 宿主兜底 fence 规则
    var booted = false;
    var autoDefault = null;   // boot({auto:true}) 时为 true：扫描到即安装（engine 等无 UI 的宿主）

    // 打包产物用：清单/元数据直接内嵌（file:// 下 fetch 被拦，读不到 plugs/）
    var bakedList = null;     // [meta, ...]，由 MPSPlugins.bake() 或 window.MPS_PLUGINS_BAKED 提供
    var assets = null;        // url -> { bytes, mime }，插件运行时 fetch 不到资源时从这里取
    var fetchShimmed = false;
    var nativeFetch = null;

    /* ---------------- 打包产物的离线支持 ---------------- */

    // 把各种写法的 URL 归一化成一个相对路径键，用于在资产表里查找：
    //   ./plugs/a/b.wasm → plugs/a/b.wasm
    //   file:///D:/x/plugs/a/b.wasm → plugs/a/b.wasm
    //   http://host/plugs/a/b.wasm → plugs/a/b.wasm
    function assetKey(url) {
        var u = String(url == null ? '' : url);
        try {
            var base = (global.document && global.document.baseURI) || 'http://x/';
            u = new URL(u, base).pathname || u;
        } catch (e) {
            u = u.replace(/^[a-z]+:\/\/[^/]*/i, '');
        }
        u = u.replace(/[?#].*$/, '');
        u = u.replace(/^\/+/, '').replace(/^\.\//, '');
        try { u = decodeURIComponent(u); } catch (e) { /* 保留原样 */ }
        return u;
    }

    function findAsset(url) {
        if (!assets) return null;
        var k = assetKey(url);
        if (!k) return null;
        if (assets[k]) return assets[k];
        // 绝对路径（如 file:///D:/…）与键做后缀匹配
        for (var key in assets) {
            if (k === key || k.slice(-(key.length + 1)) === '/' + key) return assets[key];
        }
        return null;
    }

    // 安装 fetch 回退：只有「请求的正是随包资产」时才接管，其余一律透传。
    // 这样 file:// 下插件运行时的 fetch 也能拿到数据，且不影响宿主正常联网。
    function installAssetShim() {
        if (fetchShimmed || !assets) return;
        nativeFetch = global.fetch ? global.fetch.bind(global) : null;
        fetchShimmed = true;
        var shim = function (input, init) {
            var url = '';
            try {
                if (typeof input === 'string') url = input;
                else if (input instanceof URL) url = input.href;
                else if (input && typeof input.url === 'string') url = input.url;
            } catch (e) { url = ''; }
            var a = url ? findAsset(url) : null;
            if (a) {
                return Promise.resolve(new Response(a.bytes, {
                    status: 200,
                    headers: a.mime ? { 'Content-Type': a.mime } : {}
                }));
            }
            if (nativeFetch) return nativeFetch(input, init);
            return Promise.reject(new Error('fetch 不可用，且该资源未随包内嵌：' + url));
        };
        // 保住 abort 等能力：调用方若传了 signal，尽量传递
        global.fetch = shim;
    }

    // 由打包产物生成的 *.asset.js 调用：登记一份随包资源
    function bake(url, base64, mime) {
        if (!assets) assets = {};
        var bin = global.atob(base64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        assets[assetKey(url)] = { bytes: bytes, mime: mime || '' };
    }

    // 登记内嵌清单（打包产物调用；也可直接写 window.MPS_PLUGINS_BAKED）
    function bakeManifest(list) {
        if (Object.prototype.toString.call(list) === '[object Array]') bakedList = list;
    }

    /* ---------------- 工具 ---------------- */

    function tag(id) { return id ? '[plug:' + id + '] ' : '[plug] '; }
    function log(id, msg) { console.log(tag(id) + msg); }
    function warn(id, msg) { console.warn(tag(id) + msg); }

    function readState() {
        try {
            var raw = global.localStorage && global.localStorage.getItem(STATE_KEY);
            var obj = raw ? JSON.parse(raw) : {};
            return obj && typeof obj === 'object' ? obj : {};
        } catch (e) { return {}; }
    }

    function writeState(map) {
        try {
            if (global.localStorage) global.localStorage.setItem(STATE_KEY, JSON.stringify(map));
        } catch (e) { /* 隐私模式等场景静默忽略 */ }
    }

    // 启用状态解析：页面烘焙 > 用户覆盖 > 宿主 auto 默认 > 插件自报
    function resolveEnabled(meta) {
        var baked = global.MPS_PLUGINS_ENABLED;
        if (Object.prototype.toString.call(baked) === '[object Array]') {
            return baked.indexOf(meta.id) >= 0;
        }
        var st = readState();
        if (Object.prototype.hasOwnProperty.call(st, meta.id)) return !!st[meta.id];
        if (autoDefault !== null) return !!autoDefault;
        return !!meta.defaultEnabled;
    }

    function setUserState(id, on) {
        var st = readState();
        st[id] = !!on;
        writeState(st);
    }

    /* ---------------- 事件总线 ---------------- */

    function on(event, fn) {
        if (typeof fn !== 'function') return function () {};
        (listeners[event] || (listeners[event] = [])).push(fn);
        return function off() {
            var a = listeners[event] || [];
            var i = a.indexOf(fn);
            if (i >= 0) a.splice(i, 1);
        };
    }

    function fire(event, payload) {
        var a = (listeners[event] || []).slice();
        for (var i = 0; i < a.length; i++) {
            try { a[i](payload); } catch (e) { warn(null, '事件 ' + event + ' 处理失败: ' + e.message); }
        }
    }

    /* ---------------- 样式 ---------------- */

    function addStyle(cssText) {
        var el = global.document.createElement('style');
        el.setAttribute('data-mps-plugin-style', '1');
        el.textContent = cssText;
        global.document.head.appendChild(el);
        return el;
    }

    function removeNode(el) {
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    /* ---------------- 围栏渲染器 ---------------- */

    function langOf(token) {
        return String(token.info || '').trim().split(/\s+/)[0];
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>]/g, function (c) {
            return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
        });
    }

    // 安装到 markdown-it：先查插件注册的语言，其余交给宿主兜底规则
    function installFenceRule(md) {
        var prev = md.renderer.rules.fence;
        md.renderer.rules.fence = function (tokens, idx, options, env, self) {
            var token = tokens[idx];
            var lang = langOf(token);
            var reg = pluginFences[lang];
            if (reg) {
                try {
                    // 标记来源插件，宿主据此做点击穿透 / 事件隔离等通用处理
                    return '<div data-mps-plugin="' + reg.id + '">' + reg.fn(token, { lang: lang }) + '</div>';
                } catch (e) {
                    warn(reg.id, '渲染 ```' + lang + ' 失败: ' + e.message);
                    return '<pre data-mps-plugin="' + reg.id + '"><code>' + escapeHtml(token.content) + '</code></pre>';
                }
            }
            if (hostFence) return hostFence(tokens, idx, options, env, self);
            if (prev) return prev(tokens, idx, options, env, self);
            return self.renderToken(tokens, idx, options);
        };
    }

    /* ---------------- 选项卡（presenter） ---------------- */

    function makeRibbon() {
        if (HOST !== 'presenter') return undefined;
        var tabsRoot = global.document.querySelector('.ribbon-tabs');
        var panelsRoot = global.document.querySelector('.ribbon-panels');
        if (!tabsRoot || !panelsRoot) return undefined;

        return {
            addTab: function (opt) {
                var id = String(opt.id);
                var domId = 'tab-plug-' + id;
                if (global.document.getElementById(domId)) return null;
                var myOrder = opt.order || 100;

                var btn = global.document.createElement('button');
                btn.setAttribute('data-tab', domId);
                btn.setAttribute('data-order', String(myOrder));
                btn.textContent = opt.label || id;
                // 按 order 插入，保持与宿主选项卡的相对次序
                var anchor = null;
                var btns = tabsRoot.querySelectorAll('button');
                for (var i = 0; i < btns.length; i++) {
                    if (myOrder < (parseInt(btns[i].getAttribute('data-order') || '100', 10) || 0)) {
                        anchor = btns[i]; break;
                    }
                }
                tabsRoot.insertBefore(btn, anchor);

                var panel = global.document.createElement('div');
                panel.className = 'ribbon-panel';
                panel.id = domId;
                panelsRoot.appendChild(panel);

                var api = {
                    id: id,
                    el: panel,
                    button: btn,
                    addGroupLabel: function (text) {
                        var s = global.document.createElement('span');
                        s.className = 'group-label';
                        s.innerHTML = text;
                        panel.appendChild(s);
                        return s;
                    },
                    addHint: function (html) {
                        var s = global.document.createElement('span');
                        s.className = 'hint';
                        s.innerHTML = html;
                        panel.appendChild(s);
                        return s;
                    },
                    addDivider: function () {
                        var d = global.document.createElement('div');
                        d.className = 'divider';
                        panel.appendChild(d);
                        return d;
                    },
                    addButton: function (b) {
                        var el = global.document.createElement('button');
                        if (b.id) el.id = b.id;
                        el.title = b.title || b.label || '';
                        var ic = global.document.createElement('span');
                        ic.className = 'icon';
                        ic.textContent = b.icon || '';
                        var lb = global.document.createElement('span');
                        lb.className = 'label';
                        lb.textContent = b.label || '';
                        el.appendChild(ic); el.appendChild(lb);
                        if (typeof b.onClick === 'function') el.addEventListener('click', b.onClick);
                        panel.appendChild(el);
                        return el;
                    },
                    remove: function () {
                        // 若当前正停在该选项卡上，先切回第一个宿主选项卡
                        if (btn.classList.contains('active')) {
                            var first = tabsRoot.querySelector('button');
                            if (first) first.click();
                        }
                        removeNode(btn);
                        removeNode(panel);
                    }
                };
                return api;
            }
        };
    }

    /* ---------------- 上下文构建 ---------------- */

    // 向宿主取导航对象（可选能力；宿主未提供时返回 null）
    function rawNav() {
        try { return ctxBase && ctxBase.getNav ? ctxBase.getNav() : null; }
        catch (e) { return null; }
    }

    function navNum(v) { v = Number(v); return isFinite(v) ? v : 0; }

    // 包一层交给插件：读数走 getter（实时），动作做异常兜底
    function makeNav() {
        var nv = rawNav();
        if (!nv) return null;
        return {
            get slide() { return navNum(nv.slide); },
            get step() { return navNum(nv.step); },
            get total() { return navNum(nv.total); },
            get steps() { return navNum(nv.steps); },
            next: function () { try { nv.next(); } catch (e) { warn(null, 'nav.next 失败: ' + e.message); } },
            prev: function () { try { nv.prev(); } catch (e) { warn(null, 'nav.prev 失败: ' + e.message); } },
            goto: function (s, st) { try { nv.goto(s, st); } catch (e) { warn(null, 'nav.goto 失败: ' + e.message); } }
        };
    }

    function buildCtx(rec) {
        var id = rec.meta.id;
        var disposers = [];
        var ctx = {
            host: HOST,
            id: id,
            meta: rec.meta,
            md: ctxBase.md,
            log: function () {
                var a = Array.prototype.slice.call(arguments).map(String);
                log(id, a.join(' '));
            },
            registerFence: function (lang, fn) {
                lang = String(lang).toLowerCase();
                pluginFences[lang] = { id: id, fn: fn };
                rec.fences.push(lang);
                return function unregister() {
                    if (pluginFences[lang] && pluginFences[lang].id === id) delete pluginFences[lang];
                };
            },
            addStyle: function (css) {
                var el = addStyle(css);
                rec.styleEls.push(el);
                return el;
            },
            on: function (event, fn) {
                var off = on(event, fn);
                disposers.push(off);
                return off;
            },
            refresh: function () { if (ctxBase.refresh) ctxBase.refresh(); },
            // 取当前幻灯片根元素（插件不应硬编码 #slide，宿主自行决定）
            getSlideEl: function () { return ctxBase.getSlideEl ? ctxBase.getSlideEl() : null; },
            // 取当前生效的整份 Markdown 源（可选能力，宿主未提供时返回空串）
            getDeckSource: function () {
                try { return ctxBase.getDeckSource ? String(ctxBase.getDeckSource() || '') : ''; }
                catch (e) { return ''; }
            },
            // 宿主导航能力（可选能力，宿主未提供时为 null）。注意每次 enable 会重建，
            // 但内部读数与动作都指向宿主同一份状态，始终是实时的。
            nav: makeNav(),
            store: {
                get: function (k, def) {
                    try {
                        var raw = global.localStorage && global.localStorage.getItem('mps.plug.' + id + '.' + k);
                        return raw == null ? def : JSON.parse(raw);
                    } catch (e) { return def; }
                },
                set: function (k, v) {
                    try {
                        if (global.localStorage) global.localStorage.setItem('mps.plug.' + id + '.' + k, JSON.stringify(v));
                    } catch (e) { /* 忽略 */ }
                }
            }
        };
        if (HOST === 'presenter') {
            ctx.ribbon = makeRibbon();
            ctx.setStatus = function (t) { if (ctxBase.setStatus) ctxBase.setStatus(t); };
            ctx.insertAtCursor = function (t) { if (ctxBase.insertAtCursor) ctxBase.insertAtCursor(t); };
        }
        rec.disposers = disposers;
        return ctx;
    }

    /* ---------------- 加载与启停 ---------------- */

    function injectScript(src) {
        return new Promise(function (resolve, reject) {
            var s = global.document.createElement('script');
            s.src = src;
            s.async = false;
            s.onload = function () { resolve(); };
            s.onerror = function () { reject(new Error('脚本加载失败: ' + src)); };
            global.document.head.appendChild(s);
        });
    }

    function injectLink(href) {
        var l = global.document.createElement('link');
        l.rel = 'stylesheet';
        l.href = href;
        l.setAttribute('data-mps-plugin-style', '1');
        global.document.head.appendChild(l);
        return l;
    }

    function fetchJson(url) {
        return fetch(url, { cache: 'no-cache' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
            return r.json();
        });
    }

    function ensureLoaded(rec) {
        if (rec.loaded) return Promise.resolve();
        var meta = rec.meta;
        var dir = BASE + meta.id + '/';
        (meta.styles || []).forEach(function (f) { rec.linkEls.push(injectLink(dir + f)); });
        var chain = Promise.resolve();
        (meta.runtime || []).forEach(function (f) {
            chain = chain.then(function () { return injectScript(dir + f); });
        });
        return chain.then(function () {
            return injectScript(dir + (meta.entry || 'index.js'));
        }).then(function () {
            rec.loaded = true;
            if (!rec.def) warn(meta.id, '入口脚本已加载但未调用 MPSPlugins.register()');
        });
    }

    function enable(id, opts) {
        opts = opts || {};
        var rec = registry[id];
        if (!rec) return Promise.reject(new Error('未注册的插件: ' + id));
        if (rec.state === 'on') return Promise.resolve();
        rec.pending = true;
        return ensureLoaded(rec).then(function () {
            if (!rec.def) throw new Error('插件 ' + id + ' 未提供定义');
            rec.ctx = buildCtx(rec);
            if (typeof rec.def.setup === 'function') rec.def.setup(rec.ctx);
            rec.state = 'on';
            rec.pending = false;
            if (opts.persist !== false) setUserState(id, true);
            fire('pluginEnabled', { id: id, meta: rec.meta });
            if (opts.refresh !== false && ctxBase.refresh) ctxBase.refresh();
        }).catch(function (e) {
            rec.pending = false;
            throw e;
        });
    }

    function disable(id, opts) {
        opts = opts || {};
        var rec = registry[id];
        if (!rec || rec.state !== 'on') return Promise.resolve();
        try {
            if (rec.def && typeof rec.def.teardown === 'function') rec.def.teardown(rec.ctx);
        } catch (e) {
            warn(id, 'teardown 失败: ' + e.message);
        }
        // 兜底清理：撤销 fence 注册、事件订阅、注入的样式与 DOM
        rec.fences.forEach(function (lang) {
            if (pluginFences[lang] && pluginFences[lang].id === id) delete pluginFences[lang];
        });
        rec.fences = [];
        (rec.disposers || []).forEach(function (off) { try { off(); } catch (e) { /* 忽略 */ } });
        rec.disposers = [];
        (rec.styleEls || []).forEach(removeNode);
        rec.styleEls = [];
        rec.ctx = null;
        rec.state = 'off';
        rec.pending = false;
        if (opts.persist !== false) setUserState(id, false);
        fire('pluginDisabled', { id: id, meta: rec.meta });
        if (opts.refresh !== false && ctxBase.refresh) ctxBase.refresh();
        return Promise.resolve();
    }

    function register(def) {
        if (!def || !def.id) { warn(null, 'register() 缺少 id'); return; }
        var id = String(def.id);
        var rec = registry[id];
        if (!rec) {
            // 清单未声明却加载了脚本：按最小元数据登记并提示
            rec = registry[id] = {
                meta: { id: id, name: id }, state: 'off', loaded: true, ok: false,
                fences: [], disposers: [], styleEls: [], linkEls: []
            };
            order.push(id);
            warn(id, '插件未在 plugs/manifest.json 中声明');
        }
        rec.def = def;
        rec.loaded = true;
        log(id, '已注册');
        fire('pluginRegistered', { id: id, meta: rec.meta });
        // enable() 内部触发的注册不要再次进入 enable（pending 防重入）
        if (booted && !rec.pending && rec.state !== 'on' && resolveEnabled(rec.meta)) {
            enable(id, { persist: false }).catch(function (e) { warn(id, e.message); });
        }
    }

    /* ---------------- 引导：扫描清单并安装 ---------------- */

    function boot(opts) {
        opts = opts || {};
        if (opts.base) BASE = opts.base;
        // engine 这类没有管理界面的宿主：扫描到即安装（用户覆盖与烘焙清单仍优先）
        if (opts.auto) autoDefault = true;
        // 打包产物：清单与元数据已内嵌，无需 fetch（file:// 下也能装插件）
        if (!bakedList && global.MPS_PLUGINS_BAKED) bakeManifest(global.MPS_PLUGINS_BAKED);
        installAssetShim();
        var source = bakedList ? Promise.resolve(bakedList) : fetchJson(BASE + 'manifest.json').then(function (man) {
            var ids = (man && man.plugins) || [];
            if (!ids.length) { log(null, '清单为空，未安装任何插件'); return []; }
            return Promise.all(ids.map(function (id) {
                return fetchJson(BASE + id + '/plugin.json').then(function (meta) {
                    meta.id = meta.id || id;
                    return meta;
                }).catch(function (e) {
                    warn(id, '读取 plugin.json 失败: ' + e.message);
                    return null;
                });
            })).then(function (arr) {
                return arr.filter(Boolean);
            });
        });
        return source.then(function (metas) {
            metas.forEach(function (meta) {
                if (!meta || !meta.id) return;
                // 重新扫描时保留已有记录（loaded/state），只刷新元数据
                var exist = registry[meta.id];
                if (exist) {
                    exist.meta = meta;
                    exist.ok = true;
                    return;
                }
                registry[meta.id] = {
                    meta: meta, state: 'off', loaded: false, ok: true,
                    fences: [], disposers: [], styleEls: [], linkEls: []
                };
                order.push(meta.id);
            });
        }).then(function () {
            // 仅加载并启用解析为「开启」的插件；关闭的插件零开销
            var todo = order.filter(function (id) {
                var r = registry[id];
                return r && r.ok && resolveEnabled(r.meta);
            });
            return todo.reduce(function (chain, id) {
                return chain.then(function () {
                    return enable(id, { persist: false, refresh: false })
                        .catch(function (e) { warn(id, e.message); });
                });
            }, Promise.resolve());
        }).then(function () {
            booted = true;
            fire('pluginsReady', { list: list() });
            log(null, '插件就绪：' + list().filter(function (p) { return p.enabled; }).length +
                ' 个启用 / ' + list().length + ' 个已登记');
        }).catch(function (e) {
            booted = true;
            warn(null, '插件清单加载失败（缺少 plugs/manifest.json 或 fetch 不可用）: ' + e.message);
        });
    }

    function list() {
        return order.map(function (id) {
            var r = registry[id];
            if (!r) return null;
            return {
                id: id,
                name: r.meta.name || id,
                description: r.meta.description || '',
                version: r.meta.version || '',
                author: r.meta.author || '',
                icon: r.meta.icon || '',
                tabs: r.meta.tabs || [],
                defaultEnabled: !!r.meta.defaultEnabled,
                declared: !!r.ok,
                loaded: !!r.loaded,
                enabled: r.state === 'on'
            };
        }).filter(Boolean);
    }

    /* ---------------- 宿主入口 ---------------- */

    function init(cfg) {
        cfg = cfg || {};
        HOST = cfg.host || 'engine';
        ctxBase = cfg;
        if (cfg.base) BASE = cfg.base;
        hostFence = cfg.fence || null;
        if (cfg.md) installFenceRule(cfg.md);
        else warn(null, 'init() 未提供 md 实例，围栏插件将不可用');
    }

    // 宿主在渲染完一个内容块后调用，插件据此初始化自己的 DOM
    function blockRendered(el) { fire('blockRendered', el); }
    // 宿主在导航状态（页/断点位置）变化后调用，插件据此做联动（如自动前进、参数继承）
    // 宿主可能在每次重渲染时都调用，这里按「页/断点/总页数」去重，只有真的变化才广播
    var lastNavKey = null;
    function slideChanged() {
        var nv = rawNav();
        var cur = nv ? {
            slide: navNum(nv.slide), step: navNum(nv.step),
            total: navNum(nv.total), steps: navNum(nv.steps)
        } : { slide: -1, step: -1, total: 0, steps: 0 };
        var key = cur.slide + '/' + cur.step + '/' + cur.total;
        if (key === lastNavKey) return;
        lastNavKey = key;
        fire('slideChanged', cur);
    }
    function slideReset() { fire('slideReset'); }
    function deckChanged() { fire('deckChanged'); }

    global.MPSPlugins = {
        version: '1.0',
        init: init,
        boot: boot,
        register: register,
        setEnabled: function (id, on) { return on ? enable(id) : disable(id); },
        enable: function (id) { return enable(id); },
        disable: function (id) { return disable(id); },
        isEnabled: function (id) { return !!registry[id] && registry[id].state === 'on'; },
        list: list,
        on: on,
        fire: fire,
        blockRendered: blockRendered,
        slideChanged: slideChanged,
        slideReset: slideReset,
        deckChanged: deckChanged,
        refresh: function () { if (ctxBase && ctxBase.refresh) ctxBase.refresh(); },
        base: function () { return BASE; },
        // 打包产物用：内嵌清单与随包资产（见 plugs/README.md 第 8 节）
        bake: bake,
        bakeManifest: bakeManifest,
        assetCount: function () { return assets ? Object.keys(assets).length : 0; }
    };
})(window);