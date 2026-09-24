import type { Finding, LintResult, Severity } from '../core/types.js';
import { topOffenders } from '../core/lint.js';
import { ruleSlug } from '../core/rule-slug.js';
import { rulesById } from '../core/rules/index.js';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function scoreBand(score: number): 'good' | 'mid' | 'bad' {
  if (score >= 85) return 'good';
  if (score >= 60) return 'mid';
  return 'bad';
}

function groupBySubject(findings: Finding[]): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = `${f.subject.kind}:${f.subject.name}:${f.serverId}`;
    const list = map.get(key) ?? [];
    list.push(f);
    map.set(key, list);
  }
  return map;
}

function worstSeverity(findings: Finding[]): Severity {
  if (findings.some((f) => f.severity === 'error')) return 'error';
  if (findings.some((f) => f.severity === 'warning')) return 'warning';
  return 'info';
}

/** Renders the U+XXXX hex-strip + decoded terminal box for hidden-unicode findings. */
function hiddenUnicodeDetail(detail: string): string {
  const tokens = detail
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `<span class="cp">${esc(t)}</span>`)
    .join('');
  return `<div class="hexstrip">${tokens}</div>`;
}

function findingRow(f: Finding): string {
  const rule = rulesById.get(f.ruleId);
  const docHref = `https://github.com/antonsoo/mcplint/blob/main/docs/rules/${ruleSlug(f.ruleId)}.md`;
  const isHiddenUnicode = f.ruleId === 'safety/hidden-unicode' && f.detail;
  return `
    <li class="finding sev-${f.severity}">
      <div class="finding-head">
        <span class="sev-chip sev-${f.severity}">${f.severity}</span>
        <a class="rule-id" href="${docHref}" title="${rule ? esc(rule.summary) : ''}" target="_blank" rel="noopener">${esc(f.ruleId)}</a>
      </div>
      <p class="finding-msg">${esc(f.message)}</p>
      ${isHiddenUnicode ? hiddenUnicodeDetail(f.detail!) : f.detail ? `<pre class="detail">${esc(f.detail)}</pre>` : ''}
      ${f.suggestion ? `<p class="suggestion"><span class="arrow">&#8594;</span> ${esc(f.suggestion)}</p>` : ''}
    </li>`;
}

function subjectCard(key: string, findings: Finding[]): string {
  const first = findings[0]!;
  const worst = worstSeverity(findings);
  const sorted = [...findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  return `
  <article class="subject sev-${worst}" id="s-${esc(cssId(key))}">
    <header class="subject-head">
      <span class="dot sev-${worst}"></span>
      <h3>${esc(first.subject.name)}</h3>
      <span class="tag">${esc(first.subject.kind)}</span>
      <span class="tag muted">${esc(first.serverId)}</span>
      <span class="count">${findings.length} finding${findings.length === 1 ? '' : 's'}</span>
    </header>
    <ul class="findings">
      ${sorted.map(findingRow).join('')}
    </ul>
  </article>`;
}

function severityRank(s: Severity): number {
  return s === 'error' ? 0 : s === 'warning' ? 1 : 2;
}

function cssId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function scoreRing(score: number): string {
  const r = 52;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - score / 100);
  return `
  <svg class="ring" width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Score ${score} out of 100">
    <circle class="ring-track" cx="70" cy="70" r="${r}" />
    <circle class="ring-fill" cx="70" cy="70" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${offset}" />
    <text x="70" y="66" class="ring-score">${score}</text>
    <text x="70" y="88" class="ring-label">/ 100</text>
  </svg>`;
}

function offendersChart(result: LintResult): string {
  const offenders = topOffenders(result, 8).filter((o) => o.tokens > 0);
  if (offenders.length === 0) return '<p class="muted">No tools collected.</p>';
  const max = Math.max(...offenders.map((o) => o.tokens), result.config.budget);
  return `
  <div class="bars">
    ${offenders
      .map((o) => {
        const pct = Math.min(100, (o.tokens / max) * 100);
        const over = o.tokens > result.config.budget;
        return `
      <div class="bar-row">
        <span class="bar-label" title="${esc(o.name)}">${esc(o.name)}</span>
        <div class="bar-track">
          <div class="bar-fill ${over ? 'over' : ''}" style="width:${pct}%"></div>
        </div>
        <span class="bar-value">${o.tokens}</span>
      </div>`;
      })
      .join('')}
    <div class="budget-note">budget: ${result.config.budget} tokens/tool &middot; bars over budget shown in amber</div>
  </div>`;
}

export function renderHtml(result: LintResult): string {
  const { summary } = result;
  const targetLabel = result.target.servers.map((s) => s.label).join(', ') || 'unknown target';
  const bySubject = groupBySubject(result.findings);
  const sortedKeys = [...bySubject.keys()].sort((a, b) => {
    const wa = severityRank(worstSeverity(bySubject.get(a)!));
    const wb = severityRank(worstSeverity(bySubject.get(b)!));
    return wa - wb || a.localeCompare(b);
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mcplint report — ${esc(targetLabel)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="page">
  <header class="topbar">
    <div class="brand"><span class="bracket">[</span>mcplint<span class="bracket">]</span></div>
    <div class="target" title="${esc(targetLabel)}">${esc(targetLabel)}</div>
    <div class="meta">${esc(result.generatedAt)}</div>
    <button class="theme-toggle" id="theme-toggle" aria-label="Toggle color theme" type="button">
      <svg class="icon-sun" viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      <svg class="icon-moon" viewBox="0 0 24 24" width="16" height="16"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>
    </button>
  </header>

  <section class="hero">
    <div class="score-block">
      ${scoreRing(summary.score)}
      <div class="score-band sev-${scoreBand(summary.score)}-text">${scoreBand(summary.score) === 'good' ? 'clean' : scoreBand(summary.score) === 'mid' ? 'needs work' : 'poor'}</div>
    </div>
    <div class="stat-grid">
      <div class="stat"><span class="stat-value">${result.target.servers.length}</span><span class="stat-label">servers</span></div>
      <div class="stat"><span class="stat-value">${summary.toolCount}</span><span class="stat-label">tools</span></div>
      <div class="stat"><span class="stat-value">${summary.promptCount}</span><span class="stat-label">prompts</span></div>
      <div class="stat"><span class="stat-value">${summary.resourceCount}</span><span class="stat-label">resources</span></div>
      <div class="stat"><span class="stat-value">~${summary.totalEstimatedTokens}</span><span class="stat-label">est. tokens</span></div>
      <div class="stat sev-error-text"><span class="stat-value">${summary.bySeverity.error}</span><span class="stat-label">errors</span></div>
      <div class="stat sev-warning-text"><span class="stat-value">${summary.bySeverity.warning}</span><span class="stat-label">warnings</span></div>
      <div class="stat sev-info-text"><span class="stat-value">${summary.bySeverity.info}</span><span class="stat-label">info</span></div>
    </div>
  </section>

  <section class="panel">
    <h2>Token budget<span class="hint">${esc(result.tokenizerName)} estimate</span></h2>
    ${offendersChart(result)}
  </section>

  <section class="panel">
    <h2>Findings<span class="hint">${result.findings.length} total, grouped by tool / prompt / resource</span></h2>
    ${
      sortedKeys.length === 0
        ? '<p class="empty">No findings. This target is clean against the configured rules and budget.</p>'
        : `<div class="subjects">${sortedKeys.map((k) => subjectCard(k, bySubject.get(k)!)).join('')}</div>`
    }
  </section>

  <footer class="footer">
    Generated by <a href="https://github.com/antonsoo/mcplint">mcplint</a> · rules documented in <code>docs/rules/</code>
  </footer>
</div>
<script>
(function () {
  var STORAGE_KEY = 'mcplint-theme';
  var root = document.documentElement;
  var toggle = document.getElementById('theme-toggle');
  function apply(theme) {
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
  }
  var saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
  apply(saved);
  if (toggle) {
    toggle.addEventListener('click', function () {
      var current = root.getAttribute('data-theme') ||
        (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      var next = current === 'dark' ? 'light' : 'dark';
      apply(next);
      try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
    });
  }
})();
</script>
</body>
</html>`;
}

