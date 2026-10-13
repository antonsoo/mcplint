import { createHash } from 'node:crypto';
import { visibleControls } from '../core/unicode.js';
import type { MetadataComparison } from '../core/metadata.js';
import { CSS, THEME_SCRIPT } from './html.js';
import { metadataVerdict } from './metadata.js';

const SCRIPT = String.raw`
(function () {
  'use strict';
  const data = JSON.parse(document.getElementById('metadata-data').textContent);
  const visible = (text, lines = false) => String(text).replace(/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, ch => lines && (ch === '\n' || ch === '\t') ? ch : '\\u{' + ch.codePointAt(0).toString(16) + '}');
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = visible(text);
    if (className) node.className = className;
    return node;
  }
  function button(text, action) {
    const node = el('button', text); node.type = 'button'; node.addEventListener('click', action); return node;
  }
  function paged(items, size, label, draw) {
    const box = el('div'); let page = 0;
    const content = el('div'), controls = el('div', undefined, 'md-pages'), status = el('span');
    const previous = button('Previous', () => { page--; render(); }); previous.setAttribute('aria-label', 'Previous ' + label);
    const next = button('Next', () => { page++; render(); }); next.setAttribute('aria-label', 'Next ' + label);
    status.setAttribute('aria-live', 'polite');
    controls.append(previous, status, next); box.append(content, controls);
    function render() {
      content.replaceChildren(...items.slice(page * size, (page + 1) * size).map(draw));
      status.textContent = items.length ? (page * size + 1) + '-' + Math.min(items.length, (page + 1) * size) + ' of ' + items.length : '0 of 0';
      previous.disabled = page === 0; next.disabled = (page + 1) * size >= items.length;
      controls.hidden = items.length <= size;
    }
    render(); return box;
  }
  function valueCell(label, value) {
    const cell = el('div', undefined, 'md-value'); cell.append(el('h4', label));
    const full = value.present ? JSON.stringify(value.value, null, 2) : '(absent)';
    const pre = el('pre'); pre.textContent = visible(full.slice(0, 6000), true); cell.append(pre);
    if (full.length > 6000) cell.append(el('p', 'Preview: first 6,000 of ' + full.length + ' characters. Download JSON for the complete value.', 'muted'));
    return cell;
  }
  function card(change, index) {
    const item = el('details', undefined, 'md-card');
    const summary = el('summary');
    summary.append(el('span', change.status.toUpperCase(), 'md-status status-' + change.status),
      el('strong', change.identity), el('span', change.serverId + ' / ' + change.scope + ' / ' + change.fields.length + ' changed fields', 'muted'));
    item.append(summary);
    let built = false;
    item.addEventListener('toggle', () => {
      if (!item.open || built) return; built = true;
      item.append(paged(change.fields, 10, 'fields for ' + change.identity, field => {
        const row = el('section', undefined, 'md-field'); row.append(el('h3', field.pointer || '(whole definition)', 'mono'));
        const pair = el('div', undefined, 'md-pair'); pair.append(valueCell('Before', field.before), valueCell('After', field.after)); row.append(pair); return row;
      }));
    });
    if (index === 0) item.open = true;
    return item;
  }
  const list = document.getElementById('changes');
  const query = document.getElementById('query'), filter = document.getElementById('status-filter');
  const searchable = data.changes.map(change => (change.serverId + '\n' + change.scope + '\n' + change.identity + '\n' + change.fields.map(f => f.pointer).join('\n')).toLowerCase());
  function render() {
    const text = query.value.toLowerCase();
    const rows = data.changes.filter((change, index) => (filter.value === 'all' || change.status === filter.value) && searchable[index].includes(text));
    document.getElementById('results').textContent = rows.length + ' of ' + data.changes.length + ' changed entries shown';
    list.replaceChildren(rows.length ? paged(rows, 20, 'changed entries', card) : el('p', data.changes.length ? 'No changes match these filters.' : data.complete ? 'No recorded metadata changes.' : 'No comparable changes were observed. Collection gaps remain unresolved.'));
  }
  query.addEventListener('input', render); filter.addEventListener('change', render); render();
  const issues = document.getElementById('issues');
  for (const issue of data.issues) issues.append(el('li', issue));
  const coverage = document.getElementById('coverage');
  coverage.append(paged(['before', 'after'].flatMap(side => data.coverage[side].map(record => ({ side, record }))), 20, 'coverage records', entry => {
    const row = el('div', undefined, 'md-coverage'); const r = entry.record;
    row.append(el('strong', entry.side + ': ' + r.serverId + ' / ' + r.scope),
      el('p', r.status + ' / ' + r.pages + ' pages / ' + r.received + ' received / ' + r.retained + ' retained'),
      el('p', r.detail || '', 'muted')); return row;
  }));
  for (const note of data.notes) document.getElementById('notes').append(el('li', note));
  document.getElementById('download').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'mcplint-metadata-diff.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
})();
`;

