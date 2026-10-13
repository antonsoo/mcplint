"""Independent Decimal check of the numeric guard's decimal serialization contract.

Uses deterministic constructed numbers, not production metadata. JavaScript
provides its native serialization; Python Decimal decides exact decimal equality.
"""
import argparse
import hashlib
import json
import random
import subprocess
from collections import Counter
from decimal import Decimal
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--module', type=Path, required=True)
parser.add_argument('--node', default='node')
args = parser.parse_args()
rng = random.Random(20261013)
literals = ['0', '-0', '0e999999', '0.1', '0.10000000000000001', '5e-324', '1e-324',
            '1e400', '9007199254740992', '9007199254740993', '1000000000000000100',
            '1000000000000000101', '1.7976931348623157e308']
for _ in range(2400):
    digits = str(rng.randrange(1, 10 ** rng.randrange(1, 40)))
    split = rng.randrange(len(digits) + 1)
    coefficient = digits[:split] + '.' + digits[split:] if 0 < split < len(digits) else digits
    literals.append(('-' if rng.randrange(2) else '') + coefficient + 'e' + str(rng.randrange(-340, 311)))
script = '''
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
const { readJson } = await import(pathToFileURL(process.argv[1]).href);
const rows = JSON.parse(readFileSync(0, 'utf8')).map(literal => {
  const decoded = JSON.parse(literal), serialized = JSON.stringify(decoded);
  let accepted = true; try { readJson(literal); } catch { accepted = false; }
  return { literal, serialized, accepted };
});
console.log(JSON.stringify(rows));
'''
raw = subprocess.check_output([args.node, '--input-type=module', '-e', script, str(args.module.resolve())], input=json.dumps(literals).encode())
rows = json.loads(raw)
counts = Counter()
disagreements = []
for row in rows:
    expected = row['serialized'] != 'null' and Decimal(row['literal']) == Decimal(row['serialized'])
    counts['accepted' if expected else 'refused'] += 1
    if row['accepted'] != expected:
        disagreements.append(row)
print(json.dumps({'scope': __doc__, 'seed': 20261013, 'cases': len(rows), 'expected': dict(counts),
                  'input_sha256': hashlib.sha256(json.dumps(literals).encode()).hexdigest(),
                  'results_sha256': hashlib.sha256(raw).hexdigest(), 'disagreements': disagreements}, indent=2))
if disagreements:
    raise SystemExit(1)
