# HELM 原型 · 内部契约（Lead 维护，改动需同步所有视图）

> 目标：一个纯前端、零依赖、可离线运行的 Agent「任务驾驶舱」原型。
> 同一份源码产出两个运行形态：
> 1) `plugin/client.js` —— DeepSeek Harness 客户端插件（全屏 overlay，跑在真实 DSH GUI 里）
> 2) `dist/index.html` —— 独立静态页（headless Chrome 截图 / 无 Harness 时兜底）
> 禁止：npm 依赖、React、JSX、TypeScript、网络请求。只有原生 DOM + CSS。

## 0. 目录与构建

```
app/src/dom.js          Lead   —— 全局工具 H、SVG 图标、HELM_STYLES
app/src/scenario.js     engine —— 剧本数据（任务/步骤/事件/证据/交付物文案）
app/src/engine.js       engine —— 状态机 createEngine()，无 DOM 依赖
app/src/view-fleet.js   fleet  —— 左栏：舰队列表 + 新建任务
app/src/view-mission.js Lead   —— 中栏：任务头 + 计划 + 执行流
app/src/view-panels.js  panels —— 右栏：待你处理 / 证据 / 上下文 / 交付物
app/src/main.js         Lead   —— 组装、订阅、挂载 mountHelm()
app/src/tokens.css      Lead   —— 设计令牌（颜色/间距/字号/圆角）
app/src/app.css         Lead   —— 布局骨架与共享组件类
app/build.mjs           Lead   —— 拼接 → dist/index.html + plugin/client.js
```

构建顺序（同一 IIFE 作用域，后面的文件可见前面的 `const`）：
`dom.js → scenario.js → engine.js → view-fleet.js → view-mission.js → view-panels.js → main.js`

JS 文件规则：
- 不使用 `import/export`；顶层用 `const` / `function`，全局唯一命名，前缀区分（fleet/mission/panels 视图的函数加对应前缀）。
- 每个视图模块自己往 `HELM_STYLES.push('...')` 追加 CSS（class 一律加模块前缀：`fleet-` / `mission-` / `panel-`），**不要改 app.css**（Lead 独占）。共享 class（按钮、徽标、卡片等）在 app.css，见 §6。
- 文案中文；数字/时间用 `H.fmt*`。

## 1. 设计立场（影响所有文案与交互）

「对话不是终点，驾驶舱才是」。产品三个母题必须在界面里被看见：

1. **任务而非消息**：单位是 Mission（有意图、计划、预算、交付物、证据），对话退化为例外通道。
2. **Harness 而非模型是差异化**：把上下文、记忆、验证、成本、审批做成可见对象。
3. **信任是设计出来的**：自主档位 + 风险分级审批 + 随时接管 + 可回放。

视觉方向：夜间驾驶舱。石墨底色、暖白文字、单一信号色（琥珀）用于「正在发生」，
状态色只用于状态点与风险徽标；细发丝边框、等宽字体跑数字、11–13px 高密度、
大留白只给意图原文。禁止渐变按钮、禁止圆角大于 12px 的大块、禁止彩色图标墙。

## 2. 设计令牌（tokens.css 已定义，直接用 var）

```
--h-bg        画布底          --h-panel   面板底        --h-panel-2 内嵌块
--h-line      发丝线          --h-line-2  强分隔线
--h-text      主文字          --h-text-2  次文字        --h-text-3 弱文字
--h-signal    琥珀·正在发生   --h-signal-dim 琥珀暗底
--h-ok --h-warn --h-err --h-info   状态色
--h-mono      等宽字体        --h-sans    正文
--h-r-sm/md/lg 圆角(6/10/14)  --h-gap-1..4 间距 4/8/12/16
--h-shadow-panel
```
暗色为本体；不要求支持亮色模式（overlay 自带画布）。字号：11 / 11.5 / 12 / 13 / 15 / 19 / 26。

## 3. 状态模型（engine 产出，视图只读）