const DIFF_CSS = `
.md-header { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; margin-bottom:24px; }
.md-header h1 { margin:0; font:600 20px var(--mono); }
.md-title { font-size:28px; line-height:1.25; margin:0 0 12px; }
.md-subtitle { max-width:75ch; color:var(--text-muted); }
.md-stats { display:flex; flex-wrap:wrap; gap:12px 24px; padding:18px 0; border-block:1px solid var(--border); margin:24px 0; font-family:var(--mono); }
.md-controls { display:flex; flex-wrap:wrap; gap:16px; align-items:end; }
.md-controls label { display:flex; flex-direction:column; gap:4px; flex:1; min-width:160px; }
.md-controls label:first-child { flex:3; }
button,input,select { background:var(--bg-elevated); color:var(--text); border:1px solid var(--text-muted); border-radius:4px; padding:8px 10px; font:inherit; max-width:100%; }
button { cursor:pointer; } button:disabled { opacity:.6; cursor:default; }
input:focus-visible,select:focus-visible,summary:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
.md-card { margin:14px 0; border:1px solid var(--border); background:var(--bg-elevated); border-radius:6px; overflow:hidden; }
.md-card>summary { padding:14px 16px; cursor:pointer; overflow-wrap:anywhere; }
.md-card>summary strong { font-family:var(--mono); }
.md-card>summary .muted { display:block; font-size:12px; margin-top:4px; }
.md-status { display:inline-block; font:600 11px var(--mono); letter-spacing:.06em; margin-right:12px; }
.status-added { color:var(--ok); } .status-removed { color:var(--error); } .status-changed { color:var(--warning); }
.md-field { padding:0 16px 18px; border-top:1px solid var(--border); }
.md-field h3 { font-size:13px; overflow-wrap:anywhere; }
.md-pair { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; }
.md-value { min-width:0; padding:12px; background:var(--bg-inset); border-radius:4px; }
.md-value h4 { margin:0 0 10px; font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--text-muted); }
.md-value pre { white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.6 var(--mono); margin:0; }
.md-value p { font-size:12px; }
.md-pages { display:flex; gap:12px; align-items:center; justify-content:space-between; padding:12px 16px; }
.md-pages[hidden] { display:none; }
.md-coverage { border-bottom:1px solid var(--border); padding:10px 0; overflow-wrap:anywhere; }
.md-coverage p { margin:3px 0; }
.md-evidence { margin-top:28px; } .md-evidence>summary { cursor:pointer; font-weight:600; }
.md-capture { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:20px; }
.md-capture code { font-size:11px; overflow-wrap:anywhere; }
.md-issues { border-left:4px solid var(--error); padding:14px 18px; margin:20px 0; background:var(--bg-elevated); overflow-wrap:anywhere; }
.md-issues h2 { margin:0; font-size:18px; } .md-issues ul { padding-left:20px; }
#notes { padding-left:20px; } #notes li { margin:8px 0; }
@media(max-width:600px) { .page { padding:16px 14px 40px; } .md-title { font-size:24px; } .md-pair,.md-capture { grid-template-columns:1fr; } .md-stats { gap:12px 16px; font-size:13px; } }
`;

const escapeHtml = (text: string): string => visibleControls(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function renderMetadataHtml(result: MetadataComparison): string {
  // Data is inert JSON; every value later enters the DOM through textContent.
  const data = JSON.stringify(result).replaceAll('<', '\\u003c');
  const csp = ["default-src 'none'", "style-src 'unsafe-inline'",
    `script-src ${[THEME_SCRIPT, SCRIPT].map(script => `'sha256-${createHash('sha256').update(script).digest('base64')}'`).join(' ')}`,
    "base-uri 'none'", "form-action 'none'"].join('; ');
  const s = result.summary;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}"><title>mcplint metadata comparison</title><style>${CSS}\n${DIFF_CSS}</style></head>
<body><div class="page"><header class="md-header"><h1>[mcplint] metadata review</h1><button id="theme-toggle" type="button">Toggle color theme</button></header>
<main><h2 class="md-title">${metadataVerdict(result)}</h2><p class="md-subtitle">Review the definitions and instructions collected before and after an update. A metadata comparison does not establish server behavior or safety.</p>
<div class="md-stats"><span>${s.added} added</span><span>${s.removed} removed</span><span>${s.changed} changed</span><span>${s.unchanged} unchanged</span><span>${s.unpaired} unpaired</span></div>
${result.complete ? '' : '<section class="md-issues"><h2>Collection or identity gaps</h2><ul id="issues"></ul></section>'}
${result.complete ? '<ul id="issues" hidden></ul>' : ''}
<div class="md-controls"><label>Find a definition or changed path<input type="search" id="query" autocomplete="off"></label><label>Change type<select id="status-filter"><option value="all">All changes</option><option value="changed">Changed</option><option value="added">Added</option><option value="removed">Removed</option></select></label><button id="download" type="button">Download complete JSON</button></div>
<p id="results" class="muted" aria-live="polite"></p><div id="changes"></div>
<details class="md-evidence"><summary>Collection coverage</summary><div id="coverage"></div></details>
<details class="md-evidence"><summary>Snapshot identities and comparison rules</summary>
<div class="md-capture"><div><h3>Before</h3><p>${escapeHtml(result.before.createdAt)}</p><code>${escapeHtml(result.before.sha256)}</code></div><div><h3>After</h3><p>${escapeHtml(result.after.createdAt)}</p><code>${escapeHtml(result.after.sha256)}</code></div></div><ul id="notes"></ul>
<p class="muted">Control and invisible formatting characters are escaped in previews. Values over 6,000 characters are previewed; downloads retain original values.</p></details>
<noscript><p>This interactive report requires JavaScript. Generate --format json or --format terminal for a script-free report.</p></noscript>
</main></div><script type="application/json" id="metadata-data">${data}</script><script>${THEME_SCRIPT}</script><script>${SCRIPT}</script></body></html>`;
}
