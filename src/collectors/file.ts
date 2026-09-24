import { readFile } from 'node:fs/promises';
import type { CollectedPrompt, CollectedResource, CollectedTool, LintTarget } from '../core/types.js';
import { isPlainObject } from '../core/schema-utils.js';

/**
 * Accepts either a saved `tools/list` result (`{ tools: [...] }`, optionally
 * with `prompts`/`resources` alongside it) or a bare array of tool objects.
 */
export async function collectFile(path: string, serverId = 'file'): Promise<LintTarget> {
  const raw = await readFile(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${(err as Error).message}`);
  }

  let toolsRaw: unknown[] = [];
  let promptsRaw: unknown[] = [];
  let resourcesRaw: unknown[] = [];

  if (Array.isArray(parsed)) {
    toolsRaw = parsed;
  } else if (isPlainObject(parsed)) {
    if (Array.isArray(parsed.tools)) toolsRaw = parsed.tools;
    if (Array.isArray(parsed.prompts)) promptsRaw = parsed.prompts;
    if (Array.isArray(parsed.resources)) resourcesRaw = parsed.resources;
    if (toolsRaw.length === 0 && promptsRaw.length === 0 && resourcesRaw.length === 0) {
      throw new Error(`${path} has no "tools", "prompts", or "resources" array.`);
    }
  } else {
    throw new Error(`${path} must contain a tools array or a {tools, prompts, resources} object.`);
  }

  const tools: CollectedTool[] = toolsRaw.filter(isPlainObject).map((t) => ({
    kind: 'tool',
    name: typeof t.name === 'string' ? t.name : '(unnamed)',
    ...(typeof t.title === 'string' ? { title: t.title } : {}),
    ...(typeof t.description === 'string' ? { description: t.description } : {}),
    inputSchema: t.inputSchema,
    ...(t.outputSchema !== undefined ? { outputSchema: t.outputSchema } : {}),
    ...(isPlainObject(t.annotations) ? { annotations: t.annotations } : {}),
    serverId
  }));

  const prompts: CollectedPrompt[] = promptsRaw.filter(isPlainObject).map((p) => ({
    kind: 'prompt',
    name: typeof p.name === 'string' ? p.name : '(unnamed)',
    ...(typeof p.title === 'string' ? { title: p.title } : {}),
    ...(typeof p.description === 'string' ? { description: p.description } : {}),
    ...(Array.isArray(p.arguments) ? { arguments: p.arguments as CollectedPrompt['arguments'] } : {}),
    serverId
  }));

  const resources: CollectedResource[] = resourcesRaw.filter(isPlainObject).map((r) => ({
    kind: 'resource',
    name: typeof r.name === 'string' ? r.name : '(unnamed)',
    ...(typeof r.title === 'string' ? { title: r.title } : {}),
    ...(typeof r.description === 'string' ? { description: r.description } : {}),
    ...(typeof r.uri === 'string' ? { uri: r.uri } : {}),
    ...(typeof r.mimeType === 'string' ? { mimeType: r.mimeType } : {}),
    serverId
  }));

  return {
    servers: [{ id: serverId, label: path }],
    tools,
    prompts,
    resources
  };
}
