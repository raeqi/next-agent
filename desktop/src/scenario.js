// 「林夏的一天」剧本（M1：全部是预设数据；M2 起由 Bridge 的真实事件替换其中的 agent 部分）。
import { h, sleep, fetchText } from './util.js'
import { state, emit, on, setClock } from './store.js'
import { closeAll, isOpen, focus, closeWindow, bodyOf } from './wm.js'
import { openChat, chatPush, chatType, openDoc, refreshDoc, openBank, openHandbook, openCalendar } from './apps.js'
import { card, dismiss, say, nod, setMode, insight, speak, listen, canListen, clearCards } from './pet.js'
import { toast, setAway } from './main-ui.js'

const SEED = [
  'AGENTS.md', 'chat/产品群.jsonl', 'chat/王建国.jsonl', 'chat/陈默.jsonl', 'chat/张总.jsonl',
  'docs/会议纪要-1104-产品评审.md', 'docs/周报-W45-草稿.md', 'data/weekly-metrics.csv',
  'calendar/2026-11-06.md', 'mail/接机确认.md',
]

export async function loadWorld() {
  await Promise.all(SEED.map(async p => { state.files[p] = await fetchText('/workspace-seed/' + p) }))
  for (const conv of ['产品群', '王建国', '陈默', '张总']) {
    state.chats[conv] = state.files[`chat/${conv}.jsonl`].trim().split('\n').map(l => JSON.parse(l)).map(m => ({ ...m, me: m.from === '林夏' }))
  }
  state.chats['产品群'] = state.chats['产品群'].slice(0, 2)   // 剧本从 17:44 开始，后面几条现场发生
  state.files['chat/产品群.jsonl'] = state.files['chat/产品群.jsonl'].split('\n').slice(0, 2).join('\n') + '\n'
  state.docs['周报'] = { title: '周报-W45-草稿.md', source: 'docs/周报-W45-草稿.md', text: state.files['docs/周报-W45-草稿.md'], revisions: [] }
  state.docs['竞品对比'] = {
    title: '竞品对比-给王总.md', shadow: true, rejectable: true, revisions: [],
    text: await fetchText('/fixtures/竞品对比-给王总.md'),
    actions: [{ label: '发给王总', primary: true, onClick: sendCompetitor }, { label: '不要了', onClick: () => dropDoc('竞品对比') }],
  }
  state.docs['陈默意见'] = {
    title: '给陈默-私有化意见.md', shadow: true, rejectable: true, revisions: [],
    text: await fetchText('/fixtures/给陈默-私有化意见.md'),
    actions: [{ label: '发给陈默', primary: true, onClick: sendChenmo }, { label: '不要了', onClick: () => dropDoc('陈默意见') }],
  }
}

/* 聊天推送时同步「电脑里的文件」，出处行号与真实工作区一致。 */
on('chat', ({ conv, msg }) => {
  const p = `chat/${conv}.jsonl`
  state.files[p] = (state.files[p] ?? '') + JSON.stringify({ at: msg.at, from: msg.from, text: msg.text }) + '\n'
})

const commit = c => { state.commitments.push({ status: 'open', ...c }); emit('commitments') }
const commitDone = (id, at) => { const c = state.commitments.find(c => c.id === id); if (c) { c.status = 'done'; c.doneAt = at; emit('commitments') } }

/* ═════════════════════════ 七幕 ═════════════════════════ */

