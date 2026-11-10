#!/usr/bin/env node
// 拾遗 daemon：感知 → 筛选 → 记下 → 起草 → 在对的时候开口 → 从驳回里学习。
//   node daemon/main.mjs [--port 7801] [--no-pet]
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync, rmSync } from 'node:fs'
import { join, dirname, extname, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile, spawn } from 'node:child_process'
import { state, live, config, saveConfig, WS, HOME, subscribe, changed, save, insight, card, dropCard, maySpeak, spoke, hm, ymd, uid } from './store.mjs'
import { parseWeChat, diff, keyOf } from './wechat.mjs'
import { appendTranscript, judgeCommitment, judgeRule, draft, redraft, supply, writeHandbook, shutdownAgents, safe } from './agent.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const PORT = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 7801

/* ═════════════ 感知 → 筛选 ═════════════ */

const PROMISE = /(发你|发给你|给你|回你|回复你|告诉你|整理|跟进|看一下|看下|弄好|搞定|安排|确认|提交|准备|写好|发过去|约一下|拉个群|我来|我去|我负责|包在我)/
const PROMISE_EN = /\b(I'?ll|I will|will send|send (it|you|over)|get back to you|follow up|on it|let me (check|send|look))\b/i
const AFFIRM = /^(好|好的|好滴|好嘞|嗯嗯?|收到|没问题|可以|行|ok|okay|sure|got it|will do|noted|👌|👍|🫡)[\s!！。.~～,，]*(好的|收到|没问题|马上)?[\s!！。.~～]*$/i
const REQUEST = /(能不能|麻烦|帮我|帮忙|可以.{0,8}吗|记得|辛苦|发我|给我|\bcan you\b|\bcould you\b|\bplease\b|\bsend me\b)/i
const WHEN = /(明天|明早|今晚|今天|待会|等会|一会|回头|晚点|稍后|下午|上午|中午|晚上|周[一二三四五六日天]|下周|月底|马上|这就|之后|改天|tomorrow|tonight|later|monday|tuesday|wednesday|thursday|friday)/i
const QUESTION = /[?？吗呢]$/

const recent = {}   // conv → 最近 40 条（重启后从聊天记录文件恢复）
function loadRecent(conv) {
  const f = join(WS, 'chat', `微信-${safe(conv)}.jsonl`)
  if (!existsSync(f)) return []
  return readFileSync(f, 'utf8').trim().split('\n').slice(-40).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}
let observing = false

async function onObserve(obs) {
  live.lastObserveAt = Date.now()
  if (!live.eyes || observing) return
  observing = true
  try {
    const p = parseWeChat(obs, config.wechatListWidth)
    if (!p.conv) return
    if (live.currentConv !== p.conv) { live.currentConv = p.conv; changed() }
    if (config.ignoreConvs.some(c => p.conv.includes(c))) return
    const { first, fresh } = diff(state.seen, p.conv, p.messages)
    if (!fresh.length) { save(); return }
    state.seenCount += fresh.length
    const at = new Date().toISOString()
    const transcript = appendTranscript(p.conv, fresh.map(m => ({ ...m, at: first ? null : at })))
    const before = recent[p.conv] ?? loadRecent(p.conv)
    recent[p.conv] = [...before, ...fresh].slice(-40)
    if (first) {
      insight({ src: `微信 · ${p.conv}`, text: `第一次看到这个会话，之前的 ${fresh.length} 条消息只用来了解背景`, verdict: 'remember', layer: '本机 OCR' })
      return
    }
    checkFulfilled(p.conv, fresh)
    const ctx = [...before]
    const cands = [], asks = []
    for (const m of fresh) {
      // 你只回了「好的」：往前找对方最近 3 条里的请求
      const req = [...ctx].reverse().filter(x => x.side === 'other').slice(0, 3).find(x => REQUEST.test(x.text))
      if (m.side === 'me' && AFFIRM.test(m.text) && req) cands.push({ m, request: req.text })
      else if (m.side === 'me' && (PROMISE.test(m.text) || PROMISE_EN.test(m.text)) && !QUESTION.test(m.text)) cands.push({ m })
      else if (m.side === 'other' && REQUEST.test(m.text)) asks.push(m)
      ctx.push(m)
    }
    for (const m of asks) insight({ src: `微信 · ${p.conv}`, text: `对方：「${m.text}」→ 是个请求，先记着，看你怎么回`, verdict: 'remember', layer: 'L0 本机规则', cost: '0 token' })
    const rest = fresh.length - cands.length - asks.length
    if (rest > 0) insight({ src: `微信 · ${p.conv}`, text: `${rest} 条新消息，和你要兑现的事无关`, verdict: 'ignore', layer: 'L0 本机规则', cost: '0 token' })
    for (const c of cands) handleCandidate(p.conv, c.m, transcript, c.request).catch(e => insight({ src: '筛选', text: e.message, verdict: 'error' }))
  } finally { observing = false }
}

async function handleCandidate(conv, m, transcript, request) {
  const k = keyOf(m) + (request ? '|' + request : '')
  if (state.commitments.some(c => c.conv === conv && c.key === k)) return
  insight({
    src: `微信 · ${conv}`, verdict: 'suspect', layer: 'L0 本机规则', cost: '0 token',
    text: request ? `对方问「${request}」，你回「${m.text}」→ 可能答应了什么，再确认一下` : `你说「${m.text}」→ 像是答应了什么${WHEN.test(m.text) ? '，还带了时间' : ''}，再确认一下`,
  })
  const t0 = Date.now()
  const j = await judgeCommitment({ conv, recent: recent[conv] ?? [m], quote: m.text, request })
  const cost = `L1 ${config.triageModel} · ${((Date.now() - t0) / 1000).toFixed(1)}s`
  if (!j.commitment || (j.confidence ?? 0) < 0.6) {
    insight({ src: `微信 · ${conv}`, text: `不算承诺：${j.why ?? ''}`, verdict: 'ignore', layer: cost })
    return
  }
  const c = {
    id: uid('c'), key: k, conv, to: j.to || conv, what: j.what || m.text, todo: j.todo || '', quote: m.text, request: request || '',
    kind: ['reply', 'deliverable', 'action'].includes(j.kind) ? j.kind : 'reply',
    due: j.due || null, dueText: j.dueText || '', draftable: j.draftable !== false && j.kind !== 'action',
    at: new Date().toISOString(), status: 'open', transcript,
  }
  state.commitments.push(c)
  insight({ src: `微信 · ${conv}`, text: `记下了：${c.dueText ? c.dueText + ' · ' : ''}${c.todo || c.to + '·' + c.what}。${j.why ?? ''}`, verdict: 'remember', layer: cost })
  live.nod++; live.nodText = `记下了：${c.dueText}${c.todo || `给${c.to}${c.what}`}`
  changed()
  if (c.draftable) startDraft(c)
}

/** 复制过的承诺：你在这个会话里发出了和草稿相近的话 → 划掉；发了别的话 → 问一句「这条就是吗」。 */
function checkFulfilled(conv, fresh) {
  const norm = s => s.replace(/[\s，,。.！!？?…]/g, '')
  const mine = fresh.filter(m => m.side === 'me')
  if (!mine.length) return
  for (const c of state.commitments.filter(c => c.conv === conv && ['ready', 'copied'].includes(c.status) && c.draft?.message)) {
    const head = norm(c.draft.message).slice(0, 10)
    if (head.length >= 6 && mine.some(m => norm(m.text).includes(head))) {
      markDone(c, '看到你发出去了')
    } else if (c.status === 'copied' && !c.confirmQuote) {
      c.confirmQuote = mine[mine.length - 1].text
      commitmentCard(c)
    }
  }
}

function markDone(c, how) {
  c.status = 'done'; c.doneAt = hm(); c.confirmQuote = ''
  dropCard('c:' + c.id)
  insight({ src: `微信 · ${c.conv}`, text: `${how}：${c.todo || c.what} ✓`, verdict: 'done' })
}

/* ═════════════ 起草 → 开口 ═════════════ */

const onTool = tool => { live.lastTool = describeTool(tool); changed() }

function startDraft(c) {
  c.status = 'drafting'; changed()
  insight({ src: '起草', text: `开始起草：${c.todo || c.what}（${c.kind === 'deliverable' ? '要交文档，会翻你的材料目录' : '只写一段回复'}）`, verdict: 'draft', layer: `L2 ${config.draftModel}` })
  const t0 = Date.now()
  draft(c, onTool)
    .then(d => {
      c.draft = d; c.status = 'ready'; c.speakAt = speakAt(c).toISOString(); live.lastTool = ''
      insight({ src: '起草', text: d.missing && !d.message ? `还差一点信息，等你补：${firstLine(d.missing)}` : `草稿好了：${d.summary.slice(0, 120)}`, verdict: 'draft', layer: `L2 ${config.draftModel}`, cost: `${Math.round((Date.now() - t0) / 1000)}s` })
      tick()
    })
    .catch(e => { c.status = 'open'; live.lastTool = ''; insight({ src: '起草', text: `起草失败：${e.message.split('\n')[0]}`, verdict: 'error' }) })
}

const firstLine = t => t.split('\n').map(l => l.replace(/^[#\-\d.\s]+/, '').trim()).find(l => l && !/[：:]$/.test(l))?.slice(0, 60) ?? ''

function describeTool(t) {
  let a = {}
  try { a = JSON.parse(t.arguments) } catch { /* 原样 */ }
  const p = a.file_path ?? a.path ?? a.pattern ?? a.command ?? ''
  return `${{ read: '在读', write: '在写', bash: '在查', grep: '在搜', glob: '在找' }[t.name] ?? t.name} ${String(p).replace(WS + '/', '').replace(process.env.HOME, '~').slice(0, 60)}`
}

/** 什么时候开口：截止当天、不早于早上的时间；最迟截止前 1 小时；离截止不到 1 小时或没说时间就马上。 */
function speakAt(c) {
  const now = Date.now()
  if (!c.due) return new Date(now)
  const due = new Date(c.due)
  if (isNaN(due)) return new Date(now)
  const [h, m] = config.morningAt.split(':').map(Number)
  const morning = new Date(due); morning.setHours(h, m, 0, 0)
  const t = Math.min(Math.max(now, morning.getTime()), due.getTime() - 3600_000)
  return new Date(Math.max(now, t))
}

function commitmentCard(c) {
  const d = c.draft ?? {}
  const waiting = d.missing && !d.message
  const said = c.request ? `${c.conv}问「${c.request}」，你回「${c.quote}」` : `你在和${c.conv}聊天时说「${c.quote}」`
  card({
    id: 'c:' + c.id, kind: 'commitment', commitmentId: c.id, conv: c.conv,
    phase: c.confirmQuote ? 'confirm' : c.status === 'copied' ? 'copied' : waiting ? 'missing' : 'ready',
    title: c.confirmQuote ? `你在和${c.conv}的聊天里发了一条消息，这就是「${c.what}」吗？`
      : waiting ? `你答应${c.to}的「${c.what}」，还差一点信息` : `你答应${c.to}的「${c.what}」，我起草好了`,
    why: `${c.dueText ? c.dueText + '要交。' : ''}${said}`,
    message: d.message, docs: d.docs, missing: d.missing, confirmQuote: c.confirmQuote,
  })
}

function tick() {
  const now = Date.now()
  for (const c of state.commitments) {
    if (c.status === 'ready' && !c.spoken && c.speakAt && new Date(c.speakAt) <= now && maySpeak()) {
      c.spoken = true; spoke(); commitmentCard(c)
      insight({ src: '桌宠', text: `开口：${c.todo || c.what}${c.draft?.message ? '，草稿好了' : '，还差一点信息'}`, verdict: 'speak' })
    }
  }
  if (hm() >= config.wrapUpAt && state.lastWrapUp !== ymd()) {
    state.lastWrapUp = ymd()
    if (todays().length) { wrapCard(); insight({ src: '桌宠', text: '开口：下班收尾', verdict: 'speak' }) }
  }
  changed()
}
setInterval(tick, 20_000)

const todays = () => state.commitments.filter(c => c.status !== 'dropped' && (c.at.slice(0, 10) === ymd() || (c.due ?? '').slice(0, 10) === ymd()))
function wrapCard() {
  const list = todays()
  card({
    id: 'wrap', kind: 'wrap', title: `今天你答应了 ${list.length} 件事`,
    items: list.map(c => ({ id: c.id, to: c.to, what: c.what, todo: c.todo, status: c.status, doneAt: c.doneAt, dueText: c.dueText })),
  })
}

/* ═════════════ 你的操作 ═════════════ */

// SHIYI_DRY=1：测试时不真的改剪贴板、不打开微信和访达
const sh = (cmd, a, input) => process.env.SHIYI_DRY
  ? (console.log('[dry]', cmd, ...a), Promise.resolve())
  : new Promise(res => { const p = execFile(cmd, a, () => res()); if (input != null) p.stdin.end(input) })

function follow(c, job, what) {
  c.status = 'drafting'; dropCard('c:' + c.id)
  job(c).then(d => {
    c.draft = d; c.status = 'ready'; live.lastTool = ''; commitmentCard(c)
    insight({ src: '起草', text: `${what}：${d.summary.slice(0, 100)}`, verdict: 'draft', layer: `L2 ${config.draftModel}` })
  }).catch(e => { c.status = 'ready'; live.lastTool = ''; commitmentCard(c); insight({ src: '起草', text: `失败：${e.message.split('\n')[0]}`, verdict: 'error' }) })
}

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
      c.status = 'copied'; c.confirmQuote = ''; commitmentCard(c)
      insight({ src: '你', text: `复制了给${c.to}的消息，打开了微信${c.draft.docs?.[0] ? '，文档在访达里选中了' : ''}`, verdict: 'done', layer: '对外发送：最后一下由你按' })
      break
    }
    case 'sent':
      if (c) markDone(c, '你确认发出去了')
      break
    case 'not-it':
      if (c) { c.confirmQuote = ''; commitmentCard(c) }
      break
    case 'drop':
      if (!c) break
      c.status = 'dropped'; dropCard('c:' + c.id)
      insight({ src: '你', text: `「${c.what}」不用拾遗来做`, verdict: 'learn', layer: '记一笔：这类事你想自己来' })
      break
    case 'dismiss': dropCard(a.cardId); break
    case 'supply':
      if (!c || !a.info) break
      insight({ src: '你', text: `补上信息：「${a.info}」`, verdict: 'remember' })
      follow(c, x => supply(x, a.info, onTool), '补好了')
      break
    case 'revise':
      if (!c || !a.reason) break
      insight({ src: '你', text: `对「${c.what}」的意见：「${a.reason}」`, verdict: 'learn' })
      judgeRule({ reason: a.reason, context: `给${c.to}的${c.what}` }).then(r => {
        if (r.reusable) card({ id: 'learn:' + c.id, kind: 'learn', title: '要我记住这条吗？', rule: r.rule, scope: r.scope, reason: a.reason, from: `${hm()} · 给${c.to}的${c.what}` })
        insight({ src: '学习', text: r.reusable ? `可以变成一条规则：${r.rule}` : '只是这一次的修改，不记成规则', verdict: 'learn', layer: `L1 ${config.triageModel}` })
      }).catch(e => insight({ src: '学习', text: e.message, verdict: 'error' }))
      follow(c, x => redraft(x, a.reason, onTool), '按你的意见改好了')
      break
    case 'learn': {
      const cd = state.cards.find(x => x.id === a.cardId)
      if (cd && a.accept) {
        state.rules.push({ id: uid('r'), text: cd.rule, scope: cd.scope, learnedFrom: `${cd.from}（你说「${cd.reason}」）`, at: `${ymd()} ${hm()}`, enabled: true })
        writeHandbook()
        insight({ src: '我的工作方式', text: `新规则：${cd.rule}${cd.scope ? `（适用：${cd.scope}）` : ''}`, verdict: 'learn', layer: '写入 AGENTS.md，下次起草自动遵守' })
      }
      dropCard(a.cardId)
      break
    }
    case 'rule-off':
      state.rules = state.rules.filter(r => r.id !== a.id); writeHandbook()
      insight({ src: '你', text: '停用了一条规则', verdict: 'learn' })
      break
    case 'ignore-conv': {
      const conv = a.conv || live.currentConv
      if (!conv || config.ignoreConvs.includes(conv)) break
      saveConfig({ ignoreConvs: [...config.ignoreConvs, conv] })
      delete state.seen[conv]; delete recent[conv]
      rmSync(join(WS, 'chat', `微信-${safe(conv)}.jsonl`), { force: true })
      insight({ src: '你', text: `以后不看「${conv}」，已存下的聊天记录删掉了`, verdict: 'private' })
      break
    }
    case 'unignore-conv':
      saveConfig({ ignoreConvs: config.ignoreConvs.filter(x => x !== a.conv) })
      insight({ src: '你', text: `恢复看「${a.conv}」`, verdict: 'remember' })
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
    seeing: Date.now() - live.lastObserveAt < 10_000, currentConv: live.currentConv, ignoreConvs: config.ignoreConvs,
    working: live.working, thinking: live.thinking, lastTool: live.lastTool ?? '', nod: live.nod, nodText: live.nodText,
    cards: state.cards, rules: state.rules.filter(r => r.enabled !== false), insight: state.insight.slice(-120), seenCount: state.seenCount,
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
  // 上次退出时还在起草的，接着起草
  for (const c of state.commitments.filter(c => c.status === 'drafting')) { c.status = 'open'; if (c.draftable) startDraft(c) }
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
