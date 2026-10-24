// 零依赖静态服务器：node scripts/serve.mjs [--port 5173]
// 同时打印局域网地址，手机连同一 Wi-Fi 即可访问。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function argValue(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const PORT = Number(argValue('port', process.env.PORT || 5173));

function safePath(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const full = path.resolve(ROOT, '.' + p);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  let file = safePath(url);
  const headers = { 'Cache-Control': 'no-store' };
  if (!file) { res.writeHead(403, headers); return res.end('Forbidden'); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    file = path.join(ROOT, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404, headers); return res.end('Not found'); }
    headers['Content-Type'] = MIME['.html'];
    headers['Cache-Control'] = 'no-store';
    res.writeHead(200, headers);
    return fs.createReadStream(file).pipe(res);
  }
  headers['Content-Type'] = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  if (file.endsWith('sw.js')) headers['Cache-Control'] = 'no-cache';
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const lan = [];
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) lan.push(n.address);
    }
  }
  console.log('俄语背单词 · 本地服务已启动');
  console.log('  电脑访问: http://localhost:' + PORT + '/');
  lan.forEach((ip) => console.log('  手机访问: http://' + ip + ':' + PORT + '/  (需同一 Wi-Fi)'));
  console.log('  停止: Ctrl+C');
});
