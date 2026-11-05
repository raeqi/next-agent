#!/usr/bin/env node
/**
 * 零依赖静态服务器：预览独立版 demo。
 *   node demo/serve.mjs [--port 7788]
 * 产物来自 app/dist（先跑 node app/build.mjs）。
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'app', 'dist');
const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT = portArg >= 0 ? Number(args[portArg + 1]) : 7788;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
};

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let path = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = join(DIST, decodeURIComponent(path));
  if (!file.startsWith(DIST)) { res.writeHead(403).end('forbidden'); return; }
  if (existsSync(file)) {
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }
  // 开发便利：/app/*、/plugin/*、/docs/*、/shots/* 直接透出，方便审查与插件冒烟测试
  const srcFile = join(ROOT, decodeURIComponent(url.pathname));
  if (/^\/(app|plugin|docs|shots)\//.test(url.pathname) && existsSync(srcFile)) {
    res.writeHead(200, { 'content-type': TYPES[extname(srcFile)] || 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(readFileSync(srcFile));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`HELM demo → http://127.0.0.1:${PORT}`);
  if (!existsSync(join(DIST, 'index.html'))) console.log('⚠️  app/dist/index.html 不存在，先运行：node app/build.mjs');
});
