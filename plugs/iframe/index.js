/*!
 * MPS 插件 · iframe 播放器（id: iframe）
 * -----------------------------------------------------------------------------
 * 把 ```iframe 代码块渲染为第三方平台播放器，并在 presenter 注入「iframe 播放器」
 * 选项卡（各平台插入模板）。
 *
 * DSL：第一行是主行（平台 + id，或 url + 地址），其余行是可选参数。
 *   bilibili BV1xx411c7mD       哔哩哔哩（也接受 av12345）
 *   netease 26092806            网易云音乐 · 单曲
 *   netease-playlist 668975259  网易云音乐 · 歌单
 *   youtube dQw4w9WgXcQ         YouTube
 *   vimeo 76979871              Vimeo
 *   url https://a.com/embed     任意地址
 *   ratio 16:9                  画幅（默认 16:9）
 *   height 320                  直接指定高度（px，优先于 ratio）
 *   height auto                 自动高度：按嵌入页面的真实内容高度撑开
 *                               （同源可测；跨域读不到内容高度时自动回退为铺满一页）
 *   height fit                  自动高度：铺满幻灯片剩余可用高度（与 height 100% 等价）
 *   height 60%                  自动高度：占可用高度的 60%（10%–100%）
 *   title 说明文字               播放器下方的说明，同时提供「新窗口打开」入口
 *
 * 兼容：也可以把其他平台复制的整段嵌入代码直接粘进来（含 <iframe …></iframe>），
 * 自动识别 src 与 width / height / style / allow / scrolling / loading / title 属性；
 * 代码块内的 ratio / height / title 行仍可覆盖识别结果，# 开头的注释行会被忽略。
 *
 * 尺寸优先级：height auto / fit / 百分比 > 像素 height > 平台预设高度 > ratio 画幅。
 * auto / fit 先用画幅占位，块入 DOM 后由 blockRendered 测量并改写为像素高度；
 * 舞台尺寸变化（窗口缩放、分屏拖动、放映）时会重新计算铺满高度。
 * ========================================================================== */
