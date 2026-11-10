// Harness 接线：工作区（「电脑根目录」）、手册 AGENTS.md、轻量模型判定（L1）、主 agent 起草（L2）。
import { existsSync, writeFileSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { Harness, lastAssistantText } from '../bridge/harness.mjs'
import { WS, SHADOW, config, state, live, changed, insight } from './store.mjs'

if (!existsSync(join(WS, '.git'))) execFileSync('git', ['init', '-q'], { cwd: WS })
mkdirSync(join(WS, 'chat'), { recursive: true })

/* ── 手册：规则是唯一数据源，渲染进 AGENTS.md，Harness 每个新会话自动加载 ── */
export function writeHandbook() {
  const rules = state.rules.filter(r => r.enabled !== false)
  writeFileSync(join(WS, 'AGENTS.md'), `# 拾遗的电脑

你是「拾遗」，这台 Mac 使用者（下称「用户」）的常驻助手。本文件所在目录是你的工作区（下称「电脑根目录」）：

- \`chat/\`：你从微信里看到的聊天记录（每个会话一份 jsonl；side=me 是用户自己说的，side=other 是对方）。
- \`shadow/\`：你唯一可以写入的地方，也是你的工作目录。所有草稿都写在这里，不碰任何原件。
- 用户的材料目录（只读，可以搜索、阅读）：${config.materials.map(p => '`' + p + '`').join('、')}。
- 写任何论断都标出处，格式固定为 \`[来源: 路径#L行号]\` 或 \`[来源: 路径#L起-L止]\`，每处单独一个方括号，不要合并、不要省略「来源:」。电脑根目录下的文件用相对路径，材料目录里的文件用绝对路径。没有出处就不要写。
- 材料不够时如实说缺什么，不要编造。你的草稿只给用户过目，不会自动发出去。对用户说话时称呼「你」。

<!-- 拾遗:手册:开始 -->
## 我的工作方式（用户确认过的规则；只在括号里写的范围内适用）

${rules.length ? rules.map((r, i) => `${i + 1}. ${r.text}${r.scope ? `（适用：${r.scope}）` : ''}`).join('\n') : '（暂无）'}
<!-- 拾遗:手册:结束 -->
`)
}
writeHandbook()

export function appendTranscript(conv, msgs) {
  const f = join(WS, 'chat', `微信-${safe(conv)}.jsonl`)
  appendFileSync(f, msgs.map(m => JSON.stringify({ at: m.at ?? null, side: m.side, text: m.text })).join('\n') + '\n')
  return `chat/微信-${safe(conv)}.jsonl`
}
export const safe = s => (s || '未知会话').replace(/[\/\\:*?"<>|\s]+/g, '_').slice(0, 40)

/* ── 两个 Harness 进程：筛选（flash，不推理）和起草（pro） ── */
const pools = {}
function harness(kind) {
  if (!pools[kind]) {
    const h = kind === 'triage'
      ? new Harness({ cwd: SHADOW, model: config.triageModel, reasoningEffort: 'off' })
      : new Harness({ cwd: SHADOW, model: config.draftModel })
    pools[kind] = { h, ready: h.start(), queue: Promise.resolve(), known: new Set() }
    pools[kind].ready.catch(e => { insight({ src: 'Harness', text: `启动失败：${e.message.split('\n')[0]}`, verdict: 'error' }); delete pools[kind] })
  }
  return pools[kind]
}

/** 同一会话串行执行。 */
async function run(kind, sessionId, text, onEvent) {
  const p = harness(kind)
  await p.ready
  const job = p.queue.then(async () => {
    // 这个 Harness 进程第一次用这个会话：如果磁盘上已有（daemon 重启前建的），先恢复
    if (!p.known.has(sessionId)) {
      p.known.add(sessionId)
      await p.h.request('session/resume', { sessionId }, 30_000).catch(() => {})
    }
    return p.h.run(sessionId, text, { onEvent })
  })
  p.queue = job.catch(() => {})
  return lastAssistantText(await job)
}

let triageSession
const parseJson = t => { const m = t.match(/\{[\s\S]*\}/); if (!m) throw new Error('模型没有给出 JSON：' + t.slice(0, 80)); return JSON.parse(m[0]) }

/** L1：这句是不是一个要兑现的承诺？request 是对方紧挨着的请求（你只回了「好的」时）。 */
export async function judgeCommitment({ conv, recent, quote, request }) {
  triageSession ??= `shiyi-triage-${Date.now().toString(36)}`
  live.thinking++; changed()
  try {
    const out = await run('triage', triageSession, [
      '你是「拾遗」的筛选器，只做判断，不调用任何工具。',
      `现在是 ${new Date().toLocaleString('zh-CN', { hour12: false })}。下面是用户在微信与「${conv}」的最近聊天（me=用户本人，other=对方；如果是群聊，对方消息前可能带人名）：`,
      recent.map(m => `${m.side}: ${m.text}`).join('\n'),
      request ? `候选：对方说「${request}」，用户回了「${quote}」。` : `候选句（用户说的）：「${quote}」`,
      '判断用户是否做出了一个需要之后兑现的承诺（答应发文件、给意见、回复、安排某事等）。客套话、当场已经完成的、问句都不算。',
      '只输出一行 JSON：{"commitment":true|false,"to":"具体对象（群聊里写具体的人，不要写群名）","what":"要交付的事（简短名词短语）","todo":"动宾短语，如：发王总竞品对比","kind":"reply|deliverable|action","due":"ISO 8601 时间或 null","dueText":"原话里的时间说法或空","draftable":true|false,"confidence":0到1,"why":"一句话理由，用「你」称呼用户"}',
      'kind：reply=只需要回一段话；deliverable=要交一份文档或资料；action=要去做一件事（打电话、订会议室等）。draftable=你能否先替用户起草（action 一般为 false）。',
    ].join('\n'))
    return parseJson(out)
  } finally { live.thinking--; changed() }
}

/** L1：一句驳回意见能否沉淀成以后都适用的规则？ */
export async function judgeRule({ reason, context }) {
  triageSession ??= `shiyi-triage-${Date.now().toString(36)}`
  live.thinking++; changed()
  try {
    const out = await run('triage', triageSession, [
      '你是「拾遗」的学习器，不调用任何工具。',
      `用户对你起草的「${context}」提了意见：「${reason}」。`,
      '判断这条意见是否反映了一个以后也适用的做事或写作偏好（而不只是这一次的内容修改）。',
      '只输出一行 JSON：{"reusable":true|false,"rule":"用一句祈使句写成的规则，具体、可执行","scope":"适用范围，如：写给上级的材料 / 所有微信回复"}',
    ].join('\n'))
    return parseJson(out)
  } finally { live.thinking--; changed() }
}

const NO_MISSING_MESSAGE = '如果写了 `缺什么.txt`，就不要写 `消息.txt`：信息没补齐之前，不能让用户对对方说「好了」。'

/** L2：主 agent 起草。reply 只看聊天写一句话；deliverable 才去翻材料目录。写入 shadow/<id>/。 */
export async function draft(c, onTool) {
  mkdirSync(join(SHADOW, c.id), { recursive: true })
  c.session ??= `shiyi-draft-${c.id}`
  const head = `用户在微信里${c.request ? `被「${c.to}」问「${c.request}」时回了` : `答应了「${c.to}」`}：「${c.quote}」${c.dueText ? `（时间：${c.dueText}）` : ''}。要兑现的事：${c.what}。聊天记录：${c.transcript}（电脑根目录下）。`
  const body = c.kind === 'deliverable' ? [
    `用户的材料目录（只读）：${config.materials.join('、')}。先找齐完成这件事需要的材料，然后在当前工作目录（shadow/）下的文件夹 ${c.id}/ 里写：`,
    '1. `<文档名>.md`：要交付的文档，每个论断标出处；材料不够的部分留空并标注；',
    '2. `消息.txt`：用户可以直接粘贴到微信发给对方的话，简短自然，用用户的口吻，遵守手册里适用的规则；',
    '3. 材料不足以完成时，写 `缺什么.txt`，用要问用户的问题列出缺的信息，不要编造。' + NO_MISSING_MESSAGE,
  ] : [
    `这件事只需要回复一段话。只根据聊天记录，在当前工作目录（shadow/）下的文件夹 ${c.id}/ 里写 \`消息.txt\`：用户直接粘贴发出的话，简短自然，用用户的口吻，遵守手册里适用的规则。不要去材料目录翻文件。`,
    '如果回复需要只有用户才知道的信息（具体时间、数字、决定），写 `缺什么.txt` 列出要问用户的问题。' + NO_MISSING_MESSAGE,
  ]
  live.working++; changed()
  try {
    const summary = await run('draft', c.session, [head, ...body, '不要修改其他任何地方。最后用一句话告诉我你做了什么、依据了哪些文件。'].join('\n'),
      e => { if (e.type === 'tool/call') onTool?.(e.data) })
    return { summary, ...readDraft(c.id) }
  } finally { live.working--; changed() }
}

/** 按意见修改（同一会话，保留上下文）。 */
export async function redraft(c, reason, onTool) {
  return follow(c, `用户的意见：「${reason}」。请据此修改 shadow/${c.id}/ 下的草稿（直接覆盖原文件），遵守手册里适用的规则。最后一句话说明改了什么。`, onTool)
}

/** 用户补上了缺的信息。 */
export async function supply(c, info, onTool) {
  return follow(c, `用户补充的信息：「${info}」。请用它补齐 shadow/${c.id}/ 下的草稿。都补齐了就删除 \`缺什么.txt\`（用 bash 的 rm）并写好 \`消息.txt\`；还有缺的就更新 \`缺什么.txt\`，且不要写 \`消息.txt\`。最后一句话说明结果。`, onTool)
}

async function follow(c, text, onTool) {
  live.working++; changed()
  try {
    const summary = await run('draft', c.session, text, e => { if (e.type === 'tool/call') onTool?.(e.data) })
    return { summary, ...readDraft(c.id) }
  } finally { live.working--; changed() }
}

export function readDraft(id) {
  const dir = join(SHADOW, id)
  const read = f => existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').trim() : ''
  let docs = []
  try { docs = execFileSync('ls', [dir], { encoding: 'utf8' }).split('\n').filter(f => f.endsWith('.md')) } catch { /* 空 */ }
  return { message: read('消息.txt'), missing: read('缺什么.txt'), docs: docs.map(f => join('shadow', id, f)) }
}

export async function shutdownAgents() {
  await Promise.all(Object.values(pools).map(p => p.h.close().catch(() => {})))
}
