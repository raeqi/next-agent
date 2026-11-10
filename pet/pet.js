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
let editing = null      // {id, mode:'revise'|'supply'}
let quitArmed = false
let showTech = localStorage.getItem('shiyi.tech') === '1'

const PET_SVG = `<svg viewBox="0 0 120 110" class="pet-svg"><ellipse class="pet-shadow" cx="60" cy="104" rx="34" ry="5"/><g class="pet-bodyg"><path class="pet-body" d="M60 14c26 0 44 20 44 46 0 26-17 40-44 40S16 86 16 60c0-26 18-46 44-46z"/><path class="pet-leaf" d="M60 15c-2-8 3-13 10-13-1 7-4 11-10 13z"/><ellipse class="pet-cheek" cx="34" cy="70" rx="7" ry="4"/><ellipse class="pet-cheek" cx="86" cy="70" rx="7" ry="4"/><g class="pet-eyes"><g transform="translate(44 56)"><ellipse class="pet-pupil" rx="6" ry="8"/><circle class="pet-glint" cx="2" cy="-3" r="2"/></g><g transform="translate(76 56)"><ellipse class="pet-pupil" rx="6" ry="8"/><circle class="pet-glint" cx="2" cy="-3" r="2"/></g></g><g class="pet-closed"><path d="M37 58q7 5 14 0M69 58q7 5 14 0"/></g><path class="pet-mouth" d="M55 76q5 4 10 0"/><g class="pet-dots"><circle cx="96" cy="22" r="3"/><circle cx="106" cy="14" r="3"/><circle cx="114" cy="5" r="3"/></g></g></svg>`

const root = document.getElementById('root')
const panel = h('div', { class: 'panel' })
const bubbleEl = h('div', { class: 'bubble' })
const petEl = h('div', { class: 'pet', html: PET_SVG, title: '点我看找你的事；按住可以拖走' }, h('span', { class: 'badge' }))
const menu = h('div', { class: 'menu' })
const petRow = h('div', { class: 'pet-row' }, menu, petEl)
root.append(panel, h('div', { class: 'dock' }, bubbleEl, petRow))

function say(text, ms = 3500, tone = '') { bubble = { text, until: ms ? Date.now() + ms : Infinity, tone }; render(); if (ms) setTimeout(render, ms + 50) }

/* ── 菜单：鼠标停在桌宠上出现，离开后收起（隐藏时不占点击区域） ── */
let menuTimer
if (new URLSearchParams(location.search).get('menu')) menu.classList.add('is-on')   // 调试截图用
petEl.addEventListener('mouseenter', () => { clearTimeout(menuTimer); if (!drag) { menu.classList.add('is-on'); sizeTo() } })
petRow.addEventListener('mouseenter', () => clearTimeout(menuTimer))
petRow.addEventListener('mouseleave', () => { menuTimer = setTimeout(() => { menu.classList.remove('is-on'); sizeTo() }, 400) })
menu.addEventListener('click', e => { if (e.target.closest('button')) setTimeout(() => { menu.classList.remove('is-on'); sizeTo() }, 150) })

