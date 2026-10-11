// node studies/enum-values/capture.mjs CLI_PATH [--check] > receipt.json
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
const cli = resolve(process.argv[2]);
const require = createRequire(cli);
const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')));
const { StdioClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')));
const fixtureServer = fileURLToPath(new URL('server.mjs', import.meta.url));
const fixtures = JSON.parse(await readFile(new URL('fixtures.json', import.meta.url), 'utf8'));
const scratch = await mkdtemp(join(tmpdir(), 'mcplint-enums-'));
const results = [];
try {
  for (const fixture of fixtures) {
    const file = join(scratch, `${fixture.name}.json`);
    await writeFile(file, JSON.stringify({ tools: fixture.tools }));
    const client = new Client({ name: 'enum-study', version: '1' });
    let sdkTools;
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [fixtureServer, cli, file] }));
      sdkTools = (await client.listTools()).tools;
    } finally { await client.close(); }
    for (const transport of ['file', 'stdio']) {
      const common = ['--format', 'json', '--fail-on', 'error'];
      const args = transport === 'file' ? ['file', file, ...common]
        : ['stdio', ...common, '--', process.execPath, fixtureServer, cli, file];
      const run = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
      if (!run.stdout) throw run.error ?? new Error(run.stderr);
      const report = JSON.parse(run.stdout);
      const findings = report.findings.filter(f => f.ruleId === 'description/enum-unexplained');
      const checks = {
        strictSDKRetainsAllChoices: isDeepStrictEqual(sdkTools, fixture.tools),
        complete: report.summary.complete,
        toolsRetained: report.summary.toolCount === fixture.tools.length,
        enumFindings: JSON.stringify(findings.map(f => f.subject.name).sort()) === JSON.stringify([...fixture.expectedEnumTools].sort()),
        noSpuriousSchemaError: !report.findings.some(f => f.ruleId === 'schema/invalid' || f.ruleId === 'safety/unchecked'),
        safetyStillInspectsStructuredValues: report.findings.some(f => f.ruleId === 'safety/secret-access') === fixture.expectedSafety,
        exitCode: run.status === (fixture.expectedSafety ? 1 : 0),
      };
      results.push({ case: `${transport}/${fixture.name}`, code: run.status, summary: report.summary,
        findings: report.findings, checks, agrees: Object.values(checks).every(Boolean) });
    }
  }
  const receipt = { node: process.version, scope: 'Controlled metadata, actual SDK server/client and CLI. Only tools/list is called; schemas are independently checked by schema-oracle.py.',
    cases: results.length, disagreements: results.filter(row => !row.agrees).length, results };
  console.log(JSON.stringify(receipt, null, 2));
  if (process.argv.includes('--check') && receipt.disagreements) process.exitCode = 1;
} finally { await rm(scratch, { recursive: true, force: true }); }
