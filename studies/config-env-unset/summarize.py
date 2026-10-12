#!/usr/bin/env python3
"""Print an unedited comparison of retained CLI/child-process observations."""
import json
from pathlib import Path
import sys

before, after = (json.loads(Path(path).read_text()) for path in sys.argv[1:])
assert before['cases'] == after['cases'] == 36
print('mcplint: explicit environment removals')
print('Synthetic local server; no external account or service.\n')
print(f"Actual child environments: {before['matched']}/36 before -> {after['matched']}/36 corrected")
print('Config layouts: servers, mcp.servers, mcpServers\n')
print(f"{'Case (servers layout)':25} {'Before':21} {'Corrected':21} Tools")
print('-' * 80)
for old, new in zip(before['records'], after['records']):
    assert (old['shape'], old['case']) == (new['shape'], new['case'])
    if old['shape'] != 'servers':
        continue
    name = new['case']
    key = 'TERM' if 'default' in name else ('MCPLINT_FIXTURE_MODE' if name in ('numeric-zero', 'boolean-false') else 'MCPLINT_FIXTURE_TOKEN')
    values = [row['observed']['environment'][key] for row in (old, new)]
    labels = ['<absent>' if value is None else repr(value) for value in values]
    print(f"{name:25} {labels[0]:21} {labels[1]:21} {old['toolCount']} -> {new['toolCount']}")
print('\nA token enables write_records; read_records is always advertised.')
print('Every baseline audit reported complete, including the wrong launches.')
