import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { McplintConfigFile, ResolvedConfig, Severity } from './types.js';
import { stripBom } from './schema-utils.js';

export const DEFAULT_BUDGET = 400;

const CONFIG_CANDIDATES = ['.mcplintrc.json', 'mcplint.config.json'];

export async function loadConfigFile(cwd: string, explicitPath?: string): Promise<McplintConfigFile> {
  const path = explicitPath ?? CONFIG_CANDIDATES.map((f) => resolve(cwd, f)).find((f) => existsSync(f));
  if (!path) return {};
  const raw = await readFile(path, 'utf8');
  try {
    return JSON.parse(stripBom(raw)) as McplintConfigFile;
  } catch (err) {
    throw new Error(`Failed to parse config file ${path}: ${(err as Error).message}`);
  }
}

export interface ResolveConfigOptions {
  file: McplintConfigFile;
  budgetFlag?: number;
  failOnFlag?: Severity | null;
  ignoreFlags?: string[];
}

export function resolveConfig({ file, budgetFlag, failOnFlag, ignoreFlags }: ResolveConfigOptions): ResolvedConfig {
  return {
    budget: budgetFlag ?? file.budget ?? DEFAULT_BUDGET,
    totalBudget: file.totalBudget,
    severities: file.severities ?? {},
    ignore: new Set([...(file.ignore ?? []), ...(ignoreFlags ?? [])]),
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
