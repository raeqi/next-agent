/**
 * HELM · 右栏面板（388px）：把 harness 的运行层摊开给人看。
 *
 * 四个 tab 是一次「信任校准」的四个问题：
 *   待你处理 —— 哪些事它不敢自己决定？
 *   证据     —— 它说的每句话从哪来、可不可信？
 *   上下文   —— 它此刻「记得」什么、花了多少窗口、丢掉了什么？
 *   交付物   —— 交出来的东西长什么样、自检过没有、发给了谁、能不能重看？
 *
 * 只读 state；内部只保存纯 UI 状态（当前 tab、一次性的定位高亮）。
 * 渲染策略：render 全量重建根节点；tab 切换 / 定位高亮走「原地重绘 body」，
 * 避免整栏闪一下，也保证 tab 状态在闭包里跨 render 保持。
 *
 * 排版取舍（为什么这么排）：
 * - 审批卡把「为什么需要你」放在标题正下方、按钮之前。用户点任何审批前真正想知道的是
 *   「你为什么来烦我」，先给理由再给选项，能减少无脑点「允许」；理由段落用内嵌块
 *   轻微提亮，是卡片里唯一的正文级信息，其余信息都压成 10px 的注脚。
 * - 「影响面」压成一行，因为它回答的是「点了会怎样」——必须一眼扫完，不能折叠。
 * - 选项用按钮行／竖排全宽两种形态：带备注时竖排，因为这时读「$40 / 09:07 抓取」
 *   比读按钮文字更重要；一两个短选项时并排，保持密度。
 * - 已处理审批收成一行灰态：历史不该继续占决策空间，但仍要可查（谁、什么结果、几点）。
 * - 证据卡片的可信度 chip 与冲突描边是两件事：前者是来源质量，后者是来源之间打架。
 *   冲突永远排在视觉第一层（用琥珀而非红色，因为这是「待裁定」不是「错误」）。
 * - 上下文用 flex 堆叠条而不是环形图：388px 宽的窄栏里，环形图读不出 5 段占比，
 *   水平条还能顺带画出「离上限还有多少」。
 * - 交付物把绿色回执放最顶：先确认结果去了哪，再读正文；自检清单放正文后，作为签收依据。
 *
 * 交互约定（由 main.js 注入的 ctx.ui 调用）：
 *   { render(state), setTab(tab), focusApproval(id), focusEvidence(id) }
 * focus 类方法会切到对应 tab、把卡片滚进视口，并加一次性的琥珀描边（约 1.3s）。
 */

/* ---------- 面板常量 ---------- */

/** tab 顺序固定：与中间栏「需要人」的优先级一致，inbox 永远第一个。 */
const PANELS_TABS = [
  { key: 'inbox', label: '待你处理' },
  { key: 'evidence', label: '证据' },
  { key: 'context', label: '上下文' },
  { key: 'artifact', label: '交付物' },
];

/** 档位名与 main.js 顶栏分段控件保持一致；ctx.levelLabels 存在时优先用它。 */
const PANELS_LEVEL_LABEL = { observe: '观察', propose: '提议', drive: '代驾', auto: '自动' };
const PANELS_LEVEL_RANK = { observe: 0, propose: 1, drive: 2, auto: 3 };

/** 风险三档：低=灰、中=琥珀、高=红。颜色只出现在徽标与小圆点上。 */
const PANELS_RISK_META = {
  low: { key: 'low', label: '低风险', dot: '' },
  med: { key: 'med', label: '中风险', dot: 'h-dot--signal' },
  high: { key: 'high', label: '高风险', dot: 'h-dot--err' },
};
const PANELS_RISK_RANK = { low: 1, med: 2, high: 3 };

const PANELS_KIND_LABEL = { send: '对外发送', choice: '方案选择', budget: '预算', permission: '权限' };

/** slices.tone → 堆叠条/图例色块 class。 */
const PANELS_TONE_CLASS = {
  signal: 'panel-tone--signal',
  ok: 'panel-tone--ok',
  info: 'panel-tone--info',
  warn: 'panel-tone--warn',
};

/* ---------- 纯格式化 helper（不碰 DOM 状态，便于单测与复用） ---------- */

function panelsRiskMeta(risk) {
  return PANELS_RISK_META[risk] || PANELS_RISK_META.med;
}

function panelsKindLabel(kind) {
  return PANELS_KIND_LABEL[kind] || '需要确认';
}

/**
 * 主选项：剧本里若显式标了 primary / recommended / tone:'primary' 就用它，
 * 否则取第一个非危险选项。剧本目前没写标记，按「推荐项排最前」的惯例兜底。
 */
function panelsPrimaryIndex(options) {
  if (!Array.isArray(options) || !options.length) return -1;
  const marked = options.findIndex((o) => o && (o.primary === true || o.recommended === true || o.tone === 'primary'));
  if (marked >= 0) return marked;
  return options.findIndex((o) => o && !o.danger);
}

/**
 * 「影响面」一行。数据模型里没有独立的 impact 字段，这里按 kind 推导；
 * 宁可给保守通用的描述，也不编造具体数字。
 * 收件人尽量从审批自带字段 / 选项文案的括号里取（如「发（飞书 · 老板）」→ 飞书 · 老板）。
 */
function panelsImpactItems(approval, mission) {
  const a = approval || {};
  if (Array.isArray(a.impact) && a.impact.length) return a.impact.slice(0, 4).map(String);
  if (typeof a.impact === 'string' && a.impact.trim()) return [a.impact.trim()];

  if (a.kind === 'send') {
    const options = Array.isArray(a.options) ? a.options : [];
    const paren = options.map((o) => String((o && o.label) || '').match(/[（(]([^）)]+)[）)]/)).find(Boolean);
    const to = a.to || a.recipient || a.audience || a.target || (paren ? paren[1] : '');
    return [to ? '收件人 ' + to : '外部收件人', '对外发送', '不可撤销'];
  }
  if (a.kind === 'budget') {
    const cap = mission && Number(mission.budgetUsd) > 0 ? H.fmtUsd(mission.budgetUsd) : '';
    return ['本项目预算', cap ? '上限 ' + cap : '会消耗预算', '超出需再批'];
  }
  if (a.kind === 'permission') {
    return ['工具权限', '只作用于本任务', '可随时收回'];
  }
  return ['只影响本步骤输出', '可回放重来', '不会对外发送'];
}

/**
 * 卡右上角的档位提示。autoResolve 表示「档位足够高时这类审批会自动放行」，
 * 所以当前档位没到线时告诉用户「升到哪一档就不用再问你」，这是自主档位的可见代价。
 */
function panelsAutoResolveNote(approval, autonomy, levelName) {
  const ar = approval && approval.autoResolve;
  if (!ar) return '';
  if (typeof ar === 'string') return '按当前档位会自动放行';
  const target = ar.level || 'auto';
  const targetLabel = levelName(target);
  const current = PANELS_LEVEL_RANK[autonomy];
  const need = PANELS_LEVEL_RANK[target] === undefined ? 9 : PANELS_LEVEL_RANK[target];
  if (current !== undefined && current >= need) {
    const sec = ar.delayMs ? Math.max(1, Math.round(ar.delayMs / 100) / 10) : 0;
    return sec ? '约 ' + sec + ' 秒后按档位自动放行' : '按当前档位会自动放行';
  }
  return '升到「' + targetLabel + '」档后自动放行';
}

/**
 * 上下文预算专用的 token 格式：H.fmtTokens 对 62400 会取整成「62k」，
 * 但预算行需要一位小数才能看出「还差多少」（62.4k / 128k）。
 * 只在上下文账本里用，其余数字仍走 H.fmt*。
 */
function panelsFmtTokens(n) {
  const value = Number(n) || 0;
  if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
  if (value >= 1000) {
    const k = Math.round((value / 1000) * 10) / 10;
    return (k % 1 === 0 ? String(k) : k.toFixed(1)) + 'k';
  }
  return String(Math.round(value));
}

