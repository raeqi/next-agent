/**
 * HELM · 全局工具。所有视图共享的 DOM helper、图标、格式化与 markdown 子集渲染。
 * 无依赖；在 IIFE 顶层执行，后面的模块可见 `H` 与 `HELM_STYLES`。
 */

/** 视图模块把自己的 CSS 字符串 push 到这里，main 统一注入 <style>。 */
const HELM_STYLES = [];

const H = (() => {
  const NS = 'http://www.w3.org/2000/svg';

  /** 创建元素：H.el('div.cls#id', {attrs}, ...children) */
  function el(spec, attrs, ...children) {
    let tag = 'div';
    let cls = '';
    let id = '';
    const m = String(spec).match(/^([a-zA-Z0-9-]*)((?:[.#][\w-]+)*)$/);
    if (m) {
      tag = m[1] || 'div';
      const tail = m[2] || '';
      tail.replace(/([.#])([\w-]+)/g, (_, sig, name) => {
        if (sig === '.') cls = cls ? cls + ' ' + name : name;
        else id = name;
        return '';
      });
    }
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (id) node.id = id;
    if (attrs) {
      for (const key of Object.keys(attrs)) {
        const value = attrs[key];
        if (value === null || value === undefined || value === false) continue;
        if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
        else if (key === 'html') node.innerHTML = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else node.setAttribute(key, value === true ? '' : String(value));
      }
    }
    append(node, children);
    return node;
  }

  function append(node, children) {
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) append(node, child);
      else if (child instanceof Node) node.appendChild(child);
      else node.appendChild(document.createTextNode(String(child)));
    }
  }

  /** 简写：h('span', {...}, '文字') */
  const h = (tag, attrs, ...children) => el(tag, attrs, ...children);

  const ICONS = {
    helm: ['circle cx="12" cy="12" r="8.5"', 'circle cx="12" cy="12" r="2.4"', 'M12 3.5v5.6', 'M12 14.9v5.6', 'M3.5 12h5.6', 'M14.9 12h5.6', 'M6 6l3.4 3.4', 'M14.6 14.6L18 18', 'M18 6l-3.4 3.4', 'M9.4 14.6L6 18'],
    compass: ['circle cx="12" cy="12" r="8.5"', 'path d="M15.4 8.6l-2.1 4.7-4.7 2.1 2.1-4.7z"'],
    radar: ['circle cx="12" cy="12" r="8.5"', 'path d="M12 12l4.2-4.2"', 'path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"', 'circle cx="12" cy="12" r="1.2"'],
    target: ['circle cx="12" cy="12" r="8"', 'circle cx="12" cy="12" r="3.6"', 'circle cx="12" cy="12" r=".9"'],
    spark: ['path d="M12 3v4.2M12 16.8V21M3 12h4.2M16.8 12H21M6.2 6.2l2.6 2.6M15.2 15.2l2.6 2.6M17.8 6.2l-2.6 2.6M8.8 15.2l-2.6 2.6"'],
    check: ['path d="M20 6.5L9.2 17.5 4 12.2"'],
    x: ['path d="M6 6l12 12M18 6L6 18"'],
    arrow: ['path d="M4.5 12h14.2M12.8 6l6 6-6 6"'],
    play: ['path d="M8.5 5.5l10 6.5-10 6.5z"'],
    pause: ['rect x="8" y="5.5" width="2.6" height="13" rx="1"', 'rect x="13.4" y="5.5" width="2.6" height="13" rx="1"'],
    clock: ['circle cx="12" cy="12" r="8.5"', 'path d="M12 7.4V12l3.2 2"'],
    coin: ['circle cx="12" cy="12" r="8.5"', 'path d="M12 7.6v8.8M14.6 9.4c-.6-.8-1.5-1.3-2.6-1.3-1.5 0-2.6.8-2.6 2s1.1 1.7 2.6 2 2.6.8 2.6 2-1.1 2-2.6 2c-1.1 0-2-.5-2.6-1.3"'],
    layer: ['path d="M12 3.6l8.4 4.4L12 12.4 3.6 8z"', 'path d="M3.6 12.4L12 16.8l8.4-4.4"', 'path d="M3.6 16.4L12 20.8l8.4-4.4"'],
    copy: ['rect x="8.5" y="8.5" width="11" height="11" rx="2.2"', 'path d="M15.5 8.5V6.7A2.2 2.2 0 0 0 13.3 4.5H6.7A2.2 2.2 0 0 0 4.5 6.7v6.6a2.2 2.2 0 0 0 2.2 2.2h1.8"'],
    replay: ['path d="M4.8 12a7.2 7.2 0 1 0 2.3-5.2"', 'path d="M4.2 4.6v4.2h4.2"'],
    hand: ['path d="M8.2 12.5V6.8a1.5 1.5 0 0 1 3 0v4.4"', 'path d="M11.2 11.2V5.6a1.5 1.5 0 0 1 3 0v5.6"', 'path d="M14.2 11.6V7.4a1.5 1.5 0 0 1 3 0v7.2c0 3-2.2 5.2-5.2 5.2h-.8c-2 0-3.2-.8-4.2-2.3l-2.4-3.8c-.6-1-.2-2 .8-2.3.8-.3 1.6 0 2.2.8l1.4 2"'],
    handoff: ['path d="M4.5 8.5h12.4M13.6 5.2l3.3 3.3-3.3 3.3"', 'path d="M19.5 15.5H7.1M10.4 12.2L7.1 15.5l3.3 3.3"'],
    shield: ['path d="M12 3.4l7.2 2.6v5.4c0 4.3-2.9 7.3-7.2 9.2-4.3-1.9-7.2-4.9-7.2-9.2V6z"', 'path d="M9 11.8l2.2 2.2 4-4.2"'],
    eye: ['path d="M2.8 12S6.4 5.8 12 5.8 21.2 12 21.2 12 17.6 18.2 12 18.2 2.8 12 2.8 12z"', 'circle cx="12" cy="12" r="2.8"'],
    send: ['path d="M20.4 3.6L10.6 13.4"', 'path d="M20.4 3.6l-6.2 16.6-3.6-6.8-6.8-3.6z"'],
    file: ['path d="M13.4 3.6H7A2.2 2.2 0 0 0 4.8 5.8v12.4A2.2 2.2 0 0 0 7 20.4h10a2.2 2.2 0 0 0 2.2-2.2V9.4z"', 'path d="M13.4 3.6v5.8h5.8"', 'path d="M8.4 13.4h6.8M8.4 16.6h4.6"'],
    link: ['path d="M9.6 14.4l4.8-4.8"', 'path d="M11 6.6l1.6-1.6a3.8 3.8 0 1 1 5.4 5.4L16.4 12"', 'path d="M13 17.4l-1.6 1.6a3.8 3.8 0 1 1-5.4-5.4L7.6 12"'],
    warn: ['path d="M12 4.2l8.4 15.2H3.6z"', 'path d="M12 9.6v4.2"', 'circle cx="12" cy="16.9" r=".9"'],
    info: ['circle cx="12" cy="12" r="8.5"', 'path d="M12 11v5.4"', 'circle cx="12" cy="8" r=".95"'],
    plus: ['path d="M12 5v14M5 12h14"'],
    search: ['circle cx="10.8" cy="10.8" r="6.4"', 'path d="M15.6 15.6l4 4"'],
    brain: ['path d="M9.6 5.2a2.7 2.7 0 0 0-2.7 2.7A2.8 2.8 0 0 0 4.6 11a2.8 2.8 0 0 0 1.5 2.5A2.8 2.8 0 0 0 8 18.2a2.7 2.7 0 0 0 4-.4V6.4a2.7 2.7 0 0 0-2.4-1.2z"', 'path d="M14.4 5.2a2.7 2.7 0 0 1 2.7 2.7 2.8 2.8 0 0 1 2.3 3.1 2.8 2.8 0 0 1-1.5 2.5 2.8 2.8 0 0 1-1.9 4.7 2.7 2.7 0 0 1-4-.4V6.4a2.7 2.7 0 0 1 2.4-1.2z"'],
    memory: ['rect x="6.4" y="6.4" width="11.2" height="11.2" rx="2.2"', 'path d="M9.6 3.4v3M14.4 3.4v3M9.6 17.6v3M14.4 17.6v3M3.4 9.6h3M3.4 14.4h3M17.6 9.6h3M17.6 14.4h3"'],
    box: ['path d="M12 3.4l8.2 4.1v9L12 20.6l-8.2-4.1v-9z"', 'path d="M3.8 7.5L12 11.6l8.2-4.1M12 11.6v9"'],
    user: ['circle cx="12" cy="8.4" r="3.6"', 'path d="M5 20.2c.6-3.5 3.5-5.6 7-5.6s6.4 2.1 7 5.6"'],
    bot: ['rect x="4.6" y="7.4" width="14.8" height="11" rx="3"', 'path d="M12 3.6v3.8"', 'circle cx="9.4" cy="12.6" r="1"', 'circle cx="14.6" cy="12.6" r="1"', 'path d="M9.8 15.8h4.4"'],
    dot: ['circle cx="12" cy="12" r="3.4"'],
    chevronDown: ['path d="M6.4 9.4L12 15l5.6-5.6"'],
    chevronRight: ['path d="M9.4 6.4L15 12l-5.6 5.6"'],
    external: ['path d="M14 4.6h5.4V10"', 'path d="M19.4 4.6L11 13"', 'path d="M18.4 14.2v3.6a2.2 2.2 0 0 1-2.2 2.2H6.8a2.2 2.2 0 0 1-2.2-2.2V8.4a2.2 2.2 0 0 1 2.2-2.2h3.6"'],
    edit: ['path d="M4.6 19.4l.5-4.3L16.4 3.8a2.2 2.2 0 0 1 3.1 0l.7.7a2.2 2.2 0 0 1 0 3.1L9.9 18.9z"', 'path d="M14.6 5.6l3.8 3.8"'],
    split: ['path d="M4.5 6.5h4.2l4 5.5 4 5.5h2.8"', 'path d="M4.5 17.5h4.2l2.4-3.3"', 'path d="M16.4 14.4l3.1 3.1-3.1 3.1"'],
    volume: ['path d="M4.6 9.4h3l4-3.4v12l-4-3.4h-3z"', 'path d="M15 9.2a4 4 0 0 1 0 5.6M17.6 6.8a7.4 7.4 0 0 1 0 10.4"'],
    pin: ['path d="M12 3.6l2.3 5 5.5.6-4.1 3.7 1.2 5.4L12 15.6l-4.9 2.7 1.2-5.4-4.1-3.7 5.5-.6z"'],
  };

  /** H.icon('check', 16, {class:'x'}) → <svg> */
  function icon(name, size, attrs) {
    const parts = ICONS[name] || ICONS.dot;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size || 14));
    svg.setAttribute('height', String(size || 14));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (attrs) for (const k of Object.keys(attrs)) svg.setAttribute(k, attrs[k]);
    for (const part of parts) {
      const m = part.match(/^([a-z]+)\s/);
      const node = document.createElementNS(NS, m ? m[1] : 'path');
      const body = m ? part.slice(m[0].length) : part;
      body.replace(/([\w-]+)="([^"]*)"/g, (_, key, value) => {
        node.setAttribute(key, value);
        return '';
      });
      svg.appendChild(node);
    }
    return svg;
  }

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  function fmtUsd(n) {
    if (n === 0) return '$0';
    if (n < 0.01) return '<$0.01';
    return '$' + (n < 10 ? n.toFixed(2) : n.toFixed(1));
  }
  function fmtTokens(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k';
    return String(Math.round(n));
  }
  function fmtElapsed(sec) {
    if (sec < 60) return sec + 's';
    const m = Math.floor(sec / 60);
    if (m < 60) return m + 'm ' + String(Math.floor(sec % 60)).padStart(2, '0') + 's';
    return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
  }
  function fmtClock(minutesFromMidnight) {
    const total = ((minutesFromMidnight % 1440) + 1440) % 1440;
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  }

  /** 纯文本转义 → 允许替换受控标记前先 escape */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** markdown 子集 → HTML 字符串（已转义）；支持 # ## ### - 1. > --- **b** `c` [t](u) */
  function md(text) {
    const lines = String(text || '').split('\n');
    const out = [];
    let para = [];
    let list = null;
    const flushPara = () => {
      if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; }
    };
    const flushList = () => {
      if (list) { out.push('<' + list.tag + '>' + list.items.map((it) => '<li>' + inline(it) + '</li>').join('') + '</' + list.tag + '>'); list = null; }
    };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) { flushPara(); flushList(); continue; }
      let m;
      if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
        flushPara(); flushList();
        const level = m[1].length + 2;
        out.push('<h' + level + '>' + inline(m[2]) + '</h' + level + '>');
      } else if (/^---+$/.test(line.trim())) {
        flushPara(); flushList(); out.push('<hr>');
      } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
        flushPara();
        if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
        list.items.push(m[1]);
      } else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
        flushPara();
        if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
        list.items.push(m[1]);
      } else if ((m = line.match(/^>\s?(.*)$/))) {
        flushPara(); flushList();
        out.push('<blockquote>' + inline(m[1]) + '</blockquote>');
      } else {
        flushList(); para.push(line.trim());
      }
    }
    flushPara(); flushList();
    return out.join('');
  }

  function inline(text) {
    let s = esc(text);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a class="h-link" href="$2" target="_blank" rel="noreferrer">$1</a>');
    return s;
  }

  /** 细粒度节流：合并同一帧的多次通知 */
  function rafThrottle(fn) {
    let queued = false;
    let lastArgs = null;
    return function (...args) {
      lastArgs = args;
      if (queued) return;
      queued = true;
      const run = () => { queued = false; fn.apply(null, lastArgs); };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
      else setTimeout(run, 16);
    };
  }

  return { el, h, icon, clamp, fmtUsd, fmtTokens, fmtElapsed, fmtClock, esc, md, rafThrottle };
})();
