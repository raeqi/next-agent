// 微信窗口 OCR 结果 → 会话名 + 消息（谁说的）→ 和已见过的对比出新消息。
// 只依赖版式：左侧导航+会话列表、右侧聊天区；对方气泡靠左、自己的气泡靠右；顶部是会话名，底部是输入框。

const TIME = /^(\d{1,2}:\d{2}(\s?[AP]M)?|昨天.*|星期.|周.|\d{4}年.*|\d{1,2}月\d{1,2}日.*|上午.*|下午.*|晚上.*|(Yesterday|Today|Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\b.*|\d{1,2}\/\d{1,2}(\/\d{2,4})?.*)$/i

/**
 * @param {{window:{w:number,h:number}, lines:{text:string,x:number,y:number,w:number,h:number,conf:number}[]}} obs
 * @param {number} listWidthCfg 配置的会话列表右边界（pt），0 = 自动
 */
export function parseWeChat(obs, listWidthCfg = 0) {
  const W = obs.window.w, H = obs.window.h
  const lines = obs.lines
    .filter(l => l.conf >= 0.3 && l.text.trim())
    .map(l => ({ text: l.text.trim(), X: l.x * W, Y: l.y * H, R: (l.x + l.w) * W, B: (l.y + l.h) * H, lh: l.h * H }))

  const L = listWidthCfg || findDivider(lines, W)
  const panel = lines.filter(l => l.X >= L - 4)
  const P = W - L

  // 顶部会话名：聊天区顶部 60pt 内、靠左的那行字（右上角的图标会被 OCR 成「-6…」之类的碎片，要排除）
  const isTitle = l => l.Y < 60 && l.X < L + P * 0.6 && /[\p{L}\p{N}]{2,}/u.test(l.text.replace(/[（(]\d+[)）]/g, ''))
  const header = panel.filter(isTitle).sort((a, b) => a.X - b.X || a.Y - b.Y)
  const rawTitle = header[0]?.text ?? ''
  const group = /[（(]\d+[)）]\s*$/.test(rawTitle)
  const conv = rawTitle.replace(/^[<‹]\s*/, '').replace(/\s*[（(]\d+[)）]\s*$/, '').replace(/[…\.]+$/, '').trim()

  // 输入框：底部 ~150pt；这里的文字是「还没发出去的」
  const inputTop = H - 150
  const typing = panel.filter(l => l.Y >= inputTop).map(l => l.text).join('')

  const headerBottom = header[0] ? header[0].B + 10 : 60
  const body = panel.filter(l => l.Y >= headerBottom && l !== header[0] && l.B < inputTop).sort((a, b) => a.Y - b.Y)
  const items = []
  for (const l of body) {
    const center = (l.X + l.R) / 2
    let side
    if (TIME.test(l.text) && Math.abs(center - (L + P / 2)) < P * 0.15) side = 'meta'
    else if (l.R > L + P * 0.6 && l.X > L + P * 0.3) side = 'me'
    else if (l.X < L + P * 0.4) side = 'other'
    else side = 'meta'
    const prev = items[items.length - 1]
    // 同一侧、垂直间距小 → 同一个气泡的下一行
    if (prev && prev.side === side && side !== 'meta' && l.Y - prev.B < Math.max(prev.lh, l.lh) * 1.2 && Math.abs(l.X - prev.X) < 40) {
      // 群聊里对方气泡上方那行小字是名字（字号比消息小）：拼成「名字：内容」
      const nameAbove = group && side === 'other' && prev.lines === 1 && prev.text.length <= 20 && prev.lh < l.lh * 0.92
      prev.text += (nameAbove ? '：' : '') + l.text; prev.B = l.B; prev.lines++
    } else items.push({ side, text: l.text, X: l.X, B: l.B, lh: l.lh, lines: 1 })
  }
  return { conv, group, typing, messages: items.map(({ side, text }) => ({ side, text })), divider: L }
}

/**
 * 找会话列表与聊天区之间的竖向分界。
 * 主信号：会话列表里每行右侧的时间（「17:47」「昨天」「星期三」「11/5」）右对齐在列表边缘。
 * 兜底：从左往右第一个「没有文字横跨、左右两边都有若干行」的位置。
 */
function findDivider(lines, W) {
  const LIST_TIME = /^(\d{1,2}:\d{2}(\s?[AP]M)?|昨天|前天|星期.|周.|Yesterday|(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day|\d{1,2}\/\d{1,2}|\d{2,4}\/\d{1,2}\/\d{1,2})$/i
  const rs = lines.filter(l => LIST_TIME.test(l.text) && l.R < W * 0.6).map(l => l.R).sort((a, b) => a - b)
  let best = 0, bestN = 0
  for (const r of rs) {
    const n = rs.filter(x => Math.abs(x - r) < 6).length
    if (n > bestN) { bestN = n; best = r }
  }
  if (bestN >= 2) return best + 8
  for (let x = 180; x <= W * 0.6; x += 4) {
    if (lines.some(l => l.X < x && l.R > x)) continue
    if (lines.filter(l => l.R <= x && l.X > 50).length >= 3 && lines.filter(l => l.X >= x).length >= 3) return x
  }
  return Math.round(W * 0.3)
}

export const keyOf = m => `${m.side}:${m.text.replace(/[\s，,。.！!？?…·•]/g, '')}`

/** 与已见过的对比，返回新消息。首次见到某会话时只入库不触发（避免把历史当新动静）。 */
export function diff(seen, conv, messages) {
  const known = new Set(seen[conv] ?? [])
  const first = !seen[conv]
  const fresh = []
  for (const m of messages) {
    if (m.side === 'meta' || m.text.length < 2) continue
    const k = keyOf(m)
    if (known.has(k)) continue
    known.add(k)
    fresh.push(m)
  }
  seen[conv] = [...known].slice(-1500)
  return { first, fresh }
}
