export const privateState = 'SYNTHETIC_PRIVATE_REQUEST_STATE';
export const privateMarker = 'SYNTHETIC_PRIVATE_RESULT_TYPE';
export const scopes = {
  'tools/list': 'tools', 'prompts/list': 'prompts',
  'resources/list': 'resources', 'resources/templates/list': 'resourceTemplates'
};
export const definitions = {
  tools: [{ name: 'read_record', description: 'Read a synthetic record by its identifier.',
    inputSchema: { type: 'object', properties: { record_id: { type: 'string', description: 'The record identifier.' } },
      required: ['record_id'], additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } }],
  prompts: [{ name: 'review_record', description: 'Review a synthetic record for missing fields.',
    arguments: [{ name: 'record_id', description: 'The record identifier.', required: true }] }],
  resources: [{ name: 'record_source', uri: 'memory://records/example', description: 'Read the synthetic reference record.' }],
  resourceTemplates: [{ name: 'record_template', uriTemplate: 'memory://records/{id}',
    description: 'Read a synthetic reference record by identifier.' }]
};
export const cases = [
  { id: 'legacy-control', scope: 'tools/list', state: 'absent', complete: true },
  { id: 'explicit-complete', scope: 'tools/list', state: 'complete', complete: true },
  { id: 'nested-literal-control', scope: 'tools/list', state: 'complete', nested: true, complete: true },
  ...Object.keys(scopes).map(scope => ({ id: `input-required-${scopes[scope]}`, scope, state: 'input_required', complete: false })),
  ...[privateMarker, null, 7, '', true, { resultType: 'complete' }].map((state, i) =>
    ({ id: `unsupported-${i}`, scope: 'tools/list', state, complete: false })),
  { id: 'late-page', scope: 'tools/list', state: 'input_required', paginated: true, complete: false },
  { id: 'suppressed-gap', scope: 'tools/list', state: 'input_required', suppressed: true, complete: false },
  { id: 'retained-hidden-text', scope: 'tools/list', state: 'input_required', hidden: true, complete: false }
];

export function responseFor(item, scope = item.scope, cursor) {
  const key = scopes[scope];
  const values = structuredClone(definitions[key]);
  if (item.nested && key === 'tools') {
    values[0].inputSchema.properties.payload = { description: 'A constant synthetic payload.',
      const: { resultType: 'input_required' } };
  }
  if (item.hidden && key === 'tools') values[0].description += '\u200b';
  if (scope !== item.scope) return { [key]: values };
  if (item.paginated) {
    if (!cursor) return { [key]: values, nextCursor: 'second' };
    values[0].name = cursor === 'second' ? 'read_other' : 'read_unresolved';
    if (cursor !== 'second') return { [key]: values };
  }
  const response = { [key]: values };
  if (item.state !== 'absent') response.resultType = item.state;
  if (!item.complete) {
    response.requestState = privateState;
    response.inputRequests = { fixture: { method: 'elicitation/create',
      params: { mode: 'form', message: privateState, requestedSchema: { type: 'object' } } } };
  }
  if (item.paginated) response.nextCursor = 'unresolved';
  return response;
}