export const STEPS = [
  {
    date: '11月5日 周四', clock: '17:44', title: '随口一句', desc: '林夏在群里答应老板一件事。拾遗记下了，但没有出声。',
    async enter() {
      openChat('产品群')
      insight({ src: '消息 · 产品群', text: '王建国：「能不能先给我一版竞品对比？」', verdict: 'remember', layer: 'L0 规则：点名林夏的请求', cost: '0 token' })
      insight({ src: '消息 · 产品群', text: '陈默：转写服务今晚升级停机 10 分钟', verdict: 'ignore', layer: 'L0 规则：运维通知，与你无关', cost: '0 token' })
      await sleep(900)
      setClock(null, '17:47')
      await chatType('产品群', '好的王总，周二评审会上我们刚好聊过这个，明天上午发你竞品对比', '2026-11-05 17:47')
      await sleep(500)
      insight({ src: '消息 · 产品群', text: '你说「明天上午发你竞品对比」→ 这是一个承诺：对象王建国，事项竞品对比，截止 11/6 上午', verdict: 'remember', layer: 'L0 承诺句式 → L1 轻量模型确认', cost: '≈0.4k token' })
      commit({ id: 'c-wang', to: '王建国', what: '竞品对比', due: '11/6 上午', source: 'chat/产品群.jsonl#L3' })
      await nod('记下了：明天上午给王总发竞品对比')
      await sleep(1200)
      setClock(null, '17:48')
      chatPush('产品群', { at: '2026-11-05 17:48', from: '王建国（老板）', text: '👍 简洁点，一页能看完最好' })
      insight({ src: '消息 · 产品群', text: '补充要求：简洁，一页能看完', verdict: 'remember', layer: 'L1 轻量模型：归入同一承诺', cost: '≈0.3k token' })
      await sleep(1100)
      setClock(null, '18:02')
      chatPush('产品群', { at: '2026-11-05 18:02', from: '赵小雨（运营）', text: '周五团建定在湖边那家烧烤，大家记得接龙' })
      insight({ src: '消息 · 产品群', text: '团建接龙', verdict: 'ignore', layer: 'L0 规则：闲聊', cost: '0 token' })
      insight({ src: '计划', text: '明早 08:30 叫醒主 agent 起草（离截止留足时间，又不打扰今晚）', verdict: 'act', layer: 'schedule 定时' })
    },
  },
  {
    date: '11月6日 周五', clock: '09:00', title: '早安：已经做好了', desc: '它不问「要我帮你吗」，而是带着做好的草稿来。',
    async enter() {
      closeAll()
      setClock('11月6日 周五', '08:30')
      setMode('work'); say('在起草给王总的竞品对比…', 0, 'quiet')
      insight({ src: '定时唤醒', text: '主 agent 起草竞品对比：读了聊天、评审纪要、数据表、周报 4 份文件，写入 shadow/', verdict: 'act', layer: 'L2 主 agent（deepseek-v4-pro）', cost: '约 1 分钟' })
      await sleep(1800)
      setClock(null, '09:00')
      state.commitments.find(c => c.id === 'c-wang') && (state.commitments.find(c => c.id === 'c-wang').status = 'drafted')
      card({
        id: 'wang', kind: 'commitment',
        title: '你昨晚答应王总今天上午发竞品对比，我已经起草好了。',
        why: '你 17:47 在产品群里说的；王总补了一句「一页能看完」，所以我压在了一页。',
        evidence: [
          { label: '产品群 · 17:47 你的承诺', path: 'chat/产品群.jsonl', line: 3 },
          { label: '评审会纪要 · 竞品观察', path: 'docs/会议纪要-1104-产品评审.md', line: 10, end: 15 },
          { label: '数据表 · W44', path: 'data/weekly-metrics.csv', line: 4 },
        ],
        actions: [{ label: '看看草稿', primary: true, onClick: () => openDoc('竞品对比') }, { label: '直接发', onClick: sendCompetitor }],
        bubble: '早！王总的竞品对比我备好了',
      })
      insight({ src: '桌宠', text: '开口：竞品对比已备好（附 3 处依据）', verdict: 'speak' })
    },
  },
  {
    date: '11月6日 周五', clock: '09:05', title: '划掉一句：它学会了', desc: '每一次「不要」，都可能变成手册里一条你看得见的规则。',
    async enter() {
      if (!state.sent.includes('竞品对比')) {
        openDoc('竞品对比')
        state.docs['竞品对比'].highlight = '我觉得'
        refreshDoc('竞品对比')
        await sleep(300)
        bodyOf('doc:竞品对比')?.querySelector('.is-hl')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        say('哪句不顺眼，点它旁边的「不要这句」，顺手告诉我为什么。', 0, 'quiet')
      } else say('草稿已经发出去了；下次划掉一句时告诉我原因，我就能学会。', 4000, 'quiet')
    },
  },
  {
    date: '11月6日 周五', clock: '10:30', title: '写周报：数字对不上', desc: '跨上下文：你写下的数字，它记得在另一份表里见过不一样的。',
    async enter() {
      closeAll(); clearCards()
      setClock(null, '10:30')
      const d = state.docs['周报']
      const full = 'DAU 12 万，环比继续增长。'
      d.text = d.text.replace('- ' + full, '- ▍')
      openDoc('周报')
      await sleep(500)
      for (let i = 1; i <= full.length; i++) {
        d.text = d.text.replace(/- [^\n]*▍/, '- ' + full.slice(0, i) + '▍')
        refreshDoc('周报'); await sleep(85)
      }
      d.text = d.text.replace('▍', '')
      refreshDoc('周报')
      insight({ src: '文档 · 周报', text: '你写了「DAU 12 万」', verdict: 'act', layer: 'L0 数字+指标名 → L1：值得核对', cost: '≈0.5k token' })
      setMode('think')
      await sleep(1400)
      insight({ src: '核对', text: '数据表 W44 是 108,000；周报 W45 写 12 万但没有出处', verdict: 'act', layer: 'L2 主 agent 核对', cost: '约 10 秒' })
      d.revisions.push({ id: 'dau', find: '12 万', replace: '10.8 万', state: 'pending', reason: '数据表里 W44 的 DAU 是 108,000。12 万找不到出处；王总 11/3 提过「数据口径保持一致」。' })
      refreshDoc('周报')
      setMode('call')
      say('周报里的 DAU 好像和数据表对不上，我在原文上标出来了', 0, 'call')
      insight({ src: '桌宠', text: '开口：在原文上以修订形式标出（原件没改）', verdict: 'speak' })
    },
  },
  {
    date: '11月6日 周五', clock: '14:00', title: '私人窗口：它闭眼', desc: '看与不看由你决定。私密窗口里的内容不出本机。',
    async enter() {
      closeAll(); clearCards(); setMode('idle')
      setClock(null, '11:20')
      chatPush('陈默', { at: '2026-11-06 11:20', from: '陈默', text: '夏夏，私有化那块你有啥想法？我下周四前要给王总结论' })
      openChat('陈默')
      await sleep(700)
      await chatType('陈默', '下午给你意见', '2026-11-06 11:22')
      insight({ src: '消息 · 陈默', text: '你说「下午给你意见」→ 承诺：对象陈默，私有化意见，截止今天下午', verdict: 'remember', layer: 'L0 承诺句式 → L1 确认', cost: '≈0.4k token' })
      commit({ id: 'c-chen', to: '陈默', what: '私有化意见', due: '今天下午', source: 'chat/陈默.jsonl#L3' })
      await nod('记下了：下午给陈默私有化意见')
      await sleep(1200)
      closeAll()
      setClock(null, '14:00')
      openBank()
      insight({ src: '个人网银', text: '私密名单上的窗口：没看，内容没离开本机，也不进记忆', verdict: 'private', layer: '浏览器端过滤' })
      say('这个窗口我不看。', 2600, 'quiet')
    },
  },
  {
    date: '11月6日 周五', clock: '16:00', title: '航班延误：离开电脑也能拍板', desc: '状态一变，它把连带的事一起处理好，等你一句话。',
    async enter() {
      closeAll(); clearCards()
      setClock(null, '16:00')
      toast({ icon: 'plane', title: '航旅提醒 · MU5137 延误', text: '起飞改为 20:00，预计 22:15 到达北京首都 T2（原 20:15）' })
      insight({ src: '外部事件', text: '航班 MU5137 延误 2 小时', verdict: 'act', layer: 'L1 轻量模型：会影响今晚安排', cost: '≈0.5k token' })
      setMode('work'); say('航班晚了，我看看会影响什么…', 0, 'quiet')
      await sleep(1600)
      insight({ src: '连锁处理', text: '主 agent：读日历、接机邮件、和张总的聊天 → 2 件事受影响，起草 2 条消息', verdict: 'act', layer: 'L2 主 agent', cost: '约 40 秒' })
      setMode('call')
      card({
        id: 'chain', kind: 'chain',
        title: '航班晚到 2 小时，有 2 件事受影响，我都备好了。',
        why: '日历上 20:45 和张总在国贸吃饭；行政约的接机是 20:15。',
        evidence: [
          { label: '日历 · 20:45 张总', path: 'calendar/2026-11-06.md', line: 7 },
          { label: '接机确认邮件', path: 'mail/接机确认.md', line: 8 },
          { label: '和张总的聊天', path: 'chat/张总.jsonl', line: 2 },
        ],
        body: h('ol', { class: 'chain-list' },
          h('li', {}, h('b', {}, '给张总（消息）'), h('q', {}, CHAIN.zhang)),
          h('li', {}, h('b', {}, '回周敏（邮件）'), h('q', {}, CHAIN.zhou))),
        actions: [{ label: '都发', primary: true, onClick: () => sendChain('电脑上点了「都发」') }, { label: '我要出门了（耳机）', onClick: () => goAway() }],
        bubble: '航班延误了，晚上的安排我改好了',
      })
      await sleep(1800)
      goAway()
    },
  },
  {
    date: '11月6日 周五', clock: '18:30', title: '下班收尾：规则生效了', desc: '一天下来，承诺有没有掉在地上？早上教它的规则，晚上已经在用。',
    async enter() {
      setAway(false); closeAll(); clearCards()
      setClock(null, '18:30')
      setMode('work'); say('在帮你收个尾…', 0, 'quiet')
      insight({ src: '下班收尾', text: `主 agent：起草给陈默的私有化意见（读了手册里的 ${state.rules.length} 条规则）`, verdict: 'act', layer: 'L2 主 agent', cost: '约 1 分钟' })
      await sleep(1600)
      const learned = state.rules.some(r => r.text.includes('我觉得'))
      state.docs['陈默意见'].banner = learned ? '已按手册第 1 条写：不用「我觉得」，直接给判断和依据' : undefined
      const row = (ok, who, what, note, act) => h('li', { class: ok ? 'is-done' : 'is-open' }, h('span', { class: 'wrap-dot' }, ok ? '✓' : ''), h('span', {}, h('b', {}, `${who} · ${what}`), h('small', {}, note)), act ?? null)
      const c = id => state.commitments.find(x => x.id === id)
      card({
        id: 'wrap', kind: 'wrap',
        title: `今天你答应了 ${state.commitments.length} 件事`,
        body: h('div', {},
          h('ul', { class: 'wrap-list' },
            row(c('c-wang')?.status === 'done', '王建国', '竞品对比', c('c-wang')?.status === 'done' ? `${c('c-wang').doneAt} 已发` : '草稿在等你'),
            row(c('c-zhang')?.status === 'done', '张总', '晚餐改约', c('c-zhang')?.status === 'done' ? `${c('c-zhang').doneAt} 已发` : '草稿在等你'),
            row(false, '陈默', '私有化意见', '你 11:22 说「下午给你意见」，我起草好了', h('button', { class: 'link', onclick: () => openDoc('陈默意见') }, '看看'))),
          learned ? h('div', { class: 'wrap-rule' }, '✦ 这份草稿已按你早上教的规则写：没有用「我觉得」。') : null),
        actions: [{ label: '看给陈默的草稿', primary: true, onClick: () => openDoc('陈默意见') }],
        bubble: '收工前，还有 1 件事要你点个头',
      })
      insight({ src: '桌宠', text: '开口：下班收尾（3 件承诺，1 件待你确认）', verdict: 'speak' })
    },
  },
]

