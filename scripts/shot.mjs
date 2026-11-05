#!/usr/bin/env node
/**
 * headless Chrome 截图（零依赖，直接拉起本机 Chrome）。
 *   node scripts/shot.mjs <url> <out.png> [宽] [高] [等待毫秒]
 * 例：node scripts/shot.mjs http://127.0.0.1:7788 shots/home.png 1600 1000 1500
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [url, out = 'out.png', w = '1600', h = '1000', wait = '1200'] = process.argv.slice(2);
if (!url) { console.error('用法：node scripts/shot.mjs <url> <out.png> [宽] [高] [等待毫秒]'); process.exit(1); }

const outPath = resolve(out);
mkdirSync(dirname(outPath), { recursive: true });
const profile = `/tmp/helm-chrome-${process.pid}`;

const res = spawnSync(CHROME, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--disable-crash-reporter',
  '--crash-dumps-dir=/tmp',
  `--user-data-dir=${profile}`,
  '--force-device-scale-factor=1',
  `--window-size=${w},${h}`,
  `--virtual-time-budget=${wait}`,
  `--screenshot=${outPath}`,
  url,
], { encoding: 'utf8' });

const ok = existsSync(outPath) && statSync(outPath).size > 1000;
if (ok) console.log(`✅ ${outPath}  ${(statSync(outPath).size / 1024).toFixed(0)} KB`);
else {
  console.error('❌ 截图失败');
  console.error(res.stderr?.slice(-2000) || '');
  process.exit(1);
}
