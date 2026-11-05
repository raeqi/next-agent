/**
 * HELM 装配层：顶栏、三栏布局、引擎订阅、键盘、Toast、挂载/卸载。
 * 两个运行形态共用：独立静态页（Helm.mount）与 Harness 客户端插件（mountHelm）。
 */
const HELM_LEVELS = [
  { id: 'observe', label: '观察', desc: '只看不写：agent 给出计划和预览，所有动作等你点' },
  { id: 'propose', label: '提议', desc: '提议：agent 自己读和想，动手前一律问你' },
  { id: 'drive', label: '代驾', desc: '代驾：常规动作自己做，对外发送/付费/删除前问你' },
  { id: 'auto', label: '自动', desc: '自动：按预算自己跑完，只在失败或越界时叫你' },
];

function mountHelm(root, opts) {
  const options = opts || {};
  const engine = createEngine({});

  /* 共享 UI 动作：视图之间只通过它跳转，不互相持有 DOM。 */
  const ctx = {
    engine,
    H,
    actions: engine.actions,
    levelLabels: HELM_LEVELS,
    ui: {},
    rerender: () => render(true),
  };

  const fleetView = createFleetView(ctx);
  const missionView = createMissionView(ctx);
  const panelsView = createPanelsView(ctx);

  ctx.ui.rerender = () => render(true);
  ctx.ui.focusPanels = (tab) => { panelsView.setTab(tab); render(true); };
  ctx.ui.focusApproval = (id) => { panelsView.setTab('inbox'); panelsView.focusApproval(id); render(true); };
  ctx.ui.focusEvidence = (id) => {
    panelsView.setTab('evidence');
    if (panelsView.focusEvidence) panelsView.focusEvidence(id);
    render(true);
  };
  ctx.ui.close = () => {
    if (typeof options.onClose === 'function') options.onClose();
  };

  /* ---------- 样式 ---------- */
  const style = document.createElement('style');
  style.dataset.helm = 'styles';
  const baseCss = typeof HELM_CSS_TEXT !== 'undefined' ? HELM_CSS_TEXT : '';
  style.textContent = baseCss + '\n' + HELM_STYLES.join('\n');
  document.head.appendChild(style);

  /* ---------- 骨架 ---------- */
  const shell = H.el('div.helm-root', { 'data-testid': 'helm-root', role: 'dialog', 'aria-label': 'HELM 任务驾驶舱' });
  const topbar = H.el('header.helm-topbar');
  const main = H.el('div.helm-main');
  const rail = H.el('div.helm-col.helm-col--rail');
  const center = H.el('div.helm-col.helm-col--main');
  const side = H.el('div.helm-col.helm-col--panels');
  main.append(rail, center, side);
  const toastLayer = H.el('div.helm-toasts');
  shell.append(topbar, main, toastLayer);
  root.replaceChildren(shell);

  function levelSeg(state, onChange) {
    return H.el('div.h-seg', { title: '自主档位：agent 自己做多少事', 'data-testid': 'autonomy' },
      HELM_LEVELS.map((lv) => H.el('button.h-seg__btn', {
        type: 'button',
        'data-on': state.autonomy === lv.id ? 'true' : 'false',
        'data-level': lv.id,
        'data-testid': 'autonomy-' + lv.id,
        title: lv.desc,
        onClick: () => onChange(lv.id),
      }, lv.label)),
    );
  }

  function renderTopbar(state) {
    const running = state.fleet.filter((m) => m.status === 'running').length;
    const waiting = state.fleet.filter((m) => m.status === 'waiting').length;
    const standing = state.fleet.filter((m) => m.group === 'standing').length;
    const budgetPct = Math.round(H.clamp(state.budget.usedUsd / state.budget.capUsd, 0, 1) * 100);

    const left = H.el('div.helm-topline', null,
      H.el('span', null, state.day),
      H.el('span.helm-topline__sep'),
      H.el('span.h-mono', null, state.clock),
      H.el('span.helm-topline__sep'),
      H.el('span', null, H.el('b', null, String(running)), ' 个在跑'),
      H.el('span', null, H.el('b', null, String(waiting)), ' 个等你'),
      standing ? H.el('span', null, H.el('b', null, String(standing)), ' 个常驻') : null,
    );

    const right = H.el('div.helm-topright', null,
      H.el('span.h-chip.h-chip--dim', { title: '界面里出现的公司动态都是为演示编写的模拟内容' }, H.icon('info', 10), '演示数据'),
      levelSeg(state, (id) => engine.actions.setAutonomy(id)),
      H.el('div.helm-budget', { title: '今日 token 与花费' },
        H.icon('coin', 12),
        H.el('span', null, H.el('b', null, H.fmtUsd(state.budget.usedUsd)), ` / ${H.fmtUsd(state.budget.capUsd)}`),
        H.el('span.helm-budget__bar', null, H.el('i', { style: { width: budgetPct + '%' } })),
        H.el('span', null, H.fmtTokens(state.budget.usedTokens)),
      ),
      options.onClose
        ? H.el('button.helm-close', { 'data-testid': 'helm-close', title: '关闭驾驶舱（Esc）', onClick: () => ctx.ui.close() }, H.icon('x', 14))
        : null,
    );

    topbar.replaceChildren(
      H.el('div.helm-brand', null,
        H.el('span.helm-brand__mark', null, H.icon('helm', 16)),
        H.el('span.helm-brand__name', null, 'HELM'),
        H.el('span.helm-brand__sub', null, '任务驾驶舱 · Mission Cockpit'),
      ),
      left,
      right,
    );
  }

  function renderToast(state) {
    toastLayer.replaceChildren();
    if (!state.flash) return;
    const node = H.el('div.helm-toast', { class: 'helm-toast helm-toast--' + (state.flash.kind || 'ok') },
      H.icon(state.flash.kind === 'warn' ? 'warn' : 'check', 12),
      H.el('span', null, state.flash.text));
    toastLayer.appendChild(node);
    setTimeout(() => { if (engine.getState().flash === state.flash) engine.actions.consumeFlash(); }, 2400);
  }

  /* ---------- 渲染 ---------- */
  let lastRev = -1;

  function activeInputFocused() {
    const el2 = document.activeElement;
    return !!el2 && shell.contains(el2) && /^(INPUT|TEXTAREA)$/.test(el2.tagName);
  }

  function render(force) {
    const state = engine.getState();
    if (!force && state.rev === lastRev) return;
    if (!force && activeInputFocused()) return; // 打字时不重绘，避免光标丢失
    lastRev = state.rev;

    // 记住焦点，重绘后按 data-testid 还原（键盘可达性）
    const active = document.activeElement;
    const focusId = active && active.closest && active.closest('[data-testid]') ? active.closest('[data-testid]').dataset.testid : null;

    renderTopbar(state);
    rail.replaceChildren(fleetView.render(state));
    center.replaceChildren(missionView.render(state));
    side.replaceChildren(panelsView.render(state));
    renderToast(state);

    if (focusId) {
      const next = shell.querySelector(`[data-testid="${focusId}"]`);
      if (next && next !== active) {
        next.focus({ preventScroll: true });
        if (typeof next.selectionStart === 'number' && /^(INPUT|TEXTAREA)$/.test(next.tagName)) {
          const end = next.value.length;
          try { next.setSelectionRange(end, end); } catch { /* 忽略 */ }
        }
      }
    }
  }

  /* ---------- 键盘 ---------- */
  function onKeyDown(event) {
    if (event.key === 'Escape') {
      const state = engine.getState();
      if (state.selected && state.selected.takeover) {
        engine.actions.cancelTakeover(state.selected.id);
        event.preventDefault();
        return;
      }
      if (options.onClose) { event.preventDefault(); ctx.ui.close(); }
      return;
    }
    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const tabMap = { 1: 'inbox', 2: 'evidence', 3: 'context', 4: 'artifact' };
    if (tabMap[event.key]) { ctx.ui.focusPanels(tabMap[event.key]); event.preventDefault(); return; }
    if (event.key === 'p' || event.key === 'P') {
      const m = engine.getState().selected;
      if (!m) return;
      if (m.status === 'paused') engine.actions.resume(m.id); else engine.actions.pause(m.id);
      event.preventDefault();
    }
  }

  // 测试钩子：e2e 脚本用它控制播放速度与断言状态（不影响产品行为）
  try { globalThis.__HELM__ = { engine, views: { fleetView, missionView, panelsView } }; } catch { /* 忽略 */ }

  const unsubscribe = engine.subscribe(() => render(false));
  document.addEventListener('keydown', onKeyDown, true);

  render(true);

  return {
    dispose() {
      document.removeEventListener('keydown', onKeyDown, true);
      unsubscribe();
      engine.dispose();
      style.remove();
      root.replaceChildren();
    },
    engine,
  };
}
