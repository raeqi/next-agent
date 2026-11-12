// 没有真实模型时的剧本。判断、起草和后台任务都走同一条产品路径，只是回复事先写好。
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'

const idPattern = '[A-Za-z0-9_.-]+'

function folder(text) {
  const patterns = [
    new RegExp(`文件夹\\s+(${idPattern})/`),
    new RegExp(`shadow/(${idPattern})/`),
    new RegExp(`写进\\s+(${idPattern})/`),
    new RegExp(`在\\s+(${idPattern})/计划\\.md`),
  ]
  for (const pattern of patterns) {
    const found = text.match(pattern)
    if (found) return found[1]
  }
  return ''
}

function quoted(text) {
  return [...text.matchAll(/「([^」]{2,80})」/g)].map(m => m[1])
}

function pageBody(prompt) {
  const marker = prompt.includes('内容（可能截断）：') ? '内容（可能截断）：' : '最近的聊天（me=用户本人，other=对方）：'
  const chunk = prompt.split(marker)[1] || ''
  return chunk.split('\nactionMode:')[0].split('\n用户最近还在做：')[0].trim()
}

function clip(text, n = 42) {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > n ? line.slice(0, n) + '…' : line
}

function todoFrom(quote) {
  if (/竞品/.test(quote)) return '整理竞品对比'
  if (/周会|纪要|结论/.test(quote)) return '整理周会结论'
  if (/报错|Error|Exception|失败|Traceback/.test(quote)) return '解释这段报错'
  if (/定价|价格|数据/.test(quote)) return '标出还缺的数据'
  return '整理这一页要跟进的事'
}

function one(item) {
  return { opportunities: [{ due: null, dueText: '', to: '', draftable: true, ...item }] }
}

function opportunity(prompt) {
  const body = pageBody(prompt)
  const lines = body.split('\n').map(s => s.trim()).filter(s => s.length > 6)
  const quote = lines.find(l => /下周|明天|待补|发给|整理|对比|报错|Error|失败|Exception|定价/.test(l)) || ''
  if (!quote) return { opportunities: [] }
  if (/Error|Exception|Traceback|报错|失败|无法继续/.test(body)) {
    return one({
      actionMode: 'analysis', type: 'troubleshoot', kind: 'reply', confidence: 0.91,
      todo: '解释这段报错并给出下一步', what: '报错说明', quote,
      why: `页面里有失败信息：「${clip(quote)}」。我可以先把原因和马上能试的一步写出来。`,
    })
  }
  return one({
    actionMode: 'task', type: 'followup', kind: 'deliverable', confidence: 0.92,
    todo: todoFrom(quote), what: '待交材料', quote,
    why: `你在页面里写了「${clip(quote)}」。我可以先按这句起草，页面上还没写明的数字单独标出来。`,
  })
}

function commitment(prompt) {
  const bits = quoted(prompt)
  const quote = bits.at(-1) || ''
  const request = bits.length > 1 ? bits[0] : ''
  const hit = /好的|收到|没问题|我来|发给|整理|对比|下周|明天/.test(quote)
  if (!hit) return { commitment: false, confidence: 0.2, why: '这句更像当场的回应，还看不出你答应了之后要交的东西。' }
  return {
    commitment: true, confidence: 0.9, draftable: true, kind: 'deliverable',
    to: '对方', what: todoFrom(request || quote), todo: todoFrom(request || quote),
    due: null, dueText: /下周|明天/.test(quote + request) ? (quote.match(/下周|明天/) || [''])[0] : '',
    why: `你接了「${clip(request || quote)}」，这件事可以先起草，等你过目后再发出去。`,
  }
}

function parseTask(prompt) {
  const text = quoted(prompt)[0] || '这件事'
  return { to: '', what: clip(text, 24), todo: todoFrom(text), kind: 'deliverable', due: null, dueText: '', draftable: true }
}

function judgeRule(prompt) {
  const reason = quoted(prompt)[0] || ''
  const reusable = /以后|总是|不要|别再|统一|都要|每次/.test(reason)
  return {
    reusable,
    rule: reusable ? reason.replace(/[。！!]$/, '') : '',
    scope: reusable ? '以后同类草稿' : '',
  }
}

function plan(prompt) {
  const page = prompt.split('页面数据：')[1] || ''
  const field = page.match(/"title":"([^"]+)"/) || page.match(/"AXTextField"/)
  if (!field) return { step: null, why: '这一页没有可以安全填写的文本框。' }
  return { why: '只填这一处说明，不点发送。', step: { op: 'setValue', id: 0, text: '先写一版，价格待你确认。' } }
}

function readMentioned(prompt) {
  const paths = [...prompt.matchAll(/(\/[^\s「」]+\.txt)/g)].map(m => m[1])
  for (const path of paths) {
    try { if (existsSync(path)) return readFileSync(path, 'utf8') } catch { /* 快照读不到就只用交办原文 */ }
  }
  return ''
}

function writeUnder(cwd, id, name, body) {
  if (!id || !/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error('演示剧本找不到可写的结果目录')
  const dir = resolve(cwd, id)
  const file = resolve(dir, name)
  const rel = relative(resolve(cwd), file)
  if (rel.startsWith('..') || rel.includes('..')) throw new Error('演示剧本拒绝写出工作目录')
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, body)
  return join(id, name)
}

