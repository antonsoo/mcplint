import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { CollectionRecord, LintSummary, Finding } from '../../src/core/types.js';

const dir = mkdtempSync(join(tmpdir(), 'mcplint-cli-coverage-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const fixture = resolve('tests/fixtures/servers/collection-evidence.mjs');
const cli = resolve('dist/cli.js');
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
interface Report { servers: { id: string }[]; summary: LintSummary; findings: Finding[]; collection: CollectionRecord[] }

describe('built CLI coverage over real stdio', () => {
  it.each(['failed', 'partial', 'loop', 'missing', 'malformed'])('rejects %s collection with retained JSON evidence', mode => {
    const result = run('stdio', '--format', 'json', '--fail-on', 'error', '--', process.execPath, fixture, mode);
    expect(result.status, result.stderr).toBe(1);
    const report = JSON.parse(result.stdout) as Report;
    expect(report.summary.complete).toBe(false);
    expect(report.summary.score).toBeNull();
    expect(report.collection.find(r => r.scope === 'tools/list')?.status).toBe('incomplete');
    expect(report.findings.some(f => f.ruleId === 'collection/incomplete')).toBe(true);
    expect(result.stdout).not.toContain('PRIVATE_ERROR_VALUE');
    if (mode === 'partial') expect(report.summary.toolCount).toBe(1);
    if (mode === 'malformed') expect(report.findings.some(f => f.ruleId === 'safety/secret-access')).toBe(true);
  });
  it.each(['good', 'empty', 'unsupported'])('accepts %s with its explicit scope', mode => {
    const log = join(dir, `${mode}.log`);
    const result = run('stdio', '--format', 'json', '--fail-on', 'warning', '--', process.execPath, fixture, mode, log);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as Report;
    expect(report.summary.complete).toBe(true);
    expect(report.summary.score).toBe(100);
    const requests = readFileSync(log, 'utf8').trim().split('\n');
    expect(requests).toEqual(['initialize', 'notifications/initialized', ...(mode === 'unsupported' ? [] : ['tools/list'])]);
  });
  it.each(['terminal', 'markdown', 'html', 'sarif'])('shows incomplete scope in %s output while retaining findings', format => {
    const result = run('stdio', '--format', format, '--fail-on', 'warning', '--', process.execPath, fixture, 'partial');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('collection/incomplete');
    if (format === 'sarif') {
      const sarif = JSON.parse(result.stdout) as { runs: { invocations: { executionSuccessful: boolean }[] }[] };
      expect(sarif.runs[0]?.invocations[0]?.executionSuccessful).toBe(false);
    } else expect(result.stdout).toContain('Incomplete audit');
  });
  it('keeps gaps visible and gated even when their diagnostic is suppressed', () => {
    const result = run('stdio', '--format', 'json', '--ignore', 'collection/incomplete', '--fail-on', 'error', '--', process.execPath, fixture, 'failed');
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as Report;
    expect(report.findings).toHaveLength(0);
    expect(report.summary.complete).toBe(false);
    expect(report.summary.score).toBeNull();
  });
  it('retains mixed config servers, including unavailable, unresolved, invalid and disabled entries', () => {
    const path = join(dir, 'mixed.json');
    writeFileSync(path, JSON.stringify({ servers: {
      healthy: { command: process.execPath, args: [fixture, 'good'] },
      broken: { command: '/nonexistent-mcplint-test-command' },
      unresolved: { command: '${input:missing}' }, invalid: null, disabled: { disabled: true }
    } }));
    const result = run('config', path, '--format', 'json', '--fail-on', 'error');
    expect(result.status, result.stderr).toBe(1);
    const report = JSON.parse(result.stdout) as Report;
    expect(report.servers.map(s => s.id).sort()).toEqual(['broken', 'disabled', 'healthy', 'invalid', 'unresolved']);
    expect(report.summary.toolCount).toBe(1);
    expect(report.collection.filter(r => r.status === 'incomplete')).toHaveLength(3);
    expect(report.collection.filter(r => r.status === 'disabled')).toHaveLength(1);
  });
  it('reports all-failed configs and intentionally disabled configs without claiming a score', () => {
    for (const disabled of [false, true]) {
      const path = join(dir, `${disabled}.json`);
      writeFileSync(path, JSON.stringify({ servers: { only: { command: '/nonexistent-mcplint-test-command', disabled } } }));
      const result = run('config', path, '--format', 'json', '--fail-on', 'error');
      expect(result.status).toBe(disabled ? 0 : 1);
      const report = JSON.parse(result.stdout) as Report;
      expect(report.summary.score).toBeNull();
      expect(report.summary.complete).toBe(disabled);
      expect(report.servers).toHaveLength(1);
    }
  });
});

it('rejects invalid lint settings before a server is started', () => {
  const settings = join(dir, 'bad-settings.json');
  const log = join(dir, 'must-not-start.log');
  writeFileSync(settings, JSON.stringify({ severities: { 'description/missing': 'eror' } }));
  const result = run('stdio', '--config', settings, '--fail-on', 'error', '--', process.execPath, fixture, 'good', log);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Invalid lint config');
  expect(() => readFileSync(log)).toThrow();
});
