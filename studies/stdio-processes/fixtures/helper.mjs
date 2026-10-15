import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.argv[2];
writeFileSync(join(directory, 'helper.pid'), String(process.pid));
const beat = () => appendFileSync(join(directory, 'helper-heartbeat'), '.');
beat();
setInterval(beat, 40);
process.on('SIGTERM', () => {
  appendFileSync(join(directory, 'events.jsonl'), JSON.stringify({ event: 'helper:SIGTERM', pid: process.pid }) + '\n');
  process.exit(0);
});
