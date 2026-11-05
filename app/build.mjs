#!/usr/bin/env node
/**
 * HELM 构建：把 app/src 拼成两个产物。
 *   1) app/dist/index.html   独立静态页（离线可开、可 headless 截图）
 *   2) plugin/client.js      DeepSeek Harness 客户端插件（__ModuleLoader__ 动态模块）
 * 零依赖：只用 node:fs / node:path。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const OUT_DIST = join(ROOT, 'dist');
const OUT_PLUGIN = join(ROOT, '..', 'plugin');

const JS_ORDER = [
  'dom.js',
  'scenario.js',
  'engine.js',
  'view-fleet.js',
  'view-mission.js',
  'view-panels.js',
  'main.js',
];
const CSS_ORDER = ['tokens.css', 'app.css'];
const JS_OPTIONAL = new Set(['view-fleet.js', 'view-mission.js', 'view-panels.js']);

const read = (p) => readFileSync(p, 'utf8');
const exists = (p) => { try { readFileSync(p); return true; } catch { return false; } };

const css = CSS_ORDER.map((f) => `/* ${f} */\n` + read(join(SRC, f))).join('\n');

const missing = [];
const jsParts = [];
for (const file of JS_ORDER) {
  const p = join(SRC, file);
  if (!exists(p)) {
    if (JS_OPTIONAL.has(file)) { missing.push(file); jsParts.push(`/* ${file} 尚未产出 */`); continue; }
    throw new Error(`缺少源文件：${p}`);
  }
  jsParts.push(`// ===== ${file} =====\n` + read(p));
}
const js = jsParts.join('\n');

/** 源码包在一个 IIFE 里，产物和插件共用同一份字节。 */
function bundle({ exportName }) {
  return `(function () {\n'use strict';\nconst HELM_CSS_TEXT = ${JSON.stringify(css)};\n${js}\n;globalThis[${JSON.stringify(exportName)}] = { mount: mountHelm };\n})();`;
}

mkdirSync(OUT_DIST, { recursive: true });
mkdirSync(OUT_PLUGIN, { recursive: true });

/* ---------- 1. 独立静态页 ---------- */
const code = bundle({ exportName: 'Helm' });
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HELM · Agent 任务驾驶舱</title>
<style>
  html, body { margin: 0; height: 100%; background: #0c0e10; }
  #helm-host { position: fixed; inset: 0; }
</style>
</head>
<body>
<div id="helm-host"></div>
<script>
${code}
Helm.mount(document.getElementById('helm-host'), { mode: 'standalone' });
</script>
</body>
</html>
`;
writeFileSync(join(OUT_DIST, 'index.html'), html);
writeFileSync(join(OUT_DIST, 'helm.bundle.js'), code);

/* ---------- 2. Harness 客户端插件 ---------- */
const pluginClient = `/**
 * HELM · DeepSeek Harness 客户端插件（由 app/build.mjs 生成，不要手改）。
 * 一个入口按钮 + 一块全屏驾驶舱。驾驶舱为原生 DOM，挂载在 document.body 上。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-helm',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

${code.replace(/^\(function \(\) \{\n/, '(function () {\n').replace(/\n\}\)\(\);$/, '\n})();')}

    const NS = 'helm';
    const zh = { entry: '驾驶舱', entryHint: '打开 HELM 任务驾驶舱' };
    const en = { entry: 'Cockpit', entryHint: 'Open the HELM mission cockpit' };

    let current = null;

    function openHelm() {
      if (current) return;
      const host = document.createElement('div');
      host.className = 'helm-plugin-host';
      host.style.position = 'fixed';
      host.style.inset = '0';
      host.style.zIndex = '1300';
      document.body.appendChild(host);
      current = globalThis.Helm.mount(host, {
        mode: 'plugin',
        onClose: () => closeHelm(),
      });
    }

    function closeHelm() {
      if (!current) return;
      try { current.dispose(); } catch (error) { console.error('[helm] dispose failed', error); }
      const host = document.querySelector('.helm-plugin-host');
      if (host) host.remove();
      current = null;
    }

    function EntryButton() {
      return h('button', {
        type: 'button',
        className: 'helm-entry-btn',
        title: zh.entryHint,
        'aria-label': zh.entry,
        onClick: openHelm,
      }, h('span', { className: 'helm-entry-btn__icon', html: HELM_ICON }));
    }

    const HELM_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.4"/><path d="M12 3.5v5.6M12 14.9v5.6M3.5 12h5.6M14.9 12h5.6M6 6l3.4 3.4M14.6 14.6L18 18M18 6l-3.4 3.4M9.4 14.6L6 18"/></svg>';

    function installStyles() {
      const style = document.createElement('style');
      style.dataset.plugin = '@local/dsh-helm';
      style.textContent = [
        '.helm-entry-btn{display:flex;align-items:center;justify-content:center;flex:0 0 26px;width:26px;height:26px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
        '.helm-entry-btn:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.06));color:var(--dsw-alias-label-primary)}',
        '.helm-entry-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
        '.helm-entry-btn__icon{display:grid;place-items:center}',
      ].join('\\n');
      document.head.appendChild(style);
      return () => style.remove();
    }

    function apply(ctx) {
      ctx.effect(() => installStyles(), 'helm: styles');
      const slots = ctx.get('slots');
      ctx.effect(() => slots.inject('conversation.input.left', () => slots.register({
        name: 'conversation.input.left',
        id: 'helm-entry',
        order: 32,
        label: () => zh.entryHint,
        inject: () => ({ open: openHelm }),
      }, EntryButton)), 'helm: composer entry');
    }

    return { name: '@local/dsh-helm', inject: ['slots'], apply };
  },
});
`;

writeFileSync(join(OUT_PLUGIN, 'client.js'), pluginClient);

/* ---------- 报告 ---------- */
const report = [];
report.push(`✅ dist/index.html  ${(html.length / 1024).toFixed(1)} KB`);
report.push(`✅ dist/helm.bundle.js  ${(code.length / 1024).toFixed(1)} KB`);
report.push(`✅ plugin/client.js  ${(pluginClient.length / 1024).toFixed(1)} KB`);
if (missing.length) report.push(`⚠️  尚未产出的视图：${missing.join(', ')}（产物可运行，但对应栏位为空）`);
report.push(`   CSS 合计 ${(css.length / 1024).toFixed(1)} KB`);
console.log(report.join('\n'));
