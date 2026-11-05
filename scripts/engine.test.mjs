#!/usr/bin/env node
/**
 * HELM · engine.js 单元测试（零依赖，node 直接跑）
 *
 * 做法：读 app/src/engine.js 源码，在 node:vm 沙箱里和一份「测试自带 fixture 剧本」
 * 拼成同一个 script 执行（和 app/build.mjs 的顺序拼接方式一致），并注入假的
 * setTimeout / Date / requestAnimationFrame，让 20 秒剧本可以瞬间跑完。
 *
 * 测试不依赖 Lead 的 scenario.js 内容：fixture 写在本文件里。
 * 但若 app/src/scenario.js 存在，会额外跑一个「真实剧本冒烟」，保证集成时不炸。
 *
 * 用法：node scripts/engine.test.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, Script } from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..', 'app');
const ENGINE_PATH = join(APP_DIR, 'src', 'engine.js');
const SCENARIO_PATH = join(APP_DIR, 'src', 'scenario.js');

const engineSrc = readFileSync(ENGINE_PATH, 'utf8');

/* ══════════════════════════════════════════════════════════════
 * 1. fixture 剧本（engine 只消费数据，所以测试可以完全自己造）
 * ══════════════════════════════════════════════════════════════ */

const FIXTURE = {
  day: '11月5日 周三',
  startClock: 552, // 09:12
  autonomy: 'drive',
  budget: { usedUsd: 5.2, capUsd: 20, usedTokens: 1840000 },
  missions: [
    {
      id: 'm-weekly',
      title: '竞品周报 · 第 45 周',
      glyph: 'radar',
      group: 'need-you',
      intent: '盯住竞品过去一周的动作，收成一页周报，09:30 前发我飞书。',
      status: 'waiting',
      autonomy: 'drive',
      policyNote: '代驾：常规动作自己做，对外发送才叫你。',
      elapsedSec: 396,
      costUsd: 0.42,
      tokenCount: 214000,
      budgetUsd: 2.4,
      plan: [
        { id: 's-a', index: 0, kind: 'research', title: '扫来源', hint: '官方源优先', status: 'done', meta: '42 条 → 12 条' },
        { id: 's-b', index: 1, kind: 'verify', title: '交叉验证', hint: '对不上就问你', status: 'blocked', meta: '1 处冲突' },
      ],
      feed: [
        { id: 'f-1', at: '09:10:02', actor: 'agent', kind: 'note', stepId: 's-b', title: '先停下来问你：这个数字以哪个为准？', tone: 'human' },
      ],
      approvals: [
        {
          id: 'ap-price',
          missionId: 'm-weekly',
          kind: 'choice',
          stepId: 's-b',
          title: 'Cursor 定价对不上，以哪个为准？',
          why: '猜错会让整份定价对标结论偏掉。',
          risk: 'med',
          options: [
            { id: 'opt-official', label: '以官方为准' },
            { id: 'opt-both', label: '两个都写，标注口径' },
          ],
          status: 'open',
        },
        {
          id: 'ap-old',
          missionId: 'm-weekly',
          kind: 'permission',
          stepId: 's-a',
          title: '允许读取内部文档库？',
          why: '只读',
          risk: 'low',
          options: [{ id: 'opt-net', label: '允许（只读）' }],
          status: 'resolved',
          resolvedLabel: '允许一次 · 09:04',
        },
      ],
      evidence: [],
      context: {
        windowTokens: 14800,
        capTokens: 128000,
        slices: [{ key: 'system', label: '系统提示', tokens: 8200, tone: 'info' }],
        memory: [{ text: '输出先给结论', from: '来自你的偏好' }],
        droppedSources: 2,
        compactions: 0,
      },
      artifact: null,
      beats: [
        { t: 1000, kind: 'plan', stepId: 's-b', status: 'done', meta: '2 源对照' },
        { t: 500, kind: 'feed', event: { actor: 'agent', kind: 'tool', stepId: 's-b', tool: 'write', title: '起草周报正文', tokens: 6100 } },
        {
          t: 500,
          kind: 'artifact',
          artifact: {
            title: '第 45 周竞品周报',
            kind: 'markdown',
            body: '# 周报',
            claims: [],
            verification: [{ label: '引用完整', status: 'pass', detail: '12 条论断有来源' }],
          },
        },
        { t: 500, kind: 'artifact', artifact: null, merge: true, deliver: '飞书 · 老板 · 刚刚' },
        { t: 500, kind: 'mission', status: 'done', group: 'done', policyNote: '已完成：可回放。' },
      ],
    },
    {
      id: 'm-prd',
      title: '《Agent 计费》PRD 评审',
      glyph: 'file',
      group: 'running',
      intent: '读 PRD 给意见，别改原文。',
      status: 'running',
      autonomy: 'drive',
      policyNote: '代驾：只出意见，不改原文。',
      elapsedSec: 512,
      costUsd: 0.18,
      tokenCount: 96000,
      budgetUsd: 1.2,
      plan: [{ id: 'p-a', index: 0, kind: 'research', title: '通读 PRD', hint: '先读两节', status: 'active' }],
      feed: [],
      approvals: [],
      evidence: [],
      context: { windowTokens: 9600, capTokens: 128000, slices: [], memory: [], droppedSources: 0, compactions: 0 },
      artifact: null,
      beats: [
        { t: 1000, kind: 'plan', stepId: 'p-a', status: 'done' },
        { t: 1000, kind: 'mission', status: 'done', group: 'done' },
      ],
    },
    {
      id: 'm-watch',
      title: '监控竞品发布',
      glyph: 'eye',
      group: 'standing',
      intent: '监控竞品发布，重要的事才叫我。',
      status: 'idle',
      autonomy: 'auto',
      policyNote: '常驻：定期巡检，只在真的重要时打扰你。',
      elapsedSec: 10800,
      costUsd: 0.06,
      tokenCount: 31000,
      budgetUsd: 0.4,
      plan: [{ id: 'w-a', index: 0, kind: 'research', title: '每 30 分钟巡一次', hint: '只比 diff', status: 'active' }],
      feed: [],
      approvals: [],
      evidence: [],
      context: { windowTokens: 8200, capTokens: 128000, slices: [], memory: [], droppedSources: 0, compactions: 0 },
      artifact: null,
      beats: [{ t: 1000, kind: 'feed', event: { kind: 'note', stepId: 'w-a', title: '开始巡检，首次抓取基线' } }],
    },
  ],
  templates: {
    research: {
      title: '新任务',
      glyph: 'search',
      group: 'running',
      status: 'running',
      autonomy: 'drive',
      policyNote: '代驾：调研与写作自己做，发送前问你。',
      plan: [
        { id: 'r-a', kind: 'clarify', title: '澄清意图', hint: '缺的信息先用记忆补', status: 'active' },
        { id: 'r-b', kind: 'deliver', title: '交付', hint: '对外发送要你点头', status: 'pending' },
      ],
      feed: [],
      approvals: [],
      evidence: [],
      context: { windowTokens: 14800, capTokens: 128000, slices: [], memory: [], droppedSources: 0, compactions: 0 },
      artifact: {
        title: '旧交付物',
        kind: 'markdown',
        body: '旧',
        claims: [],
        verification: [],
        deliveredTo: '飞书 · 旧任务',
      },
      beats: [
        { t: 1000, kind: 'plan', stepId: 'r-a', status: 'done' },
        {
          t: 1000,
          kind: 'approval',
          approval: {
            id: 'ap-new-send',
            missionId: 'm-user',
            kind: 'send',
            stepId: 'r-b',
            title: '把结果发出去？',
            why: '对外发送不可撤回。',
            risk: 'med',
            options: [{ id: 'new-send-ok', label: '发出去' }],
            status: 'open',
          },
        },
        { t: 500, kind: 'plan', stepId: 'r-b', status: 'done' },
        { t: 300, kind: 'mission', status: 'done', group: 'done' },
      ],
    },
    autoflow: {
      title: '自动流程',
      glyph: 'spark',
      group: 'running',
      status: 'running',
      autonomy: 'drive',
      policyNote: '代驾：常规动作自己做。',
      plan: [
        { id: 'af-a', kind: 'clarify', title: '开始', hint: '开始', status: 'active' },
        { id: 'af-b', kind: 'deliver', title: '交付', hint: '交付', status: 'pending' },
      ],
      feed: [],
      approvals: [],
      evidence: [],
      context: { windowTokens: 0, capTokens: 128000, slices: [], memory: [], droppedSources: 0, compactions: 0 },
      artifact: null,
      beats: [
        { t: 100, kind: 'plan', stepId: 'af-a', status: 'done' },
        {
          t: 100,
          kind: 'approval',
          approval: {
            id: 'ap-auto',
            missionId: 'm-user',
            kind: 'send',
            stepId: 'af-b',
            title: '要发送吗？',
            why: '对外动作',
            risk: 'med',
            options: [{ id: 'auto-send', label: '发送' }],
            status: 'open',
            autoResolve: { level: 'drive', delayMs: 600, label: '按档位自动发送' },
          },
        },
        { t: 100, kind: 'plan', stepId: 'af-b', status: 'done' },
        { t: 100, kind: 'mission', status: 'done', group: 'done' },
      ],
    },
  },
};

