// 桌宠页面：跑在 拾遗.app 的透明置顶窗口里（也可以直接用浏览器打开调试）。
// 数据全部来自 daemon 的 /events 快照；操作发 /action。
import { h, mdBlocks, renderBlocks } from '/lib/util.js'

const native = window.webkit?.messageHandlers?.shiyi
const post = msg => native?.postMessage(msg)
const act = a => fetch('/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }).then(async r => { if (!r.ok) say(await r.text(), 6000, 'warn') })

let S = null            // 最新快照
let view = new URLSearchParams(location.search).get('view')   // null | 'cards' | 'insight' | 'book' | 'today' | {doc}（?view= 用于调试截图）
let lastNod = -1
let lastWatch = ''
let bubble = { text: '', until: 0, tone: '' }
let editing = null      // {id, mode:'revise'|'supply'}
let quitArmed = false
let showTech = localStorage.getItem('shiyi.tech') === '1'

const PET_SVG = `<svg viewBox="0 0 120 110" class="pet-svg"><ellipse class="pet-shadow" cx="60" cy="104" rx="34" ry="5"/><g class="pet-bodyg"><path class="pet-body" d="M60 14c26 0 44 20 44 46 0 26-17 40-44 40S16 86 16 60c0-26 18-46 44-46z"/><path class="pet-leaf" d="M60 15c-2-8 3-13 10-13-1 7-4 11-10 13z"/><ellipse class="pet-cheek" cx="34" cy="70" rx="7" ry="4"/><ellipse class="pet-cheek" cx="86" cy="70" rx="7" ry="4"/><g class="pet-eyes"><g transform="translate(44 56)"><ellipse class="pet-pupil" rx="6" ry="8"/><circle class="pet-glint" cx="2" cy="-3" r="2"/></g><g transform="translate(76 56)"><ellipse class="pet-pupil" rx="6" ry="8"/><circle class="pet-glint" cx="2" cy="-3" r="2"/></g></g><g class="pet-closed"><path d="M37 58q7 5 14 0M69 58q7 5 14 0"/></g><path class="pet-mouth" d="M55 76q5 4 10 0"/><g class="pet-dots"><circle cx="96" cy="22" r="3"/><circle cx="106" cy="14" r="3"/><circle cx="114" cy="5" r="3"/></g></g></svg>`

const root = document.getElementById('root')
const panel = h('div', { class: 'panel' })
const bubbleEl = h('div', { class: 'bubble' })
const petEl = h('div', { class: 'pet', html: PET_SVG, title: '点我查看任务与建议；按住可以拖走' }, h('span', { class: 'badge' }))
const menu = h('div', { class: 'menu' })
const petRow = h('div', { class: 'pet-row' }, menu, petEl)
root.append(panel, h('div', { class: 'dock' }, bubbleEl, petRow))

window.shiyiDismiss = () => { view = null; editing = null; menu.classList.remove('is-on'); bubble.until = 0; render() }
addEventListener('mousedown', e => { if (!e.target.closest('.panel, .pet, .menu, .bubble')) window.shiyiDismiss() })
addEventListener('keydown', e => { if (e.key === 'Escape') window.shiyiDismiss() })

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
    if (bubble.text === '连不上拾遗后台，正在重试…') bubble = { text: '', until: 0, tone: '' }
    const w = JSON.stringify(S.watch)
    if (w !== lastWatch) { lastWatch = w; post({ watch: S.watch }) }
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
  if (!S.screenAccess) { text = '我需要「屏幕录制」权限才能观察应用。点这里打开设置，勾选 Shiyi，然后重开我。'; tone = 'warn' }
  else if (S.working && S.lastTool) { text = `正在起草…${S.lastTool}`; tone = 'quiet' }
  else if (Date.now() < bubble.until) { text = bubble.text; tone = bubble.tone }
  bubbleEl.className = `bubble ${text ? 'is-on' : ''} ${tone}`
  bubbleEl.textContent = text
  bubbleEl.onclick = !S.screenAccess ? () => act({ type: 'open-privacy' }) : () => { view = S.cards.length ? 'cards' : view; render() }

  menu.replaceChildren(...[
    h('button', { onclick: () => { const on = !S.eyes; post({ eyes: on }); act({ type: 'eyes', on }); say(on ? '我睁眼啦，只看你允许的应用。' : '好，我闭眼，什么都不看。', 2500, 'quiet') } }, S.eyes ? '闭眼（暂停看）' : '睁眼'),
    h('div', { class: 'sep' }),
    h('button', { onclick: () => open('today') }, '在帮你盯的事'),
    h('button', { onclick: () => open('insight') }, '它看到了什么'),
    h('button', { onclick: () => open('book') }, '我的工作方式'),
    h('button', { onclick: () => open('settings') }, '设置'),
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
  const title = typeof view === 'object' ? view.doc.split('/').pop() : { cards: '任务与建议', insight: '它看到了什么', book: '我的工作方式', today: '在帮你盯的事', settings: '设置' }[view]
  return h('div', { class: 'head' },
    typeof view === 'object' ? h('button', { class: 'back', onclick: () => { view = 'cards'; render() } }, '‹') : null,
    h('b', {}, title),
    h('button', { class: 'x', onclick: () => { view = null; render() } }, '×'))
}

function body() {
  if (typeof view === 'object') return docView(view.doc)
  if (view === 'insight') return insightView()
  if (view === 'book') return bookView()
  if (view === 'today') return todayView()
  if (view === 'settings') return settingsView()
  return S.cards.length ? h('div', { class: 'cards' }, S.cards.map(cardView)) : h('div', { class: 'empty' }, '现在没有要找你的事。我会观察允许的应用，在值得帮忙时找你。')
}

/* ── 卡片 ── */
function cardView(c) {
  const task = c.commitmentId ? S.commitments.find(t => t.id === c.commitmentId) : null
  if (c.kind === 'task-result' || (task?.source === 'manual' && task.progress)) {
    const status = task?.status || c.status
    const complete = ['completed', 'done'].includes(status)
    return h('div', { class: 'card' },
      h('div', { class: 'card-top' }, h('span', { class: 'kind' }, complete ? '已完成' : STATUS[status] || '任务结果'), closeBtn(c)),
      h('div', { class: 'title' }, c.title), h('p', {}, task?.progress || c.message),
      h('small', {}, task?.verification || c.verification || ''),
      h('div', { class: 'actions' }, (task?.resultFiles || c.files || []).map(f => h('button', { class: 'btn', onclick: () => { view = { doc: f }; render() } }, '查看结果')),
        complete ? h('button', { class: 'btn', onclick: () => act({ type: 'dismiss', cardId: c.id }) }, '收起') : ['blocked', 'failed'].includes(status) ? h('button', { class: 'btn', onclick: () => { const info = prompt('补充信息后重试'); if (info !== null) act({ type: 'task-retry', commitmentId: c.commitmentId, info }) } }, '补充 / 重试') : null))
  }
  if (c.kind === 'opportunity') return h('div', { class: 'card' },
    h('div', { class: 'card-top' }, h('span', {}, c.app), closeBtn(c)),
    h('div', { class: 'title' }, c.title), h('p', {}, c.why), h('blockquote', {}, c.quote || ''),
    c.result ? h('pre', { style: 'white-space:pre-wrap;max-height:240px;overflow:auto' }, c.result) : null,
    c.error ? h('p', {}, c.error) : null,
    c.status === 'working' ? h('p', {}, c.progress || '等待模型处理') : null,
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', disabled: c.status === 'working', onclick: () => act({ type: 'review-page', cardId: c.id }) }, c.status === 'working' ? '处理中…' : c.status === 'failed' ? '重试' : '帮我准备'),
      h('button', { class: 'btn', onclick: () => act({ type: 'plan-page', cardId: c.id }) }, '规划操作'),
      c.plan ? h('div', {}, h('pre', {}, JSON.stringify(c.plan.step, null, 2)), h('p', {}, c.plan.why), h('button', { class: 'btn', disabled: c.execution === 'running' || c.execution === 'verified', onclick: () => act({ type: 'execute-page', cardId: c.id }) }, '确认执行这一步')) : null,
      c.executionMessage ? h('p', {}, c.executionMessage) : null))
  if (c.kind === 'consent') {
    const nameInput = c.needName ? h('input', { class: 'scope', placeholder: `你在 ${c.app} 里显示的名字（用来认出哪句是你说的）`, onfocus: () => { editing = { consent: c.id }; post({ focus: true }) }, onblur: () => { editing = null } }) : null
    const yes = () => { act({ type: 'app-consent', app: c.app, choice: 'on', myName: nameInput?.value ?? '' }); editing = null; say(`好，我开始看${c.app}了。`, 2500, 'quiet') }
    return h('div', { class: 'card card-consent' },
    h('div', { class: 'card-top' }, h('span', { class: 'kind' }, '第一次见到'), h('span', {}, c.at)),
    h('div', { class: 'title' }, c.title),
    h('ul', { class: 'consent' },
      h('li', {}, '只在应用位于前台时观察页面变化；文字识别在本机完成'),
      h('li', {}, '发现值得帮忙的变化时给出建议；识别文字会交给模型判断，操作另行确认'),
      h('li', {}, '随时可以在「设置」里关掉，或对某个会话说「不看」')),
    nameInput,
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: yes }, '看'),
      h('button', { class: 'btn', onclick: () => { editing = null; act({ type: 'app-consent', app: c.app, choice: 'off' }) } }, '不看'),
      h('button', { class: 'btn', onclick: () => { editing = null; act({ type: 'app-consent', app: c.app, choice: 'later' }) } }, '先不说')))
  }
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
  const kind = c.source === 'manual' ? ({ ready: '任务 · 已备好', missing: '任务 · 需要信息', copied: '结果已复制', confirm: '确认完成' }[c.phase]) : { ready: '承诺 · 已备好', missing: '承诺 · 还差一点', copied: '等你发出', confirm: '是这条吗' }[c.phase]
  return h('div', { class: `card card-commitment phase-${c.phase}` },
    h('div', { class: 'card-top' }, h('span', { class: 'kind' }, kind), h('span', {}, c.at), closeBtn(c)),
    h('div', { class: 'title' }, c.title),
    c.phase === 'confirm' ? h('div', { class: 'msg' }, h('small', {}, '你刚发的'), c.confirmQuote) : h('div', { class: 'why' }, c.why),
    c.phase === 'copied' ? h('div', { class: 'hint' }, c.app ? `去${c.app}里和「${c.conv}」的聊天粘贴发送。发出去我会自动划掉。` : '结果已复制，处理后可标记完成。') : null,
    c.message && c.phase !== 'confirm' ? h('div', { class: 'msg' }, h('small', {}, c.source === 'manual' ? '处理结果' : '回复草稿'), c.message) : null,
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
      h('button', { class: 'btn primary', onclick: () => act({ type: 'sent', commitmentId: id }) }, c.source === 'manual' ? '已完成 ✓' : '发了 ✓'),
      h('button', { class: 'btn', onclick: () => act({ type: 'copy', commitmentId: id }) }, '再复制一次')]
    case 'missing': return [
      h('button', { class: 'btn primary', onclick: edit('supply') }, '补上信息'),
      h('button', { class: 'btn', onclick: () => act({ type: 'drop', commitmentId: id }) }, '不用了')]
    default: return [
      h('button', { class: 'btn primary', onclick: () => { act({ type: 'copy', commitmentId: id }); say(c.app ? `复制好了，去${c.app}里和「${c.conv}」的聊天粘贴。` : '复制好了。', 3500, 'quiet') } }, c.app ? `复制并打开${c.app}` : '复制'),
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
const STATUS = { queued: '排队中', running: '正在执行', completed: '已完成', blocked: '已阻塞', failed: '执行失败', open: '未开始：缺少数据或执行能力', drafting: '正在处理', ready: '结果已备好', copied: '结果已复制', sent: '已发', done: '已完成', dropped: '不用了' }

/* ── 其他视图 ── */
const VERDICT = { ignore: ['忽略', 'v-ignore'], suspect: ['怀疑', 'v-suspect'], remember: ['记下', 'v-remember'], draft: ['起草', 'v-draft'], done: ['完成', 'v-done'], act: ['处理', 'v-draft'], private: ['没看', 'v-private'], speak: ['开口', 'v-speak'], learn: ['学到', 'v-learn'], error: ['出错', 'v-error'] }
function insightView() {
  const n = v => S.insight.filter(e => e.verdict === v).length
  return h('div', { class: 'scroll' },
    h('p', { class: 'intro' }, '只观察你允许的应用。页面文字发生变化后，判断是否值得帮助；有价值时提出建议。观察、准备结果和执行操作分别记录，操作遵守你设置的权限。'),
    h('div', { class: 'stats' }, [['页面变化', S.observedChanges ?? 0], ['忽略', n('ignore')], ['记下', n('remember')], ['起草', n('draft')], ['开口', n('speak')]].map(([l, v]) => h('div', {}, h('b', {}, v), h('small', {}, l)))),
    h('label', { class: 'tech' }, h('input', { type: 'checkbox', checked: showTech || null, onchange: e => { showTech = e.target.checked; localStorage.setItem('shiyi.tech', showTech ? '1' : '0'); render() } }), '显示技术细节（哪一层判断、用了哪个模型、花了多久）'),
    h('ol', { class: 'ins' }, [...S.insight].reverse().map(e => {
      const [label, cls] = VERDICT[e.verdict] ?? [e.verdict, '']
      return h('li', {}, h('div', { class: 'ins-top' }, h('span', { class: `verdict ${cls}` }, label), h('span', { class: 'src' }, e.src), h('span', { class: 'at' }, e.at)),
        h('div', {}, e.text), showTech && e.layer ? h('div', { class: 'cost' }, e.layer + (e.cost ? ' · ' + e.cost : '')) : null)
    })))
}
/* 我的工作方式：规则可以改、可以加、停用后可以重新启用 */
function bookView() {
  const on = S.rules.filter(r => r.enabled !== false), off = S.rules.filter(r => r.enabled === false)
  const ruleRow = r => editing?.rule === r.id ? ruleEditor(r) : h('li', { class: r.enabled === false ? 'is-off' : '' },
    h('b', {}, r.text),
    h('small', {}, `${r.scope ? '只用在：' + r.scope + ' · ' : '所有场合 · '}${r.learnedFrom === '你手动加的' ? '你手动加的' : '学自 ' + r.learnedFrom}${r.editedAt ? ' · 你改过' : ''}`),
    h('span', { class: 'row-actions' },
      h('button', { class: 'link', onclick: () => { editing = { rule: r.id }; render() } }, '改'),
      r.enabled === false
        ? [h('button', { class: 'link', onclick: () => act({ type: 'rule-toggle', id: r.id, enabled: true }) }, '重新启用'),
           h('button', { class: 'link danger', onclick: () => act({ type: 'rule-delete', id: r.id }) }, '删除')]
        : h('button', { class: 'link', onclick: () => act({ type: 'rule-toggle', id: r.id, enabled: false }) }, '停用')))
  return h('div', { class: 'scroll' },
    h('p', { class: 'intro' }, '这里是我写东西前会先读的规则：有我从你的「改一下」里学来的，也可以你直接写。改完下次起草就生效。'),
    editing?.rule === 'new' ? ruleEditor(null) : h('button', { class: 'btn add', onclick: () => { editing = { rule: 'new' }; render() } }, '＋ 加一条规则'),
    on.length ? h('ol', { class: 'rules' }, on.map(ruleRow)) : editing?.rule === 'new' ? null : h('div', { class: 'empty' }, '还没有规则。你可以直接写一条，比如「给客户的消息都带上称呼」。'),
    off.length ? h('details', { class: 'off-rules' }, h('summary', {}, `已停用 ${off.length} 条`), h('ol', { class: 'rules' }, off.map(ruleRow))) : null,
    h('p', { class: 'path' }, `规则以这里为准，会同步写进 ${S.home}/workspace/AGENTS.md；直接改那个文件会被覆盖。`))
}

function ruleEditor(r) {
  const text = h('textarea', { class: 'reason', placeholder: '规则，用一句话写清楚要怎么做，比如：给客户的消息都带上称呼' })
  const scope = h('input', { class: 'scope', placeholder: '只用在什么场合（可不填，不填就是所有场合）' })
  text.value = r?.text ?? ''; scope.value = r?.scope ?? ''
  setTimeout(() => text.focus(), 30); post({ focus: true })
  const save = () => {
    if (!text.value.trim()) return
    act(r ? { type: 'rule-edit', id: r.id, text: text.value, scope: scope.value } : { type: 'rule-add', text: text.value, scope: scope.value })
    editing = null
  }
  return h('div', { class: 'revise rule-edit' }, text, scope, h('div', { class: 'actions' },
    h('button', { class: 'btn primary', onclick: save }, r ? '保存' : '加上'),
    h('button', { class: 'btn', onclick: () => { editing = null; render() } }, '取消')))
}

/* 在帮你盯的事：以「要做什么」为主，按时间分组；来源只是一个小标签，原话折叠 */
function todayView() {
  const suggestions = S.cards.filter(c => c.kind === 'opportunity')
  const all = S.commitments.filter(c => c.status !== 'dropped')
  const day = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime() }
  const today = day(Date.now()), tomorrow = today + 86400_000
  const groupOf = c => c.status === 'done' ? 'done' : !c.due ? 'none' : day(c.due) <= today ? 'today' : day(c.due) === tomorrow ? 'tomorrow' : 'later'
  const GROUPS = [['today', '今天'], ['tomorrow', '明天'], ['later', '之后'], ['none', '没定时间'], ['done', '已完成']]
  const item = c => h('li', { class: c.status === 'done' ? 'is-done' : '' },
    h('button', { class: 'dot', title: c.status === 'done' ? '已完成' : '标记完成', onclick: () => c.status !== 'done' && act({ type: 'task-done', commitmentId: c.id }) }, c.status === 'done' ? '✓' : ''),
    h('span', {},
      h('b', {}, c.todo || c.what),
      h('small', {}, [c.to && c.source !== 'manual' ? `给${c.to}` : '', c.dueText, (c.progress || STATUS[c.status]) + (c.doneAt ? ' ' + c.doneAt : '')].filter(Boolean).join(' · ')),
      h('details', { class: 'src-detail' },
        h('summary', {}, h('span', { class: `src-tag ${c.source === 'manual' ? 'manual' : 'wechat'}` }, c.source === 'manual' ? '你交办的' : `${c.app || '来源应用'} · ${short(c.conv)}`)),
        h('small', { class: 'quote' }, c.source === 'manual' ? `「${c.quote}」` : c.request ? `${c.conv}：「${c.request}」→ 你：「${c.quote}」` : `你：「${c.quote}」`))),
    c.source === 'manual' ? h('div', {}, (c.resultFiles || []).map(f => h('button', { class: 'link', onclick: () => { view = { doc: f }; render() } }, '查看结果')), ['blocked', 'failed', 'open'].includes(c.status) ? h('button', { class: 'link', onclick: () => { const info = prompt('补充信息后重试（可留空）'); if (info !== null) act({ type: 'task-retry', commitmentId: c.id, info }) } }, '补充 / 重试') : null) : ['ready', 'copied'].includes(c.status) ? h('button', { class: 'link', onclick: () => { act({ type: 'open-card', commitmentId: c.id }); view = 'cards' } }, '看草稿') : null)
  const sections = GROUPS.map(([g, label]) => {
    const list = all.filter(c => groupOf(c) === g).reverse()
    if (!list.length) return null
    const body = h('ul', { class: 'wrap' }, list.map(item))
    return g === 'done' ? h('details', { class: 'group' }, h('summary', {}, `${label} ${list.length}`), body) : h('section', { class: 'group' }, h('h4', {}, `${label} ${list.length}`), body)
  }).filter(Boolean)
  return h('div', { class: 'scroll' },
    editing?.task ? taskEditor() : h('button', { class: 'btn add', onclick: () => { editing = { task: true }; render() } }, '＋ 交给拾遗一件事'),
    suggestions.length ? h('section', { class: 'group' }, h('h4', {}, '发现的建议'), suggestions.map(cardView)) : null,
    sections.length ? sections : suggestions.length ? null : h('div', { class: 'empty' }, '还没有待办任务或建议。允许观察不等于已有任务；发现值得帮助的变化时会出现在这里。'),
    null)
}