/** 从 resolvedLabel 里拆时间，如「允许一次 · 09:04」→ 09:04。 */
function panelsExtractTime(text) {
  const m = String(text || '').match(/(\d{1,2}:\d{2})/);
  return m ? m[1] : '';
}

/** 下载文件名：去掉文件系统敏感字符，空标题兜底。 */
function panelsFileName(title) {
  const clean = String(title || '交付物').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
  return clean || '交付物';
}

/** 复制：优先 Clipboard API，失败退回临时 textarea + execCommand；成功/失败都在按钮上反馈。 */
function panelsCopyText(text, btn) {
  const label = btn && btn.querySelector ? btn.querySelector('.panel-btn__label') : null;
  const feedback = (ok) => {
    if (!label || label.dataset.busy === '1') return;
    label.dataset.busy = '1';
    const prev = label.textContent;
    label.textContent = ok ? '已复制' : '复制失败';
    setTimeout(() => {
      label.textContent = prev;
      delete label.dataset.busy;
    }, 1600);
  };
  const fallback = () => {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand && document.execCommand('copy');
      area.remove();
      feedback(!!ok);
    } catch (err) {
      feedback(false);
    }
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => feedback(true)).catch(fallback);
    } else {
      fallback();
    }
  } catch (err) {
    fallback();
  }
}

