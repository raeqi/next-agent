#!/usr/bin/env node
// 不开微信也能测：按微信 Mac 版的版式合成「OCR 结果」，发给 daemon 的 /observe。
//   node scripts/sim-wechat.mjs [port] <会话名> <side:文本>...
//   例：node scripts/sim-wechat.mjs 7811 王建国 "other:能先给我一版竞品对比吗" "me:好的王总，明天上午发你竞品对比"
const [port = '7801', conv = '文件传输助手', ...msgs] = process.argv.slice(2)
const W = 1000, H = 700, L = 320
const lines = []
const add = (text, X, Y, w, h = 16) => lines.push({ text, conf: 0.9, x: X / W, y: Y / H, w: w / W, h: h / H })
// 左侧会话列表（名字 + 时间右对齐在列表边缘）
;[['王建国', '17:47'], ['听澜 · 产品群', '17:44'], ['陈默', '昨天'], ['文件传输助手', '星期三']].forEach(([n, t], i) => {
  add(n, 120, 80 + i * 64, 90); add(t, 312 - 34, 80 + i * 64, 34)
})
add(conv, L + 20, 22, 120, 18)                          // 顶部会话名
add('17:40', L + (W - L) / 2 - 18, 80, 36)              // 居中时间
let y = 120
for (const m of msgs) {
  const [side, ...rest] = m.split(':'); const text = rest.join(':')
  const w = Math.min(380, text.length * 13)
  if (side === 'me') add(text, W - 70 - w, y, w)
  else add(text, L + 70, y, w)
  y += 46
}
add('输入框里还没发的字', L + 20, H - 110, 200)          // 输入框（应被忽略）
await fetch(`http://127.0.0.1:${port}/observe`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ app: '微信', window: { w: W, h: H }, image: { w: W * 2, h: H * 2 }, lines }),
})
console.log(`→ 已发送 ${conv}：${msgs.length} 条`)