```ts
type Level = 'observe' | 'propose' | 'drive' | 'auto'   // 自主档位，默认 'drive'
type MissionStatus = 'draft' | 'queued' | 'running' | 'waiting' | 'paused' | 'done' | 'idle'

interface State {
  rev: number            // 每次结构变化 +1；视图仅在 rev 变化时重绘
  clock: string          // "09:12"  模拟时钟
  day: string            // "11月5日 周三"
  autonomy: Level        // 全局默认档位
  budget: { usedUsd: number; capUsd: number; usedTokens: number }
  fleet: FleetItem[]     // 顺序即展示顺序；含分组字段
  selectedId: string
  missions: Record<string, Mission>
  selected: Mission      // === missions[selectedId]（方便视图）
  flash: null | { kind: 'ok'|'warn'; text: string }   // 一次性提示，视图显示后调用 consumeFlash()
}

interface FleetItem {
  id: string
  title: string
  glyph: string          // 图标名，见 §5
  status: MissionStatus
  group: 'need-you' | 'running' | 'standing' | 'done'
  progress: string       // "4/7" 或 "常驻"
  costUsd: number
  elapsed: string        // "12m"
  unread: boolean        // 有待处理 → 呼吸点
}

interface Mission {
  id: string; title: string; glyph: string
  intent: string         // 用户原始意图原文（大字展示）
  status: MissionStatus
  autonomy: Level
  policyNote: string     // 一句话说明该档位下 agent 会怎么做（给用户解释）
  elapsedSec: number; costUsd: number; tokenCount: number; budgetUsd: number
  plan: PlanStep[]
  feed: FeedEvent[]
  approvals: Approval[]          // 全部，含已处理（含 resolvedLabel）
  evidence: Evidence[]
  context: ContextLedger
  artifact: Artifact | null
  takeover: null | { stepId: string; instruction: string }   // 接管态
  replayable: boolean
}

interface PlanStep {
  id: string; index: number
  kind: 'clarify'|'research'|'synthesize'|'verify'|'write'|'deliver'
  title: string; hint: string        // hint 是一句"为什么这一步"
  status: 'pending'|'active'|'done'|'blocked'|'skipped'
  meta?: string                      // "42 条 → 12 条"
}

interface FeedEvent {
  id: string; at: string             // "09:11:04"
  actor: 'agent'|'subagent'|'human'|'system'
  kind: 'note'|'tool'|'artifact'|'approval'|'verify'|'error'|'handoff'
  title: string                      // 一行主句，动词开头
  detail?: string                    // 可展开的原文/观察
  tool?: string                       // 工具名，如 web_search / read / bash
  ms?: number; tokens?: number
  stepId?: string
  evidenceIds?: string[]             // 关联证据，视图渲染为可点的证据 chip
  tone?: 'ok'|'warn'|'err'|'human'
  enters?: boolean                   // engine 不设；视图自己维护 seen 集合做入场动画
}

interface Approval {
  id: string; missionId: string
  kind: 'send'|'choice'|'budget'|'permission'
  title: string; why: string         // 为什么需要你（关键文案）
  risk: 'low'|'med'|'high'
  options: { id: string; label: string; note?: string; danger?: boolean }[]
  status: 'open'|'resolved'
  resolvedLabel?: string
  stepId: string
}

interface Evidence {
  id: string; claim: string
  source: { title: string; org: string; at: string; url: string }
  reliability: 'high'|'med'|'low'
  status: 'ok'|'conflict'|'weak'      // weak → 黄色存疑
  quote: string
}

interface ContextLedger {
  windowTokens: number; capTokens: number
  slices: { key: string; label: string; tokens: number; tone: 'signal'|'ok'|'info'|'warn' }[]
  memory: { text: string; from: string }[]     // 长期记忆条目
  droppedSources: number; compactions: number
}

interface Artifact {
  title: string; kind: 'markdown'
  body: string                        // markdown 子集：# ## - **bold** `code` > quote  1. 链接
  claims: { text: string; evidenceIds: string[] }[]   // 正文论断 → 证据
  verification: { label: string; status: 'pass'|'warn'|'fail'; detail: string }[]
  deliveredTo?: string                // 发送后填 "飞书 · 老板 · 09:14"
}
```

