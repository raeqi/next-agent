#!/usr/bin/env node
// 零依赖静态服务器：/ → desktop/，/workspace-seed/* → 演示素材。
//   node desktop/serve.mjs [--port 7799]
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const PORT = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 7799
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.jsonl': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png',
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = decodeURIComponent(url.pathname)
  const base = p.startsWith('/workspace-seed/') ? ROOT : join(ROOT, 'desktop')
  const file = normalize(join(base, p === '/' ? '/index.html' : p))
  if (!file.startsWith(base)) return res.writeHead(403).end('forbidden')
  if (!existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end('not found')
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
  res.end(readFileSync(file))
}).listen(PORT, '127.0.0.1', () => console.log(`拾遗 desktop → http://127.0.0.1:${PORT}`))
