const PROVIDERS = {
  'moonshotai-cn': { credential: 'MOONSHOT_API_KEY', triage: 'kimi-k3.1-pro-highspeed', draft: 'kimi-k3.1-pro' },
  moonshotai: { credential: 'MOONSHOT_API_KEY', triage: 'kimi-k3.1-pro-highspeed', draft: 'kimi-k3.1-pro' },
  'deepseek-official': { credential: 'DEEPSEEK_API_KEY', triage: 'deepseek-v4-flash', draft: 'deepseek-v4-pro' },
}
export function modelConfig(env = process.env) {
  const provider = env.SHIYI_PROVIDER || 'moonshotai-cn'
  const defaults = PROVIDERS[provider]
  if (!defaults) throw new Error('不支持的 SHIYI_PROVIDER，请参考 .env.example')
  return { provider, credential: defaults.credential, apiKey: (env.SHIYI_API_KEY || env[defaults.credential] || '').trim(), triageModel: env.SHIYI_TRIAGE_MODEL || defaults.triage, draftModel: env.SHIYI_DRAFT_MODEL || defaults.draft }
}
