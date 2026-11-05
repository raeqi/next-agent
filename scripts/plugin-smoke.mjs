#!/usr/bin/env node
/**
 * 插件半冒烟：在 headless Chrome 里加载 plugin/smoke.html，
 * 断言 plugin/client.js 能在最小 React + Slots 环境下注册入口并成功挂载驾驶舱。
 *   node scripts/plugin-smoke.mjs [url]
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:7788/plugin/smoke.html';
const PORT = 9334;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--hide-scrollbars', '--disable-crash-reporter', '--crash-dumps-dir=/tmp',
  `--user-data-dir=/tmp/helm-plugin-${process.pid}`,
  `--remote-debugging-port=${PORT}`, '--window-size=1600,1000', 'about:blank',
], { stdio: 'ignore' });

let ws; let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
  return res.result.value;
};

async function main() {
  let target;
  for (let i = 0; i < 80 && !target; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) target = page.webSocketDebuggerUrl;
    } catch { /* retry */ }
    if (!target) await sleep(150);
  }
  if (!target) throw new Error('devtools 未就绪');
  ws = new WebSocket(target);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: URL });

  let results = null;
  for (let i = 0; i < 60 && !results; i += 1) {
    await sleep(200);
    try { results = await evaluate('window.__SMOKE__ || null'); } catch { /* retry */ }
  }
  if (!results) throw new Error('冒烟结果未生成（插件可能加载失败）');
  results.forEach((r) => console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}${r.extra ? '  ' + r.extra : ''}`));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  mkdirSync('shots', { recursive: true });
  writeFileSync('shots/09-plugin-smoke.png', Buffer.from(shot.data, 'base64'));
  console.log('  📸 shots/09-plugin-smoke.png');

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((error) => { console.error('❌ 插件冒烟失败：', error.message); process.exitCode = 1; })
  .finally(async () => { try { ws && ws.close(); } catch { /* ignore */ } chrome.kill('SIGKILL'); });
