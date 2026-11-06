#!/usr/bin/env node
// 拾遗 daemon：感知 → 筛选 → 记下 → 起草 → 在对的时候开口 → 从驳回里学习。
//   node daemon/main.mjs [--port 7801] [--no-pet]
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, extname, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile, spawn } from 'node:child_process'
import { state, live, config, WS, HOME, subscribe, changed, save, insight, card, dropCard, maySpeak, spoke, hm, ymd, uid } from './store.mjs'
import { parseWeChat, diff, keyOf } from './wechat.mjs'
import { appendTranscript, judgeCommitment, judgeRule, draft, redraft, readDraft, writeHandbook, shutdownAgents, safe } from './agent.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const PORT = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 7801

/* ═════════════ 感知 → 筛选 ═════════════ */

const PROMISE = /(发你|发给你|给你|回你|回复你|告诉你|整理|跟进|看一下|看下|看看|弄好|搞定|安排|确认|提交|准备|写好|发过去|约一下|拉个群|我来|我去|我负责|包在我)/
const WHEN = /(明天|明早|今晚|今天|待会|等会|一会|回头|晚点|稍后|下午|上午|中午|晚上|周[一二三四五六日天]|下周|月底|马上|这就|之后|改天)/
const QUESTION = /[?？吗呢]$/
const REQUEST = /(能不能|麻烦|帮我|帮忙|可以.{0,8}吗|记得|辛苦)/

const recent = {}   // conv → 最近 40 条
let observing = false

async function onObserve(obs) {
  live.lastObserveAt = Date.now()
  if (!live.eyes || observing) return
  observing = true
  try {
    const p = parseWeChat(obs, config.wechatListWidth)
    if (!p.conv || config.ignoreConvs.some(c => p.conv.includes(c))) return
    const { first, fresh } = diff(state.seen, p.conv, p.messages)
    if (!fresh.length) { save(); return }
    const at = new Date().toISOString()
    const transcript = appendTranscript(p.conv, fresh.map(m => ({ ...m, at: first ? null : at })))
    recent[p.conv] = [...(recent[p.conv] ?? []), ...fresh].slice(-40)
    if (first) {
      insight({ src: `微信 · ${p.conv}`, text: `第一次看到这个会话：${fresh.length} 条历史消息只当上下文，不触发`, verdict: 'remember', layer: '本机 OCR', cost: '0 token' })
      return
    }
    checkFulfilled(p.conv, fresh)
    const cands = [], asks = []
    for (const m of fresh) {
      if (m.side === 'me' && PROMISE.test(m.text) && !QUESTION.test(m.text)) cands.push(m)
      else if (m.side === 'other' && REQUEST.test(m.text)) asks.push(m)
    }
    for (const m of asks) insight({ src: `微信 · ${p.conv}`, text: `对方：「${m.text}」→ 一个请求，先记着，看你怎么回`, verdict: 'remember', layer: 'L0 规则', cost: '0 token' })
    const rest = fresh.length - cands.length - asks.length
    if (rest > 0) insight({ src: `微信 · ${p.conv}`, text: `${rest} 条新消息与要兑现的事无关`, verdict: 'ignore', layer: 'L0 规则', cost: '0 token' })
    for (const m of cands) handleCandidate(p.conv, m, transcript).catch(e => insight({ src: '筛选', text: e.message, verdict: 'error' }))
  } finally { observing = false }
}

async function handleCandidate(conv, m, transcript) {
  const k = keyOf(m)
  if (state.commitments.some(c => c.conv === conv && c.key === k)) return
  const strong = WHEN.test(m.text)
  insight({ src: `微信 · ${conv}`, text: `你说「${m.text}」→ 像是一个承诺${strong ? '（带时间）' : ''}，交给轻量模型确认`, verdict: 'act', layer: 'L0 承诺句式', cost: '0 token' })
  const t0 = Date.now()
  const j = await judgeCommitment({ conv, recent: recent[conv] ?? [m], quote: m.text })
  const cost = `L1 ${config.triageModel} · ${((Date.now() - t0) / 1000).toFixed(1)}s`
  if (!j.commitment || (j.confidence ?? 0) < 0.6) {
    insight({ src: `微信 · ${conv}`, text: `不算承诺：${j.why ?? ''}`, verdict: 'ignore', layer: cost })
    return
  }
  const c = {
    id: uid('c'), key: k, conv, to: j.to || conv, what: j.what || m.text, quote: m.text,
    due: j.due || null, dueText: j.dueText || '', draftable: j.draftable !== false,
    at: new Date().toISOString(), status: 'open', transcript,
  }
  state.commitments.push(c)
  insight({ src: `微信 · ${conv}`, text: `记下承诺：${c.to} · ${c.what}${c.dueText ? ' · ' + c.dueText : ''}（${j.why ?? ''}）`, verdict: 'remember', layer: cost })
  live.nod++; live.nodText = `记下了：${c.dueText ? c.dueText + '，' : ''}给${c.to}${c.what}`
  changed()
  if (c.draftable) startDraft(c)
}

