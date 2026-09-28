/*!
 * MPS 插件 · 课堂测验（id: slide-quiz）
 * -----------------------------------------------------------------------------
 * 两套能力：
 *   1) 自测测验（默认）：```quiz 代码块 → 可交互题卡（单选 / 多选 / 判断 / 填空），
 *      点「提交」再判定；```quiz-summary → 全卷成绩单。作答跨页累计、离线可用。
 *   2) 现场投票：```poll 代码块 → 显示题目 + 二维码，观众扫码在手机上投票，
 *      票数 / 词云在幻灯片上实时刷新；```poll-config 提供 MQTT 连接配置。
 * 在 presenter 的 Ribbon 中注入「课堂测验」选项卡（插入模板 / 连接状态 / 清空票数）。
 *
 * 目录：
 *   mps-quiz.js    自测测验运行时
 *   mps-poll.js    现场投票运行时（MQTT over WebSocket）
 *   vote.html      手机投票页（需放到手机可访问的站点，二维码指向它）
 *   qrcode.js / mqtt.min.js   本地依赖（二维码生成 / MQTT 客户端）
 *   index.js       本文件：只做注册，实际副作用全部在 setup/teardown 内
 * ========================================================================== */
(function () {
    'use strict';

    var TEMPLATES = {
        single: [
            '```quiz',
            'q 中国的首都是哪座城市？',
            'type single',
            'opt 北京 *',
            'opt 上海',
            'opt 广州',
            'opt 深圳',
            'explain 北京是中华人民共和国的首都，也是全国政治、文化中心。',
            '```',
            ''
        ].join('\n'),

        multi: [
            '```quiz',
            'q 以下哪些数属于质数？',
            'type multi',
            'opt 2 *',
            'opt 3 *',
            'opt 4',
            'opt 9',
            'explain 质数只能被 1 和自身整除；4 和 9 都是合数。',
            '```',
            ''
        ].join('\n'),

        judge: [
            '```quiz',
            'q 三角形内角和等于 180 度。',
            'type judge',
            'ans 对',
            'explain 在欧氏几何中，三角形内角和恒为 180°。',
            '```',
            ''
        ].join('\n'),

        fill: [
            '```quiz',
            'q 水的化学式是 ____，一个水分子由两个 ____ 组成。',
            'type fill',
            'ans H2O | H₂O ; 氢原子 | 氢 | H',
            'explain 每个水分子由 2 个氢原子和 1 个氧原子构成。',
            '```',
            ''
        ].join('\n'),

        full: [
            '```quiz',
            'title 随堂小测',
            'q 计算 \\(\\frac{1}{2}+\\frac{1}{3}\\) 的结果。',
            'type single',
            'opt \\(\\frac{5}{6}\\) *',
            'opt \\(\\frac{2}{5}\\)',
            'opt \\(\\frac{1}{5}\\)',
            'opt \\(\\frac{1}{6}\\)',
            'explain 通分：\\(\\frac{3}{6}+\\frac{2}{6}=\\frac{5}{6}\\)。',
            '',
            'q 以下哪些数属于质数？',
            'type multi',
            'opt 2 *',
            'opt 3 *',
            'opt 4',
            'opt 9',
            'explain 质数只能被 1 和自身整除。',
            '',
            'q 三角形内角和等于 180 度。',
            'type judge',
            'ans 对',
            '',
            'q 水的化学式是 ____。',
            'type fill',
            'ans H2O | H₂O',
            'explain 一个水分子由两个氢原子和一个氧原子构成。',
            '```',
            ''
        ].join('\n'),

        board: [
            '```quiz-summary',
            'title 本卷成绩',
            '```',
            ''
        ].join('\n'),

        pollSingle: [
            '```poll',
            'title 现场投票',
            'q 你最喜欢哪个专题？',
            'type single',
            'opt 数学动画',
            'opt 课堂测验',
            'opt Python 笔记本',
            'opt 摄像头画面',
            '```',
            ''
        ].join('\n'),

        pollText: [
            '```poll',
            'title 现场投票',
            'q 用一个词形容今天的课程',
            'type text',
            '```',
            ''
        ].join('\n'),

        pollConfig: [
            '```poll-config',
            '# 不用写这个配置块也能投票：默认走公共测试通道 + 自动房间号 + 自动推断投票页。',
            '# 下面三项按需填写（留空/删掉即用默认）：',
            '#   broker：自己的 HiveMQ Cloud 集群（免费 Serverless：100 并发连接 / 10GB 每月），',
            '#           控制台复制集群地址后用 8884 端口；票就不会经过公共通道。',
            '#   room  ：固定房间号（不写则每台电脑自动分配一个，「换房间」按钮可换新的一场）。',
            '#   vote  ：投票页地址（不写则自动推断同站 plugs/slide-quiz/vote.html）。',
            'broker wss://你的集群地址:8884/mqtt',
            'user 你的用户名',
            'pass 你的密码',
            'room demo-2026',
            'vote https://你的站点/plugs/slide-quiz/vote.html',
            'title 课堂投票',
            '```',
            ''
        ].join('\n')
    };

    var tab = null;           // 当前注入的选项卡 API（teardown 时移除）
    var resetArmed = false;   // 「重置全部作答」的二次确认
    var resetTimer = 0;
    var votesArmed = false;   // 「清空投票数」的二次确认
    var votesTimer = 0;

    function insert(ctx, text) {
        if (ctx.insertAtCursor) ctx.insertAtCursor('\n' + text + '\n');
    }

    function showProgress(ctx) {
        if (!window.MPSQuiz) return;
        if (ctx.setStatus) ctx.setStatus(window.MPSQuiz.progress().text);
    }

    // 清空作答是不可逆操作：点第一次「武装」，3 秒内再点一次才真正执行
    function resetAll(ctx) {
        if (!window.MPSQuiz) return;
        if (!resetArmed) {
            resetArmed = true;
            if (ctx.setStatus) ctx.setStatus('再点一次「重置全部作答」确认清空本卷作答（3 秒内有效）');
            resetTimer = setTimeout(function () { resetArmed = false; }, 3000);
            return;
        }
        resetArmed = false;
        if (resetTimer) { clearTimeout(resetTimer); resetTimer = 0; }
        window.MPSQuiz.resetDeck();
        if (ctx.setStatus) ctx.setStatus('✔ 已清空本卷作答，可以重新答题');
    }

    function pollStatus(ctx) {
        if (!window.MPSPoll) return;
        if (ctx.setStatus) ctx.setStatus(window.MPSPoll.status().text);
    }

    function clearVotes(ctx) {
        if (!window.MPSPoll) return;
        if (!votesArmed) {
            votesArmed = true;
            if (ctx.setStatus) ctx.setStatus('再点一次「清空投票数」确认清空当前页票数并重新开始投票（3 秒内有效）');
            votesTimer = setTimeout(function () { votesArmed = false; }, 3000);
            return;
        }
        votesArmed = false;
        if (votesTimer) { clearTimeout(votesTimer); votesTimer = 0; }
        var n = window.MPSPoll.reset(false);
        if (ctx.setStatus) {
            ctx.setStatus(n ? '✔ 已清空 ' + n + ' 张投票卡的票数，观众可以重新投票'
                : '当前页没有投票卡（先翻到投票页再点）');
        }
    }

    // 换一个新房间（自动房间号模式下）：旧票清空，观众需重新扫码（二维码会刷新）
    function rollRoom(ctx) {
        if (!window.MPSPoll) return;
        var r = window.MPSPoll.rollRoom();
        if (ctx.setStatus) {
            ctx.setStatus(r.ok
                ? '✔ 已换新房间 ' + r.room + '（旧票已作废，二维码已刷新，观众需重新扫码）'
                : '无法换房间：' + (r.reason || ''));
        }
    }

    MPSPlugins.register({
        id: 'slide-quiz',

        setup: function (ctx) {
            var Q = window.MPSQuiz;
            var P = window.MPSPoll;
            if (!Q) { ctx.log('运行时 mps-quiz.js 未加载，自测测验不可用'); }

            /* —— 自测测验 —— */
            if (Q) {
                Q.configure({
                    md: ctx.md,
                    store: ctx.store,
                    getDeckSource: ctx.getDeckSource,
                    refresh: ctx.refresh,
                    log: ctx.log
                });
                ctx.registerFence('quiz', function (token) { return Q.renderSet(token.content); });
                ctx.registerFence('quiz-summary', function (token) { return Q.renderBoard(token.content); });
                ctx.addStyle(Q.CSS);
            }

            /* —— 现场投票（MQTT over WebSocket） —— */
            if (P) {
                P.configure({
                    meta: ctx.meta,
                    store: ctx.store,
                    getDeckSource: ctx.getDeckSource,
                    getSlideEl: ctx.getSlideEl,
                    refresh: ctx.refresh,
                    log: ctx.log
                });
                ctx.registerFence('poll', function (token) { return P.renderPoll(token.content); });
                ctx.registerFence('poll-config', function (token) { return P.renderConfig(token.content); });
                ctx.addStyle(P.CSS);
            }

            // 块入 DOM 后进行交互绑定 / 作答恢复 / 投票卡上线
            ctx.on('blockRendered', function (el) {
                if (Q) { try { Q.initIn(el); } catch (e) { ctx.log('测验初始化失败: ' + e.message); } }
                if (P) {
                    try { P.initIn(el); } catch (e) { ctx.log('投票初始化失败: ' + e.message); }
                    try { P.applyDeck(); } catch (e) { /* 配置解析失败时忽略 */ }
                }
            });

            // presenter 专属：注入「课堂测验」选项卡
            if (ctx.host !== 'presenter' || !ctx.ribbon) return;
            tab = ctx.ribbon.addTab({ id: 'slide-quiz', label: '课堂测验', order: 54 });
            if (!tab) return;

            tab.addGroupLabel('插入题目');
            tab.addButton({
                id: 'sqSingleBtn', icon: 'Ⓐ', label: '单选题',
                title: '插入一个单选题（正确选项行尾加 *）',
                onClick: function () { insert(ctx, TEMPLATES.single); }
            });
            tab.addButton({
                id: 'sqMultiBtn', icon: '☑', label: '多选题',
                title: '插入一个多选题（可标多个 * 选项）',
                onClick: function () { insert(ctx, TEMPLATES.multi); }
            });
            tab.addButton({
                id: 'sqJudgeBtn', icon: '✓', label: '判断题',
                title: '插入一个判断题（ans 对 / ans 错）',
                onClick: function () { insert(ctx, TEMPLATES.judge); }
            });
            tab.addButton({
                id: 'sqFillBtn', icon: '▭', label: '填空题',
                title: '插入一个填空题（空位写连续下划线，答案用 | 分隔多种写法）',
                onClick: function () { insert(ctx, TEMPLATES.fill); }
            });
            tab.addButton({
                id: 'sqFullBtn', icon: '📋', label: '整组示例',
                title: '插入一整组示例题（含数学公式写法）',
                onClick: function () { insert(ctx, TEMPLATES.full); }
            });
            tab.addDivider();

            tab.addGroupLabel('实时投票（免配置可用）');
            tab.addButton({
                id: 'sqPollSingleBtn', icon: '📊', label: '单选投票',
                title: '插入一张现场投票卡（题目 + 二维码 + 实时柱状图）；不写配置也能用：自动走公共通道与自动房间',
                onClick: function () { insert(ctx, TEMPLATES.pollSingle); }
            });
            tab.addButton({
                id: 'sqPollTextBtn', icon: '☁', label: '词云投票',
                title: '插入一张文字投票卡（实时词云）',
                onClick: function () { insert(ctx, TEMPLATES.pollText); }
            });
            tab.addButton({
                id: 'sqPollConfigBtn', icon: '🔌', label: '投票配置',
                title: '进阶：换成自己的 HiveMQ 集群（更私密、更稳定）或指定投票页地址；不用配置也能投票',
                onClick: function () { insert(ctx, TEMPLATES.pollConfig); }
            });
            tab.addDivider();

            tab.addGroupLabel('整卷与投票控制');
            tab.addButton({
                id: 'sqBoardBtn', icon: '🧾', label: '全卷成绩单',
                title: '插入成绩单：汇总全卷题数、已答、正确、得分，并带「重新作答」按钮',
                onClick: function () { insert(ctx, TEMPLATES.board); }
            });
            tab.addButton({
                id: 'sqProgressBtn', icon: '📈', label: '查看进度',
                title: '在状态栏显示本卷当前的作答与得分情况',
                onClick: function () { showProgress(ctx); }
            });
            tab.addButton({
                id: 'sqResetBtn', icon: '↺', label: '重置全部作答',
                title: '清空本卷所有题的作答记录（需点两次确认）',
                onClick: function () { resetAll(ctx); }
            });
            tab.addButton({
                id: 'sqPollStatusBtn', icon: '📡', label: '连接状态',
                title: '在状态栏显示 MQTT 连接、房间号与在线人数',
                onClick: function () { pollStatus(ctx); }
            });
            tab.addButton({
                id: 'sqClearVotesBtn', icon: '🧹', label: '清空投票数',
                title: '清空当前页投票卡的票数并换一轮（观众可重新投票，需点两次确认）',
                onClick: function () { clearVotes(ctx); }
            });
            tab.addButton({
                id: 'sqRollRoomBtn', icon: '🎲', label: '换房间',
                title: '换一个新房间（自动房间号模式下有效）：旧票作废、二维码刷新，适合每节课开始时点一次',
                onClick: function () { rollRoom(ctx); }
            });

            tab.addHint('怎么用（不需要任何部署）：插入「单选投票」或「词云投票」即可 —— ' +
                '二维码自动生成、房间号自动分配、走公共测试通道。手机扫码即投，票数实时出现在幻灯片上。<br>' +
                '<b>本机打开（localhost / 双击文件）时二维码手机扫不开</b>：双击插件目录里的「启动课堂投票（局域网）.bat」' +
                '（<code>plugs/slide-quiz/server/</code>；打包分享后它会以快捷方式出现在课件根目录），' +
                '它会自动找内网地址、起服务、并用内网地址重开本页，二维码立刻可用（macOS 用 <code>start-vote-server.sh</code>）。<br>' +
                '其他两种自动来源：① 课件托管到网上时自动用同站投票页；② 在「投票配置」里写 <code>vote 地址</code>（一劳永逸）。<br>' +
                '要更私密 / 更稳定：用「投票配置」填自己的 HiveMQ 集群（免费 Serverless 档 100 并发连接），票就不经过公共通道。<br>' +
                '自测测验：<code>q 题干</code> 起题，<code>type</code> 用 <code>single / multi / judge / fill</code>，' +
                '公式用 <code>\\( ... \\)</code>；提交后判定，成绩跨页累计。');
            ctx.log('已注入「课堂测验」选项卡');
        },

        teardown: function (ctx) {
            if (tab) { tab.remove(); tab = null; }
            if (resetTimer) { clearTimeout(resetTimer); resetTimer = 0; }
            if (votesTimer) { clearTimeout(votesTimer); votesTimer = 0; }
            resetArmed = false;
            votesArmed = false;
            if (window.MPSQuiz) window.MPSQuiz.shutdown();
            if (window.MPSPoll) window.MPSPoll.shutdown();
            ctx.log('已停用');
        }
    });
})();