/** 下载 .md：Blob + a[download]，文件名取交付物标题。 */
function panelsDownloadMarkdown(title, body) {
  try {
    const blob = new Blob([String(body || '')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = panelsFileName(title) + '.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  } catch (err) {
    // 静态页在极端环境里可能禁下载；不打断界面即可。
  }
}

/* ---------- 视图工厂 ---------- */

function createPanelsView(ctx) {
  const actions = (ctx && ctx.actions) || {};
  const levelLabels = (ctx && ctx.levelLabels) || [];

  /* 纯 UI 状态：tab 跨 render 保持；focus 只用于一次性的定位高亮。 */
  let tab = 'inbox';
  let lastState = null;
  let lastMissionId = null;
  let rootEl = null;
  let tabbarEl = null;
  let bodyEl = null;
  let focusApproveId = null;
  let focusEvidenceId = null;
  let focusTimer = null;

  function levelName(level) {
    const hit = levelLabels.find((item) => item && item.id === level);
    return hit ? hit.label : PANELS_LEVEL_LABEL[level] || level || '自定义';
  }

  /* ---------- 状态读取（全部只读，防御空数据） ---------- */

  function selectedMission() {
    return lastState && lastState.selected ? lastState.selected : null;
  }

  function openApprovals(mission) {
    const list = mission && Array.isArray(mission.approvals) ? mission.approvals : [];
    return list
      .filter((a) => a && a.status === 'open')
      .sort((a, b) => (PANELS_RISK_RANK[b.risk] || 0) - (PANELS_RISK_RANK[a.risk] || 0));
  }

  function resolvedApprovals(mission) {
    const list = mission && Array.isArray(mission.approvals) ? mission.approvals : [];
    return list.filter((a) => a && a.status !== 'open');
  }

  function evidenceList(mission) {
    return mission && Array.isArray(mission.evidence) ? mission.evidence.filter(Boolean) : [];
  }

  /** tab 有没有内容可展示：没有时 render 回退到 inbox，避免切任务后停在空白页。 */
  function tabHasData(key, mission) {
    if (!mission) return false;
    if (key === 'inbox') return true;
    if (key === 'evidence') return evidenceList(mission).length > 0;
    if (key === 'context') return !!mission.context;
    if (key === 'artifact') return !!mission.artifact;
    return false;
  }

  /* ---------- tab 徽标：每个 tab 显示它自己的「生命体征」，而不是同一种计数 ---------- */

  function tabBadge(key, mission) {
    if (!mission) return null;
    if (key === 'inbox') {
      const n = openApprovals(mission).length;
      return {
        text: String(n),
        cls: n > 0 ? 'is-signal' : 'is-muted',
        title: n > 0 ? n + ' 个审批等你决定' : '没有等你决定的事',
      };
    }
    if (key === 'evidence') {
      const list = evidenceList(mission);
      const shaky = list.filter((e) => e.status === 'conflict' || e.status === 'weak').length;
      return {
        text: String(list.length),
        cls: '',
        dot: shaky > 0,
        title: list.length + ' 条来源' + (shaky ? '，其中 ' + shaky + ' 条冲突或存疑' : ''),
      };
    }
    if (key === 'context') {
      const c = mission.context;
      if (!c || !Number(c.capTokens)) return null;
      const pct = Math.round((Number(c.windowTokens) || 0) / Number(c.capTokens) * 100);
      return {
        text: pct + '%',
        cls: pct >= 85 ? 'is-warn' : 'is-muted',
        title: '上下文已用 ' + panelsFmtTokens(Number(c.windowTokens) || 0) + ' / ' + panelsFmtTokens(Number(c.capTokens)),
      };
    }
    if (key === 'artifact') {
      const a = mission.artifact;
      if (!a) return null;
      const list = Array.isArray(a.verification) ? a.verification : [];
      if (!list.length) return null;
      const pass = list.filter((v) => v && v.status === 'pass').length;
      const bad = pass < list.length;
      return {
        text: pass + '/' + list.length,
        cls: bad ? 'is-warn' : 'is-muted',
        title: '自检 ' + pass + '/' + list.length + ' 通过',
      };
    }
    return null;
  }

  /* ---------- tab 条 ---------- */

  function buildTabbar() {
    const mission = selectedMission();
    const bar = H.el('div.panel-tabs', { role: 'tablist', 'aria-label': '运行层视图' });
    PANELS_TABS.forEach((def) => {
      const badge = tabBadge(def.key, mission);
      const active = tab === def.key;
      const btn = H.el('button.panel-tab', {
        type: 'button',
        role: 'tab',
        'data-testid': 'panels-tab-' + def.key,
        'data-tab': def.key,
        'aria-selected': active ? 'true' : 'false',
        title: badge && badge.title ? def.label + ' · ' + badge.title : def.label,
      }, H.el('span.panel-tab__label', { text: def.label }));
      if (badge) {
        if (badge.dot) btn.appendChild(H.el('span.panel-tab__dot', { 'aria-hidden': 'true' }));
        btn.appendChild(H.el('span', { class: 'panel-tab__count h-mono' + (badge.cls ? ' ' + badge.cls : ''), text: badge.text }));
      }
      btn.addEventListener('click', () => switchTab(def.key));
      bar.appendChild(btn);
    });
    return bar;
  }

  function syncTabbar() {
    if (!tabbarEl) return;
    Array.from(tabbarEl.children).forEach((btn) => {
      btn.setAttribute('aria-selected', btn.dataset.tab === tab ? 'true' : 'false');
    });
  }

  /* ---------- 通用小构件 ---------- */

  /** 空态：图标 + 一句主说明 + 一句补充，全部走共享 h-empty 排版。 */
  function panelsEmpty(iconName, title, sub) {
    return H.el('div.panel-empty', null,
      H.el('div.h-empty', null,
        H.icon(iconName, 22),
        H.el('div.panel-empty__title', { text: title }),
        sub ? H.el('div.panel-empty__sub', { text: sub }) : null,
      ),
    );
  }

  /** 小节头：复用共享 h-sec，面板内的小节也用它，保持栏与栏之间节奏一致。 */
  function panelSec(label, aside) {
    return H.el('div.h-sec', null,
      H.el('span.h-sec__label', { text: label }),
      aside ? H.el('span.h-sec__aside', null, aside) : null,
    );
  }

  /* ---------- tab 1：待你处理 ---------- */

  function policyStrip(mission) {
    const level = mission && mission.autonomy ? levelName(mission.autonomy) : '';
    const note = (mission && mission.policyNote) || (level ? '当前档位「' + level + '」：只在中高风险时打断你。' : '按你的档位自主推进。');
    const strip = H.el('div.panel-policy', { title: level ? '当前自主档位：' + level : null },
      H.el('span.panel-policy__icon', null, H.icon('shield', 13)),
      H.el('span.panel-policy__text', { text: note }),
    );
    return strip;
  }

  function approvalCard(a, mission) {
    const risk = panelsRiskMeta(a.risk);
    const focused = focusApproveId === a.id;
    const card = H.el('article', {
      class: 'panel-approve' + (focused ? ' panel-approve--focus' : ''),
      'data-testid': 'inbox-approve-' + a.id,
      'data-id': a.id,
      'data-risk': risk.key,
      tabindex: '0',
      'aria-label': '待你决定：' + (a.title || ''),
    });

    /* 第一行：风险徽标（唯一用状态色的地方）+ 类型 + 右上角的档位提示。 */
    const top = H.el('div.panel-approve__top');
    top.appendChild(H.el('span', { class: 'panel-risk panel-risk--' + risk.key },
      H.el('i', { class: 'h-dot ' + risk.dot }),
      risk.label,
    ));
    top.appendChild(H.el('span.panel-approve__kind', { text: panelsKindLabel(a.kind) }));
    const auto = panelsAutoResolveNote(a, mission && mission.autonomy, levelName);
    if (auto) top.appendChild(H.el('span.panel-approve__auto', { text: auto, title: auto }));
    card.appendChild(top);

    card.appendChild(H.el('h3.panel-approve__title', { text: a.title || '有一个动作需要你点头' }));

    /* 理由放在标题下面第一屏：先回答「为什么来烦我」，再给选项。 */
    const why = H.el('div.panel-why');
    why.appendChild(H.el('div.panel-why__label', { text: '为什么需要你' }));
    why.appendChild(H.el('p.panel-why__text', { text: a.why || '这一步会越过你设定的边界，agent 停下来等你确认。' }));
    card.appendChild(why);

    /* 影响面压成一行：回答「点了会怎样」，必须一眼扫完。 */
    const impacts = panelsImpactItems(a, mission);
    if (impacts.length) {
      const row = H.el('div.panel-impact');
      row.appendChild(H.el('span.panel-impact__label', { text: '影响面' }));
      impacts.forEach((text, i) => {
        if (i) row.appendChild(H.el('span.panel-impact__sep', { text: '·' }));
        row.appendChild(H.el('span.panel-impact__item', { text }));
      });
      card.appendChild(row);
    }

    /* 选项：带备注或超过两个时竖排全宽（备注重要），否则并排一行。 */
    const options = Array.isArray(a.options) ? a.options.filter(Boolean) : [];
    if (options.length) {
      const primary = panelsPrimaryIndex(options);
      const hasNote = options.some((o) => o.note);
      const stack = hasNote || options.length > 2;
      const row = H.el('div', { class: 'panel-options' + (stack ? ' panel-options--stack' : '') });
      options.forEach((opt, i) => {
        let cls = 'h-btn';
        if (opt.danger) cls += ' h-btn--danger';
        else if (i === primary) cls += ' h-btn--primary';
        const btn = H.el('button', {
          type: 'button',
          class: cls,
          'data-testid': 'inbox-option-' + opt.id,
          'data-id': opt.id,
          title: opt.note || opt.label,
        }, H.el('span.panel-opt__label', { text: opt.label || opt.id }));
        if (opt.note) btn.appendChild(H.el('span.panel-opt__note', { text: opt.note }));
        btn.addEventListener('click', () => {
          if (typeof actions.resolveApproval === 'function') actions.resolveApproval(a.id, opt.id);
        });
        row.appendChild(btn);
      });
      card.appendChild(row);
    }

    return card;
  }

  /** 已处理审批折叠成一行：结果 + 时间可查，但不再占决策空间。 */
  function resolvedRow(a) {
    const label = a.resolvedLabel || '已处理';
    const embedded = panelsExtractTime(label);
    const time = a.resolvedAt || a.at || embedded || '';
    const row = H.el('div.panel-resolved', {
      'data-testid': 'inbox-resolved-' + a.id,
      'data-id': a.id,
      title: (a.title || '') + ' · ' + label + (time && !embedded ? ' · ' + time : ''),
    },
      H.el('span.panel-resolved__check', { text: '✓', 'aria-hidden': 'true' }),
      H.el('span.panel-resolved__title', { text: a.title || '已处理' }),
      H.el('span.panel-resolved__sep', { text: '·' }),
      H.el('span.panel-resolved__label', { text: label }),
    );
    if (time && !embedded) row.appendChild(H.el('span.panel-resolved__time.h-mono', { text: time }));
    return row;
  }

  function buildInbox(mission) {
    const nodes = [];
    const open = openApprovals(mission);
    const resolved = resolvedApprovals(mission);

    if (open.length) {
      const flow = H.el('div.panel-flow');
      open.forEach((a) => flow.appendChild(approvalCard(a, mission)));
      nodes.push(flow);
    }
    if (resolved.length) {
      nodes.push(H.el('div.panel-minihead', null,
        H.el('span', { text: '已处理' }),
        H.el('span.panel-minihead__count.h-mono', { text: String(resolved.length) }),
      ));
      const list = H.el('div.panel-resolved-list');
      resolved.forEach((a) => list.appendChild(resolvedRow(a)));
      nodes.push(list);
    }
    if (!open.length && !resolved.length) {
      nodes.push(panelsEmpty('shield', '没有等你决定的事。', 'agent 在按你的档位自己走。'));
    }
    return nodes;
  }

  /* ---------- tab 2：证据 ---------- */

  function reliabilityChip(reliability) {
    const map = {
      high: { cls: 'h-chip--ok', label: '高可信' },
      med: { cls: '', label: '中可信' },
      low: { cls: 'h-chip--warn', label: '低可信' },
    };
    const meta = map[reliability] || map.med;
    return H.el('span', { class: 'h-chip panel-evidence__rel ' + meta.cls, title: '来源可信度：' + meta.label, text: meta.label });
  }

  function evidenceCard(e) {
    const conflict = e.status === 'conflict';
    const weak = e.status === 'weak';
    const focused = focusEvidenceId === e.id;
    const cls = 'panel-evidence'
      + (conflict ? ' panel-evidence--conflict' : '')
      + (weak ? ' panel-evidence--weak' : '')
      + (focused ? ' panel-evidence--focus' : '');
    const card = H.el('article', {
      class: cls,
      'data-testid': 'evidence-item-' + e.id,
      'data-id': e.id,
      'data-status': e.status || 'ok',
    });

    /* 状态 chip 在左（冲突/二手），可信度在右：质量与一致性是两个维度。 */
    const chips = H.el('div.panel-evidence__chips');
    if (conflict) chips.appendChild(H.el('span', { class: 'h-chip h-chip--signal', title: '两个来源对同一事实给出了不同说法', text: '说法不一致' }));
    if (weak) chips.appendChild(H.el('span', { class: 'h-chip h-chip--warn', title: '这条信息经过转述，未拿到原始来源', text: '二手转述' }));
    chips.appendChild(reliabilityChip(e.reliability));
    card.appendChild(chips);

    card.appendChild(H.el('p.panel-evidence__claim', { text: e.claim || '一条待核对的论断' }));

    if (e.quote) {
      card.appendChild(H.el('blockquote.panel-evidence__quote', { text: e.quote, title: e.quote }));
    }

    /* 来源行：标题可点开原文；机构与日期压成 10px 灰字，外链图标永远在右端。 */
    const source = e.source || {};
    const srcRow = H.el('div.panel-evidence__src');
    if (source.url) {
      srcRow.appendChild(H.el('a.panel-evidence__title', {
        href: source.url,
        target: '_blank',
        rel: 'noreferrer',
        title: '打开原文',
        text: source.title || '未命名来源',
      }));
    } else {
      srcRow.appendChild(H.el('span.panel-evidence__title', { text: source.title || '未命名来源' }));
    }
    if (source.org) srcRow.appendChild(H.el('span.panel-evidence__org', { text: source.org }));
    if (source.at) srcRow.appendChild(H.el('span.panel-evidence__at.h-mono', { text: source.at }));
    if (source.url) {
      srcRow.appendChild(H.el('a.panel-evidence__open', {
        href: source.url,
        target: '_blank',
        rel: 'noreferrer',
        title: '在新标签打开原文',
        'aria-label': '打开来源原文',
      }, H.icon('external', 12)));
    }
    card.appendChild(srcRow);
    return card;
  }

  function buildEvidence(mission) {
    const list = evidenceList(mission);
    if (!list.length) {
      return [panelsEmpty('search', '还没有收集到证据。', '研究步骤跑完，来源会逐条记在这里，每条都能回到原文。')];
    }
    const conflicts = list.filter((e) => e.status === 'conflict').length;
    const weak = list.filter((e) => e.status === 'weak').length;
    const stats = H.el('div.panel-stats', null,
      H.el('span.panel-stats__num.h-mono', { text: String(list.length) }),
      H.el('span', { text: '条来源' }),
      H.el('span.panel-stats__sep', { text: '·' }),
      H.el('span', { class: 'panel-stats__num h-mono' + (conflicts ? ' is-warn' : ' is-muted'), text: String(conflicts) }),
      H.el('span', { text: '冲突' }),
      H.el('span.panel-stats__sep', { text: '·' }),
      H.el('span', { class: 'panel-stats__num h-mono' + (weak ? ' is-warn' : ' is-muted'), text: String(weak) }),
      H.el('span', { text: '存疑' }),
      H.el('span.panel-stats__hint', { text: '点击标题可回到原文' }),
    );
    const flow = H.el('div.panel-flow');
    /* 保持剧本顺序：证据是叙事的一部分；冲突靠描边与统计先被看见，而不是靠重排。 */
    list.forEach((e) => flow.appendChild(evidenceCard(e)));
    return [stats, flow];
  }

  /* ---------- tab 3：上下文 ---------- */

  function sliceRows(context) {
    const slices = Array.isArray(context.slices) ? context.slices.filter(Boolean) : [];
    const used = slices.reduce((n, s) => n + (Number(s.tokens) || 0), 0) || Number(context.windowTokens) || 0;
    const list = H.el('ul.panel-slices');
    slices.forEach((s) => {
      const tokens = Number(s.tokens) || 0;
      const share = used ? (tokens / used) * 100 : 0;
      const row = H.el('li.panel-slice', {
        'data-testid': 'ctx-slice-' + s.key,
        'data-key': s.key,
        title: s.label + '：' + panelsFmtTokens(tokens) + ' tokens，占已用上下文 ' + share.toFixed(1) + '%',
      },
        H.el('i', { class: 'panel-slice__swatch ' + (PANELS_TONE_CLASS[s.tone] || 'panel-tone--info') }),
        H.el('span.panel-slice__label', { text: s.label || s.key }),
        H.el('span.panel-slice__tokens.h-mono', { text: panelsFmtTokens(tokens) }),
        H.el('span.panel-slice__pct.h-mono', { text: share.toFixed(share >= 10 ? 0 : 1) + '%' }),
      );
      list.appendChild(row);
    });
    return list;
  }

  function buildContext(mission) {
    const c = mission.context;
    if (!c) {
      return [panelsEmpty('layer', '还没有上下文账本。', '任务跑起来之后，窗口里放了什么会逐段列出来。')];
    }
    const cap = Math.max(1, Number(c.capTokens) || 1);
    const used = Math.max(0, Number(c.windowTokens) || 0);
    const pct = Math.min(100, (used / cap) * 100);
    const left = Math.max(0, cap - used);
    const slices = Array.isArray(c.slices) ? c.slices.filter(Boolean) : [];

    const nodes = [];

    /* 预算区：等宽数字 + 水平堆叠条。条的总长是 cap，彩色段是已用，空出来的就是余量。 */
    const budget = H.el('div.panel-budget');
    budget.appendChild(H.el('div.panel-budget__head', null,
      H.el('span.panel-budget__label', { text: '上下文窗口' }),
      H.el('span.panel-budget__num.h-mono', null,
        H.el('span', { text: panelsFmtTokens(used) }),
        H.el('span.panel-budget__cap', { text: ' / ' + panelsFmtTokens(cap) }),
      ),
      H.el('span', { class: 'panel-budget__pct h-mono' + (pct >= 85 ? ' is-warn' : ''), text: pct.toFixed(1) + '%' }),
    ));
    const track = H.el('div.panel-track', { role: 'img', 'aria-label': '上下文预算：已用 ' + pct.toFixed(1) + '%' });
    slices.forEach((s) => {
      const tokens = Number(s.tokens) || 0;
      const width = Math.min(100, (tokens / cap) * 100);
      track.appendChild(H.el('i', {
        class: 'panel-track__seg ' + (PANELS_TONE_CLASS[s.tone] || 'panel-tone--info'),
        style: { width: width.toFixed(2) + '%' },
        title: s.label + ' · ' + panelsFmtTokens(tokens),
      }));
    });
    budget.appendChild(track);
    budget.appendChild(H.el('div.panel-budget__foot', null,
      H.el('span', { text: '余量 ' + panelsFmtTokens(left) }),
      H.el('span', { text: slices.length + ' 段 · 超出上限会先压缩再问你' }),
    ));
    nodes.push(budget);

    nodes.push(panelSec('窗口分配', H.el('span.h-mono', { text: slices.length + ' 段' })));
    nodes.push(sliceRows(c));

    /* 长期记忆：每一条都要能追溯来源，否则「它记得我」就只是黑箱。 */
    const memory = Array.isArray(c.memory) ? c.memory.filter(Boolean) : [];
    nodes.push(panelSec('长期记忆', memory.length ? H.el('span.h-mono', { text: memory.length + ' 条' }) : null));
    if (memory.length) {
      const list = H.el('ul.panel-memory');
      memory.forEach((m) => {
        list.appendChild(H.el('li.panel-memory__item', null,
          H.el('span.panel-memory__icon', null, H.icon('memory', 12)),
          H.el('div.panel-memory__body', null,
            H.el('div.panel-memory__text', { text: m.text || '' }),
            H.el('div.panel-memory__from', { text: m.from || '来源未记录' }),
          ),
        ));
      });
      nodes.push(list);
    } else {
      nodes.push(H.el('div.panel-empty-inline', { text: '还没有长期记忆。跨会话复用的偏好会出现在这里。' }));
    }

    /* 底部两行解释：它丢掉了什么、压缩过几次——比「已用 49%」更能说明上下文是被编辑过的。 */
    const dropped = Number(c.droppedSources) || 0;
    const compactions = Number(c.compactions) || 0;
    const foot = H.el('div.panel-ctxfoot');
    const row1 = H.el('div.panel-ctxfoot__row');
    row1.appendChild(H.el('span.panel-ctxfoot__k', { text: '丢弃来源' }));
    row1.appendChild(H.el('span.panel-ctxfoot__num.h-mono', { text: String(dropped) }));
    if (dropped > 0) {
      const jump = H.el('button.panel-linkbtn', {
        type: 'button',
        'data-testid': 'ctx-jump-evidence',
        title: '去证据 tab 查看没进上下文的来源',
      }, H.el('span', { text: '没进上下文的 ' + dropped + ' 条来源可在证据里查' }), H.icon('arrow', 11));
      jump.addEventListener('click', () => switchTab('evidence'));
      row1.appendChild(jump);
    } else {
      row1.appendChild(H.el('span', { text: '取用过的来源都还在上下文里' }));
    }
    foot.appendChild(row1);

    const row2 = H.el('div.panel-ctxfoot__row');
    row2.appendChild(H.el('span.panel-ctxfoot__k', { text: '压缩' }));
    row2.appendChild(H.el('span.panel-ctxfoot__num.h-mono', { text: String(compactions) }));
    row2.appendChild(H.el('span', {
      text: compactions > 0
        ? '次 · 早期对话折成摘要，结论与引用保留'
        : '次 · 还没触发压缩，窗口还宽裕',
    }));
    foot.appendChild(row2);
    nodes.push(foot);

    return nodes;
  }

  /* ---------- tab 4：交付物 ---------- */

  function deliveryReceipt(deliveredTo) {
    return H.el('div.panel-delivery', { 'data-testid': 'artifact-delivered' },
      H.el('span.panel-delivery__icon', null, H.icon('check', 13)),
      H.el('span.panel-delivery__text', null,
        H.el('b', { text: '已交付' }),
        H.el('span', { text: ' · ' + deliveredTo }),
      ),
    );
  }

  function iconButton(iconName, label, testid) {
    const btn = H.el('button.h-btn.h-btn--sm', { type: 'button', 'data-testid': testid, title: label });
    btn.appendChild(H.icon(iconName, 12));
    btn.appendChild(H.el('span.panel-btn__label', { text: label }));
    return btn;
  }

  function artifactHead(artifact) {
    const head = H.el('div.panel-arthead');
    head.appendChild(H.el('h2.panel-arthead__title', { text: artifact.title || '未命名交付物' }));
    const actionsRow = H.el('div.panel-arthead__actions');
    const copyBtn = iconButton('copy', '复制', 'artifact-copy');
    copyBtn.addEventListener('click', () => panelsCopyText(artifact.body || '', copyBtn));
    const dlBtn = iconButton('file', '下载 .md', 'artifact-download');
    dlBtn.addEventListener('click', () => panelsDownloadMarkdown(artifact.title, artifact.body || ''));
    actionsRow.append(copyBtn, dlBtn);
    head.appendChild(actionsRow);
    return head;
  }

  /** 论断 → 证据的映射。每个编号都可点：切到证据 tab 并高亮那条来源。 */
  function claimsSection(claims, evidence) {
    const index = new Map(evidence.map((e, i) => [e.id, i]));
    const section = panelSec('论断与来源', H.el('span.h-dim', { text: '点编号回证据' }));
    const rows = H.el('div.panel-claims');
    claims.forEach((cl) => {
      const row = H.el('div.panel-claim');
      row.appendChild(H.el('div.panel-claim__text', { text: (cl && cl.text) || '' }));
      const refs = H.el('div.panel-claim__refs');
      const ids = cl && Array.isArray(cl.evidenceIds) ? cl.evidenceIds : [];
      if (!ids.length) {
        refs.appendChild(H.el('span', { class: 'h-chip h-chip--warn', title: '这条论断没有挂任何来源', text: '未挂来源' }));
      }
      ids.forEach((id) => {
        const i = index.get(id);
        if (i === undefined) {
          refs.appendChild(H.el('span', { class: 'h-chip h-chip--dim', title: '引用的证据不在证据列表里', text: '来源缺失' }));
          return;
        }
        const btn = H.el('button.panel-ref.h-mono', { type: 'button', 'data-id': id, title: '在证据里查看：' + (evidence[i].claim || id), text: String(i + 1) });
        btn.addEventListener('click', () => focusEvidence(id));
        refs.appendChild(btn);
      });
      row.appendChild(refs);
      rows.appendChild(row);
    });
    return [section, rows];
  }

  function verificationSection(list) {
    const pass = list.filter((v) => v && v.status === 'pass').length;
    const aside = H.el('span', { class: 'h-mono ' + (pass === list.length ? 'panel-ok' : 'panel-warn'), text: pass + '/' + list.length + ' 通过' });
    const section = panelSec('自检清单', aside);
    const rows = H.el('div.panel-verify');
    list.forEach((item, i) => {
      const status = item.status === 'fail' ? 'fail' : item.status === 'warn' ? 'warn' : 'pass';
      const row = H.el('div.panel-verify__item', { 'data-testid': 'verify-item-' + i, 'data-status': status });
      const iconWrap = H.el('span', { class: 'panel-verify__icon is-' + status });
      iconWrap.appendChild(H.icon(status === 'pass' ? 'check' : status === 'fail' ? 'x' : 'warn', 13));
      row.appendChild(iconWrap);
      const body = H.el('div.panel-verify__body');
      body.appendChild(H.el('div.panel-verify__label', { text: item.label || '检查项 ' + (i + 1) }));
      if (item.detail) body.appendChild(H.el('div.panel-verify__detail', { text: item.detail }));
      row.appendChild(body);
      row.appendChild(H.el('span', {
        class: 'panel-verify__tag is-' + status,
        text: status === 'pass' ? '通过' : status === 'warn' ? '待确认' : '未通过',
      }));
      rows.appendChild(row);
    });
    return [section, rows];
  }

  function replaySection(mission) {
    const canReplay = mission.replayable !== false;
    const foot = H.el('div.panel-replay');
    const btn = H.el('button.h-btn.h-btn--block', {
      type: 'button',
      'data-testid': 'artifact-replay',
      title: canReplay ? '回到这次执行的第一条动作，从头重看' : '这个任务没有可回放的起点',
    });
    btn.appendChild(H.icon('replay', 13));
    btn.appendChild(H.el('span', { text: '回放这次执行' }));
    if (!canReplay) btn.disabled = true;
    btn.addEventListener('click', () => {
      if (!canReplay) return;
      if (typeof actions.replay === 'function') actions.replay(mission.id);
    });
    foot.appendChild(btn);
    foot.appendChild(H.el('div.panel-replay__hint', {
      text: canReplay
        ? '把任务重置回起点，从第一条动作重看；交付物会重新生成。'
        : '这个任务没有可回放的剧本起点。',
    }));
    return foot;
  }

  function buildArtifact(mission) {
    const artifact = mission.artifact;
    if (!artifact) {
      return [panelsEmpty('file', '还没有交付物。', '任务写完会落在这里，连同自检结果和发送回执。')];
    }
    const evidence = evidenceList(mission);
    const nodes = [];

    /* 回执置顶：先确认「发给了谁」，再读正文。 */
    if (artifact.deliveredTo) nodes.push(deliveryReceipt(artifact.deliveredTo));

    nodes.push(artifactHead(artifact));

    /* 正文：共享 H.md 渲染（已转义），排版样式在 .panel-md 里局部覆盖。 */
    nodes.push(H.el('div.panel-md', { 'data-testid': 'artifact-body', html: H.md(artifact.body || '') }));

    const claims = Array.isArray(artifact.claims) ? artifact.claims.filter(Boolean) : [];
    if (claims.length) nodes.push.apply(nodes, claimsSection(claims, evidence));

    const verification = Array.isArray(artifact.verification) ? artifact.verification.filter(Boolean) : [];
    if (verification.length) {
      nodes.push.apply(nodes, verificationSection(verification));
    } else {
      nodes.push(H.el('div.panel-note-warn', null,
        H.el('span.panel-note-warn__icon', null, H.icon('warn', 12)),
        H.el('span', { text: '这份交付物没有附带自检记录，引用前请自己核一遍。' }),
      ));
    }

    nodes.push(replaySection(mission));
    return nodes;
  }

  /* ---------- 渲染与交互 ---------- */

  function buildBody(state) {
    const mission = state && state.selected ? state.selected : null;
    if (!mission) {
      return [panelsEmpty('helm', '还没有选中任务。', '在左栏选一个任务，这里会展开它的运行层。')];
    }
    if (tab === 'evidence') return buildEvidence(mission);
    if (tab === 'context') return buildContext(mission);
    if (tab === 'artifact') return buildArtifact(mission);
    return buildInbox(mission);
  }

  /** tab 切换 / 定位时的原地重绘：只换 body，不重建 tab 条，视觉上更稳。 */
  function paintBody(animate) {
    if (!bodyEl || !lastState) return;
    bodyEl.replaceChildren.apply(bodyEl, buildBody(lastState));
    if (animate) {
      bodyEl.classList.remove('panel-body--in');
      void bodyEl.offsetWidth;
      bodyEl.classList.add('panel-body--in');
    }
  }

  function switchTab(next) {
    if (!PANELS_TABS.some((t) => t.key === next)) return;
    if (next === tab) return;
    tab = next;
    focusApproveId = null;
    focusEvidenceId = null;
    clearFocusTimer();
    syncTabbar();
    paintBody(true);
  }

  function clearFocusTimer() {
    if (focusTimer) {
      clearTimeout(focusTimer);
      focusTimer = null;
    }
  }

  function afterPaint(fn) {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(fn));
    } else {
      setTimeout(fn, 0);
    }
  }

  /** 高亮是一次性的：约 2s 后摘掉 class，避免它变成长久的「选中态」。 */
  function scheduleFocusClear() {
    clearFocusTimer();
    focusTimer = setTimeout(() => {
      focusApproveId = null;
      focusEvidenceId = null;
      if (rootEl && rootEl.querySelectorAll) {
        rootEl.querySelectorAll('.panel-approve--focus, .panel-evidence--focus').forEach((node) => {
          node.classList.remove('panel-approve--focus', 'panel-evidence--focus');
        });
      }
    }, 2000);
  }

  function scheduleFocusScroll() {
    afterPaint(() => {
      if (!rootEl || (!focusApproveId && !focusEvidenceId)) return;
      let node = null;
      if (focusApproveId) node = rootEl.querySelector('[data-testid="inbox-approve-' + focusApproveId + '"]');
      else node = rootEl.querySelector('[data-testid="evidence-item-' + focusEvidenceId + '"]');
      if (!node) return;
      if (typeof node.scrollIntoView === 'function') {
        try {
          node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } catch (err) {
          node.scrollIntoView();
        }
      }
      try {
        node.focus({ preventScroll: true });
      } catch (err) {
        /* 老浏览器忽略 focus 参数 */
      }
    });
  }

  function render(state) {
    lastState = state || null;
    const mission = state && state.selected ? state.selected : null;
    const missionId = mission ? mission.id : null;

    /* 换任务后若当前 tab 没有内容，回退 inbox（里面有解释性空态，不会白屏）；
       同一任务内保持用户手动选的 tab。 */
    if (mission && !tabHasData(tab, mission) && missionId !== lastMissionId) tab = 'inbox';
    lastMissionId = missionId;

    tabbarEl = buildTabbar();
    bodyEl = H.el('div.panel-body.h-scroll', { role: 'tabpanel', 'aria-label': PANELS_TABS.filter((t) => t.key === tab)[0].label });
    bodyEl.replaceChildren.apply(bodyEl, buildBody(lastState));
    rootEl = H.el('div.h-view.panel-view', { 'data-testid': 'panels-root' }, tabbarEl, bodyEl);

    if (focusApproveId || focusEvidenceId) {
      scheduleFocusScroll();
      scheduleFocusClear();
    }
    return rootEl;
  }

  /** 供中栏 / 键盘调用：切 tab（main 随后会 render 一次，这里先原地刷一版）。 */
  function setTab(next) {
    switchTab(next);
  }

  /** 供中栏审批卡调用：切到 inbox、滚到该卡片、加一次性高亮。 */
  function focusApproval(id) {
    if (!id) return;
    tab = 'inbox';
    focusEvidenceId = null;
    focusApproveId = String(id);
    syncTabbar();
    paintBody(true);
    scheduleFocusScroll();
    scheduleFocusClear();
  }

  /** 供中栏证据 chip 调用：切到 evidence、滚到该条、加一次性高亮。 */
  function focusEvidence(id) {
    if (!id) return;
    tab = 'evidence';
    focusApproveId = null;
    focusEvidenceId = String(id);
    syncTabbar();
    paintBody(true);
    scheduleFocusScroll();
    scheduleFocusClear();
  }

  return { render, setTab, focusApproval, focusEvidence };
}

