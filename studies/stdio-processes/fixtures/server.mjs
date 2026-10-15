// Controlled local fixture. Every PID and heartbeat belongs to this replay.
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [directory, mode, mcpModule, stdioModule] = process.argv.slice(2);
writeFileSync(join(directory, 'server.pid'), String(process.pid));
const record = event => appendFileSync(join(directory, 'events.jsonl'), JSON.stringify({ event, pid: process.pid }) + '\n');
const beat = () => appendFileSync(join(directory, 'heartbeat'), '.');
beat();
const heartbeat = setInterval(beat, 40);
process.on('exit', code => record(`exit:${code}`));
if (mode === 'resistant' || mode === 'stalled-resistant') process.on('SIGTERM', () => record('SIGTERM:ignored'));
else process.on('SIGTERM', () => { record('SIGTERM'); process.exit(0); });

if (mode === 'background') {
  spawn(process.execPath, [fileURLToPath(new URL('./helper.mjs', import.meta.url)), directory], { stdio: 'ignore' }).unref();
}
if (mode === 'stalled' || mode === 'stalled-resistant') process.stdin.resume();
else {
  const { McpServer } = await import(mcpModule);
  const { StdioServerTransport } = await import(stdioModule);
  const server = new McpServer({ name: 'process-lifecycle-fixture', version: '1' });
  server.registerTool('read_fixture_status', {
    description: 'Read the status of this controlled local lifecycle fixture.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, () => ({ content: [{ type: 'text', text: 'ready' }] }));
  const transport = new StdioServerTransport();
  if (mode === 'damaged') {
    const send = transport.send.bind(transport);
    transport.send = message => {
      if (message.result?.tools) {
        process.stdout.write(`{"jsonrpc":"2.0","id":${JSON.stringify(message.id)},"result":{"tools":[],"tools":[]}}\n`);
        return Promise.resolve();
      }
      return send(message);
    };
  }
  await server.connect(transport);
}
process.stdin.on('end', () => {
  record('stdin:end');
  if (mode === 'graceful' || mode === 'background') clearInterval(heartbeat);
});
