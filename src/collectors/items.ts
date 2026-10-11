import type { CollectionRecord, LintTarget } from '../core/types.js';
import { isPlainObject, promptArguments, toolAnnotationIssues } from '../core/schema-utils.js';

/** Shared by live and saved collectors, so malformed metadata cannot disappear in either path. */
export function appendItems(target: LintTarget, key: 'tools' | 'prompts' | 'resources' | 'resourceTemplates', items: unknown[], record: CollectionRecord): void {
  let malformed = 0;
  let firstMalformed = -1;
  let missingIdentity = 0;
  const annotationDetails: string[] = [];
  for (const [index, raw] of items.entries()) {
    const invalid = (): void => { malformed++; if (firstMalformed < 0) firstMalformed = index; };
    if (!isPlainObject(raw)) { invalid(); continue; }
    let bad = typeof raw.name !== 'string';
    for (const field of ['title', 'description']) {
      if (raw[field] !== undefined && typeof raw[field] !== 'string') bad = true;
    }
    const common = {
      serverId: record.serverId,
      name: typeof raw.name === 'string' ? raw.name : `(unnamed ${key} entry ${index + 1})`,
      ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
      ...(typeof raw.description === 'string' ? { description: raw.description } : {})
    };
    if (key === 'tools') {
      const issues = toolAnnotationIssues(raw.annotations);
      if (issues.length) {
        bad = true;
        // Fixed field names and expected types only, never arbitrary hint values.
        if (annotationDetails.length < 3) annotationDetails.push(`entry ${index}: ${issues.join(', ')}`);
      }
      target.tools.push({ kind: 'tool', ...common, inputSchema: raw.inputSchema,
        ...(raw.outputSchema !== undefined ? { outputSchema: raw.outputSchema } : {}),
        ...(isPlainObject(raw.annotations) ? { annotations: raw.annotations } : {}) });
    } else if (key === 'prompts') {
      if (raw.arguments !== undefined && (!Array.isArray(raw.arguments) || raw.arguments.some(arg =>
        !isPlainObject(arg) || typeof arg.name !== 'string' ||
        (arg.description !== undefined && typeof arg.description !== 'string') ||
        (arg.required !== undefined && typeof arg.required !== 'boolean')))) bad = true;
      target.prompts.push({ kind: 'prompt', ...common,
        ...(Array.isArray(raw.arguments) ? { arguments: promptArguments(raw.arguments) } : {}) });
    } else {
      // Concrete resources and templates have different required identities.
      // The other field cannot stand in for the one required by this list.
      const identity = key === 'resources' ? 'uri' : 'uriTemplate';
      if (typeof raw[identity] !== 'string') { bad = true; missingIdentity++; }
      for (const field of ['uri', 'uriTemplate', 'mimeType']) {
        if (raw[field] !== undefined && typeof raw[field] !== 'string') bad = true;
      }
      target.resources.push({ kind: 'resource', ...common,
        ...(typeof raw.uri === 'string' ? { uri: raw.uri } : {}),
        ...(typeof raw.uriTemplate === 'string' ? { uriTemplate: raw.uriTemplate } : {}),
        ...(typeof raw.mimeType === 'string' ? { mimeType: raw.mimeType } : {}) });
    }
    record.retained++;
    if (bad) invalid();
  }
  if (malformed) {
    record.status = 'incomplete';
    record.detail = [record.detail, `${malformed} malformed ${key} entries; first at index ${firstMalformed}. Valid fields were retained where possible.`,
      missingIdentity ? `${missingIdentity} ${missingIdentity === 1 ? 'entry lacks' : 'entries lack'} a string ${key === 'resources' ? 'uri' : 'uriTemplate'} required by this list.` : undefined,
      annotationDetails.length ? `Annotation errors (up to three entries): ${annotationDetails.join('; ')}.` : undefined].filter(Boolean).join(' ');
  }
}
