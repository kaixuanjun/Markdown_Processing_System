/*!
 * MPS 插件运行时 · 现场投票（window.MPSPoll）
 * -----------------------------------------------------------------------------
 * 把 ```poll 代码块变成「现场投票卡」：幻灯片上显示题目 + 二维码，
 * 观众用手机扫码进入投票页（vote.html），票数 / 词云在幻灯片上实时刷新。
 * ```poll-config 代码块提供 MQTT 连接配置（HiveMQ 等任意支持 WSS 的 broker）。
 *
 * 消息拓扑（room 由配置决定，默认 mps-poll）：
 *   mps/<room>/state   幻灯片 → 手机：当前题目（retained，晚到也能看到题目）
 *   mps/<room>/vote    手机 → 幻灯片：投票 {did, qid, nonce, v}
 *   mps/<room>/join    手机 → 幻灯片：上线通知（用于参与人数）
 *   mps/<room>/stats   幻灯片 → 手机：参与人数 / 总票数
 *
 * DSL（```poll 代码块正文）：
 *   title 现场投票          可选：卡片标题（手机端也显示配置里的 title）
 *   q 题干文字              必填（支持行内 Markdown 与 \( ... \) 公式）
 *   type single|multi|text  默认 single；multi 多选；text 文字（实时词云）
 *   opt 选项文字            单选 / 多选的选项（无需 * 标记）
 *
 * DSL（```poll-config 代码块正文，一行一条，# 开头为注释）：
 *   broker wss://xxxx.s1.eu.hivemq.cloud:8884/mqtt   必填：MQTT over WebSocket 地址
 *   user 账号 / pass 密码                            可选：broker 凭据
 *   room demo-classroom                              可选：房间号（一节课一个）
 *   vote https://站点/plugs/slide-quiz/vote.html      必填：手机投票页地址（二维码指向它）
 *   title 课堂投票                                    可选：手机端标题
 *
 * 零配置可用（给不熟悉技术的老师）：
 *   · 不写 ```poll-config 也能用：默认走公共测试通道 + 内置官方投票页地址，
 *     房间号自动生成（每台电脑一个，可用「换房间」按钮换新的一场）。
 *   · 投票页地址的解析顺序：poll-config 里的 vote → 自动推导当前站点同目录的
 *     plugs/slide-quiz/vote.html（需能探测到文件，公网 / 局域网地址均可）→ 内置默认地址。
 *   · 想要私密 / 稳定（推荐正式使用）：在 ```poll-config 里写自己的 HiveMQ 集群
 *     （免费 Serverless：100 并发连接），票就不再经过公共通道。
 *
 * 依赖：window.mqtt（MQTT.js，runtime 注入）、window.qrcode（qrcode-generator）。
 * 诚实说明：投递为 QoS 0 best-effort；免费 HiveMQ Serverless 是 100 并发连接。
 * 本文件只在加载期定义 window.MPSPoll，不产生任何副作用。
 * ========================================================================== */
