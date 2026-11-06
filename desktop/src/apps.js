// 假桌面上的各个 App：消息、文档、表格、日历、网银（私密）、手册、原文查看器。
import { h, mdBlocks, renderBlocks, esc, sleep } from './util.js'
import { state, emit, on } from './store.js'
import { openWindow, isOpen, bodyOf, setTitle } from './wm.js'

const DESK_W = () => window.innerWidth
const at = (x, y, w, hh) => ({ x: Math.max(12, Math.min(x, DESK_W() - w - 12)), y, w, h: hh })

/* ───────────────────────── 消息 ───────────────────────── */

const CONVS = [
  { id: '产品群', name: '听澜 · 产品群', avatar: '群' },
  { id: '王建国', name: '王建国', avatar: '王' },
  { id: '陈默', name: '陈默', avatar: '陈' },
  { id: '张总', name: '张总 · 星河资本', avatar: '张' },
]
let activeConv = '产品群'

export function openChat(conv) {
  if (conv) activeConv = conv
  openWindow('chat', { title: '消息', app: 'chat', ...at(40, 56, 560, 520), render: renderChat })
}

function renderChat(body) {
  const list = h('div', { class: 'chat-list' }, CONVS.map(c => {
    const msgs = state.chats[c.id] ?? []
    const last = msgs[msgs.length - 1]
    return h('button', { class: `chat-conv${c.id === activeConv ? ' is-active' : ''}`, onclick: () => { activeConv = c.id; renderChat(body) } },
      h('span', { class: 'avatar' }, c.avatar),
      h('span', { class: 'chat-conv-text' }, h('b', {}, c.name), h('small', {}, last ? `${last.me ? '我' : last.from.replace(/（.*/, '')}：${last.text}` : '')))
  }))
  const thread = h('div', { class: 'chat-thread' }, (state.chats[activeConv] ?? []).map(m =>
    h('div', { class: `msg${m.me ? ' is-me' : ''}${m.fresh ? ' is-fresh' : ''}` },
      m.me ? null : h('span', { class: 'avatar sm' }, m.from[0]),
      h('div', { class: 'msg-col' },
        m.me ? null : h('small', { class: 'msg-from' }, m.from),
        h('div', { class: 'msg-bubble' }, m.text,
          m.attach ? h('button', { class: 'msg-attach', onclick: () => openDoc(m.attach) }, '📄 ', state.docs[m.attach]?.title ?? m.attach) : null),
        h('small', { class: 'msg-at' }, m.at.slice(11) || m.at))))
  )
  const input = h('div', { class: 'chat-input' }, h('span', { class: 'chat-input-text', id: 'chat-typing' }, ''), h('span', { class: 'chat-send' }, '发送'))
  body.replaceChildren(h('div', { class: 'chat' }, list, h('div', { class: 'chat-main' },
    h('div', { class: 'chat-head' }, CONVS.find(c => c.id === activeConv).name), thread, input)))
  thread.scrollTop = thread.scrollHeight
}

export function chatPush(conv, msg) {
  ;(state.chats[conv] ??= []).push({ ...msg, fresh: true })
  if (isOpen('chat')) { if (msg.me || conv === activeConv) activeConv = conv; renderChat(bodyOf('chat')) }
  emit('chat', { conv, msg })
}

/** 模拟在输入框里打字，然后发出。 */
export async function chatType(conv, text, at) {
  openChat(conv)
  for (let i = 1; i <= text.length; i++) {
    const el = document.getElementById('chat-typing')
    if (el) el.textContent = text.slice(0, i)
    await sleep(45)
  }
  await sleep(250)
  chatPush(conv, { at, from: '林夏', me: true, text })
}

/* ───────────────────────── 文档 ───────────────────────── */

/**
 * docs[key] = { title, text, shadow?, source?, actions?, rejectable?, revisions?, banner? }
 * revisions: [{ id, find, replace, reason, cite:{path,line}, state:'pending'|'accepted'|'rejected' }]
 */
export function openDoc(key) {
  const d = state.docs[key]
  if (!d) return
  const pos = d.shadow ? at(DESK_W() - 760 - 330, 48, 700, 640) : at(140, 70, 640, 560)
  openWindow('doc:' + key, { title: d.title, app: 'doc', ...pos, render: b => renderDoc(b, key) })
}

export function refreshDoc(key) {
  if (isOpen('doc:' + key)) { renderDoc(bodyOf('doc:' + key), key); setTitle('doc:' + key, state.docs[key].title) }
}