/** 你在微信里发出了和草稿相近的话 → 承诺自动划掉。 */
function checkFulfilled(conv, fresh) {
  const norm = s => s.replace(/[\s，,。.！!？?…]/g, '')
  for (const c of state.commitments.filter(c => c.conv === conv && ['ready', 'copied'].includes(c.status) && c.draft?.message)) {
    const head = norm(c.draft.message).slice(0, 10)
    if (head.length >= 6 && fresh.some(m => m.side === 'me' && norm(m.text).includes(head))) {
      c.status = 'done'; c.doneAt = hm()
      dropCard('c:' + c.id)
      insight({ src: `微信 · ${conv}`, text: `看到你发出了给${c.to}的消息，「${c.what}」划掉 ✓`, verdict: 'act', layer: '本机 OCR' })
    }
  }
}

/* ═════════════ 起草 → 开口 ═════════════ */

function startDraft(c) {
  c.status = 'drafting'; changed()
  insight({ src: '主 agent', text: `开始起草：给${c.to}的「${c.what}」`, verdict: 'act', layer: `L2 ${config.draftModel}` })
  const t0 = Date.now()
  draft(c, tool => { live.lastTool = describeTool(tool); changed() })
    .then(d => {
      c.draft = d; c.status = 'ready'; c.speakAt = speakAt(c).toISOString(); live.lastTool = ''
      insight({ src: '主 agent', text: `起草完成：${d.summary.slice(0, 120)}`, verdict: 'act', layer: `L2 ${config.draftModel}`, cost: `${Math.round((Date.now() - t0) / 1000)}s` })
      tick()
    })
    .catch(e => { c.status = 'open'; live.lastTool = ''; insight({ src: '主 agent', text: `起草失败：${e.message.split('\n')[0]}`, verdict: 'error' }) })
}

function describeTool(t) {
  let a = {}
  try { a = JSON.parse(t.arguments) } catch { /* 原样 */ }
  const p = a.file_path ?? a.path ?? a.pattern ?? a.command ?? ''
  return `${{ read: '在读', write: '在写', bash: '在查', grep: '在搜', glob: '在找' }[t.name] ?? t.name} ${String(p).replace(WS + '/', '').replace(process.env.HOME, '~').slice(0, 60)}`
}

/** 先做好，在对的时候开口：离截止 4 小时内马上说；否则截止当天早上说。 */
function speakAt(c) {
  const now = Date.now()
  if (!c.due) return new Date(now)
  const due = new Date(c.due)
  if (isNaN(due) || due - now < 4 * 3600_000) return new Date(now)
  const [h, m] = config.morningAt.split(':').map(Number)
  const morning = new Date(due); morning.setHours(h, m, 0, 0)
  return new Date(Math.max(now, Math.min(due - 3 * 3600_000, morning)))
}

function commitmentCard(c) {
  const d = c.draft ?? {}
  card({
    id: 'c:' + c.id, kind: 'commitment', commitmentId: c.id,
    title: d.missing && !d.message ? `你答应${c.to}的「${c.what}」，我还差点材料` : `你答应${c.to}的「${c.what}」，我起草好了`,
    why: `${c.dueText ? c.dueText + '要给；' : ''}你在和「${c.conv}」的微信里说：「${c.quote}」`,
    message: d.message, docs: d.docs, missing: d.missing, phase: c.status === 'copied' ? 'sent?' : 'ready',
  })
}