/** 只用来测时钟/耗时/成本的一分钟剧本（beat 很远，期间不会结束）。 */
const TICK_SCENARIO = {
  day: '11月5日 周三',
  startClock: 552,
  autonomy: 'drive',
  budget: { usedUsd: 1, capUsd: 20, usedTokens: 0 },
  missions: [
    {
      id: 'm-tick',
      title: '跑一分钟的任务',
      glyph: 'clock',
      group: 'running',
      intent: '跑一分钟',
      status: 'running',
      autonomy: 'drive',
      policyNote: '代驾。',
      elapsedSec: 0,
      costUsd: 0,
      tokenCount: 0,
      budgetUsd: 1,
      plan: [{ id: 't-a', index: 0, kind: 'research', title: '长跑', hint: '跑', status: 'active' }],
      feed: [],
      approvals: [],
      evidence: [],
      context: { windowTokens: 0, capTokens: 128000, slices: [], memory: [], droppedSources: 0, compactions: 0 },
      artifact: null,
      beats: [{ t: 120000, kind: 'mission', status: 'done', group: 'done' }],
    },
  ],
  templates: {},
};

/** 初始审批 + MissionSpec.autoResolve[] 写法（§10 的数组形式） */
const AUTO_SCENARIO = {
  day: '11月5日 周三',
  startClock: 552,
  autonomy: 'auto',
  budget: { usedUsd: 0, capUsd: 20, usedTokens: 0 },
  missions: [
    {
      id: 'm-auto',
      title: '初始审批自动放行',
      glyph: 'shield',
      group: 'running',
      intent: '让 agent 自己在授权内完成',
      status: 'waiting',
      autonomy: 'auto',
      policyNote: '自动：授权内不再打扰你。',
      elapsedSec: 0,
      costUsd: 0,
      tokenCount: 0,
      budgetUsd: 1,
      plan: [
        { id: 'a1', kind: 'clarify', title: '开始', hint: '开始', status: 'active' },
        { id: 'a2', kind: 'deliver', title: '完成', hint: '完成', status: 'pending' },
      ],
      feed: [],
      evidence: [],
      approvals: [
        {
          id: 'ap-auto-init',
          missionId: 'm-auto',
          kind: 'send',
          stepId: 'a2',
          title: '直接发送？',
          why: '自动档位已授权',
          risk: 'low',
          options: [{ id: 'ok', label: '发送' }],
          status: 'open',
        },
      ],
      context: { windowTokens: 0, capTokens: 128000, slices: [], memory: [], droppedSources: 0, compactions: 0 },
      artifact: null,
      autoResolve: [{ approvalId: 'ap-auto-init', level: 'drive', delayMs: 1000, label: '自动档位已授权发送' }],
      beats: [
        { t: 100, kind: 'plan', stepId: 'a1', status: 'done' },
        { t: 100, kind: 'mission', status: 'done', group: 'done' },
      ],
    },
  ],
  templates: {},
};

