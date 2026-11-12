import assert from 'node:assert/strict'
import { configProblem, DEMO_NOTICE, isDemoMode, modelConfig, providerPatch } from '../bridge/model-config.mjs'

let passed = 0
function check(name, fn) { fn(); passed++; console.log('PASS', name) }

check('未配置 key 时进入演示模式，并说明如何换成真实模型', () => {
  const route = modelConfig({})
  assert.equal(route.apiKey, '')
  assert.equal(configProblem(route), '')
  assert.equal(isDemoMode({}), true)
  assert.match(DEMO_NOTICE, /MODEL_API_KEY/)
  assert.match(DEMO_NOTICE, /MODEL_BASE_URL/)
  assert.match(DEMO_NOTICE, /MODEL_NAME/)
  assert.equal(isDemoMode({ MODEL_API_KEY: 'k', MODEL_BASE_URL: 'https://example.test/v1', MODEL_NAME: 'm' }), false)
  assert.equal(isDemoMode({ MODEL_API_KEY: 'k', MODEL_BASE_URL: 'https://example.test/v1', MODEL_NAME: 'm', DEMO_MODE: '1' }), true)
  assert.equal(isDemoMode({ SHIYI_API_KEY: 'legacy' }), false)
})

check('key、地址和模型名走 OpenAI 兼容路由', () => {
  const route = modelConfig({
    MODEL_API_KEY: ' sk-test ',
    MODEL_BASE_URL: ' https://example.test/v1 ',
    MODEL_NAME: ' demo-model ',
  })
  assert.equal(configProblem(route), '')
  assert.equal(route.mode, 'custom')
  assert.equal(route.provider, 'openai-compatible')
  assert.equal(route.credential, 'MODEL_API_KEY')
  assert.equal(route.apiKey, 'sk-test')
  assert.equal(route.baseURL, 'https://example.test/v1')
  assert.equal(route.triageModel, 'demo-model')
  assert.equal(route.draftModel, 'demo-model')
  const patch = providerPatch(route)
  assert.match(patch, /api: openai-completions/)
  assert.match(patch, /baseURL: "https:\/\/example\.test\/v1"/)
  assert.match(patch, /id: "demo-model"/)
  assert.equal(patch.match(/id: "demo-model"/g).length, 1)
  assert.doesNotMatch(patch, /sk-test|moonshot|deepseek-official/)
})

check('判断模型和执行模型可分开，并回落到 MODEL_NAME', () => {
  const split = modelConfig({
    MODEL_API_KEY: 'k', MODEL_BASE_URL: 'https://example.test/v1',
    MODEL_NAME: 'shared', MODEL_TRIAGE_NAME: 'fast', MODEL_DRAFT_NAME: 'strong',
  })
  assert.equal(split.triageModel, 'fast')
  assert.equal(split.draftModel, 'strong')
  const shared = modelConfig({ MODEL_API_KEY: 'k', MODEL_BASE_URL: 'https://example.test/v1', MODEL_NAME: 'shared' })
  assert.equal(shared.triageModel, 'shared')
  assert.equal(shared.draftModel, 'shared')
  const patch = providerPatch(split)
  assert.match(patch, /id: "fast"/)
  assert.match(patch, /id: "strong"/)
})

check('只有 key 时要求地址和模型名', () => {
  const route = modelConfig({ MODEL_API_KEY: 'k' })
  assert.match(configProblem(route), /MODEL_BASE_URL/)
  assert.match(configProblem(route), /MODEL_NAME/)
})

check('非法地址被拒绝', () => {
  const route = modelConfig({ MODEL_API_KEY: 'k', MODEL_BASE_URL: 'ftp://example.test', MODEL_NAME: 'm' })
  assert.match(configProblem(route), /MODEL_BASE_URL/)
})

check('模型名里的引号会被转义，且补丁不含 key', () => {
  const route = modelConfig({
    MODEL_API_KEY: 'secret-key',
    MODEL_BASE_URL: 'https://gateway.test/v1',
    MODEL_NAME: 'say "hi"',
  })
  const patch = providerPatch(route)
  assert.match(patch, /id: "say \\"hi\\""/)
  assert.doesNotMatch(patch, /secret-key/)
})

check('旧的 Kimi 配置仍走原供应商和默认模型', () => {
  const route = modelConfig({ SHIYI_PROVIDER: 'moonshotai-cn', SHIYI_API_KEY: 'moon-key' })
  assert.equal(configProblem(route), '')
  assert.equal(route.mode, 'legacy')
  assert.equal(route.provider, 'moonshotai-cn')
  assert.equal(route.credential, 'MOONSHOT_API_KEY')
  assert.equal(route.apiKey, 'moon-key')
  assert.equal(route.triageModel, 'kimi-k3.1-pro-highspeed')
  assert.equal(route.draftModel, 'kimi-k3.1-pro')
  const patch = providerPatch(route)
  assert.match(patch, /moonshotai-cn:\n {8}apiKeyEnv: MOONSHOT_API_KEY/)
  assert.doesNotMatch(patch, /openai-completions|baseURL/)
})

