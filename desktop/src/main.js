// 入口：搭桌面、加载素材、挂演示时间线。
import { h } from './util.js'
import { state, setClock } from './store.js'
import { initWM } from './wm.js'
import { initPet } from './pet.js'
import { buildShell } from './main-ui.js'
import { loadWorld, STEPS } from './scenario.js'

const app = document.getElementById('app')
const desk = h('main', { class: 'desk' })
const petLayer = h('div', { class: 'pet-layer' })
app.append(desk, petLayer)
buildShell(app)
initWM(desk)
initPet(petLayer)

let cur = -1
let busy = false
const dots = h('div', { class: 'tl-dots' })
const label = h('div', { class: 'tl-label' })
const nextBtn = h('button', { class: 'btn btn-primary tl-next', onclick: () => next() }, '开始 →')
const timeline = h('div', { class: 'timeline' },
  h('div', { class: 'tl-top' }, h('span', { class: 'tl-tag' }, '演示 · 林夏的一天'), dots,
    h('button', { class: 'link tl-restart', onclick: () => location.reload(), title: '重新开始' }, '重来')),
  label, nextBtn)
app.append(timeline)

function renderTimeline() {
  dots.replaceChildren(...STEPS.map((s, i) => h('span', { class: `tl-dot${i < cur ? ' is-done' : ''}${i === cur ? ' is-cur' : ''}`, title: `${s.clock} ${s.title}` })))
  const s = STEPS[cur]
  label.replaceChildren(s
    ? h('div', {}, h('b', {}, `${cur + 1}/${STEPS.length} · ${s.clock} ${s.title}`), h('p', {}, s.desc))
    : h('div', {}, h('b', {}, '拾遗：一个不用吩咐的个人 Agent'), h('p', {}, '按 → 或点按钮，一幕一幕往下走。每一幕里都可以自己点。')))
  nextBtn.textContent = cur >= STEPS.length - 1 ? '已到最后一幕' : cur < 0 ? '开始 →' : '下一幕 →'
  nextBtn.disabled = busy || cur >= STEPS.length - 1
}

async function next() {
  if (busy || cur >= STEPS.length - 1) return
  cur++
  busy = true; renderTimeline()
  const s = STEPS[cur]
  setClock(s.date, s.clock)
  try { await s.enter() } catch (e) { console.error(e) }
  busy = false; renderTimeline()
}

addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' && !e.target.closest('input,textarea')) next()
})

setClock(state.date, state.clock)
await loadWorld()
renderTimeline()
globalThis.__SHIYI__ = { state, next, STEPS }
