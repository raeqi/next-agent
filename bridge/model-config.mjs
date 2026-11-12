// 模型路由：用户只填 key、OpenAI 兼容 base URL 和模型名。
// 运行时需要 provider id 时，自定义地址一律走 openai-compatible，不必声明供应商。
// 旧的 SHIYI_* / MOONSHOT_API_KEY / DEEPSEEK_API_KEY 仍可读。

const LEGACY = {
  'moonshotai-cn': { credential: 'MOONSHOT_API_KEY', triage: 'kimi-k3.1-pro-highspeed', draft: 'kimi-k3.1-pro', catalog: true },
  moonshotai: { credential: 'MOONSHOT_API_KEY', triage: 'kimi-k3.1-pro-highspeed', draft: 'kimi-k3.1-pro', catalog: true },
  'deepseek-official': { credential: 'DEEPSEEK_API_KEY', triage: 'deepseek-v4-flash', draft: 'deepseek-v4-pro', catalog: false, passReasoningEffort: true },
}

export const OPENAI_COMPATIBLE = 'openai-compatible'
export const GENERIC_CREDENTIAL = 'MODEL_API_KEY'
export const DEMO_NOTICE = '演示模式：回复是事先写好的剧本，没有调用真实模型。要体验真实能力，在项目根目录 .env 填写 MODEL_API_KEY、MODEL_BASE_URL 和 MODEL_NAME，然后重新启动。'

const DEMO_FLAGS = new Set(['1', 'true', 'yes', 'on'])
export function demoForced(env = process.env) {
  return DEMO_FLAGS.has((env.DEMO_MODE ?? '').trim().toLowerCase())
}

/** 没有可用 key，或显式 DEMO_MODE=1。有 key 且未强制时走真实模型。 */
export function isDemoMode(env = process.env) {
  if (demoForced(env)) return true
  try { return !modelConfig(env).apiKey }
  catch {
    return !['MODEL_API_KEY', 'SHIYI_API_KEY', 'MOONSHOT_API_KEY', 'DEEPSEEK_API_KEY'].some(key => (env[key] ?? '').trim())
  }
}

const filled = (env, key) => (env[key] ?? '').trim()
const first = (env, keys) => {
  for (const key of keys) {
    const value = filled(env, key)
    if (value) return value
  }
  return ''
}

function legacyProviderId(env) {
  const explicit = filled(env, 'SHIYI_PROVIDER')
  if (explicit) return explicit
  const moonshotSide = filled(env, 'MOONSHOT_API_KEY') || filled(env, 'SHIYI_API_KEY') || filled(env, 'SHIYI_TRIAGE_MODEL') || filled(env, 'SHIYI_DRAFT_MODEL')
  if (!moonshotSide && filled(env, 'DEEPSEEK_API_KEY')) return 'deepseek-official'
  return 'moonshotai-cn'
}

function customKey(env) {
  const named = first(env, ['MODEL_API_KEY', 'SHIYI_API_KEY'])
  if (named) return named
  const hinted = LEGACY[filled(env, 'SHIYI_PROVIDER')]
  if (hinted) {
    const preferred = filled(env, hinted.credential)
    if (preferred) return preferred
  }
  return first(env, ['MOONSHOT_API_KEY', 'DEEPSEEK_API_KEY'])
}

function modelNames(env, defaults = {}) {
  const shared = filled(env, 'MODEL_NAME')
  return {
    triageModel: filled(env, 'MODEL_TRIAGE_NAME') || shared || filled(env, 'SHIYI_TRIAGE_MODEL') || defaults.triage || '',
    draftModel: filled(env, 'MODEL_DRAFT_NAME') || shared || filled(env, 'SHIYI_DRAFT_MODEL') || defaults.draft || '',
  }
}

function blank(extra = {}) {
  return { mode: 'unconfigured', provider: '', credential: GENERIC_CREDENTIAL, apiKey: '', baseURL: '', triageModel: '', draftModel: '', catalog: false, passReasoningEffort: false, ...extra }
}

export function modelConfig(env = process.env) {
  const baseURL = filled(env, 'MODEL_BASE_URL')
  const genericHints = ['MODEL_API_KEY', 'MODEL_NAME', 'MODEL_TRIAGE_NAME', 'MODEL_DRAFT_NAME'].some(key => filled(env, key))
  const legacyHints = ['SHIYI_PROVIDER', 'SHIYI_API_KEY', 'SHIYI_TRIAGE_MODEL', 'SHIYI_DRAFT_MODEL', 'MOONSHOT_API_KEY', 'DEEPSEEK_API_KEY'].some(key => filled(env, key))
  const names = modelNames(env)

  if (baseURL || (genericHints && !legacyHints)) {
    return {
      mode: 'custom',
      provider: OPENAI_COMPATIBLE,
      credential: GENERIC_CREDENTIAL,
      apiKey: customKey(env),
      baseURL,
      ...names,
      catalog: false,
      passReasoningEffort: false,
    }
  }

  if (!legacyHints) return blank()

  const provider = legacyProviderId(env)
  const defaults = LEGACY[provider]
  if (!defaults) throw new Error('不支持的 SHIYI_PROVIDER。请改用 MODEL_API_KEY、MODEL_BASE_URL 和 MODEL_NAME，不必填写供应商。')
  return {
    mode: 'legacy',
    provider,
    credential: defaults.credential,
    apiKey: first(env, ['MODEL_API_KEY', 'SHIYI_API_KEY', defaults.credential]),
    baseURL: '',
    ...modelNames(env, defaults),
    catalog: !!defaults.catalog,
    passReasoningEffort: !!defaults.passReasoningEffort,
  }
}

function isHttp(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch { return false }
}

/** 真实模型配置是否还不完整。没有 key 时不报错，启动方改走演示模式。 */
export function configProblem(route) {
  if (!route.apiKey) return ''
  if (route.mode !== 'custom') return ''
  if (!route.baseURL) return '模型配置不完整。请在 .env 中填写 MODEL_BASE_URL（OpenAI 兼容接口地址）和 MODEL_NAME。'
  if (!isHttp(route.baseURL)) return 'MODEL_BASE_URL 需要是 http 或 https 地址。'
  if (!route.triageModel || !route.draftModel) return '模型配置不完整。请填写 MODEL_NAME，或分别填写 MODEL_TRIAGE_NAME 与 MODEL_DRAFT_NAME。'
  return ''
}

function yamlQuote(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"`
}

function modelLines(ids) {
  const seen = new Set()
  const lines = []
  for (const id of ids) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    lines.push(`          - id: ${yamlQuote(id)}`)
  }
  return lines.join('\n')
}

/** 交给 SDK 的 profile patch。官方 DeepSeek 适配器不需要这段。 */
export function providerPatch(route) {
  if (route.mode === 'legacy' && route.catalog) {
    return `- id: llm-pi-ai
  config:
    providers:
      ${route.provider}:
        apiKeyEnv: ${route.credential}
`
  }
  if (route.mode !== 'custom' || !route.baseURL) return null
  return `- id: llm-pi-ai
  config:
    providers:
      ${OPENAI_COMPATIBLE}:
        displayName: "OpenAI-compatible"
        apiKeyEnv: ${route.credential}
        api: openai-completions
        baseURL: ${yamlQuote(route.baseURL)}
        models:
${modelLines([route.triageModel, route.draftModel])}
`
}