/* ══════════════════════════════════════════════════════════════
 * 2. 假时钟 + vm 沙箱
 * ══════════════════════════════════════════════════════════════ */

function createEnv() {
  let nowMs = 0;
  let seq = 0;
  const timers = new Map();
  const rafs = new Map();
  return {
    now() { return nowMs; },
    schedule(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: nowMs + Math.max(0, Number(ms) || 0), fn });
      return function cancel() { timers.delete(id); };
    },
    raf(fn) {
      const id = ++seq;
      rafs.set(id, fn);
      return id;
    },
    cancelRaf(id) { rafs.delete(id); },
    /** 把虚拟时间推进 ms，按时间顺序执行到期的定时器（含期间新排的）。 */
    advance(ms) {
      const target = nowMs + Math.max(0, Number(ms) || 0);
      let guard = 0;
      while (guard < 200000) {
        guard += 1;
        let bestId = Infinity;
        let bestAt = Infinity;
        let best = null;
        for (const [id, timer] of timers) {
          if (timer.at > target) continue;
          if (timer.at < bestAt || (timer.at === bestAt && id < bestId)) {
            best = timer;
            bestAt = timer.at;
            bestId = id;
          }
        }
        if (!best) break;
        timers.delete(bestId);
        nowMs = bestAt;
        best.fn();
      }
      if (guard >= 200000) throw new Error('假时钟疑似死循环');
      nowMs = target;
    },
    /** 刷新 requestAnimationFrame 队列（engine 的订阅节流用）。 */
    flushRaf() {
      if (!rafs.size) return;
      const list = [];
      rafs.forEach(function (fn) { list.push(fn); });
      rafs.clear();
      list.forEach(function (fn) { fn(); });
    },
    pending() { return timers.size; },
  };
}

