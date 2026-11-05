/**
 * 中栏：任务详情。任务头（意图 / 成本 / 档位）+ 计划 + 执行流 + 接管抽屉。
 * 这里承载原型的核心主张：人类读的是「意图 → 计划 → 例外」，而不是滚聊天记录。
 */
function createMissionView(ctx) {
  const { H, actions } = ctx;

  /** 只属于 UI 的状态：被点选过滤的步骤、已播放入场动画的事件。 */
  let filterStepId = null;
  const seen = new Set();
  let lastFeedCount = 0;

  const ACTOR_ICON = { agent: 'bot', subagent: 'split', human: 'user', system: 'shield' };
  const ACTOR_LABEL = { agent: 'agent', subagent: 'subagent', human: '你', system: '系统' };

  const STATUS_LABEL = {
    draft: '草稿',
    queued: '排队',
    running: '执行中',
    waiting: '等你决定',
    paused: '已暂停',
    done: '已完成',
    idle: '常驻',
  };
  const STATUS_TONE = {
    running: 'signal',
    waiting: 'warn',
    paused: 'dim',
    done: 'ok',
    idle: 'info',
  };

  function statusChip(status) {
    const tone = STATUS_TONE[status] || 'dim';
    return H.el('span.h-chip', { class: `h-chip h-chip--${tone}` }, H.icon(status === 'done' ? 'check' : status === 'waiting' ? 'clock' : 'dot', 10), STATUS_LABEL[status] || status);
  }

  function missionHead(mission, state) {
    const done = mission.plan.filter((s) => s.status === 'done').length;
    const total = mission.plan.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const canRun = mission.status === 'running' || mission.status === 'waiting' || mission.status === 'paused';

    return H.el('div.mission-head', null,
      H.el('div.mission-head__top', null,
        H.el('span.mission-head__glyph', null, H.icon(mission.glyph || 'target', 15)),
        H.el('div.mission-head__titlebox', null,
          H.el('div.mission-head__title', { 'data-testid': 'mission-title' }, mission.title),
          H.el('div.mission-head__sub', null,
            statusChip(mission.status),
            H.el('span.h-chip.h-chip--dim.h-chip--mono', null, `进度 ${done}/${total}`),
            H.el('span.h-chip.h-chip--dim.h-chip--mono', null, `耗时 ${H.fmtElapsed(mission.elapsedSec)}`),
            H.el('span.h-chip.h-chip--dim.h-chip--mono', null, `${H.fmtUsd(mission.costUsd)} / ${H.fmtUsd(mission.budgetUsd)}`),
            H.el('span.h-chip.h-chip--dim.h-chip--mono', null, `${H.fmtTokens(mission.tokenCount)} tok`),
            mission.hold
              ? H.el('span.h-chip.h-chip--dim.mission-hold', { title: mission.hold.note },
                  H.icon('shield', 9), `托管把握 ${mission.hold.pct}%`)
              : null,
          ),
        ),
        H.el('div.mission-head__actions', null,
          canRun
            ? H.el('button.h-btn.h-btn--sm', {
                'data-testid': 'mission-pause',
                onClick: () => (mission.status === 'paused' ? actions.resume(mission.id) : actions.pause(mission.id)),
              }, H.icon(mission.status === 'paused' ? 'play' : 'pause', 12), mission.status === 'paused' ? '继续' : '暂停')
            : null,
          canRun
            ? H.el('button.h-btn.h-btn--sm', {
                'data-testid': 'mission-takeover',
                onClick: () => actions.takeOver(mission.id, activeStepId(mission)),
              }, H.icon('hand', 12), '接管')
            : null,
          H.el('button.h-btn.h-btn--sm.h-btn--ghost', {
            'data-testid': 'mission-replay',
            title: '回到这个任务的初始剧本，再跑一遍',
            onClick: () => actions.replay(mission.id),
          }, H.icon('replay', 12), '重跑'),
        ),
      ),

      // 意图原文：界面上最大的字。产品立场——人给的是意图，不是指令序列。
      H.el('div.mission-intent', null,
        H.el('div.mission-intent__label', null, H.icon('compass', 11), '意图'),
        H.el('div.mission-intent__text', { 'data-testid': 'mission-intent' }, mission.intent),
      ),

      H.el('div.mission-head__policy', null,
        H.icon('shield', 11),
        H.el('span', null, mission.policyNote || ''),
        H.el('span.mission-head__policy-level', null,
          `档位 · ${({ observe: '观察', propose: '提议', drive: '代驾', auto: '自动' })[mission.autonomy] || '代驾'}`),
        H.el('div.h-bar.mission-head__budgetbar', null, H.el('i', { style: { width: pct + '%' } })),
      ),
    );
  }

  function activeStepId(mission) {
    const active = mission.plan.find((s) => s.status === 'active') || mission.plan.find((s) => s.status === 'blocked');
    return active ? active.id : mission.plan[0] && mission.plan[0].id;
  }

  /* ---------------- 计划 ---------------- */
  function planColumn(mission) {
    const steps = mission.plan.map((step, i) => {
      const isActive = step.status === 'active';
      const isBlocked = step.status === 'blocked';
      const dim = filterStepId && filterStepId !== step.id;
      return H.el('div.mission-step', {
        class: `mission-step mission-step--${step.status}${dim ? ' mission-step--dim' : ''}`,
        'data-testid': 'mission-step-' + step.id,
        'data-step': step.id,
        title: step.status === 'blocked' ? '这一步卡在你这里，点开右侧「待你处理」' : '只看这一步的执行流',
        onClick: () => { filterStepId = filterStepId === step.id ? null : step.id; ctx.rerender(); },
      },
        H.el('div.mission-step__rail', null,
          H.el('span.mission-step__icon', { class: 'mission-step__icon mission-step__icon--' + step.status },
            step.status === 'done' ? H.icon('check', 11)
              : step.status === 'active' ? H.el('span.mission-step__pulse')
                : step.status === 'blocked' ? H.icon('clock', 11)
                  : step.status === 'skipped' ? H.icon('x', 10)
                    : H.el('span.mission-step__index', null, String(i + 1))),
        ),
        H.el('div.mission-step__body', null,
          H.el('div.mission-step__titleline', null,
            H.el('span.mission-step__title', null, step.title),
            step.meta ? H.el('span.mission-step__meta', null, step.meta) : null,
            isBlocked ? H.el('span.mission-step__blocked', null, '等你') : null,
          ),
          H.el('div.mission-step__hint', null, step.hint),
          isActive ? H.el('div.mission-step__progress', null, H.el('i')) : null,
        ),
      );
    });

    const doneCount = mission.plan.filter((s) => s.status === 'done').length;
    return H.el('div.mission-plan', { 'data-testid': 'mission-plan' },
      H.el('div.h-sec.mission-plan__head', null,
        H.el('span.h-sec__label', null, '计划'),
        H.el('span.h-sec__aside', null,
          filterStepId ? H.el('button.h-btn.h-btn--sm.h-btn--ghost', { onClick: () => { filterStepId = null; ctx.rerender(); } }, '显示全部') : null,
          H.el('span.h-chip.h-chip--dim.h-chip--mono', null, `${doneCount}/${mission.plan.length}`),
        ),
      ),
      H.el('div.mission-plan__list.h-scroll', null, steps),
      H.el('div.mission-plan__foot', null,
        H.icon('info', 11),
        H.el('span', null, '计划由 agent 自拟，你可以点任意一步只读它的执行流；「接管」会暂停并让你改写方向。'),
      ),
    );
  }

  /* ---------------- 执行流 ---------------- */
  function feedEvent(mission, event) {
    const entering = !seen.has(event.id);
    if (entering) seen.add(event.id);
    const tone = event.tone ? ` mission-feed__item--${event.tone}` : '';
    const isNew = entering && seen.size > 1;

    const chips = [];
    if (event.tool) chips.push(H.el('span.h-chip.h-chip--dim.h-chip--mono', null, event.tool));
    if (event.ms) chips.push(H.el('span.h-chip.h-chip--dim.h-chip--mono', null, `${event.ms}ms`));
    if (event.tokens) chips.push(H.el('span.h-chip.h-chip--dim.h-chip--mono', null, `${H.fmtTokens(event.tokens)} tok`));
    for (const id of event.evidenceIds || []) {
      const ev = mission.evidence.find((e) => e.id === id);
      if (!ev) continue;
      const tone2 = ev.status === 'conflict' ? 'warn' : ev.status === 'weak' ? 'warn' : 'info';
      chips.push(H.el('button.h-chip.h-chip--' + tone2 + '.mission-feed__ev', {
        title: ev.claim,
        onClick: (e) => { e.stopPropagation(); ctx.ui.focusEvidence(id); },
      }, H.icon('link', 9), ev.source.org));
    }

    return H.el('div.mission-feed__item', {
      class: 'mission-feed__item' + tone + (isNew ? ' h-enter' : ''),
      'data-kind': event.kind,
      'data-id': event.id,
      onClick: () => { if (event.actor === 'human') ctx.ui.focusPanels('inbox'); },
    },
      H.el('div.mission-feed__time.h-mono', null, event.at || ''),
      H.el('div.mission-feed__glyph', { class: 'mission-feed__glyph mission-feed__glyph--' + event.actor },
        H.icon(ACTOR_ICON[event.actor] || 'dot', 12)),
      H.el('div.mission-feed__body', null,
        H.el('div.mission-feed__titleline', null,
          H.el('span.mission-feed__title', null, event.title),
          H.el('span.mission-feed__actor', null, ACTOR_LABEL[event.actor] || event.actor),
        ),
        event.detail ? H.el('div.mission-feed__detail', null, event.detail) : null,
        chips.length ? H.el('div.mission-feed__chips', null, chips) : null,
      ),
    );
  }

  function feedColumn(mission, state) {
    const events = filterStepId ? mission.feed.filter((e) => e.stepId === filterStepId) : mission.feed;
    const live = mission.status === 'running';

    const items = events.map((e) => feedEvent(mission, e));
    const body = H.el('div.mission-feed__list', { 'data-testid': 'mission-feed' }, items.length ? items : H.el('div.h-empty', null, H.icon('radar', 22), '这一步还没有动作。'));

    const openApproval = mission.approvals.find((a) => a.status === 'open');
    const waitingBar = openApproval
      ? H.el('div.mission-wait', null,
          H.el('span.mission-wait__dots', null, H.el('span'), H.el('span'), H.el('span')),
          H.el('div.mission-wait__text', null,
            H.el('b', null, '正在等你：'),
            openApproval.title,
          ),
          H.el('button.h-btn.h-btn--primary.h-btn--sm', {
            'data-testid': 'mission-goto-approval',
            onClick: () => ctx.ui.focusApproval(openApproval.id),
          }, '去处理', H.icon('arrow', 11)),
        )
      : null;

    const deliveredBar = mission.artifact && mission.artifact.deliveredTo
      ? H.el('div.mission-done', null,
          H.icon('check', 12),
          H.el('span', null, `交付完成 · ${mission.artifact.deliveredTo}`),
          H.el('button.h-btn.h-btn--sm.h-btn--ghost', { onClick: () => ctx.ui.focusPanels('artifact') }, '看交付物', H.icon('arrow', 11)),
        )
      : null;

    return H.el('div.mission-feed', null,
      H.el('div.h-sec', null,
        H.el('span.h-sec__label', null, '执行流'),
        H.el('span.h-sec__aside', null,
          H.el('button.h-btn.h-btn--sm.h-btn--ghost', {
            title: '切换播放速度（演示用）',
            onClick: () => actions.setSpeed(state.speed === 4 ? 1 : 4),
          }, H.icon('clock', 11), `${state.speed === 4 ? '4x' : '1x'}`),
          live ? H.el('span.h-chip.h-chip--signal', null, H.el('span.h-dot.h-dot--live'), '实时') : null,
          filterStepId ? H.el('span.h-chip.h-chip--info', null, '已按步骤过滤') : null,
        ),
      ),
      waitingBar,
      deliveredBar,
      body,
    );
  }

  /* ---------------- 接管抽屉 ---------------- */
  function takeoverDrawer(mission) {
    const t = mission.takeover;
    if (!t) return null;
    if (takeoverDraft === null || takeoverStep !== t.stepId) {
      takeoverDraft = '';
      takeoverStep = t.stepId;
    }
    const step = mission.plan.find((s) => s.id === t.stepId);
    const input = H.el('textarea.mission-takeover__input', {
      rows: '3',
      'data-testid': 'takeover-input',
      placeholder: '用一句话改写方向。例如：「定价先不要下结论，把三家官方页面的价格表抓全，附原始截图。」',
      onInput: (e) => { takeoverDraft = e.target.value; },
    });
    input.value = takeoverDraft;
    return H.el('div.mission-takeover', { 'data-testid': 'mission-takeover' },
      H.el('div.mission-takeover__head', null,
        H.icon('hand', 13),
        H.el('span.mission-takeover__title', null, '你正在接管'),
        H.el('span.h-chip.h-chip--dim', null, step ? '第 ' + (step.index + 1) + ' 步 · ' + step.title : ''),
        H.el('span.mission-takeover__note', null, '接管期间 agent 暂停；交还后它会按你的方向继续跑。'),
      ),
      input,
      H.el('div.mission-takeover__actions', null,
        H.el('button.h-btn.h-btn--sm.h-btn--ghost', { onClick: () => actions.cancelTakeover(mission.id) }, '取消'),
        H.el('button.h-btn.h-btn--primary.h-btn--sm', {
          'data-testid': 'takeover-submit',
          onClick: () => {
            const value = takeoverDraft.trim();
            if (!value) return;
            takeoverDraft = null;
            takeoverStep = null;
            actions.resumeFromTakeover(mission.id, value);
          },
        }, '交还并继续', H.icon('arrow', 11)),
      ),
    );
  }

  let takeoverDraft = null;
  let takeoverStep = null;

  /* ---------------- 组装 ---------------- */
  function build(state) {
    const mission = state.selected;
    return H.el('div.mission-view.h-scroll', { 'data-testid': 'mission-view' },
      missionHead(mission, state),
      H.el('div.mission-body', null,
        planColumn(mission),
        feedColumn(mission, state),
      ),
      takeoverDrawer(mission),
    );
  }

  let lastScrolledCount = 0;

  // feed 追加时自动滚到底部，模拟"正在发生"的现场感
  function scrollFeedToBottom(count) {
    requestAnimationFrame(() => {
      const list = document.querySelector('[data-testid="mission-feed"]');
      if (list && count !== lastScrolledCount) {
        lastScrolledCount = count;
        list.scrollTop = list.scrollHeight;
      }
    });
  }

  return {
    render(state) {
      const next = build(state);
      scrollFeedToBottom(state.selected.feed.length);
      return next;
    },
    resetFilter() { filterStepId = null; },
  };
}

