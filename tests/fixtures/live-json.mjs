// Raw synthetic replies: JSON.stringify would erase the defect under study.
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';

const [payload, page, pidFile] = process.argv.slice(2);
if (pidFile) writeFileSync(pidFile, String(process.pid));
if (page === 'stubborn') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
}
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  let result;
  if (request.method === 'initialize') {
    result = page === 'initialize' ? payload : JSON.stringify({
      protocolVersion: request.params.protocolVersion,
      serverInfo: { name: 'raw-json-control', version: '1' }, capabilities: { tools: {} },
    });
  } else if (request.method === 'tools/list') {
    result = page === 'second' && request.params?.cursor === undefined
      ? '{"tools":[{"name":"first_page","inputSchema":{"type":"object"}}],"nextCursor":"next"}'
      : payload;
  } else return;
  let reply = '{"jsonrpc":"2.0","id":' + JSON.stringify(request.id) + ',"result":' + result + '}\n';
  if (page === 'notification' && request.method === 'tools/list') {
    reply += '{"jsonrpc":"2.0","method":"notifications/tools/list_changed","params":{"n":1e400}}\n';
  }
  process.stdout.write(reply);
});
