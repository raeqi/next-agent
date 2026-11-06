#!/usr/bin/env node
// 拾遗假桌面端到端：CDP 驱动本机 Chrome，走完 7 幕、断言关键状态、截图。
//   node desktop/serve.mjs &   然后   node scripts/desktop-e2e.mjs [url] [outdir]
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const URL = process.argv[2] ?? 'http://127.0.0.1:7799'
const OUT = process.argv[3] ?? 'shots/desktop'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9341
const W = 1600, H = 1000
mkdirSync(OUT, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let fails = 0
const ok = (cond, name) => { console.log(`  ${cond ? '✅' : '❌'} ${name}`); if (!cond) fails++ }

const profile = `/tmp/shiyi-e2e-${process.pid}`
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${PORT}`, `--window-size=${W},${H}`, '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' })

let ws, id = 0
const pending = new Map()
const errors = []
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) })
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result?.value
}
async function until(expr, ms = 20000) {
  const t = Date.now()
  while (Date.now() - t < ms) { try { if (await js(expr)) return true } catch { /* 重试 */ } await sleep(150) }
  return false
}
async function shot(name) {
  await sleep(350)   // 等入场动画结束
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, name + '.png'), Buffer.from(r.data, 'base64'))
  console.log(`  📸 ${OUT}/${name}.png`)
}
/** 点击包含文字的按钮（可限定选择器）。 */
const clickText = (sel, text) => until(`(() => { const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(e=>e.textContent.includes(${JSON.stringify(text)})); if(!b) return false; b.click(); return true })()`, 8000)
const next = () => js('__SHIYI__.next()')
const S = expr => `__SHIYI__.state.${expr}`

try {
  let target
  for (let i = 0; i < 150 && !target; i++) {
    await sleep(200)
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === 'page' && !t.url.startsWith('chrome')) } catch { /* 等 Chrome */ }
  }
  if (!target) throw new Error('Chrome 调试端口 30 秒内没有就绪')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(r => ws.addEventListener('open', r))
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result ?? {}); pending.delete(m.id) }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '))
  })
  await send('Runtime.enable'); await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: URL })
  ok(await until('!!globalThis.__SHIYI__'), '页面加载，素材就绪')
  await shot('00-start')

  console.log('第 1 幕 · 随口一句')
  await next()
  ok(await js(S('commitments.length')) === 1, '记下 1 个承诺（王总 · 竞品对比）')
  ok(await js(`${S('insight')}.filter(e=>e.verdict==='ignore').length`) >= 2, '至少 2 条动静被忽略（不打扰）')
  await js(`document.querySelector('.pet-wrap .pet-menu button:last-child').click()`)
  await sleep(400); await shot('01-promise-insight')
  await js(`document.querySelector('.drawer .card-x').click()`)

  console.log('第 2 幕 · 早安')
  await next()
  ok(await until(`!!document.querySelector('.card-commitment')`), '出现「已备好」建议卡')
  await shot('02-morning-card')
  await clickText('.card-commitment .btn', '看看草稿')
  ok(await until(`!!document.querySelector('.app-doc .doc-banner')`), '打开影子副本草稿')
  await js(`document.querySelector('.app-doc .cite').click()`)
  ok(await until(`!!document.querySelector('.cite-pop .is-hl')`), '点出处编号 → 原文高亮')
  await shot('02b-draft-cite')
  await js(`document.querySelector('.cite-pop')?.remove()`)

  console.log('第 3 幕 · 划掉一句')
  await next()
  await js(`document.querySelector('.app-doc .is-hl .block-reject').click()`)
  ok(await until(`!!document.querySelector('.reason-pop')`), '弹出「为什么」')
  await shot('03a-reason')
  await clickText('.reason-pop .chip', '我觉得')
  ok(await until(`!!document.querySelector('.card-learn')`), '提议记住一条规则')
  ok(!(await js(`${S("docs['竞品对比'].text")}.includes('我觉得')`)), '草稿里的「我觉得」已改掉')
  await shot('03b-learn')
  await clickText('.card-learn .btn', '记住')
  ok(await js(S('rules.length')) === 1, '手册新增 1 条规则')
  ok(await until(`!!document.querySelector('.app-book .book-rule')`), '手册窗口展示新规则')
  await shot('03c-handbook')
  await clickText('.app-doc .doc-actions .btn', '发给王总')
  ok(await js(`${S('commitments')}.find(c=>c.id==='c-wang').status==='done'`), '竞品对比已发，承诺划掉')

  console.log('第 4 幕 · 数字对不上')
  await next()
  ok(await until(`!!document.querySelector('.rev[data-rev=dau]')`), '周报原文上出现修订 12 万 → 10.8 万')
  await shot('04-revision')
  await js(`document.querySelector('.rev [data-act=accept]').click()`)
  ok(await until(`${S("docs['周报'].text")}.includes('DAU 10.8 万')`), '接受修订后原件更新')
  ok(await until(`!!document.querySelector('.rev-done button')`), '可撤回')

  console.log('第 5 幕 · 私人窗口')
  await next()
  ok(await js(S('commitments.length')) === 2, '记下第 2 个承诺（陈默 · 私有化意见）')
  ok(await until(`document.querySelector('.pet').classList.contains('is-closed')`), '打开网银 → 桌宠闭眼')
  await shot('05-private')
  await js(`document.querySelector('.app-bank .light-close').click()`)
  ok(await until(`!document.querySelector('.pet').classList.contains('is-closed')`), '关掉网银 → 睁眼')

  console.log('第 6 幕 · 航班延误')
  const p6 = next()
  ok(await until(`document.body.classList.contains('is-away')`), '进入耳机模式')
  ok(await until(`[...document.querySelectorAll('.away-ctl .btn')].length >= 3`, 30000), '出现语音/快捷拍板')
  await shot('06a-away')
  await clickText('.away-ctl .btn', '「发」')
  ok(await until(`${S('sent')}.includes('chain')`), '说「发」→ 两条消息已发')
  await sleep(600); await shot('06b-sent')
  await clickText('.away-ctl .btn', '回到电脑'); await p6

  console.log('第 7 幕 · 下班收尾')
  await next()
  ok(await until(`!!document.querySelector('.card-wrap')`), '出现下班收尾卡')
  ok(await until(`!!document.querySelector('.wrap-rule')`), '提示：已按早上学的规则写')
  await shot('07a-wrap')
  await clickText('.card-wrap .btn', '看给陈默的草稿')
  ok(await until(`!!document.querySelector('.app-doc .doc-banner')`), '打开给陈默的草稿')
  ok(!(await js(`${S("docs['陈默意见'].text")}.includes('我觉得')`)), '草稿没有「我觉得」')
  await shot('07b-chenmo')
  await clickText('.app-doc .doc-actions .btn', '发给陈默')
  ok(await js(`${S('commitments')}.every(c=>c.status==='done')`), '今天的承诺全部兑现')
  await sleep(500); await shot('07c-done')

  ok(errors.length === 0, `无 JS 报错${errors.length ? '：' + errors.join(' | ') : ''}`)
} catch (e) {
  fails++
  console.error('❌ 中断：', e.message)
} finally {
  ws?.close(); chrome.kill()
  await sleep(300); rmSync(profile, { recursive: true, force: true })
  console.log(fails ? `\n${fails} 项失败` : '\n全部通过')
  process.exit(fails ? 1 : 0)
}
