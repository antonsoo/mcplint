import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Exercise a launcher that exits while its child still holds the MCP pipes.
spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url)), ...process.argv.slice(2)], {
  stdio: 'inherit'
}).unref();
