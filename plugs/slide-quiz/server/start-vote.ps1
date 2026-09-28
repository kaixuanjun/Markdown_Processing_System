# 课堂投票 · 傻瓜式局域网服务（Windows）
# ---------------------------------------------------------------------------
# 由「启动课堂投票（局域网）.bat」双击调用，也可手动运行：
#   powershell -NoProfile -ExecutionPolicy Bypass -File start-vote.ps1 [-NoBrowser]
# 做的事：自动找内网地址 → 起静态服务 → 用内网地址打开课件（二维码即可被手机扫描）
# ---------------------------------------------------------------------------
param(
    [switch]$NoBrowser,     # 调试用：不自动打开浏览器
    [int]$Port = 0,         # 0 = 自动挑一个可用端口（优先 8787）
    [string]$Root = ''      # 要对外提供的课件目录；留空则自动向上查找
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Write-Line($text) { Write-Host $text }

Write-Line ''
Write-Line '  ========================================================'
Write-Line '    课堂投票 · 傻瓜式局域网模式'
Write-Line '  ========================================================'
Write-Line ''

# ---------- 0) 找到要对外提供的课件目录（本脚本现在住在插件目录里） ----------
function Test-DeckRoot([string]$dir) {
    if (-not (Test-Path $dir)) { return $false }
    if (Test-Path (Join-Path $dir 'presenter.html')) { return $true }
    if (Test-Path (Join-Path $dir 'engine.html')) { return $true }
    if (Test-Path (Join-Path $dir 'lib\mps-plugins.js')) { return $true }
    if (Get-ChildItem -Path $dir -Filter '*-演示.html' -File -ErrorAction SilentlyContinue) { return $true }
    return $false
}

$root = $Root
if (-not $root) {
    $dir = $PSScriptRoot
    for ($i = 0; $i -lt 6 -and $dir; $i++) {
        if (Test-DeckRoot $dir) { $root = $dir; break }
        $parent = Split-Path -Parent $dir
        if ($parent -eq $dir) { break }
        $dir = $parent
    }
}
if (-not $root) { $root = $PSScriptRoot }        # 实在找不到就用脚本自己所在目录
$root = (Resolve-Path -LiteralPath $root).Path
Set-Location $root

# ---------- 1) 找本机内网地址 ----------
$ip = ''
try {
    $ip = Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Sort-Object InterfaceMetric |
        Select-Object -First 1 -ExpandProperty IPAddress
} catch { $ip = '' }
if (-not $ip) {
    try {
        $m = (& ipconfig) | Select-String 'IPv4' | Select-Object -First 1
        if ($m) { $ip = ($m.ToString() -split ':')[-1].Trim() }
    } catch { $ip = '' }
}
if (-not $ip) {
    Write-Line '  [×] 没能自动找到内网地址。'
    Write-Line '      请先在命令行运行 ipconfig，把「IPv4 地址」告诉懂电脑的人。'
    Write-Line ''
    Read-Host '按回车键关闭'
    exit 1
}

# ---------- 2) 选择要打开的课件页面 ----------
$page = ''
if (Test-Path (Join-Path $root 'presenter.html')) { $page = 'presenter.html' }
elseif (Test-Path (Join-Path $root 'engine.html')) { $page = 'engine.html' }
else {
    $demo = Get-ChildItem -Path $root -Filter '*-演示.html' -File | Select-Object -First 1
    if ($demo) { $page = $demo.Name }
    else {
        $any = Get-ChildItem -Path $root -Filter '*.html' -File |
            Where-Object { $_.Name -ne 'vote.html' } | Select-Object -First 1
        if ($any) { $page = $any.Name } else { $page = 'index.html' }
    }
}

# ---------- 3) 挑一个可用端口（默认 8787 起） ----------
function Test-PortBusy([int]$p) {
    try { return [bool](Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction Stop) }
    catch { return $false }
}
if ($Port -le 0) {
    $Port = 8787
    while ((Test-PortBusy $Port) -and $Port -lt 8800) { $Port++ }
}

$url = "http://${ip}:${Port}/${page}"

Write-Line "  课件地址（本机和手机都用这个）： $url"
Write-Line ''
Write-Line '  ★ 幻灯片会以这个内网地址自动打开，二维码即可被手机扫描'
Write-Line '  ★ 手机请连同一个 WiFi，扫码就能投票'
Write-Line '  ★ 首次运行如弹出 Windows 防火墙询问，请勾选「专用网络」并点「允许访问」'
Write-Line '  ★ 本窗口不要关闭（关掉 = 停止服务，按 Ctrl+C 停止）'
Write-Line ''

# ---------- 4) 2 秒后自动打开浏览器（服务起来之后再打开） ----------
if (-not $NoBrowser) {
    try {
        Start-Job -ScriptBlock {
            param($u)
            Start-Sleep -Seconds 2
            Start-Process $u
        } -ArgumentList $url | Out-Null
    } catch { }
}

# ---------- 5) 起服务 ----------
$py = ''
if (Get-Command py -ErrorAction SilentlyContinue) { $py = 'py' }
elseif (Get-Command python -ErrorAction SilentlyContinue) { $py = 'python' }

if ($py) {
    $args = @()
    if ($py -eq 'py') { $args += '-3' }
    $args += @('-m', 'http.server', "$Port", '--bind', '0.0.0.0')
    & $py @args
    Write-Line ''
    Write-Line '  服务已停止。'
    Read-Host '按回车键关闭'
    exit 0
}

if (Get-Command node -ErrorAction SilentlyContinue) {
    & node (Join-Path $PSScriptRoot 'serve.js') "$Port" $root
    Write-Line ''
    Write-Line '  服务已停止。'
    Read-Host '按回车键关闭'
    exit 0
}

Write-Line '  [×] 这台电脑上没找到 Python 或 Node.js，无法启动本地服务。'
Write-Line '      请到 https://www.python.org/downloads/ 下载安装 Python'
Write-Line '      （安装时务必勾选 Add python.exe to PATH），然后重新双击本文件。'
Write-Line ''
Read-Host '按回车键关闭'
exit 1