/**
 * HELM · 左栏「舰队」视图（view-fleet.js）
 *
 * 职责：今日任务的分组总览 + 新建任务入口 + 底部今日统计。
 * 结构（自上而下）：h-sec 小节头 → 新建入口（收起态单行 / 展开态就地输入区）
 *                  → 分组列表（独立滚动）→ 底部一行灰色统计。
 *
 * 布局取舍（为什么这么排）：
 * 1) 新建入口固定在滚动区之外。它是这一栏唯一的「主动作」，长列表滚动时不该被滚走；
 *    收起态只占一行（30px），展开时就地长高，代价可接受。
 * 2) 分组标题 sticky 在滚动区顶部：任务多起来以后，滚到哪里都知道自己在哪一段。
 * 3) 任务卡只给两行文字：标题（最多两行截断）+ 一行等宽副信息；292px 宽度放不下更多层级，
 *    信息密度靠字号与颜色差来拉，不靠分隔线，保证「发丝线」只出现在结构上。
 * 4) 信号色只用两处：需要你 / 选中任务的左竖条，以及「等你决定」徽标。其余状态色收在状态点里。
 *
 * 状态：本视图只保存纯 UI 状态（草稿文本 / 模板 / 展开与否 / 光标位置），引擎状态一律只读。
 */

/* 分组顺序固定：需要你 → 进行中 → 常驻 → 已完成。空组不渲染（见 render）。 */
const fleetGroups = [
  { key: 'need-you', label: '需要你' },
  { key: 'running', label: '进行中' },
  { key: 'standing', label: '常驻' },
  { key: 'done', label: '已完成' },
];

/* 状态 → 徽标文案 / 徽标样式 / 状态点样式。只有「等你决定」用信号色，其余徽标保持中性。 */
const fleetStatusMeta = {
  waiting: { label: '等你决定', badge: 'fleet-badge--wait', dot: 'h-dot--signal' },
  waits: { label: '等你决定', badge: 'fleet-badge--wait', dot: 'h-dot--signal' },
  running: { label: '执行中', badge: 'fleet-badge--run', dot: 'h-dot--signal' },
  queued: { label: '排队中', badge: 'fleet-badge--run', dot: 'h-dot--signal' },
  draft: { label: '草稿', badge: '', dot: '' },
  paused: { label: '已暂停', badge: 'fleet-badge--pause', dot: 'h-dot--warn' },
  done: { label: '已完成', badge: 'fleet-badge--done', dot: 'h-dot--ok' },
  idle: { label: '常驻', badge: 'fleet-badge--idle', dot: 'h-dot--info' },
};

/* group 缺失时按 status 兜底归组，避免剧本字段不齐时整栏空白。 */
const fleetFallbackGroup = {
  draft: 'running',
  queued: 'running',
  running: 'running',
  waiting: 'need-you',
  waits: 'need-you',
  paused: 'need-you',
  idle: 'standing',
  done: 'done',
};

/* 快捷意图：chip 只负责把意图原文填进 textarea + 记住模板，是否真的派发必须由用户二次确认。 */
const fleetTemplates = [
  {
    id: 'research',
    label: '竞品周报',
    intent: '把上周 7 家竞品的动作收成一页周报，标出 3 件值得跟进的事，发我飞书',
  },
  {
    id: 'build',
    label: 'PRD 拆任务',
    intent: '把这份 PRD 拆成开发任务：按依赖排好顺序，每条给出验收标准和工作量',
  },
  {
    id: 'watch',
    label: '监控竞品发布',
    intent: '盯着这 5 家竞品的发布页和 changelog，有更新就摘要并标出风险',
  },
];

/** 取任务所属分组；group 不在枚举里时按 status 兜底。 */
function fleetGroupOf(item) {
  if (!item) return 'running';
  const group = item.group;
  if (group === 'need-you' || group === 'running' || group === 'standing' || group === 'done') return group;
  return fleetFallbackGroup[item.status] || 'running';
}