/** 沙箱全局：假的 setTimeout / Date / rAF，交给 engine 的默认注入分支。 */
function makeSandbox(env, patch) {
  const sandbox = {
    console: console,
    setTimeout: function (fn, ms) { return env.schedule(fn, ms); },
    clearTimeout: function (handle) { if (typeof handle === 'function') handle(); },
    Date: { now: function () { return env.now(); } },
    requestAnimationFrame: function (fn) { return env.raf(fn); },
    cancelAnimationFrame: function (id) { env.cancelRaf(id); },
  };
  if (patch) {
    Object.keys(patch).forEach(function (key) { sandbox[key] = patch[key]; });
  }
  return sandbox;
}

// fixture 剧本 + engine 源码 + 导出（fixture 是 const，同一 script 内 engine 可见）
const fixtureScript = new Script(
  'const SCENARIO = ' + JSON.stringify(FIXTURE) + ';\n'
  + engineSrc
  + '\nglobalThis.__createEngine = createEngine;\n',
  { filename: 'engine.fixture.bundle.js' },
);

/** 新建一个隔离的 engine 实例（每个测试一套假时钟，互不影响）。 */
function newEngine(env, engineOpts, sandboxPatch) {
  const sandbox = makeSandbox(env, sandboxPatch);
  const context = createContext(sandbox);
  fixtureScript.runInContext(context);
  const engine = context.__createEngine(engineOpts || {});
  return { engine: engine, context: context };
}

/** 用任意剧本源码（比如真实 scenario.js）起一个 engine。 */
function newEngineFromScenario(env, scenarioSrc) {
  const sandbox = makeSandbox(env);
  const context = createContext(sandbox);
  const source = scenarioSrc + '\n' + engineSrc
    + '\nglobalThis.__createEngine = createEngine;\nglobalThis.__SCENARIO = SCENARIO;\n';
  new Script(source, { filename: 'engine.real-scenario.bundle.js' }).runInContext(context);
  const engine = context.__createEngine();
  return { engine: engine, context: context, scenario: context.__SCENARIO };
}

/* ══════════════════════════════════════════════════════════════
 * 3. 断言 + 测试清单
 * ══════════════════════════════════════════════════════════════ */