function tick() {
  const now = Date.now()
  for (const c of state.commitments) {
    if (c.status === 'ready' && !c.spoken && c.speakAt && new Date(c.speakAt) <= now && maySpeak()) {
      c.spoken = true; spoke(); commitmentCard(c)
      insight({ src: '桌宠', text: `开口：给${c.to}的「${c.what}」已备好`, verdict: 'speak' })
    }
  }
  if (hm() >= config.wrapUpAt && state.lastWrapUp !== ymd()) {
    state.lastWrapUp = ymd()
    if (todays().length) { wrapCard(); insight({ src: '桌宠', text: '开口：下班收尾', verdict: 'speak' }) }
  }
  changed()
}
setInterval(tick, 20_000)

const todays = () => state.commitments.filter(c => c.at.slice(0, 10) === ymd() || (c.due ?? '').slice(0, 10) === ymd())
function wrapCard() {
  const list = todays()
  card({
    id: 'wrap', kind: 'wrap', title: `今天你答应了 ${list.length} 件事`,
    items: list.map(c => ({ id: c.id, to: c.to, what: c.what, status: c.status, doneAt: c.doneAt, dueText: c.dueText })),
  })
}

/* ═════════════ 你的操作 ═════════════ */

const sh = (cmd, a, input) => new Promise(res => { const p = execFile(cmd, a, () => res()); if (input != null) { p.stdin.end(input) } })

async function onAction(a) {
  const c = a.commitmentId ? state.commitments.find(x => x.id === a.commitmentId) : null
  switch (a.type) {
    case 'eyes':
      live.eyes = !!a.on
      insight({ src: '你', text: a.on ? '睁眼' : '闭眼：什么都不看', verdict: a.on ? 'remember' : 'private' })
      break
    case 'open-card': if (c) commitmentCard(c); break
    case 'copy': {
      if (!c?.draft?.message) break
      await sh('pbcopy', [], c.draft.message)
      await sh('open', ['-b', 'com.tencent.xinWeChat'])
      if (c.draft.docs?.[0]) await sh('open', ['-R', join(WS, c.draft.docs[0])])
      c.status = 'copied'; commitmentCard(c)
      insight({ src: '你', text: `复制了给${c.to}的消息，打开微信${c.draft.docs?.[0] ? '，并在访达里选中了文档' : ''}`, verdict: 'act', layer: 'R3 对外发送 · 最后一下由你按' })
      break
    }
    case 'sent':
      if (!c) break
      c.status = 'done'; c.doneAt = hm(); dropCard('c:' + c.id)
      insight({ src: '你', text: `「${c.what}」已发给${c.to}，划掉 ✓`, verdict: 'act' })
      break
    case 'drop':
      if (!c) break
      c.status = 'dropped'; dropCard('c:' + c.id)
      insight({ src: '你', text: `不要「${c.what}」这份草稿`, verdict: 'learn', layer: '这类事你想自己来' })
      break
    case 'dismiss': dropCard(a.cardId); break
    case 'revise': {
      if (!c || !a.reason) break
      insight({ src: '你', text: `对「${c.what}」的意见：「${a.reason}」`, verdict: 'learn' })
      judgeRule({ reason: a.reason, context: `给${c.to}的${c.what}` }).then(r => {
        if (r.reusable) card({ id: 'learn:' + c.id, kind: 'learn', title: '要我记住这条吗？', rule: r.rule, scope: r.scope, reason: a.reason, from: `${hm()} · 给${c.to}的${c.what}` })
        insight({ src: '学习', text: r.reusable ? `可以沉淀成规则：${r.rule}` : '只是这一次的修改，不记规则', verdict: 'learn', layer: `L1 ${config.triageModel}` })
      }).catch(e => insight({ src: '学习', text: e.message, verdict: 'error' }))
      c.status = 'drafting'; dropCard('c:' + c.id)
      redraft(c, a.reason, tool => { live.lastTool = describeTool(tool); changed() }).then(d => {
        c.draft = d; c.status = 'ready'; live.lastTool = ''; commitmentCard(c)
        insight({ src: '主 agent', text: `按意见改好了：${d.summary.slice(0, 100)}`, verdict: 'act', layer: `L2 ${config.draftModel}` })
      }).catch(e => { c.status = 'ready'; insight({ src: '主 agent', text: `修改失败：${e.message.split('\n')[0]}`, verdict: 'error' }) })
      break
    }
    case 'learn': {
      const cd = state.cards.find(x => x.id === a.cardId)
      if (cd && a.accept) {
        state.rules.push({ id: uid('r'), text: cd.rule, scope: cd.scope, learnedFrom: `${cd.from}（你说「${cd.reason}」）`, at: `${ymd()} ${hm()}`, enabled: true })
        writeHandbook()
        insight({ src: '手册', text: `新规则：${cd.rule}`, verdict: 'learn', layer: '写入 AGENTS.md，下次起草自动加载' })
      }
      dropCard(a.cardId)
      break
    }
    case 'rule-off':
      state.rules = state.rules.filter(r => r.id !== a.id); writeHandbook()
      insight({ src: '你', text: '停用了一条规则', verdict: 'learn' })
      break
    case 'wrapup': wrapCard(); break
    case 'open-privacy': await sh('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture']); break
    case 'quit': shutdown(); return
  }
  changed()
}

