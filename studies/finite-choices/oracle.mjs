// Write finite-domain controls and the native schema observations for a separate Python validator.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { enumTypeConflicts } from '../../dist/core/schema-enum-types.js';

const directory = dirname(fileURLToPath(import.meta.url));
const ajv = new Ajv2020({ strict: false, coerceTypes: false, allowUnionTypes: true, allErrors: true });
const samples = [null, false, true, 0, -1, 1.5, '', '5', [], [1], {}, { x: 1 }];
const types = ['null', 'boolean', 'number', 'integer', 'string', 'array', 'object',
  ['string', 'null'], ['integer', 'boolean'], ['object', 'array']];
const domains = samples.map(value => [value]);
for (let i = 0; i < samples.length; i++) for (let j = i + 1; j < samples.length; j++) domains.push([samples[i], samples[j]]);
const controls = [];
for (const type of types) for (const values of domains) {
  const schema = { type, enum: values };
  const validate = ajv.compile(schema);
  const accepted = values.map(value => validate(value));
  const conflicts = enumTypeConflicts(schema);
  assert.equal(conflicts.length, accepted.some(Boolean) ? 0 : 1);
  controls.push({ schema, accepted, conflicts });
}
const tools = JSON.parse(await readFile(join(directory, 'captures/tools.json'), 'utf8')).tools;
const native = [];
for (const tool of tools) {
  const validate = ajv.compile(tool.inputSchema);
  assert.equal(validate({}), true);
  for (const field of ['duration', 'isPrivate']) {
    const schema = tool.inputSchema.properties[field];
    if (!schema) continue;
    const alternativeTypes = field === 'duration' ? [5, 10] : [true, false];
    const candidates = [...schema.enum, ...alternativeTypes].map(value => {
      const accepted = validate({ [field]: value });
      assert.equal(accepted, false);
      return { value, accepted, errors: structuredClone(validate.errors) };
    });
    native.push({ tool: tool.name, field, schema, omittedFieldAccepted: true, candidates });
  }
}
const result = { controls, native, coerceTypes: false,
  scriptSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex') };
await writeFile(process.argv[2] ?? join(directory, 'oracle.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`Verified ${controls.length} finite-domain controls and ${native.length} native contradictions with Ajv.`);
