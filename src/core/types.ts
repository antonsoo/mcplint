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

export type RuleCategory = 'budget' | 'naming' | 'description' | 'schema' | 'safety';

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
}

export interface LintSummary {
  totalFindings: number;
  bySeverity: Record<Severity, number>;
  byRule: Record<string, number>;
  toolCount: number;
  promptCount: number;
  resourceCount: number;
  totalEstimatedTokens: number;
  /** 0-100, see src/core/score.ts for the formula. */
  score: number;
}

export interface LintResult {
  target: LintTarget;
  findings: Finding[];
  summary: LintSummary;
  config: ResolvedConfig;
  generatedAt: string;
  tokenizerName: string;
}