/** 任务卡第二行的等宽副信息：elapsed · cost · progress（缺字段就跳过，不留空分隔符）。 */
function fleetItemLine(item, H) {
  const parts = [];
  if (item.elapsed) parts.push(item.elapsed);
  if (typeof item.costUsd === 'number') parts.push(H.fmtUsd(item.costUsd));
  if (item.progress) parts.push(item.progress);
  return parts.join(' · ');
}

/** 顶部今日统计："3 跑 · 1 等你"。跑 = 进行中组，等你 = 需要你组。 */
function fleetStatParts(fleet) {
  const running = fleet.filter((it) => it && fleetGroupOf(it) === 'running').length;
  const waiting = fleet.filter((it) => it && fleetGroupOf(it) === 'need-you').length;
  const parts = [];
  if (running) parts.push({ text: running + ' 跑' });
  if (waiting) parts.push({ text: waiting + ' 等你', tone: 'signal' });
  if (!parts.length) parts.push({ text: fleet.length ? fleet.length + ' 项' : '待命' });
  return parts;
}

/*
 * main.js 在 document 捕获阶段处理 Esc（插件模式下会直接关闭整个驾驶舱）。
 * 输入区展开时 Esc 的语义是「只收起输入区」，所以必须在更外层的 window 捕获阶段先吃掉它；
 * 收起来之后再按一次，才轮到 main 的全局 Esc（关闭）。全局只绑一个监听，随视图实例更新 owner。
 */
let fleetEscOwner = null;
let fleetEscGuardBound = false;

function fleetBindEscGuard() {
  if (fleetEscGuardBound || typeof window === 'undefined' || !window.addEventListener) return;
  fleetEscGuardBound = true;
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !fleetEscOwner) return;
      if (fleetEscOwner(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );
}

/**
 * 创建左栏舰队视图。
 * ctx = { engine, H, actions, ui }，ui = { focusPanels(tab), close() }（都可缺失，视图自兜底）。
 */
