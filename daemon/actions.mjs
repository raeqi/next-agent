// 执行前重新读取 AX 快照；权限、目标和内容变化均在宿主检查。
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { config, live, paused, state, changed } from './store.mjs'
const binary = process.env.SHIYI_NATIVE_BINARY || new URL('../native/build/Shiyi.app/Contents/MacOS/Shiyi', import.meta.url).pathname
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const invoke = (args, input) => new Promise((resolve, reject) => {
  const child = execFile(binary, args, { timeout: 12000, maxBuffer: 2 << 20 }, (error, stdout) => {
    let result; try { result = JSON.parse(stdout) } catch { return reject(error || new Error('原生桥没有返回结果')) }
    if (error || result.error || result.ok === false) reject(new Error(result.error || '操作失败：' + result.code)); else resolve(result)
  }); child.stdin.end(input ? JSON.stringify(input) : '')
})
export const inspect = bundle => invoke(['--inspect', bundle])
export function authorized(bundle) {
  if (!live.eyes || paused() || config.apps[bundle] !== 'on') throw new Error('观察已暂停或授权已撤销')
}
export async function executePlan(card, automatic = false) {
  authorized(card.bundle)
  const permission = config.operations?.[card.bundle] ?? 'off'
  if (permission === 'off' || (automatic && permission !== 'auto')) throw new Error('没有操作权限')
  if (!card.plan || card.execution === 'running') throw new Error('没有可执行计划或正在执行')
  const before = await inspect(card.bundle)
  if (digest(before) !== card.plan.snapshot) throw new Error('页面已变化，请重新生成计划')
  const step = card.plan.step
  const target = before.elements.find(e => e.id === step.id)
  if (!target || target.role === 'AXSecureTextField' || !['setValue', 'press'].includes(step.op)) throw new Error('无效操作目标')
  if (step.op === 'press' && /发送|发布|删除|支付|购买|授权|send|publish|delete|pay|buy|allow/i.test(target.title)) throw new Error('此类外部或破坏性操作需要在原应用中完成')
  if (step.op === 'setValue' && (typeof step.text !== 'string' || !['AXTextField', 'AXTextArea', 'AXComboBox'].includes(target.role))) throw new Error('只允许填写文本控件')
  // 自动化仅允许用户明确指定的文本框；点击始终需要单次确认。
  if (automatic && (step.op !== 'setValue' || !target.title || !(config.autoTargets?.[card.bundle] ?? []).includes(target.title))) throw new Error('自动执行范围不包含这个控件')
  card.execution = 'running'; changed()
  const record = { at: new Date().toISOString(), bundle: card.bundle, automatic, step, before: digest(before) }
  try {
    authorized(card.bundle)
    await invoke(['--execute', card.bundle], step)
    const after = await inspect(card.bundle)
    record.after = digest(after)
    const actual = after.elements.find(e => e.id === step.id)
    const verified = step.op === 'setValue' ? actual?.role === target.role && actual?.title === target.title && actual?.value === step.text : false // 点击后的变化不足以证明目标完成，保留为待检查
    card.execution = verified ? 'verified' : 'unverified'
    record.status = card.execution
    card.executionMessage = verified ? '已执行，重新读取界面验证通过' : '操作已发出，但未能验证预期结果，请检查'
  } catch (e) { record.status = 'failed'; record.error = e.message; card.execution = 'failed'; card.executionMessage = e.message; throw e }
  finally { (state.audit ??= []).push(record); state.audit = state.audit.slice(-200); changed() }
}
