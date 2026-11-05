/**
 * HELM · 剧本播放引擎（engine.js）
 *
 * 只做「状态 + 计时」，不碰 DOM、不依赖 H、不使用 import/export：
 * app/build.mjs 会把它和 dom.js / scenario.js / 视图模块拼进同一个 IIFE。
 *
 * 设计要点（为什么这么写）：
 * - 时间全部可注入（opts.schedule / opts.now / opts.speed）。浏览器里默认
 *   setTimeout + Date.now，测试里换成假时钟，就能在 node:vm 里瞬间跑完 20 秒剧本。
 * - state 原地修改 + rev++，视图只在 rev 变化时重绘；selected 始终是
 *   missions[selectedId] 的同一个引用，视图可以安全地拿 prevState 做 diff。
 * - 每个任务一条独立时间线：审批、暂停、接管都只停自己的计时器，多个任务才可能真并行；
 *   如果用一全局 timer，任何一次暂停都会拖慢别人。
 * - 审批 open 时停住整个任务，而不是「跳过继续」：审批的意义是「没有你的决定，后续
 *   动作就没有合法依据」。跳过会把风险动作伪装成已完成，直接破坏产品叙事。
 * - autoResolve 不是「免掉审批」，而是「按档位预先授权」：只有任务档位 >= 要求档位时
 *   才 delayMs 后以 label 自动解决；档位不够就老老实实等人。
 * - 播放中每条 beat 的 t 是相对上一条的等待毫秒数；速度 = 1x/4x，接管交还后再额外减半
 *   （叙事：人给过方向后 agent 更快）。
 */

