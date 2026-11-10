import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Harness, lastAssistantText } from '../bridge/harness.mjs'
// 独立空目录验证，不读取桌面软件已有凭据或用户材料。
const dir = mkdtempSync(join(tmpdir(), 'shiyi-model-check-'))
process.env.SHIYI_HOME = dir
let h
try {
  h = new Harness({ cwd: dir, model: process.env.SHIYI_TRIAGE_MODEL || 'deepseek-v4-flash', reasoningEffort: 'off' })
  await h.start()
  const result = lastAssistantText(await h.run(h.newSessionId(), '不要调用工具，只回复 SHIYI_OK'))
  if (!result.includes('SHIYI_OK')) throw new Error('模型未返回预期测试内容')
  console.log('模型连接通过：项目内 SDK + 运行时 + 独立配置目录')
} catch (e) { console.error(e.message); process.exitCode = 1 }
finally { await h?.close(); rmSync(dir, { recursive: true, force: true }) }