(function () {
    'use strict';

    /* ---------------- 平台 → 播放器地址 ---------------- */

    var PLATFORMS = {
        bilibili: {
            label: '哔哩哔哩',
            url: function (id) {
                // BV 号用 bvid，av 号用 aid
                var q = /^av\d+$/i.test(id) ? 'aid=' + id.replace(/^av/i, '') : 'bvid=' + id;
                return 'https://player.bilibili.com/player.html?' + q +
                    '&page=1&high_quality=1&danmaku=0&autoplay=0';
            }
        },
        netease: {
            label: '网易云音乐',
            height: 66,
            maxWidth: 480,
            url: function (id) {
                return 'https://music.163.com/outchain/player?type=2&id=' +
                    encodeURIComponent(id) + '&auto=0&height=66';
            }
        },
        'netease-playlist': {
            label: '网易云歌单',
            height: 430,
            url: function (id) {
                return 'https://music.163.com/outchain/player?type=0&id=' +
                    encodeURIComponent(id) + '&auto=0&height=430';
            }
        },
        youtube: {
            label: 'YouTube',
            url: function (id) { return 'https://www.youtube.com/embed/' + encodeURIComponent(id); }
        },
        vimeo: {
            label: 'Vimeo',
            url: function (id) { return 'https://player.vimeo.com/video/' + encodeURIComponent(id); }
        }
    };

    var CSS = [
        '.ifp{margin:.85em auto;max-width:100%;}',
        '.ifp-box{position:relative;width:100%;background:#000;border:1px solid var(--border-light,#e1e4e8);',
        'border-radius:10px;overflow:hidden;}',
        '.ifp-box iframe{display:block;width:100%;height:100%;border:0;}',
        '.ifp[data-ifp-mode] .ifp-box{min-height:60px;}',
        '.ifp-bar{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:12px;',
        'color:var(--text-secondary,#57606a);}',
        '.ifp-tag{flex-shrink:0;font-size:10px;letter-spacing:.5px;border:1px solid currentColor;',
        'border-radius:20px;padding:1px 7px;opacity:.7;white-space:nowrap;}',
        '.ifp-mode{flex-shrink:0;font-size:10px;letter-spacing:.5px;border-radius:20px;padding:1px 7px;',
        'background:var(--accent-soft,rgba(9,105,218,.12));color:var(--accent,#0969da);white-space:nowrap;}',
        '.ifp-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
        '.ifp-bar a{flex-shrink:0;color:var(--accent,#0969da);text-decoration:none;}',
        '.ifp-bar a:hover{text-decoration:underline;}',
        '.ifp-err{padding:.7em .9em;border:1px dashed var(--border-color,#d0d7de);border-radius:10px;',
        'font-size:12px;line-height:1.7;color:var(--text-muted,#8b949e);white-space:pre-wrap;}'
    ].join('');

    var TIP = '格式：第一行写「平台 id」或「url 地址」，可选行有 ratio / height / title；' +
        'height 支持像素、auto（按内容自适应）、fit 或百分比（铺满可用高度）；' +
        '也可以直接粘贴其他平台复制的 <iframe …></iframe> 嵌入代码。' +
        '支持 ' + Object.keys(PLATFORMS).join(' / ') + ' 。';

    /* ---------------- DSL 解析 ---------------- */

    // 去掉 # 注释行（注释里可能出现示例 <iframe>，不能参与识别）
    function stripComments(src) {
        return String(src == null ? '' : src).split(/\r?\n/).filter(function (l) {
            return l.trim().charAt(0) !== '#';
        }).join('\n');
    }

    // 取第一段 <iframe …> 标签（多行属性也能匹配）
    function findIframeTag(src) {
        var m = /<iframe\b[^>]*>/i.exec(src);
        return m ? m[0] : null;
    }

    // 解析标签属性：双引号 / 单引号 / 无引号三种写法都支持
    function parseAttrs(tag) {
        var attrs = {};
        var body = String(tag).replace(/^<\s*iframe\b/i, '').replace(/\/?>\s*$/, '');
        var re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
        var m;
        while ((m = re.exec(body))) {
            var v = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
            attrs[m[1].toLowerCase()] = v;
        }
        return attrs;
    }

    // 还原嵌入代码里的常见实体（复制来的 src 中 & 常写成 &amp;）
    function unescapeEntities(s) {
        return String(s == null ? '' : s)
            .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"').replace(/&#0*39;|&#x0*27;/gi, "'")
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&');
    }

    // 地址归一化：协议相对（//xx）补 https，只接受 http/https
    function normalizeUrl(u) {
        u = unescapeEntities(u).trim();
        if (/^\/\//.test(u)) return 'https:' + u;
        return /^https?:\/\//i.test(u) ? u : '';
    }

    // 单个尺寸值 → 像素整数（只认纯数字 / px；百分比交给自动高度）
    function pixelSize(v) {
        var m = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(String(v == null ? '' : v));
        return m ? Math.round(parseFloat(m[1])) : 0;
    }

    // 从 style / width / height 属性提取像素尺寸
    function sizeOf(attrs) {
        var style = String(attrs.style || '');
        var mw = /(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)\s*px\b/i.exec(style);
        var mh = /(?:^|;)\s*height\s*:\s*(\d+(?:\.\d+)?)\s*px\b/i.exec(style);
        return {
            w: mw ? Math.round(parseFloat(mw[1])) : pixelSize(attrs.width),
            h: mh ? Math.round(parseFloat(mh[1])) : pixelSize(attrs.height)
        };
    }

    // 合并 allow：保留粘贴代码里的能力，同时补齐播放器常用能力
    function mergeAllow(extra) {
        var base = ['autoplay', 'encrypted-media', 'fullscreen', 'picture-in-picture'];
        String(extra || '').split(';').forEach(function (s) {
            s = s.trim();
            var dup = false;
            for (var i = 0; i < base.length; i++) {
                if (base[i].toLowerCase() === s.toLowerCase()) { dup = true; break; }
            }
            if (s && !dup) base.push(s);
        });
        return base.join('; ');
    }

    function newSpec(raw) {
        return {
            platform: raw ? 'generic' : '', id: '', url: '', ratio: '', height: 0, width: 0,
            heightMode: '', heightFactor: 1,
            title: '', allow: '', scrolling: '', loading: '', referrerpolicy: '',
            raw: !!raw, error: ''
        };
    }

    // height 的取值：像素 / auto / fit（= 100%）/ 百分比
    function parseHeightValue(rest) {
        var s = String(rest == null ? '' : rest).trim();
        if (!s) return null;
        if (/^auto$/i.test(s)) return { mode: 'auto', factor: 1 };
        if (/^(fit|fill)$/i.test(s)) return { mode: 'fit', factor: 1 };
        var m = /^(\d+(?:\.\d+)?)\s*%$/.exec(s);
        if (m) {
            var pct = parseFloat(m[1]);
            if (!isFinite(pct) || pct <= 0) return null;
            pct = Math.max(10, Math.min(100, pct));
            return { mode: 'fit', factor: pct / 100 };
        }
        var px = pixelSize(s);
        return px ? { px: px } : null;
    }

    // 把 height 行写进 spec（后写的覆盖先写的；像素与自动模式互斥）
    function applyHeight(spec, rest) {
        var r = parseHeightValue(rest);
        if (!r) return;
        if (r.px) {
            spec.height = r.px;
            spec.heightMode = '';
            spec.heightFactor = 1;
        } else {
            spec.height = 0;
            spec.heightMode = r.mode;
            spec.heightFactor = r.factor || 1;
        }
    }

    // 粘贴的整段 <iframe> 嵌入代码 → spec（代码块内的 ratio/height/title 行可覆盖）
    function parseRawIframe(src, tag) {
        var spec = newSpec(true);
        var attrs = parseAttrs(tag);
        spec.url = normalizeUrl(attrs.src);
        if (!spec.url) {
            spec.error = '已识别为 iframe 嵌入代码，但没解析出有效地址：src 需要是 http/https 或 // 开头。\n' + TIP;
            return spec;
        }
        var size = sizeOf(attrs);
        spec.width = size.w;
        spec.height = size.h;
        spec.title = unescapeEntities(attrs.title).trim();
        spec.allow = String(attrs.allow || '');
        spec.scrolling = /^(yes|no|auto)$/i.test(attrs.scrolling || '') ? attrs.scrolling.toLowerCase() : '';
        spec.loading = /^(lazy|eager)$/i.test(attrs.loading || '') ? attrs.loading.toLowerCase() : '';
        spec.referrerpolicy = /^[a-z-]+$/i.test(attrs.referrerpolicy || '') ? attrs.referrerpolicy : '';

        var lines = String(src).split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line || line.indexOf('<') >= 0) continue;   // 跳过 HTML 行
            var m = /^(ratio|height|title)\s+([\s\S]+)$/i.exec(line);
            if (!m) continue;
            var key = m[1].toLowerCase();
            var rest = m[2].trim();
            if (key === 'ratio') spec.ratio = rest;
            else if (key === 'height') applyHeight(spec, rest);
            else spec.title = rest.replace(/^["']|["']$/g, '');
        }
        return spec;
    }

    function parseSpec(src) {
        var text = String(src == null ? '' : src);
        // 优先识别「从其他平台直接复制的整段 <iframe> 代码」
        var body = stripComments(text);
        var rawTag = findIframeTag(body);
        if (rawTag) return parseRawIframe(body, rawTag);

        var spec = newSpec(false);
        var lines = text.split(/\r?\n/);
        var hasHead = false;

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line || line.charAt(0) === '#') continue;
            var m = /^([A-Za-z][\w-]*)(?:\s+([\s\S]*))?$/.exec(line);
            var key = m ? m[1].toLowerCase() : '';
            var rest = m && m[2] ? m[2].trim() : '';

            if (key === 'ratio') { spec.ratio = rest; continue; }
            if (key === 'height') { applyHeight(spec, rest); continue; }
            if (key === 'title') { spec.title = rest.replace(/^["']|["']$/g, ''); continue; }

            if (hasHead) continue;   // 主行之后的未知行忽略
            hasHead = true;

            if (key === 'url') {
                spec.platform = 'generic';
                spec.url = rest;
            } else if (PLATFORMS[key] && rest) {
                spec.platform = key;
                spec.id = rest;
            } else if (/^(https?:)?\/\//i.test(line) || line.indexOf('.') >= 0) {
                spec.platform = 'generic';
                spec.url = line;
            } else {
                spec.error = '无法识别的第一行：' + line + '\n' + TIP;
            }
        }

        if (!spec.error && !spec.url) {
            if (spec.platform && PLATFORMS[spec.platform]) {
                spec.url = PLATFORMS[spec.platform].url(spec.id);
            } else {
                spec.error = '缺少平台或地址。\n' + TIP;
            }
        }
        return spec;
    }

    /* ---------------- 渲染 ---------------- */

    function escapeHtml(s) {
        return String(s).replace(/[&<>"]/g, function (c) {
            return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
        });
    }

    function ratioCss(ratio) {
        var m = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/.exec(String(ratio || '').trim());
        return m ? m[1] + ' / ' + m[2] : '16 / 9';
    }

    function modeLabel(mode, factor) {
        if (mode === 'auto') return '高度自适应';
        if (mode === 'fit') {
            var pct = Math.round((factor || 1) * 100);
            return pct >= 100 ? '铺满一页' : '高度 ' + pct + '%';
        }
        return '';
    }

    function modeHint(mode, factor) {
        if (mode === 'auto') {
            return '按嵌入页面的真实内容高度自动撑开（超出一页时可在舞台内滚动查看）。' +
                '跨域页面读不到内容高度，会自动改为铺满一页。';
        }
        if (mode === 'fit') {
            var pct = Math.round((factor || 1) * 100);
            return pct >= 100
                ? '铺满幻灯片一页的剩余可用高度，舞台尺寸变化时自动重算。'
                : '占幻灯片剩余可用高度的 ' + pct + '%，舞台尺寸变化时自动重算。';
        }
        return '';
    }

    function render(src) {
        var spec = parseSpec(src);
        if (spec.error) return '<div class="ifp-err">iframe 播放器：' + escapeHtml(spec.error) + '</div>';

        var preset = PLATFORMS[spec.platform] || {};
        var label = preset.label || 'iframe';
        var mode = spec.heightMode;
        var factor = spec.heightFactor || 1;

        // 高度优先级：自动模式 > 显式像素 height > 平台预设高度 > ratio 画幅
        var style;
        if (mode) {
            // 先用画幅占位；块入 DOM 后由运行时按内容 / 可用高度改写为像素高度
            style = 'aspect-ratio:' + ratioCss(spec.ratio);
        } else {
            style = spec.height ? 'height:' + spec.height + 'px'
                : preset.height ? 'height:' + preset.height + 'px'
                    : 'aspect-ratio:' + ratioCss(spec.ratio);
        }
        // 宽度优先级：平台预设上限 > 粘贴代码里的宽度（作为上限，随容器收缩）
        var maxW = preset.maxWidth || spec.width || 0;
        if (maxW) style += ';max-width:' + maxW + 'px';

        var attrs = 'src="' + escapeHtml(spec.url) + '" ' +
            'loading="' + (spec.loading || 'lazy') + '" ' +
            'scrolling="' + (spec.scrolling || 'no') + '" frameborder="0" ' +
            'allowfullscreen allow="' + escapeHtml(mergeAllow(spec.allow)) + '" ' +
            'referrerpolicy="' + (spec.referrerpolicy || 'no-referrer') + '"';

        var wrapAttrs = mode
            ? ' data-ifp-mode="' + mode + '" data-ifp-factor="' + factor + '"'
            : '';
        var note = mode
            ? '<span class="ifp-mode" data-ifp-note title="' + escapeHtml(modeHint(mode, factor)) + '">' +
                escapeHtml(modeLabel(mode, factor)) + '</span>'
            : '';

        return '<div class="ifp"' + wrapAttrs + '>' +
            '<div class="ifp-box" style="' + style + '">' +
            '<iframe ' + attrs + '></iframe>' +
            '</div>' +
            '<div class="ifp-bar">' +
            '<span class="ifp-tag">' + escapeHtml(label) + '</span>' +
            note +
            '<span class="ifp-title">' + escapeHtml(spec.title) + '</span>' +
            '<a href="' + escapeHtml(spec.url) + '" target="_blank" rel="noopener">新窗口打开 ↗</a>' +
            '</div>' +
            '</div>';
    }

    /* ---------------- 运行时：自动高度 ---------------- */

    var AUTO_MIN = 60;       // auto：内容再少也留一点高度
    var AUTO_MAX = 6000;     // auto：防止异常页面把高度撑到离谱
    var FIT_MIN = 120;       // fit：可用高度不足时的下限（超出舞台就让舞台滚动）

    var items = [];          // 已接管的自动高度块
    var slideRO = null;      // 舞台尺寸观察器
    var observedSlide = null;
    var winHandler = null;
    var refitTimer = 0;

    function getSlide(ctx) {
        try { return ctx.getSlideEl ? ctx.getSlideEl() : null; } catch (e) { return null; }
    }

    // 写入像素高度（去掉画幅占位；值不变时不重复写，避免观察器互相触发）
    function setBoxHeight(item, h) {
        h = Math.round(h);
        if (!isFinite(h) || h <= 0) return;
        h = Math.max(40, h);
        if (item.lastH === h) return;
        item.lastH = h;
        item.box.style.removeProperty('aspect-ratio');
        item.box.style.height = h + 'px';
    }

    // 读嵌入页面的内容高度（同源才可读）
    // 只认 body：documentElement.scrollHeight 至少等于 iframe 视口高度，会让高度只涨不缩
    function contentHeight(doc) {
        var body = doc.body;
        if (!body) return doc.documentElement ? Math.round(doc.documentElement.scrollHeight) : 0;
        var h = Math.max(body.scrollHeight || 0, body.offsetHeight || 0);
        try {
            var win = doc.defaultView;
            if (win) {
                var cs = win.getComputedStyle(body);
                h += (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
            }
        } catch (e) { /* 读不到样式就按内容高度算 */ }
        return Math.round(h);
    }

    // 取同源 iframe 的 document；跨域返回 null
    function probeDoc(frame) {
        var doc = null;
        try { doc = frame.contentDocument; } catch (e) { doc = null; }
        if (!doc) {
            try { doc = frame.contentWindow ? frame.contentWindow.document : null; }
            catch (e2) { doc = null; }
        }
        return doc && doc.documentElement ? doc : null;
    }

    // 撤掉对嵌入页面的全部监听（页面被替换 / 插件停用时）
    function unwatchDoc(item) {
        try {
            if (item.ro) { item.ro.disconnect(); item.ro = null; }
            if (item.mo) { item.mo.disconnect(); item.mo = null; }
            if (item.doc && item.onDocEvent) {
                item.doc.removeEventListener('load', item.onDocEvent, true);
                var win = item.doc.defaultView;
                if (win) win.removeEventListener('resize', item.onDocEvent);
            }
        } catch (e) { /* 页面可能已跨域 / 已销毁 */ }
        item.watched = false;
    }

    // 铺满：按这块 iframe 在舞台里上方已占用的高度，算出剩余可用高度
    function applyFit(item, ctx) {
        var slide = getSlide(ctx);
        if (!slide || !slide.isConnected) return;
        var cs = window.getComputedStyle(slide);
        var padBottom = parseFloat(cs.paddingBottom) || 0;
        var slideRect = slide.getBoundingClientRect();
        var boxRect = item.box.getBoundingClientRect();
        if (!boxRect.width) return;   // 还没布局（面板隐藏等），等尺寸观察器再算
        var bar = item.wrap.querySelector('.ifp-bar');
        var barH = bar ? bar.getBoundingClientRect().height : 0;
        var wrapCs = window.getComputedStyle(item.wrap);
        var marginB = parseFloat(wrapCs.marginBottom) || 0;
        // box 在滚动内容里的偏移（与当前滚动位置无关）
        var offset = boxRect.top - slideRect.top + (slide.scrollTop || 0);
        var avail = slide.clientHeight - offset - padBottom - barH - 6 - marginB;
        if (!isFinite(avail)) return;
        var h = Math.max(FIT_MIN, Math.round(avail * (item.factor || 1)));
        setBoxHeight(item, h);
    }

    // auto：跨域 / 读不到内容 → 退化为铺满一页（并更新角标说明）
    function fallbackToFit(item, ctx) {
        if (!item.fallback) {
            item.fallback = true;
            item.factor = 1;
            unwatchDoc(item);
            item.wrap.setAttribute('data-ifp-mode', 'fit');
            item.box.setAttribute('data-ifp-fallback', '1');
            var note = item.wrap.querySelector('[data-ifp-note]');
            if (note) {
                note.textContent = '跨域 · 铺满';
                note.title = '跨域页面读不到内容高度，已改为铺满一页；' +
                    '需要精确高度时请显式写 height 像素值。';
            }
        }
        applyFit(item, ctx);
    }

    // 监听嵌入页面内部的变化（同源）：内容增高 / 图片加载 / 页面内部缩放
    function watchDoc(item, ctx) {
        var doc = item.doc;
        if (item.watched || !doc || !doc.body) return;
        item.watched = true;
        try {
            if (window.ResizeObserver) {
                item.ro = new ResizeObserver(function () { scheduleMeasure(item, ctx); });
                item.ro.observe(doc.body);
                item.ro.observe(doc.documentElement);
            }
            if (window.MutationObserver) {
                item.mo = new MutationObserver(function () { scheduleMeasure(item, ctx); });
                item.mo.observe(doc.documentElement, {
                    childList: true, subtree: true, attributes: true, characterData: true
                });
            }
            item.onDocEvent = function () { scheduleMeasure(item, ctx); };
            doc.addEventListener('load', item.onDocEvent, true);   // 图片 / 子框架加载
            if (doc.defaultView) doc.defaultView.addEventListener('resize', item.onDocEvent);
        } catch (e) { /* 跨域中途变化等，忽略即可 */ }
    }

    // 一次事件循环内只量一次，避免 MutationObserver 连续触发导致布局抖动
    function scheduleMeasure(item, ctx) {
        if (item.timer || !item.wrap.isConnected) return;
        item.timer = setTimeout(function () {
            item.timer = 0;
            if (!item.wrap.isConnected) return;
            if (item.mode === 'auto' && !item.fallback) autoMeasure(item, ctx);
            else applyFit(item, ctx);
        }, 0);
    }

    function autoMeasure(item, ctx) {
        if (!item.wrap.isConnected) return;
        if (item.fallback) { applyFit(item, ctx); return; }

        var doc = probeDoc(item.frame);
        // 导航尚未提交时拿到的是初始 about:blank，量出来没有意义，等 load
        if (doc && !item.loaded && doc.URL === 'about:blank') doc = null;
        if (!doc) {
            if (item.loaded) fallbackToFit(item, ctx);
            return;
        }
        // 页面被导航换了（同一 iframe 内跳转）：旧的观察器作废，改观察新文档
        if (item.doc !== doc) {
            unwatchDoc(item);
            item.doc = doc;
        }
        var h = contentHeight(doc);
        if (h > 0) {
            setBoxHeight(item, Math.max(AUTO_MIN, Math.min(h, AUTO_MAX)));
        } else if (item.loaded) {
            setBoxHeight(item, AUTO_MIN);
        }
        watchDoc(item, ctx);
    }

    function adoptOne(wrap, ctx) {
        if (wrap.__ifpItem) return;
        var box = wrap.querySelector('.ifp-box');
        var frame = box ? box.querySelector('iframe') : null;
        if (!box || !frame) return;

        var item = {
            wrap: wrap, box: box, frame: frame,
            mode: wrap.getAttribute('data-ifp-mode') === 'auto' ? 'auto' : 'fit',
            factor: parseFloat(wrap.getAttribute('data-ifp-factor')) || 1,
            fallback: false, lastH: 0, doc: null, watched: false, loaded: false,
            ro: null, mo: null, timer: 0, onLoad: null, onDocEvent: null
        };
        wrap.__ifpItem = item;
        items.push(item);

        item.onLoad = function () {
            item.loaded = true;
            if (!item.wrap.isConnected) return;
            if (item.mode === 'auto' && !item.fallback) autoMeasure(item, ctx);
            else applyFit(item, ctx);
        };
        frame.addEventListener('load', item.onLoad);

        if (item.mode === 'auto') autoMeasure(item, ctx);
        else applyFit(item, ctx);
    }

    // 块入 DOM 后接管（宿主逐块渲染，必须在这里初始化）
    function adopt(root, ctx) {
        var list = root && root.querySelectorAll ? root.querySelectorAll('.ifp[data-ifp-mode]') : [];
        for (var i = 0; i < list.length; i++) adoptOne(list[i], ctx);
    }

    function dropItem(item) {
        var i = items.indexOf(item);
        if (i >= 0) items.splice(i, 1);
        try {
            if (item.onLoad) item.frame.removeEventListener('load', item.onLoad);
            if (item.timer) { clearTimeout(item.timer); item.timer = 0; }
        } catch (e) { /* 页面可能已销毁 */ }
        unwatchDoc(item);
        item.doc = null;
    }

    // 幻灯片重建后，清掉已经离开文档的块
    function prune() {
        for (var i = items.length - 1; i >= 0; i--) {
            if (!items[i].wrap.isConnected) dropItem(items[i]);
        }
    }

    function refitAll(ctx) {
        prune();
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (!item.wrap.isConnected) continue;
            if (item.mode === 'fit' || item.fallback) applyFit(item, ctx);
        }
    }

    function requestRefit(ctx) {
        if (refitTimer) return;
        refitTimer = setTimeout(function () {
            refitTimer = 0;
            refitAll(ctx);
        }, 0);
    }

    // 窗口 / 舞台尺寸变化 → 重新铺满
    function bindGlobal(ctx) {
        if (winHandler) return;
        winHandler = function () { requestRefit(ctx); };
        window.addEventListener('resize', winHandler);
        window.addEventListener('orientationchange', winHandler);
    }

    function bindSlideRO(ctx) {
        if (!window.ResizeObserver) return;
        var slide = getSlide(ctx);
        if (!slide) return;
        var target = slide.parentElement || slide;
        if (slideRO && observedSlide === target) return;
        if (slideRO) slideRO.disconnect();
        slideRO = new ResizeObserver(function () { requestRefit(ctx); });
        slideRO.observe(target);
        if (target !== slide) slideRO.observe(slide);
        observedSlide = target;
    }

    function release() {
        for (var i = items.length - 1; i >= 0; i--) dropItem(items[i]);
        if (slideRO) { slideRO.disconnect(); slideRO = null; }
        observedSlide = null;
        if (winHandler) {
            window.removeEventListener('resize', winHandler);
            window.removeEventListener('orientationchange', winHandler);
            winHandler = null;
        }
        if (refitTimer) { clearTimeout(refitTimer); refitTimer = 0; }
    }

    /* ---------------- 选项卡模板 ---------------- */

    var TEMPLATES = {
        bilibili: ['```iframe', 'bilibili BV1r7et6PEVQ', 'title 示例视频（把 BV 号换成你的）', '```', ''].join('\n'),
        netease: ['```iframe', 'netease 26092806', 'title 示例单曲（把 ID 换成你的）', '```', ''].join('\n'),
        playlist: ['```iframe', 'netease-playlist 668975259', 'title 示例歌单（把 ID 换成你的）', '```', ''].join('\n'),
        youtube: ['```iframe', 'youtube dQw4w9WgXcQ', 'ratio 16:9', '```', ''].join('\n'),
        vimeo: ['```iframe', 'vimeo 76979871', 'ratio 16:9', '```', ''].join('\n'),
        generic: ['```iframe', 'url https://example.com/', 'height 380', 'title 任意网页', '```', ''].join('\n'),
        auto: ['```iframe', 'url https://example.com/', 'height auto',
            'title 自动高度网页（同源按内容撑开，跨域自动铺满）', '```', ''].join('\n'),
        fit: ['```iframe', 'url https://example.com/', 'height fit',
            'title 铺满一页（随舞台缩放自动重算）', '```', ''].join('\n'),
        paste: ['```iframe',
            '# 在下面粘贴从其他平台复制的整段 <iframe …></iframe> 代码（本行注释可删除）',
            '# 例：<iframe src="https://www.x360.cn/tour/ccb91df465b1d996" frameborder="no" border="0" style="width: 1000px;height: 600px;" allowfullscreen="true"></iframe>',
            '```', ''].join('\n')
    };

    var tab = null;

    function insert(ctx, text) {
        if (ctx.insertAtCursor) ctx.insertAtCursor('\n' + text + '\n');
    }

    MPSPlugins.register({
        id: 'iframe',

        setup: function (ctx) {
            // 围栏渲染：```iframe → 完整的播放器 HTML
            ctx.registerFence('iframe', function (token) {
                return render(token.content);
            });
            ctx.addStyle(CSS);

            // 自动高度：块入 DOM 后测量；换页 / 舞台缩放时重算铺满高度
            ctx.on('blockRendered', function (el) {
                adopt(el, ctx);
                bindGlobal(ctx);
                bindSlideRO(ctx);
                requestRefit(ctx);
            });
            ctx.on('slideChanged', function () { requestRefit(ctx); });
            ctx.on('slideReset', function () { prune(); });
            ctx.on('deckChanged', function () { prune(); });

            if (ctx.host !== 'presenter' || !ctx.ribbon) return;
            tab = ctx.ribbon.addTab({ id: 'iframe', label: 'iframe 播放器', order: 55 });
            if (!tab) return;

            tab.addGroupLabel('插入播放器');
            tab.addButton({
                id: 'ifpPasteBtn', icon: '📋', label: '粘贴嵌入代码',
                title: '插入空代码块，把其他平台复制的 <iframe …></iframe> 代码粘贴进去',
                onClick: function () { insert(ctx, TEMPLATES.paste); }
            });
            tab.addButton({
                id: 'ifpBilibiliBtn', icon: '📺', label: '哔哩哔哩',
                title: '插入哔哩哔哩播放器（BV 号 / av 号）',
                onClick: function () { insert(ctx, TEMPLATES.bilibili); }
            });
            tab.addButton({
                id: 'ifpNeteaseBtn', icon: '🎵', label: '网易云·单曲',
                title: '插入网易云音乐单曲播放器（歌曲 ID）',
                onClick: function () { insert(ctx, TEMPLATES.netease); }
            });
            tab.addButton({
                id: 'ifpPlaylistBtn', icon: '💽', label: '网易云·歌单',
                title: '插入网易云音乐歌单播放器（歌单 ID）',
                onClick: function () { insert(ctx, TEMPLATES.playlist); }
            });
            tab.addButton({
                id: 'ifpYoutubeBtn', icon: '▶️', label: 'YouTube',
                title: '插入 YouTube 播放器（视频 ID）',
                onClick: function () { insert(ctx, TEMPLATES.youtube); }
            });
            tab.addButton({
                id: 'ifpVimeoBtn', icon: '🎬', label: 'Vimeo',
                title: '插入 Vimeo 播放器（视频 ID）',
                onClick: function () { insert(ctx, TEMPLATES.vimeo); }
            });
            tab.addButton({
                id: 'ifpGenericBtn', icon: '🔗', label: '任意地址',
                title: '插入任意 iframe 地址（固定 380px 高度）',
                onClick: function () { insert(ctx, TEMPLATES.generic); }
            });
            tab.addDivider();

            tab.addGroupLabel('自动高度');
            tab.addButton({
                id: 'ifpAutoBtn', icon: '🪄', label: '按内容自适应',
                title: '插入 height auto：按嵌入页面的真实内容高度自动撑开（同源可测；跨域自动铺满一页）',
                onClick: function () { insert(ctx, TEMPLATES.auto); }
            });
            tab.addButton({
                id: 'ifpFitBtn', icon: '🖥', label: '铺满一页',
                title: '插入 height fit：铺满幻灯片剩余可用高度，随舞台缩放自动重算',
                onClick: function () { insert(ctx, TEMPLATES.fit); }
            });
            tab.addDivider();

            tab.addHint('支持直接粘贴其他平台复制的整段 <code>&lt;iframe …&gt;&lt;/iframe&gt;</code> 代码，' +
                'src / 宽高 / allow 等属性会自动识别；也可写平台行，可选行：<code>ratio 16:9</code>、' +
                '<code>height 380</code>、<code>title 说明</code>。<br>' +
                '自动高度：<code>height auto</code> 按嵌入页面的内容高度撑开，' +
                '<code>height fit</code> 或 <code>height 100%</code> 铺满一页，' +
                '<code>height 60%</code> 占可用高度的 60%；' +
                '跨域页面读不到内容高度，<code>auto</code> 会自动改为铺满。<br>' +
                '部分平台会校验来源域名，若内嵌失败可用播放器右下角的「新窗口打开」。');
            ctx.log('已注入「iframe 播放器」选项卡（含自动高度）');
        },

        teardown: function (ctx) {
            release();
            if (tab) { tab.remove(); tab = null; }
            ctx.log('已停用');
        }
    });
})();