/* ═════════════════════════ 交互处理 ═════════════════════════ */

function sendCompetitor() {
  if (state.sent.includes('竞品对比')) return
  state.sent.push('竞品对比')
  closeWindow('doc:竞品对比'); dismiss('wang')
  setClock(null, state.clock < '09:12' ? '09:12' : state.clock)
  chatPush('王建国', { at: `2026-11-06 ${state.clock}`, from: '林夏', me: true, text: '王总，竞品对比发您，一页版。', attach: '竞品对比' })
  openChat('王建国')
  commitDone('c-wang', state.clock)
  insight({ src: '对外发送', text: '竞品对比 → 王建国（你点了发送）', verdict: 'act', layer: 'R3 对外发送 · 需要你拍板' })
  say('发了，这件事划掉 ✓', 2600, 'quiet'); setMode('idle')
  setTimeout(() => chatPush('王建国', { at: `2026-11-06 ${state.clock}`, from: '王建国（老板）', text: '收到，挺清楚 👍' }), 1600)
}

function sendChenmo() {
  if (state.sent.includes('陈默意见')) return
  state.sent.push('陈默意见')
  closeWindow('doc:陈默意见'); dismiss('wrap')
  chatPush('陈默', { at: `2026-11-06 ${state.clock}`, from: '林夏', me: true, text: '私有化的产品侧意见整理好了，你看看', attach: '陈默意见' })
  openChat('陈默')
  commitDone('c-chen', state.clock)
  insight({ src: '对外发送', text: '私有化意见 → 陈默（你点了发送）', verdict: 'act', layer: 'R3 对外发送 · 需要你拍板' })
  setMode('idle')
  say('今天答应的事全部兑现了 ✓ 一路顺风。', 0, 'quiet')
}

