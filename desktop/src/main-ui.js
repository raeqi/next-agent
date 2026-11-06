// 桌面外壳：菜单栏、Dock、通知、耳机模式、演示时间线。
import { h, icon } from './util.js'
import { state, on } from './store.js'
import { openChat, openDoc, openSheet, openCalendar, openBank, openHandbook } from './apps.js'
import { toggleDrawer } from './pet.js'

let toasts, awayEl

export function buildShell(app) {
  const clock = h('span', { class: 'mb-clock' })
  const eyes = h('button', { class: 'mb-eyes', onclick: () => toggleDrawer(true), title: '拾遗看到了什么' })
  on('clock', () => { clock.textContent = `${state.date}  ${state.clock}` })
  on('eyes-state', closed => {
    eyes.replaceChildren(icon(closed ? 'eyeOff' : 'eye'), closed ? (state.eyesOn ? '私密窗口 · 拾遗没在看' : '拾遗闭眼中') : '拾遗在看')
    eyes.classList.toggle('is-closed', closed)
  })
  const menubar = h('header', { class: 'menubar' },
    h('span', { class: 'mb-logo' }, '拾遗'), h('span', { class: 'mb-item' }, '林夏的电脑'), h('span', { class: 'mb-spacer' }),
    eyes, clock)

  const dockItem = (name, label, fn, badge) => h('button', { class: 'dock-item', title: label, onclick: fn }, icon(name, 'dock-ico'), h('span', { class: 'dock-label' }, label), badge ?? null)
  const bookBadge = h('span', { class: 'dock-badge' })
  on('rules', () => { bookBadge.textContent = state.rules.length || ''; bookBadge.animate([{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }], 300) })
  const dock = h('nav', { class: 'dock' },
    dockItem('chat', '消息', () => openChat()),
    dockItem('doc', '周报', () => openDoc('周报')),
    dockItem('sheet', '表格', () => openSheet()),
    dockItem('cal', '日历', () => openCalendar()),
    dockItem('bank', '网银', () => openBank()),
    h('span', { class: 'dock-sep' }),
    dockItem('book', '我的工作方式', () => openHandbook(), bookBadge))

  toasts = h('div', { class: 'toasts' })
  awayEl = h('div', { class: 'away' },
    h('div', { class: 'away-card' },
      h('div', { class: 'away-head' }, h('span', { class: 'away-buds' }, '🎧'), h('div', {}, h('b', {}, '耳机里的拾遗'), h('small', {}, '林夏在去机场的路上 · 电脑已合上'))),
      h('div', { class: 'away-wave' }, Array.from({ length: 24 }, (_, i) => h('i', { style: { animationDelay: `${(i % 8) * 80}ms` } }))),
      h('div', { class: 'away-log' }),
      h('div', { class: 'away-ctl' })))
  app.append(menubar, dock, toasts, awayEl)
}

export function toast({ icon: ic, title, text, ms = 6000 }) {
  const el = h('div', { class: 'toast' }, ic ? icon(ic, 'toast-ico') : null, h('div', {}, h('b', {}, title), h('small', {}, text)))
  toasts.append(el)
  el.animate([{ opacity: 0, transform: 'translateX(20px)' }, { opacity: 1, transform: 'none' }], { duration: 220 })
  setTimeout(() => el.remove(), ms)
}

export function setAway(on_) {
  state.away = on_
  document.body.classList.toggle('is-away', on_)
  if (on_) { awayEl.querySelector('.away-log').replaceChildren(); awayEl.querySelector('.away-ctl').replaceChildren() }
  else if ('speechSynthesis' in window) speechSynthesis.cancel()
  return awayEl
}
