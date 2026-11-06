// 桌宠「拾遗」：形象与状态、气泡、建议卡、「它的视角」抽屉、语音。
import { h, icon, sleep } from './util.js'
import { state, on, emit } from './store.js'
import { anyPrivateOpen } from './wm.js'
import { openFile } from './apps.js'

let root, petEl, bubbleEl, stackEl, drawerEl
let mode = 'idle'   // idle | watch | think | call | work

const PET_SVG = `
<svg viewBox="0 0 120 110" class="pet-svg" aria-hidden="true">
  <ellipse class="pet-shadow" cx="60" cy="104" rx="34" ry="5"/>
  <g class="pet-bodyg">
    <path class="pet-body" d="M60 14c26 0 44 20 44 46 0 26-17 40-44 40S16 86 16 60c0-26 18-46 44-46z"/>
    <path class="pet-leaf" d="M60 15c-2-8 3-13 10-13-1 7-4 11-10 13z"/>
    <ellipse class="pet-cheek" cx="34" cy="70" rx="7" ry="4"/>
    <ellipse class="pet-cheek" cx="86" cy="70" rx="7" ry="4"/>
    <g class="pet-eyes">
      <g class="pet-eye" transform="translate(44 56)"><ellipse class="pet-pupil" rx="6" ry="8"/><circle class="pet-glint" cx="2" cy="-3" r="2"/></g>
      <g class="pet-eye" transform="translate(76 56)"><ellipse class="pet-pupil" rx="6" ry="8"/><circle class="pet-glint" cx="2" cy="-3" r="2"/></g>
    </g>
    <g class="pet-closed"><path d="M37 58q7 5 14 0M69 58q7 5 14 0"/></g>
    <path class="pet-mouth" d="M55 76q5 4 10 0"/>
    <g class="pet-dots"><circle cx="96" cy="22" r="3"/><circle cx="106" cy="14" r="3"/><circle cx="114" cy="5" r="3"/></g>
  </g>
</svg>`

export function initPet(container) {
  root = container
  stackEl = h('div', { class: 'card-stack' })
  bubbleEl = h('div', { class: 'pet-bubble', onclick: () => { bubbleEl.classList.remove('is-on'); stackEl.classList.add('is-open') } })
  const menu = h('div', { class: 'pet-menu' },
    h('button', { onclick: toggleEyes, title: '眼睛开关' }, icon('eye'), h('span', { class: 'pet-menu-eyes' }, '闭眼')),
    h('button', { onclick: () => toggleDrawer(), title: '它的视角' }, '它看到了什么'))
  petEl = h('div', { class: 'pet is-idle', onclick: () => stackEl.classList.toggle('is-open') }, h('div', { class: 'pet-figure', html: PET_SVG }), h('div', { class: 'pet-badge' }))
  drawerEl = h('aside', { class: 'drawer' })
  root.append(stackEl, h('div', { class: 'pet-wrap' }, bubbleEl, petEl, menu), drawerEl)
  addEventListener('mousemove', followCursor)
  on('windows', syncEyes)
  on('eyes', syncEyes)
  on('insight', renderDrawer)
  renderDrawer()
  blinkLoop()
}

/* ── 状态 ── */
export function setMode(m) {
  mode = m
  petEl.className = `pet is-${m}`
  syncEyes()
}
export const eyesClosed = () => !state.eyesOn || anyPrivateOpen()
function syncEyes() {
  const closed = eyesClosed()
  petEl.classList.toggle('is-closed', closed)
  document.querySelector('.pet-menu-eyes').textContent = state.eyesOn ? '闭眼' : '睁眼'
  emit('eyes-state', closed)
}
function toggleEyes(e) {
  e?.stopPropagation()
  state.eyesOn = !state.eyesOn
  emit('eyes')
  say(state.eyesOn ? '我睁眼啦。' : '好，我先闭眼，什么都不看。', 2200)
}
function followCursor(e) {
  if (!petEl || eyesClosed()) return
  const r = petEl.getBoundingClientRect()
  const dx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / 400))
  const dy = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / 400))
  petEl.style.setProperty('--lx', (dx * 4).toFixed(2) + 'px')
  petEl.style.setProperty('--ly', (dy * 3).toFixed(2) + 'px')
}
async function blinkLoop() {
  for (;;) {
    await sleep(2800 + Math.random() * 3000)
    petEl.classList.add('is-blink'); await sleep(140); petEl.classList.remove('is-blink')
  }
}

/** 点头：记下了但不打扰。 */
export async function nod(text) {
  petEl.classList.add('is-nod')
  if (text) say(text, 2600, 'quiet')
  await sleep(700)
  petEl.classList.remove('is-nod')
}

/* ── 气泡 ── */
let bubbleTimer
export function say(text, ms = 0, tone = '') {
  clearTimeout(bubbleTimer)
  bubbleEl.className = `pet-bubble is-on ${tone}`
  bubbleEl.textContent = text
  if (ms) bubbleTimer = setTimeout(() => bubbleEl.classList.remove('is-on'), ms)
}
export const hush = () => bubbleEl.classList.remove('is-on')

/* ── 建议卡 ── */
/**
 * @param {{id:string, kind:string, title:string, why?:string, evidence?:{label:string,path:string,line:number}[], body?:HTMLElement, actions?:{label:string, primary?:boolean, onClick:()=>void}[], bubble?:string}} c
 */