function taskEditor() {
  const text = h('textarea', { class: 'reason', placeholder: '比如：总结当前页面 / 核对这份文档的数据 / 帮我准备操作方案' })
  setTimeout(() => text.focus(), 30); post({ focus: true })
  const save = () => { if (!text.value.trim()) return; act({ type: 'add-task', text: text.value }); editing = null; say('收到，我来盯着。', 2500, 'quiet') }
  text.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() })
  return h('div', { class: 'revise' }, text, h('div', { class: 'actions' },
    h('button', { class: 'btn primary', onclick: save }, '交给你'),
    h('button', { class: 'btn', onclick: () => { editing = null; render() } }, '取消')))
}

/* 设置：能看什么 / 怎么看 / 什么时候开口 / 起草能用什么 / 数据 */
function settingsView() {
  const st = S.settings
  const set = patch => act({ type: 'settings', patch })
  const row = (label, hint, control) => h('div', { class: 'set-row' }, h('div', {}, h('b', {}, label), hint ? h('small', {}, hint) : null), control)
  const appRow = a => row(a.name, a.state === 'on' ? '在看：观察页面变化，提出建议' : a.state === 'off' ? '你说过不看，不会再问' : '还没问过你，第一次打开时会问',
    h('div', { class: 'seg' }, [['on', '看'], ['off', '不看']].map(([v, l]) => h('button', { class: a.state === v ? 'is-on' : '', onclick: () => act({ type: 'app-set', app: a.name, value: v }) }, l)), h('select', { onchange: e => { const v = e.target.value; const targets = v === 'auto' ? prompt('允许自动填写的控件名称（多个用顿号分隔）；其他操作仍需确认', a.autoTargets.join('、')) : ''; if (targets !== null) act({ type: 'operation-permission', app: a.name, value: v, targets }) } }, [['off','只观察'],['ask','操作前确认'],['auto','指定控件自动填写']].map(([v,label]) => h('option', { value: v, selected: a.operation === v }, label)))))
  const pauseText = S.paused ? `已暂停到 ${new Date(S.pauseUntil).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '没暂停'
  const matInput = h('input', { class: 'scope', placeholder: '加一个文件夹，比如 ~/Projects', onfocus: () => { editing = { settings: true } }, onblur: () => { editing = null } })
  const addMat = () => { const v = matInput.value.trim(); if (!v) return; editing = null; set({ materials: [...st.materials, v] }) }
  matInput.addEventListener('keydown', e => { if (e.key === 'Enter') addMat() })
  let clearArmed = false
  const clearBtn = h('button', { class: 'btn', onclick: e => {
    if (!clearArmed) { clearArmed = true; e.target.textContent = '再点一次确认清空'; e.target.classList.add('danger'); return }
    act({ type: 'clear-transcripts' }); say('存下的聊天记录都清掉了。', 2500, 'quiet')
  } }, '清空聊天记录')
  return h('div', { class: 'scroll settings' },
    h('h4', {}, '能看什么'),
    h('p', { class: 'intro' }, '这里只显示拾遗实际发现过的应用。首次切换到一个新应用时，会询问是否观察；允许后才读取页面变化。观察和操作分别授权。'),
    h('div', { class: 'app-list' }, S.apps.length ? S.apps.map(appRow) : h('p', { class: 'intro' }, '还没有发现应用。请在桌面切换到你想让拾遗观察的应用，原生桌宠会询问你。')),
    row('你的名字', 'Slack、Discord、Teams 这类应用靠名字认出哪句是你说的；多个名字用逗号分开',
      h('input', { class: 'scope name-input', value: st.myNames.join('，'), placeholder: '比如：林夏, Lin Xia', onfocus: () => { editing = { settings: true } },
        onblur: e => { editing = null; set({ myNames: e.target.value.split(/[,，]/) }) }, onkeydown: e => { if (e.key === 'Enter') e.target.blur() } })),
    S.ignoreConvs.length ? row('不看的会话', '在已允许的应用里也跳过', h('div', { class: 'chips' }, S.ignoreConvs.map(cv => h('span', { class: 'chip' }, cv, ' ', h('button', { class: 'link', onclick: () => act({ type: 'unignore-conv', conv: cv }) }, '恢复'))))) : null,

    h('h4', {}, '怎么看'),
    row('截图间隔', '越短发现得越快，但更耗电。识别都在本机，不花 token；画面没变会跳过',
      h('select', { onchange: e => set({ captureIntervalSec: Number(e.target.value) }) }, [1, 2, 2.5, 3, 5, 10].map(v => h('option', { value: v, selected: v === st.captureIntervalSec || null }, `${v} 秒`)))),
    row('暂停', pauseText, h('div', { class: 'seg' },
      S.paused ? h('button', { onclick: () => act({ type: 'pause', off: true }) }, '取消暂停')
        : [h('button', { onclick: () => act({ type: 'pause', minutes: 60 }) }, '1 小时'), h('button', { onclick: () => act({ type: 'pause', until: 'morning' }) }, '到明早')])),

    h('h4', {}, '什么时候开口'),
    row('早上开口时间', '截止在之后的事，当天这个时间才找你', h('input', { type: 'time', value: st.morningAt, onchange: e => set({ morningAt: e.target.value }) })),
    row('下班收尾时间', '每天这个时间列出今天在盯的事', h('input', { type: 'time', value: st.wrapUpAt, onchange: e => set({ wrapUpAt: e.target.value }) })),
    row('每小时最多主动开口', '你主动点开的不算', h('select', { onchange: e => set({ speakBudgetPerHour: Number(e.target.value) }) }, [2, 4, 6, 10, 20].map(v => h('option', { value: v, selected: v === st.speakBudgetPerHour || null }, `${v} 次`)))),

    h('h4', {}, '起草时能用什么'),
    row('材料文件夹', '要交文档时，拾遗只读地在这些地方找材料', null),
    h('div', { class: 'mats' }, st.materials.map(m => h('span', { class: 'chip' }, m, ' ', h('button', { class: 'link', onclick: () => set({ materials: st.materials.filter(x => x !== m) }) }, '移除'))),
      h('span', { class: 'mat-add' }, matInput, h('button', { class: 'btn', onclick: addMat }, '加上'))),

    h('h4', {}, '数据'),
    row('聊天记录', `只存在你电脑上：${S.home}`, h('div', { class: 'seg' }, h('button', { onclick: () => act({ type: 'open-data' }) }, '打开文件夹'), clearBtn)))
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
