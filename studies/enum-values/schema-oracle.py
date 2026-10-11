"""Independent JSON Schema validation; requires python-jsonschema."""
import importlib.metadata
import json
from pathlib import Path
from jsonschema import Draft7Validator, Draft202012Validator

root = Path(__file__).parent
rows = []
for case in json.loads((root / 'fixtures.json').read_text()):
    for tool in case['tools']:
        schema = tool['inputSchema']
        for validator in [Draft7Validator, Draft202012Validator]:
            validator.check_schema(schema)
            for value in schema['properties']['mode']['enum']:
                validator(schema).validate({'mode': value})
            rows.append({'case': case['name'], 'tool': tool['name'],
                         'dialect': validator.META_SCHEMA['$id'],
                         'schemaValid': True, 'allEnumChoicesValidate': True})
(root / 'schema-oracle.json').write_text(json.dumps({'validator': 'python-jsonschema',
    'version': importlib.metadata.version('jsonschema'), 'results': rows}, indent=2) + '\n')
print(f'{len(rows)} schema checks passed; every listed choice validates')
