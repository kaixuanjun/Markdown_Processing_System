#!/bin/sh
# 课堂投票 · 局域网服务（macOS / Linux）
# 由课件目录或插件目录里的启动器调用，也可手动运行：
#   bash start-vote-server.sh [课件目录]
# 作用：自动找到本机内网地址，起一个静态服务，并打开课件页（二维码即可被手机扫描）

HERE=$(cd "$(dirname "$0")" && pwd) || exit 1
PORT=8787

# ---------- 0) 找到要对外提供的课件目录（本脚本住在插件目录里） ----------
is_deck_root() {
    [ -f "$1/presenter.html" ] && return 0
    [ -f "$1/engine.html" ] && return 0
    [ -f "$1/lib/mps-plugins.js" ] && return 0
    ls "$1"/*-演示.html >/dev/null 2>&1 && return 0
    return 1
}
ROOT="$1"
if [ -z "$ROOT" ]; then
    DIR="$HERE"
    i=0
    while [ "$i" -lt 6 ]; do
        if is_deck_root "$DIR"; then ROOT="$DIR"; break; fi
        NEXT=$(dirname "$DIR")
        [ "$NEXT" = "$DIR" ] && break
        DIR="$NEXT"
        i=$((i + 1))
    done
fi
[ -z "$ROOT" ] && ROOT="$HERE"
cd "$ROOT" || exit 1

# ---------- 1) 找本机内网地址 ----------
IP=""
if command -v ipconfig >/dev/null 2>&1; then
    IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
fi
if [ -z "$IP" ] && command -v hostname >/dev/null 2>&1; then
    IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
if [ -z "$IP" ] && command -v ip >/dev/null 2>&1; then
    IP=$(ip route get 1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") print $(i+1)}')
fi
if [ -z "$IP" ]; then
    echo "[×] 没能自动找到内网地址，请手动查看系统网络设置里的 IPv4 地址。"
    exit 1
fi

# ---------- 2) 选择要打开的课件页面 ----------
PAGE=""
[ -f presenter.html ] && PAGE="presenter.html"
[ -z "$PAGE" ] && [ -f engine.html ] && PAGE="engine.html"
if [ -z "$PAGE" ]; then
    PAGE=$(ls *-演示.html 2>/dev/null | head -n 1)
fi
if [ -z "$PAGE" ]; then
    PAGE=$(ls *.html 2>/dev/null | grep -v '^vote.html$' | head -n 1)
fi
[ -z "$PAGE" ] && PAGE="index.html"

URL="http://$IP:$PORT/$PAGE"

echo
echo "  ========================================================"
echo "    课堂投票 · 傻瓜式局域网模式"
echo "  ========================================================"
echo
echo "  课件地址（本机和手机都用这个）： $URL"
echo
echo "  ★ 幻灯片会以这个内网地址自动打开，二维码即可被手机扫描"
echo "  ★ 手机请连同一个 WiFi，扫码就能投票"
echo "  ★ 本窗口不要关闭（关掉 = 停止服务，按 Ctrl+C 停止）"
echo

# ---------- 3) 起服务，2 秒后自动打开浏览器 ----------
(
    sleep 2
    if command -v open >/dev/null 2>&1; then open "$URL"
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
    fi
) &

if command -v python3 >/dev/null 2>&1; then
    exec python3 -m http.server "$PORT" --bind 0.0.0.0
elif command -v python >/dev/null 2>&1; then
    exec python -m http.server "$PORT" --bind 0.0.0.0
elif command -v node >/dev/null 2>&1; then
    exec node "$HERE/serve.js" "$PORT" "$ROOT"
else
    echo "  [×] 这台电脑上没找到 Python 或 Node.js，无法启动本地服务。"
    echo "      macOS 可运行 xcode-select --install 安装命令行工具后再试。"
    exit 1
fi