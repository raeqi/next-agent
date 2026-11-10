// 持久状态（~/.shiyi/state.json）+ 配置 + 变更广播。
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { modelConfig } from '../bridge/model-config.mjs'
import { homedir } from 'node:os'

export const HOME = process.env.SHIYI_HOME ?? join(homedir(), '.shiyi')
export const WS = join(HOME, 'workspace')          // 「电脑根目录」：agent 的项目根
export const SHADOW = join(WS, 'shadow')           // agent 唯一可写处
mkdirSync(SHADOW, { recursive: true })

const DEFAULT_CONFIG = {
  // agent 可以只读查找材料的目录
  materials: ['~/Documents', '~/Desktop', '~/Downloads'],
  // 应用白名单：bundle id → 'on'（看）| 'off'（你说不看，不再问）。不在这里的支持应用，第一次打开时会问你
  apps: {},
  // 截图间隔（秒）；画面没变时本来就会跳过识别
  captureIntervalSec: 2.5,
  // 暂停到这个时间（ISO），空 = 没暂停
  pauseUntil: '',
  // 你在 Slack / Discord / Teams 这类「名字在上面」的应用里显示的名字，用来认出哪句是你说的
  myNames: [],
  // 已允许应用里不看的会话（会话名包含即跳过）
  ignoreConvs: [],
  // 微信左侧导航栏 + 会话列表的宽度（pt）；聊天区从这里开始
  wechatListWidth: 0,
  morningAt: '09:00',
  wrapUpAt: '18:30',
  triageModel: modelConfig().triageModel,
  draftModel: modelConfig().draftModel,
  // 每小时最多主动开口次数（不含你主动点开）
  speakBudgetPerHour: 6,
}

const CONFIG_PATH = join(HOME, 'config.json')
if (!existsSync(CONFIG_PATH)) writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2))
const rawConfig = { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) }
delete rawConfig.privateApps   // 有了白名单，私密应用名单不再需要
const expand = c => ({ ...c, triageModel: modelConfig().triageModel, draftModel: modelConfig().draftModel, materials: c.materials.map(p => p.replace(/^~/, homedir())) })
export const config = expand(rawConfig)
export const rawMaterials = () => rawConfig.materials
/** 写回 config.json（材料目录保留 ~ 写法）。 */
export function saveConfig(patch) {
  Object.assign(rawConfig, patch)
  Object.assign(config, expand(rawConfig))
  writeFileSync(CONFIG_PATH, JSON.stringify(rawConfig, null, 2))
}

/**
 * 拾遗适配了版式的应用（能分清谁说的）。只有这些会被问「要不要看」。
 * family：bubble = 对方靠左、你靠右（微信式）；named = 消息都靠左、上方写发送人名字（Slack 式，需要知道你的名字）。
 * 识别优先按 bundle id，其次按应用名。
 */
const APP_LIST = [
  { name: '微信', family: 'bubble', bundles: ['com.tencent.xinWeChat', 'com.tencent.WeChat'], names: ['微信', 'WeChat'] },
  { name: '飞书', family: 'bubble', bundles: ['com.electron.lark', 'com.bytedance.lark', 'com.larksuite.lark'], names: ['飞书', 'Feishu', 'Lark'] },
  { name: '钉钉', family: 'bubble', bundles: ['com.alibaba.DingTalkMac', 'com.dingtalk.mac'], names: ['钉钉', 'DingTalk'] },
  { name: '企业微信', family: 'bubble', bundles: ['com.tencent.WeWorkMac'], names: ['企业微信', 'WeCom', 'WeWork'] },
  { name: '信息', family: 'bubble', bundles: ['com.apple.MobileSMS'], names: ['信息', 'Messages'] },
  { name: 'Telegram', family: 'bubble', bundles: ['ru.keepcoder.Telegram', 'org.telegram.desktop'], names: ['Telegram'] },
  { name: 'WhatsApp', family: 'bubble', bundles: ['net.whatsapp.WhatsApp', 'desktop.WhatsApp'], names: ['WhatsApp'] },
  { name: 'Slack', family: 'named', bundles: ['com.tinyspeck.slackmacgap'], names: ['Slack'] },
  { name: 'Discord', family: 'named', bundles: ['com.hnc.Discord'], names: ['Discord'] },
  { name: 'Teams', family: 'named', bundles: ['com.microsoft.teams2', 'com.microsoft.teams'], names: ['Microsoft Teams', 'Teams'] },
]
export const APPS = APP_LIST
/** 按 bundle id（或应用名）找到适配记录。 */
export function findApp(bundle, name = '') {
  return APP_LIST.find(a => a.bundles.includes(bundle)) ?? (name ? APP_LIST.find(a => a.names.some(n => n.toLowerCase() === name.toLowerCase())) : undefined)
}
// 兼容旧调用：bundle → {name, family}
export const SUPPORTED_APPS = Object.fromEntries(APP_LIST.flatMap(a => a.bundles.map(b => [b, a])))
export const appName = b => config.appNames?.[b] ?? findApp(b)?.name ?? b
/** 白名单里状态为「看」的 bundle id（含你实际打开时记下的 bundle）。 */
export const watching = () => Object.keys(config.apps).filter(b => config.apps[b] === 'on')
export const paused = () => !!config.pauseUntil && new Date(config.pauseUntil) > new Date()

const STATE_PATH = join(HOME, 'state.json')
const EMPTY = {
  commitments: [],   // {id, conv, to, what, quote, due, dueText, at, status:'open'|'drafting'|'ready'|'sent'|'done'|'dropped', draft?, speakAt?, spoken?}
  cards: [],         // {id, kind, title, why, quote?, message?, docs?[], missing?, commitmentId?, rule?, actions[], at}
  rules: [],         // {id, text, learnedFrom, at, enabled}
  insight: [],       // {at, src, text, verdict, layer?, cost?}
  seen: {},          // conv → [规范化消息 key]
  seenCount: 0,      // 看到过的新消息总数
  spokenAt: [],      // 主动开口时间戳（打扰预算）
  lastWrapUp: '', lastMorning: '',
}
export const state = existsSync(STATE_PATH) ? { ...EMPTY, ...JSON.parse(readFileSync(STATE_PATH, 'utf8')) } : structuredClone(EMPTY)

// 运行时（不持久）
export const live = { eyes: true, focus: { bundle: '', name: '' }, screenAccess: true, working: 0, thinking: 0, lastObserveAt: 0, nod: 0, nodText: '', currentConv: '' }

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
