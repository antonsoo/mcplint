import type { Rule } from '../types.js';
import { rules as budgetRules } from './budget.js';
import { rules as namingRules } from './naming.js';
import { rules as descriptionRules } from './descriptions.js';
import { rules as schemaRules } from './schema.js';
import { rules as safetyRules } from './safety.js';

export const allRules: Rule[] = [...budgetRules, ...namingRules, ...descriptionRules, ...schemaRules, ...safetyRules];

export const rulesById: ReadonlyMap<string, Rule> = new Map(allRules.map((r) => [r.id, r]));

export * as budget from './budget.js';
export * as naming from './naming.js';
export * as descriptions from './descriptions.js';
export * as schema from './schema.js';
export * as safety from './safety.js';
