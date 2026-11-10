// 前后端共用动作分配，避免不同页面各自猜测任务状态。
export const isComplete = status => ['completed', 'done'].includes(status)
export function opportunityMode(c) {
  if (['analysis', 'task', 'ui'].includes(c.actionMode)) return c.actionMode
  if (['troubleshoot', 'workflow'].includes(c.opportunityType)) return 'task'
  return 'analysis' // 旧卡片不猜测为可操作界面
}
export function opportunityActions(c) {
  if (c.stale) return ['refresh', 'dismiss']
  if (c.status === 'delegated') return ['task', 'dismiss']
  if (c.execution === 'verified') return ['dismiss']
  if (c.status === 'working' || c.execution === 'running') return []
  if (c.result) return ['copy-result', 'dismiss']
  if (c.plan) return ['execute', 'dismiss']
  return [opportunityMode(c), 'dismiss']
}