function dropDoc(key) {
  closeWindow('doc:' + key)
  insight({ src: '你', text: `不要「${state.docs[key].title}」这份草稿`, verdict: 'learn', layer: '记入偏好：这类事你想自己来' })
  say('好，这份我收起来了。', 2400, 'quiet'); setMode('idle')
}

/* 驳回一句 → 问原因 → 提议规则 → 你点头才进手册 */
const REWRITE = { '我觉得私有化部署可能是最大的变数': '- **私有化部署是最大变数。** 会脑已经在大客户招标里打这张牌，我们还没有；陈默 11/12 前给评估结论。[来源: docs/会议纪要-1104-产品评审.md#L15][来源: docs/会议纪要-1104-产品评审.md#L24]' }
on('block-reject', ({ key, raw, el }) => {
  document.querySelector('.reason-pop')?.remove()
  const input = h('input', { class: 'reason-input', placeholder: '为什么？说一句我就能学会（可不填）' })
  const submit = reason => { pop.remove(); applyReject(key, raw, reason.trim()) }
  const pop = h('div', { class: 'reason-pop' },
    input,
    h('div', { class: 'reason-chips' }, ['给老板的东西别用「我觉得」', '太长了', '不准确'].map(t => h('button', { class: 'chip', onclick: () => submit(t) }, t))),
    h('div', { class: 'reason-actions' }, h('button', { class: 'btn', onclick: () => pop.remove() }, '算了'), h('button', { class: 'btn btn-primary', onclick: () => submit(input.value) }, '删掉这句')))
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(input.value); if (e.key === 'Escape') pop.remove() })
  el.after(pop)
  input.focus()
})

