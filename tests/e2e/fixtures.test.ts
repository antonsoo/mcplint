import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectStdio } from '../../src/collectors/stdio.js';
import { lint } from '../../src/core/lint.js';
import { baseConfig } from '../helpers.js';

/**
 * End-to-end: spawns the real fixture servers (examples/good-server,
 * examples/poisoned-server) over stdio via the actual MCP SDK client, exactly
 * as `mcplint stdio -- ...` does, then lints the collected result. No
 * mocking of the protocol layer.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const goodServer = join(root, 'examples', 'good-server', 'server.ts');
const poisonedServer = join(root, 'examples', 'poisoned-server', 'server.ts');

describe('good-server fixture (e2e over stdio)', () => {
  it('collects all three tools with correct annotations', async () => {
    const target = await collectStdio({ command: 'npx', args: ['tsx', goodServer] });
    expect(target.tools.map((t) => t.name).sort()).toEqual(['get_invoice_detail', 'list_invoices', 'void_invoice']);
    const voidInvoice = target.tools.find((t) => t.name === 'void_invoice')!;
    expect(voidInvoice.annotations?.destructiveHint).toBe(true);
  }, 30_000);

  it('produces zero errors and zero warnings from mcplint', async () => {
    const target = await collectStdio({ command: 'npx', args: ['tsx', goodServer] });
    const result = lint(target, baseConfig());
    expect(result.summary.bySeverity.error).toBe(0);
    expect(result.summary.bySeverity.warning).toBe(0);
    expect(result.summary.score).toBe(100);
  }, 30_000);
});

describe('poisoned-server fixture (e2e over stdio)', () => {
  it('collects every tool even though one has an invalid inputSchema', async () => {
    // batch_tags has inputSchema.type "array"; the SDK's typed listTools() would reject the WHOLE
    // response for this, which is exactly the failure mode collectStdio's lenient fallback exists for.
    const target = await collectStdio({ command: 'npx', args: ['tsx', poisonedServer] });
    expect(target.tools.length).toBeGreaterThanOrEqual(12);
    expect(target.tools.some((t) => t.name === 'batch_tags')).toBe(true);
  }, 30_000);

  it('finds the hidden-unicode payload and decodes it', async () => {
    const target = await collectStdio({ command: 'npx', args: ['tsx', poisonedServer] });
    const result = lint(target, baseConfig());
    const hidden = result.findings.find((f) => f.ruleId === 'safety/hidden-unicode');
    expect(hidden).toBeDefined();
    expect(hidden!.message).toContain('~/.ssh');
  }, 30_000);

  it('flags the secret-access instruction smuggled inside the decoded payload', async () => {
    const target = await collectStdio({ command: 'npx', args: ['tsx', poisonedServer] });
    const result = lint(target, baseConfig());
    expect(result.findings.some((f) => f.ruleId === 'safety/secret-access')).toBe(true);
  }, 30_000);

  it('flags the prompt-injection, cross-tool-reference, and schema/invalid findings', async () => {
    const target = await collectStdio({ command: 'npx', args: ['tsx', poisonedServer] });
    const result = lint(target, baseConfig());
    const ruleIds = new Set(result.findings.map((f) => f.ruleId));
    expect(ruleIds.has('safety/prompt-injection')).toBe(true);
    expect(ruleIds.has('safety/cross-tool-reference')).toBe(true);
    expect(ruleIds.has('schema/invalid')).toBe(true);
    expect(ruleIds.has('naming/generic')).toBe(true);
    expect(ruleIds.has('description/missing')).toBe(true);
  }, 30_000);

  it('scores substantially worse than the good server and would fail --fail-on error', async () => {
    const [good, poisoned] = await Promise.all([
      collectStdio({ command: 'npx', args: ['tsx', goodServer] }),
      collectStdio({ command: 'npx', args: ['tsx', poisonedServer] })
    ]);
    const goodResult = lint(good, baseConfig());
    const poisonedResult = lint(poisoned, baseConfig({ failOn: 'error' }));
    expect(poisonedResult.summary.score).toBeLessThan(goodResult.summary.score);
    expect(poisonedResult.summary.bySeverity.error).toBeGreaterThan(0);
  }, 30_000);
});