/* ═════════════ 对桌宠的快照 ═════════════ */

function snapshot() {
  const wechat = /xinWeChat|WeChat/.test(live.focus.bundle)
  const privateApp = config.privateApps.includes(live.focus.bundle)
  const mode = !live.eyes || privateApp ? 'closed' : live.working ? 'work' : live.thinking ? 'think' : state.cards.length ? 'call' : wechat ? 'watch' : 'idle'
  return {
    mode, eyes: live.eyes, privateApp, wechat, focus: live.focus, screenAccess: live.screenAccess,
    seeing: Date.now() - live.lastObserveAt < 10_000,
    working: live.working, thinking: live.thinking, lastTool: live.lastTool ?? '', nod: live.nod, nodText: live.nodText,
    cards: state.cards, rules: state.rules.filter(r => r.enabled !== false), insight: state.insight.slice(-120),
    commitments: state.commitments.slice(-40), wrapUpAt: config.wrapUpAt, home: HOME,
  }
}

/* ═════════════ HTTP ═════════════ */

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' }
const body = req => new Promise(res => { let s = ''; req.on('data', d => s += d); req.on('end', () => { try { res(JSON.parse(s || '{}')) } catch { res({}) } }) })
const readable = p => { const f = resolve(p.startsWith('/') ? p : join(WS, p)); return [WS, ...config.materials].some(r => f.startsWith(r + '/')) ? f : null }

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = decodeURIComponent(url.pathname)
  try {
    if (req.method === 'POST' && p === '/observe') { onObserve(await body(req)); return res.end('ok') }
    if (req.method === 'POST' && p === '/focus') { const b = await body(req); live.focus = { bundle: b.bundle, name: b.name }; live.screenAccess = b.screenAccess !== false; changed(); return res.end('ok') }
    if (req.method === 'POST' && p === '/action') { await onAction(await body(req)); return res.end('ok') }
    if (p === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      const send = () => res.write(`data: ${JSON.stringify(snapshot())}\n\n`)
      send()
      const off = subscribe(send)
      const ka = setInterval(() => res.write(': ka\n\n'), 15000)
      req.on('close', () => { off(); clearInterval(ka) })
      return
    }
    if (p === '/file') {
      const f = readable(url.searchParams.get('path') ?? '')
      if (!f || !existsSync(f)) return res.writeHead(404).end('not found')
      return res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(readFileSync(f))
    }
    const file = p === '/lib/util.js' ? join(ROOT, 'desktop/src/util.js') : normalize(join(ROOT, p.endsWith('/') ? p + 'index.html' : p))
    if (!file.startsWith(join(ROOT, 'pet')) && !file.endsWith('desktop/src/util.js')) return res.writeHead(403).end()
    if (!existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end()
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(readFileSync(file))
  } catch (e) {
    console.error(e); res.writeHead(500).end(String(e.message))
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`拾遗 daemon → http://127.0.0.1:${PORT}/pet/   数据：${HOME}`)
  const app = join(ROOT, 'native/build/Shiyi.app')
  if (!args.includes('--no-pet')) {
    if (existsSync(app)) spawn('open', [app], { stdio: 'ignore' })
    else console.log('（还没构建桌宠：sh scripts/build-native.sh）')
  }
  tick()
})

async function shutdown() {
  console.log('拾遗 退出中…')
  save()
  execFile('pkill', ['-f', 'Shiyi.app/Contents/MacOS/Shiyi'])
  await shutdownAgents()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

export { readDraft, safe }