/* ---------- 面板样式：全部前缀 panel-，只追加进 HELM_STYLES，不改 app.css ---------- */
HELM_STYLES.push(`
/* 根节点自撑满右栏：app.css 只定义了 .helm-view，而契约要求视图根用 .h-view，
   两边类名对不上时根节点会退化成普通块，长内容会顶穿栏位而不是在 body 内滚动。
   面板在自己的样式里补齐这条，不依赖 Lead 改共享 CSS。 */
.panel-view { flex: 1; min-height: 0; display: flex; flex-direction: column; }

/* ---- tab 条 ---- */
.panel-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  flex: none;
  height: 40px;
  padding: 0 4px;
  border-bottom: 1px solid var(--h-line);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.022), rgba(255, 255, 255, 0));
}
.panel-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 0;
  height: 100%;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: var(--h-text-3);
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.02em;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s var(--h-ease), background 0.15s var(--h-ease);
}
.panel-tab:hover { color: var(--h-text-2); background: rgba(255, 255, 255, 0.018); }
.panel-tab:focus-visible { outline: 2px solid var(--h-signal); outline-offset: -3px; border-radius: 6px; }
.panel-tab[aria-selected="true"] { color: var(--h-text); }
.panel-tab[aria-selected="true"]::after {
  content: "";
  position: absolute;
  left: 9px;
  right: 9px;
  bottom: 0;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--h-signal);
}
.panel-tab__label { overflow: hidden; text-overflow: ellipsis; }
.panel-tab__count {
  font-family: var(--h-mono);
  font-variant-numeric: tabular-nums;
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
  color: var(--h-text-4);
  transform: translateY(0.5px);
}
.panel-tab__count.is-signal { color: var(--h-signal); }
.panel-tab__count.is-warn { color: var(--h-warn); }
.panel-tab[aria-selected="true"] .panel-tab__count { color: var(--h-text-2); }
.panel-tab[aria-selected="true"] .panel-tab__count.is-signal { color: var(--h-signal); }
.panel-tab[aria-selected="true"] .panel-tab__count.is-warn { color: var(--h-warn); }
.panel-tab__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--h-warn);
  flex: none;
  transform: translateY(-3px);
}

/* ---- 滚动 body ---- */
.panel-body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.panel-body--in { animation: panel-body-in 0.2s var(--h-ease); }
@keyframes panel-body-in {
  from { opacity: 0.45; transform: translateY(3px); }
  to { opacity: 1; transform: none; }
}

/* ---- 空态 ---- */
.panel-empty { display: flex; align-items: center; justify-content: center; min-height: 240px; }
.panel-empty .h-empty { padding: 30px 26px; gap: 7px; }
.panel-empty__title { color: var(--h-text-2); font-size: 11.5px; line-height: 1.55; }
.panel-empty__sub { color: var(--h-text-4); font-size: 10.5px; line-height: 1.6; }

/* ---- 通用 ---- */
.panel-flow { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px 16px; }
.panel-minihead {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 14px 14px 4px;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--h-text-4);
}
.panel-minihead__count { color: var(--h-text-4); font-weight: 400; }
.panel-minihead::after { content: ""; flex: 1; height: 1px; background: var(--h-line); }
.panel-ok { color: var(--h-ok); }
.panel-warn { color: var(--h-warn); }
.panel-empty-inline {
  padding: 4px 14px 14px;
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--h-text-4);
}
.panel-note-warn {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 8px 14px 14px;
  padding: 7px 9px;
  border: 1px solid rgba(233, 185, 73, 0.24);
  border-radius: 7px;
  background: var(--h-warn-dim);
  font-size: 10.5px;
  line-height: 1.55;
  color: var(--h-text-2);
}
.panel-note-warn__icon { display: grid; place-items: center; flex: none; color: var(--h-warn); margin-top: 1px; }

/* ---- 档位说明条 ---- */
.panel-policy {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--h-line);
  background: rgba(255, 255, 255, 0.012);
  font-size: 10.5px;
  line-height: 1.55;
  color: var(--h-text-3);
}
.panel-policy__icon { display: grid; place-items: center; flex: none; width: 14px; height: 14px; margin-top: 1px; color: var(--h-text-4); }
.panel-policy__text { min-width: 0; }

/* ---- 审批卡 ---- */
.panel-approve {
  position: relative;
  padding: 10px 11px 11px;
  border: 1px solid var(--h-line-2);
  border-radius: var(--h-r-md);
  background: var(--h-panel);
  transition: border-color 0.18s var(--h-ease), background 0.18s var(--h-ease);
}
.panel-approve:hover { border-color: var(--h-line-3); }
.panel-approve:focus-visible { outline: 2px solid var(--h-signal-line); outline-offset: 1px; }
.panel-approve__top { display: flex; align-items: center; gap: 6px; min-height: 17px; }
.panel-risk {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  height: 17px;
  padding: 0 6px;
  border: 1px solid var(--h-line-2);
  border-radius: 4px;
  background: var(--h-panel-2);
  color: var(--h-text-3);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.panel-risk--med { color: var(--h-signal); border-color: var(--h-signal-line); background: var(--h-signal-dim); }
.panel-risk--high { color: var(--h-err); border-color: rgba(239, 106, 95, 0.32); background: var(--h-err-dim); }
.panel-risk .h-dot { width: 5px; height: 5px; }
.panel-approve__kind { flex: none; font-size: 9.5px; letter-spacing: 0.05em; color: var(--h-text-4); }
.panel-approve__auto {
  margin-left: auto;
  min-width: 0;
  text-align: right;
  font-size: 9.5px;
  line-height: 1.35;
  color: var(--h-text-4);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.panel-approve__title {
  margin: 7px 0 0;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.42;
  letter-spacing: 0.005em;
  color: var(--h-text);
}
.panel-why {
  margin-top: 9px;
  padding: 7px 9px 8px;
  border-radius: 7px;
  border-left: 2px solid var(--h-line-3);
  background: var(--h-panel-2);
}
.panel-approve[data-risk="med"] .panel-why { border-left-color: var(--h-signal-line); }
.panel-approve[data-risk="high"] .panel-why { border-left-color: rgba(239, 106, 95, 0.45); }
.panel-why__label {
  margin-bottom: 3px;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--h-text-3);
}
.panel-why__text { margin: 0; font-size: 11.5px; line-height: 1.62; color: var(--h-text-2); }
.panel-impact {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 5px;
  margin-top: 9px;
  font-size: 10.5px;
  line-height: 1.5;
}
.panel-impact__label { font-size: 9.5px; font-weight: 600; letter-spacing: 0.06em; color: var(--h-text-4); }
.panel-impact__item { color: var(--h-text-2); }
.panel-impact__sep { color: var(--h-text-4); }

/* 选项：默认并排一行；带备注/多选项时竖排全宽 */
.panel-options { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
.panel-options .h-btn { height: 27px; padding: 0 10px; font-size: 11px; }
.panel-options--stack { flex-direction: column; align-items: stretch; gap: 5px; }
.panel-options--stack .h-btn {
  justify-content: flex-start;
  height: auto;
  min-height: 29px;
  padding: 5px 10px;
  text-align: left;
  white-space: normal;
  gap: 8px;
}
.panel-opt__label { flex: none; }
.panel-opt__note {
  margin-left: auto;
  padding-left: 10px;
  text-align: right;
  font-size: 9.5px;
  font-weight: 400;
  line-height: 1.3;
  opacity: 0.62;
}

/* ---- 已处理：一行灰态 ---- */
.panel-resolved-list { display: flex; flex-direction: column; padding: 0 14px 14px; }
.panel-resolved {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 4px 2px;
  border-bottom: 1px solid var(--h-line);
  font-size: 11px;
  color: var(--h-text-3);
}
.panel-resolved:last-child { border-bottom: 0; }
.panel-resolved__check { flex: none; font-size: 10px; color: var(--h-ok); opacity: 0.7; }
.panel-resolved__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.panel-resolved__sep { flex: none; color: var(--h-text-4); }
.panel-resolved__label { flex: none; color: var(--h-text-3); }
.panel-resolved__time { flex: none; margin-left: auto; padding-left: 6px; font-size: 9.5px; color: var(--h-text-4); }

/* ---- 证据 ---- */
.panel-stats {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 5px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--h-line);
  font-size: 10.5px;
  color: var(--h-text-3);
}
.panel-stats__num { font-size: 11.5px; font-weight: 600; color: var(--h-text); }
.panel-stats__num.is-warn { color: var(--h-warn); }
.panel-stats__num.is-muted { color: var(--h-text-3); }
.panel-stats__sep { color: var(--h-text-4); }
.panel-stats__hint { margin-left: auto; font-size: 9.5px; color: var(--h-text-4); }
.panel-evidence {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 10px 10px;
  border: 1px solid var(--h-line);
  border-radius: var(--h-r-md);
  background: var(--h-panel);
  transition: border-color 0.18s var(--h-ease), background 0.18s var(--h-ease);
}
.panel-evidence:hover { border-color: var(--h-line-2); }
.panel-evidence--conflict {
  border-color: var(--h-signal-line);
  background: linear-gradient(180deg, rgba(242, 163, 60, 0.06), var(--h-panel) 58%);
}
.panel-evidence--weak { border-color: rgba(233, 185, 73, 0.22); }
.panel-evidence__chips { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
.panel-evidence__chips .h-chip { height: 18px; font-size: 10px; }
.panel-evidence__rel { margin-left: auto; }
.panel-evidence__claim { margin: 0; font-size: 11.5px; font-weight: 600; line-height: 1.5; color: var(--h-text); }
.panel-evidence__quote {
  margin: 0;
  padding-left: 8px;
  border-left: 1px solid var(--h-line-2);
  font-size: 10.5px;
  font-style: italic;
  line-height: 1.55;
  color: var(--h-text-3);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.panel-evidence__src {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-top: 1px;
  padding-top: 6px;
  border-top: 1px solid var(--h-line);
  font-size: 10px;
  color: var(--h-text-4);
}
.panel-evidence__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  color: var(--h-text-2);
  text-decoration: none;
}
a.panel-evidence__title:hover {
  color: var(--h-text);
  text-decoration: underline;
  text-decoration-color: var(--h-line-3);
  text-underline-offset: 2px;
}
.panel-evidence__org { flex: none; color: var(--h-text-4); }
.panel-evidence__at { flex: none; font-size: 9.5px; color: var(--h-text-4); }
.panel-evidence__open {
  display: grid;
  place-items: center;
  flex: none;
  width: 16px;
  height: 16px;
  margin-left: auto;
  border-radius: 4px;
  color: var(--h-text-4);
}
.panel-evidence__open:hover { color: var(--h-signal); background: var(--h-panel-2); }

/* ---- 上下文 ---- */
.panel-budget { padding: 12px 14px 11px; }
.panel-budget__head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.panel-budget__label { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; color: var(--h-text-3); }
.panel-budget__num { margin-left: auto; font-size: 12px; font-weight: 500; color: var(--h-text); }
.panel-budget__cap { font-weight: 400; color: var(--h-text-3); }
.panel-budget__pct { font-size: 10px; color: var(--h-text-3); }
.panel-budget__pct.is-warn { color: var(--h-warn); }
.panel-track {
  display: flex;
  height: 9px;
  border-radius: 3px;
  overflow: hidden;
  background: var(--h-panel-3);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
}
.panel-track__seg { flex: none; height: 100%; min-width: 2px; transition: width 0.45s var(--h-ease); }
.panel-tone--signal { background: var(--h-signal); }
.panel-tone--ok { background: var(--h-ok); }
.panel-tone--info { background: var(--h-info); }
.panel-tone--warn { background: var(--h-warn); }
.panel-budget__foot {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  font-family: var(--h-mono);
  font-size: 9.5px;
  color: var(--h-text-4);
}
.panel-slices { list-style: none; margin: 0; padding: 2px 0 8px; }
.panel-slice {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 25px;
  padding: 0 14px;
  font-size: 11px;
  color: var(--h-text-2);
}
.panel-slice:hover { background: rgba(255, 255, 255, 0.02); }
.panel-slice__swatch { flex: none; width: 8px; height: 8px; border-radius: 2px; }
.panel-slice__label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.panel-slice__tokens { flex: none; font-size: 10px; color: var(--h-text); }
.panel-slice__pct { flex: none; width: 33px; text-align: right; font-size: 9.5px; color: var(--h-text-4); }
.panel-memory { list-style: none; margin: 0; padding: 3px 14px 10px; }
.panel-memory__item { display: flex; gap: 7px; padding: 7px 0; border-bottom: 1px solid var(--h-line); }
.panel-memory__item:last-child { border-bottom: 0; }
.panel-memory__icon { flex: none; width: 13px; height: 13px; margin-top: 2px; color: var(--h-text-4); }
.panel-memory__body { min-width: 0; }
.panel-memory__text { font-size: 11px; line-height: 1.55; color: var(--h-text-2); }
.panel-memory__from { margin-top: 2px; font-size: 9.5px; line-height: 1.5; color: var(--h-text-4); }
.panel-ctxfoot {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 2px;
  padding: 9px 14px 14px;
  border-top: 1px solid var(--h-line);
  font-size: 10px;
  line-height: 1.55;
  color: var(--h-text-3);
}
.panel-ctxfoot__row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px; }
.panel-ctxfoot__k { color: var(--h-text-4); }
.panel-ctxfoot__num { font-weight: 600; color: var(--h-text-2); }
.panel-linkbtn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0;
  border: 0;
  border-bottom: 1px dashed var(--h-line-3);
  background: transparent;
  font-family: inherit;
  font-size: 10px;
  line-height: 1.5;
  color: var(--h-text-2);
  cursor: pointer;
  transition: color 0.15s var(--h-ease), border-color 0.15s var(--h-ease);
}
.panel-linkbtn:hover { color: var(--h-signal); border-bottom-color: var(--h-signal-line); }

/* ---- 交付物 ---- */
.panel-delivery {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 11px 14px 0;
  padding: 7px 9px;
  border: 1px solid rgba(74, 192, 138, 0.28);
  border-radius: 7px;
  background: var(--h-ok-dim);
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--h-ok);
}
.panel-delivery__icon { display: grid; place-items: center; flex: none; }
.panel-delivery__text { min-width: 0; }
.panel-delivery__text b { font-weight: 600; }
.panel-delivery__text span { color: var(--h-text-2); }
.panel-arthead { display: flex; align-items: flex-start; gap: 8px; padding: 12px 14px 8px; }
.panel-arthead__title { flex: 1; min-width: 0; margin: 0; font-size: 13px; font-weight: 600; line-height: 1.4; letter-spacing: 0.005em; color: var(--h-text); }
.panel-arthead__actions { display: flex; align-items: center; gap: 5px; flex: none; margin-top: -1px; }
.panel-arthead__actions .h-btn { height: 24px; padding: 0 8px; font-size: 10.5px; }
.panel-arthead__actions .h-btn svg { flex: none; }
.panel-md { padding: 2px 14px 12px; font-size: 11.5px; line-height: 1.66; color: var(--h-text-2); }
/* H.md 把 # / ## / ### 映射成 h3 / h4 / h5（保持文档大纲层级），这里统一排掉 */
.panel-md h2, .panel-md h3, .panel-md h4, .panel-md h5 {
  margin: 14px 0 6px;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--h-text);
  letter-spacing: 0.005em;
}
.panel-md h2:first-child, .panel-md h3:first-child, .panel-md h4:first-child, .panel-md h5:first-child { margin-top: 4px; }
.panel-md p { margin: 0 0 9px; }
.panel-md p:last-child { margin-bottom: 0; }
.panel-md ul, .panel-md ol { margin: 0 0 9px; padding-left: 17px; }
.panel-md li { margin: 3px 0; }
.panel-md li::marker { color: var(--h-text-4); }
.panel-md strong { font-weight: 600; color: var(--h-text); }
.panel-md code {
  padding: 0 4px;
  border: 1px solid var(--h-line);
  border-radius: 4px;
  background: var(--h-panel-3);
  font-family: var(--h-mono);
  font-size: 10.5px;
  color: var(--h-signal-2);
}
.panel-md blockquote {
  margin: 0 0 10px;
  padding: 7px 9px;
  border-left: 2px solid var(--h-signal-line);
  border-radius: 0 6px 6px 0;
  background: var(--h-panel-2);
  font-size: 11px;
  line-height: 1.6;
  color: var(--h-text-3);
}
.panel-md hr { height: 1px; margin: 12px 0; border: 0; background: var(--h-line); }
.panel-md > *:last-child { margin-bottom: 0; }
.panel-claims { display: flex; flex-direction: column; padding: 2px 14px 8px; }
.panel-claim {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 0;
  border-bottom: 1px solid var(--h-line);
  font-size: 10.5px;
  line-height: 1.55;
  color: var(--h-text-2);
}
.panel-claim:last-child { border-bottom: 0; }
.panel-claim__text { flex: 1; min-width: 0; }
.panel-claim__refs { display: flex; align-items: center; gap: 4px; flex: none; padding-top: 1px; }
.panel-ref {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 19px;
  height: 17px;
  padding: 0 4px;
  border: 1px solid var(--h-line-2);
  border-radius: 4px;
  background: var(--h-panel-2);
  color: var(--h-text-2);
  font-size: 9.5px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.panel-ref:hover { color: var(--h-signal); border-color: var(--h-signal-line); background: var(--h-signal-dim); }
.panel-verify { display: flex; flex-direction: column; padding: 2px 14px 10px; }
.panel-verify__item { display: flex; align-items: flex-start; gap: 7px; padding: 7px 0; border-bottom: 1px solid var(--h-line); }
.panel-verify__item:last-child { border-bottom: 0; }
.panel-verify__icon { display: grid; place-items: center; flex: none; width: 14px; height: 14px; margin-top: 1px; }
.panel-verify__icon.is-pass { color: var(--h-ok); }
.panel-verify__icon.is-warn { color: var(--h-warn); }
.panel-verify__icon.is-fail { color: var(--h-err); }
.panel-verify__body { flex: 1; min-width: 0; }
.panel-verify__label { font-size: 11px; font-weight: 500; line-height: 1.45; color: var(--h-text-2); }
.panel-verify__detail { margin-top: 1px; font-size: 9.5px; line-height: 1.5; color: var(--h-text-4); }
.panel-verify__tag { flex: none; margin-top: 1px; padding: 1px 5px; border-radius: 4px; font-size: 9px; letter-spacing: 0.04em; }
.panel-verify__tag.is-pass { color: var(--h-ok); background: var(--h-ok-dim); }
.panel-verify__tag.is-warn { color: var(--h-warn); background: var(--h-warn-dim); }
.panel-verify__tag.is-fail { color: var(--h-err); background: var(--h-err-dim); }
.panel-replay { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; padding: 11px 14px 16px; border-top: 1px solid var(--h-line); }
.panel-replay .h-btn { height: 30px; font-size: 11.5px; }
.panel-replay__hint { font-size: 9.5px; line-height: 1.5; text-align: center; color: var(--h-text-4); }

/* ---- 一次性定位高亮：琥珀描边闪一下，不常驻 ---- */
.panel-approve--focus,
.panel-evidence--focus {
  border-color: var(--h-signal-line);
  animation: panel-focus 1.3s var(--h-ease);
}
@keyframes panel-focus {
  0% { box-shadow: 0 0 0 1px var(--h-signal-line), 0 0 0 5px rgba(242, 163, 60, 0.1); }
  65% { box-shadow: 0 0 0 1px var(--h-signal-line), 0 0 0 5px rgba(242, 163, 60, 0.1); }
  100% { box-shadow: 0 0 0 1px transparent, 0 0 0 0 rgba(242, 163, 60, 0); }
}
`);