## 4. engine 动作（视图调用，全部同步、幂等安全）

```js
engine.getState()                       // 当前快照（对象可复用，视图不可改）
engine.subscribe(fn) -> unsubscribe      // 状态变化后回调（engine 自己节流到每帧最多一次）
engine.actions.selectMission(id)
engine.actions.setAutonomy(level)        // 全局；同时更新 selected 任务
engine.actions.setMissionAutonomy(id, level)
engine.actions.pause(id) / resume(id)
engine.actions.setSpeed(1 | 4)           // 演示加速
engine.actions.resolveApproval(approvalId, optionId)
engine.actions.takeOver(missionId, stepId, instruction?)   // 进入接管态（运行暂停）
engine.actions.resumeFromTakeover(missionId, instruction)  // 交还并继续
engine.actions.cancelTakeover(missionId)
engine.actions.startMission(intent, templateId?)           // 新建并开始一次模拟运行
engine.actions.confirmPlan(missionId)    // 新任务：确认计划后开跑
engine.actions.replay(missionId)         // 回到该任务的初始剧本状态
engine.actions.consumeFlash()
engine.dispose()
```
引擎内部用 `setTimeout` 推进剧本（可 `opts.now`/`opts.schedule` 注入以便测试），
状态变更后置 `rev++` 并通知订阅者；`clock` 每秒走一次。

## 5. 图标（dom.js 的 `H.icon(name, size)`，stroke=currentColor）

允许的 name：`fleet helm compass radar target spark check x arrow play pause clock coin layercopy replay hand handoff shield eye send file link warn info plus search brain memory box user bot dot chevronDown chevronRight external edit`。
新图标请在 dom.js 里加（Lead 独占），视图先用现有名。

## 6. 共享 class（app.css，视图直接用）

`h-btn`（+ `h-btn--primary` / `h-btn--ghost` / `h-btn--danger`，尺寸默认 28px）
`h-chip`（+ `h-chip--signal|ok|warn|err|dim`）、`h-badge--dot`、`h-kbd`
`h-card`、`h-sec`（小节标题，含 `h-sec__label` 和可选右侧 `h-sec__aside`）
`h-bar`（进度条，`<div class="h-bar"><i style="width:62%"></i></div>`）
`h-mono`、`h-dim`、`h-fade`、`h-scroll`（自定义细滚动条）
`h-empty`（空态：图标+一句说明）
所有视图根节点加 `h-view`。

## 7. 三个视图的接口

```js
function createFleetView(ctx)   // ctx = { engine, H, actions, onNewMission }
  -> { render(state) : HTMLElement }
function createMissionView(ctx)
  -> { render(state, prevState) : HTMLElement }
function createPanelsView(ctx)  // 自管 tab：'inbox'|'evidence'|'context'|'artifact'
  -> { render(state, prevState) : HTMLElement }
```
约定：
- 无状态地渲染，DOM 全部重建；视图内部只允许保存**纯 UI 状态**（如当前 tab、展开集合、seen 集合）。
- 需要输入的控件（新建任务输入框、接管改写框）用局部变量保存值；提交时才调 action。
- 点击事件用 `el.addEventListener`，事件委托也行；不要用内联 onclick 字符串。
- 列表项带 `data-id`，便于测试脚本断言（`[data-testid=...]` 更佳，关键控件都加上）。
- 若无数据（如任务无 artifact）渲染 `h-empty`，不要抛错。

## 8. 必须可被脚本断言的 testid（验证会用到）

