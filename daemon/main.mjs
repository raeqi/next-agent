#!/usr/bin/env node
// 拾遗 daemon：感知 → 筛选 → 记下 → 起草 → 在对的时候开口 → 从驳回里学习。
//   node daemon/main.mjs [--port 7801] [--no-pet]
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync, rmSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname, extname, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile, spawn } from 'node:child_process'
import { state, live, config, saveConfig, APPS, findApp, appName, watching, paused, rawMaterials, WS, HOME, subscribe, changed, save, insight, card, dropCard, maySpeak, spoke, hm, ymd, uid } from './store.mjs'
import { opportunityMode } from '../pet/action-policy.mjs'
import { inspect, digest, executePlan } from './actions.mjs'
import { appInfo, NEVER, ocrText, fingerprint } from './perceive.mjs'
import { parseChat, parseBubble, diff, keyOf } from './layout.mjs'
import { appendTranscript, transcriptName, judgeCommitment, judgeRule, parseTask, draft, redraft, supply, writeHandbook, shutdownAgents, safe, judgeOpportunity, reviewContext, planAction, executeTask } from './agent.mjs'

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
function loadRecent(app, conv) {
  const f = join(WS, 'chat', transcriptName(app, conv))
  if (!existsSync(f)) return []
  return readFileSync(f, 'utf8').trim().split('\n').slice(-40).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}
let observing = false

let lastObs = null   // 调试：最近一次 OCR 原始结果（只在内存里，GET /debug/last 查看）
async function onObserve(obs) {
  if (NEVER.has(obs.bundle) || !live.eyes || paused() || config.apps[obs.bundle] !== 'on') return
  live.lastObserveAt = Date.now()
  lastObs = obs
  // 白名单是最后一道关：原生端本来也只截白名单里的应用
  if (!live.eyes || paused() || config.apps[obs.bundle] !== 'on' || observing) return
  observing = true
  try {
    const app = findApp(obs.bundle, obs.app)
    await observePage(obs)
    if (!app) return
    const p = parseChat(obs, app, config)
    if (!p.conv) return
    // 会话身份：微信沿用会话名（兼容旧记录），其他应用加上应用名，避免同名会话串台
    const id = app.name === '微信' ? p.conv : `${app.name}·${p.conv}`
    const where = { app: app.name, bundle: obs.bundle, conv: p.conv, id }
    if (live.currentConv !== p.conv) { live.currentConv = p.conv; changed() }
    if (config.ignoreConvs.some(c => p.conv.includes(c))) return
    const { first, fresh } = diff(state.seen, id, p.messages)
    if (!fresh.length) { save(); return }
    state.seenCount += fresh.length
    const at = new Date().toISOString()
    const transcript = appendTranscript(app.name, p.conv, fresh.map(m => ({ ...m, at: first ? null : at })))
    where.transcript = transcript
    const before = recent[id] ?? loadRecent(app.name, p.conv)
    recent[id] = [...before, ...fresh].slice(-40)
    if (first) {
      insight({ src: `${app.name} · ${p.conv}`, text: `第一次看到这个会话，之前的 ${fresh.length} 条消息只用来了解背景`, verdict: 'remember', layer: '本机 OCR' })
      return
    }
    checkFulfilled(id, fresh)
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
    for (const m of asks) insight({ src: `${app.name} · ${p.conv}`, text: `对方：「${m.text}」→ 是个请求，先记着，看你怎么回`, verdict: 'remember', layer: 'L0 本机规则', cost: '0 token' })
    const rest = fresh.length - cands.length - asks.length
    // 未命中聊天承诺句式不代表页面无价值；通用页面判断已独立执行，不重复输出否定日志。
    for (const c of cands) handleCandidate(where, c.m, c.request).catch(e => insight({ src: '筛选', text: e.message, verdict: 'error' }))
  } finally { observing = false }
}