function createEngine(opts) {
  opts = opts || {};

  /* ══════════════════════════════════════════════════════════
   * 0. 依赖注入与纯工具
   * ══════════════════════════════════════════════════════════ */

  const SCEN = opts.scenario != null
    ? opts.scenario
    : (typeof SCENARIO !== 'undefined' ? SCENARIO : null);
  if (!SCEN || typeof SCEN !== 'object') {
    throw new Error('createEngine: 找不到 SCENARIO 剧本数据');
  }

  /** 默认用全局 setTimeout；注入的 schedule 约定返回「取消函数」。 */
  const rawSchedule = typeof opts.schedule === 'function'
    ? opts.schedule
    : function (fn, ms) {
        const id = setTimeout(fn, ms);
        return function () { clearTimeout(id); };
      };
  const now = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };

  function schedule(fn, ms) {
    let handle = null;
    try {
      handle = rawSchedule(fn, Math.max(0, Number(ms) || 0));
    } catch (err) {
      return function () {};
    }
    if (handle && typeof handle.cancel === 'function') return function () { handle.cancel(); };
    if (typeof handle === 'function') return handle;
    // 有些宿主 return 的是 timer id（像原生 setTimeout）；无法取消时靠 disposed 兜底。
    return function () {};
  }

  /** 深拷贝剧本数据：engine 绝不能改到 SCENARIO / 模板 / 快照本身。 */
  function clone(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      const arr = new Array(value.length);
      for (let i = 0; i < value.length; i += 1) arr[i] = clone(value[i]);
      return arr;
    }
    const obj = {};
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) obj[key] = clone(value[key]);
    }
    return obj;
  }

  function num(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function round6(n) { return Math.round(n * 1e6) / 1e6; }

  const LEVEL_RANK = { observe: 0, propose: 1, drive: 2, auto: 3 };
  function rankOf(level) { return LEVEL_RANK[level] == null ? LEVEL_RANK.drive : LEVEL_RANK[level]; }
  function normLevel(level, fallback) {
    return LEVEL_RANK[level] == null ? fallback : level;
  }

  /** 分钟数 → "09:12" */
  function fmtClock(minutes) {
    const total = ((Math.floor(minutes) % 1440) + 1440) % 1440;
    return pad2(Math.floor(total / 60)) + ':' + pad2(total % 60);
  }
  /** 秒数 → "09:12:04"（剧本里 feed 的 at 用） */
  function fmtClockSec(totalSec) {
    let sec = Math.floor(totalSec) % 86400;
    if (sec < 0) sec += 86400;
    return pad2(Math.floor(sec / 3600)) + ':' + pad2(Math.floor((sec % 3600) / 60)) + ':' + pad2(sec % 60);
  }
  /** 紧凑耗时（舰队卡一行里放得下）："42s" / "12m" / "3h 05m" */
  function fmtElapsed(sec) {
    const s = Math.max(0, Math.round(num(sec, 0)));
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm';
    return Math.floor(m / 60) + 'h ' + pad2(m % 60) + 'm';
  }

  const START_CLOCK_MIN = num(SCEN.startClock, 552); // 09:12
  const DAY = SCEN.day || '';

  /* ══════════════════════════════════════════════════════════
   * 1. 状态与内部账本
   * ══════════════════════════════════════════════════════════ */

  const state = {
    rev: 0,
    clock: fmtClock(START_CLOCK_MIN),
    day: DAY,
    autonomy: normLevel(SCEN.autonomy, 'drive'),
    speed: opts.speed === 4 ? 4 : 1, // 视图的 1x/4x 按钮直接读它（Lead 约定）
    budget: {
      usedUsd: num((SCEN.budget || {}).usedUsd, 0),
      capUsd: num((SCEN.budget || {}).capUsd, 20),
      usedTokens: num((SCEN.budget || {}).usedTokens, 0),
    },
    fleet: [],
    selectedId: '',
    missions: {},
    selected: null,
    flash: null,
  };

  /** 舰队展示顺序（state.fleet 每帧按它重建）。 */
  let order = [];
  /** 每个任务的运行时（播放游标/定时器/分组等，不进 state）。 */
  let runtimes = {};
  /** 上次同步进总预算的每任务成本/ token，用于「增量」汇总而不重复累加。 */
  let costTracked = {};
  let tokenTracked = {};

  let missionSeq = 0; // m-user-<n>
  let elapsedRealSec = 0; // 引擎启动后的真实秒数（时钟/at 都基于它）
  const startedAt = now();

  let disposed = false;
  const timers = new Set(); // 所有「可取消」定时器，dispose 时统一清掉
  const subscribers = [];
  let notifyQueued = false;
  let notifyCancel = null;

  /* ══════════════════════════════════════════════════════════
   * 2. 定时器 / 提交 / 通知
   * ══════════════════════════════════════════════════════════ */

  /** 带登记的一次性定时器；返回取消函数。 */
  function later(fn, ms) {
    if (disposed) return function () {};
    let cancel = null;
    const wrapped = function () {
      timers.delete(cancel);
      if (disposed) return;
      fn();
    };
    cancel = schedule(wrapped, ms);
    timers.add(cancel);
    return function () {
      timers.delete(cancel);
      try { cancel(); } catch (err) { /* 取消失败也不影响状态正确性 */ }
    };
  }

  /**
   * 一次结构变更：汇总预算 → 重建舰队快照 → rev++ → 节流通知。
   * 视图只读 state，所以这里直接原地改，不复制整个 state（省得视图拿不住引用）。
   */
  function commit() {
    if (disposed) return;
    syncBudget();
    syncFleet();
    state.selected = state.selectedId ? (state.missions[state.selectedId] || null) : null;
    state.rev += 1;
    notifySoon();
  }

  /** 全局预算 = 初始值 + 各任务 costUsd / tokenCount 的增量（replay 会自动回滚）。 */
  function syncBudget() {
    for (let i = 0; i < order.length; i += 1) {
      const id = order[i];
      const m = state.missions[id];
      if (!m) continue;
      const cost = num(m.costUsd, 0);
      const prevCost = num(costTracked[id], 0);
      if (cost !== prevCost) {
        state.budget.usedUsd = round6(state.budget.usedUsd + (cost - prevCost));
        costTracked[id] = cost;
      }
      const tokens = num(m.tokenCount, 0);
      const prevTokens = num(tokenTracked[id], 0);
      if (tokens !== prevTokens) {
        state.budget.usedTokens = Math.round(state.budget.usedTokens + (tokens - prevTokens));
        tokenTracked[id] = tokens;
      }
    }
  }

  /** 舰队列表是 mission 的「展示投影」：分组/进度/耗时/未读都从这里统一派生。 */
  function syncFleet() {
    const fleet = [];
    for (let i = 0; i < order.length; i += 1) {
      const id = order[i];
      const m = state.missions[id];
      if (!m) continue;
      const rt = runtimes[id];
      const group = rt ? rt.group : (m.group || 'running');
      m.group = group; // Lead 约定：mission.group 与舰队分组保持同一份
      const plan = m.plan || [];
      let doneCount = 0;
      for (let k = 0; k < plan.length; k += 1) if (plan[k].status === 'done') doneCount += 1;
      const progress = group === 'standing' || plan.length === 0
        ? '常驻'
        : doneCount + '/' + plan.length;
      let unread = false;
      for (let k = 0; k < (m.approvals || []).length; k += 1) {
        if (m.approvals[k].status === 'open') { unread = true; break; }
      }
      fleet.push({
        id: m.id,
        title: m.title,
        glyph: m.glyph,
        status: m.status,
        group: group,
        progress: progress,
        costUsd: m.costUsd,
        elapsed: fmtElapsed(m.elapsedSec),
        unread: unread,
      });
    }
    state.fleet = fleet;
  }

  /** 订阅回调合并到下一帧（rAF 可用就用，否则 16ms），避免一秒内多次重绘。 */
  function notifySoon() {
    if (disposed || notifyQueued || subscribers.length === 0) return;
    notifyQueued = true;
    const run = function () {
      notifyQueued = false;
      if (disposed) return;
      const list = subscribers.slice();
      for (let i = 0; i < list.length; i += 1) {
        try { list[i](state); } catch (err) {
          if (typeof console !== 'undefined' && console.error) console.error('[helm-engine] subscriber error', err);
        }
      }
    };
    if (typeof requestAnimationFrame === 'function') {
      const frameId = requestAnimationFrame(run);
      notifyCancel = function () {
        try {
          if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameId);
        } catch (err) { /* 忽略 */ }
      };
    } else {
      notifyCancel = schedule(run, 16);
    }
  }

  function subscribe(fn) {
    if (disposed || typeof fn !== 'function') return function () {};
    subscribers.push(fn);
    let active = true;
    return function unsubscribe() {
      if (!active) return;
      active = false;
      const index = subscribers.indexOf(fn);
      if (index >= 0) subscribers.splice(index, 1);
    };
  }

  /* ══════════════════════════════════════════════════════════
   * 3. 任务构建（MissionSpec / 模板 → Mission + runtime）
   * ══════════════════════════════════════════════════════════ */

  function emptyContext() {
    return { windowTokens: 0, capTokens: 128000, slices: [], memory: [], droppedSources: 0, compactions: 0 };
  }

  function normalizeFeed(ev, mid, index) {
    const out = ev ? clone(ev) : {};
    if (!out.id) out.id = mid + '-init-' + (index + 1);
    if (!out.at) out.at = simAt(); // 初始快照缺时间时补模拟时钟
    if (!out.actor) out.actor = 'agent';
    if (!out.kind) out.kind = 'note';
    if (!out.title) out.title = '继续执行';
    return out;
  }

  function normalizeApproval(ap, mid) {
    const out = ap ? clone(ap) : {};
    out.missionId = mid;
    if (!out.kind) out.kind = 'choice';
    if (!out.risk) out.risk = 'low';
    if (!Array.isArray(out.options)) out.options = [];
    if (!out.status) out.status = 'open';
    if (out.status !== 'open' && out.status !== 'resolved') out.status = 'open';
    if (!out.resolvedLabel) delete out.resolvedLabel;
    // autoResolve 是「剧本指令」，不是审批展示字段：先摘出来交给运行时。
    delete out.autoResolve;
    return out;
  }

  function buildMission(spec, id) {
    const ctx = spec.context ? clone(spec.context) : emptyContext();
    if (!Array.isArray(ctx.slices)) ctx.slices = [];
    if (!Array.isArray(ctx.memory)) ctx.memory = [];
    return {
      id: id,
      title: spec.title || '未命名任务',
      glyph: spec.glyph || 'dot',
      intent: spec.intent != null ? String(spec.intent) : (spec.title || ''),
      status: spec.status || 'running',
      autonomy: normLevel(spec.autonomy, state.autonomy),
      policyNote: spec.policyNote || '',
      elapsedSec: num(spec.elapsedSec, 0),
      costUsd: num(spec.costUsd, 0),
      tokenCount: num(spec.tokenCount, 0),
      budgetUsd: num(spec.budgetUsd, 1.5),
      // 托管把握（80% 口径）：模型趋势判断在界面上的最小投影，见 docs/思考与判断.md
      hold: spec.hold ? clone(spec.hold) : null,
      plan: (spec.plan || []).map(function (step, i) {
        const out = clone(step);
        if (out.index == null) out.index = i;
        return out;
      }),
      feed: (spec.feed || []).map(function (ev, i) { return normalizeFeed(ev, id, i); }),
      approvals: (spec.approvals || []).map(function (ap) { return normalizeApproval(ap, id); }),
      evidence: clone(spec.evidence || []),
      context: ctx,
      artifact: spec.artifact ? clone(spec.artifact) : null,
      takeover: null,
      replayable: !!(spec.beats && spec.beats.length),
      // MissionSpec 里有 group；§3 的 Mission 没写，但 Lead 的视图约定要读，故同步保留。
      group: spec.group || 'running',
    };
  }

  function deriveGroup(spec) {
    if (spec.group) return spec.group;
    if (spec.status === 'done') return 'done';
    if (spec.status === 'idle') return 'standing';
    if (spec.status === 'waiting') return 'need-you';
    return 'running';
  }

  function setGroup(m, rt, group) {
    rt.group = group;
    m.group = group;
  }

  function hasOpenApproval(m) {
    const list = m.approvals || [];
    for (let i = 0; i < list.length; i += 1) if (list[i].status === 'open') return true;
    return false;
  }

  function createRuntime(mission, spec, forcedEndMode) {
    const group = deriveGroup(spec);
    const rt = {
      mid: mission.id,
      beats: clone(spec.beats || []),
      idx: 0,
      cancel: null,
      playing: false, // 有 beat 定时器在跑
      blocked: false, // 被审批挡住（不是用户暂停）
      userPaused: false,
      halved: false, // 接管交还后后续 beat 减半
      end: false, // 剧本放完 / 终态 beat 已到
      started: false,
      remainingMs: null, // 暂停时剩下的真实等待
      pauseDiv: 1,
      scheduledWait: 0,
      timerStart: 0,
      div: 1,
      group: group,
      endMode: forcedEndMode || ((spec.group === 'standing' || spec.status === 'idle') ? 'idle' : 'done'),
      autoTimers: new Map(), // approvalId -> cancel
      autoConfigs: new Map(), // approvalId -> { level, delayMs, label }
      feedSeq: 0,
      prevStatus: null,
      snapshot: null,
    };
    rt.feedSeq = (mission.feed || []).length;
    mission.group = group;
    return rt;
  }

  function mapToObject(map) {
    const out = {};
    map.forEach(function (value, key) { out[key] = clone(value); });
    return out;
  }

  function normConf(raw, fallbackId) {
    if (!raw) return null;
    const approvalId = raw.approvalId != null ? String(raw.approvalId) : (fallbackId != null ? String(fallbackId) : '');
    if (!approvalId) return null;
    return {
      approvalId: approvalId,
      level: normLevel(raw.level, 'auto'),
      delayMs: Math.max(0, num(raw.delayMs, 1500)),
      label: raw.label || '按自主档位自动放行',
    };
  }

  /** 剧本两种写法都支持：MissionSpec.autoResolve[] 与 approval.autoResolve。 */
  function collectInitialAutoConfigs(spec, id) {
    const out = [];
    if (Array.isArray(spec.autoResolve)) {
      spec.autoResolve.forEach(function (c) {
        const conf = normConf(c);
        if (conf) out.push(conf);
      });
    }
    (spec.approvals || []).forEach(function (ap) {
      const conf = normConf(ap && ap.autoResolve, ap && ap.id);
      if (conf) out.push(conf);
    });
    return out;
  }

  /* ══════════════════════════════════════════════════════════
   * 4. 播放时间线
   * ══════════════════════════════════════════════════════════ */

  function divisor(rt) {
    return (state.speed || 1) * (rt && rt.halved ? 2 : 1);
  }
  function rawWait(rt, beat) {
    return Math.max(0, num(beat && beat.t, 0)) / divisor(rt);
  }
  function remainingNow(rt) {
    return Math.max(0, rt.scheduledWait - (now() - rt.timerStart));
  }
  function stopTimer(rt) {
    if (!rt || !rt.cancel) return;
    const cancel = rt.cancel;
    rt.cancel = null;
    try { cancel(); } catch (err) { /* 忽略 */ }
  }

  /**
   * 排下一条 beat。overrideWait 用于暂停/接管/变速后「接着剩下的时间跑」，
   * 这样 4x 按钮按下去不会把当前等待重置成完整时长。
   */
  function scheduleNext(mid, overrideWait) {
    const rt = runtimes[mid];
    if (!rt || disposed || rt.end) return;
    stopTimer(rt);
    if (rt.idx >= rt.beats.length) { finishBeats(mid); return; }
    const wait = overrideWait == null ? rawWait(rt, rt.beats[rt.idx]) : Math.max(0, overrideWait);
    rt.playing = true;
    rt.blocked = false;
    rt.timerStart = now();
    rt.scheduledWait = wait;
    rt.div = divisor(rt);
    const tick = function () {
      rt.cancel = null;
      rt.playing = false;
      if (disposed) return;
      const mission = state.missions[mid];
      if (!mission || rt.end || mission.status === 'paused' || mission.takeover) return;
      if (rt.idx >= rt.beats.length) { finishBeats(mid); commit(); return; }
      const beat = rt.beats[rt.idx];
      rt.idx += 1;
      const blocked = applyBeat(mid, beat);
      if (rt.end) { commit(); return; }
      if (blocked) { rt.blocked = true; commit(); return; }
      if (rt.idx >= rt.beats.length) { finishBeats(mid); commit(); return; }
      scheduleNext(mid);
      commit();
    };
    rt.cancel = later(tick, wait);
  }

  function startPlayback(mid) {
    const rt = runtimes[mid];
    if (!rt || rt.end || disposed) return;
    rt.started = true;
    if (!rt.beats.length) { finishBeats(mid); return; }
    scheduleNext(mid);
  }

  /** beat 放完后的收尾：按模板语法定 done 或回 idle（常驻任务不装死）。 */
  function finishBeats(mid) {
    const m = state.missions[mid];
    const rt = runtimes[mid];
    if (!m || !rt || rt.end) return;
    rt.playing = false;
    rt.blocked = false;
    if (rt.endMode === 'idle') {
      if (m.status !== 'paused') { m.status = 'idle'; setGroup(m, rt, 'standing'); }
      rt.end = true;
    } else if (m.status === 'running' || m.status === 'queued' || m.status === 'draft' || m.status === 'waiting') {
      m.status = 'done';
      setGroup(m, rt, 'done');
      rt.end = true;
    }
  }

  /** 暂停/接管时保存「这一条 beat 还剩多久」，恢复时接着跑而不是从头等。 */
  function freezeTimeline(rt) {
    if (rt && rt.cancel && rt.playing) {
      rt.remainingMs = remainingNow(rt);
      rt.pauseDiv = rt.div || divisor(rt);
      stopTimer(rt);
    }
    if (rt) rt.playing = false;
  }

  /** 恢复时把剩余时间按当前速度换算（变速/半速会改变真实等待）。 */
  function thawTimeline(mid) {
    const rt = runtimes[mid];
    if (!rt || rt.end || disposed) return;
    if (rt.remainingMs != null) {
      const scaled = rt.remainingMs * (rt.pauseDiv || divisor(rt)) / divisor(rt);
      rt.remainingMs = null;
      scheduleNext(mid, scaled);
      return;
    }
    if (!rt.started) { startPlayback(mid); return; }
    scheduleNext(mid);
  }

  /* ══════════════════════════════════════════════════════════
   * 5. beat 应用
   * ══════════════════════════════════════════════════════════ */

  function simAt() {
    return fmtClockSec(START_CLOCK_MIN * 60 + elapsedRealSec);
  }

  function pushFeed(mid, beat) {
    const m = state.missions[mid];
    const rt = runtimes[mid];
    if (!m || !rt) return;
    const ev = clone(beat.event || {});
    rt.feedSeq += 1;
    if (!ev.id) ev.id = mid + '-f-' + rt.feedSeq;
    if (!ev.at) ev.at = simAt();
    if (!ev.actor) ev.actor = 'agent';
    if (!ev.kind) ev.kind = 'note';
    if (!ev.title) ev.title = '继续执行';
    m.feed.push(ev);
  }

  function applyPlanBeat(m, beat) {
    if (!beat.stepId) return;
    const plan = m.plan || [];
    for (let i = 0; i < plan.length; i += 1) {
      if (plan[i].id !== beat.stepId) continue;
      if (beat.status) plan[i].status = beat.status;
      if (beat.meta !== undefined) plan[i].meta = beat.meta;
      return;
    }
  }

  /** artifact beat 的三种用法：null 占位忽略 / merge 合并 / deliver 回填 deliveredTo。 */
  function applyArtifactBeat(m, beat) {
    if (!beat.artifact) {
      // artifact 为 null 的 beat 只是占位：保留已有交付物，只可能回填交付去向。
      if (beat.deliver && m.artifact) m.artifact.deliveredTo = beat.deliver;
      return;
    }
    const incoming = clone(beat.artifact);
    if (beat.merge) {
      // 合并语义：只合并进「已有」artifact；没有可合并对象时按 null 占位处理。
      if (m.artifact) Object.assign(m.artifact, incoming);
    } else {
      m.artifact = incoming;
    }
    if (beat.deliver && m.artifact) m.artifact.deliveredTo = beat.deliver;
  }

  function applyMissionBeat(mid, beat) {
    const m = state.missions[mid];
    const rt = runtimes[mid];
    if (!m || !rt || !beat) return false;
    if (beat.policyNote) m.policyNote = beat.policyNote;
    if (beat.status) {
      m.status = beat.status;
      if (beat.status === 'done') {
        setGroup(m, rt, 'done');
        rt.end = true; // 终态后面的 beat 不再播
        m.takeover = null;
      } else if (beat.status === 'idle') {
        setGroup(m, rt, 'standing');
        rt.end = true;
      } else if (beat.status === 'waiting') {
        setGroup(m, rt, 'need-you');
      } else if (beat.status === 'paused') {
        rt.playing = false;
      } else if (beat.status === 'running' || beat.status === 'queued') {
        if (rt.group !== 'standing') setGroup(m, rt, 'running');
      }
    }
    if (beat.group) setGroup(m, rt, beat.group);
    return m.status === 'waiting' || m.status === 'paused';
  }

  function applyBudgetBeat(m, beat) {
    if (beat.costUsd != null) m.costUsd = num(beat.costUsd, m.costUsd);
    if (beat.tokenCount != null) m.tokenCount = num(beat.tokenCount, m.tokenCount);
    if (beat.elapsedSec != null) m.elapsedSec = num(beat.elapsedSec, m.elapsedSec);
  }

  /** 执行一条 beat；返回 true 表示这条 beat 把任务挡在「等待」上。 */
  function applyBeat(mid, beat) {
    const m = state.missions[mid];
    const rt = runtimes[mid];
    if (!m || !rt || !beat) return false;
    switch (beat.kind) {
      case 'feed':
        pushFeed(mid, beat);
        return false;
      case 'plan':
        applyPlanBeat(m, beat);
        return false;
      case 'approval':
        return openApproval(mid, beat.approval);
      case 'artifact':
        applyArtifactBeat(m, beat);
        return false;
      case 'mission':
        return applyMissionBeat(mid, beat);
      case 'budget':
        applyBudgetBeat(m, beat);
        return false;
      default:
        // 未知 kind 忽略而不抛错：场景数据可以先行演进，引擎保持向前兼容。
        return false;
    }
  }

  /* ══════════════════════════════════════════════════════════
   * 6. 审批与自动放行
   * ══════════════════════════════════════════════════════════ */

  function findApproval(approvalId) {
    for (let i = 0; i < order.length; i += 1) {
      const mid = order[i];
      const m = state.missions[mid];
      if (!m) continue;
      const list = m.approvals || [];
      for (let k = 0; k < list.length; k += 1) {
        if (list[k].id === approvalId) {
          return { mid: mid, mission: m, approval: list[k], runtime: runtimes[mid] };
        }
      }
    }
    return null;
  }

  function cancelAutoResolve(rt, approvalId) {
    if (!rt || !rt.autoTimers) return;
    const cancel = rt.autoTimers.get(approvalId);
    if (!cancel) return;
    rt.autoTimers.delete(approvalId);
    try { cancel(); } catch (err) { /* 忽略 */ }
  }

  /**
   * 打开一条审批。返回 true 表示任务被停住：
   * - 档位不够 → status=waiting + 归入「需要你」；
   * - 档位够 → 不打扰用户，但播放仍停在审批处，delayMs 后自动放行（预先授权也有成本）。
   */
  function openApproval(mid, rawApproval) {
    const m = state.missions[mid];
    const rt = runtimes[mid];
    if (!m || !rt || !rawApproval) return false;
    const raw = clone(rawApproval);
    const beatConf = normConf(raw.autoResolve, raw.id);
    delete raw.autoResolve;
    const ap = normalizeApproval(raw, mid);
    ap.status = 'open';
    delete ap.resolvedLabel;

    // 同 id 重复打开时覆盖，避免 approvals 里出现两条同名卡。
    let existing = null;
    for (let i = 0; i < m.approvals.length; i += 1) if (m.approvals[i].id === ap.id) { existing = m.approvals[i]; break; }
    if (existing) {
      for (const key of Object.keys(existing)) delete existing[key];
      Object.assign(existing, ap);
    } else {
      m.approvals.push(ap);
    }

    const conf = beatConf || rt.autoConfigs.get(ap.id) || null;
    if (conf) rt.autoConfigs.set(ap.id, conf);
    const authorized = conf && rankOf(m.autonomy) >= rankOf(conf.level);

    if (authorized) {
      // 预先授权：不切 waiting、不亮「需要你」红点，但仍暂停播放等授权倒计时。
      rt.blocked = true;
      scheduleAutoResolve(mid, ap, conf);
    } else {
      m.status = 'waiting';
      setGroup(m, rt, 'need-you');
      rt.blocked = true;
    }
    return true;
  }

  function scheduleAutoResolve(mid, approval, conf) {
    const rt = runtimes[mid];
    if (!rt || disposed) return;
    cancelAutoResolve(rt, approval.id);
    const delay = Math.max(0, num(conf.delayMs, 0)) / (state.speed || 1);
    const cancel = later(function () {
      if (disposed) return;
      rt.autoTimers.delete(approval.id);
      const m = state.missions[mid];
      if (!m) return;
      let target = null;
      for (let i = 0; i < m.approvals.length; i += 1) if (m.approvals[i].id === approval.id) target = m.approvals[i];
      if (!target || target.status !== 'open') return;
      // 用户主动暂停/接管时不越权放行，稍后再试；暂停解除后自然发生。
      if (m.status === 'paused' || m.takeover) {
        scheduleAutoResolve(mid, target, Object.assign({}, conf, { delayMs: 500 }));
        return;
      }
      target.status = 'resolved';
      target.resolvedLabel = conf.label || '按自主档位自动放行';
      continueAfterApproval(mid);
      commit();
    }, delay);
    rt.autoTimers.set(approval.id, cancel);
  }

  /**
   * 一条审批被解决后决定任务往哪走：
   * - 还有 open 审批 → 继续 waiting；
   * - 被用户暂停/接管 → 保持暂停；
   * - 否则回到 running 并把停下的时间线接上（初始审批则首次开播）。
   */
  function continueAfterApproval(mid) {
    const m = state.missions[mid];
    const rt = runtimes[mid];
    if (!m || !rt) return;
    if (hasOpenApproval(m)) {
      if (m.status !== 'paused' && m.status !== 'done' && !m.takeover) {
        m.status = 'waiting';
        setGroup(m, rt, 'need-you');
      }
      return;
    }
    if (m.status === 'paused' || m.takeover || rt.end) return;
    if (m.status === 'waiting') m.status = 'running';
    if (rt.group === 'need-you') setGroup(m, rt, rt.endMode === 'idle' ? 'standing' : 'running');
    rt.blocked = false;
    if (rt.playing) return; // 理论上不会发生，防御一下
    if (rt.remainingMs != null) {
      const scaled = rt.remainingMs * (rt.pauseDiv || divisor(rt)) / divisor(rt);
      rt.remainingMs = null;
      scheduleNext(mid, scaled);
      return;
    }
    if (!rt.started) { startPlayback(mid); return; }
    if (rt.idx >= rt.beats.length) { finishBeats(mid); return; }
    scheduleNext(mid);
  }

  /**
   * 档位变化后重新评估所有 open 审批：够档就自动放行，不够就退回等待。
   * 这样「现场把档位从代驾拨到自动」也能看到体验差异。
   */
  function reevaluateAutoResolves() {
    for (let i = 0; i < order.length; i += 1) {
      const mid = order[i];
      const m = state.missions[mid];
      const rt = runtimes[mid];
      if (!m || !rt) continue;
      if (m.status === 'paused' || m.takeover || m.status === 'done') continue;
      const list = m.approvals || [];
      for (let k = 0; k < list.length; k += 1) {
        const ap = list[k];
        if (ap.status !== 'open') continue;
        const conf = rt.autoConfigs.get(ap.id);
        if (!conf) continue;
        const authorized = rankOf(m.autonomy) >= rankOf(conf.level);
        if (authorized) {
          if (rt.autoTimers.has(ap.id)) continue;
          if (m.status === 'waiting') m.status = 'running';
          if (rt.group === 'need-you') setGroup(m, rt, rt.endMode === 'idle' ? 'standing' : 'running');
          rt.blocked = true;
          scheduleAutoResolve(mid, ap, conf);
        } else if (rt.autoTimers.has(ap.id)) {
          cancelAutoResolve(rt, ap.id);
          m.status = 'waiting';
          setGroup(m, rt, 'need-you');
          rt.blocked = true;
        }
      }
    }
  }

  /* ══════════════════════════════════════════════════════════
   * 7. 动作（全部同步、幂等安全）
   * ══════════════════════════════════════════════════════════ */

  function selectMission(id) {
    if (disposed) return;
    if (!id || !state.missions[id] || state.selectedId === id) return;
    state.selectedId = id;
    commit();
  }

  function setAutonomy(level) {
    if (disposed) return;
    const next = normLevel(level, null);
    if (!next) return;
    const selected = state.selectedId ? state.missions[state.selectedId] : null;
    if (state.autonomy === next && (!selected || selected.autonomy === next)) return;
    state.autonomy = next;
    if (selected) selected.autonomy = next;
    reevaluateAutoResolves();
    commit();
  }

  function setMissionAutonomy(id, level) {
    if (disposed) return;
    const m = state.missions[id];
    const next = normLevel(level, null);
    if (!m || !next || m.autonomy === next) return;
    m.autonomy = next;
    reevaluateAutoResolves();
    commit();
  }

  function pause(id) {
    if (disposed) return;
    const m = state.missions[id];
    const rt = runtimes[id];
    if (!m || !rt || m.status === 'paused' || m.status === 'done') return;
    rt.prevStatus = m.status;
    freezeTimeline(rt);
    rt.userPaused = true;
    rt.blocked = false;
    m.status = 'paused';
    commit();
  }

  function resume(id) {
    if (disposed) return;
    const m = state.missions[id];
    const rt = runtimes[id];
    if (!m || !rt || m.status !== 'paused') return;
    if (m.takeover) return; // 接管态要通过 resumeFromTakeover / cancelTakeover 交还
    rt.userPaused = false;
    rt.blocked = false;
    const open = hasOpenApproval(m);
    const prev = rt.prevStatus && rt.prevStatus !== 'paused' ? rt.prevStatus : 'running';
    if (open) {
      m.status = 'waiting';
      setGroup(m, rt, 'need-you');
      commit();
      return;
    }
    m.status = prev === 'waiting' ? 'running' : prev;
    if (rt.group === 'need-you') setGroup(m, rt, rt.endMode === 'idle' ? 'standing' : 'running');
    if (!rt.end) thawTimeline(id);
    commit();
  }

  function setSpeed(level) {
    if (disposed) return;
    const next = level === 4 ? 4 : 1;
    if (state.speed === next) return;
    const old = state.speed;
    state.speed = next;
    // 正在等待的任务：把真实剩余等待按新旧速度换算，避免 4x 后还要等完整时长。
    for (let i = 0; i < order.length; i += 1) {
      const rt = runtimes[order[i]];
      if (rt && rt.cancel && rt.playing) {
        const remaining = remainingNow(rt) * (old / next);
        stopTimer(rt);
        scheduleNext(order[i], remaining);
      }
    }
    commit();
  }

  function resolveApproval(approvalId, optionId) {
    if (disposed) return;
    const found = findApproval(approvalId);
    if (!found) return;
    const m = found.mission;
    const ap = found.approval;
    const rt = found.runtime;
    if (!ap || ap.status !== 'open') return; // 幂等：重复点不产生副作用
    let label = '';
    for (let i = 0; i < (ap.options || []).length; i += 1) {
      if (ap.options[i].id === optionId) { label = ap.options[i].label; break; }
    }
    ap.status = 'resolved';
    ap.resolvedLabel = label || (optionId != null ? String(optionId) : '已处理');
    cancelAutoResolve(rt, ap.id);
    continueAfterApproval(found.mid);
    commit();
  }

  function takeOver(missionId, stepId, instruction) {
    if (disposed) return;
    const m = state.missions[missionId];
    const rt = runtimes[missionId];
    if (!m || !rt) return;
    const plan = m.plan || [];
    let activeStep = '';
    for (let i = 0; i < plan.length; i += 1) {
      if (plan[i].status === 'active') { activeStep = plan[i].id; break; }
    }
    if (!activeStep) {
      for (let i = 0; i < plan.length; i += 1) {
        if (plan[i].status === 'blocked') { activeStep = plan[i].id; break; }
      }
    }
    const text = instruction == null ? '' : String(instruction);
    if (m.takeover) {
      // 幂等：重复接管只更新方向，不重复冻结时间线
      if (stepId) m.takeover.stepId = stepId;
      m.takeover.instruction = text;
      commit();
      return;
    }
    freezeTimeline(rt);
    rt.userPaused = false;
    m.takeover = { stepId: stepId || activeStep || '', instruction: text };
    m.status = 'paused';
    commit();
  }

  function resumeFromTakeover(missionId, instruction) {
    if (disposed) return;
    const m = state.missions[missionId];
    const rt = runtimes[missionId];
    if (!m || !rt || !m.takeover) return;
    const taken = m.takeover;
    const text = instruction == null ? '' : String(instruction).trim();
    m.takeover = null;
    // 叙事：人类给过方向后 agent 更快 —— 后续 beat 等待减半。
    rt.halved = true;
    rt.feedSeq += 1;
    const ev = {
      id: missionId + '-f-' + rt.feedSeq,
      at: simAt(),
      actor: 'human',
      kind: 'note',
      title: '接手改写：' + (text || '按我的方向继续'),
      detail: text ? '已按你的方向改写后续执行。' : '已交还控制，后续节奏加快。',
      tone: 'human',
    };
    if (taken && taken.stepId) ev.stepId = taken.stepId;
    m.feed.push(ev);

    const open = hasOpenApproval(m);
    if (open) {
      rt.blocked = true;
      m.status = 'waiting';
      setGroup(m, rt, 'need-you');
    } else {
      rt.blocked = false;
      m.status = rt.endMode === 'idle' ? 'idle' : 'running';
      if (rt.group === 'need-you') setGroup(m, rt, rt.endMode === 'idle' ? 'standing' : 'running');
      if (!rt.end) thawTimeline(missionId);
    }
    commit();
  }

  function cancelTakeover(missionId) {
    if (disposed) return;
    const m = state.missions[missionId];
    const rt = runtimes[missionId];
    if (!m || !rt) return;
    const wasTakeover = !!m.takeover;
    m.takeover = null;
    rt.halved = false; // 恢复原速
    if (wasTakeover && m.status === 'paused') {
      const open = hasOpenApproval(m);
      rt.blocked = open;
      if (open) {
        m.status = 'waiting';
        setGroup(m, rt, 'need-you');
      } else {
        m.status = rt.endMode === 'idle' ? 'idle' : 'running';
        if (rt.group === 'need-you') setGroup(m, rt, rt.endMode === 'idle' ? 'standing' : 'running');
        if (!rt.end) thawTimeline(missionId);
      }
    } else if (rt.playing && rt.cancel) {
      // 已经交还但仍在半速：把当前这段剩余等待按原速拉长回去。
      const remaining = remainingNow(rt) * 2;
      stopTimer(rt);
      scheduleNext(missionId, remaining);
    }
    commit();
  }

  function fallbackTemplate() {
    return {
      title: '新任务',
      glyph: 'spark',
      group: 'running',
      status: 'running',
      autonomy: state.autonomy,
      policyNote: '按当前档位推进，遇到对外动作前问你。',
      plan: [{ id: 'x-clarify', kind: 'clarify', title: '澄清意图', hint: '缺的信息先自己补，补不上才问你。', status: 'active' }],
      feed: [],
      approvals: [],
      evidence: [],
      context: emptyContext(),
      artifact: null,
      beats: [
        { t: 800, kind: 'plan', stepId: 'x-clarify', status: 'done' },
        { t: 300, kind: 'mission', status: 'done', group: 'done' },
      ],
    };
  }

  function startMission(intent, templateId) {
    if (disposed) return null;
    const text = intent == null ? '' : String(intent).trim();
    const templates = SCEN.templates || {};
    let tpl = templateId && templates[templateId] ? templates[templateId] : null;
    if (!tpl) tpl = templates.research || null; // 模板不存在时回退 research
    const source = tpl || fallbackTemplate();
    const endMode = (source.group === 'standing' || source.status === 'idle') ? 'idle' : 'done';

    missionSeq += 1;
    const id = 'm-user-' + missionSeq;
    const chars = Array.from(text);
    const title = chars.length ? chars.slice(0, 18).join('') + (chars.length > 18 ? '…' : '') : (source.title || '新任务');

    const spec = clone(source);
    spec.id = id;
    spec.title = title;
    spec.intent = text || spec.title;
    spec.status = 'running';
    spec.group = 'running'; // 新任务先出现在「进行中」，跑完再归位
    spec.elapsedSec = 0;
    spec.costUsd = 0;
    spec.tokenCount = 0;
    spec.budgetUsd = num(spec.budgetUsd, 1.5);
    spec.takeover = null;
    if (spec.artifact) delete spec.artifact.deliveredTo; // 模板里的交付记录属于旧任务

    // 模板里的审批 id / missionId 都是占位：加任务后缀避免多次新建撞车。
    const idMap = {};
    (spec.approvals || []).forEach(function (ap) {
      if (!ap) return;
      const oldId = ap.id;
      ap.missionId = id;
      if (oldId) {
        ap.id = oldId + '-' + id;
        idMap[oldId] = ap.id;
      }
      if (!ap.status) ap.status = 'open';
    });
    (spec.beats || []).forEach(function (beat) {
      if (!beat || beat.kind !== 'approval' || !beat.approval) return;
      const oldId = beat.approval.id;
      beat.approval.missionId = id;
      if (oldId) {
        beat.approval.id = oldId + '-' + id;
        idMap[oldId] = beat.approval.id;
      }
      beat.approval.status = 'open';
    });
    if (Array.isArray(spec.autoResolve)) {
      spec.autoResolve.forEach(function (conf) {
        if (conf && conf.approvalId && idMap[conf.approvalId]) conf.approvalId = idMap[conf.approvalId];
      });
    }

    const mission = buildMission(spec, id);
    mission.group = 'running';
    state.missions[id] = mission;
    order.unshift(id); // 插到舰队最前
    const rt = createRuntime(mission, spec, endMode);
    rt.group = 'running';
    mission.group = 'running';
    runtimes[id] = rt;
    costTracked[id] = 0;
    tokenTracked[id] = 0;
    collectInitialAutoConfigs(spec, id).forEach(function (conf) { rt.autoConfigs.set(conf.approvalId, conf); });
    rt.snapshot = {
      mission: clone(mission),
      beats: clone(rt.beats),
      group: rt.group,
      endMode: rt.endMode,
      autoConfigs: mapToObject(rt.autoConfigs),
    };

    state.selectedId = id;
    state.selected = mission;
    state.flash = { kind: 'ok', text: '已派给 agent：' + title };

    const open = mission.approvals.filter(function (ap) { return ap.status === 'open'; });
    open.forEach(function (ap) {
      const conf = rt.autoConfigs.get(ap.id);
      if (conf && rankOf(mission.autonomy) >= rankOf(conf.level)) scheduleAutoResolve(id, ap, conf);
    });
    if (open.length) {
      rt.blocked = true;
      mission.status = 'waiting';
      setGroup(mission, rt, 'need-you');
    } else if (rt.beats.length) {
      startPlayback(id);
    }
    commit();
    return id;
  }

  function confirmPlan(missionId) {
    if (disposed) return;
    const m = state.missions[missionId];
    const rt = runtimes[missionId];
    if (!m || !rt || rt.end) return;
    if (hasOpenApproval(m) || m.takeover || m.status === 'paused') return;
    if (rt.started) return; // 已在跑：幂等
    m.status = 'running';
    if (rt.group !== 'standing') setGroup(m, rt, 'running');
    if (rt.beats.length) startPlayback(missionId);
    else finishBeats(missionId);
    commit();
  }

  function replay(missionId) {
    if (disposed) return;
    const m = state.missions[missionId];
    const rt = runtimes[missionId];
    if (!m || !rt || !rt.snapshot) return;
    stopTimer(rt);
    rt.autoTimers.forEach(function (cancel) { try { cancel(); } catch (err) { /* 忽略 */ } });
    rt.autoTimers.clear();

    // 原地恢复，保证 state.selected 引用不变（视图按引用比较选中态）。
    for (const key of Object.keys(m)) delete m[key];
    Object.assign(m, clone(rt.snapshot.mission));

    rt.beats = clone(rt.snapshot.beats);
    rt.idx = 0;
    rt.started = false;
    rt.blocked = false;
    rt.userPaused = false;
    rt.halved = false;
    rt.end = false;
    rt.playing = false;
    rt.remainingMs = null;
    rt.pauseDiv = 1;
    rt.scheduledWait = 0;
    rt.prevStatus = null;
    rt.group = rt.snapshot.group || 'running';
    rt.endMode = rt.snapshot.endMode || 'done';
    rt.autoConfigs = new Map();
    const confs = rt.snapshot.autoConfigs || {};
    Object.keys(confs).forEach(function (key) { rt.autoConfigs.set(key, clone(confs[key])); });
    m.group = rt.group;

    const open = (m.approvals || []).filter(function (ap) { return ap.status === 'open'; });
    open.forEach(function (ap) {
      const conf = rt.autoConfigs.get(ap.id);
      if (conf && rankOf(m.autonomy) >= rankOf(conf.level)) scheduleAutoResolve(missionId, ap, conf);
    });
    if (open.length) {
      rt.blocked = true;
      if (m.status !== 'paused' && m.status !== 'done') {
        m.status = 'waiting';
        setGroup(m, rt, 'need-you');
      }
    } else {
      if (m.status === 'waiting') m.status = 'running';
      if (rt.beats.length && m.status !== 'paused' && m.status !== 'done' && m.status !== 'draft') {
        startPlayback(missionId);
      }
    }
    state.flash = { kind: 'ok', text: '已回到初始剧本，重新播放' };
    commit();
  }

  function consumeFlash() {
    if (disposed) return;
    if (!state.flash) return;
    state.flash = null;
    commit();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (notifyCancel) {
      try { notifyCancel(); } catch (err) { /* 忽略 */ }
      notifyCancel = null;
    }
    timers.forEach(function (cancel) { try { cancel(); } catch (err) { /* 忽略 */ } });
    timers.clear();
    Object.keys(runtimes).forEach(function (mid) {
      const rt = runtimes[mid];
      if (!rt) return;
      rt.autoTimers.forEach(function (cancel) { try { cancel(); } catch (err) { /* 忽略 */ } });
      rt.autoTimers.clear();
      rt.cancel = null;
      rt.playing = false;
    });
    subscribers.length = 0;
  }

  /* ══════════════════════════════════════════════════════════
   * 8. 初始化：快照、初始审批、自动放行、时钟
   * ══════════════════════════════════════════════════════════ */

  function initMissionPlayback(mid) {
    const m = state.missions[mid];
    const rt = runtimes[mid];
    if (!m || !rt) return;
    const open = (m.approvals || []).filter(function (ap) { return ap.status === 'open'; });
    open.forEach(function (ap) {
      const conf = rt.autoConfigs.get(ap.id);
      if (conf && rankOf(m.autonomy) >= rankOf(conf.level)) scheduleAutoResolve(mid, ap, conf);
    });
    if (open.length) {
      rt.blocked = true;
      if (m.status !== 'paused' && m.status !== 'done') {
        m.status = 'waiting';
        setGroup(m, rt, 'need-you');
      }
      return; // 初始就有 open 审批：先等审批（m-weekly 的剧本从裁定之后开始）
    }
    if (m.status === 'waiting') m.status = 'running';
    if (m.status === 'done' || m.status === 'paused' || m.status === 'draft') return;
    if (rt.beats.length) startPlayback(mid);
  }

  let clockCancel = null;
  let elapsedCancel = null;

  function tickClock() {
    clockCancel = null;
    if (disposed) return;
    elapsedRealSec += 1;
    const next = fmtClock(START_CLOCK_MIN + Math.floor(elapsedRealSec / 60));
    const changed = next !== state.clock;
    state.clock = next;
    if (changed) commit();
    clockCancel = later(tickClock, 1000);
  }

  function tickElapsed() {
    elapsedCancel = null;
    if (disposed) return;
    let changed = false;
    for (let i = 0; i < order.length; i += 1) {
      const m = state.missions[order[i]];
      const rt = runtimes[order[i]];
      if (!m) continue;
      // 暂停/已完成/草稿不走耗时；审批等待也算任务耗时（人在等，任务时间在流逝）。
      if (m.status === 'paused' || m.status === 'done' || m.status === 'draft') continue;
      // 每 5 秒真实时间 ≈ 15 秒任务耗时（播放 1 秒 ≈ 3 秒任务耗时）。
      m.elapsedSec = num(m.elapsedSec, 0) + 15;
      changed = true;
      // 成本只在真正推进时涨；审批等待期间不涨，避免「等待也在烧钱」的错误暗示。
      if (rt && rt.playing) {
        m.costUsd = round6(num(m.costUsd, 0) + 0.003); // ≈ $0.0006 / 播放秒
        m.tokenCount = Math.round(num(m.tokenCount, 0) + 1000);
      }
    }
    if (changed) commit();
    elapsedCancel = later(tickElapsed, 5000);
  }

  (function init() {
    const specs = Array.isArray(SCEN.missions) ? SCEN.missions : [];
    let firstNeedYou = '';

    specs.forEach(function (spec) {
      if (!spec || !spec.id) return;
      const id = String(spec.id);
      if (state.missions[id]) return;
      const mission = buildMission(spec, id);
      state.missions[id] = mission;
      order.push(id);
      const rt = createRuntime(mission, spec);
      runtimes[id] = rt;
      collectInitialAutoConfigs(spec, id).forEach(function (conf) { rt.autoConfigs.set(conf.approvalId, conf); });
      costTracked[id] = num(mission.costUsd, 0);
      tokenTracked[id] = num(mission.tokenCount, 0);
      if (!firstNeedYou && rt.group === 'need-you') firstNeedYou = id;
    });

    // 先起播放/审批，再拍「初始快照」——这样 replay 恢复的是"打开驾驶舱那一刻"，
    // 但初始 status 已按 open 审批做过归一（waiting 的该等就等）。
    order.forEach(function (mid) { initMissionPlayback(mid); });
    order.forEach(function (mid) {
      const rt = runtimes[mid];
      const m = state.missions[mid];
      if (!rt || !m) return;
      rt.snapshot = {
        mission: clone(m),
        beats: clone(rt.beats),
        group: rt.group,
        endMode: rt.endMode,
        autoConfigs: mapToObject(rt.autoConfigs),
      };
    });

    // 初始选中：第一个「需要你」的任务；没有就选第一个（Lead 约定）。
    state.selectedId = firstNeedYou || order[0] || '';
    state.selected = state.selectedId ? state.missions[state.selectedId] : null;
    syncFleet(); // 只填充初值，不 rev++（打开瞬间 rev=0 就是快照）

    clockCancel = later(tickClock, 1000);
    elapsedCancel = later(tickElapsed, 5000);
  })();

  /* ══════════════════════════════════════════════════════════
   * 9. 对外接口
   * ══════════════════════════════════════════════════════════ */

  const actions = {
    selectMission: selectMission,
    setAutonomy: setAutonomy,
    setMissionAutonomy: setMissionAutonomy,
    pause: pause,
    resume: resume,
    setSpeed: setSpeed,
    resolveApproval: resolveApproval,
    takeOver: takeOver,
    resumeFromTakeover: resumeFromTakeover,
    cancelTakeover: cancelTakeover,
    startMission: startMission,
    confirmPlan: confirmPlan,
    replay: replay,
    consumeFlash: consumeFlash,
  };

  return {
    getState: function () { return state; },
    subscribe: subscribe,
    actions: actions,
    getSpeed: function () { return state.speed; },
    dispose: dispose,
  };
}
