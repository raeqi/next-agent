#!/usr/bin/env node
// 不开真应用也能测：按两类版式合成「OCR 结果」。
//   node scripts/sim-chat.mjs <port> <应用> <会话> <side:文本 | 名字:文本>...
//   bubble 类（微信/飞书/钉钉/企业微信/信息/Telegram/WhatsApp）：me:… / other:…
//   named 类（Slack/Discord/Teams）：直接写「名字:内容」，比如 "Lin Xia:I'll send it tomorrow"
//   加 --print 只打印合成结果（不发送）
const BUNDLES = {
  微信: 'com.tencent.xinWeChat', 飞书: 'com.electron.lark', 钉钉: 'com.alibaba.DingTalkMac', 企业微信: 'com.tencent.WeWorkMac',
  信息: 'com.apple.MobileSMS', Telegram: 'ru.keepcoder.Telegram', WhatsApp: 'net.whatsapp.WhatsApp',
  Slack: 'com.tinyspeck.slackmacgap', Discord: 'com.hnc.Discord', Teams: 'com.microsoft.teams2',
}
const NAMED = new Set(['Slack', 'Discord', 'Teams'])
const argv = process.argv.slice(2)
const print = argv.includes('--print')
const [port, app, conv, ...msgs] = argv.filter(a => a !== '--print')
const W = 1000, H = 700, L = 300
const lines = []
const add = (text, X, Y, w, h = 16) => lines.push({ text, conf: 0.9, x: X / W, y: Y / H, w: w / W, h: h / H })
const wOf = t => Math.min(420, [...t].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 13 : 7), 0))

if (NAMED.has(app)) {
  // 左侧频道列表（没有时间列）
  ;['# general', '# product', '# random', 'Wang Jianguo'].forEach((n, i) => add(n, 24, 70 + i * 28, wOf(n)))
  add(conv, L + 20, 18, wOf(conv), 18)
  let y = 80, last = ''
  for (const m of msgs) {
    const i = m.indexOf(':'); const who = m.slice(0, i), text = m.slice(i + 1)
    if (who !== last) { y += 10; add(who, L + 64, y, wOf(who), 15); add('10:32 AM', L + 64 + wOf(who) + 8, y + 2, 52, 12); y += 22; last = who }
    add(text, L + 64, y, wOf(text)); y += 30
  }
  add('Message ' + conv, L + 20, H - 70, 200)
} else {
  ;[['王建国', '17:47'], ['产品群', '17:44'], ['陈默', '昨天'], ['文件传输助手', '星期三']].forEach(([n, t], i) => { add(n, 110, 80 + i * 64, 90); add(t, L - 42, 80 + i * 64, 34) })
  add(conv, L + 20, 22, wOf(conv), 18)
  add('17:40', L + (W - L) / 2 - 18, 80, 36)
  let y = 120
  for (const m of msgs) {
    const i = m.indexOf(':'); const side = m.slice(0, i), text = m.slice(i + 1)
    if (side === 'me') add(text, W - 70 - wOf(text), y, wOf(text)); else add(text, L + 70, y, wOf(text))
    y += 46
  }
  add('输入框里还没发的字', L + 20, H - 110, 200)
}
const obs = { app, bundle: BUNDLES[app], window: { w: W, h: H }, image: { w: W * 2, h: H * 2 }, lines }
if (print) { console.log(JSON.stringify(obs)); process.exit(0) }
await fetch(`http://127.0.0.1:${port}/observe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obs) })
console.log(`→ ${app} · ${conv}：${msgs.length} 条`)