/* ---------------- 中栏样式 ---------------- */
HELM_STYLES.push(`
.mission-view{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.mission-head{flex:none;padding:16px 20px 12px;border-bottom:1px solid var(--h-line)}
.mission-head__top{display:flex;align-items:flex-start;gap:10px}
.mission-head__glyph{display:grid;place-items:center;width:26px;height:26px;flex:none;border-radius:7px;border:1px solid var(--h-line-2);background:var(--h-panel-2);color:var(--h-signal)}
.mission-head__titlebox{min-width:0;flex:1}
.mission-head__title{font-size:14.5px;font-weight:600;letter-spacing:-.01em;line-height:1.3}
.mission-head__sub{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
.mission-head__actions{display:flex;gap:5px;flex:none;align-items:center}
.mission-intent{position:relative;margin-top:13px;padding:11px 14px 12px 15px;border:1px solid var(--h-line);border-left:2px solid var(--h-signal);border-radius:0 8px 8px 0;background:linear-gradient(90deg,var(--h-signal-dim),transparent 70%),var(--h-panel)}
.mission-intent__label{display:flex;align-items:center;gap:5px;font-size:9.5px;letter-spacing:.16em;color:var(--h-signal);font-weight:600;margin-bottom:5px}
.mission-intent__text{font-size:13.5px;line-height:1.72;font-weight:500;color:var(--h-text);letter-spacing:.005em}
.mission-head__policy{display:flex;align-items:center;gap:6px;margin-top:10px;font-size:10.5px;color:var(--h-text-3);line-height:1.5}
.mission-head__policy svg{color:var(--h-text-4);flex:none}
.mission-head__policy-level{margin-left:auto;flex:none;color:var(--h-signal);font-family:var(--h-mono);font-size:10px;letter-spacing:.04em}
.mission-head__budgetbar{width:96px;flex:none;height:3px}
.mission-body{flex:1;min-height:0;display:grid;grid-template-columns:318px minmax(0,1fr)}
.mission-plan{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--h-line);background:var(--h-bg-2)}
.mission-plan__head{border-bottom:1px solid var(--h-line);background:transparent}
.mission-plan__list{flex:1;overflow-y:auto;padding:8px 0 10px}
.mission-plan__foot{flex:none;display:flex;gap:6px;align-items:flex-start;padding:9px 13px;border-top:1px solid var(--h-line);font-size:10px;line-height:1.55;color:var(--h-text-4)}
.mission-plan__foot svg{flex:none;margin-top:1px}
.mission-step{display:flex;gap:9px;padding:6px 12px 6px 13px;border-radius:8px;margin:1px 6px;cursor:pointer;position:relative;transition:background .15s}
.mission-step:hover{background:var(--h-panel)}
.mission-step--dim{opacity:.32}
.mission-step--active{background:var(--h-panel);box-shadow:inset 2px 0 0 var(--h-signal)}
.mission-step--blocked{background:var(--h-warn-dim)}
.mission-step__rail{display:flex;flex-direction:column;align-items:center;flex:none;width:18px;padding-top:2px}
.mission-step:not(:last-child) .mission-step__rail::after{content:"";flex:1;width:1px;margin-top:4px;background:var(--h-line-2)}
.mission-step__icon{display:grid;place-items:center;width:18px;height:18px;flex:none;border-radius:50%;border:1px solid var(--h-line-2);color:var(--h-text-4);font-family:var(--h-mono);font-size:9.5px;background:var(--h-bg-2)}
.mission-step__icon--done{border-color:rgba(74,192,138,.35);background:var(--h-ok-dim);color:var(--h-ok)}
.mission-step__icon--active{border-color:var(--h-signal-line);background:var(--h-signal-dim);color:var(--h-signal)}
.mission-step__icon--blocked{border-color:rgba(233,185,73,.4);background:var(--h-warn-dim);color:var(--h-warn)}
.mission-step__pulse{width:6px;height:6px;border-radius:50%;background:var(--h-signal);animation:h-pulse 1.6s infinite}
.mission-step__index{color:var(--h-text-4)}
.mission-step__body{min-width:0;flex:1}
.mission-step__titleline{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.mission-step__title{font-size:11.5px;font-weight:550;line-height:1.45;color:var(--h-text)}
.mission-step--active .mission-step__title{color:var(--h-text)}
.mission-step--pending .mission-step__title{color:var(--h-text-2)}
.mission-step__meta{font-family:var(--h-mono);font-size:9.5px;color:var(--h-text-4);letter-spacing:.02em}
.mission-step__blocked{font-size:9.5px;color:var(--h-warn);border:1px solid rgba(233,185,73,.35);border-radius:4px;padding:0 4px;line-height:1.5}
.mission-step__hint{font-size:10px;line-height:1.5;color:var(--h-text-4);margin-top:1px}
.mission-step--active .mission-step__hint,.mission-step--blocked .mission-step__hint{color:var(--h-text-3)}
.mission-step__progress{height:2px;border-radius:2px;margin-top:6px;background:var(--h-line-2);overflow:hidden}
.mission-step__progress i{display:block;height:100%;width:38%;border-radius:2px;background:var(--h-signal);animation:mission-scan 1.8s var(--h-ease) infinite}
@keyframes mission-scan{0%{margin-left:-38%}100%{margin-left:100%}}
.mission-feed{display:flex;flex-direction:column;min-height:0;background:var(--h-bg)}
.mission-feed__list{flex:1;overflow-y:auto;padding:6px 14px 18px}
.mission-feed__item{display:grid;grid-template-columns:58px 22px minmax(0,1fr);gap:8px;padding:6px 6px 6px 2px;border-radius:7px;position:relative;transition:background .15s}
.mission-feed__item:hover{background:var(--h-panel)}
.mission-feed__time{font-family:var(--h-mono);font-size:9.5px;color:var(--h-text-4);padding-top:3px;letter-spacing:-.02em}
.mission-feed__glyph{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;flex:none;margin-top:1px;background:var(--h-panel-2);color:var(--h-text-3)}
.mission-feed__glyph--agent{color:var(--h-signal);background:var(--h-signal-dim)}
.mission-feed__glyph--subagent{color:var(--h-info);background:var(--h-info-dim)}
.mission-feed__glyph--human{color:var(--h-ok);background:var(--h-ok-dim)}
.mission-feed__glyph--system{color:var(--h-text-3)}
.mission-feed__titleline{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap}
.mission-feed__title{font-size:11.5px;font-weight:500;line-height:1.5;color:var(--h-text)}
.mission-feed__actor{font-size:8.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--h-text-4);flex:none}
.mission-feed__detail{font-size:10.5px;line-height:1.6;color:var(--h-text-3);margin-top:2px}
.mission-feed__chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
.mission-feed__item--warn .mission-feed__title{color:var(--h-warn)}
.mission-feed__item--err .mission-feed__title{color:var(--h-err)}
.mission-feed__item--ok .mission-feed__title{color:var(--h-text)}
.mission-feed__item--human .mission-feed__title{color:var(--h-ok)}
.mission-feed__ev{cursor:pointer;border:1px solid var(--h-line-2);background:transparent;font:inherit;height:19px}
.mission-feed__ev:hover{background:var(--h-info-dim);color:var(--h-info)}
.mission-wait{display:flex;align-items:center;gap:9px;margin:8px 14px 2px;padding:8px 11px;border:1px solid var(--h-signal-line);border-radius:8px;background:var(--h-signal-dim);flex:none}
.mission-wait__dots{display:inline-flex;gap:2px;flex:none}
.mission-wait__dots span{width:4px;height:4px;border-radius:50%;background:var(--h-signal);animation:mission-dot 1.2s infinite}
.mission-wait__dots span:nth-child(2){animation-delay:.15s}
.mission-wait__dots span:nth-child(3){animation-delay:.3s}
@keyframes mission-dot{0%,100%{opacity:.25}50%{opacity:1}}
.mission-wait__text{flex:1;min-width:0;font-size:10.5px;line-height:1.45;color:var(--h-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mission-wait__text b{color:var(--h-text);font-weight:600}
.mission-done{display:flex;align-items:center;gap:8px;margin:8px 14px 2px;padding:7px 11px;border:1px solid rgba(74,192,138,.3);border-radius:8px;background:var(--h-ok-dim);font-size:10.5px;color:var(--h-ok);flex:none}
.mission-done span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mission-takeover{flex:none;border-top:1px solid var(--h-signal-line);background:var(--h-panel-2);padding:11px 16px 13px}
.mission-takeover__head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.mission-takeover__head svg{color:var(--h-signal)}
.mission-takeover__title{font-size:12px;font-weight:600;color:var(--h-signal)}
.mission-takeover__note{font-size:10px;color:var(--h-text-3);margin-left:auto}
.mission-takeover__input{box-sizing:border-box;width:100%;margin-top:8px;padding:8px 10px;border:1px solid var(--h-line-2);border-radius:8px;background:var(--h-bg);color:var(--h-text);font:inherit;font-size:11.5px;line-height:1.6;resize:vertical;min-height:58px;outline:none}
.mission-takeover__input:focus{border-color:var(--h-signal);box-shadow:0 0 0 2px var(--h-signal-dim)}
.mission-takeover__actions{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}
@media (max-width:1400px){.mission-body{grid-template-columns:280px minmax(0,1fr)}}
`);
