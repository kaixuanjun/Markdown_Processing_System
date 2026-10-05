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
 *   title 说明文字               播放器下方的说明，同时提供「新窗口打开」入口
 *
 * 兼容：也可以把其他平台复制的整段嵌入代码直接粘进来（含 <iframe …></iframe>），
 * 自动识别 src 与 width / height / style / allow / scrolling / loading / title 属性；
 * 代码块内的 ratio / height / title 行仍可覆盖识别结果，# 开头的注释行会被忽略。
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
        '.ifp-bar{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:12px;',
        'color:var(--text-secondary,#57606a);}',
        '.ifp-tag{flex-shrink:0;font-size:10px;letter-spacing:.5px;border:1px solid currentColor;',
        'border-radius:20px;padding:1px 7px;opacity:.7;white-space:nowrap;}',
        '.ifp-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
        '.ifp-bar a{flex-shrink:0;color:var(--accent,#0969da);text-decoration:none;}',
        '.ifp-bar a:hover{text-decoration:underline;}',
        '.ifp-err{padding:.7em .9em;border:1px dashed var(--border-color,#d0d7de);border-radius:10px;',
        'font-size:12px;line-height:1.7;color:var(--text-muted,#8b949e);white-space:pre-wrap;}'
    ].join('');

    var TIP = '格式：第一行写「平台 id」或「url 地址」，可选行有 ratio / height / title；' +
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

    // 单个尺寸值 → 像素整数（只认纯数字 / px；百分比交给响应式布局）
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
            title: '', allow: '', scrolling: '', loading: '', referrerpolicy: '',
            raw: !!raw, error: ''
        };
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
            else if (key === 'height') spec.height = parseInt(rest, 10) || spec.height;
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
            if (key === 'height') { spec.height = parseInt(rest, 10) || 0; continue; }
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

    function render(src) {
        var spec = parseSpec(src);
        if (spec.error) return '<div class="ifp-err">iframe 播放器：' + escapeHtml(spec.error) + '</div>';

        var preset = PLATFORMS[spec.platform] || {};
        var label = preset.label || 'iframe';
        // 高度优先级：显式 height > 平台预设高度 > ratio 画幅
        var style = spec.height ? 'height:' + spec.height + 'px'
            : preset.height ? 'height:' + preset.height + 'px'
                : 'aspect-ratio:' + ratioCss(spec.ratio);
        // 宽度优先级：平台预设上限 > 粘贴代码里的宽度（作为上限，随容器收缩）
        var maxW = preset.maxWidth || spec.width || 0;
        if (maxW) style += ';max-width:' + maxW + 'px';

        var attrs = 'src="' + escapeHtml(spec.url) + '" ' +
            'loading="' + (spec.loading || 'lazy') + '" ' +
            'scrolling="' + (spec.scrolling || 'no') + '" frameborder="0" ' +
            'allowfullscreen allow="' + escapeHtml(mergeAllow(spec.allow)) + '" ' +
            'referrerpolicy="' + (spec.referrerpolicy || 'no-referrer') + '"';

        return '<div class="ifp">' +
            '<div class="ifp-box" style="' + style + '">' +
            '<iframe ' + attrs + '></iframe>' +
            '</div>' +
            '<div class="ifp-bar">' +
            '<span class="ifp-tag">' + escapeHtml(label) + '</span>' +
            '<span class="ifp-title">' + escapeHtml(spec.title) + '</span>' +
            '<a href="' + escapeHtml(spec.url) + '" target="_blank" rel="noopener">新窗口打开 ↗</a>' +
            '</div>' +
            '</div>';
    }

    /* ---------------- 选项卡模板 ---------------- */

    var TEMPLATES = {
        bilibili: ['```iframe', 'bilibili BV1r7et6PEVQ', 'title 示例视频（把 BV 号换成你的）', '```', ''].join('\n'),
        netease: ['```iframe', 'netease 26092806', 'title 示例单曲（把 ID 换成你的）', '```', ''].join('\n'),
        playlist: ['```iframe', 'netease-playlist 668975259', 'title 示例歌单（把 ID 换成你的）', '```', ''].join('\n'),
        youtube: ['```iframe', 'youtube dQw4w9WgXcQ', 'ratio 16:9', '```', ''].join('\n'),
        vimeo: ['```iframe', 'vimeo 76979871', 'ratio 16:9', '```', ''].join('\n'),
        generic: ['```iframe', 'url https://example.com/', 'height 380', 'title 任意网页', '```', ''].join('\n'),
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
            // 围栏渲染：```iframe → 完整的播放器 HTML（iframe 是声明式的，无需二次初始化）
            ctx.registerFence('iframe', function (token) {
                return render(token.content);
            });
            ctx.addStyle(CSS);

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
                title: '插入任意 iframe 地址',
                onClick: function () { insert(ctx, TEMPLATES.generic); }
            });
            tab.addDivider();
            tab.addHint('支持直接粘贴其他平台复制的整段 <code>&lt;iframe …&gt;&lt;/iframe&gt;</code> 代码，' +
                'src / 宽高 / allow 等属性会自动识别；也可写平台行，可选行：<code>ratio 16:9</code>、' +
                '<code>height 380</code>、<code>title 说明</code>。<br>' +
                '部分平台会校验来源域名，若内嵌失败可用播放器右下角的「新窗口打开」。');
            ctx.log('已注入「iframe 播放器」选项卡');
        },

        teardown: function (ctx) {
            if (tab) { tab.remove(); tab = null; }
            ctx.log('已停用');
        }
    });
})();