/* ── 拖动桌宠（按住移动超过 4px 才算拖，否则是点击） ── */
let drag = null
petEl.addEventListener('mousedown', e => { drag = { x: e.screenX, y: e.screenY, moved: false } })
addEventListener('mousemove', e => {
  if (!drag) return
  const dx = e.screenX - drag.x, dy = e.screenY - drag.y
  if (!drag.moved && Math.hypot(dx, dy) < 4) return
  if (!drag.moved) menu.classList.remove('is-on')
  drag.moved = true; drag.x = e.screenX; drag.y = e.screenY
  post({ drag: { dx, dy } })
})
addEventListener('mouseup', () => {
  if (!drag) return
  const moved = drag.moved; drag = null
  if (moved) { post({ dragEnd: true }); return }
  view = view ? null : (S?.cards.length ? 'cards' : 'today'); render()
})

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
  bubbleEl.onclick = !S.screenAccess ? () => act({ type: 'open-privacy' }) : () => { view = S.cards.length ? 'cards' : view; render() }

  const canIgnore = S.wechat && S.currentConv && !S.ignoreConvs.includes(S.currentConv)
  const status = !S.eyes ? '闭眼中' : S.privateApp ? '私密应用在前台' : S.wechat ? (S.currentConv ? `在看：${short(S.currentConv)}` : '在看微信') : '微信不在前台'
  menu.replaceChildren(...[
    h('small', {}, status),
    h('button', { onclick: () => { const on = !S.eyes; post({ eyes: on }); act({ type: 'eyes', on }); say(on ? '我睁眼啦，只看微信。' : '好，我闭眼，什么都不看。', 2500, 'quiet') } }, S.eyes ? '闭眼（暂停看）' : '睁眼'),
    canIgnore ? h('button', { onclick: () => { act({ type: 'ignore-conv', conv: S.currentConv }); say(`好，以后不看「${S.currentConv}」，存下的记录也删了。`, 3500, 'quiet') } }, `不看「${short(S.currentConv)}」`) : null,
    h('div', { class: 'sep' }),
    h('button', { onclick: () => open('today') }, '我答应的事'),
    h('button', { onclick: () => open('insight') }, '它看到了什么'),
    h('button', { onclick: () => open('book') }, '我的工作方式'),
    h('div', { class: 'sep' }),
    h('button', { class: quitArmed ? 'danger' : 'quit', onclick: () => {
      if (!quitArmed) { quitArmed = true; render(); setTimeout(() => { quitArmed = false; render() }, 3000); return }
      act({ type: 'quit' }); post({ quit: true })
    } }, quitArmed ? '再点一次退出' : '退出拾遗'),
  ].filter(Boolean))

  panel.classList.toggle('is-open', !!view)
  if (view) panel.replaceChildren(head(), body())
  sizeTo()
}
const open = v => { view = view === v ? null : v; render() }
const short = s => s.length > 8 ? s.slice(0, 8) + '…' : s

function head() {
  const title = typeof view === 'object' ? view.doc.split('/').pop() : { cards: '找你的事', insight: '它看到了什么', book: '我的工作方式', today: '我答应的事' }[view]
  const status = !S.eyes ? '闭眼中' : S.privateApp ? '私密应用在前台，没在看' : S.wechat ? '在看微信' : '没在看（微信不在前台）'
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
    h('blockquote', { class: 'rule' }, c.rule), c.scope ? h('div', { class: 'why' }, `只用在：${c.scope}`) : null,
    h('div', { class: 'why' }, `因为你说：「${c.reason}」`),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => act({ type: 'learn', cardId: c.id, accept: true }) }, '记住'),
      h('button', { class: 'btn', onclick: () => act({ type: 'learn', cardId: c.id, accept: false }) }, '只是这次')))

  if (c.kind === 'wrap') return h('div', { class: 'card card-wrap' },
    h('div', { class: 'card-top' }, h('span', { class: 'kind' }, '下班收尾'), h('span', {}, c.at), closeBtn(c)),
    h('div', { class: 'title' }, c.title),
    h('ul', { class: 'wrap' }, c.items.map(i => h('li', { class: i.status === 'done' ? 'is-done' : '' },
      h('span', { class: 'dot' }, i.status === 'done' ? '✓' : ''),
      h('span', {}, h('b', {}, i.todo || `${i.to} · ${i.what}`), h('small', {}, STATUS[i.status] + (i.doneAt ? ` · ${i.doneAt}` : ''))),
      ['ready', 'copied'].includes(i.status) ? h('button', { class: 'link', onclick: () => { act({ type: 'open-card', commitmentId: i.id }); view = 'cards' } }, '看看') : null))))

  // 承诺
  const id = c.commitmentId
  const kind = { ready: '承诺 · 已备好', missing: '承诺 · 还差一点', copied: '等你发出', confirm: '是这条吗' }[c.phase]
  return h('div', { class: `card card-commitment phase-${c.phase}` },
    h('div', { class: 'card-top' }, h('span', { class: 'kind' }, kind), h('span', {}, c.at), closeBtn(c)),
    h('div', { class: 'title' }, c.title),
    c.phase === 'confirm' ? h('div', { class: 'msg' }, h('small', {}, '你刚发的'), c.confirmQuote) : h('div', { class: 'why' }, c.why),
    c.phase === 'copied' ? h('div', { class: 'hint' }, `去和「${c.conv}」的聊天里粘贴发送。发出去我会自动划掉。`) : null,
    c.message && c.phase !== 'confirm' ? h('div', { class: 'msg' }, h('small', {}, '要发的话'), c.message) : null,
    c.phase === 'missing' ? missingView(c.missing) : null,
    c.docs?.length && c.phase !== 'confirm' ? h('div', { class: 'chips' }, c.docs.map(d => h('button', { class: 'chip', onclick: () => { view = { doc: d }; render() } }, '📄 ' + d.split('/').pop()))) : null,
    editing?.id === id ? editor(c) : h('div', { class: 'actions' }, actionsFor(c)))
}
const closeBtn = c => h('button', { class: 'x', title: '先放着', onclick: () => act({ type: 'dismiss', cardId: c.id }) }, '×')