async function applyReject(key, raw, reason) {
  const d = state.docs[key]
  const hit = Object.keys(REWRITE).find(k => raw.includes(k))
  d.text = d.text.replace(raw + '\n', hit && reason ? REWRITE[hit] + '\n' : '')
  d.highlight = undefined
  refreshDoc(key)
  say(hit && reason ? '改好了：去掉「我觉得」，直接给判断。' : '删掉了。', 2400, 'quiet')
  insight({ src: '你', text: `划掉一句${reason ? '，原因：「' + reason + '」' : '（没说原因）'}`, verdict: 'learn', layer: 'L1 轻量模型：这是可以复用的规则吗？', cost: '≈0.6k token' })
  if (!reason) return
  setMode('think'); await sleep(900)
  const text = /我觉得/.test(reason) ? '给王总（和其他上级）的材料不用「我觉得」，直接给判断和依据' : `写给王总的材料：${reason}`
  card({
    id: 'learn', kind: 'learn',
    title: '要我记住这条吗？',
    body: h('blockquote', { class: 'learn-rule' }, text),
    why: '你说了原因，看起来不只适用于这一次。记住以后，我写东西前会先读它。',
    actions: [
      { label: '记住', primary: true, onClick: () => learn(text, reason) },
      { label: '只是这次', onClick: () => { dismiss('learn'); insight({ src: '你', text: '只是这次，不记', verdict: 'ignore' }) } },
    ],
  })
}

function learn(text, reason) {
  dismiss('learn')
  state.rules.forEach(r => { r.fresh = false })
  state.rules.push({ id: 'r' + (state.rules.length + 1), text, learnedFrom: `${state.clock} 竞品对比 · 你划掉了一句（「${reason}」）`, at: state.clock, fresh: true })
  emit('rules')
  openHandbook()
  insight({ src: '手册', text: `新规则：${text}`, verdict: 'learn', layer: '写入 AGENTS.md，下次任务自动加载' })
  say('记住了，写进手册第 ' + state.rules.length + ' 条。', 2600, 'quiet')
  setMode('idle')
}