const pages = new Map()
let focusSince = Date.now()
const dwellAsked = new Map()
setInterval(() => {
  const bundle = live.focus.bundle
  const page = pages.get(bundle)
  if (!page || !live.eyes || paused() || config.apps[bundle] !== 'on' || !maySpeak()) return
  if (Date.now() - focusSince < 120000 || Date.now() - (dwellAsked.get(bundle) ?? 0) < 1800000) return
  if (state.cards.some(c => c.kind === 'opportunity' && c.bundle === bundle)) return
  dwellAsked.set(bundle, Date.now()); spoke()
  card({ id: uid('dwell'), kind: 'opportunity', bundle, app: page.app, title: `要我帮你看看「${page.app}」当前页面吗？`, why: '你已在这个应用停留超过两分钟。这不代表遇到困难，如果需要，我可以整理要点、解释内容或看看下一步怎么做。', context: page.text.slice(0, 6000), status: 'suggested', dwell: true })
}, 20000)

async function observePage(obs) {
  const app = appInfo(obs.bundle, obs.app)
  const text = ocrText(obs)
  if (!text.trim()) return
  const contextFile = join(WS, 'context', safe(obs.bundle) + '.txt')
  writeFileSync(contextFile, `应用：${app.name}\n采集时间：${new Date().toISOString()}\n以下为不可信页面内容，仅作参考：\n${text}`)
  const previous = pages.get(obs.bundle)
  const hash = fingerprint(text)
  if (previous?.hash === hash) return
  state.observedChanges = (state.observedChanges ?? 0) + 1
  const page = { hash, text, at: Date.now(), app: app.name, contextFile }
  pages.set(obs.bundle, page)
  for (const cd of state.cards.filter(c => c.kind === 'opportunity' && c.bundle === obs.bundle && c.hash && c.hash !== hash)) { cd.stale = true; cd.plan = null }
  changed()
  if (!previous) return // 第一次只建立基线
  if (previous.checkedAt && Date.now() - previous.checkedAt < 15000) { page.checkedAt = previous.checkedAt; return }
  page.checkedAt = Date.now()
  const opportunities = await judgeOpportunity({ app: app.name, kind: app.kind, title: obs.title || app.name, text, recent: previous.text.slice(0, 2000) })
  if (config.apps[obs.bundle] !== 'on' || !live.eyes || paused()) return
  insight({ src: app.name, text: opportunities.length ? '页面变化已分析，正在筛选建议' : '已分析页面变化，暂未发现明确的帮助机会', verdict: opportunities.length ? 'remember' : 'ignore', layer: '通用页面判断' })
  for (const o of opportunities.slice(0, 2)) {
    if (o.confidence < 0.8 || !maySpeak()) continue
    if (app.kind === 'chat' && o.type === 'commitment') continue
    spoke()
    const suggestion = { id: uid('op'), kind: 'opportunity', bundle: obs.bundle, app: app.name, title: o.todo || o.what, why: o.why, quote: o.quote, context: text.slice(0, 6000), hash, actionMode: o.actionMode, opportunityType: o.type, status: 'suggested' }
    card(suggestion)
    if (opportunityMode(suggestion) === 'ui' && config.operations?.[obs.bundle] === 'auto' && config.autoTargets?.[obs.bundle]?.length) {
      try {
        const page = await inspect(obs.bundle)
        const plan = await planAction({ goal: suggestion.title, page })
        if (plan.step) { suggestion.plan = { ...plan, snapshot: digest(page) }; await executePlan(suggestion, true) }
      } catch (e) { suggestion.executionMessage = e.message; changed() }
    }
  }
}