function taskFiles(cwd, prompt) {
  const id = folder(prompt)
  const task = (prompt.match(/用户委派任务：([^\n]+)/) || [])[1] || quoted(prompt)[0] || '这件事'
  const source = readMentioned(prompt)
  const line = source.split('\n').map(s => s.trim()).find(s => /下周|竞品|待补|结论|定价/.test(s)) || ''
  const planText = [
    '# 计划',
    '',
    `1. 读交办：「${clip(task, 60)}」。`,
    '2. 只根据已看到的页面原文整理，不补页面上没有的数字。',
    '3. 把可以给对方看的结论和还缺的信息分开写。',
    '',
  ].join('\n')
  const result = [
    '# 给对方的结论',
    '',
    `针对「${clip(task, 60)}」，按现在看到的内容先整理成三句：`,
    '',
    line ? `1. 页面原话：${clip(line, 70)}。` : '1. 先按交办本身列出要交付的东西，不另编事实。',
    '2. 功能差异和交付节奏可以先写；页面没给出的价格、日期留空。',
    '3. 还缺定价数据。补上之前，不把估计数写进要发出去的稿子。',
    '',
    '这是演示稿，依据只有上面这句页面原文。配置真实模型后，会再去材料目录核对。',
    '',
  ].join('\n')
  writeUnder(cwd, id, '计划.md', planText)
  writeUnder(cwd, id, '结果.md', result)
  writeUnder(cwd, id, '任务状态.json', JSON.stringify({
    status: 'completed',
    summary: `已按「${clip(task, 40)}」写成三段结论，定价仍标为待补。`,
    files: ['计划.md', '结果.md'],
    verification: '核对过结果里的三点都能对上交办或页面原话，没有写入页面上不存在的价格。',
  }, null, 2))
  return `写好了「${clip(task, 30)}」的结论，定价按页面所说留空。`
}

function draftFiles(cwd, prompt) {
  const id = folder(prompt)
  const bits = quoted(prompt)
  const quote = bits.find(s => /下周|竞品|发给|整理|对比/.test(s)) || bits[0] || '这件事'
  const needsNumber = /定价|待补|价格/.test(prompt + quote)
  if (needsNumber) {
    writeUnder(cwd, id, '缺什么.txt', '定价用哪一版数字？页面里只写了待补，没有具体价格。')
    writeUnder(cwd, id, '竞品对比.md', `# 竞品对比\n\n- 功能差异：按「${clip(quote, 40)}」先列结构。\n- 交付节奏：待你确认。\n- 定价：页面写明待补，这里留空。\n`)
    return '草稿里先留出定价，并写了一条要问你的问题。'
  }
  writeUnder(cwd, id, '消息.txt', '我先把要发的内容按页面原话收成一段，你看过可以直接贴出去。')
  return '按页面原话写好了一段可以直接发的回复。'
}

function reviewFile(cwd, prompt) {
  const id = folder(prompt)
  const source = readMentioned(prompt)
  const line = source.split('\n').map(s => s.trim()).find(s => s.length > 6) || '当前页面'
  const text = [
    '# 看法',
    '',
    `1. 最值得先处理的是：「${clip(line, 60)}」。`,
    '2. 已经能写的部分先成稿，数字没出现的地方不要补。',
    '3. 发给对方之前，把待补的一项单独问清楚。',
    '',
  ].join('\n')
  writeUnder(cwd, id, '看法.md', text)
  return '看过这一页，先处理原文里点名要交的那一句。'
}

function verifyFile(cwd, prompt) {
  const id = folder(prompt)
  writeUnder(cwd, id, '核对.md', '没有发现问题')
  return '对过页面里的具体说法，没有发现能用材料推翻的数字。'
}

function reply(cwd, prompt) {
  if (prompt.includes('任务状态.json')) return taskFiles(cwd, prompt)
  if (prompt.includes('核对.md')) return verifyFile(cwd, prompt)
  if (prompt.includes('看法.md')) return reviewFile(cwd, prompt)
  if (prompt.includes('用户补充的信息')) {
    const id = folder(prompt)
    const info = quoted(prompt).at(-1) || '已补充'
    if (id) {
      writeUnder(cwd, id, '消息.txt', `定价按你补充的「${clip(info, 40)}」写上了，你看过就可以发。`)
      writeUnder(cwd, id, '缺什么.txt', '')
    }
    return '补上的信息已经写进草稿。'
  }
  if (prompt.includes('用户的意见')) {
    const id = folder(prompt)
    const reason = quoted(prompt)[0] || '按你的意见'
    if (id) writeUnder(cwd, id, '消息.txt', `按你的意见改了一版：${clip(reason, 40)}`)
    return '按你的意见改好了这一版。'
  }
  if (prompt.includes('桌面操作规划器')) return JSON.stringify(plan(prompt))
  if (prompt.includes('"opportunities"')) return JSON.stringify(opportunity(prompt))
  if (prompt.includes('用户直接交给你一件事') && !prompt.includes('消息.txt')) return JSON.stringify(parseTask(prompt))
  if (prompt.includes('"commitment"')) return JSON.stringify(commitment(prompt))
  if (prompt.includes('"reusable"')) return JSON.stringify(judgeRule(prompt))
  if (prompt.includes('消息.txt')) return draftFiles(cwd, prompt)
  return '我看过了。这一步没有足够的页面原文，先不编造结论。'
}

function events(text) {
  return [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } }]
}

/** 与真实 Harness.run 一样返回事件，并在需要时把剧本写进工作目录。 */
export function demoRun(cwd, prompt, onEvent) {
  const id = folder(prompt)
  if (id) onEvent?.({ type: 'tool/call', data: { name: 'read', arguments: JSON.stringify({ path: `${id}/` }) } })
  const text = reply(cwd || '.', prompt)
  if (id) onEvent?.({ type: 'tool/call', data: { name: 'write', arguments: JSON.stringify({ path: `${id}/结果.md` }) } })
  return events(text)
}
