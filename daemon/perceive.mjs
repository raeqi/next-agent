// 通用感知：任何你允许的应用都能看到内容。
//   chat：聊天应用，解析版式分清谁说的（增强，不是前提）
//   doc ：文档应用，优先直接读打开的文件（系统 AppleScript + textutil），读不到再用截图识别的文字
//   other：其他应用，用截图识别的文字
// 另外提供：你多久没动键盘鼠标了（判断「你停下来了」）。
import { execFile } from 'node:child_process'
import { readFileSync, statSync, existsSync } from 'node:fs'
import { extname, basename } from 'node:path'
import { APPS } from './store.mjs'

/** 文档应用：read = 用哪段 AppleScript 取当前文件路径。 */
export const DOC_APPS = [
  { name: 'Word', kind: 'doc', bundles: ['com.microsoft.Word'], read: 'word' },
  { name: 'Pages', kind: 'doc', bundles: ['com.apple.iWork.Pages'], read: 'pages' },
  { name: '文本编辑', kind: 'doc', bundles: ['com.apple.TextEdit'], read: 'textedit' },
  { name: 'WPS', kind: 'doc', bundles: ['com.kingsoft.wpsoffice.mac', 'com.kingsoft.wpsoffice.mac.global'] },
  { name: 'Excel', kind: 'doc', bundles: ['com.microsoft.Excel'], read: 'excel' },
  { name: 'PowerPoint', kind: 'doc', bundles: ['com.microsoft.Powerpoint'] },
  { name: 'Keynote', kind: 'doc', bundles: ['com.apple.iWork.Keynote'] },
  { name: 'Numbers', kind: 'doc', bundles: ['com.apple.iWork.Numbers'] },
]

/** 系统和敏感应用：永远不问、不看。 */
export const NEVER = new Set([
  'com.apple.finder', 'com.apple.systempreferences', 'com.apple.Passwords', 'com.apple.keychainaccess',
  'com.apple.loginwindow', 'com.apple.ScreenSaver.Engine', 'com.apple.dock', 'com.apple.Spotlight',
  'com.raeqi.shiyi', 'com.apple.SecurityAgent', 'com.1password.1password', 'com.agilebits.onepassword7',
])

/** 认出一个应用：先查聊天/文档登记表，没有就当「其他」，名字用系统给的。 */
export function appInfo(bundle, name = '') {
  const chat = APPS.find(a => a.bundles.includes(bundle)) ?? (name ? APPS.find(a => a.names.some(n => n.toLowerCase() === name.toLowerCase())) : null)
  if (chat) return { ...chat, kind: 'chat' }
  const doc = DOC_APPS.find(a => a.bundles.includes(bundle))
  if (doc) return doc
  return { name: name || bundle, kind: 'other', bundles: [bundle] }
}

const run = (cmd, args, ms = 3000) => new Promise(res => {
  execFile(cmd, args, { timeout: ms, maxBuffer: 8 << 20 }, (err, out) => res(err ? '' : String(out).trim()))
})

const SCRIPTS = {
  word: 'tell application "Microsoft Word" to if (count of documents) > 0 then return POSIX path of (full name of active document as text)',
  pages: 'tell application "Pages" to if (count of documents) > 0 then return POSIX path of (file of front document as alias)',
  textedit: 'tell application "TextEdit" to if (count of documents) > 0 then return path of front document',
  excel: 'tell application "Microsoft Excel" to return POSIX path of (full name of active workbook as text)',
}
const TEXTUTIL = new Set(['.docx', '.doc', '.rtf', '.rtfd', '.odt', '.html', '.htm', '.webarchive'])
const PLAIN = new Set(['.txt', '.md', '.markdown', '.csv'])

const pathCache = new Map()   // bundle → {at, path}
/** 当前文档应用里打开的是哪个文件（2 秒内复用结果）。第一次会触发系统「允许控制 Word」的授权。 */
export async function frontDocPath(app) {
  if (!app.read) return ''
  const c = pathCache.get(app.read)
  if (c && Date.now() - c.at < 2000) return c.path
  const path = await run('osascript', ['-e', SCRIPTS[app.read]])
  pathCache.set(app.read, { at: Date.now(), path })
  return path
}

/** 读文件全文（能读的格式）。返回 {text, mtime, name} 或 null。 */
export async function readDocFile(path) {
  if (!path || !existsSync(path)) return null
  const ext = extname(path).toLowerCase()
  const mtime = statSync(path).mtimeMs
  let text = ''
  if (PLAIN.has(ext)) text = readFileSync(path, 'utf8')
  else if (TEXTUTIL.has(ext)) text = await run('textutil', ['-convert', 'txt', '-stdout', path], 8000)
  else return { text: '', mtime, name: basename(path), unreadable: true }
  return { text, mtime, name: basename(path) }
}

/** 你多久没动键盘鼠标了（秒）。 */
export async function idleSeconds() {
  const out = await run('ioreg', ['-c', 'IOHIDSystem', '-d', '4'])
  const m = out.match(/"HIDIdleTime"\s*=\s*(\d+)/)
  return m ? Math.floor(Number(m[1]) / 1e9) : 0
}

/** 截图识别结果 → 按阅读顺序的纯文本（去掉菜单栏/按钮那种零碎）。 */
export function ocrText(obs) {
  return obs.lines
    .filter(l => l.conf >= 0.3 && l.text.trim().length > 1)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(l => l.text.trim())
    .join('\n')
}

/** 粗略指纹：判断内容有没有实质变化。 */
export function fingerprint(text) {
  let h = 2166136261
  for (const ch of text.replace(/\s+/g, '')) h = Math.imul(h ^ ch.codePointAt(0), 16777619)
  return (h >>> 0).toString(36)
}
