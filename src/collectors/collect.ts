import { z } from 'zod';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CollectedPrompt, CollectedResource, CollectedTool, LintTarget, ServerInfo } from '../core/types.js';
import { isPlainObject } from '../core/schema-utils.js';

/**
 * The SDK's typed `listTools()`/`listPrompts()`/`listResources()` validate
 * the *entire* response against the spec's Zod schema client-side. That is
 * correct behavior for a normal client — but it means one malformed tool
 * (say, an `inputSchema` that isn't `type: "object"`) makes the SDK reject
 * every tool in the response, hiding the other N-1 tools from a linter that
 * exists specifically to catch that malformed tool. So each list call here
 * tries the typed method first, and on any failure (Zod validation error or
 * otherwise) falls back to the same request with a permissive passthrough
 * schema, trading type safety for "see everything, even the broken parts."
 */
const LENIENT_LIST_SCHEMA = z
  .object({
    tools: z.array(z.unknown()).optional(),
    prompts: z.array(z.unknown()).optional(),
    resources: z.array(z.unknown()).optional()
  })
  .passthrough();

async function rawList(
  client: Client,
  method: 'tools/list' | 'prompts/list' | 'resources/list'
): Promise<Record<string, unknown[]>> {
  const result = await client.request({ method, params: {} }, LENIENT_LIST_SCHEMA);
  return result as Record<string, unknown[]>;
}

export async function collectFromClient(client: Client, serverId: string, label: string): Promise<LintTarget> {
  const version = client.getServerVersion();
  const instructions = client.getInstructions();

  const server: ServerInfo = {
    id: serverId,
    label,
    ...(version?.name !== undefined ? { name: version.name } : {}),
    ...(version?.version !== undefined ? { version: version.version } : {}),
    ...(instructions !== undefined ? { instructions } : {})
  };

  const tools: CollectedTool[] = [];
  const prompts: CollectedPrompt[] = [];
  const resources: CollectedResource[] = [];

  let rawTools: unknown[] | undefined;
  try {
    rawTools = (await client.listTools()).tools;
  } catch {
    try {
      rawTools = (await rawList(client, 'tools/list')).tools;
    } catch {
      rawTools = undefined; // server genuinely doesn't support tools/list
    }
  }
  for (const raw of rawTools ?? []) {
    if (!isPlainObject(raw) || typeof raw.name !== 'string') continue;
    tools.push({
      kind: 'tool',
      name: raw.name,
      ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
      ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
      inputSchema: raw.inputSchema,
      ...(raw.outputSchema !== undefined ? { outputSchema: raw.outputSchema } : {}),
      ...(isPlainObject(raw.annotations) ? { annotations: raw.annotations } : {}),
      serverId
    });
  }

  let rawPrompts: unknown[] | undefined;
  try {
    rawPrompts = (await client.listPrompts()).prompts;
  } catch {
    try {
      rawPrompts = (await rawList(client, 'prompts/list')).prompts;
    } catch {
      rawPrompts = undefined;
    }
  }
  for (const raw of rawPrompts ?? []) {
    if (!isPlainObject(raw) || typeof raw.name !== 'string') continue;
    prompts.push({
      kind: 'prompt',
      name: raw.name,
      ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
      ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
      ...(Array.isArray(raw.arguments) ? { arguments: raw.arguments as CollectedPrompt['arguments'] } : {}),
      serverId
    });
  }

  let rawResources: unknown[] | undefined;
  try {
    rawResources = (await client.listResources()).resources;
  } catch {
    try {
      rawResources = (await rawList(client, 'resources/list')).resources;
    } catch {
      rawResources = undefined;
    }
  }
  for (const raw of rawResources ?? []) {
    if (!isPlainObject(raw) || typeof raw.name !== 'string') continue;
    resources.push({
      kind: 'resource',
      name: raw.name,
      ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
      ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
      ...(typeof raw.uri === 'string' ? { uri: raw.uri } : {}),
      ...(typeof raw.mimeType === 'string' ? { mimeType: raw.mimeType } : {}),
      serverId
    });
  }

  return { servers: [server], tools, prompts, resources };
}

export function mergeTargets(targets: LintTarget[]): LintTarget {
  return {
    servers: targets.flatMap((t) => t.servers),
    tools: targets.flatMap((t) => t.tools),
    prompts: targets.flatMap((t) => t.prompts),
    resources: targets.flatMap((t) => t.resources)
  };
}