/* 周报修订 */
on('revision', ({ key, rev, act }) => {
  const d = state.docs[key]
  if (act === 'accept') {
    d.text = d.text.replace(rev.find, rev.replace); rev.state = 'accepted'
    insight({ src: '你', text: `接受修订：${rev.find} → ${rev.replace}（写回原件，可撤回）`, verdict: 'act', layer: 'R2 改原件 · 你点了接受' })
    say('改好了，随时可以撤回。', 2200, 'quiet')
  } else if (act === 'reject') {
    rev.state = 'rejected'
    insight({ src: '你', text: `不用这条修订（${rev.find} 保留）`, verdict: 'learn', layer: '记一笔：这类核对你可能有自己的口径' })
    say('好，保留你的写法。', 2200, 'quiet')
  } else if (act === 'undo') {
    d.text = d.text.replace(rev.replace, rev.find); rev.state = 'pending'
    insight({ src: '你', text: '撤回了刚才的修改，原文恢复', verdict: 'act', layer: '版本记录' })
  }
  setMode('idle')
  refreshDoc(key)
})

/* 航班连锁 */
const CHAIN = {
  zhang: '张总抱歉，航班延误到 22:15 才落地，今晚的饭赶不上了。明早 8:30 国贸附近一起吃个早餐可以吗？',
  zhou: '周敏你好，航班 MU5137 延误，预计 22:15 到达 T2，麻烦跟李师傅说一下改到 22:15，谢谢！',
}

function sendChain(how) {
  if (state.sent.includes('chain')) return
  state.sent.push('chain')
  dismiss('chain')
  chatPush('张总', { at: `2026-11-06 ${state.clock}`, from: '林夏', me: true, text: CHAIN.zhang })
  state.files['calendar/2026-11-06.md'] = state.files['calendar/2026-11-06.md']
    .replace('（20:15 到达）', '（延误，22:15 到达）')
    .replace('- 20:45 与张总（星河资本）晚餐 · 国贸', '- 20:45 与张总晚餐 → 改到明早 8:30 早餐（等张总确认）')
  commit({ id: 'c-zhang', to: '张总', what: '晚餐改约', due: '今天', source: 'calendar/2026-11-06.md#L7' })
  commitDone('c-zhang', state.clock)
  insight({ src: '对外发送', text: `2 条消息已发：张总（改约）、周敏（接机改时间）—— ${how}`, verdict: 'act', layer: 'R3 对外发送 · 需要你拍板' })
  setTimeout(() => chatPush('张总', { at: `2026-11-06 ${state.clock}`, from: '张总（星河资本）', text: '没问题，明早见，路上注意安全' }), 2200)
}

/* 耳机模式 */
async function goAway() {
  if (state.away || state.sent.includes('chain')) return
  closeAll()
  const pane = setAway(true)
  const log = pane.querySelector('.away-log')
  const ctl = pane.querySelector('.away-ctl')
  const line = (who, text) => { log.append(h('div', { class: `away-line from-${who}` }, text)); log.scrollTop = log.scrollHeight }
  const question = '航班延误两小时，晚上和张总的饭赶不上了。我起草了改约明早早餐的消息，接机也改到十点一刻。要发吗？'
  line('pet', question)
  pane.classList.add('is-speaking')
  await speak(question)
  pane.classList.remove('is-speaking')
  const decide = async text => {
    line('me', text)
    ctl.replaceChildren()
    if (/别|不|等/.test(text)) { line('pet', '好，先不发，你回到电脑再看。'); await speak('好，先不发。') }
    else if (/晚点|待会/.test(text)) { line('pet', '好，一小时后再提醒你。'); await speak('好，一小时后再提醒你。') }
    else { sendChain(`你用语音说了「${text}」`); line('pet', '发了。张总那边我盯着回复。'); await speak('发了。') }
    ctl.append(h('button', { class: 'btn', onclick: () => setAway(false) }, '回到电脑'))
  }
  ctl.replaceChildren(
    canListen() ? h('button', { class: 'btn btn-mic', onclick: async e => {
      e.currentTarget.textContent = '在听…'
      const t = await listen()
      if (t) decide(t); else { e.currentTarget.textContent = '没听清，点我再说'; }
    } }, '🎙 说一句') : null,
    h('button', { class: 'btn btn-primary', onclick: () => decide('发') }, '「发」'),
    h('button', { class: 'btn', onclick: () => decide('先别发') }, '「先别发」'),
    h('button', { class: 'btn', onclick: () => decide('晚点再说') }, '「晚点再说」'))
}

export { openCalendar, openHandbook, isOpen, focus }