function actionsFor(c) {
  const id = c.commitmentId
  const edit = mode => () => { editing = { id, mode }; render(); setTimeout(() => panel.querySelector('textarea')?.focus(), 30); post({ focus: true }) }
  switch (c.phase) {
    case 'confirm': return [
      h('button', { class: 'btn primary', onclick: () => act({ type: 'sent', commitmentId: id }) }, '是，划掉'),
      h('button', { class: 'btn', onclick: () => act({ type: 'not-it', commitmentId: id }) }, '不是')]
    case 'copied': return [
      h('button', { class: 'btn primary', onclick: () => act({ type: 'sent', commitmentId: id }) }, '发了 ✓'),
      h('button', { class: 'btn', onclick: () => act({ type: 'copy', commitmentId: id }) }, '再复制一次')]
    case 'missing': return [
      h('button', { class: 'btn primary', onclick: edit('supply') }, '补上信息'),
      h('button', { class: 'btn', onclick: () => act({ type: 'drop', commitmentId: id }) }, '不用了')]
    default: return [
      h('button', { class: 'btn primary', onclick: () => { act({ type: 'copy', commitmentId: id }); say(`复制好了，去和「${c.conv}」的聊天里粘贴。`, 3500, 'quiet') } }, '复制并打开微信'),
      h('button', { class: 'btn', onclick: edit('revise') }, '改一下'),
      h('button', { class: 'btn', onclick: () => act({ type: 'drop', commitmentId: id }) }, '不用了')]
  }
}

function editor(c) {
  const supplyMode = editing.mode === 'supply'
  const input = h('textarea', { class: 'reason', placeholder: supplyMode ? '把缺的告诉我，比如：W45 DAU 11.2 万，付费团队 1350 家' : '哪里不对？比如：语气太正式了 / 给老板的别用「我觉得」/ 少了上周的数据' })
  const submit = () => {
    const v = input.value.trim(); if (!v) return
    editing = null
    act({ type: supplyMode ? 'supply' : 'revise', commitmentId: c.commitmentId, [supplyMode ? 'info' : 'reason']: v })
    say(supplyMode ? '收到，我补上。' : '好，我按你说的改。', 2500, 'quiet')
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() })
  return h('div', { class: 'revise' }, input, h('div', { class: 'actions' },
    h('button', { class: 'btn primary', onclick: submit }, supplyMode ? '补上' : '按这个改'),
    h('button', { class: 'btn', onclick: () => { editing = null; render() } }, '算了')))
}

