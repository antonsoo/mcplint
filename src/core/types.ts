/**
 * Shapes shared by every collector and rule. These deliberately mirror the
 * MCP wire types loosely rather than importing the SDK's Zod-inferred types,
 * because `mcplint file` and `mcplint config` need to accept tool/prompt/
 * resource JSON that never passed through an SDK client (e.g. a saved
 * `tools/list` response, or a hand-written fixture).
 */

export type Severity = 'error' | 'warning' | 'info';

export interface ToolAnnotationsLike {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  [key: string]: unknown;
}

export interface CollectedTool {
  kind: 'tool';
  name: string;
  title?: string;
  description?: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  annotations?: ToolAnnotationsLike;
  serverId: string;
}

export interface CollectedPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface CollectedPrompt {
  kind: 'prompt';
  name: string;
  title?: string;
  description?: string;
  arguments?: CollectedPromptArgument[];
  serverId: string;
}

export interface CollectedResource {
  kind: 'resource';
  name: string;
  title?: string;
  description?: string;
  uri?: string;
  uriTemplate?: string;
  mimeType?: string;
  serverId: string;
}

export type CollectedItem = CollectedTool | CollectedPrompt | CollectedResource;

export interface ServerInfo {
  /** Stable id used to key findings back to a server (config key, or "stdio"/"http" for single-target runs). */
  id: string;
  /** Human label for reports: config key, or the command/url that was connected to. */
  label: string;
  /** `serverInfo.name` from the MCP `initialize` handshake, when available. */
  name?: string;
  version?: string;
  instructions?: string;
}

export interface LintTarget {
  servers: ServerInfo[];
  tools: CollectedTool[];
  prompts: CollectedPrompt[];
  resources: CollectedResource[];
  /** What was collected, including explicit gaps. Absent for caller-supplied library targets. */
  collection?: CollectionRecord[];
  /** Decoded protocol metadata before lint projection; does not copy collector launch configuration. */
  metadata?: { servers: MetadataServer[]; definitions: MetadataDefinition[] };
}

export type ListMethod = 'tools/list' | 'prompts/list' | 'resources/list' | 'resources/templates/list';

export interface MetadataServer {
  id: string;
  serverInfo?: unknown;
  capabilities?: unknown;
  instructions?: unknown;
}

export interface MetadataDefinition {
  serverId: string;
  scope: ListMethod;
  value: unknown;
}

export interface CollectionRecord {
  serverId: string;
  scope: ListMethod | 'file' | 'connection' | 'config';
  status: 'complete' | 'incomplete' | 'unsupported' | 'disabled';
  pages: number;
  received: number;
  retained: number;
  detail?: string;
}

export interface FindingSubject {
  kind: 'tool' | 'prompt' | 'resource' | 'server';
  name: string;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  serverId: string;
  subject: FindingSubject;
  message: string;
  /** Longer explanation, decoded payloads, offending snippets — shown in verbose/HTML reports. */
  detail?: string;
  suggestion?: string;
}

export type RuleCategory = 'budget' | 'naming' | 'description' | 'schema' | 'safety' | 'collection';

export interface RuleMeta {
  id: string;
  category: RuleCategory;
  defaultSeverity: Severity;
  summary: string;
  rationale: string;
}

export interface Rule extends RuleMeta {
  check(ctx: RuleContext): Finding[];
}

export interface McplintConfigFile {
  /** Per-tool token budget. Exceeding it raises `budget/tool-tokens`. Default 400. */
  budget?: number;
  /** Total token budget across all collected tools. Exceeding it raises `budget/total-tokens`. */
  totalBudget?: number;
  /** Rule id -> severity override, or "off" to disable. */
  severities?: Record<string, Severity | 'off'>;
  /** Rule ids, or "ruleId:subjectName" pairs, to suppress entirely. */
  ignore?: string[];
}

export interface ResolvedConfig {
  budget: number;
  totalBudget: number | undefined;
  severities: Record<string, Severity | 'off'>;
  ignore: Set<string>;
  failOn: Severity | null;
}

export interface RuleContext {
  target: LintTarget;
  config: ResolvedConfig;
  /** A single audit may share successful estimates. Standalone rules can omit
   * this function; counts are never cached across calls to lint(). */
  estimateToolTokens?: (tool: CollectedTool) => number;
}

export interface LintSummary {
  totalFindings: number;
  bySeverity: Record<Severity, number>;
  byRule: Record<string, number>;
  toolCount: number;
  promptCount: number;
  resourceCount: number;
  /** Null when at least one tool could not be serialized for estimation. */
  totalEstimatedTokens: number | null;
  /** Whether collection and enabled checks finished. Does not certify safety. */
  complete: boolean;
  /** 0-100, or null when collection/checks are incomplete. */
  score: number | null;
}

export interface LintResult {
  target: LintTarget;
  findings: Finding[];
  summary: LintSummary;
  config: ResolvedConfig;
  generatedAt: string;
  tokenizerName: string;
}