const CSS = `
:root {
  --bg: #0b0f14;
  --bg-elevated: #121821;
  --bg-inset: #0e141c;
  --border: #1f2a37;
  --text: #e6edf3;
  --text-muted: #8b98a5;
  --accent: #35d0ba;
  --error: #ff6b6b;
  --warning: #f5a623;
  --info: #4ea1ff;
  --ok: #35d399;
  --mono: ui-monospace, "SFMono-Regular", "IBM Plex Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --sans: ui-sans-serif, -apple-system, "Segoe UI", "IBM Plex Sans", Roboto, Helvetica, Arial, sans-serif;
  color-scheme: dark;
}
:root[data-theme="light"] {
  --bg: #f7f8fa;
  --bg-elevated: #ffffff;
  --bg-inset: #eef1f4;
  --border: #dce3e9;
  --text: #0e1620;
  --text-muted: #5b6b7a;
  --accent: #0f8f7d;
  --error: #d1373f;
  --warning: #a8660c;
  --info: #1f6fd1;
  --ok: #17875a;
  color-scheme: light;
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    --bg: #f7f8fa;
    --bg-elevated: #ffffff;
    --bg-inset: #eef1f4;
    --border: #dce3e9;
    --text: #0e1620;
    --text-muted: #5b6b7a;
    --accent: #0f8f7d;
    --error: #d1373f;
    --warning: #a8660c;
    --info: #1f6fd1;
    --ok: #17875a;
    color-scheme: light;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); }
code, .mono { font-family: var(--mono); }
.page { max-width: 960px; margin: 0 auto; padding: 20px 20px 60px; }

.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0 18px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 24px;
  flex-wrap: wrap;
}
.brand { font-family: var(--mono); font-weight: 700; font-size: 16px; letter-spacing: 0.02em; }
.brand .bracket { color: var(--accent); }
.target {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--text-muted);
  background: var(--bg-inset);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 8px;
  max-width: 40ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta { font-family: var(--mono); font-size: 12px; color: var(--text-muted); margin-left: auto; }
.theme-toggle {
  background: var(--bg-inset);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  width: 30px; height: 30px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.theme-toggle:hover { border-color: var(--accent); }
.theme-toggle svg { stroke: currentColor; fill: none; stroke-width: 1.6; stroke-linecap: round; }
.theme-toggle .icon-moon { display: none; }
:root[data-theme="light"] .theme-toggle .icon-sun { display: none; }
:root[data-theme="light"] .theme-toggle .icon-moon { display: block; }
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) .theme-toggle .icon-sun { display: none; }
  :root:not([data-theme="dark"]) .theme-toggle .icon-moon { display: block; }
}

.hero {
  display: flex;
  align-items: center;
  gap: 32px;
  flex-wrap: wrap;
  margin-bottom: 28px;
}
.score-block { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.ring { transform: rotate(-90deg); }
.ring-track { fill: none; stroke: var(--border); stroke-width: 10; }
.ring-fill { fill: none; stroke: var(--accent); stroke-width: 10; stroke-linecap: round; transition: stroke-dashoffset 0.6s ease; }
.ring-score { transform: rotate(90deg); transform-origin: 70px 70px; font-family: var(--mono); font-size: 34px; font-weight: 700; fill: var(--text); text-anchor: middle; }
.ring-label { transform: rotate(90deg); transform-origin: 70px 70px; font-family: var(--mono); font-size: 11px; fill: var(--text-muted); text-anchor: middle; }
.score-band { font-family: var(--mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }

.stat-grid { display: grid; grid-template-columns: repeat(4, auto); gap: 18px 28px; flex: 1; min-width: 260px; }
.stat { display: flex; flex-direction: column; }
.stat-value { font-family: var(--mono); font-size: 22px; font-weight: 700; }
.stat-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; }

.panel {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 18px 20px;
  margin-bottom: 20px;
}
.panel h2 { margin: 0 0 14px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; display: flex; align-items: baseline; gap: 10px; }
.panel h2 .hint { font-size: 11px; text-transform: none; letter-spacing: 0; color: var(--text-muted); font-weight: 400; }

.bars { display: flex; flex-direction: column; gap: 8px; }
.bar-row { display: grid; grid-template-columns: 14ch 1fr 6ch; align-items: center; gap: 10px; font-family: var(--mono); font-size: 12px; }
.bar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); }
.bar-track { background: var(--bg-inset); border-radius: 4px; height: 10px; overflow: hidden; }
.bar-fill { height: 100%; background: var(--accent); border-radius: 4px; }
.bar-fill.over { background: var(--warning); }
.bar-value { text-align: right; }
.budget-note { font-size: 11px; color: var(--text-muted); margin-top: 6px; }

.subjects { display: flex; flex-direction: column; gap: 14px; }
.subject { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.subject-head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; background: var(--bg-inset); border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.subject-head h3 { margin: 0; font-size: 14px; font-family: var(--mono); }
.dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.dot.sev-error { background: var(--error); }
.dot.sev-warning { background: var(--warning); }
.dot.sev-info { background: var(--info); }
.tag { font-size: 11px; color: var(--text-muted); border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px; }
.tag.muted { opacity: 0.75; }
.count { margin-left: auto; font-size: 11px; color: var(--text-muted); font-family: var(--mono); }

.findings { list-style: none; margin: 0; padding: 0; }
.finding { padding: 12px 14px; border-left: 3px solid transparent; border-top: 1px solid var(--border); }
.finding:first-child { border-top: none; }
.finding.sev-error { border-left-color: var(--error); }
.finding.sev-warning { border-left-color: var(--warning); }
.finding.sev-info { border-left-color: var(--info); }
.finding-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap; }
.sev-chip { font-family: var(--mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; padding: 1px 6px; border-radius: 4px; }
.sev-chip.sev-error { color: var(--error); background: color-mix(in srgb, var(--error) 16%, transparent); }
.sev-chip.sev-warning { color: var(--warning); background: color-mix(in srgb, var(--warning) 16%, transparent); }
.sev-chip.sev-info { color: var(--info); background: color-mix(in srgb, var(--info) 16%, transparent); }
.rule-id { font-family: var(--mono); font-size: 12px; text-decoration: none; }
.rule-id:hover { text-decoration: underline; }
.finding-msg { margin: 0 0 4px; }
.suggestion { margin: 6px 0 0; color: var(--text-muted); font-size: 13px; font-style: italic; }
.suggestion .arrow { color: var(--accent); font-style: normal; margin-right: 2px; }
.detail { margin: 6px 0 0; padding: 8px 10px; background: var(--bg-inset); border: 1px solid var(--border); border-radius: 6px; font-size: 12px; white-space: pre-wrap; word-break: break-word; }

.hexstrip { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0 0; padding: 8px; background: var(--bg-inset); border: 1px solid var(--border); border-radius: 6px; }
.hexstrip .cp { font-family: var(--mono); font-size: 11px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 3px; padding: 2px 5px; color: var(--accent); }

.sev-error-text { color: var(--error); }
.sev-warning-text { color: var(--warning); }
.sev-info-text { color: var(--info); }
.sev-good-text { color: var(--ok); }
.sev-mid-text { color: var(--warning); }
.sev-bad-text { color: var(--error); }

.empty { color: var(--text-muted); }
.muted { color: var(--text-muted); }

.footer { text-align: center; color: var(--text-muted); font-size: 12px; margin-top: 30px; }

@media (max-width: 480px) {
  .stat-grid { grid-template-columns: repeat(2, auto); }
  .hero { gap: 20px; }
  .bar-row { grid-template-columns: 9ch 1fr 4ch; }
}

*:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
`;