function renderDoc(body, key) {
  const d = state.docs[key]
  const { blocks, cites } = mdBlocks(d.text)
  for (const r of d.revisions ?? []) {
    const b = blocks.find(b => b.html.includes(esc(r.state === 'accepted' ? r.replace : r.find)))
    if (!b || r.state === 'rejected') continue
    b.html = r.state === 'pending'
      ? b.html.replace(esc(r.find), `<span class="rev" data-rev="${r.id}"><del>${esc(r.find)}</del><ins>${esc(r.replace)}</ins><span class="rev-pop"><span class="rev-why">${esc(r.reason)}</span><span class="rev-btns"><button data-act="accept">✓ 接受</button><button data-act="reject">✕ 不用</button></span></span></span>`)
      : b.html.replace(esc(r.replace), `<span class="rev-done" data-rev="${r.id}">${esc(r.replace)}<button data-act="undo" title="撤回这次修改">撤回</button></span>`)
  }
  const page = h('article', { class: 'doc-page' })
  renderBlocks(page, blocks, (el, b, idx) => {
    if (d.rejectable && ['p', 'li', 'quote'].includes(b.kind)) {
      el.classList.add('is-rejectable')
      el.append(h('button', { class: 'block-reject', title: '不要这句', onclick: e => { e.stopPropagation(); emit('block-reject', { key, idx, raw: b.raw, el }) } }, '不要这句'))
    }
    if (d.highlight && b.raw.includes(d.highlight)) el.classList.add('is-hl')
  })
  page.addEventListener('click', e => {
    const c = e.target.closest('.cite')
    if (c) return showCite(c, cites[Number(c.dataset.cite)])
    const btn = e.target.closest('[data-act]')
    if (btn) {
      const r = d.revisions.find(r => r.id === btn.closest('[data-rev]').dataset.rev)
      emit('revision', { key, rev: r, act: btn.dataset.act })
    }
  })
  const head = d.shadow
    ? h('div', { class: 'doc-banner' },
      h('span', { class: 'doc-banner-tag' }, '影子副本'),
      h('span', {}, d.banner ?? '拾遗起草 · 原件和对外渠道都还没动，你点了才算'),
      h('span', { class: 'doc-actions' }, (d.actions ?? []).map(a => h('button', { class: `btn${a.primary ? ' btn-primary' : ''}`, onclick: a.onClick }, a.label))))
    : (d.source ? h('div', { class: 'doc-path' }, d.source) : null)
  const foot = cites.length ? h('div', { class: 'doc-foot' }, `依据 ${cites.length} 处出处 · 点编号查看原文`) : null
  const keep = body.querySelector('.doc-scroll')?.scrollTop ?? 0
  const scroll = h('div', { class: 'doc-scroll' }, page, foot)
  body.replaceChildren(h('div', { class: 'doc' }, head, scroll))
  scroll.scrollTop = keep
}

/* 出处小窗 */
let citePop
function showCite(anchor, c) {
  citePop?.remove()
  const text = state.files[c.path]
  const lines = text ? text.split('\n') : []
  const from = Math.max(1, c.line - 1), to = Math.min(lines.length, c.end + 1)
  const rows = []
  for (let i = from; i <= to; i++) rows.push(h('div', { class: `cite-line${i >= c.line && i <= c.end ? ' is-hl' : ''}` }, h('i', {}, i), fmtLine(c.path, lines[i - 1] ?? '')))
  citePop = h('div', { class: 'cite-pop' },
    h('div', { class: 'cite-pop-head' }, h('b', {}, c.path), h('span', {}, `第 ${c.line}${c.end !== c.line ? '–' + c.end : ''} 行`)),
    h('div', { class: 'cite-pop-body' }, rows),
    h('button', { class: 'link', onclick: () => { citePop.remove(); openFile(c.path, c.line, c.end) } }, '打开原文 →'))
  document.body.append(citePop)
  const r = anchor.getBoundingClientRect()
  citePop.style.left = Math.min(r.left, innerWidth - 400) + 'px'
  citePop.style.top = (r.bottom + 8 + 220 > innerHeight ? r.top - 8 - citePop.offsetHeight : r.bottom + 8) + 'px'
  setTimeout(() => addEventListener('mousedown', function off(e) { if (!citePop.contains(e.target)) { citePop.remove(); removeEventListener('mousedown', off) } }), 0)
}

function fmtLine(path, line) {
  if (path.endsWith('.jsonl')) { try { const m = JSON.parse(line); return `[${m.at.slice(5)}] ${m.from}：${m.text}` } catch { /* 原样 */ } }
  return line
}

