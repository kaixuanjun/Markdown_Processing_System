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

    var TIP = '格式：第一行写「平台 id」或「url 地址」，可选行有 ratio / height / title。' +
        '支持 ' + Object.keys(PLATFORMS).join(' / ') + ' 。';

    /* ---------------- DSL 解析 ---------------- */

    function parseSpec(src) {
        var spec = { platform: '', id: '', url: '', ratio: '', height: 0, title: '', error: '' };
        var lines = String(src || '').split(/\r?\n/);
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
        // 高度优先级：显式 height > 平台预设高度（如网易云播放条） > ratio 画幅
        var style = spec.height ? 'height:' + spec.height + 'px'
            : preset.height ? 'height:' + preset.height + 'px'
                : 'aspect-ratio:' + ratioCss(spec.ratio);
        if (preset.maxWidth) style += ';max-width:' + preset.maxWidth + 'px';

        return '<div class="ifp">' +
            '<div class="ifp-box" style="' + style + '">' +
            '<iframe src="' + escapeHtml(spec.url) + '" loading="lazy" scrolling="no" frameborder="0" ' +
            'allowfullscreen allow="autoplay; encrypted-media; fullscreen; picture-in-picture" ' +
            'referrerpolicy="no-referrer"></iframe>' +
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
        generic: ['```iframe', 'url https://example.com/', 'height 380', 'title 任意网页', '```', ''].join('\n')
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
            tab.addHint('第一行写「平台 id」或「url 地址」，可选行：<code>ratio 16:9</code>、' +
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