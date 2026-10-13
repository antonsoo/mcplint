import { randomUUID } from 'node:crypto';
import { lstat, open, realpath, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** Resolve existing ancestors too: a declared env file or snapshot may not exist yet. */
async function canonicalPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try { return await realpath(absolute); }
  catch (error) {
    if (!missing(error)) throw error;
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return join(await canonicalPath(parent), basename(absolute));
  }
}

async function identity(path: string) {
  const info = await stat(path, { bigint: true }).catch((error: unknown) => {
    if (!missing(error)) throw error;
    return undefined;
  });
  return { path: await canonicalPath(path), info };
}

export interface OutputPaths { report?: string; snapshot?: string }

/** Check all known source files and both outputs before collecting or writing. */
export async function validateOutputPaths(inputs: readonly string[], outputs: OutputPaths): Promise<void> {
  const destinations = Object.entries(outputs).filter((entry): entry is [string, string] => entry[1] !== undefined);
  if (!destinations.length) return;
  const seen = await Promise.all([...new Set(inputs)].map(identity));
  for (const [kind, path] of destinations) {
    const destination = await identity(path);
    if (seen.some(source => source.path === destination.path || (source.info && destination.info && source.info.dev === destination.info.dev && source.info.ino === destination.info.ino))) {
      throw new Error('An output cannot replace an input file or another output, including through a file alias.');
    }
    seen.push(destination);
    const entry = await lstat(path).catch((error: unknown) => {
      if (!missing(error)) throw error;
      return undefined;
    });
    if (entry?.isSymbolicLink()) throw new Error('An output cannot replace a symbolic-link destination. Choose a regular file path.');
    if (kind === 'snapshot' && entry) throw new Error('Snapshot destination already exists. Choose a new file path.');
    if (entry && !entry.isFile()) throw new Error('Report destination must be a regular file.');
    // Fail before starting servers when the output directory is absent or not a directory.
    if (!(await stat(dirname(resolve(path)))).isDirectory()) throw new Error('Output parent must be a directory.');
  }
}

/** Replace a report from a private sibling; a failed write leaves the old report intact. */
export async function writeReport(path: string, text: string, inputs: readonly string[]): Promise<void> {
  await validateOutputPaths(inputs, { report: path });
  const temporary = join(dirname(resolve(path)), `.mcplint-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  const errors: unknown[] = [];
  try {
    try { await handle.writeFile(text, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await validateOutputPaths(inputs, { report: path });
    await rename(temporary, path);
  } catch (error) { errors.push(error); }
  finally {
    try { await unlink(temporary); }
    catch (error) { if (!missing(error)) errors.push(error); }
  }
  if (errors.length) throw errors[0];
}

/** Exclusive creation preserves previous snapshots; a failed new write is removed. */
export async function writeSnapshot(path: string, text: string, inputs: readonly string[]): Promise<void> {
  await validateOutputPaths(inputs, { snapshot: path });
  const handle = await open(path, 'wx', 0o600);
  const errors: unknown[] = [];
  try { await handle.writeFile(text, 'utf8'); await handle.sync(); }
  catch (error) { errors.push(error); }
  finally {
    try { await handle.close(); }
    catch (error) { errors.push(error); }
  }
  if (errors.length) {
    try { await unlink(path); }
    catch (error) { if (!missing(error)) errors.push(error); }
    throw errors[0];
  }
}