function createFleetView(ctx) {
  const conf = ctx || {};
  const Hx = conf.H || H; // 同一 IIFE 里 H 一定存在，ctx.H 只作覆盖
  const actions = conf.actions || (conf.engine && conf.engine.actions) || {};
  const ui = conf.ui || {};
  fleetBindEscGuard();

  /* 纯 UI 状态：全量重建时草稿、展开态、模板选择、光标都不能丢。 */
  const draft = { open: false, text: '', templateId: 'research', caret: null };
  let lastRoot = null; // 上一帧的根节点：用来判断重建前焦点是否还在输入框里
  let restoreToken = 0; // 只在「最新一帧」上恢复焦点，避免多次重建互相抢焦点

  /** 构建单张任务卡（button 语义 + aria-pressed 表示选中）。 */
  function buildItem(item, state) {
    const group = fleetGroupOf(item);
    const meta = fleetStatusMeta[item.status] || { label: item.status || '—', badge: '', dot: '' };
    const selected = item.id === state.selectedId;

    const cls = ['fleet-item'];
    if (group === 'need-you') cls.push('fleet-item--need');
    if (selected) cls.push('fleet-item--selected');

    // 有未读 → 呼吸点；否则按状态给点着色（状态色只允许出现在点上）。
    const dotClass = (item.unread ? 'h-dot h-dot--live' : 'h-dot ' + (meta.dot || '')).trim();

    const card = Hx.el(
      'button',
      {
        type: 'button',
        class: cls.join(' '),
        'data-testid': 'fleet-item-' + item.id,
        'data-id': item.id,
        'aria-pressed': String(selected),
        title: item.title || '未命名任务',
      },
      Hx.el('span', { class: dotClass + ' fleet-item__dot', 'aria-hidden': 'true' }),
      Hx.el(
        'span.fleet-item__body',
        null,
        Hx.el('span.fleet-item__title', { text: item.title || '未命名任务' }),
        Hx.el('span.fleet-item__meta.h-mono', { text: fleetItemLine(item, Hx) }),
      ),
      Hx.el('span', { class: ('fleet-badge ' + (meta.badge || '')).trim(), text: meta.label }),
    );

    card.addEventListener('click', () => {
      if (typeof actions.selectMission === 'function') actions.selectMission(item.id);
      // 点开「需要你」的任务时顺手把右栏切到待你处理：左栏的决策入口直达处理面板。
      if (group === 'need-you' && typeof ui.focusPanels === 'function') ui.focusPanels('inbox');
    });

    return card;
  }

  function render(state) {
    const s = state || {};
    const fleet = Array.isArray(s.fleet) ? s.fleet : [];

    // 引擎每次 rev 变化都会整栏重建。先记下「上一帧焦点在不在输入框」，后面挂载后再还焦点，
    // 否则用户打到一半的意图会被每秒一次的时钟刷新打断。
    const prevActive =
      lastRoot && lastRoot.contains(document.activeElement) ? document.activeElement : null;
    const hadInputFocus = !!(prevActive && prevActive.classList && prevActive.classList.contains('fleet-input'));
    if (hadInputFocus) {
      draft.caret = [prevActive.selectionStart, prevActive.selectionEnd];
      draft.open = true;
    }

    const root = Hx.el('div.h-view.fleet-root', {
      'data-testid': 'fleet-root',
      role: 'region',
      'aria-label': '今日舰队',
    });

    /* ---------- 1. 小节头 + 今日统计 ---------- */
    const stat = Hx.el('span.fleet-stat.h-mono');
    fleetStatParts(fleet).forEach((part, index) => {
      if (index) stat.appendChild(Hx.el('span.fleet-stat__sep', { text: ' · ' }));
      stat.appendChild(Hx.el('span', { class: part.tone === 'signal' ? 'fleet-stat__signal' : '', text: part.text }));
    });
    const aside = Hx.el('div.h-sec__aside');
    if (fleet.some((it) => it && fleetGroupOf(it) === 'running')) {
      aside.appendChild(Hx.el('span.h-dot.h-dot--live', { 'aria-hidden': 'true' }));
    }
    aside.appendChild(stat);
    root.appendChild(
      Hx.el('div.h-sec.fleet-sec', null, Hx.el('span.h-sec__label', { text: '今日舰队' }), aside),
    );

    /* ---------- 2. 新建任务入口（收起态单行 / 展开态输入区） ---------- */
    const newbar = Hx.el('div.fleet-newbar');
    const composer = Hx.el('div.fleet-composer', {
      hidden: !draft.open,
      id: 'fleet-composer',
      'aria-label': '新建任务',
    });
    const entryAside = Hx.el('span.fleet-new__aside.h-mono', { text: draft.open ? 'Esc 收起' : '' });
    const entry = Hx.el(
      'button.fleet-new',
      {
        type: 'button',
        'data-testid': 'fleet-new',
        'aria-expanded': String(draft.open),
        'aria-controls': 'fleet-composer',
      },
      Hx.el('span.fleet-new__plus', null, Hx.icon('plus', 13)),
      Hx.el('span.fleet-new__label', { text: '派一个新任务' }),
      entryAside,
    );

    const ta = Hx.el('textarea.fleet-input', {
      rows: '3',
      'data-testid': 'fleet-input',
      placeholder: '比如：把上周 7 家竞品的动作收成一页周报，标出 3 件值得跟进的事，发我飞书',
      'aria-label': '新任务的意图',
      spellcheck: 'false',
    });
    ta.value = draft.text;

    const chips = Hx.el('div.fleet-chips', { role: 'group', 'aria-label': '快捷意图' });
    const submit = Hx.el(
      'button.h-btn.h-btn--primary.h-btn--sm.h-btn--block.fleet-submit',
      { type: 'button', 'data-testid': 'fleet-submit', disabled: !draft.text.trim() },
      '派给 agent ▸',
    );
    const hint = Hx.el('span.fleet-hint', { text: 'Enter 派发 · Shift+Enter 换行' });

    // 输入区只在展开时才有必要撑高；收起时 DOM 仍保留（hidden），避免每次切换都丢状态。
    const autosize = () => {
      ta.style.height = 'auto';
      ta.style.height = Hx.clamp(ta.scrollHeight, 64, 148) + 'px';
    };
    const syncSubmit = () => {
      submit.disabled = !draft.text.trim();
    };
    const syncChips = () => {
      chips.querySelectorAll('.fleet-chip').forEach((chip) => {
        chip.setAttribute('aria-pressed', String(chip.getAttribute('data-template-id') === draft.templateId));
      });
    };

    const setOpen = (open) => {
      draft.open = open;
      composer.hidden = !open;
      entry.setAttribute('aria-expanded', String(open));
      entryAside.textContent = open ? 'Esc 收起' : '';
      if (open) {
        ta.focus({ preventScroll: true });
        const end = ta.value.length;
        try {
          ta.setSelectionRange(end, end);
        } catch (err) {
          /* 某些环境（如非交互式宿主）不支持 selection，忽略即可 */
        }
        autosize();
      }
    };

    // 输入区展开时，Esc 先收输入区（window 捕获层），不关驾驶舱
    fleetEscOwner = (event) => {
      if (!draft.open || !entry.isConnected) {
        if (!entry.isConnected) fleetEscOwner = null; // 视图已卸载，别占着全局 Esc
        return false;
      }
      // 只在焦点还在这栏（或什么都没聚焦）时拦截：别的栏的输入框有自己的 Esc 语义
      const target = event && event.target;
      if (target && target.nodeType === 1 && target !== document.body && !root.contains(target)) return false;
      setOpen(false);
      entry.focus({ preventScroll: true });
      return true;
    };

    const dispatch = () => {
      const intent = ta.value.trim();
      if (!intent) return;
      const templateId = draft.templateId || 'research';
      // 先清空本地草稿再派发：startMission 会同步触发 rev++ 重建，
      // 顺序反了的话新一帧会拿到旧草稿。
      draft.text = '';
      draft.open = false;
      draft.caret = null;
      ta.value = '';
      composer.hidden = true;
      entry.setAttribute('aria-expanded', 'false');
      entryAside.textContent = '';
      submit.disabled = true;
      // 先失焦：main.js 有「输入框聚焦时跳过重绘」的守卫，不失焦的话派发后列表要等下一拍才刷新
      if (typeof ta.blur === 'function') ta.blur();
      if (typeof actions.startMission === 'function') actions.startMission(intent, templateId);
    };

    // 快捷意图：只填草稿，不替用户做决定
    fleetTemplates.forEach((tpl) => {
      const chip = Hx.el(
        'button.h-chip.fleet-chip',
        {
          type: 'button',
          'data-testid': 'fleet-quick-' + tpl.id,
          'data-template-id': tpl.id,
          'aria-pressed': String(draft.templateId === tpl.id),
          title: tpl.intent,
        },
        tpl.label,
      );
      chip.addEventListener('click', () => {
        draft.text = tpl.intent;
        draft.templateId = tpl.id;
        draft.caret = [tpl.intent.length, tpl.intent.length];
        ta.value = tpl.intent;
        syncChips();
        syncSubmit();
        ta.focus({ preventScroll: true });
        try {
          ta.setSelectionRange(draft.caret[0], draft.caret[1]);
        } catch (err) {
          /* 忽略 */
        }
        autosize();
      });
      chips.appendChild(chip);
    });

    entry.addEventListener('click', () => setOpen(!draft.open));

    ta.addEventListener('input', () => {
      draft.text = ta.value;
      draft.caret = [ta.selectionStart, ta.selectionEnd];
      autosize();
      syncSubmit();
    });
    ['keyup', 'click', 'select'].forEach((evt) => {
      ta.addEventListener(evt, () => {
        draft.caret = [ta.selectionStart, ta.selectionEnd];
      });
    });
    ta.addEventListener('keydown', (evt) => {
      // 中文输入法组词中（isComposing / keyCode 229），Enter 是选词，不是派发
      if (evt.isComposing || evt.keyCode === 229) return;
      if (evt.key === 'Escape') {
        evt.preventDefault();
        evt.stopPropagation(); // 别让 Esc 冒泡成「关闭驾驶舱」
        setOpen(false);
        entry.focus({ preventScroll: true });
        return;
      }
      if (evt.key === 'Enter' && !evt.shiftKey) {
        evt.preventDefault();
        dispatch();
      }
    });
    // 焦点在 chip / 提交按钮上时，Esc 同样只收起输入区
    composer.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Escape' || evt.defaultPrevented) return;
      evt.stopPropagation();
      setOpen(false);
      entry.focus({ preventScroll: true });
    });
    submit.addEventListener('click', dispatch);

    composer.appendChild(ta);
    composer.appendChild(chips);
    composer.appendChild(submit);
    composer.appendChild(hint);
    newbar.appendChild(entry);
    newbar.appendChild(composer);
    root.appendChild(newbar);

    /* ---------- 3. 分组列表（唯一滚动区） ---------- */
    const list = Hx.el('div.fleet-list.h-scroll', { 'data-testid': 'fleet-list' });
    if (!fleet.length) {
      list.appendChild(
        Hx.el(
          'div.h-empty',
          null,
          Hx.icon('radar', 22),
          Hx.el('span', { text: '舰队还是空的' }),
          Hx.el('span.fleet-empty__hint', { text: '派一个任务，看它自己跑起来' }),
        ),
      );
    }
    fleetGroups.forEach((group) => {
      const items = fleet.filter((it) => it && fleetGroupOf(it) === group.key);
      if (!items.length) return; // 空组不渲染
      const section = Hx.el('div.fleet-group', { role: 'group', 'aria-label': group.label });
      if (group.key === 'need-you') section.className += ' fleet-group--need';
      section.appendChild(
        Hx.el(
          'div.fleet-group__head',
          null,
          Hx.el('span.fleet-group__label', { text: group.label }),
          Hx.el('span.fleet-group__count.h-mono', { text: String(items.length) }),
          Hx.el('span.fleet-group__line', { 'aria-hidden': 'true' }),
        ),
      );
      items.forEach((item) => section.appendChild(buildItem(item, s)));
      list.appendChild(section);
    });
    root.appendChild(list);

    /* ---------- 4. 底部今日统计 ---------- */
    const budget = s.budget || {};
    const foot = Hx.el(
      'div.fleet-foot',
      null,
      Hx.el('span.fleet-foot__stats.h-mono', {
        text: Hx.fmtTokens(budget.usedTokens || 0) + ' tok · ' + Hx.fmtUsd(budget.usedUsd || 0),
        title: '今日 tokens 与花费',
      }),
    );
    const escBtn = Hx.el(
      'button.fleet-esc',
      { type: 'button', 'data-testid': 'fleet-close', 'aria-label': '关闭驾驶舱', title: '关闭驾驶舱（Esc）' },
      Hx.el('span.h-kbd', { text: 'Esc' }),
      Hx.el('span.fleet-esc__label', { text: '关闭' }),
    );
    escBtn.addEventListener('click', () => {
      if (typeof ui.close === 'function') ui.close();
    });
    foot.appendChild(escBtn);
    root.appendChild(foot);

    /* ---------- 挂载后：输入框自动撑高 + 还焦点 ---------- */
    lastRoot = root;
    const token = ++restoreToken;
    if (draft.open) {
      setTimeout(() => {
        if (token !== restoreToken || !root.isConnected) return;
        autosize(); // 重建后 textarea 还没挂载时 scrollHeight 为 0，需要挂载后再量一次
        if (!hadInputFocus) return;
        ta.focus({ preventScroll: true });
        const caret = draft.caret || [ta.value.length, ta.value.length];
        try {
          ta.setSelectionRange(Math.min(caret[0], ta.value.length), Math.min(caret[1], ta.value.length));
        } catch (err) {
          /* 忽略 */
        }
      }, 0);
    }

    return root;
  }

  return { render };
}

