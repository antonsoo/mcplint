import { z } from 'zod';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CollectedPrompt, CollectedResource, CollectedTool, LintTarget, ServerInfo } from '../core/types.js';
import { isPlainObject, promptArguments } from '../core/schema-utils.js';

/**
 * Lists are requested with a permissive passthrough schema rather than the
 * SDK's typed `listTools()`/`listPrompts()`/`listResources()`, which validate
 * the *entire* response against the spec's Zod schema client-side. That is
 * correct behavior for a normal client - but one malformed tool (say, an
 * `inputSchema` that isn't `type: "object"`) makes the SDK reject every tool
 * in the response, hiding the other N-1 tools from a linter that exists
 * specifically to catch that malformed tool.
 */
const LENIENT_LIST_SCHEMA = z
  .object({
    tools: z.array(z.unknown()).optional(),
    prompts: z.array(z.unknown()).optional(),
    resources: z.array(z.unknown()).optional(),
    resourceTemplates: z.array(z.unknown()).optional(),
    nextCursor: z.string().optional()
  })
  .passthrough();

type ListMethod = 'tools/list' | 'prompts/list' | 'resources/list' | 'resources/templates/list';
type ListKey = 'tools' | 'prompts' | 'resources' | 'resourceTemplates';

// A server that keeps returning cursors (or repeats one) must not keep mcplint looping forever.
const MAX_PAGES = 1000;

/**
 * Every page of a paginated list: MCP list results carry a `nextCursor` until the last page, and a
 * linter that stops at page one silently skips the rest. Returns undefined when the server doesn't
 * support the method at all; a failure after the first page keeps what was already collected.
 */
export async function listAll(client: Pick<Client, 'request'>, method: ListMethod, key: ListKey): Promise<unknown[] | undefined> {
  const items: unknown[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    let result: z.infer<typeof LENIENT_LIST_SCHEMA>;
    try {
      result = await client.request({ method, params: cursor === undefined ? {} : { cursor } }, LENIENT_LIST_SCHEMA);
    } catch {
      return page === 0 ? undefined : items;
    }
    items.push(...(result[key] ?? []));
    cursor = result.nextCursor;
    if (cursor === undefined || seen.has(cursor)) break;
    seen.add(cursor);
  }
  return items;
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

  for (const raw of (await listAll(client, 'tools/list', 'tools')) ?? []) {
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

  for (const raw of (await listAll(client, 'prompts/list', 'prompts')) ?? []) {
    if (!isPlainObject(raw) || typeof raw.name !== 'string') continue;
    prompts.push({
      kind: 'prompt',
      name: raw.name,
      ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
      ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
      ...(Array.isArray(raw.arguments) ? { arguments: promptArguments(raw.arguments) } : {}),
      serverId
    });
  }

  // Resource templates carry names and descriptions just like resources, so they're linted the same way.
  const rawResources = [
    ...((await listAll(client, 'resources/list', 'resources')) ?? []),
    ...((await listAll(client, 'resources/templates/list', 'resourceTemplates')) ?? [])
  ];
  for (const raw of rawResources) {
    if (!isPlainObject(raw) || typeof raw.name !== 'string') continue;
    resources.push({
      kind: 'resource',
      name: raw.name,
      ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
      ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
      ...(typeof raw.uri === 'string' ? { uri: raw.uri } : {}),
      ...(typeof raw.uriTemplate === 'string' ? { uriTemplate: raw.uriTemplate } : {}),
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
