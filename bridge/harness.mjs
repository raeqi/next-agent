// 官方 SDK 的兼容适配层。运行时由项目依赖解析，不依赖桌面版或其登录态。
// 演示模式不加载 SDK，只回剧本。
import { configProblem, isDemoMode, modelConfig, providerPatch } from './model-config.mjs'
import { demoRun } from './demo-model.mjs'
import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

function routePatch(route, home) {
  const yaml = providerPatch(route)
  if (!yaml) return
  const dir = join(home, 'runtime')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'shiyi-provider.cordis.yml')
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, yaml)
  renameSync(tmp, file)
  return file
}

export class Harness {
  constructor(o = {}) {
    this.o = o
    this.demo = isDemoMode()
    if (this.demo) return
    const route = modelConfig()
    const problem = configProblem(route)
    if (problem) throw new Error(problem)
    this.route = route
  }
  start() {
    if (this.demo) return Promise.resolve()
    this.booting ??= this.#boot()
    return this.booting
  }
  async #boot() {
    const { DeepSeekHarness } = await import('@deepseek-ai/dsh-sdk-client')
    const route = this.route
    // 只传必需的系统环境和显式凭据，不继承宿主其他模型账号或 DSH_HOME。
    const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'SHELL', 'SYSTEMROOT', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'].filter(k => process.env[k]).map(k => [k, process.env[k]]))
    env[route.credential] = route.apiKey
    env.DSH_PERMISSION_MODE = 'workspace-write'
    const home = process.env.SHIYI_HOME || join(homedir(), '.shiyi')
    const patch = routePatch(route, home)
    this.sdk = new DeepSeekHarness({
      profile: 'sdk', cwd: this.o.cwd, processCwd: this.o.cwd,
      dshHome: join(home, 'runtime'), env,
      model: this.o.model || route.draftModel,
      provider: route.provider,
      ...(patch ? { patches: [patch] } : {}),
      ...(this.o.reasoningEffort && route.passReasoningEffort ? { reasoningEffort: this.o.reasoningEffort } : {}),
      initializeTimeoutMs: 60000, requestTimeoutMs: 180000,
    })
    return this.sdk.start()
  }
  request(method, params) { return this.demo ? Promise.resolve() : this.sdk.client.request(method, params) }
  newSessionId() { return `shiyi-${randomUUID().replaceAll('-', '')}` }
  async run(sessionId, text, { onEvent } = {}) {
    if (this.demo) return demoRun(this.o.cwd, text, onEvent)
    const result = await this.sdk.run(text, { sessionId, onNotification: n => {
      if (n.method === 'session.event' && n.params.sessionId === sessionId) onEvent?.(n.params.event)
    } })
    if (result.finishReason === 'error') throw new Error(result.finalResponse || '模型执行失败')
    return result.events
  }
  close() { return this.demo ? Promise.resolve() : this.sdk?.close() }
}
export function lastAssistantText(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'assistant/message') {
      const text = (e.data?.message?.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
      if (text) return text
    }
  }
  return ''
}
