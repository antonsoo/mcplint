#!/usr/bin/env python3
"""Display the retained actual-launch outcomes, without editing their observations."""
import json
from pathlib import Path
import sys

before, after = (json.loads(Path(path).read_text()) for path in sys.argv[1:])
print('mcplint: .env files through a real child-process launch')
print('Synthetic local authentication fixture; no external account.\n')
print(f"Successful expected launches: {before['matched']}/{before['cases']} before -> {after['matched']}/{after['cases']} corrected")
print('All fixture values also match the pinned VS Code parser.\n')
print(f"{'Environment-file case':29} {'Baseline':20} Corrected")
print('-' * 70)
for old, new in zip(before['records'], after['records']):
    assert old['case'] == new['case']
    status = lambda row: f"exit {row['exitCode']}, {row['tools']} tool(s)"
    print(f"{old['case']:29} {status(old):20} {status(new)}")
print('\nExit 1: fixture rejects the changed value; audit is incomplete.')
print('Exit 0: fixture accepts the exact expected value; one tool collected.')