async function handleCandidate(where, m, request) {
  const { app, conv, id, transcript } = where
  const k = keyOf(m) + (request ? '|' + request : '')
  if (state.commitments.some(c => (c.convId ?? c.conv) === id && c.key === k)) return
  insight({
    src: `${app} · ${conv}`, verdict: 'suspect', layer: 'L0 本机规则', cost: '0 token',
    text: request ? `对方问「${request}」，你回「${m.text}」→ 可能答应了什么，再确认一下` : `你说「${m.text}」→ 像是答应了什么${WHEN.test(m.text) ? '，还带了时间' : ''}，再确认一下`,
  })
  const t0 = Date.now()
  const j = await judgeCommitment({ app, conv, recent: recent[id] ?? [m], quote: m.text, request })
  const cost = `L1 ${config.triageModel} · ${((Date.now() - t0) / 1000).toFixed(1)}s`
  if (!j.commitment || (j.confidence ?? 0) < 0.6) {
    insight({ src: `${app} · ${conv}`, text: `不算承诺：${j.why ?? ''}`, verdict: 'ignore', layer: cost })
    return
  }
  const c = {
    id: uid('c'), source: 'chat', app, bundle: where.bundle, convId: id, key: k, conv, to: j.to || conv, what: j.what || m.text, todo: j.todo || '', quote: m.text, request: request || '',
    kind: ['reply', 'deliverable', 'action'].includes(j.kind) ? j.kind : 'reply',
    due: j.due || null, dueText: j.dueText || '', draftable: j.draftable !== false && j.kind !== 'action',
    at: new Date().toISOString(), status: 'open', transcript,
  }
  state.commitments.push(c)
  insight({ src: `${app} · ${conv}`, text: `记下了：${c.dueText ? c.dueText + ' · ' : ''}${c.todo || c.to + '·' + c.what}。${j.why ?? ''}`, verdict: 'remember', layer: cost })
  live.nod++; live.nodText = `记下了：${c.dueText}${c.todo || `给${c.to}${c.what}`}`
  changed()
  if (c.draftable) startDraft(c)
}

