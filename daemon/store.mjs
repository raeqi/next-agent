// 持久状态（~/.shiyi/state.json）+ 配置 + 变更广播。
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const HOME = process.env.SHIYI_HOME ?? join(homedir(), '.shiyi')
export const WS = join(HOME, 'workspace')          // 「电脑根目录」：agent 的项目根
export const SHADOW = join(WS, 'shadow')           // agent 唯一可写处
mkdirSync(SHADOW, { recursive: true })

const DEFAULT_CONFIG = {
  // agent 可以只读查找材料的目录
  materials: ['~/Documents', '~/Desktop', '~/Downloads'],
  // 前台是这些应用时，桌宠闭眼（眼睛本来也只看微信）
  privateApps: ['com.apple.Passwords', 'com.1password.1password', 'com.agilebits.onepassword7', 'com.apple.keychainaccess'],
  // 微信里不看的会话（会话名包含即跳过）
  ignoreConvs: [],
  // 微信左侧导航栏 + 会话列表的宽度（pt）；聊天区从这里开始
  wechatListWidth: 0,
  morningAt: '09:00',
  wrapUpAt: '18:30',
  triageModel: 'deepseek-v4-flash',
  draftModel: 'deepseek-v4-pro',
  // 每小时最多主动开口次数（不含你主动点开）
  speakBudgetPerHour: 6,
}

const CONFIG_PATH = join(HOME, 'config.json')
if (!existsSync(CONFIG_PATH)) writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2))
export const config = { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) }
config.materials = config.materials.map(p => p.replace(/^~/, homedir()))

const STATE_PATH = join(HOME, 'state.json')
const EMPTY = {
  commitments: [],   // {id, conv, to, what, quote, due, dueText, at, status:'open'|'drafting'|'ready'|'sent'|'done'|'dropped', draft?, speakAt?, spoken?}
  cards: [],         // {id, kind, title, why, quote?, message?, docs?[], missing?, commitmentId?, rule?, actions[], at}
  rules: [],         // {id, text, learnedFrom, at, enabled}
  insight: [],       // {at, src, text, verdict, layer?, cost?}
  seen: {},          // conv → [规范化消息 key]
  spokenAt: [],      // 主动开口时间戳（打扰预算）
  lastWrapUp: '', lastMorning: '',
}
export const state = existsSync(STATE_PATH) ? { ...EMPTY, ...JSON.parse(readFileSync(STATE_PATH, 'utf8')) } : structuredClone(EMPTY)

// 运行时（不持久）
export const live = { eyes: true, focus: { bundle: '', name: '' }, screenAccess: true, working: 0, thinking: 0, lastObserveAt: 0, nod: 0, nodText: '' }

let saveTimer
export function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    state.insight = state.insight.slice(-400)
    writeFileSync(STATE_PATH + '.tmp', JSON.stringify(state, null, 1))
    renameSync(STATE_PATH + '.tmp', STATE_PATH)
  }, 200)
}

const subs = new Set()
export const subscribe = fn => { subs.add(fn); return () => subs.delete(fn) }
export function changed() { save(); for (const fn of subs) fn() }

export const now = () => new Date()
export const hm = (d = now()) => d.toTimeString().slice(0, 5)
export const ymd = (d = now()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const uid = p => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

export function insight(e) {
  state.insight.push({ at: hm(), ...e })
  changed()
}

export function card(c) {
  state.cards = state.cards.filter(x => x.id !== c.id)
  state.cards.unshift({ at: hm(), ...c })
  changed()
}
export function dropCard(id) { state.cards = state.cards.filter(x => x.id !== id); changed() }

/** 主动开口前检查打扰预算。 */
export function maySpeak() {
  const hourAgo = Date.now() - 3600_000
  state.spokenAt = state.spokenAt.filter(t => t > hourAgo)
  return state.spokenAt.length < config.speakBudgetPerHour
}
export function spoke() { state.spokenAt.push(Date.now()) }
