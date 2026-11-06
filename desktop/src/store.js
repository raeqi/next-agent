// 全局状态 + 事件总线。M2 起 live 数据源也通过同一套事件驱动界面。

export const state = {
  date: '11月5日 周四',
  clock: '17:40',
  eyesOn: true,          // 用户手动开关
  away: false,           // 离开电脑（耳机模式）
  files: {},             // path → text（来自 workspace-seed）
  chats: {},             // conv → [{at, from, text, me?, attach?}]
  docs: {},              // key → {title, text, shadow?, path?, revisions:[], sentTo?}
  rules: [],             // 手册：{id, text, learnedFrom, at}
  commitments: [],       // {id, to, what, due, status, source}
  insight: [],           // 它的视角：{at, src, text, verdict, layer, cost}
  sent: [],
}

const listeners = new Map()
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set())
  listeners.get(evt).add(fn)
  return () => listeners.get(evt).delete(fn)
}
export function emit(evt, data) {
  for (const fn of listeners.get(evt) ?? []) fn(data)
  for (const fn of listeners.get('*') ?? []) fn(evt, data)
}
export function setClock(date, clock) {
  if (date) state.date = date
  state.clock = clock
  emit('clock')
}
