#!/usr/bin/env node
/**
 * Builds the tiny static site published to GitHub Pages: mcplint's own HTML
 * report, run against both fixture servers, as a live "try it without
 * installing" demo. Requires `npm run build` to have already produced
 * dist/cli.js. Not part of the npm package — this is purely for Pages.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const run = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const siteDir = join(root, 'site');

const NAV = (active) => `
<nav style="font:13px ui-monospace,monospace;padding:10px 20px;border-bottom:1px solid #1f2a37;background:#0b0f14;color:#8b98a5;display:flex;gap:16px;align-items:center">
  <strong style="color:#e6edf3">mcplint live demo</strong>
  <a href="./index.html" style="color:${active === 'poisoned' ? '#35d0ba' : '#8b98a5'}">poisoned fixture</a>
  <a href="./good.html" style="color:${active === 'good' ? '#35d0ba' : '#8b98a5'}">well-behaved fixture</a>
  <a href="https://github.com/antonsoo/mcplint" style="margin-left:auto;color:#8b98a5">source &#8594;</a>
</nav>`;

// The report's own <title> names the linted command; the published demo gets a
// descriptive title plus link-preview metadata instead.
const SITE_URL = 'https://antonsoo.github.io/mcplint/';
const OG_IMAGE = 'https://raw.githubusercontent.com/antonsoo/mcplint/main/docs/assets/og.png';
const DESCRIPTION =
  "Lint your MCP server's tools the way the model sees them: token cost, clarity, and hidden instructions.";
const HEAD = (title) => `
<title>${title}</title>
<meta name="description" content="${DESCRIPTION}" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><rect width=%2232%22 height=%2232%22 rx=%226%22 fill=%22%230b0f14%22/><text x=%2216%22 y=%2222%22 font-family=%22monospace%22 font-size=%2218%22 text-anchor=%22middle%22 fill=%22%2335d0ba%22>[ ]</text></svg>" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${DESCRIPTION}" />
<meta property="og:url" content="${SITE_URL}" />
<meta property="og:image" content="${OG_IMAGE}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${OG_IMAGE}" />`;

async function buildReport(fixture, outFile, navKey, title) {
  // Relative paths only: the "target" field in the rendered report echoes the
  // command verbatim, and this output is published to GitHub Pages — an
  // absolute path here would leak this machine's home directory publicly.
  const cli = join('dist', 'cli.js');
  const server = join('examples', fixture, 'server.ts');
  const { stdout } = await run(
    process.execPath,
    [cli, 'stdio', '--format', 'html', '--', 'npx', 'tsx', server],
    { cwd: root, maxBuffer: 1024 * 1024 * 16 }
  );
  const withNav = stdout
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace('</head>', `${HEAD(title)}\n</head>`)
    .replace('<body>', `<body>${NAV(navKey)}`);
  await writeFile(join(siteDir, outFile), withNav, 'utf8');
  console.log(`wrote site/${outFile} (${withNav.length} bytes)`);
}

async function main() {
  await mkdir(siteDir, { recursive: true });
  await buildReport('poisoned-server', 'index.html', 'poisoned', 'mcplint · sample report on a deliberately poisoned MCP server');
  await buildReport('good-server', 'good.html', 'good', 'mcplint · sample report on a well-behaved MCP server');
  await writeFile(join(siteDir, '.nojekyll'), '');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
