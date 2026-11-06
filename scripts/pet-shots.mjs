#!/usr/bin/env node
// 桌宠面板截图（CDP）：node scripts/pet-shots.mjs [port] [outdir]
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
const [port = '7801', out = 'shots/live'] = process.argv.slice(2)
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DBG = 9351, prof = `/tmp/shiyi-pet-${process.pid}`
mkdirSync(out, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${prof}`, `--remote-debugging-port=${DBG}`, 'about:blank'], { stdio: 'ignore' })
let t
for (let i = 0; i < 150 && !t; i++) { await sleep(200); try { t = (await (await fetch(`http://127.0.0.1:${DBG}/json`)).json()).find(x => x.type === 'page' && !x.url.startsWith('chrome')) } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r)
let id = 0; const pend = new Map(); const errs = []
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { pend.get(m.id)?.(m.result); pend.delete(m.id) } if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description) }
const send = (method, params = {}) => new Promise(r => { pend.set(++id, r); ws.send(JSON.stringify({ id, method, params })) })
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 440, height: 700, deviceScaleFactor: 2, mobile: false })
await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 232, g: 226, b: 216, a: 1 } })
for (const v of ['cards', 'today', 'insight', 'book', '']) {
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/pet/${v ? '?view=' + v : ''}` })
  await sleep(1500)
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${out}/pet-${v || 'collapsed'}.png`, Buffer.from(r.data, 'base64'))
  console.log(`📸 ${out}/pet-${v || 'collapsed'}.png`)
}
console.log(errs.length ? '❌ JS 报错：' + errs.join(' | ') : '✅ 无 JS 报错')
ws.close(); chrome.kill(); await sleep(300); rmSync(prof, { recursive: true, force: true })
