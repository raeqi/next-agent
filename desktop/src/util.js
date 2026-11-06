// 通用工具：元素构造、markdown 子集（含出处标注）、时间。

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue
    if (k === 'class') el.className = v
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
    else if (k === 'html') el.innerHTML = v
    else if (k === 'dataset') Object.assign(el.dataset, v)
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v)
    else el.setAttribute(k, v === true ? '' : v)
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue
    el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
  return el
}

export const sleep = ms => new Promise(r => setTimeout(r, ms))

export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const CITE = /\[来源:\s*([^\]#]+)#L(\d+)(?:-L?(\d+))?\]/g

/** 行内：转义、**粗体**、`代码`、出处 → 编号小标。cites 收集所有出处。 */
export function inline(text, cites) {
  let s = esc(text)
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(CITE, (_, path, a, b) => {
    if (!cites) return ''
    const key = `${path.trim()}#${a}`
    let i = cites.findIndex(c => c.key === key)
    if (i < 0) { cites.push({ key, path: path.trim(), line: Number(a), end: b ? Number(b) : Number(a) }); i = cites.length - 1 }
    return `<button class="cite" data-cite="${i}" title="${esc(path.trim())} 第 ${a} 行">${i + 1}</button>`
  })
  return s
}

/**
 * markdown 子集 → 块数组（标题/段落/列表项/引用/表格），每块可单独驳回。
 * @returns {{blocks:{kind:string,html:string,raw:string}[], cites:any[]}}
 */
export function mdBlocks(text) {
  const cites = []
  const blocks = []
  const lines = text.replace(/\r/g, '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    let m
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) blocks.push({ kind: 'h' + m[1].length, html: inline(m[2], cites), raw: line })
    else if (line.startsWith('>')) blocks.push({ kind: 'quote', html: inline(line.replace(/^>\s?/, ''), cites), raw: line })
    else if ((m = line.match(/^\s*[-*]\s+(?:\[( |x)\]\s+)?(.*)/))) blocks.push({ kind: 'li', check: m[1], html: inline(m[2], cites), raw: line })
    else if (line.trim().startsWith('|')) {
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++])
      i--
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const body = rows.filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r))
      const [head, ...rest] = body
      const html = `<table><thead><tr>${cells(head).map(c => `<th>${inline(c, cites)}</th>`).join('')}</tr></thead><tbody>${rest.map(r => `<tr>${cells(r).map(c => `<td>${inline(c, cites)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      blocks.push({ kind: 'table', html, raw: rows.join('\n') })
    } else blocks.push({ kind: 'p', html: inline(line, cites), raw: line })
  }
  return { blocks, cites }
}

/** 把块数组渲染进容器；连续列表项合并进 ul。 */
export function renderBlocks(container, blocks, decorate) {
  container.replaceChildren()
  let ul = null
  blocks.forEach((b, idx) => {
    const tag = { h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', quote: 'blockquote', li: 'li', table: 'div', p: 'p' }[b.kind]
    const el = h(tag, { class: `md-${b.kind}`, html: b.html, dataset: { block: idx } })
    if (b.kind === 'li' && b.check !== undefined) el.classList.add('md-task', b.check === 'x' ? 'is-done' : 'is-todo')
    decorate?.(el, b, idx)
    if (b.kind === 'li') {
      if (!ul) { ul = h('ul'); container.append(ul) }
      ul.append(el)
    } else { ul = null; container.append(el) }
  })
}

export async function fetchText(path) {
  const r = await fetch(path)
  if (!r.ok) throw new Error(`${path} ${r.status}`)
  return r.text()
}

export const ICONS = {
  chat: '<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M6 2.5h8l4.5 4.5v13a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V4A1.5 1.5 0 0 1 6 2.5z"/><path d="M14 2.5V7h4.5M8 12h8M8 15.5h8M8 9h3" fill="none"/></svg>',
  sheet: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M3.5 9h17M3.5 14h17M9.5 4v16" fill="none"/></svg>',
  bank: '<svg viewBox="0 0 24 24"><path d="M3 9.5 12 4l9 5.5zM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3.5 20h17" fill="none"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19" fill="none"/><path d="M9 7.5h6M9 10.5h4" fill="none"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4" fill="none"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 6A10.8 10.8 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.2 4M6.4 6.9C3.6 8.6 2 12 2 12s3.6 6.5 10 6.5a9.6 9.6 0 0 0 4.3-1" fill="none"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none"/></svg>',
  plane: '<svg viewBox="0 0 24 24"><path d="M21 15.5v-2l-8-5V3.8a1.3 1.3 0 0 0-2.6 0v4.7l-8 5v2l8-2.5V18l-2 1.5V21l3.3-1 3.3 1v-1.5l-2-1.5v-5z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" fill="none"/></svg>',
}
export const icon = (name, cls = 'ico') => h('span', { class: cls, html: ICONS[name] })
