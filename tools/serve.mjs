import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import os from 'node:os';

const ROOT = normalize(import.meta.dirname + '/..');
const PORT = 8000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function lanIPs() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) ips.push(item.address);
    }
  }
  return ips;
}

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('词力闯关 · 手机版服务器已启动');
  console.log('----------------------------------------');
  console.log('1. 请确认手机和电脑连接的是同一个 WiFi');
  console.log('2. 在手机 Safari 里打开下面任一地址：');
  for (const ip of lanIPs()) console.log('   http://' + ip + ':' + PORT);
  console.log('3. 若手机打不开，请允许 Windows 防火墙访问（或临时关闭防火墙再试）');
  console.log('4. 按 Ctrl+C 可停止服务器');
  console.log('----------------------------------------');
});
