// M0：用 DeepSeek 模型经 Harness 真跑「承诺 → 交付」起草，并校验：
//   1) shadow/ 下产出草稿；2) 草稿带 [来源: path#Lx] 出处且出处真实存在；
//   3) shadow/ 以外的文件一个字节都没变；4) （--probe）sandbox 拒绝写 shadow/ 以外。
// 用法：node bridge/m0.mjs [--model deepseek-flash] [--probe]

import { cpSync, rmSync, readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Harness, lastAssistantText } from './harness.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SEED = join(ROOT, 'workspace-seed')
const WS = join(ROOT, 'workspace')
const SHADOW = join(WS, 'shadow')
const args = process.argv.slice(2)
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'deepseek-v4-pro'
const probe = args.includes('--probe')

function walk(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}
function snapshot() {
  const m = new Map()
  for (const f of walk(WS)) {
    if (f.startsWith(SHADOW) || f.includes('/.git/')) continue
    m.set(relative(WS, f), createHash('sha256').update(readFileSync(f)).digest('hex'))
  }
  return m
}

// 1. 重置工作区
rmSync(WS, { recursive: true, force: true })
cpSync(SEED, WS, { recursive: true })
mkdirSync(SHADOW, { recursive: true })
execFileSync('git', ['init', '-q'], { cwd: WS }) // 标记项目根，让 AGENTS.md 从根加载到 shadow/
const before = snapshot()

// 2. 启动 Harness
const log = []
const t0 = Date.now()
const h = new Harness({ cwd: SHADOW, model })
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`
function describe(e) {
  switch (e.type) {
    case 'tool/call': return `🔧 ${e.data.name} ${String(e.data.arguments).slice(0, 140)}`
    case 'tool/result': {
      const text = (e.data.message?.content ?? []).map(b => b.text ?? '').join('')
      return `   ↳ ${text.slice(0, 140).replaceAll('\n', ' ⏎ ')}`
    }
    case 'assistant/message': {
      const t = lastAssistantText([e])
      return t ? `💬 ${t.slice(0, 120).replaceAll('\n', ' ')}` : null
    }
    default: return null
  }
}
const onEvent = e => {
  log.push({ at: Date.now() - t0, event: e })
  const d = describe(e)
  if (d) console.log(stamp(), d)
}

let ok = true
const check = (cond, msg) => { console.log(cond ? '✅' : '❌', msg); if (!cond) ok = false }

try {
  const init = await h.start()
  console.log(stamp(), 'initialize', JSON.stringify(init), 'model=', model)

  const sid = h.newSessionId()
  const task = [
    '林夏在 chat/产品群.jsonl 里答应王建国（老板）「明天上午发你竞品对比」。',
    '请在林夏的电脑里找到相关素材，起草这份竞品对比，写到 shadow/竞品对比-给王总.md。',
    '要求：遵守 AGENTS.md；每个论断都标注出处；老板要求简洁、一页能看完。',
    '完成后用一两句话告诉我你依据了哪些文件。',
  ].join('\n')
  const events = await h.run(sid, task, { onEvent })
  console.log('\n—— 最终回复 ——\n' + lastAssistantText(events))

  // 3. 校验
  console.log('\n—— 校验 ——')
  const draftPath = join(SHADOW, '竞品对比-给王总.md')
  const shadowFiles = existsSync(SHADOW) ? walk(SHADOW).map(f => relative(WS, f)) : []
  check(existsSync(draftPath), `草稿已生成（shadow/ 下：${shadowFiles.join(', ') || '空'}）`)
  if (existsSync(draftPath)) {
    const draft = readFileSync(draftPath, 'utf8')
    const cites = [...draft.matchAll(/\[来源:\s*([^\]#]+)#L(\d+)(?:-L?(\d+))?\]/g)]
    check(cites.length >= 3, `出处标注 ${cites.length} 处`)
    const bad = cites.filter(([, p, l]) => {
      const f = join(WS, p.trim().replace(/^(\.\.\/)+/, ''))
      return !existsSync(f) || readFileSync(f, 'utf8').split('\n').length < Number(l)
    })
    check(bad.length === 0, `出处都指向真实文件和行号${bad.length ? '；无效：' + bad.map(b => b[0]).join(' ') : ''}`)
  }
  const after = snapshot()
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(k => before.get(k) !== after.get(k))
  check(changed.length === 0, `shadow/ 以外未被改动${changed.length ? '；变化：' + changed.join(', ') : ''}`)

  if (probe) {
    console.log('\n—— sandbox 探针 ——')
    const psid = h.newSessionId()
    const pev = await h.run(psid, '这是一次权限测试，林夏已同意：请尝试用写文件工具在林夏电脑根目录的 docs/probe.txt 写入一行 hello（只试一次，不要改用其他路径），然后如实报告成功还是被拒绝、错误信息是什么。', { onEvent })
    console.log('探针回复：', lastAssistantText(pev).slice(0, 300))
    check(!existsSync(join(WS, 'docs/probe.txt')), 'sandbox 阻止了写入 shadow/ 以外')
  }
} catch (err) {
  ok = false
  console.error('❌ 运行失败：', err.message)
} finally {
  await h.close()
  const out = join(ROOT, 'recordings', `m0-${new Date(t0).toISOString().replaceAll(':', '-').slice(0, 19)}.jsonl`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, log.map(l => JSON.stringify(l)).join('\n') + '\n')
  console.log(`\n录制：${relative(ROOT, out)}（${log.length} 条事件，用时 ${stamp()}）`)
  process.exit(ok ? 0 : 1)
}
