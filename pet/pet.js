// 桌宠页面：跑在 拾遗.app 的透明置顶窗口里（也可以直接用浏览器打开调试）。
// 数据全部来自 daemon 的 /events 快照；操作发 /action。
import { h, mdBlocks, renderBlocks } from '/lib/util.js'

const native = window.webkit?.messageHandlers?.shiyi
const post = msg => native?.postMessage(msg)
const act = a => fetch('/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) })

let S = null            // 最新快照
let view = new URLSearchParams(location.search).get('view')   // null | 'cards' | 'insight' | 'book' | 'today' | {doc}（?view= 用于调试截图）
let lastNod = -1
let bubble = { text: '', until: 0, tone: '' }
let editing = null      // 正在写意见的承诺 id

const PET_SVG = `<svg viewBox="0 0 120 110" class="pet-svg"><ellipse class="pet-shadow" cx="60" cy="104" rx="34" ry="5"/><g class="pet-bodyg"><path class="pet-body" d="M60 14c26 0 44 20 44 46 0 26-17 40-44 40S16 86 16 60c0-26 18-46 44-46z"/><path class="pet-leaf" d="M60 15c-2-8 3-13 10-13-1 7-4 11-10 13z"/><ellipse class="pet-cheek" cx="34" cy="70" rx="7" ry="4"/><ellipse class="pet-cheek" cx="86" cy="70" rx="7" ry="4"/><g class="pet-eyes"><g transform="translate(44 56)"><ellipse class="pet-pupil" rx="6" ry="8"/><circle class="pet-glint" cx="2" cy="-3" r="2"/></g><g transform="translate(76 56)"><ellipse class="pet-pupil" rx="6" ry="8"/><circle class="pet-glint" cx="2" cy="-3" r="2"/></g></g><g class="pet-closed"><path d="M37 58q7 5 14 0M69 58q7 5 14 0"/></g><path class="pet-mouth" d="M55 76q5 4 10 0"/><g class="pet-dots"><circle cx="96" cy="22" r="3"/><circle cx="106" cy="14" r="3"/><circle cx="114" cy="5" r="3"/></g></g></svg>`

const root = document.getElementById('root')
const panel = h('div', { class: 'panel' })
const bubbleEl = h('div', { class: 'bubble', onclick: () => { view = 'cards'; render() } })
const petEl = h('div', { class: 'pet', html: PET_SVG, onclick: () => { view = view ? null : (S?.cards.length ? 'cards' : 'today'); render() } }, h('span', { class: 'badge' }))
const menu = h('div', { class: 'menu' })
root.append(panel, h('div', { class: 'dock' }, bubbleEl, h('div', { class: 'pet-row' }, menu, petEl)))

function say(text, ms = 3500, tone = '') { bubble = { text, until: ms ? Date.now() + ms : Infinity, tone }; render(); if (ms) setTimeout(render, ms + 50) }

/* ── 连接 daemon ── */
function connect() {
  const es = new EventSource('/events')
  es.onmessage = e => {
    const prev = S
    S = JSON.parse(e.data)
    if (S.nod !== lastNod) { if (lastNod >= 0 && S.nodText) { nod(); say(S.nodText, 4000, 'quiet') } lastNod = S.nod }
    if (prev && S.cards.length > prev.cards.length && !view) say(S.cards[0].title, 0, 'call')
    if (!editing) render()
  }
  es.onerror = () => { es.close(); S = null; say('连不上拾遗后台，正在重试…', 0, 'quiet'); setTimeout(connect, 3000) }
}
connect()

function nod() { petEl.classList.add('is-nod'); setTimeout(() => petEl.classList.remove('is-nod'), 700) }
setInterval(() => { petEl.classList.add('is-blink'); setTimeout(() => petEl.classList.remove('is-blink'), 140) }, 4200)

/* ── 渲染 ── */
function render() {
  if (!S) { sizeTo(); return }
  petEl.className = `pet is-${S.mode}`
  petEl.querySelector('.badge').textContent = S.cards.length || ''

  // 气泡：权限提示 > 正在干活 > 临时话
  let text = '', tone = ''
  if (!S.screenAccess) { text = '我需要「屏幕录制」权限才能看微信。点这里打开设置，勾选 Shiyi，然后重开我。'; tone = 'warn' }
  else if (S.working && S.lastTool) { text = `正在起草…${S.lastTool}`; tone = 'quiet' }
  else if (Date.now() < bubble.until) { text = bubble.text; tone = bubble.tone }
  bubbleEl.className = `bubble ${text ? 'is-on' : ''} ${tone}`
  bubbleEl.textContent = text
  bubbleEl.onclick = !S.screenAccess ? () => act({ type: 'open-privacy' }) : () => { view = 'cards'; render() }

  menu.replaceChildren(
    h('button', { onclick: () => { const on = !S.eyes; post({ eyes: on }); act({ type: 'eyes', on }); say(on ? '我睁眼啦，只看微信。' : '好，我闭眼，什么都不看。', 2500, 'quiet') } }, S.eyes ? '闭眼' : '睁眼'),
    h('button', { onclick: () => open('today') }, '今天'),
    h('button', { onclick: () => open('insight') }, '它看到了什么'),
    h('button', { onclick: () => open('book') }, '手册'),
    h('button', { class: 'quiet', onclick: () => { if (confirm('退出拾遗？')) act({ type: 'quit' }) } }, '退出'))

  panel.classList.toggle('is-open', !!view)
  if (view) panel.replaceChildren(head(), body())
  sizeTo()
}
const open = v => { view = view === v ? null : v; render() }

function head() {
  const title = typeof view === 'object' ? view.doc.split('/').pop() : { cards: '找你的事', insight: '它看到了什么', book: '我的工作方式', today: '今天的承诺' }[view]
  const status = S.eyes ? (S.privateApp ? '私密应用在前台 · 闭眼' : S.wechat ? (S.seeing ? '正在看微信' : '微信在前台') : '只看微信 · 现在没看') : '闭眼中'
  return h('div', { class: 'head' },
    typeof view === 'object' ? h('button', { class: 'back', onclick: () => { view = 'cards'; render() } }, '‹') : null,
    h('b', {}, title), h('span', { class: 'status' }, status),
    h('button', { class: 'x', onclick: () => { view = null; render() } }, '×'))
}

function body() {
  if (typeof view === 'object') return docView(view.doc)
  if (view === 'insight') return insightView()
  if (view === 'book') return bookView()
  if (view === 'today') return todayView()
  return S.cards.length ? h('div', { class: 'cards' }, S.cards.map(cardView)) : h('div', { class: 'empty' }, '现在没有要找你的事。我在看着微信，你答应别人的事我会记下。')
}

/* ── 卡片 ── */
function cardView(c) {
  if (c.kind === 'learn') return h('div', { class: 'card card-learn' },
    h('div', { class: 'card-top' }, h('span', { class: 'kind' }, '想记住一条'), h('span', {}, c.at)),
    h('div', { class: 'title' }, c.title),
    h('blockquote', { class: 'rule' }, c.rule), c.scope ? h('div', { class: 'why' }, `适用于：${c.scope}`) : null,
    h('div', { class: 'why' }, `因为你说：「${c.reason}」`),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => act({ type: 'learn', cardId: c.id, accept: true }) }, '记住'),
      h('button', { class: 'btn', onclick: () => act({ type: 'learn', cardId: c.id, accept: false }) }, '只是这次')))

  if (c.kind === 'wrap') return h('div', { class: 'card card-wrap' },
    h('div', { class: 'card-top' }, h('span', { class: 'kind' }, '下班收尾'), h('span', {}, c.at), h('button', { class: 'x', onclick: () => act({ type: 'dismiss', cardId: c.id }) }, '×')),
    h('div', { class: 'title' }, c.title),
    h('ul', { class: 'wrap' }, c.items.map(i => h('li', { class: ['done', 'sent'].includes(i.status) ? 'is-done' : '' },
      h('span', { class: 'dot' }, i.status === 'done' ? '✓' : ''),
      h('span', {}, h('b', {}, `${i.to} · ${i.what}`), h('small', {}, STATUS[i.status] + (i.doneAt ? ` · ${i.doneAt}` : ''))),
      i.status === 'ready' || i.status === 'copied' ? h('button', { class: 'link', onclick: () => { act({ type: 'open-card', commitmentId: i.id }); view = 'cards' } }, '看看') : null))))

  // 承诺
  const edit = editing === c.commitmentId
  const input = h('textarea', { class: 'reason', placeholder: '哪里不对？比如：语气太正式了 / 给老板的别用「我觉得」/ 少了上周的数据' })
  return h('div', { class: 'card card-commitment' },
    h('div', { class: 'card-top' }, h('span', { class: 'kind' }, c.phase === 'sent?' ? '等你发出' : '承诺 · 已备好'), h('span', {}, c.at),
      h('button', { class: 'x', title: '先放着', onclick: () => act({ type: 'dismiss', cardId: c.id }) }, '×')),
    h('div', { class: 'title' }, c.title),
    h('div', { class: 'why' }, h('b', {}, '为什么找你　'), c.why),
    c.message ? h('div', { class: 'msg' }, h('small', {}, '要发的话'), c.message) : null,
    c.missing ? missingView(c.missing) : null,
    c.docs?.length ? h('div', { class: 'chips' }, c.docs.map(d => h('button', { class: 'chip', onclick: () => { view = { doc: d }; render() } }, '📄 ' + d.split('/').pop()))) : null,
    edit ? h('div', { class: 'revise' }, input, h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => { const r = input.value.trim(); if (!r) return; editing = null; act({ type: 'revise', commitmentId: c.commitmentId, reason: r }); say('好，我按你说的改。', 2500, 'quiet') } }, '按这个改'),
      h('button', { class: 'btn', onclick: () => { editing = null; render() } }, '算了'))) : null,
    edit ? null : h('div', { class: 'actions' }, c.phase === 'sent?'
      ? [h('button', { class: 'btn primary', onclick: () => act({ type: 'sent', commitmentId: c.commitmentId }) }, '发了 ✓'),
        h('button', { class: 'btn', onclick: () => act({ type: 'copy', commitmentId: c.commitmentId }) }, '再复制一次')]
      : [c.message ? h('button', { class: 'btn primary', onclick: () => { act({ type: 'copy', commitmentId: c.commitmentId }); say('复制好了，微信里粘贴就行。', 3000, 'quiet') } }, '复制并打开微信') : null,
        h('button', { class: 'btn', onclick: () => { editing = c.commitmentId; render(); setTimeout(() => panel.querySelector('textarea')?.focus(), 30); post({ focus: true }) } }, '改一下'),
        h('button', { class: 'btn', onclick: () => act({ type: 'drop', commitmentId: c.commitmentId }) }, '不用了')]))
}
function missingView(text) {
  const box = h('div', { class: 'missing-body' })
  renderBlocks(box, mdBlocks(text.replace(/^#.*\n+/, '')).blocks)
  return h('div', { class: 'missing' }, h('small', {}, '还缺（补上就能发）'), box)
}
const STATUS = { open: '记下了', drafting: '在起草', ready: '草稿备好了，等你', copied: '复制了，等你发', sent: '已发', done: '已兑现', dropped: '不要了' }

/* ── 其他视图 ── */
const VERDICT = { ignore: ['忽略', 'v-ignore'], remember: ['记下', 'v-remember'], act: ['出手', 'v-act'], private: ['没看', 'v-private'], speak: ['开口', 'v-speak'], learn: ['学到', 'v-learn'], error: ['出错', 'v-error'] }
function insightView() {
  const n = v => S.insight.filter(e => e.verdict === v).length
  return h('div', { class: 'scroll' },
    h('p', { class: 'intro' }, '只看微信。每条新消息先过本机规则（不花钱），像承诺的再交给轻量模型确认，真要做事才叫醒主 agent。大多数时候它选择闭嘴。'),
    h('div', { class: 'stats' }, [['看到', S.insight.length], ['忽略', n('ignore')], ['记下', n('remember')], ['出手', n('act')], ['开口', n('speak')]].map(([l, v]) => h('div', {}, h('b', {}, v), h('small', {}, l)))),
    h('ol', { class: 'ins' }, [...S.insight].reverse().map(e => {
      const [label, cls] = VERDICT[e.verdict] ?? [e.verdict, '']
      return h('li', {}, h('div', { class: 'ins-top' }, h('span', { class: `verdict ${cls}` }, label), h('span', { class: 'src' }, e.src), h('span', { class: 'at' }, e.at)),
        h('div', {}, e.text), e.layer ? h('div', { class: 'cost' }, e.layer + (e.cost ? ' · ' + e.cost : '')) : null)
    })))
}
function bookView() {
  return h('div', { class: 'scroll' },
    h('p', { class: 'intro' }, '你每次说「改一下」，我都会想想能不能学到点什么；你点头的规则才写进来。我起草前会先读这本手册。'),
    S.rules.length ? h('ol', { class: 'rules' }, S.rules.map(r => h('li', {}, h('b', {}, r.text), h('small', {}, `${r.scope ? r.scope + ' · ' : ''}学自 ${r.learnedFrom}`),
      h('button', { class: 'link', onclick: () => act({ type: 'rule-off', id: r.id }) }, '停用')))) : h('div', { class: 'empty' }, '还没有规则。'),
    h('p', { class: 'path' }, `原文：${S.home}/workspace/AGENTS.md`))
}
function todayView() {
  const list = [...S.commitments].reverse()
  return h('div', { class: 'scroll' },
    list.length ? h('ul', { class: 'wrap' }, list.map(c => h('li', { class: ['done', 'sent'].includes(c.status) ? 'is-done' : '' },
      h('span', { class: 'dot' }, c.status === 'done' ? '✓' : ''),
      h('span', {}, h('b', {}, `${c.to} · ${c.what}`), h('small', {}, `${c.dueText || '没说时间'} · ${STATUS[c.status]}${c.doneAt ? ' · ' + c.doneAt : ''}`), h('small', { class: 'quote' }, `「${c.quote}」`)),
      ['ready', 'copied'].includes(c.status) ? h('button', { class: 'link', onclick: () => { act({ type: 'open-card', commitmentId: c.id }); view = 'cards' } }, '看看') : null)))
      : h('div', { class: 'empty' }, '还没有记下承诺。在微信里答应别人点什么试试，比如「明天上午发你周报」。'),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => { act({ type: 'wrapup' }); view = 'cards' } }, '现在收个尾')))
}

