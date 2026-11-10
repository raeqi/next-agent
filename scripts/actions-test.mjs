// 隔离桥测试：验证宿主控制逻辑，不替代真实 macOS AX 实测。
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const dir = mkdtempSync(join(tmpdir(), 'shiyi-actions-test-'))
process.env.SHIYI_HOME = join(dir, 'home')
const pagePath = join(dir, 'page.json'), bridge = join(dir, 'bridge')
const baseline = { bundle: 'org.shiyi.test', elements: [{ id: 0, role: 'AXTextField', title: '测试输入框', value: '' }] }
writeFileSync(pagePath, JSON.stringify(baseline))
writeFileSync(bridge, `#!/usr/bin/env node
const fs=require('node:fs'), path=${JSON.stringify(pagePath)};
const p=JSON.parse(fs.readFileSync(path));
if(process.argv[2]==='--inspect')console.log(JSON.stringify(p));
else{let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const a=JSON.parse(s);p.elements[a.id].value=a.text;fs.writeFileSync(path,JSON.stringify(p));console.log(JSON.stringify({ok:true}));});}
`)
chmodSync(bridge, 0o755)
process.env.SHIYI_NATIVE_BINARY = bridge
const { config, live } = await import('../daemon/store.mjs')
const { executePlan, digest } = await import('../daemon/actions.mjs')
const bundle = baseline.bundle
config.apps = { [bundle]: 'on' }; config.operations = { [bundle]: 'off' }; live.eyes = true
const card = () => ({ bundle, plan: { snapshot: digest(JSON.parse(readFileSync(pagePath))), step: { op: 'setValue', id: 0, text: '测试结果' } } })
let passed = 0
async function check(name, fn) { await fn(); passed++; console.log('PASS', name) }
try {
 await check('只观察拒绝执行', async()=>assert.rejects(executePlan(card()), /没有操作权限/))
 config.operations[bundle] = 'ask'
 await check('确认模式拒绝自动执行', async()=>assert.rejects(executePlan(card(), true), /没有操作权限/))
 await check('手动执行并核对结果', async()=>{const c=card(); await executePlan(c);assert.equal(c.execution,'verified')})
 await check('页面变化拒绝旧计划', async()=>{const c=card();const p=JSON.parse(readFileSync(pagePath));p.elements[0].value='changed';writeFileSync(pagePath,JSON.stringify(p));await assert.rejects(executePlan(c),/页面已变化/)})
 config.operations[bundle] = 'auto'; config.autoTargets = { [bundle]: [] }
 await check('未授权控件拒绝自动填写', async()=>assert.rejects(executePlan(card(),true),/自动执行范围/))
 config.autoTargets[bundle] = ['测试输入框']
 await check('指定控件自动填写并验证', async()=>{const c=card();await executePlan(c,true);assert.equal(c.execution,'verified')})
 live.eyes = false
 await check('闭眼拒绝操作', async()=>assert.rejects(executePlan(card()),/观察已暂停/))
 live.eyes = true; config.apps[bundle] = 'off'
 await check('撤销观察拒绝操作', async()=>assert.rejects(executePlan(card()),/授权已撤销/))
 console.log(`${passed} checks passed; simulated bridge only`)
} finally {
 // store 的异步保存定时器稍后会访问此目录，退出时再清理。
 process.on('exit',()=>rmSync(dir,{recursive:true,force:true}))
}