/** 复制过的承诺：你在这个会话里发出了和草稿相近的话 → 划掉；发了别的话 → 问一句「这条就是吗」。 */
function checkFulfilled(convId, fresh) {
  const norm = s => s.replace(/[\s，,。.！!？?…]/g, '')
  const mine = fresh.filter(m => m.side === 'me')
  if (!mine.length) return
  for (const c of state.commitments.filter(c => (c.convId ?? c.conv) === convId && ['ready', 'copied'].includes(c.status) && c.draft?.message)) {
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
  insight({ src: c.source === 'manual' ? '你交办的' : `${c.app || '来源应用'} · ${c.conv}`, text: `${how}：${c.todo || c.what} ✓`, verdict: 'done' })
}

/* ═════════════ 起草 → 开口 ═════════════ */

const onTool = tool => { live.lastTool = describeTool(tool); changed() }

function startTask(c) {
  if (c.status === 'running') return
  c.status = 'running'; c.progress = '正在读取任务与制定计划'; c.error = ''; changed()
  executeTask(c, tool => { c.progress = describeTool(tool); changed() }).then(result => {
    c.status = result.status; c.progress = result.summary; c.verification = result.verification; c.resultFiles = result.files
    card({ id: 'task:' + c.id, kind: 'task-result', commitmentId: c.id, title: c.what, status: c.status, message: c.progress, files: c.resultFiles, verification: c.verification })
    changed()
  }).catch(e => { c.status = 'failed'; c.error = e.message; c.progress = e.message; changed() })
}

function startDraft(c) {
  c.status = 'drafting'; changed()
  insight({ src: '起草', text: `开始起草：${c.todo || c.what}（${c.source === 'manual' ? '处理交办任务' : c.kind === 'deliverable' ? '准备交付物' : '准备回复'}）`, verdict: 'draft', layer: `L2 ${config.draftModel}` })
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
  if (c.source === 'manual' && c.progress) {
    card({ id: 'task:' + c.id, kind: 'task-result', commitmentId: c.id, title: c.what, status: c.status, message: c.progress, files: c.resultFiles || [], verification: c.verification }); dropCard('c:' + c.id); return
  }
  const d = c.draft ?? {}
  const waiting = d.missing && !d.message
  const place = c.app && c.app !== '微信' ? `${c.app} 的${c.conv}` : c.conv
  const said = c.source === 'manual' ? `你交给我的：「${c.quote}」` : c.request ? `${place}里问「${c.request}」，你回「${c.quote}」` : `你在和${place}聊天时说「${c.quote}」`
  const whose = c.source === 'manual' ? '你交给我的' : `你答应${c.to}的`
  card({
    id: 'c:' + c.id, kind: 'commitment', source: c.source, commitmentId: c.id, conv: c.conv, app: c.app || (c.source === 'manual' ? '' : '微信'),
    phase: c.confirmQuote ? 'confirm' : c.status === 'copied' ? 'copied' : waiting ? 'missing' : 'ready',
    title: c.confirmQuote ? `你在和${place}的聊天里发了一条消息，这就是「${c.what}」吗？`
      : waiting ? `${whose}「${c.what}」，还差一点信息` : `${whose}「${c.what}」，我起草好了`,
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
    id: 'wrap', kind: 'wrap', title: `今天在帮你盯的 ${list.length} 件事`,
    items: list.map(c => ({ id: c.id, to: c.to, what: c.what, todo: c.todo, status: c.status, doneAt: c.doneAt, dueText: c.dueText })),
  })
}

/* ═════════════ 白名单：第一次打开支持的应用时问一次 ═════════════ */

const askedLater = new Set()   // 本次运行里你点了「先不说」的应用
const seenBundles = {}   // 应用名 → 你实际打开时的 bundle id（registry 里没列到的版本也能进白名单）
const bundlesOf = name => [...new Set([...(APPS.find(a => a.name === name)?.bundles ?? []), ...(seenBundles[name] ?? []), ...Object.keys(config.discoveredApps ?? {}).filter(b => config.discoveredApps[b] === name), ...Object.keys(config.apps).filter(b => findApp(b)?.name === name || config.appNames?.[b] === name)])]
function setApp(name, value) {
  const apps = { ...config.apps }, appNames = { ...(config.appNames ?? {}) }
  for (const b of bundlesOf(name)) { if (value) { apps[b] = value; appNames[b] = name } else { delete apps[b]; delete appNames[b] } }
  saveConfig({ apps, appNames })
}
function maybeAskConsent(bundle, focusName) {
  if (!bundle || NEVER.has(bundle)) return
  const app = appInfo(bundle, focusName)
  ;(seenBundles[app.name] ??= new Set()).add(bundle)
  if (config.discoveredApps?.[bundle] !== app.name) saveConfig({ discoveredApps: { ...(config.discoveredApps ?? {}), [bundle]: app.name } })
  if (config.apps[bundle]) return
  // 同一个应用的另一个版本你已经决定过（比如国际版 / 国内版）：沿用决定，不再问
  const decided = bundlesOf(app.name).map(b => config.apps[b]).find(Boolean)
  if (decided) { setApp(app.name, decided); return }
  if (askedLater.has(app.name) || state.cards.some(c => c.id === 'consent:' + app.name)) return
  card({ id: 'consent:' + app.name, kind: 'consent', app: app.name, family: app.family, needName: app.family === 'named' && !config.myNames.length, title: `要我看「${app.name}」吗？` })
  insight({ src: '桌宠', text: `第一次看到你打开${app.name}，问你要不要看`, verdict: 'speak' })
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
    case 'operation-permission': {
      const bundle = Object.keys(config.appNames ?? {}).find(b => config.appNames[b] === a.app)
      if (!bundle || !['off', 'ask', 'auto'].includes(a.value)) break
      const operations = { ...(config.operations ?? {}), [bundle]: a.value }
      const autoTargets = { ...(config.autoTargets ?? {}), [bundle]: String(a.targets ?? '').split('、').map(s => s.trim()).filter(Boolean) }
      saveConfig({ operations, autoTargets }); break
    }
    case 'refresh-opportunity': {
      const cd = state.cards.find(x => x.id === a.cardId && x.kind === 'opportunity')
      const page = cd && pages.get(cd.bundle)
      if (!page || config.apps[cd.bundle] !== 'on' || !live.eyes || paused()) throw new Error('请先打开并允许观察来源应用')
      const found = await judgeOpportunity({ app: cd.app, kind: appInfo(cd.bundle).kind, title: cd.app, text: page.text })
      dropCard(cd.id)
      for (const o of found.filter(o => o.confidence >= 0.8).slice(0, 2)) card({ id: uid('op'), kind: 'opportunity', bundle: cd.bundle, app: cd.app, title: o.todo || o.what, why: o.why, quote: o.quote, context: page.text, hash: page.hash, actionMode: o.actionMode, opportunityType: o.type, status: 'suggested' })
      break
    }
    case 'delegate-opportunity': {
      const cd = state.cards.find(x => x.id === a.cardId && x.kind === 'opportunity')
      if (!cd || cd.stale || cd.status === 'delegated' || opportunityMode(cd) !== 'task') throw new Error('建议已变化或不适合后台执行，请重新检查')
      if (config.apps[cd.bundle] !== 'on' || !live.eyes || paused()) throw new Error('观察权限已撤销或暂停')
      const path = join(WS, 'context', cd.id + '.txt'); writeFileSync(path, cd.context)
      const t = { id: uid('c'), source: 'manual', what: cd.title, todo: cd.title, quote: cd.title, contextFiles: [path], at: new Date().toISOString(), status: 'queued' }
      state.commitments.push(t); cd.status = 'delegated'; cd.commitmentId = t.id; changed(); startTask(t); break
    }
    case 'plan-page': {
      const cd = state.cards.find(x => x.id === a.cardId && x.kind === 'opportunity')
      if (!cd || cd.stale || opportunityMode(cd) !== 'ui' || config.apps[cd.bundle] !== 'on') throw new Error('请先重新检查建议或确认操作类型')
      const page = await inspect(cd.bundle)
      const plan = await planAction({ goal: cd.title, page })
      if (!plan.step) { cd.executionMessage = plan.why; break }
      cd.plan = { ...plan, snapshot: digest(page) }; cd.execution = 'planned'; changed()
      if (config.operations?.[cd.bundle] === 'auto') await executePlan(cd, true)
      break
    }
    case 'execute-page': {
      const cd = state.cards.find(x => x.id === a.cardId && x.kind === 'opportunity')
      if (cd && !cd.stale) await executePlan(cd)
      break
    }
    case 'review-page': {
      const cd = state.cards.find(x => x.id === a.cardId && x.kind === 'opportunity')
      if (!cd || cd.stale || opportunityMode(cd) !== 'analysis' || cd.status === 'working' || config.apps[cd.bundle] !== 'on' || !live.eyes || paused()) break
      cd.status = 'working'; cd.startedAt = Date.now(); cd.error = ''; cd.progress = '等待模型执行，最长三分钟'; changed()
      const dir = join(WS, 'context'); mkdirSync(dir, { recursive: true })
      const path = join(dir, cd.id + '.txt'); writeFileSync(path, cd.context)
      try {
        const result = await reviewContext({ id: cd.id, app: cd.app, kind: appInfo(cd.bundle).kind, title: cd.title, contextFile: path }, tool => { cd.progress = describeTool(tool); onTool(tool) })
        cd.result = result.text || result.summary; cd.status = 'ready'
      } catch (e) { cd.status = 'failed'; cd.error = e.message }
      break
    }
    case 'eyes':
      live.eyes = !!a.on
      insight({ src: '你', text: a.on ? '睁眼' : '闭眼：什么都不看', verdict: a.on ? 'remember' : 'private' })
      break
    case 'open-card': if (c) commitmentCard(c); break
    case 'copy': {
      if (!c?.draft?.message) break
      await sh('pbcopy', [], c.draft.message)
      if (c.bundle && config.apps[c.bundle] === 'on') await sh('open', ['-b', c.bundle])
      if (c.draft.docs?.[0]) await sh('open', ['-R', join(WS, c.draft.docs[0])])
      c.status = 'copied'; c.confirmQuote = ''; commitmentCard(c)
      insight({ src: '你', text: `复制了给${c.to}的消息${c.source !== 'manual' ? `，打开了${c.app || '来源应用'}` : ''}${c.draft.docs?.[0] ? '，文档在访达里选中了' : ''}`, verdict: 'done', layer: '对外发送：最后一下由你按' })
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
    case 'rule-toggle': {
      const r = state.rules.find(r => r.id === a.id); if (!r) break
      r.enabled = !!a.enabled; writeHandbook()
      insight({ src: '我的工作方式', text: `${r.enabled ? '重新启用' : '停用'}：${r.text}`, verdict: 'learn' })
      break
    }
    case 'rule-edit': {
      const r = state.rules.find(r => r.id === a.id); if (!r || !a.text?.trim()) break
      r.text = a.text.trim(); r.scope = (a.scope ?? '').trim(); r.editedAt = `${ymd()} ${hm()}`; writeHandbook()
      insight({ src: '我的工作方式', text: `你改了一条规则：${r.text}${r.scope ? `（适用：${r.scope}）` : ''}`, verdict: 'learn' })
      break
    }
    case 'rule-add': {
      if (!a.text?.trim()) break
      state.rules.push({ id: uid('r'), text: a.text.trim(), scope: (a.scope ?? '').trim(), learnedFrom: '你手动加的', at: `${ymd()} ${hm()}`, enabled: true })
      writeHandbook()
      insight({ src: '我的工作方式', text: `你加了一条规则：${a.text.trim()}`, verdict: 'learn' })
      break
    }
    case 'rule-delete':
      state.rules = state.rules.filter(r => r.id !== a.id); writeHandbook()
      insight({ src: '我的工作方式', text: '删掉了一条规则', verdict: 'learn' })
      break
    case 'add-task': {
      const text = (a.text ?? '').trim(); if (!text) break
      insight({ src: '你', text: `交给拾遗一件事：「${text}」`, verdict: 'remember' })
      const t = { id: uid('c'), source: 'manual', what: text, todo: text, quote: text, at: new Date().toISOString(), status: 'queued', contextFiles: [...pages.entries()].filter(([b]) => config.apps[b] === 'on').map(([, p]) => p.contextFile) }
      state.commitments.push(t); changed(); startTask(t)

      break
    }
    case 'task-retry':
      if (c && c.source === 'manual' && c.status !== 'running') { c.supplement = String(a.info || ''); startTask(c) }
      break
    case 'task-done':
      if (c) markDone(c, '你标记完成了')
      break
    case 'ignore-conv': {
      const conv = a.conv || live.currentConv
      if (!conv || config.ignoreConvs.includes(conv)) break
      saveConfig({ ignoreConvs: [...config.ignoreConvs, conv] })
      delete state.seen[conv]; delete recent[conv]
      for (const f of readdirSync(join(WS, 'chat'))) if (f.endsWith(`-${safe(conv)}.jsonl`)) rmSync(join(WS, 'chat', f), { force: true })
      for (const k of Object.keys(state.seen)) if (k === conv || k.endsWith('·' + conv)) delete state.seen[k]
      insight({ src: '你', text: `以后不看「${conv}」，已存下的聊天记录删掉了`, verdict: 'private' })
      break
    }
    case 'unignore-conv':
      saveConfig({ ignoreConvs: config.ignoreConvs.filter(x => x !== a.conv) })
      insight({ src: '你', text: `恢复看「${a.conv}」`, verdict: 'remember' })
      break
    case 'app-consent': {
      dropCard('consent:' + a.app)
      if (a.choice === 'later') { askedLater.add(a.app); break }
      if (a.myName?.trim()) saveConfig({ myNames: [...new Set([...config.myNames, a.myName.trim()])] })
      setApp(a.app, a.choice === 'on' ? 'on' : 'off')
      insight({ src: '你', text: a.choice === 'on' ? `同意拾遗看${a.app}` : `不让拾遗看${a.app}，以后不再问`, verdict: a.choice === 'on' ? 'remember' : 'private' })
      break
    }
    case 'app-set':
      setApp(a.app, a.value || null)
      insight({ src: '设置', text: a.value === 'on' ? `开始看${a.app}` : a.value === 'off' ? `不再看${a.app}` : `${a.app}：下次打开时再问你`, verdict: a.value === 'on' ? 'remember' : 'private' })
      break
    case 'settings': {
      const p = a.patch ?? {}, patch = {}
      if (p.captureIntervalSec != null) patch.captureIntervalSec = Math.min(10, Math.max(1, Number(p.captureIntervalSec) || 2.5))
      for (const k of ['morningAt', 'wrapUpAt']) if (/^\d{2}:\d{2}$/.test(p[k] ?? '')) patch[k] = p[k]
      if (p.speakBudgetPerHour != null) patch.speakBudgetPerHour = Math.min(30, Math.max(1, Math.round(Number(p.speakBudgetPerHour) || 6)))
      if (Array.isArray(p.materials)) patch.materials = p.materials.map(x => String(x).trim()).filter(Boolean)
      if (Array.isArray(p.myNames)) patch.myNames = p.myNames.map(x => String(x).trim()).filter(Boolean)
      saveConfig(patch)
      insight({ src: '设置', text: `改了：${Object.keys(patch).map(k => ({ captureIntervalSec: '截图间隔', morningAt: '早上开口时间', wrapUpAt: '下班收尾时间', speakBudgetPerHour: '每小时最多开口', materials: '材料文件夹', myNames: '你的名字' })[k]).join('、')}`, verdict: 'remember' })
      break
    }
    case 'pause': {
      let until = ''
      if (a.minutes) until = new Date(Date.now() + a.minutes * 60_000).toISOString()
      if (a.until === 'morning') { const [h, m] = config.morningAt.split(':').map(Number); const d = new Date(); d.setDate(d.getDate() + (d.getHours() * 60 + d.getMinutes() >= h * 60 + m ? 1 : 0)); d.setHours(h, m, 0, 0); until = d.toISOString() }
      saveConfig({ pauseUntil: until })
      insight({ src: '你', text: until ? `暂停到 ${new Date(until).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '取消暂停', verdict: until ? 'private' : 'remember' })
      break
    }
    case 'clear-transcripts': {
      const dir = join(WS, 'chat')
      for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true })
      state.seen = {}; for (const k of Object.keys(recent)) delete recent[k]
      insight({ src: '设置', text: '清空了拾遗存下的所有聊天记录', verdict: 'private' })
      break
    }
    case 'open-data': await sh('open', [HOME]); break
    case 'wrapup': wrapCard(); break
    case 'open-privacy': await sh('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture']); break
    case 'quit': shutdown(); return
  }
  changed()
}

/* ═════════════ 对桌宠的快照 ═════════════ */

function snapshot() {
  const on = watching()
  const isPaused = paused()
  const watchingNow = on.includes(live.focus.bundle)
  const mode = !live.eyes || isPaused ? 'closed' : live.working ? 'work' : live.thinking ? 'think' : state.cards.length ? 'call' : watchingNow ? 'watch' : 'idle'

  return {
    mode, eyes: live.eyes, paused: isPaused, pauseUntil: config.pauseUntil, watching: watchingNow, watchingApp: watchingNow ? appName(live.focus.bundle) : '',
    focus: live.focus, screenAccess: live.screenAccess,
    watch: { bundles: on, interval: config.captureIntervalSec, paused: isPaused || !live.eyes },
    apps: [...new Set([...Object.values(config.discoveredApps ?? {}), ...Object.keys(seenBundles)])].map(name => ({ name })).map(a => { const v = bundlesOf(a.name).map(b => config.apps[b]); return { name: a.name, family: a.family, operation: config.operations?.[bundlesOf(a.name)[0]] ?? 'off', autoTargets: config.autoTargets?.[bundlesOf(a.name)[0]] ?? [], state: v.includes('on') ? 'on' : v.includes('off') ? 'off' : 'unasked' } }),
    settings: { myNames: config.myNames, captureIntervalSec: config.captureIntervalSec, morningAt: config.morningAt, wrapUpAt: config.wrapUpAt, speakBudgetPerHour: config.speakBudgetPerHour, materials: rawMaterials() },
    seeing: Date.now() - live.lastObserveAt < 10_000, currentConv: live.currentConv, ignoreConvs: config.ignoreConvs,
    working: live.working, thinking: live.thinking, lastTool: live.lastTool ?? '', nod: live.nod, nodText: live.nodText,
    observedChanges: state.observedChanges ?? 0, cards: state.cards, rules: state.rules, insight: state.insight.slice(-120), seenCount: state.seenCount,
    commitments: state.commitments.slice(-40), wrapUpAt: config.wrapUpAt, home: HOME,
  }
}

/* ═════════════ HTTP ═════════════ */

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' }
const body = req => new Promise(res => { let s = ''; req.on('data', d => s += d); req.on('end', () => { try { res(JSON.parse(s || '{}')) } catch { res({}) } }) })
const readable = p => { const f = resolve(p.startsWith('/') ? p : join(WS, p)); return [WS, ...config.materials].some(r => f.startsWith(r + '/')) ? f : null }

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = decodeURIComponent(url.pathname)
  try {
    if (req.method === 'POST' && p === '/observe') { onObserve(await body(req)).catch(e => insight({ src: '感知', text: e.message, verdict: 'error' })); return res.end('ok') }
    if (req.method === 'POST' && p === '/focus') {
      const b = await body(req); if (live.focus.bundle !== b.bundle) { focusSince = Date.now(); live.currentConv = '' } live.focus = { bundle: b.bundle, name: b.name }; live.screenAccess = b.screenAccess !== false
      if (live.eyes && !paused()) maybeAskConsent(b.bundle, b.name)
      changed(); return res.end('ok')
    }
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
    if (p === '/debug/last') {
      if (!lastObs) return res.end('{}')
      const parsed = parseChat(lastObs, findApp(lastObs.bundle, lastObs.app), config)
      return res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ window: lastObs.window, parsed, lines: lastObs.lines.map(l => ({ t: l.text, x: +(l.x * lastObs.window.w).toFixed(0), y: +(l.y * lastObs.window.h).toFixed(0), w: +(l.w * lastObs.window.w).toFixed(0), h: +(l.h * lastObs.window.h).toFixed(0), c: +l.conf.toFixed(2) })) }, null, 1))
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
  const app = process.env.SHIYI_NATIVE_APP || join(ROOT, 'native/build/Shiyi.app')
  if (!args.includes('--no-pet')) {
    if (existsSync(app)) spawn('open', ['--env', `SHIYI_URL=http://127.0.0.1:${PORT}`, app], { stdio: 'ignore' })
    else console.log('（还没构建桌宠：sh scripts/build-native.sh）')
  }
  for (const c of state.cards.filter(c => c.kind === 'opportunity' && c.status === 'working')) { c.status = 'failed'; c.error = '上次处理被后台重启中断，请重试'; changed() }
  for (const cd of state.cards.filter(c => c.kind === 'opportunity' && c.status !== 'delegated' && !c.result)) cd.stale = true
  // 上次退出时还在起草的，接着起草
  for (const c of state.commitments.filter(c => c.status === 'running')) { c.status = 'blocked'; c.progress = '后台曾中断，请重试任务'; changed() }
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
