// 官方 SDK 的兼容适配层。运行时由项目依赖解析，不依赖桌面版或其登录态。
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { modelConfig } from './model-config.mjs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { homedir } from 'node:os'

export class Harness {
  constructor(o = {}) {
    this.o = o
    const route = modelConfig()
    const apiKey = route.apiKey
    if (!apiKey) throw new Error('缺少 API key：请复制 .env.example 为 .env 并填写 SHIYI_API_KEY，再用 npm start 启动')
    // 只传必需的系统环境和显式凭据，不继承宿主其他模型账号或 DSH_HOME。
    const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'SHELL', 'SYSTEMROOT', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'].filter(k => process.env[k]).map(k => [k, process.env[k]]))
    env[route.credential] = apiKey
    env.DSH_PERMISSION_MODE = 'workspace-write'
    const home = process.env.SHIYI_HOME || join(homedir(), '.shiyi')
    this.sdk = new DeepSeekHarness({
      profile: 'sdk', cwd: o.cwd, processCwd: o.cwd,
      dshHome: join(home, 'runtime'), env,
      model: o.model || route.draftModel,
      provider: route.provider,
      ...(o.reasoningEffort && route.provider === 'deepseek-official' ? { reasoningEffort: o.reasoningEffort } : {}),
      initializeTimeoutMs: 60000, requestTimeoutMs: 180000,
    })
  }
  start() { return this.sdk.start() }
  request(method, params) { return this.sdk.client.request(method, params) }
  newSessionId() { return `shiyi-${randomUUID().replaceAll('-', '')}` }
  async run(sessionId, text, { onEvent } = {}) {
    const result = await this.sdk.run(text, { sessionId, onNotification: n => {
      if (n.method === 'session.event' && n.params.sessionId === sessionId) onEvent?.(n.params.event)
    } })
    if (result.finishReason === 'error') throw new Error(result.finalResponse || '模型执行失败')
    return result.events
  }
  close() { return this.sdk.close() }
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
