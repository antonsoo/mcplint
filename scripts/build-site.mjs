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

async function buildReport(fixture, outFile, navKey) {
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
  const withNav = stdout.replace('<body>', `<body>${NAV(navKey)}`);
  await writeFile(join(siteDir, outFile), withNav, 'utf8');
  console.log(`wrote site/${outFile} (${withNav.length} bytes)`);
}

async function main() {
  await mkdir(siteDir, { recursive: true });
  await buildReport('poisoned-server', 'index.html', 'poisoned');
  await buildReport('good-server', 'good.html', 'good');
  await writeFile(join(siteDir, '.nojekyll'), '');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