export function card(c) {
  dismiss(c.id)
  const el = h('div', { class: `card card-${c.kind}`, dataset: { id: c.id } },
    h('div', { class: 'card-head' }, h('span', { class: 'card-kind' }, c.kindLabel ?? KIND[c.kind] ?? c.kind), h('span', { class: 'card-at' }, state.clock),
      h('button', { class: 'card-x', title: '先放着', onclick: () => dismiss(c.id) }, icon('close'))),
    h('div', { class: 'card-title' }, c.title),
    c.why ? h('div', { class: 'card-why' }, h('b', {}, '为什么找你　'), c.why) : null,
    c.evidence?.length ? h('div', { class: 'card-ev' }, c.evidence.map(ev => h('button', { class: 'chip', onclick: () => openFile(ev.path, ev.line, ev.end ?? ev.line) }, ev.label))) : null,
    c.body ?? null,
    c.actions?.length ? h('div', { class: 'card-actions' }, c.actions.map(a => h('button', { class: `btn${a.primary ? ' btn-primary' : ''}`, onclick: a.onClick }, a.label))) : null)
  stackEl.prepend(el)
  stackEl.classList.add('is-open')
  el.animate([{ opacity: 0, transform: 'translateY(10px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' })
  petEl.querySelector('.pet-badge').textContent = stackEl.children.length || ''
  if (c.bubble) say(c.bubble, 0, 'call')
  setMode('call')
  emit('opened-mouth', c)
  return el
}
const KIND = { commitment: '承诺 · 已备好', learn: '想记住一条', fix: '对不上', chain: '连锁处理', wrap: '下班收尾', done: '完成' }

export function dismiss(id) {
  stackEl.querySelector(`[data-id="${id}"]`)?.remove()
  petEl.querySelector('.pet-badge').textContent = stackEl.children.length || ''
  if (!stackEl.children.length) { hush(); if (mode === 'call') setMode('idle') }
}
export const clearCards = () => { stackEl.replaceChildren(); petEl.querySelector('.pet-badge').textContent = ''; hush() }

/* ── 它的视角 ── */
const VERDICT = { ignore: ['忽略', 'v-ignore'], remember: ['记下', 'v-remember'], act: ['出手', 'v-act'], private: ['没看', 'v-private'], speak: ['开口', 'v-speak'], learn: ['学到', 'v-learn'] }

/** @param {{src:string, text:string, verdict:keyof VERDICT, layer?:string, cost?:string}} e */
export function insight(e) {
  state.insight.push({ at: state.clock, ...e })
  emit('insight')
}
export function toggleDrawer(force) {
  const open = drawerEl.classList.toggle('is-open', force)
  root.classList.toggle('is-drawer-open', open)
}

function renderDrawer() {
  const list = state.insight
  const count = v => list.filter(e => e.verdict === v).length
  drawerEl.replaceChildren(
    h('div', { class: 'drawer-head' }, h('b', {}, '它看到了什么'), h('button', { class: 'card-x', onclick: () => toggleDrawer(false) }, icon('close'))),
    h('p', { class: 'drawer-intro' }, '每个动静先过规则（不花钱），可疑的再交给轻量模型判断，真值得做才叫醒主 agent。大多数时候它选择闭嘴。'),
    h('div', { class: 'drawer-stats' },
      stat(list.length, '看到'), stat(count('ignore'), '忽略'), stat(count('remember'), '记下'), stat(count('act'), '出手'), stat(count('speak'), '开口')),
    h('ol', { class: 'drawer-list' }, [...list].reverse().map(e => {
      const [label, cls] = VERDICT[e.verdict] ?? [e.verdict, '']
      return h('li', { class: 'ins' },
        h('div', { class: 'ins-top' }, h('span', { class: `verdict ${cls}` }, label), h('span', { class: 'ins-src' }, e.src), h('span', { class: 'ins-at' }, e.at)),
        h('div', { class: 'ins-text' }, e.text),
        e.layer ? h('div', { class: 'ins-cost' }, `${e.layer}${e.cost ? ' · ' + e.cost : ''}`) : null)
    })))
}
const stat = (n, l) => h('div', { class: 'stat' }, h('b', {}, n), h('small', {}, l))

/* ── 语音 ── */
export function speak(text) {
  return new Promise(res => {
    if (!('speechSynthesis' in window)) return res()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'zh-CN'; u.rate = 1.08
    u.onend = res; u.onerror = res
    speechSynthesis.cancel(); speechSynthesis.speak(u)
    setTimeout(res, 400 + text.length * 260)   // 有的环境不触发 onend
  })
}
export const canListen = () => 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window
export function listen(ms = 6000) {
  return new Promise(res => {
    const R = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!R) return res(null)
    const r = new R()
    r.lang = 'zh-CN'; r.interimResults = false; r.maxAlternatives = 1
    let done = false
    const finish = v => { if (!done) { done = true; try { r.stop() } catch { /* 已停 */ } res(v) } }
    r.onresult = e => finish(e.results[0][0].transcript)
    r.onerror = () => finish(null)
    r.onend = () => finish(null)
    r.start()
    setTimeout(() => finish(null), ms)
  })
}
