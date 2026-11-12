// 没有 key 时后台能起来，并靠剧本给出一条建议和一份任务结果。
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const dir = mkdtempSync(join(tmpdir(), 'shiyi-demo-'))
const port = 21000 + Math.floor(Math.random() * 20000)
const env = { ...process.env, SHIYI_HOME: dir, SHIYI_DRY: '1' }
for (const key of ['MODEL_API_KEY', 'MODEL_BASE_URL', 'MODEL_NAME', 'MODEL_TRIAGE_NAME', 'MODEL_DRAFT_NAME', 'SHIYI_API_KEY', 'SHIYI_PROVIDER', 'SHIYI_TRIAGE_MODEL', 'SHIYI_DRAFT_MODEL', 'MOONSHOT_API_KEY', 'DEEPSEEK_API_KEY', 'DEMO_MODE']) delete env[key]

const child = spawn(process.execPath, ['daemon/main.mjs', '--no-pet', '--port', String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
child.stdout.on('data', d => { log += d })
child.stderr.on('data', d => { log += d })

const base = `http://127.0.0.1:${port}`
const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function snapshot() {
  const res = await fetch(base + '/events')
  const reader = res.body.getReader()
  let buf = ''
  while (!buf.includes('\n\n')) {
    const { value, done } = await reader.read()
    if (done) break
    buf += new TextDecoder().decode(value)
  }
  await reader.cancel().catch(() => {})
  return JSON.parse(buf.split('\n').find(l => l.startsWith('data: ')).slice(6))
}
async function until(pred, label) {
  let last
  for (let i = 0; i < 40; i++) {
    last = await snapshot()
    if (pred(last)) return last
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`${label}\n${JSON.stringify({ cards: last?.cards, insight: last?.insight?.slice(-4), commitments: last?.commitments }, null, 1)}\n${log.slice(-800)}`)
}
function obs(lines) {
  return {
    bundle: 'com.demo.notes', app: '备忘录', title: '周会纪要',
    lines: lines.map((text, i) => ({ text, conf: 0.95, x: 0.1, y: 0.2 + i * 0.04, w: 0.7, h: 0.03 })),
  }
}

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('后台没有启动\n' + log)), 8000)
    const onExit = code => { clearTimeout(timer); reject(new Error('后台退出 ' + code + '\n' + log)) }
    const done = () => {
      if (!log.includes('拾遗 daemon')) return
      clearTimeout(timer); child.off('exit', onExit); resolve()
    }
    child.on('exit', onExit)
    child.stdout.on('data', done)
    done()
  })
  for (let i = 0; i < 20 && !log.includes('演示模式'); i++) await new Promise(r => setTimeout(r, 50))
  assert.match(log, /演示模式/)
  assert.match(log, /MODEL_API_KEY/)
  assert.match(log, /MODEL_BASE_URL/)
  assert.match(log, /MODEL_NAME/)

  const boot = await snapshot()
  assert.equal(boot.demo, true)
  assert.match(boot.demoNotice, /MODEL_API_KEY/)

  assert.equal((await post('/focus', { bundle: 'com.demo.notes', name: '备忘录' })).status, 200)
  assert.equal((await post('/action', { type: 'app-consent', app: '备忘录', choice: 'on' })).status, 200)
  await post('/observe', obs(['本周进展', '产品评审已经开过']))
  await until(s => s.observedChanges >= 1, '第一帧没有记下来')
  await post('/observe', obs(['本周进展', '下周给王总发竞品对比，待补定价数据']))
  const seen = await until(s => s.cards.some(c => c.kind === 'opportunity' && /竞品|王总/.test(`${c.title} ${c.why} ${c.quote}`)), '没有剧本建议')
  const card = seen.cards.find(c => c.kind === 'opportunity')
  assert.match(card.why, /你/)
  assert.equal(card.status, 'suggested')

  await post('/action', { type: 'add-task', text: '整理给王总的竞品对比结论，定价仍待补' })
  const done = await until(s => s.commitments.some(c => c.status === 'completed' && /竞品/.test(c.progress || '')), '任务没有写出结果')
  const task = done.commitments.find(c => c.status === 'completed')
  const file = await fetch(base + '/file?path=' + encodeURIComponent(task.resultFiles[0]))
  const body = await file.text()
  assert.equal(file.status, 200)
  assert.match(body, /竞品|定价/)
  assert.match(task.verification, /核对/)
  console.log('PASS 无 key 启动，并给出剧本建议和任务结果')
} finally {
  child.kill('SIGTERM')
  await new Promise(r => { const t = setTimeout(() => { child.kill('SIGKILL'); r() }, 2000); child.on('exit', () => { clearTimeout(t); r() }) })
  rmSync(dir, { recursive: true, force: true })
}
