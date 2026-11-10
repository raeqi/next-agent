import assert from 'node:assert/strict'
import { opportunityActions as actions, isComplete } from '../pet/action-policy.mjs'
for (const mode of ['analysis', 'task', 'ui']) assert.deepEqual(actions({ actionMode: mode }), [mode, 'dismiss'])
assert.deepEqual(actions({ stale: true, plan: {} }), ['refresh', 'dismiss'])
assert.deepEqual(actions({ status: 'working' }), [])
assert.deepEqual(actions({ execution: 'running' }), [])
assert.deepEqual(actions({ result: '结果' }), ['copy-result', 'dismiss'])
assert.deepEqual(actions({ execution: 'verified', plan: {} }), ['dismiss'])
assert.deepEqual(actions({ status: 'delegated' }), ['task', 'dismiss'])
assert.deepEqual(actions({}), ['analysis', 'dismiss'])
assert.ok(isComplete('completed') && isComplete('done') && !isComplete('running'))
console.log('任务动作类型、状态、过期与旧卡片策略检查通过')