function docView(path) {
  const box = h('div', { class: 'scroll doc' }, '加载中…')
  fetch('/file?path=' + encodeURIComponent(path)).then(r => r.text()).then(t => {
    const { blocks, cites } = mdBlocks(t)
    renderBlocks(box, blocks)
    box.append(h('p', { class: 'path' }, `${S.home}/workspace/${path}`))
    box.onclick = async e => {
      const b = e.target.closest('.cite'); if (!b) return
      const c = cites[Number(b.dataset.cite)]
      box.querySelector('.cite-pop')?.remove()
      const src = await (await fetch('/file?path=' + encodeURIComponent(c.path))).text().catch(() => '')
      const start = Math.max(1, c.line - 1)
      const lines = src.split('\n').slice(start - 1, c.end + 1)
      b.after(h('span', { class: 'cite-pop' }, h('b', {}, `${c.path.replace(/^.*\/(?=[^/]+\/[^/]+$)/, '…/')} 第 ${c.line} 行`),
        lines.map((l, i) => h('span', { class: start + i >= c.line && start + i <= c.end ? 'hl' : '' }, l))))
    }
  })
  return box
}

/* ── 窗口大小：只占需要的地方，别挡别的应用 ── */
let lastSize = ''
function sizeTo() {
  const w = view ? 440 : bubbleEl.classList.contains('is-on') ? 300 : 230
  const hh = view ? 700 : bubbleEl.classList.contains('is-on') ? 210 : 140
  const k = `${w}x${hh}`
  if (k !== lastSize) { lastSize = k; post({ size: { w, h: hh } }) }
}