/* 视图私有样式：全部 class 前缀 fleet-，只使用 tokens.css 的变量，不改共享样式表。 */
HELM_STYLES.push(`
/* ---------- 左栏根：头部/入口/底部固定，中间列表独立滚动 ---------- */
.fleet-root {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--h-bg-2);
}

/* ---------- 小节头右侧统计 ---------- */
.h-sec.fleet-sec { padding: 0 13px; }
.fleet-stat {
  display: inline-flex;
  align-items: center;
  font-size: 9.5px;
  color: var(--h-text-4);
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.fleet-stat__sep { color: var(--h-text-4); opacity: 0.65; }
.fleet-stat__signal { color: var(--h-signal); }

/* ---------- 新建任务入口 ---------- */
.fleet-newbar {
  flex: none;
  padding: 10px 12px 11px;
  border-bottom: 1px solid var(--h-line);
}
.fleet-new {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  height: 30px;
  padding: 0 9px;
  border: 1px dashed var(--h-line-2);
  border-radius: 8px;
  background: transparent;
  color: var(--h-text-2);
  font-family: inherit;
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.fleet-new:hover {
  color: var(--h-text);
  border-color: var(--h-signal-line);
  background: var(--h-signal-dim);
}
.fleet-new:focus-visible { outline: 2px solid var(--h-signal); outline-offset: 1px; }
.fleet-new[aria-expanded="true"] {
  color: var(--h-text);
  border-style: solid;
  border-color: var(--h-signal-line);
  background: var(--h-signal-dim);
}
.fleet-new__plus { display: grid; place-items: center; color: var(--h-signal); }
.fleet-new__plus svg { transition: transform 0.18s var(--h-ease); }
.fleet-new[aria-expanded="true"] .fleet-new__plus svg { transform: rotate(45deg); }
.fleet-new__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fleet-new__aside {
  margin-left: auto;
  font-size: 9px;
  color: var(--h-text-4);
  letter-spacing: 0.02em;
}

/* ---------- 展开态输入区 ---------- */
.fleet-composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 9px;
}
.fleet-composer[hidden] { display: none; }
.fleet-input {
  display: block;
  width: 100%;
  min-height: 64px;
  padding: 8px 9px;
  border: 1px solid var(--h-line-2);
  border-radius: 8px;
  background: var(--h-bg);
  color: var(--h-text);
  font-family: var(--h-sans);
  font-size: 11.5px;
  line-height: 1.5;
  resize: none;
  outline: none;
  overflow-y: auto;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.fleet-input::placeholder { color: var(--h-text-4); }
.fleet-input:hover { border-color: var(--h-line-3); }
.fleet-input:focus-visible {
  border-color: var(--h-signal-line);
  box-shadow: 0 0 0 2px rgba(242, 163, 60, 0.12);
}
.fleet-chips { display: flex; flex-wrap: wrap; gap: 5px; }
/* 视图样式在 app.css 之前注入，所以压过 .h-chip 需要双类选择器 */
.fleet-chips .fleet-chip {
  height: 21px;
  padding: 0 8px;
  font-family: inherit;
  font-size: 10.5px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.fleet-chip:hover { color: var(--h-text); border-color: var(--h-line-3); }
.fleet-chip:focus-visible { outline: 2px solid var(--h-signal); outline-offset: 1px; }
.fleet-chip[aria-pressed="true"] {
  color: var(--h-signal);
  border-color: var(--h-signal-line);
  background: var(--h-signal-dim);
}
/* 同上：压过 .h-btn / .h-btn:focus-visible 的默认值 */
.fleet-composer .fleet-submit { font-size: 11px; letter-spacing: 0.01em; }
/* 琥珀底按钮上信号色描边看不见，改用暖白描边 */
.fleet-composer .fleet-submit:focus-visible { outline: 2px solid var(--h-text); outline-offset: 1px; }
.fleet-hint {
  font-family: var(--h-mono);
  font-size: 9px;
  color: var(--h-text-4);
  text-align: center;
  letter-spacing: 0.02em;
  user-select: none;
}

/* ---------- 分组列表 ---------- */
.fleet-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 10px 12px;
}
.fleet-group { margin-top: 2px; }
.fleet-group__head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 2px 5px;
  background: var(--h-bg-2);
}
.fleet-group__label {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: var(--h-text-4);
}
.fleet-group--need .fleet-group__label { color: var(--h-signal); }
.fleet-group__count { font-size: 9px; color: var(--h-text-4); }
.fleet-group__line { flex: 1; height: 1px; background: var(--h-line); }

/* ---------- 任务卡：6px 状态点 / 两行正文 / 右侧徽标 ---------- */
.fleet-item {
  position: relative;
  display: grid;
  grid-template-columns: 6px minmax(0, 1fr) auto;
  column-gap: 8px;
  align-items: start;
  width: 100%;
  margin: 0 0 3px;
  padding: 7px 8px 7px 11px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--h-text);
  font-family: inherit;
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
/* 左竖条：需要你 / 选中 都点亮，用绝对定位避免挤占文字宽度 */
.fleet-item::before {
  content: "";
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 2px;
  border-radius: 2px;
  background: transparent;
  transition: background 0.15s;
}
.fleet-item:hover { background: var(--h-panel-2); }
.fleet-item:active { transform: translateY(0.5px); }
.fleet-item:focus-visible { outline: 2px solid var(--h-signal); outline-offset: -1px; }
.fleet-item__dot { margin-top: 5px; }
.fleet-item__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.fleet-item__title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--h-text);
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.42;
  word-break: break-word;
}
.fleet-item:hover .fleet-item__title { color: #fff; }
.fleet-item__meta {
  font-size: 9.5px;
  color: var(--h-text-4);
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 需要你：极轻信号色底 + 琥珀竖条 */
.fleet-item--need {
  background: rgba(242, 163, 60, 0.055);
  border-color: rgba(242, 163, 60, 0.12);
}
.fleet-item--need::before { background: var(--h-signal); opacity: 0.9; }
.fleet-item--need:hover {
  background: rgba(242, 163, 60, 0.095);
  border-color: var(--h-signal-line);
}
/* 选中：边框提亮 + 左竖条（放在 need 之后，保证叠加时仍是最强的那一层） */
.fleet-item--selected {
  background: var(--h-panel-2);
  border-color: var(--h-line-3);
}
.fleet-item--selected::before { background: var(--h-signal); opacity: 1; }
.fleet-item--selected .fleet-item__title { color: #fff; }
.fleet-item--need.fleet-item--selected {
  background: rgba(242, 163, 60, 0.1);
  border-color: var(--h-line-3);
}

/* ---------- 状态徽标：中性，只有「等你决定」用信号色 ---------- */
.fleet-badge {
  display: inline-flex;
  align-items: center;
  height: 17px;
  padding: 0 5px;
  border: 1px solid var(--h-line);
  border-radius: 5px;
  background: transparent;
  color: var(--h-text-3);
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.fleet-badge--wait {
  color: var(--h-signal);
  border-color: var(--h-signal-line);
  background: var(--h-signal-dim);
}
.fleet-badge--run { color: var(--h-text-2); border-color: var(--h-line-2); }
.fleet-badge--pause { color: var(--h-text-3); }
.fleet-badge--done { color: var(--h-text-4); border-color: transparent; }
.fleet-badge--idle { color: var(--h-text-3); border-color: transparent; }

/* ---------- 空态 ---------- */
.fleet-empty__hint { font-size: 10.5px; color: var(--h-text-4); }

/* ---------- 底部今日统计 ---------- */
.fleet-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px;
  border-top: 1px solid var(--h-line);
  background: var(--h-bg-2);
}
.fleet-foot__stats {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 9.5px;
  color: var(--h-text-4);
  letter-spacing: 0.02em;
}
.fleet-esc {
  flex: none;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 5px 0 2px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--h-text-4);
  font-family: inherit;
  font-size: 9.5px;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.fleet-esc:hover { color: var(--h-text-2); background: var(--h-panel-2); }
.fleet-esc:focus-visible { outline: 2px solid var(--h-signal); outline-offset: 1px; }

@media (prefers-reduced-motion: reduce) {
  .fleet-new,
  .fleet-new__plus svg,
  .fleet-input,
  .fleet-chip,
  .fleet-item,
  .fleet-item::before,
  .fleet-esc { transition: none; }
}
`);
