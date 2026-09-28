/*!
 * 课堂投票 · 迷你静态服务（Node.js 兜底）
 * -----------------------------------------------------------------------------
 * 「启动课堂投票（局域网）.bat」/「start-vote-server.sh」在没有 Python 时会用
 * 它来起服务：  node serve.js [端口] [要提供的目录]
 * （目录省略时用当前目录；默认端口 8787）保持窗口开着即可；Ctrl+C 停止。
 * ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const port = Number(process.argv[2]) || 8787;
const root = path.resolve(process.argv[3] || process.cwd());

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.wasm': 'application/wasm',
    '.gz': 'application/gzip',
    '.zip': 'application/zip'
};

function lanIPs() {
    const out = [];
    const ifaces = os.networkInterfaces();
    Object.keys(ifaces).forEach(function (name) {
        (ifaces[name] || []).forEach(function (info) {
            if (info && info.family === 'IPv4' && !info.internal) out.push(info.address);
        });
    });
    return out;
}

http.createServer(function (req, res) {
    let rel = decodeURIComponent(String(req.url || '/').split('?')[0]);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(root, rel));
    if (file.indexOf(root) !== 0) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('403');
    }
    fs.readFile(file, function (err, data) {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('404 ' + rel);
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
    });
}).listen(port, '0.0.0.0', function () {
    console.log('');
    console.log('  课堂投票 · 局域网服务已启动（Ctrl+C 停止）');
    lanIPs().forEach(function (ip) {
        console.log('    http://' + ip + ':' + port + '/');
    });
    console.log('');
});