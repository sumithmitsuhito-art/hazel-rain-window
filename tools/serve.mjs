import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.HAZEL_PORT || 4173);
http.createServer((req, res) => {
  if (req.url !== '/' && req.url !== '/index.html' && req.url !== '/game.html') { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  fs.createReadStream(path.join(root, 'dist/game.html')).on('error', () => { res.writeHead(404); res.end('Run npm run build first.'); }).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`));