function assert(ok, msg) {
  if (!ok) throw new Error(msg || '断言失败');
}
function eq(actual, expected, msg) {
  if (!Object.is(actual, expected)) {
    throw new Error((msg || '值不相等') + '：期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
  }
}
function close(actual, expected, msg) {
  if (typeof actual !== 'number' || Math.abs(actual - expected) > 1e-9) {
    throw new Error((msg || '数值不相等') + '：期望 ≈' + expected + '，实际 ' + actual);
  }
}

const tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

/* ① 打开即快照 */
test('① 打开即快照：state 结构 / 初始选中 need-you / selected 引用一致', function () {
  const env = createEnv();
  const { engine } = newEngine(env);
  const s = engine.getState();
  eq(s.rev, 0, '初始 rev');
  eq(s.clock, '09:12', '模拟时钟');
  eq(s.day, '11月5日 周三', '日期');
  eq(s.autonomy, 'drive', '全局档位');
  eq(s.speed, 1, 'state.speed（Lead 约定）');
  eq(s.flash, null, '初始无 flash');
  close(s.budget.usedUsd, 5.2, '预算');
  eq(s.fleet.length, 3, '舰队数量');
  eq(s.selectedId, 'm-weekly', '默认选中第一个 need-you');
  assert(s.selected === s.missions[s.selectedId], 'selected 必须是 missions[selectedId] 的引用');
  eq(s.missions['m-weekly'].status, 'waiting');
  eq(s.missions['m-weekly'].group, 'need-you');
  eq(s.fleet[0].id, 'm-weekly');
  eq(s.fleet[0].unread, true, '有 open 审批 → 呼吸点');
  eq(s.fleet[0].progress, '1/2');
  eq(s.fleet[0].elapsed, '6m', '396s → 6m');
  eq(s.fleet[2].group, 'standing', '常驻分组');
  eq(s.missions['m-watch'].status, 'idle');
  engine.dispose();
});

/* ② 审批阻塞与解决 */
test('② 审批阻塞：open 审批停住任务，resolve 后回 running 并继续 beats', function () {
  const env = createEnv();
  const { engine } = newEngine(env);
  const s = engine.getState();
  env.advance(3000);
  const w = s.missions['m-weekly'];
  eq(w.feed.length, 1, '审批没解决前不应播 beats');
  eq(w.plan[1].status, 'blocked', '步骤保持被卡住');
  eq(w.status, 'waiting');
  engine.actions.resolveApproval('ap-price', 'opt-both');
  eq(w.approvals[0].status, 'resolved');
  eq(w.approvals[0].resolvedLabel, '两个都写，标注口径');
  eq(w.status, 'running', '审批解决后回到 running');
  eq(s.fleet[0].group, 'running');
  env.advance(1000);
  eq(w.plan[1].status, 'done', '继续播放 plan beat');
  env.advance(500);
  eq(w.feed.length, 2, 'beat feed 追加到 feed');
  assert(!!w.feed[1].at && !!w.feed[1].id, 'engine 为 beat feed 补 id/at');
  eq(w.feed[1].actor, 'agent', 'actor 默认 agent');
  eq(w.feed[1].tool, 'write');
  env.advance(500);
  assert(!!w.artifact, 'artifact beat 写入交付物');
  env.advance(500);
  eq(w.artifact.deliveredTo, '飞书 · 老板 · 刚刚', 'merge/deliver 回填 deliveredTo');
  eq(s.missions['m-weekly'].status, 'running');
  env.advance(500);
  eq(s.missions['m-weekly'].status, 'done', '终态 beat');
  eq(s.fleet[0].group, 'done');
  assert(s.budget.usedUsd > 5.2, '播放期间预算随 costUsd 汇总上涨');
  engine.dispose();
});

/* ③ autoResolve 档位差异 */
test('③ autoResolve 按档位：drive 自动放行，propose 等人，现场拨档后放行', function () {
  const env = createEnv();
  const { engine } = newEngine(env);
  const s = engine.getState();

  const idA = engine.actions.startMission('自动巡检竞品发布', 'autoflow');
  env.advance(200);
  const a = s.missions[idA];
  eq(a.approvals.length, 1);
  eq(a.approvals[0].status, 'open', '审批已打开');
  eq(a.status, 'running', '档位够时「不打扰」：不进 waiting');
  env.advance(200);
  eq(a.approvals[0].status, 'open', '授权倒计时中仍 open');
  env.advance(400); // delayMs 600 → 0.6s 后自动放行
  eq(a.approvals[0].status, 'resolved', 'drive 档应自动放行');
  eq(a.approvals[0].resolvedLabel, '按档位自动发送');
  env.advance(300);
  eq(a.status, 'done');

  const idB = engine.actions.startMission('低档位任务', 'autoflow');
  engine.actions.setMissionAutonomy(idB, 'propose');
  env.advance(200);
  const b = s.missions[idB];
  eq(b.approvals.length, 1);
  eq(b.approvals[0].status, 'open');
  eq(b.status, 'waiting', '档位不够必须等人');
  env.advance(2000);
  eq(b.approvals[0].status, 'open', 'propose 档不得自动放行');
  engine.actions.setMissionAutonomy(idB, 'drive'); // 现场拨档
  env.advance(600);
  eq(b.approvals[0].status, 'resolved', '拨档后应获得预先授权');
  eq(b.status, 'running');
  env.advance(300);
  eq(b.status, 'done');
  engine.dispose();
});

/* ④ 接管与交还 */
test('④ 接管与交还：冻结时间线、human feed、后续 beat 减半续跑', function () {
  const env = createEnv();
  const { engine } = newEngine(env);
  const s = engine.getState();
  env.advance(300);
  const prd = s.missions['m-prd'];
  eq(prd.plan[0].status, 'active');

  engine.actions.takeOver('m-prd', 'p-a', '结论先行，先给数字');
  eq(prd.takeover.stepId, 'p-a');
  eq(prd.status, 'paused', '接管即暂停');
  env.advance(3000);
  eq(prd.plan[0].status, 'active', '接管期间剧本必须冻住');

  engine.actions.resumeFromTakeover('m-prd', '结论先行，先给数字');
  eq(prd.takeover, null);
  eq(prd.status, 'running');
  const human = prd.feed[prd.feed.length - 1];
  eq(human.actor, 'human');
  eq(human.title, '接手改写：结论先行，先给数字', '交还必须留人味 feed');
  env.advance(350); // 冻结时剩 700ms，半速 → 350ms
  eq(prd.plan[0].status, 'done', '交还后按减半后的剩余时间完成 beat');
  env.advance(500); // 下一条 1000ms 半速 → 500ms
  eq(prd.status, 'done');
  engine.dispose();
});

/* ⑤ replay */
test('⑤ replay：回到深拷贝快照、预算回滚、可再次从头播放', function () {
  const env = createEnv();
  const { engine } = newEngine(env);
  const s = engine.getState();
  env.advance(2000);
  engine.actions.resolveApproval('ap-price', 'opt-both');
  env.advance(5000);
  const w = s.missions['m-weekly'];
  eq(w.status, 'done');
  assert(!!w.artifact && w.artifact.deliveredTo, '先跑到有交付物');
  assert(w.feed.length > 1);
  const selectedRef = s.selected;
  const revBefore = s.rev;

  engine.actions.replay('m-weekly');
  eq(s.selected, selectedRef, 'replay 不能替换 selected 引用');
  assert(s.rev > revBefore, 'replay 是结构变化');
  eq(w.status, 'waiting', '回到初始「等你裁定」');
  eq(w.feed.length, 1);
  eq(w.artifact, null);
  eq(w.takeover, null);
  eq(w.plan[1].status, 'blocked');
  eq(w.plan[1].meta, '1 处冲突');
  eq(w.approvals.length, 2);
  eq(w.approvals[0].status, 'open');
  eq(w.elapsedSec, 396);
  close(w.costUsd, 0.42, '成本回滚');
  close(s.budget.usedUsd, 5.2, '总预算回滚');

  engine.actions.resolveApproval('ap-price', 'opt-both');
  env.advance(1000);
  eq(w.plan[1].status, 'done', 'replay 后可从 beats 重播');
  engine.dispose();
});

/* ⑥ startMission */
test('⑥ startMission：模板克隆 / 新 id 置顶选中 / 审批重映射 / 跑完', function () {
  const env = createEnv();
  const { engine } = newEngine(env);
  const s = engine.getState();
  const intent = '把这份 PRD 拆成 9 个开发任务，按依赖分层';
  const id = engine.actions.startMission(intent, 'research');
  eq(id, 'm-user-1');
  eq(s.selectedId, id, '新任务应被选中');
  assert(s.selected === s.missions[id]);
  eq(s.fleet[0].id, id, '插到舰队最前');
  const m = s.missions[id];
  eq(m.intent, intent, 'intent 保留原文');
  eq(m.title, Array.from(intent).slice(0, 18).join('') + '…', 'title 取 intent 前 18 字并补省略号');
  eq(m.status, 'running');
  eq(s.fleet[0].group, 'running', '新任务 group 先 running');
  eq(m.artifact.deliveredTo, undefined, '模板里的旧交付记录应清空');
  assert(s.flash && s.flash.kind === 'ok', '派出任务应有一次性提示');

  env.advance(2000);
  eq(m.status, 'waiting');
  eq(m.approvals.length, 1);
  eq(m.approvals[0].missionId, id, '模板占位 missionId 应改成新任务 id');
  engine.actions.resolveApproval(m.approvals[0].id, 'new-send-ok');
  eq(m.status, 'running');
  env.advance(800);
  eq(m.status, 'done');
  eq(s.fleet[0].group, 'done');
  engine.actions.consumeFlash();
  eq(s.flash, null, 'consumeFlash 清空提示');
  engine.dispose();
});

/* ⑦ 未知模板回退 */
test('⑦ startMission 未知模板回退 research', function () {
  const env = createEnv();
  const { engine } = newEngine(env);
  const s = engine.getState();
  const id = engine.actions.startMission('监控竞品发布', 'not-a-template');
  assert(id === 'm-user-1', '仍应生成任务');
  eq(s.missions[id].plan[0].id, 'r-a', '回退到 research 模板');
  engine.dispose();
});

/* ⑧ 4x 加速 */
test('⑧ setSpeed(4)：等待时间除以 4，state.speed 同步', function () {
  const env = createEnv();
  const { engine } = newEngine(env);
  const s = engine.getState();
  engine.actions.setSpeed(4);
  eq(s.speed, 4);
  env.advance(250);
  eq(s.missions['m-prd'].plan[0].status, 'done', '1000ms beat 在 4x 下 250ms 完成');
  env.advance(250);
  eq(s.missions['m-prd'].status, 'done');
  engine.actions.setSpeed(1);
  eq(s.speed, 1);
  engine.dispose();
});

/* ⑨ 时钟/耗时/成本 */
test('⑨ 时钟/耗时/成本：1 真实秒 = 1 分钟时钟；5 秒 ≈ 15 秒耗时 ≈ $0.003', function () {
  const env = createEnv();
  const { engine } = newEngine(env, { scenario: TICK_SCENARIO });
  const s = engine.getState();
  eq(s.clock, '09:12');
  env.advance(5000);
  eq(s.clock, '09:12', '60 秒才走一分钟');
  const m = s.missions['m-tick'];
  close(m.elapsedSec, 15, '耗时 3 倍速增长');
  close(m.costUsd, 0.003, '成本小额递增');
  close(s.budget.usedUsd, 1.003, '总预算汇总');
  env.advance(55000);
  eq(s.clock, '09:13', '满 60 秒时钟 +1 分钟');
  close(m.elapsedSec, 180);
  close(m.costUsd, 0.036);
  close(s.budget.usedUsd, 1.036);
  engine.dispose();
});

/* ⑩ 暂停/恢复 */
test('⑩ pause/resume：暂停期间耗时不涨，恢复接上剩余时间', function () {
  const env = createEnv();
  const { engine } = newEngine(env);
  const s = engine.getState();
  env.advance(200);
  engine.actions.pause('m-prd');
  eq(s.missions['m-prd'].status, 'paused');
  env.advance(5000); // 跨过 5 秒耗时 tick
  eq(s.missions['m-prd'].elapsedSec, 512, '暂停期间任务耗时不增长');
  eq(s.missions['m-prd'].plan[0].status, 'active');
  engine.actions.resume('m-prd');
  eq(s.missions['m-prd'].status, 'running');
  env.advance(800);
  eq(s.missions['m-prd'].plan[0].status, 'done');
  env.advance(1000);
  eq(s.missions['m-prd'].status, 'done');
  engine.dispose();
});

/* ⑪ subscribe 节流 + rev */
test('⑪ subscribe 帧节流 + rev 单调递增', function () {
  const env = createEnv();
  const { engine } = newEngine(env);
  const s = engine.getState();
  let calls = 0;
  let lastRev = -1;
  const unsubscribe = engine.subscribe(function (st) { calls += 1; lastRev = st.rev; });
  const rev0 = s.rev;
  engine.actions.selectMission('m-prd');
  engine.actions.selectMission('m-watch');
  eq(calls, 0, '同一帧内合并，不立即回调');
  env.flushRaf();
  eq(calls, 1, '合并后只回调一次');
  assert(s.rev > rev0, 'rev 单调递增');
  eq(lastRev, s.rev);
  engine.actions.selectMission('m-weekly');
  env.flushRaf();
  eq(calls, 2);
  unsubscribe();
  engine.actions.selectMission('m-prd');
  env.flushRaf();
  eq(calls, 2, '退订后不再回调');
  engine.dispose();
});

/* ⑫ dispose */
test('⑫ dispose：清空全部定时器/订阅，之后动作安全无效', function () {
  const env = createEnv();
  const { engine } = newEngine(env);
  const s = engine.getState();
  let calls = 0;
  engine.subscribe(function () { calls += 1; });
  env.advance(1000);
  env.flushRaf();
  eq(calls, 1);
  const clockBefore = s.clock;
  const revBefore = s.rev;
  engine.dispose();
  eq(env.pending(), 0, 'dispose 后不应残留定时器');
  env.advance(20000);
  env.flushRaf();
  eq(calls, 1, 'dispose 后不再通知');
  eq(s.clock, clockBefore);
  eq(s.rev, revBefore);
  engine.actions.selectMission('m-prd');
  eq(s.selectedId, 'm-weekly');
  engine.actions.pause('m-prd');
  eq(s.missions['m-prd'].status, 'running');
});

/* ⑬ opts 注入（不依赖全局 setTimeout / Date） */
test('⑬ opts.schedule/now/speed 注入：不依赖全局 setTimeout/Date', function () {
  const env = createEnv();
  const { engine } = newEngine(
    env,
    { schedule: env.schedule, now: env.now, speed: 4 },
    {
      setTimeout: function () { throw new Error('不应调用全局 setTimeout'); },
      Date: { now: function () { throw new Error('不应调用全局 Date.now'); } },
      requestAnimationFrame: undefined,
      cancelAnimationFrame: undefined,
    },
  );
  const s = engine.getState();
  eq(s.speed, 4);
  env.advance(250);
  eq(s.missions['m-prd'].plan[0].status, 'done', '1000ms beat 在注入的 4x 下 250ms 完成');
  engine.dispose();
  eq(env.pending(), 0);
});

/* ⑭ 初始审批 + MissionSpec.autoResolve[]（§10 数组形式） */
test('⑭ 初始 open 审批支持 spec.autoResolve[] 自动放行', function () {
  const env = createEnv();
  const { engine } = newEngine(env, { scenario: AUTO_SCENARIO });
  const s = engine.getState();
  const m = s.missions['m-auto'];
  eq(m.approvals[0].status, 'open');
  env.advance(500);
  eq(m.approvals[0].status, 'open', 'delayMs 未到不解决');
  env.advance(500);
  eq(m.approvals[0].status, 'resolved', '到点自动解决');
  eq(m.approvals[0].resolvedLabel, '自动档位已授权发送');
  env.advance(200);
  eq(m.status, 'done', '自动放行后继续 beats 直到完成');
  engine.dispose();
});

/* ⑮ 真实 scenario.js 冒烟（存在时） */
test('⑮ 真实 scenario.js 冒烟：初始化 / 初始审批解决 / beads 继续', function () {
  if (!existsSync(SCENARIO_PATH)) {
    console.log('      （跳过：app/src/scenario.js 尚不存在）');
    return;
  }
  const env = createEnv();
  const { engine, scenario } = newEngineFromScenario(env, readFileSync(SCENARIO_PATH, 'utf8'));
  const s = engine.getState();
  eq(s.fleet.length, scenario.missions.length, '舰队数量与剧本一致');
  assert(!!s.missions[s.selectedId], 'selectedId 必须指向真实任务');
  assert(s.selected === s.missions[s.selectedId]);
  const expectedClock = String(Math.floor(scenario.startClock / 60)).padStart(2, '0')
    + ':' + String(scenario.startClock % 60).padStart(2, '0');
  eq(s.clock, expectedClock);
  const mission = s.selected;
  const openApproval = (mission.approvals || []).filter(function (ap) { return ap.status === 'open'; })[0];
  const feedBefore = mission.feed.length;
  if (openApproval) {
    assert(openApproval.options.length > 0, '真实初始审批应有选项');
    engine.actions.resolveApproval(openApproval.id, openApproval.options[0].id);
    assert(mission.status === 'running', '解决初始审批后应回到 running');
    env.advance(3000);
    assert(mission.feed.length > feedBefore, '真实 beats 应继续播放');
  }
  env.advance(20000); // 让真实剧本再跑一段，确认没有异常
  engine.dispose();
  eq(env.pending(), 0, '真实剧本 dispose 后无残留定时器');
});

/* ══════════════════════════════════════════════════════════════
 * 4. 执行
 * ══════════════════════════════════════════════════════════════ */

console.log('HELM engine tests');
let passed = 0;
let failed = 0;
for (const item of tests) {
  try {
    item.fn();
    passed += 1;
    console.log('  ✓ ' + item.name);
  } catch (err) {
    failed += 1;
    console.log('  ✗ ' + item.name);
    console.log('      ' + (err && err.message ? err.message : String(err)));
    if (err && err.stack) console.log('      ' + err.stack.split('\n').slice(1, 3).join('\n      '));
  }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exitCode = 1;