/** 原文查看器：带行号，高亮出处所在行。 */
export function openFile(path, line, end = line) {
  const text = state.files[path] ?? '（文件未加载）'
  if (path.endsWith('.csv')) return openSheet(line)
  openWindow('file:' + path, {
    title: path, app: 'file', ...at(DESK_W() / 2 - 300, 110, 600, 420),
    render: body => {
      const rows = text.split('\n').map((l, i) => h('div', { class: `file-line${i + 1 >= line && i + 1 <= end ? ' is-hl' : ''}` }, h('i', {}, i + 1), fmtLine(path, l)))
      body.replaceChildren(h('div', { class: 'file' }, rows))
      requestAnimationFrame(() => body.querySelector('.is-hl')?.scrollIntoView({ block: 'center' }))
    },
  })
}

/* ───────────────────────── 表格 ───────────────────────── */

export function openSheet(hlLine) {
  const text = state.files['data/weekly-metrics.csv'] ?? ''
  const rows = text.trim().split('\n').map(r => r.split(','))
  openWindow('sheet', {
    title: 'weekly-metrics.csv — 表格', app: 'sheet', ...at(DESK_W() - 700, 360, 620, 260),
    render: body => body.replaceChildren(h('div', { class: 'sheet' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, ''), rows[0].map(c => h('th', {}, c)))),
      h('tbody', {}, rows.slice(1).map((r, i) => h('tr', { class: i + 2 === hlLine ? 'is-hl' : '' }, h('th', {}, i + 2), r.map(c => h('td', {}, c)))))))),
  })
}

/* ───────────────────────── 日历 ───────────────────────── */

export function openCalendar() {
  const text = state.files['calendar/2026-11-06.md'] ?? ''
  openWindow('cal', {
    title: '日历 · 11月6日', app: 'cal', ...at(DESK_W() - 420, 70, 340, 400),
    render: body => {
      const items = text.split('\n').filter(l => /^- \d/.test(l)).map(l => {
        const [, t, rest] = l.match(/^- (\S+)\s+(.*)/)
        return h('div', { class: `cal-item${/改到|推迟/.test(rest) ? ' is-moved' : ''}` }, h('b', {}, t), h('span', {}, rest))
      })
      body.replaceChildren(h('div', { class: 'cal' }, items))
    },
  })
}

/* ───────────────────────── 网银（私密） ───────────────────────── */

export function openBank() {
  openWindow('bank', {
    title: '个人网银', app: 'bank', private: true, ...at(DESK_W() / 2 - 260, 120, 520, 360),
    render: body => body.replaceChildren(h('div', { class: 'bank' },
      h('div', { class: 'bank-card' }, h('small', {}, '活期账户 ···· 0927'), h('b', {}, '¥ •••,•••.••'), h('small', {}, '本月支出 ¥ ••,•••')),
      h('div', { class: 'bank-rows' }, ['房贷 · 自动扣款', '信用卡 · 还款', '基金定投', '转账 · 妈妈'].map(t => h('div', { class: 'bank-row' }, h('span', {}, t), h('span', {}, '¥ •,•••.••')))),
      h('p', { class: 'bank-note' }, '这个窗口在你的私密名单上：拾遗会闭眼，内容不出本机，也不会进入它的记忆。'))),
  })
}

/* ───────────────────────── 手册 ───────────────────────── */

export function openHandbook() {
  openWindow('handbook', { title: '我的工作方式 · 手册', app: 'book', ...at(DESK_W() - 760, 90, 420, 470), render: renderHandbook })
}
on('rules', () => { if (isOpen('handbook')) renderHandbook(bodyOf('handbook')) })

function renderHandbook(body) {
  const raw = h('pre', { class: 'book-raw' }, handbookMarkdown())
  body.replaceChildren(h('div', { class: 'book' },
    h('p', { class: 'book-intro' }, '你每说一次「不要」，拾遗都会想想能不能学到点什么。学到的规则要你点头才会写进来；下次它做事前会先读这本手册。'),
    state.rules.length
      ? h('ol', { class: 'book-rules' }, state.rules.map(r => h('li', { class: `book-rule${r.fresh ? ' is-fresh' : ''}` },
        h('b', {}, r.text), h('small', {}, `学自：${r.learnedFrom} · ${r.at}`),
        h('button', { class: 'link', onclick: () => { state.rules = state.rules.filter(x => x !== r); emit('rules') } }, '停用'))))
      : h('div', { class: 'book-empty' }, '还没有规则。'),
    h('details', { class: 'book-details' }, h('summary', {}, '拾遗实际读到的原文（AGENTS.md）'), raw)))
}

export function handbookMarkdown() {
  return ['## 我的工作方式（林夏确认过的规则）', '', ...(state.rules.length ? state.rules.map((r, i) => `${i + 1}. ${r.text}`) : ['（暂无）'])].join('\n')
}