function missingView(text) {
  const box = h('div', { class: 'missing-body' })
  renderBlocks(box, mdBlocks((text || '').replace(/^#.*\n+/, '')).blocks)
  return h('div', { class: 'missing' }, h('small', {}, '还缺这些，补上我就能写完'), box)
}
const STATUS = { open: '记下了', drafting: '在起草', ready: '草稿好了，等你', copied: '复制了，等你发', sent: '已发', done: '已兑现', dropped: '不用了' }

/* ── 其他视图 ── */
const VERDICT = { ignore: ['忽略', 'v-ignore'], suspect: ['怀疑', 'v-suspect'], remember: ['记下', 'v-remember'], draft: ['起草', 'v-draft'], done: ['完成', 'v-done'], act: ['处理', 'v-draft'], private: ['没看', 'v-private'], speak: ['开口', 'v-speak'], learn: ['学到', 'v-learn'], error: ['出错', 'v-error'] }
function insightView() {
  const n = v => S.insight.filter(e => e.verdict === v).length
  return h('div', { class: 'scroll' },
    h('p', { class: 'intro' }, '只看微信。每条新消息先过本机规则，像是答应了什么的，再交给一个轻量模型确认；真要做事，才叫醒起草的 agent。大多数时候它选择不出声。'),
    h('div', { class: 'stats' }, [['看到消息', S.seenCount], ['忽略', n('ignore')], ['记下', n('remember')], ['起草', n('draft')], ['开口', n('speak')]].map(([l, v]) => h('div', {}, h('b', {}, v), h('small', {}, l)))),
    h('label', { class: 'tech' }, h('input', { type: 'checkbox', checked: showTech || null, onchange: e => { showTech = e.target.checked; localStorage.setItem('shiyi.tech', showTech ? '1' : '0'); render() } }), '显示技术细节（哪一层判断、用了哪个模型、花了多久）'),
    h('ol', { class: 'ins' }, [...S.insight].reverse().map(e => {
      const [label, cls] = VERDICT[e.verdict] ?? [e.verdict, '']
      return h('li', {}, h('div', { class: 'ins-top' }, h('span', { class: `verdict ${cls}` }, label), h('span', { class: 'src' }, e.src), h('span', { class: 'at' }, e.at)),
        h('div', {}, e.text), showTech && e.layer ? h('div', { class: 'cost' }, e.layer + (e.cost ? ' · ' + e.cost : '')) : null)
    })))
}
function bookView() {
  return h('div', { class: 'scroll' },
    h('p', { class: 'intro' }, '你每次说「改一下」，我都会想想能不能学到点什么；你点了「记住」的才会写进来。起草前我会先读这里，并且只在规则写明的范围里用。'),
    S.rules.length ? h('ol', { class: 'rules' }, S.rules.map(r => h('li', {}, h('b', {}, r.text), h('small', {}, `${r.scope ? '只用在：' + r.scope + ' · ' : ''}学自 ${r.learnedFrom}`),
      h('button', { class: 'link', onclick: () => act({ type: 'rule-off', id: r.id }) }, '停用')))) : h('div', { class: 'empty' }, '还没有规则。'),
    S.ignoreConvs.length ? h('div', { class: 'ignored' }, h('b', {}, '不看的会话'), S.ignoreConvs.map(cv => h('span', { class: 'chip' }, cv, ' ', h('button', { class: 'link', onclick: () => act({ type: 'unignore-conv', conv: cv }) }, '恢复')))) : null,
    h('p', { class: 'path' }, `原文：${S.home}/workspace/AGENTS.md`))
}
function todayView() {
  const list = [...S.commitments].filter(c => c.status !== 'dropped').reverse()
  return h('div', { class: 'scroll' },
    list.length ? h('ul', { class: 'wrap' }, list.map(c => h('li', { class: c.status === 'done' ? 'is-done' : '' },
      h('span', { class: 'dot' }, c.status === 'done' ? '✓' : ''),
      h('span', {}, h('b', {}, c.todo || `${c.to} · ${c.what}`), h('small', {}, `${c.dueText || '没说时间'} · ${STATUS[c.status]}${c.doneAt ? ' · ' + c.doneAt : ''}`), h('small', { class: 'quote' }, c.request ? `${c.conv}：「${c.request}」→ 你：「${c.quote}」` : `你对${c.conv}说：「${c.quote}」`)),
      ['ready', 'copied'].includes(c.status) ? h('button', { class: 'link', onclick: () => { act({ type: 'open-card', commitmentId: c.id }); view = 'cards' } }, '看看') : null)))
      : h('div', { class: 'empty' }, '还没有记下的承诺。在微信里答应别人点什么试试，比如「明天上午发你周报」。'),
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

/* ── 窗口：只占需要的地方；把可点区域告诉原生，其余透明处点击穿透 ── */
let lastSize = ''
function sizeTo() {
  const on = bubbleEl.classList.contains('is-on')
  const m = menu.classList.contains('is-on')
  const w = view ? 440 : on ? 300 : m ? 280 : 120
  const hh = view ? 700 : m ? 320 + (on ? 70 : 0) : on ? 210 : 110
  const k = `${w}x${hh}`
  if (k !== lastSize) { lastSize = k; post({ size: { w, h: hh } }) }
  requestAnimationFrame(reportHit)
}
function reportHit() {
  const rects = [petEl, menu, bubbleEl, panel].filter(el => el.offsetParent !== null && el.offsetWidth && getComputedStyle(el).display !== 'none')
    .map(el => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height] })
  post({ hit: rects })
}
addEventListener('resize', () => requestAnimationFrame(reportHit))
