import { readTextFile } from './read-text.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { McplintConfigFile, ResolvedConfig, Severity } from './types.js';
import { stripBom } from './schema-utils.js';
import { z } from 'zod';

/**
 * Per-tool and whole-list token budgets when none is configured. Round numbers, not
 * percentiles: 400 tokens for one tool, and 16,000 for the whole list, 8% of a 200,000-token
 * context window. In studies/registry-census, 8.9% of tool definitions exceed the first and
 * 6.7% of servers the second (see ./census.ts).
 */
export const DEFAULT_BUDGET = 400;
export const DEFAULT_TOTAL_BUDGET = 16_000;

const CONFIG_CANDIDATES = ['.mcplintrc.json', 'mcplint.config.json'];
const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const configSchema = z.object({
  budget: positiveInteger.optional(),
  totalBudget: positiveInteger.optional(),
  severities: z.record(z.enum(['error', 'warning', 'info', 'off'])).optional(),
  ignore: z.array(z.string().min(1)).optional()
}).strict();

function validateConfig(value: unknown): McplintConfigFile {
  const parsed = configSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid lint config: ${parsed.error.issues.map(issue => `${issue.path.join('.') || 'root'}: ${issue.message}`).join('; ')}`);
  }
  return parsed.data;
}

export function findConfigFile(cwd: string, explicitPath?: string): string | undefined {
  return explicitPath ?? CONFIG_CANDIDATES.map((f) => resolve(cwd, f)).find((f) => existsSync(f));
}

export async function loadConfigFile(cwd: string, explicitPath?: string): Promise<McplintConfigFile> {
  const path = findConfigFile(cwd, explicitPath);
  if (!path) return {};
  const raw = await readTextFile(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(raw));
  } catch (err) {
    throw new Error(`Failed to parse config file ${path}: ${(err as Error).message}`);
  }
  return validateConfig(parsed);
}

export interface ResolveConfigOptions {
  /** A parsed config file. Omit it to lint with the defaults. */
  file?: McplintConfigFile;
  budgetFlag?: number;
  failOnFlag?: Severity | null;
  ignoreFlags?: string[];
}

export function resolveConfig({ file = {}, budgetFlag, failOnFlag, ignoreFlags }: ResolveConfigOptions = {}): ResolvedConfig {
  const checked = validateConfig(file);
  if (budgetFlag !== undefined && !positiveInteger.safeParse(budgetFlag).success) throw new Error('Invalid lint config: budget flag must be a positive safe integer.');
  if (ignoreFlags !== undefined && !z.array(z.string().min(1)).safeParse(ignoreFlags).success) throw new Error('Invalid lint config: ignore flags must be nonempty strings.');
  if (failOnFlag != null && !['error', 'warning', 'info'].includes(failOnFlag)) throw new Error('Invalid lint config: unknown failure threshold.');
  return {
    budget: budgetFlag ?? checked.budget ?? DEFAULT_BUDGET,
    totalBudget: checked.totalBudget,
    severities: checked.severities ?? {},
    ignore: new Set([...(checked.ignore ?? []), ...(ignoreFlags ?? [])]),
    failOn: failOnFlag ?? null
  };
}

export function effectiveSeverity(
  config: ResolvedConfig,
  ruleId: string,
  defaultSeverity: Severity
): Severity | 'off' {
  return config.severities[ruleId] ?? defaultSeverity;
}

export function isIgnored(config: ResolvedConfig, ruleId: string, subjectName: string): boolean {
  return config.ignore.has(ruleId) || config.ignore.has(`${ruleId}:${subjectName}`);
}
