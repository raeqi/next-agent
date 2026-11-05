#!/usr/bin/env node
/**
 * 零依赖端到端驱动 + 截图：用 CDP 控制本机 Chrome（无 playwright）。
 *   node scripts/e2e.mjs [url] [outdir]
 * 既做交互回归（点击、审批、接管、新建、切任务），也产出演示截图。
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.argv[2] || 'http://127.0.0.1:7788';
const OUT = process.argv[3] || 'shots';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;

mkdirSync(OUT, { recursive: true });

const results = [];
function ok(name, extra) { results.push({ name, pass: true, extra }); console.log('  ✅ ' + name + (extra ? '  ' + extra : '')); }
function bad(name, extra) { results.push({ name, pass: false, extra }); console.log('  ❌ ' + name + (extra ? '  ' + extra : '')); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 8000, interval = 120) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    await sleep(interval);
  }
  return null;
}

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--hide-scrollbars', '--disable-crash-reporter', '--crash-dumps-dir=/tmp',
  `--user-data-dir=/tmp/helm-e2e-${process.pid}`,
  `--remote-debugging-port=${PORT}`,
  '--window-size=1600,1000',
  'about:blank',
], { stdio: 'ignore' });

let ws;
let msgId = 0;
const pending = new Map();
const consoleErrors = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expr) {
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'evaluate failed');
  return res.result && res.result.value;
}

async function shot(name) {
  const res = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = join(OUT, name + '.png');
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('  📸 ' + file);
}

async function click(testid) {
  const found = await waitFor(() => evaluate(`(() => { const el = document.querySelector('[data-testid="${testid}"]'); if (!el) return null; el.scrollIntoView({block:'center'}); el.click(); return true; })()`), 6000);
  if (!found) throw new Error('元素找不到：' + testid);
}

async function typeInto(testid, text) {
  await evaluate(`(() => {
    const el = document.querySelector('[data-testid="${testid}"]');
    if (!el) throw new Error('no input');
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}

async function exists(testid) {
  return evaluate(`!!document.querySelector('[data-testid="${testid}"]')`);
}

async function main() {
  // 等 Chrome devtools 端点
  const target = await waitFor(async () => {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      return page ? page.webSocketDebuggerUrl : null;
    } catch { return null; }
  }, 15000);
  if (!target) throw new Error('Chrome devtools 未就绪');
  ws = new WebSocket(target);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails.text || 'exception');
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value).join(' '));
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable').catch(() => {});
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });

  const mounted = await waitFor(() => evaluate(`!!document.querySelector('[data-testid="helm-root"]')`), 15000);
  if (!mounted) throw new Error('驾驶舱没有挂载');
  ok('挂载：三栏渲染完成');
  await sleep(600);
  await shot('01-open');

  /* ---- 1. 打开时的等待态 ---- */
  const intent = await evaluate(`document.querySelector('[data-testid="mission-intent"]').textContent`);
  if (intent && intent.includes('飞书')) ok('意图原文正确渲染'); else bad('意图原文', intent);

  const inboxCount = await evaluate(`document.querySelectorAll('[data-testid^="inbox-option-"]').length`);
  if (inboxCount >= 3) ok('例外收件箱：审批选项已渲染', inboxCount + ' 个选项'); else bad('收件箱选项数量', inboxCount);

  const hscroll = await evaluate(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
  if (hscroll) ok('1600 宽无横向滚动'); else bad('1600 宽出现横向滚动');

  /* ---- 2. 裁定数据冲突 ---- */
  await evaluate(`__HELM__.engine.actions.setSpeed(4)`);
  await click('inbox-option-opt-both');
  await sleep(900);
  const resolved = await evaluate(`!!document.querySelector('[data-testid="inbox-resolved-ap-price"]')`);
  if (resolved) ok('裁定提交后审批折叠为已处理'); else bad('审批未折叠');

  // 等发送审批出现
  const sendReady = await waitFor(() => exists('inbox-option-send-now'), 12000);
  if (sendReady) ok('任务继续跑到「发送」高风险审批'); else bad('未出现发送审批');
  await shot('02-after-ruling');

  /* ---- 3. 批准发送 → 交付物 ---- */
  if (sendReady) {
    await click('inbox-option-send-now');
    await sleep(1400);
    await click('panels-tab-artifact');
    await sleep(500);
    const delivered = await evaluate(`!!document.querySelector('[data-testid="artifact-delivered"]')`);
    if (delivered) ok('交付回执出现（发送留痕）'); else bad('没有交付回执');
    const bodyLen = await evaluate(`(document.querySelector('[data-testid="artifact-body"]')||{}).textContent?.length || 0`);
    if (bodyLen > 300) ok('交付物正文渲染', bodyLen + ' 字'); else bad('交付物正文过短', bodyLen);
    await shot('03-artifact');

    // 证据链与上下文账本
    await click('panels-tab-evidence');
    await sleep(400);
    const evidenceCount = await evaluate(`document.querySelectorAll('[data-testid^="evidence-item-"]').length`);
    if (evidenceCount >= 5) ok('证据链渲染', evidenceCount + ' 条来源'); else bad('证据条数异常', evidenceCount);
    await shot('03b-evidence');

    await click('panels-tab-context');
    await sleep(400);
    const slices = await evaluate(`document.querySelectorAll('[data-testid^="ctx-slice-"]').length`);
    if (slices >= 3) ok('上下文账本渲染', slices + ' 段'); else bad('上下文分段异常', slices);
    await shot('03c-context');

    await click('panels-tab-artifact');
    await sleep(300);
  }

  /* ---- 4. 切到常驻任务 ---- */
  await click('fleet-item-m-watch');
  await sleep(500);
  const standing = await evaluate(`document.querySelector('[data-testid="mission-title"]').textContent`);
  if (standing && standing.includes('监控')) ok('切换到常驻任务'); else bad('切换常驻任务', standing);
  await shot('04-standing');

  /* ---- 5. 回到主角任务，重跑一帧后接管 ---- */
  await click('fleet-item-m-weekly');
  await sleep(300);
  await click('mission-replay');
  await sleep(600);
  await click('mission-takeover');
  await sleep(400);
  const drawer = await exists('takeover-input');
  if (drawer) ok('接管抽屉打开（agent 暂停）'); else bad('接管抽屉没有出现');
  await typeInto('takeover-input', '定价先不下结论，把三家官方价格页抓全并附原始截图。');
  await sleep(300);
  await shot('05-takeover');
  if (drawer) {
    await click('takeover-submit');
    await sleep(700);
    const handed = await evaluate(`document.body.textContent.includes('接手改写') || document.body.textContent.includes('你的方向') || document.body.textContent.includes('交还')`);
    if (handed) ok('交还后继续执行（出现人工介入记录）'); else bad('交还后没有人工介入记录');
  }

  /* ---- 6. 新建任务 ---- */
  await click('fleet-new');
  await sleep(300);
  const inputReady = await exists('fleet-input');
  if (inputReady) ok('新建任务输入区展开'); else bad('新建任务输入区未展开');
  if (inputReady) {
    await typeInto('fleet-input', '帮我把这周的客户访谈录音要点整理成一页 memo，标出 3 个待决策问题。');
    await sleep(200);
    await shot('06-composer');
    await click('fleet-submit');
    await sleep(2200);
    const created = await evaluate(`(() => { const s = __HELM__.engine.getState(); return s.fleet.some(m => m.id.startsWith('m-user-')) && s.selected.intent.includes('客户访谈'); })()`);
    if (created) ok('新任务已创建并选中（剧本开始播放）'); else bad('新任务未创建');
    await shot('07-new-mission');
  }

  /* ---- 7. 1280 窄屏 ---- */
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const narrowOk = await evaluate(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
  if (narrowOk) ok('1280 宽无横向滚动'); else bad('1280 宽出现横向滚动');
  await shot('08-1280');

  const errors = consoleErrors.filter((e) => !/favicon|ResizeObserver/i.test(e));
  if (errors.length === 0) ok('控制台无 JS 报错'); else bad('控制台有报错', errors.slice(0, 3).join(' | '));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((error) => { console.error('❌ e2e 失败：', error.message); process.exitCode = 1; })
  .finally(async () => {
    try { ws && ws.close(); } catch { /* 忽略 */ }
    chrome.kill('SIGKILL');
    await sleep(100);
  });