```
helm-root  fleet-list  fleet-item-<id>  fleet-new
mission-intent  mission-plan  mission-feed  mission-step-<id>
inbox-approve-<approvalId>  inbox-option-<optionId>
panels-tab-inbox|evidence|context|artifact
artifact-body  verify-item-<i>  evidence-item-<id>  ctx-slice-<key>
```

## 9. 完成标准（自检）

- 在 `node app/build.mjs` 后，`dist/index.html` 直接打开可完整互动：切任务、审批、接管、新建、重跑。
- 没有任何 JS 报错；1280×800 与 1600×1000 都不出现横向滚动、不重叠、不截断关键按钮。
- 文案全部中文，无 "TODO/lorem/placeholder"。

## 10. 剧本格式（scenario ↔ engine 的边界）

`scenario.js` 只导出数据 `const SCENARIO = {...}`（纯数据、无函数），`engine.js` 负责播放。

```js
SCENARIO = {
  day: '11月5日 周三',
  startClock: 552,                 // 09:12，单位分钟
  autonomy: 'drive',
  budget: { usedUsd: 5.2, capUsd: 20, usedTokens: 1_840_000 },
  missions: [MissionSpec, ...],    // 顺序即舰队顺序；第一个默认选中
  templates: { ... },              // 新建任务用的剧本模板，见下
}

MissionSpec = {
  id, title, glyph, group,         // group 初始分组
  intent, status,                  // 打开瞬间的状态
  autonomy?, policyNote,
  elapsedSec, costUsd, tokenCount, budgetUsd,
  plan: PlanStep[],                // 初始状态：已完成/进行中/待办/被卡住
  feed: FeedEvent[],               // 初始快照（引擎补 at/id）
  approvals: Approval[],           // 初始审批（可含 open 或 resolved）
  evidence: Evidence[],
  context: ContextLedger,
  artifact: Artifact | null,
  beats: Beat[] | undefined,       // 从这里往后继续播放（done/纯常驻任务可省略）
  autoResolve?: { approvalId: string; level: Level; delayMs: number; label: string }[]
}

Beat = { t: number, ... }          // t = 相对上一个 beat 的等待毫秒数
  { t, kind: 'feed',     event: Partial<FeedEvent> }        // 引擎补 id/at/actor 默认 'agent'
  { t, kind: 'plan',     stepId, status, meta? }
  { t, kind: 'approval', approval: Approval }               // 打开审批 → mission.status='waiting'，后续 beat 等用户处理
  { t, kind: 'artifact', artifact: Artifact }
  { t, kind: 'mission',  status, policyNote?, group? }
  { t, kind: 'budget',   costUsd?, tokenCount?, elapsedSec? }
```
播放语义：
- 每个 mission 独立计时；`paused` 的任务不推进。`setSpeed(4)` 让等待时间除以 4。
- 打开审批时任务停在审批处，`resolveApproval(id, optionId)` 后继续后续 beat；
  `approval.autoResolve` 场景：当任务自主档位 >= `level` 时，不打扰用户，`delayMs` 后自动以 `label` 解决。
- 接管（takeOver）暂停该任务；`resumeFromTakeover` 追加一条 `actor:'human'` 的 feed，
  并把后续 beat 的等待缩短一半（"人类给过方向后 agent 更快"的叙事），然后继续。
- `replay(id)` 把任务重置回 `MissionSpec` 的初始快照并重播。
- `startMission(intent, templateId)`：用模板生成一个新 mission（id 自增 `m-user-<n>`），
  标题取意图前 18 字，插到舰队最前，选中并开始播放。
- 时钟：`clock = startClock + floor(总播放秒数 / 60)`，每秒更新一次（即使暂停也走，像真实世界时间）。

模板（`SCENARIO.templates` 至少 3 个，键名固定）：
```js
{ research: {...}, build: {...}, watch: {...} }   // 每个模板 = MissionSpec 去掉 id 的骨架
```
新建任务 UI 给三个快捷意图 + 自由输入，自由输入时用 `research` 模板但保留用户原文作为 intent。
