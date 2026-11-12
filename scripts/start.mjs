import { configProblem, modelConfig } from '../bridge/model-config.mjs'
import { spawn } from 'node:child_process'
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 24 || (major === 24 && minor < 9)) { console.error('需要 Node 24.9+，请升级 Node 后重试'); process.exit(1) }
let route
try { route = modelConfig() } catch (e) { console.error(e.message); process.exit(1) }
const problem = configProblem(route)
if (problem) { console.error(problem); process.exit(1) }
if (process.platform !== 'darwin' && !process.argv.includes('--no-pet')) {
  console.error('原生桌宠需要 macOS；仅启动后台请用 npm run start:headless'); process.exit(1)
}
const child = process.argv.includes('--no-pet')
  ? spawn(process.execPath, ['daemon/main.mjs', '--no-pet', '--port', process.env.SHIYI_PORT || '18746'], { stdio: 'inherit' })
  : spawn('sh', ['scripts/start-desktop.sh'], { stdio: 'inherit' })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('error', e => { console.error(e.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