check('只填 MOONSHOT_API_KEY 或 SHIYI_API_KEY 时沿用中国站默认', () => {
  const moon = modelConfig({ MOONSHOT_API_KEY: 'from-env' })
  assert.equal(moon.provider, 'moonshotai-cn')
  assert.equal(moon.apiKey, 'from-env')
  const shiyi = modelConfig({ SHIYI_API_KEY: 'shiyi-key', SHIYI_TRIAGE_MODEL: 'kimi-custom' })
  assert.equal(shiyi.provider, 'moonshotai-cn')
  assert.equal(shiyi.apiKey, 'shiyi-key')
  assert.equal(shiyi.triageModel, 'kimi-custom')
  assert.equal(shiyi.draftModel, 'kimi-k3.1-pro')
})

check('DeepSeek 旧配置走官方适配器，不生成兼容补丁', () => {
  const route = modelConfig({ SHIYI_PROVIDER: 'deepseek-official', DEEPSEEK_API_KEY: 'ds-key' })
  assert.equal(route.provider, 'deepseek-official')
  assert.equal(route.credential, 'DEEPSEEK_API_KEY')
  assert.equal(route.apiKey, 'ds-key')
  assert.equal(route.triageModel, 'deepseek-flash')
  assert.equal(route.draftModel, 'deepseek-v4-pro')
  assert.equal(route.passReasoningEffort, true)
  assert.equal(providerPatch(route), null)
  const onlyKey = modelConfig({ DEEPSEEK_API_KEY: 'ds-only' })
  assert.equal(onlyKey.provider, 'deepseek-official')
  assert.equal(onlyKey.apiKey, 'ds-only')
})

check('新变量优先于旧变量', () => {
  const route = modelConfig({
    MODEL_API_KEY: 'new-key',
    MODEL_BASE_URL: 'https://proxy.test/v1',
    MODEL_NAME: 'proxy-model',
    SHIYI_PROVIDER: 'deepseek-official',
    SHIYI_API_KEY: 'old-key',
    DEEPSEEK_API_KEY: 'ds-key',
    SHIYI_TRIAGE_MODEL: 'old-triage',
    SHIYI_DRAFT_MODEL: 'old-draft',
  })
  assert.equal(route.mode, 'custom')
  assert.equal(route.provider, 'openai-compatible')
  assert.equal(route.apiKey, 'new-key')
  assert.equal(route.triageModel, 'proxy-model')
  assert.equal(route.draftModel, 'proxy-model')
  assert.equal(route.passReasoningEffort, false)
})

check('没有新地址时，新模型名可以覆盖旧供应商的默认模型', () => {
  const route = modelConfig({
    SHIYI_PROVIDER: 'moonshotai',
    MOONSHOT_API_KEY: 'moon',
    MODEL_NAME: 'kimi-shared',
    MODEL_DRAFT_NAME: 'kimi-draft',
  })
  assert.equal(route.mode, 'legacy')
  assert.equal(route.provider, 'moonshotai')
  assert.equal(route.triageModel, 'kimi-shared')
  assert.equal(route.draftModel, 'kimi-draft')
  assert.equal(route.apiKey, 'moon')
})

check('新 key 可以配旧供应商', () => {
  const route = modelConfig({ MODEL_API_KEY: 'moved', SHIYI_PROVIDER: 'deepseek-official' })
  assert.equal(route.mode, 'legacy')
  assert.equal(route.apiKey, 'moved')
  assert.equal(route.credential, 'DEEPSEEK_API_KEY')
})

check('未知的旧供应商会说明改用新变量', () => {
  assert.throws(() => modelConfig({ SHIYI_PROVIDER: 'some-vendor', SHIYI_API_KEY: 'k' }), /MODEL_API_KEY、MODEL_BASE_URL 和 MODEL_NAME/)
})

check('新地址沿用旧供应商对应的 key', () => {
  const route = modelConfig({
    MODEL_BASE_URL: 'https://api.deepseek.com',
    MODEL_NAME: 'deepseek-v4-pro',
    SHIYI_PROVIDER: 'deepseek-official',
    DEEPSEEK_API_KEY: 'ds',
    MOONSHOT_API_KEY: 'moon',
  })
  assert.equal(route.mode, 'custom')
  assert.equal(route.provider, 'openai-compatible')
  assert.equal(route.apiKey, 'ds')
  assert.match(providerPatch(route), /baseURL: "https:\/\/api\.deepseek\.com"/)
})

check('有新地址时忽略未知的旧供应商', () => {
  const route = modelConfig({
    SHIYI_PROVIDER: 'some-vendor',
    MODEL_BASE_URL: 'https://gateway.test/v1',
    MODEL_NAME: 'm',
    SHIYI_API_KEY: 'legacy-key',
  })
  assert.equal(route.provider, 'openai-compatible')
  assert.equal(route.apiKey, 'legacy-key')
})

console.log(`${passed} checks passed`)
