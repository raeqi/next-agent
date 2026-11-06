// 极简 DeepSeek Harness SDK 客户端：stdio 上的逐行 JSON-RPC 2.0。
// 协议见 deepseek-harness/packages/sdk/protocol。零依赖，只用 node 内置模块。

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'

const DEFAULT_DSH = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'

export class Harness {
  /**
   * @param {object} o
   * @param {string} o.cwd  会话工作目录 = sandbox 唯一可写根（workspace-write 模式）。
   *   设为「林夏的电脑」下的 shadow/；电脑根目录要有 .git，AGENTS.md 才会从根到 cwd 被加载。
   * @param {string} [o.model]
   * @param {string} [o.dshBin]
   * @param {(n:{method:string,params:any})=>void} [o.onNotification]
   */
  constructor(o) {
    this.o = { model: 'deepseek-v4-pro', dshBin: process.env.DSH_BIN ?? DEFAULT_DSH, ...o }
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Set()
    if (o.onNotification) this.listeners.add(o.onNotification)
    this.stderrTail = []
  }

  async start() {
    if (!existsSync(this.o.dshBin)) throw new Error(`找不到 dsh：${this.o.dshBin}（可用 DSH_BIN 指定）`)
    this.child = spawn(this.o.dshBin, ['--profile', 'sdk'], {
      cwd: this.o.cwd,
      env: { ...process.env, DSH_PERMISSION_MODE: 'workspace-write' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.exited = new Promise(res => this.child.on('exit', code => {
      for (const { reject } of this.pending.values()) reject(new Error(`dsh 退出 code=${code}\n${this.stderrTail.join('\n')}`))
      this.pending.clear()
      res(code)
    }))
    let buf = ''
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', chunk => {
      buf += chunk
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (line) this.#onLine(line)
      }
    })
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', s => {
      for (const l of s.split('\n')) if (l.trim()) this.stderrTail.push(l)
      if (this.stderrTail.length > 40) this.stderrTail.splice(0, this.stderrTail.length - 40)
    })
    const init = await this.request('initialize', {
      cwd: this.o.cwd,
      provider: 'deepseek-official',
      model: this.o.model,
      ...(this.o.reasoningEffort ? { reasoningEffort: this.o.reasoningEffort } : {}),
    }, 60_000)
    return init
  }

  #onLine(line) {
    let msg
    try { msg = JSON.parse(line) } catch { return }
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code, data: msg.error.data }))
      else p.resolve(msg.result)
    } else if (msg.method !== undefined && msg.id === undefined) {
      for (const fn of this.listeners) fn({ method: msg.method, params: msg.params })
    }
  }

  request(method, params, timeoutMs = 0) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = timeoutMs ? setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} 超时 ${timeoutMs}ms\n${this.stderrTail.join('\n')}`))
      }, timeoutMs) : undefined
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }

  newSessionId() { return `shiyi-${randomUUID().replaceAll('-', '')}` }

  /** 发一条 prompt 并等这个会话（含子 agent）空闲；返回期间收到的该会话事件。 */
  async run(sessionId, text, { onEvent } = {}) {
    const events = []
    const off = this.subscribe(n => {
      if (n.method === 'session.event' && n.params.sessionId === sessionId) {
        events.push(n.params.event)
        onEvent?.(n.params.event)
      }
    })
    try {
      await this.request('session/prompt', { sessionId, contentBlocks: [{ type: 'text', text }] }, 30_000)
      await this.request('session/wait', { sessionId })
    } finally {
      off()
    }
    return events
  }

  async close() {
    if (!this.child || this.child.exitCode !== null) return
    try { await this.request('shutdown', undefined, 2000) } catch { /* 进程可能已退出 */ }
    this.child.stdin.end()
    const t = setTimeout(() => this.child.kill('SIGTERM'), 3000)
    await this.exited
    clearTimeout(t)
  }
}

/** 从会话事件里取最后一条 assistant 文本。 */
export function lastAssistantText(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'assistant/message') {
      const blocks = e.data?.message?.content ?? []
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('')
      if (text) return text
    }
  }
  return ''
}