(function (global) {
    'use strict';

    var doc = global.document;

    /* ======================= 样式 ======================= */

    var BASE_CSS = [
        '.poll-card{position:relative;margin:.9em 0;border:1px solid var(--border-color,#d0d7de);border-radius:12px;',
        'background:var(--bg-slide,#fff);padding:.8em .95em .7em;display:flex;gap:1em;align-items:flex-start;}',
        '.poll-card *{box-sizing:border-box;}',
        '.poll-main{flex:1 1 auto;min-width:0;}',
        '.poll-head{font-weight:700;font-size:1.02em;margin:0 0 .45em;padding-bottom:.35em;',
        'border-bottom:1px dashed var(--border-light,#e1e4e8);}',
        '.poll-q{line-height:1.8;margin:0 0 .5em;}',
        '.poll-opts{display:flex;flex-direction:column;gap:.34em;}',
        '.poll-opt{position:relative;display:flex;align-items:center;gap:.55em;padding:.4em .65em;',
        'border:1px solid var(--border-color,#d0d7de);border-radius:8px;overflow:hidden;}',
        '.poll-fill{position:absolute;left:0;top:0;bottom:0;width:0;background:var(--accent-soft,#ddf4ff);',
        'transition:width .35s cubic-bezier(.3,.9,.3,1);}',
        '.poll-lab{position:relative;flex:1 1 auto;min-width:0;line-height:1.65;}',
        '.poll-key{position:relative;flex:none;width:1.4em;height:1.4em;line-height:1.4em;text-align:center;',
        'border-radius:5px;background:var(--code-bg,#f6f8fa);color:var(--text-muted,#8b949e);',
        'font-size:.8em;font-weight:700;}',
        '.poll-cnt{position:relative;flex:none;color:var(--text-secondary,#57606a);font-size:.85em;',
        'font-variant-numeric:tabular-nums;}',
        '.poll-cloud{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.25em .6em;',
        'min-height:5em;padding:.6em .3em;border:1px dashed var(--border-light,#e1e4e8);border-radius:8px;}',
        '.poll-cloud span{line-height:1.25;}',
        '.poll-cloud .poll-empty{color:var(--text-muted,#8b949e);font-size:.85em;border:0;}',
        '.poll-meta{display:flex;align-items:center;gap:.5em;margin-top:.55em;',
        'color:var(--text-muted,#8b949e);font-size:.82em;flex-wrap:wrap;}',
        '.poll-pub{margin-left:auto;padding:0 .5em;border-radius:999px;background:rgba(210,153,34,.16);',
        'color:#9a6700;font-size:.92em;cursor:help;}',
        'body.dark-mode .poll-pub{background:rgba(210,153,34,.2);color:#d29922;}',
        '.poll-dot{width:.55em;height:.55em;border-radius:50%;background:#8b949e;flex:none;}',
        '.poll-card[data-conn="on"] .poll-dot{background:#1a7f37;}',
        '.poll-card[data-conn="connecting"] .poll-dot{background:#d29922;}',
        '.poll-card[data-conn="err"] .poll-dot{background:#cf222e;}',
        '.poll-side{flex:0 0 auto;width:9.5em;text-align:center;}',
        '.poll-qr{width:100%;padding:.35em;border:1px solid var(--border-light,#e1e4e8);border-radius:10px;',
        'background:#fff;}',
        '.poll-qr svg{display:block;width:100%;height:auto;}',
        '.poll-qr-empty{color:var(--text-muted,#8b949e);font-size:.75em;line-height:1.6;padding:1.1em .4em;}',
        '.poll-scan{margin-top:.3em;font-size:.8em;color:var(--text-secondary,#57606a);}',
        '.poll-url{margin-top:.15em;font-size:.68em;color:var(--text-muted,#8b949e);word-break:break-all;line-height:1.5;}',
        '.poll-qr-warn{margin-top:.35em;padding:.3em .45em;border-radius:6px;background:rgba(210,153,34,.14);',
        'color:#9a6700;font-size:.66em;line-height:1.6;text-align:left;}',
        '.poll-qr-warn[hidden]{display:none;}',
        'body.dark-mode .poll-qr-warn{background:rgba(210,153,34,.2);color:#d29922;}',
        '.poll-reset{position:absolute;right:.5em;top:.5em;border:0;background:transparent;cursor:pointer;',
        'color:var(--text-muted,#8b949e);font:inherit;font-size:.9em;padding:.15em .35em;border-radius:6px;',
        'opacity:.38;transition:opacity .15s,background .15s;}',
        '.poll-card:hover .poll-reset,.poll-reset:focus{opacity:1;}',
        '.poll-reset:hover{background:var(--code-bg,#f6f8fa);color:#cf222e;}',
        '.poll-reset.armed{opacity:1;color:#cf222e;background:rgba(207,34,46,.08);}',
        /* 配置状态条 */
        '.poll-conf{display:flex;align-items:center;gap:.5em;margin:.5em 0;padding:.35em .6em;',
        'border:1px dashed var(--border-color,#d0d7de);border-radius:8px;',
        'color:var(--text-muted,#8b949e);font-size:.8em;line-height:1.7;flex-wrap:wrap;}',
        '.poll-conf[data-conn="on"] .poll-dot{background:#1a7f37;}',
        '.poll-conf[data-conn="connecting"] .poll-dot{background:#d29922;}',
        '.poll-conf[data-conn="err"] .poll-dot{background:#cf222e;}',
        'body.dark-mode .poll-fill{background:rgba(88,166,255,.22);}',
        'body.dark-mode .poll-card[data-conn="on"] .poll-dot{background:#3fb950;}',
        'body.dark-mode .poll-card[data-conn="err"] .poll-dot{background:#f85149;}',
        '@media(max-width:560px){.poll-card{flex-direction:column;}.poll-side{width:8.5em;}}'
    ].join('');

    /* ======================= 状态 ======================= */

    var cfg = { store: null, getDeckSource: null, getSlideEl: null, refresh: null, log: null, defaultVoteUrl: '' };

    // 零配置的公共通道：公共测试 broker（全球共享、无需账号）。
    // 正式使用建议在 ```poll-config 里换成自己的 HiveMQ 集群，票就不经过公共通道。
    var PUBLIC_BROKER = 'wss://broker.hivemq.com:8884/mqtt';

    var conf = {
        broker: '', user: '', pass: '', room: '', vote: '', title: '现场投票',
        voteExplicit: '', roomExplicit: '',
        voteSrc: 'none',      // config | inferred | default | none
        publicBroker: true
    };
    var sessionRoom = '';     // 自动房间号（每台电脑一个）：换一场用「换房间」

    function genRoom() {
        var r = '';
        try {
            var a = new Uint32Array(3);
            global.crypto.getRandomValues(a);
            for (var i = 0; i < a.length; i++) r += (a[i] % 60466176).toString(36);
        } catch (e) { r = ''; }
        return 'pub-' + (r || Math.random().toString(36).slice(2, 12)).slice(0, 10);
    }
    function cachedRoom() {
        if (!sessionRoom) {
            sessionRoom = (cfg.store && cfg.store.get('room', '')) || '';
            if (!sessionRoom) { sessionRoom = genRoom(); if (cfg.store) cfg.store.set('room', sessionRoom); }
        }
        return sessionRoom;
    }
    function newRoom() {
        sessionRoom = genRoom();
        if (cfg.store) cfg.store.set('room', sessionRoom);
        return sessionRoom;
    }

    // 推断投票页：课件同目录下的 plugs/slide-quiz/vote.html
    // 返回 { url, local }；local=true 表示这台电脑自己的地址（localhost / file://），手机打不开。
    // 没有可推断的地址（如 about:blank）返回 ''。
    function inferredVote() {
        try {
            var p = global.location.protocol;
            var h = String(global.location.hostname || '').toLowerCase();
            var local = !h || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
            var offline = (p === 'file:');
            if (offline) local = true;
            else if (p !== 'http:' && p !== 'https:') return '';
            return {
                url: new global.URL('./plugs/slide-quiz/vote.html', global.location.href).href,
                local: local, offline: offline
            };
        } catch (e) { return ''; }
    }
    // 探测推断地址是否真的存在（不存在就退回内置默认，避免二维码指向 404）。
    // 结果按 URL 缓存：换房间 / 翻页重算配置时不重复探测。
    var probeCache = {};
    function probeVote(url, cb) {
        if (typeof probeCache[url] === 'boolean') { cb(probeCache[url]); return; }
        if (!global.fetch) { cb(true); return; }        // 探测不了就信任推断结果
        var done = false;
        var finish = function (ok) {
            if (done) return;
            done = true;
            probeCache[url] = !!ok;
            cb(!!ok);
        };
        var t = setTimeout(function () { finish(false); }, 4000);
        var head = function () {
            try {
                global.fetch(url, { method: 'HEAD', cache: 'no-store' }).then(function (r) {
                    clearTimeout(t);
                    if (r && r.ok) { finish(true); return; }
                    // 有些静态托管不支持 HEAD（405）：再用 GET 确认一次
                    if (r && (r.status === 405 || r.status === 501)) {
                        global.fetch(url, { method: 'GET', cache: 'no-store' }).then(function (r2) {
                            finish(!!r2 && r2.ok);
                        }).catch(function () { finish(false); });
                        return;
                    }
                    finish(false);
                }).catch(function () { clearTimeout(t); finish(false); });
            } catch (e) { clearTimeout(t); finish(false); }
        };
        head();
    }
    function finishVote() {
        cards.forEach(function (c) { c.qrDone = false; });
        refreshCards();
        renderConfNodes();
    }
    // 兜底：内置默认地址（plugin.json defaultVoteUrl）→ 本机地址（仍画二维码 + 警告）
    function fallbackVote(inf) {
        if (cfg.defaultVoteUrl) {
            conf.vote = cfg.defaultVoteUrl;
            conf.voteSrc = 'default';
            conf.voteWarn = '';
            finishVote();
            return;
        }
        if (inf) {
            conf.vote = inf.url;
            conf.voteSrc = 'local';
            conf.voteWarn = inf.offline
                ? '离线打开：此二维码手机扫不开 —— 双击「启动课堂投票（局域网）.bat」（plugs/slide-quiz/server/ 里，打包分享后就在课件根目录）会自动用内网地址重开本页。'
                : '本机地址（localhost）：此二维码手机扫不开 —— 双击「启动课堂投票（局域网）.bat」（plugs/slide-quiz/server/ 里）会自动用内网地址重开本页。';
            finishVote();
            return;
        }
        conf.vote = '';
        conf.voteSrc = 'none';
        conf.voteWarn = '';
        finishVote();
    }
    // 投票页地址解析：poll-config 的 vote → 自动推断（公网 / 局域网，需探测通过）
    //               → 内置默认（plugin.json）→ 本机地址（画二维码但提示手机打不开）
    function resolveVote() {
        conf.vote = '';
        conf.voteSrc = 'none';
        conf.voteWarn = '';
        if (conf.voteExplicit) {
            conf.vote = conf.voteExplicit;
            conf.voteSrc = 'config';
            return;
        }
        var inf = inferredVote();
        if (inf && !inf.local) {
            conf.vote = inf.url;
            conf.voteSrc = 'inferred';
            probeVote(inf.url, function (ok) {
                if (ok || conf.voteSrc !== 'inferred') return;
                fallbackVote(inf);      // 推断的文件不存在 → 用内置默认 / 本机地址
            });
            return;
        }
        fallbackVote(inf);
    }

    var wire = null;              // mqtt 客户端
    var conn = 'off';             // off | connecting | on | err
    var lastErr = '';
    var confSeen = '';            // 已应用的配置指纹（避免重复连接）
    var cards = [];               // 当前 DOM 中的投票卡记录
    var confNodes = [];           // 配置状态条节点
    var votes = {};               // room -> { did: { qid: {nonce, v, ts} } }
    var joins = {};               // room -> { did: ts }
    var drawTimer = 0, statsTimer = 0, armTimer = 0;
    var PATIENCE = 10 * 60 * 1000;   // 参与人数的有效期（10 分钟）

    function log(msg) { if (cfg.log) cfg.log(msg); }

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
        } catch (e) { return ''; }
    }
    function unb64(s) {
        try {
            var bin = global.atob(String(s || ''));
            var bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return new global.TextDecoder().decode(bytes);
        } catch (e) { return ''; }
    }

    function sanitizeRoom(r) {
        return String(r || '').trim().replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 40) || 'mps-poll';
    }
    function topics() {
        var r = sanitizeRoom(conf.room);
        return {
            room: r,
            state: 'mps/' + r + '/state',
            vote: 'mps/' + r + '/vote',
            join: 'mps/' + r + '/join',
            stats: 'mps/' + r + '/stats'
        };
    }
    function nonce() {
        return Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-4);
    }

    // 行内渲染复用测验运行时（含 \( ... \) 公式与宿主公式占位符处理）
    function inline(text) {
        if (global.MPSQuiz && global.MPSQuiz.inline) return global.MPSQuiz.inline(text);
        return esc(text);
    }

    /* ======================= 配置解析 ======================= */

    function parseConfig(src) {
        var out = {};
        String(src || '').split('\n').forEach(function (line) {
            line = line.replace(/\s+$/, '');
            if (!line || /^\s*#/.test(line)) return;
            var m = line.match(/^\s*([A-Za-z][A-Za-z-]*)\s+([\s\S]*)$/);
            if (!m) return;
            var k = m[1].toLowerCase(), v = m[2].trim();
            if (k === 'broker') out.broker = v;
            else if (k === 'user' || k === 'username') out.user = v;
            else if (k === 'pass' || k === 'password') out.pass = v;
            else if (k === 'room') out.room = v;
            else if (k === 'vote' || k === 'voteurl') out.vote = v;
            else if (k === 'title') out.title = v;
        });
        return out;
    }

    // 从整卷 Markdown 中收集所有 poll-config 代码块
    function collectConfigs(src) {
        var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
        var out = [], inF = false, ch = '', lang = '', buf = [];
        for (var i = 0; i < lines.length; i++) {
            var m = lines[i].match(/^\s*(`{3,}|~{3,})\s*([^\s`]*)\s*$/);
            if (m) {
                var c = m[1].charAt(0);
                if (!inF) { inF = true; ch = c; lang = m[2].toLowerCase(); buf = []; }
                else if (c === ch) {
                    if (lang === 'poll-config') out.push(buf.join('\n'));
                    inF = false; lang = ''; buf = [];
                }
                continue;
            }
            if (inF && lang === 'poll-config') buf.push(lines[i]);
        }
        return out;
    }

    // 合并并应用配置；broker / 凭据 / 房间 / 投票页变化时重连或重画。
    // useDefaultsOnly=true 表示「整卷里没有 poll-config」：清掉旧显式配置，回到零配置默认。
    function applyConfig(next, useDefaultsOnly) {
        next = next || {};
        var explicitVote = useDefaultsOnly ? '' : (next.vote != null ? next.vote : conf.voteExplicit);
        var roomExplicit = useDefaultsOnly ? '' : (next.room != null ? next.room : conf.roomExplicit);
        var merged = {
            broker: next.broker != null ? next.broker : conf.broker,
            user: next.user != null ? next.user : conf.user,
            pass: next.pass != null ? next.pass : conf.pass,
            title: next.title != null ? next.title : conf.title
        };
        if (useDefaultsOnly) { merged.broker = ''; merged.user = ''; merged.pass = ''; merged.title = '现场投票'; }

        var key = [merged.broker || '', merged.user || '', merged.pass || '',
            roomExplicit || '', explicitVote || '', merged.title || ''].join('\u0001');
        if (key === confSeen) { renderConfNodes(); return; }
        confSeen = key;

        conf.user = merged.user || '';
        conf.pass = merged.pass || '';
        conf.title = merged.title || '现场投票';
        conf.publicBroker = !merged.broker;                      // 没配 broker → 走公共测试通道
        conf.broker = merged.broker || PUBLIC_BROKER;
        conf.roomExplicit = roomExplicit || '';
        conf.room = sanitizeRoom(roomExplicit || cachedRoom());
        conf.voteExplicit = explicitVote || '';

        resolveVote();
        cards.forEach(function (card) { card.qrDone = false; });   // 配置变了，二维码要重画
        reconnect();
        renderConfNodes();
        refreshCards();
        log('现场投票：' + (conf.publicBroker ? '公共测试通道' : conf.broker) +
            ' · 房间 ' + conf.room + ' · 投票页 ' + (conf.vote || '未就绪'));
    }

    function applyDeck(source) {
        var src = source != null ? source : (cfg.getDeckSource ? cfg.getDeckSource() : '');
        var blocks = src ? collectConfigs(src) : [];
        if (blocks.length) applyConfig(parseConfig(blocks[blocks.length - 1]));
        else applyConfig({}, true);          // 没有配置块 → 零配置默认（公共通道 + 自动房间）
    }

    // 页面上出现投票卡或配置状态条时启动（懒启动：没投票内容就不连 broker）
    function ensureStarted() {
        var hasCard = false, i;
        for (i = 0; i < cards.length; i++) {
            if (doc.body.contains(cards[i].el)) { hasCard = true; break; }
        }
        if (!hasCard && !confNodes.length) return;
        applyDeck();
    }

    /* ======================= MQTT 连接 ======================= */

    function setConn(next, err) {
        conn = next;
        if (err) lastErr = String(err.message || err);
        confNodes.forEach(function (n) { n.setAttribute('data-conn', conn); });
        cards.forEach(function (card) { card.el.setAttribute('data-conn', conn); });
        renderConfNodes();
        refreshCards();
    }

    function reconnect() {
        if (wire) { try { wire.end(true); } catch (e) { /* 忽略 */ } wire = null; }
        if (!conf.broker) { setConn('off'); return; }
        if (!global.mqtt) { setConn('err', { message: '未加载 mqtt 客户端（mqtt.min.js）' }); return; }

        setConn('connecting');
        var opts = {
            clientId: 'mpsp-' + Math.random().toString(36).slice(2, 10),
            clean: true, keepalive: 30, reconnectPeriod: 3000, connectTimeout: 8000
        };
        if (conf.user) opts.username = conf.user;
        if (conf.pass) opts.password = conf.pass;

        try { wire = global.mqtt.connect(conf.broker, opts); }
        catch (e) { setConn('err', e); log('MQTT 连接失败: ' + e.message); return; }

        wire.on('connect', function () {
            setConn('on');
            var t = topics();
            wire.subscribe([t.vote, t.join], { qos: 0 }, function () { /* 忽略 */ });
            publishState();          // 重连后补发当前题目（retained）
            publishStats();
            log('MQTT 已连接：' + t.room);
        });
        wire.on('reconnect', function () { setConn('connecting'); });
        wire.on('close', function () { if (conn !== 'err') setConn('off'); });
        wire.on('error', function (e) {
            setConn('err', e);
            log('MQTT 错误: ' + ((e && e.message) || e));
        });
        wire.on('message', onMessage);
    }

    function publish(topic, payload, opts) {
        if (!wire || !wire.connected) return false;
        try { wire.publish(topic, JSON.stringify(payload), opts || { qos: 0 }); return true; }
        catch (e) { log('发布失败: ' + e.message); return false; }
    }

    /* ======================= 投票聚合 ======================= */

    function roomVotes() {
        var r = sanitizeRoom(conf.room);
        return votes[r] || (votes[r] = {});
    }
    function roomJoins() {
        var r = sanitizeRoom(conf.room);
        return joins[r] || (joins[r] = {});
    }

    function onMessage(topic, payload) {
        var msg;
        try { msg = JSON.parse(String(payload)); } catch (e) { return; }
        if (!msg || msg.t !== 'vote' && msg.t !== 'join') return;
        if (!msg.did) return;
        var now = Date.now();
        if (msg.t === 'join') {
            roomJoins()[msg.did] = now;
        } else {
            var all = roomVotes();
            var dev = all[msg.did] || (all[msg.did] = {});
            dev[msg.qid] = { nonce: String(msg.nonce == null ? '' : msg.nonce), v: msg.v, ts: now };
            roomJoins()[msg.did] = now;
        }
        scheduleDraw();
        scheduleStats();
    }

    function participants() {
        var seen = {}, n = 0, now = Date.now();
        var js = roomJoins();
        Object.keys(js).forEach(function (did) { if (now - js[did] < PATIENCE) { seen[did] = 1; } });
        var vs = roomVotes();
        Object.keys(vs).forEach(function (did) {
            var recs = vs[did], keep = false;
            Object.keys(recs).forEach(function (k) { if (now - recs[k].ts < PATIENCE) keep = true; });
            if (keep) seen[did] = 1;
        });
        Object.keys(seen).forEach(function () { n++; });
        return n;
    }

    function statsFor(card) {
        var out = { cnt: {}, total: 0, devices: 0, cloud: [] };
        var all = roomVotes();
        Object.keys(all).forEach(function (did) {
            var rec = all[did][card.qid];
            if (!rec || String(rec.nonce) !== String(card.nonce)) return;
            out.devices++;
            if (card.kind === 'text') {
                var w = String(rec.v == null ? '' : rec.v).trim().replace(/\s+/g, ' ').slice(0, 24);
                if (!w) return;
                var key = w.toLowerCase();
                out.cnt[key] = (out.cnt[key] || 0) + 1;
                out.total++;
            } else if (card.kind === 'multi' && Object.prototype.toString.call(rec.v) === '[object Array]') {
                rec.v.forEach(function (i) {
                    i = Number(i);
                    if (i >= 0 && i < card.opts.length) { out.cnt[i] = (out.cnt[i] || 0) + 1; out.total++; }
                });
            } else {
                var i2 = Number(rec.v);
                if (i2 >= 0 && i2 < card.opts.length) { out.cnt[i2] = (out.cnt[i2] || 0) + 1; out.total++; }
            }
        });
        return out;
    }

    function totalVotesFor(card) { return statsFor(card).total; }

    /* ======================= 卡片渲染 ======================= */

    function parsePoll(src) {
        var poll = { title: '', q: '', kind: 'single', opts: [], warn: '' };
        String(src || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
            var m = line.match(/^\s*([A-Za-z][A-Za-z-]*)\s+([\s\S]*)$/);
            if (!m) return;
            var k = m[1].toLowerCase(), v = m[2].trim();
            if (k === 'title') poll.title = v;
            else if (k === 'q' || k === 'question') poll.q = v;
            else if (k === 'type') {
                var t = v.toLowerCase();
                poll.kind = (t === 'multi' || t === '多选') ? 'multi'
                    : (t === 'text' || t === 'word' || t === '云' || t === '词云') ? 'text' : 'single';
            } else if (k === 'opt' || k === 'option') poll.opts.push(v);
        });
        if (!poll.q) poll.warn = '缺少题干：用 q 题干 写一行';
        else if (poll.kind !== 'text' && poll.opts.length < 2) poll.warn = '选择题至少写 2 条 opt 行';
        if (!poll.warn) {
            poll.qid = hash([poll.kind, poll.q, poll.opts.join('\u0003')].join('\u0002'));
        }
        return poll;
    }

    function renderPoll(src) {
        var poll = parsePoll(src);
        if (poll.warn) {
            return '<div class="poll-card poll-bad"><div class="poll-main">' +
                '<div class="poll-head">现场投票</div>' +
                '<div class="poll-q">' + inline(poll.q) + '</div>' +
                '<div class="poll-warn">⚙ ' + esc(poll.warn) + '</div></div></div>';
        }
        var optsHtml = '';
        if (poll.kind !== 'text') {
            optsHtml = '<div class="poll-opts">';
            poll.opts.forEach(function (o, i) {
                var key = poll.kind === 'single' ? String.fromCharCode(65 + i) : '☐';
                optsHtml += '<div class="poll-opt" data-i="' + i + '">' +
                    '<span class="poll-fill"></span>' +
                    '<i class="poll-key">' + key + '</i>' +
                    '<span class="poll-lab">' + inline(o) + '</span>' +
                    '<span class="poll-cnt">0</span></div>';
            });
            optsHtml += '</div>';
        } else {
            optsHtml = '<div class="poll-cloud" data-poll-cloud>' +
                '<span class="poll-empty">等待观众提交…</span></div>';
        }
        return '<div class="poll-card" data-poll="' + esc(b64(JSON.stringify(poll))) + '"' +
            ' data-qid="' + poll.qid + '" data-kind="' + poll.kind + '"' +
            ' data-nonce="' + nonce() + '" data-conn="' + conn + '">' +
            '<div class="poll-main">' +
            '<div class="poll-head">' + (poll.title ? inline(poll.title) : '现场投票') + '</div>' +
            '<div class="poll-q">' + inline(poll.q) + '</div>' + optsHtml +
            '<div class="poll-meta"><span class="poll-dot"></span>' +
            '<span data-poll-conn>未连接</span>' +
            '<span>·</span><span data-poll-room>房间 —</span>' +
            '<span>·</span><span><b data-poll-persons>0</b> 人已参与</span>' +
            '<span>·</span><span><b data-poll-votes>0</b> 票</span>' +
            '<span class="poll-pub" data-poll-pub hidden title="未配置自有 broker，正在使用公共测试通道；任何拿到房间号的人都能看到票数">公共通道</span>' +
            '</div>' +
            '</div>' +
            '<div class="poll-side"><div class="poll-qr" data-poll-qr></div>' +
            '<div class="poll-scan">扫码投票</div>' +
            '<div class="poll-url" data-poll-url></div>' +
            '<div class="poll-qr-warn" data-poll-qrwarn hidden></div></div>' +
            '<button type="button" class="poll-reset" title="清空本题票数（重新开始投票）">↺</button>' +
            '</div>';
    }

    // 二维码内容：投票页地址 + 连接参数（手机端无需任何配置）
    function voteUrl() {
        if (!conf.vote) return '';
        var t = topics();
        var parts = ['b=' + encodeURIComponent(conf.broker), 'r=' + encodeURIComponent(t.room)];
        if (conf.user) parts.push('u=' + encodeURIComponent(conf.user));
        if (conf.pass) parts.push('p=' + encodeURIComponent(conf.pass));
        if (conf.title) parts.push('n=' + encodeURIComponent(conf.title));
        return conf.vote + (conf.vote.indexOf('?') >= 0 ? '&' : '?') + parts.join('&');
    }

    function drawQr(card) {
        var box = card.el.querySelector('[data-poll-qr]');
        var urlBox = card.el.querySelector('[data-poll-url]');
        if (!box) return;
        var url = voteUrl();
        if (urlBox) {
            urlBox.textContent = url ? url.replace(/^https?:\/\//, '') : '';
            if (url) urlBox.setAttribute('data-href', url);   // 完整地址（便于复制 / 排错）
        }
        if (card.qrDone && card.qrUrl === url) return;
        card.qrUrl = url;
        card.qrDone = true;
        if (!url) {
            box.innerHTML = '<div class="poll-qr-empty">投票页未就绪<br>' +
                '① 把课件托管到网上（推荐，二维码会自动指向同站投票页）<br>' +
                '② 或让手机与电脑连同一 Wi-Fi，用电脑内网地址（192.168.x.x）打开本页<br>' +
                '③ 也可在 poll-config 里写 <code>vote 投票页地址</code></div>';
            return;
        }
        if (!global.qrcode) {
            box.innerHTML = '<div class="poll-qr-empty">未加载二维码库（qrcode.js）</div>';
            return;
        }
        try {
            var qr = null;
            for (var type = 4; type <= 20; type++) {
                qr = global.qrcode(type, 'M');
                qr.addData(url);
                try { qr.make(); break; } catch (e) { qr = null; }
            }
            if (!qr) { box.innerHTML = '<div class="poll-qr-empty">二维码内容过长</div>'; return; }
            box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
        } catch (e) {
            box.innerHTML = '<div class="poll-qr-empty">二维码生成失败：' + esc(e.message) + '</div>';
        }
    }

    function renderCard(card) {
        drawQr(card);
        var st = statsFor(card);
        var persons = participants();
        var pEl = card.el.querySelector('[data-poll-persons]');
        var vEl = card.el.querySelector('[data-poll-votes]');
        var rEl = card.el.querySelector('[data-poll-room]');
        var pubEl = card.el.querySelector('[data-poll-pub]');
        if (pEl) pEl.textContent = persons;
        if (vEl) vEl.textContent = st.total;
        if (rEl) rEl.textContent = '房间 ' + topics().room;
        if (pubEl) pubEl.hidden = !conf.publicBroker;
        var cEl = card.el.querySelector('[data-poll-conn]');
        if (cEl) {
            cEl.textContent = conn === 'on' ? '已连接' : conn === 'connecting' ? '连接中…'
                : conn === 'err' ? ('连接失败' + (lastErr ? '：' + lastErr : '')) : '未连接';
        }
        var wEl = card.el.querySelector('[data-poll-qrwarn]');
        if (wEl) {
            wEl.textContent = conf.voteWarn || '';
            wEl.hidden = !conf.voteWarn;
        }
        card.el.setAttribute('data-conn', conn);

        if (card.kind === 'text') {
            var cloud = card.el.querySelector('[data-poll-cloud]');
            if (!cloud) return;
            var keys = Object.keys(st.cnt);
            if (!keys.length) {
                cloud.innerHTML = '<span class="poll-empty">等待观众提交…</span>';
                return;
            }
            var max = 1;
            keys.forEach(function (k) { max = Math.max(max, st.cnt[k]); });
            var palette = ['#0969da', '#1a7f37', '#9a6700', '#cf222e', '#8250df', '#0550ae', '#116329'];
            cloud.innerHTML = keys.map(function (k, i) {
                var size = (0.85 + 1.15 * Math.sqrt(st.cnt[k] / max)).toFixed(2);
                return '<span title="' + st.cnt[k] + ' 票" style="font-size:' + size + 'em;color:' +
                    palette[i % palette.length] + '">' + esc(k) + '</span>';
            }).join('');
            return;
        }

        Array.prototype.forEach.call(card.el.querySelectorAll('.poll-opt'), function (row) {
            var i = Number(row.getAttribute('data-i'));
            var n = st.cnt[i] || 0;
            var pct = st.total ? Math.round(n / st.total * 100) : 0;
            var fill = row.querySelector('.poll-fill');
            if (fill) {
                fill.style.width = (!n ? 0 : Math.max(3, Math.round(n / maxOf(st) * 100))) + '%';
            }
            var cnt = row.querySelector('.poll-cnt');
            if (cnt) cnt.textContent = st.total ? (n + ' · ' + pct + '%') : '0';
        });
    }
    function maxOf(st) {
        var m = 1;
        Object.keys(st.cnt).forEach(function (k) { m = Math.max(m, st.cnt[k]); });
        return m;
    }

    function refreshCards() {
        cards = cards.filter(function (c) { return doc.body.contains(c.el); });
        cards.forEach(renderCard);
    }
    function scheduleDraw() {
        if (drawTimer) return;
        drawTimer = setTimeout(function () { drawTimer = 0; refreshCards(); }, 150);
    }
    function scheduleStats() {
        if (statsTimer) return;
        statsTimer = setTimeout(function () { statsTimer = 0; publishStats(); }, 400);
    }

    // 手机端不渲染 Markdown / 公式，发纯文本（去掉强调标记与公式定界符）
    function plainText(s) {
        return String(s == null ? '' : s)
            .replace(/\\\(|\\\)|\\\[|\\\]/g, '')
            .replace(/\*\*?|`|__/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function publishState(card) {
        var target = card;
        if (!target) {
            for (var i = cards.length - 1; i >= 0; i--) {
                if (doc.body.contains(cards[i].el)) { target = cards[i]; break; }
            }
        }
        if (!target) return false;
        return publish(topics().state, {
            v: 1, t: 'state', qid: target.qid, nonce: target.nonce, kind: target.kind,
            q: plainText(target.q), opts: target.opts.map(plainText),
            title: conf.title || target.title || '现场投票', ts: Date.now()
        }, { retain: true, qos: 0 });
    }

    function publishStats() {
        publish(topics().stats, {
            v: 1, t: 'stats', n: participants(), votes: cards.reduce(function (a, c) { return a + totalVotesFor(c); }, 0)
        }, { qos: 0 });
    }

    /* ======================= 配置状态条 ======================= */

    function renderConfig(src) {
        return '<div class="poll-conf" data-poll-conf="' + esc(b64(src || '')) + '" data-conn="' + conn + '">' +
            '<span class="poll-dot"></span><span data-poll-conf-text>现场投票 · 未配置</span></div>';
    }

    function renderConfNodes() {
        confNodes = confNodes.filter(function (n) { return doc.body.contains(n); });
        confNodes.forEach(function (n) {
            n.setAttribute('data-conn', conn);
            var txt = n.querySelector('[data-poll-conf-text]');
            if (!txt) return;
            var t = topics();
            var st = conn === 'on' ? '已连接' : conn === 'connecting' ? '连接中…'
                : conn === 'err' ? ('连接失败' + (lastErr ? '：' + lastErr : '')) : '未连接';
            var bits = ['现场投票', '房间 ' + t.room, st];
            if (conf.publicBroker) bits.push('公共测试通道');
            if (conn === 'on') bits.push(participants() + ' 人在线');
            if (conf.voteSrc === 'none') bits.push('投票页未就绪');
            else if (conf.voteSrc === 'local') bits.push('投票页是本机地址（手机打不开）');
            txt.textContent = bits.join(' · ');
        });
    }

    /* ======================= 重置 ======================= */

    // 清空单张卡的票数并换 nonce（手机端据此允许重新投票）
    function resetCard(card) {
        var rv = roomVotes();
        Object.keys(rv).forEach(function (did) { delete rv[did][card.qid]; });
        card.nonce = nonce();
        card.el.setAttribute('data-nonce', card.nonce);
        publishState(card);
        publishStats();
        refreshCards();
        renderConfNodes();
    }

    /* ======================= 对外 API ======================= */

    global.MPSPoll = {
        CSS: BASE_CSS,

        configure: function (o) {
            o = o || {};
            cfg.store = o.store || null;
            cfg.getDeckSource = o.getDeckSource || null;
            cfg.getSlideEl = o.getSlideEl || null;
            cfg.refresh = o.refresh || null;
            cfg.log = o.log || null;
            cfg.defaultVoteUrl = (o.meta && o.meta.defaultVoteUrl) || '';   // 插件内置投票页（plugin.json 可配）
            // 懒启动：等页面上真的出现投票卡 / 配置块时再连 broker，避免纯测验课件空连
            log('运行时就绪（' + (cfg.defaultVoteUrl ? '内置投票页 ' + cfg.defaultVoteUrl : '投票页按需推断') + '）');
        },

        renderPoll: renderPoll,
        renderConfig: renderConfig,

        initIn: function (root) {
            if (!root || !root.querySelectorAll) return;

            // 配置状态条：顺带把配置应用进来（宿主没有 getDeckSource 时的兜底）
            Array.prototype.forEach.call(root.querySelectorAll('[data-poll-conf]'), function (n) {
                if (n.getAttribute('data-ready')) return;
                n.setAttribute('data-ready', '1');
                confNodes.push(n);
                try { applyConfig(parseConfig(unb64(n.getAttribute('data-poll-conf')))); }
                catch (e) { log('配置解析失败: ' + e.message); }
            });

            // 投票卡
            Array.prototype.forEach.call(root.querySelectorAll('.poll-card[data-qid]'), function (el) {
                if (el.getAttribute('data-ready')) return;
                el.setAttribute('data-ready', '1');
                var info = {};
                try { info = JSON.parse(unb64(el.getAttribute('data-poll'))); } catch (e) { /* 忽略 */ }
                var card = {
                    el: el,
                    qid: el.getAttribute('data-qid'),
                    kind: el.getAttribute('data-kind') || 'single',
                    nonce: el.getAttribute('data-nonce') || nonce(),
                    q: info.q || '', opts: info.opts || [], title: info.title || ''
                };
                var btn = el.querySelector('.poll-reset');
                if (btn) {
                    btn.addEventListener('click', function () {
                        if (btn.getAttribute('data-arm')) {
                            btn.removeAttribute('data-arm');
                            btn.classList.remove('armed');
                            resetCard(card);
                            return;
                        }
                        btn.setAttribute('data-arm', '1');
                        btn.classList.add('armed');
                        if (armTimer) clearTimeout(armTimer);
                        armTimer = setTimeout(function () {
                            btn.removeAttribute('data-arm');
                            btn.classList.remove('armed');
                        }, 3000);
                    });
                }
                cards.push(card);
                renderCard(card);
                publishState(card);       // 当前页题目（retained），扫码后手机立即看到
                publishStats();
            });

            if (!conf.broker) ensureStarted();     // 页面上刚出现投票卡 / 配置块 → 按需启动（含零配置默认）
        },
        // 供宿主事件调用：文档变化后重新读配置（没有配置块时用零配置默认）
        applyDeck: applyDeck,

        status: function () {
            var t = topics();
            var ch = conf.publicBroker ? '公共测试通道' : conf.broker;
            return {
                conn: conn, room: t.room, broker: conf.broker, vote: conf.vote,
                voteSrc: conf.voteSrc, publicBroker: conf.publicBroker,
                persons: participants(),
                text: (conn === 'on'
                    ? '现场投票已连接 · 房间 ' + t.room + ' · ' + ch + ' · ' + participants() + ' 人在线'
                    : (conn === 'connecting' ? '现场投票连接中…（' + ch + '）'
                        : '现场投票未连接' + (lastErr ? '：' + lastErr : '')))
                    + (conf.vote ? '' : ' · 投票页未就绪')
            };
        },

        // 换一场（新房间号）：清掉自动房间的旧票与 retained 题目，重新出题
        rollRoom: function () {
            if (conf.roomExplicit) {
                return { ok: false, room: conf.room, reason: 'poll-config 里固定了房间 ' + conf.roomExplicit + '，请改配置里的 room' };
            }
            newRoom();
            confSeen = '';                      // 强制重算配置（房间变了要重连）
            applyConfig({}, true);
            return { ok: true, room: conf.room };
        },

        // 清空当前页（或全部）投票并换 nonce，让手机端可以重新投
        reset: function (all) {
            var pool = all ? cards : cards.filter(function (c) { return doc.body.contains(c.el); });
            if (!pool.length) return 0;
            var rv = roomVotes();
            var qids = {};
            pool.forEach(function (c) { qids[c.qid] = 1; });
            Object.keys(rv).forEach(function (did) {
                Object.keys(qids).forEach(function (q) { delete rv[did][q]; });
            });
            pool.forEach(function (card) {
                card.nonce = nonce();
                card.el.setAttribute('data-nonce', card.nonce);
            });
            publishState();
            publishStats();
            refreshCards();
            renderConfNodes();
            return pool.length;
        },

        shutdown: function () {
            if (drawTimer) { clearTimeout(drawTimer); drawTimer = 0; }
            if (statsTimer) { clearTimeout(statsTimer); statsTimer = 0; }
            if (armTimer) { clearTimeout(armTimer); armTimer = 0; }
            if (wire) { try { wire.end(true); } catch (e) { /* 忽略 */ } wire = null; }
            conn = 'off';
            confSeen = '';
            cards = [];
            confNodes = [];
        }
    };
})(window);