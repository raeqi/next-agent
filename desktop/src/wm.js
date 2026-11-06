// 窗口管理：打开/聚焦/关闭/拖动。私密窗口会通知桌宠闭眼。
import { h, icon } from './util.js'
import { emit } from './store.js'

const wins = new Map()   // id → {el, body, meta}
let z = 10
let layer

export function initWM(root) { layer = root }

/**
 * @param {string} id
 * @param {{title:string, app:string, x:number, y:number, w:number, h:number, private?:boolean, render:(body:HTMLElement)=>void, toolbar?:HTMLElement}} meta
 */
export function openWindow(id, meta) {
  let w = wins.get(id)
  if (w) {
    w.meta = { ...w.meta, ...meta }
    meta.render?.(w.body)
    focus(id)
    return w.body
  }
  const body = h('div', { class: 'win-body' })
  const title = h('div', { class: 'win-title' }, meta.title)
  const bar = h('div', { class: 'win-bar' },
    h('div', { class: 'win-lights' },
      h('button', { class: 'light light-close', title: '关闭', onclick: e => { e.stopPropagation(); closeWindow(id) } }),
      h('span', { class: 'light light-min' }), h('span', { class: 'light light-max' })),
    title,
    meta.private ? h('span', { class: 'win-private' }, '私密 · 拾遗不看') : h('span'))
  const el = h('section', {
    class: `win app-${meta.app}${meta.private ? ' is-private' : ''}`,
    style: { left: meta.x + 'px', top: meta.y + 'px', width: meta.w + 'px', height: meta.h + 'px' },
    onmousedown: () => focus(id),
  }, bar, body)
  drag(el, bar)
  layer.append(el)
  w = { el, body, title, meta }
  wins.set(id, w)
  meta.render?.(body)
  focus(id)
  el.animate([{ opacity: 0, transform: 'scale(.97) translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' })
  emit('windows')
  return body
}

export function setTitle(id, text) { const w = wins.get(id); if (w) w.title.textContent = text }

export function closeWindow(id) {
  const w = wins.get(id)
  if (!w) return
  wins.delete(id)
  w.el.remove()
  emit('windows')
}

export function focus(id) {
  const w = wins.get(id)
  if (!w) return
  w.el.style.zIndex = ++z
  for (const [k, o] of wins) o.el.classList.toggle('is-focused', k === id)
  emit('focus', { id, meta: w.meta })
}

export const isOpen = id => wins.has(id)
export const bodyOf = id => wins.get(id)?.body
export const anyPrivateOpen = () => [...wins.values()].some(w => w.meta.private)
export const closeAll = () => [...wins.keys()].forEach(closeWindow)

function drag(el, handle) {
  handle.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return
    const sx = e.clientX - el.offsetLeft, sy = e.clientY - el.offsetTop
    const move = ev => {
      el.style.left = Math.max(0, ev.clientX - sx) + 'px'
      el.style.top = Math.max(28, ev.clientY - sy) + 'px'
    }
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up) }
    addEventListener('mousemove', move)
    addEventListener('mouseup', up)
  })
}

export { icon }
