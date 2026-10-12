#!/usr/bin/env python3
"""Exercise an actual CLI and child server, using only synthetic environment values."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
TOKEN, MODE, KEEP = 'MCPLINT_FIXTURE_TOKEN', 'MCPLINT_FIXTURE_MODE', 'MCPLINT_FIXTURE_KEEP'
# Expected values are literal fixture expectations, independent of mcplint.
# id, env, envFile, expected token, expected TERM, expected mode
CASES = [
    ('inherit', {}, '', 'parent-token', 'fixture-term', 'parent-mode'),
    ('remove-parent', {TOKEN: None}, '', None, 'fixture-term', 'parent-mode'),
    ('remove-file', {TOKEN: None}, f'{TOKEN}=file-token\n', None, 'fixture-term', 'parent-mode'),
    ('remove-sdk-default', {'TERM': None}, '', 'parent-token', None, 'parent-mode'),
    ('remove-file-default', {'TERM': None}, 'TERM=file-term\n', 'parent-token', None, 'parent-mode'),
    ('remove-all', {TOKEN: None, 'TERM': None, MODE: None}, f'{TOKEN}=file-token\n{MODE}=file-mode\n', None, None, None),
    ('empty-string', {TOKEN: '', 'TERM': '', MODE: ''}, '', '', '', ''),
    ('string-null', {TOKEN: 'null'}, '', 'null', 'fixture-term', 'parent-mode'),
    ('numeric-zero', {MODE: 0}, '', 'parent-token', 'fixture-term', '0'),
    ('boolean-false', {MODE: False}, '', 'parent-token', 'fixture-term', 'false'),
    ('file-values', {}, f'{TOKEN}=file-token\n{MODE}=file-mode\n', 'file-token', 'fixture-term', 'file-mode'),
    ('explicit-wins', {TOKEN: 'explicit-token', MODE: 'explicit-mode'}, f'{TOKEN}=file-token\n{MODE}=file-mode\n', 'explicit-token', 'fixture-term', 'explicit-mode'),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node', required=True, type=Path)
    parser.add_argument('--cli', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    node, cli = args.node.resolve(), args.cli.resolve()
    inherited = {**os.environ, TOKEN: 'parent-token', 'TERM': 'fixture-term', MODE: 'parent-mode', KEEP: 'unrelated-value'}
    records = []
    with tempfile.TemporaryDirectory(prefix='mcplint-env-replay-') as temporary:
        directory = Path(temporary)
        for shape in ('servers', 'mcp.servers', 'mcpServers'):
            for name, override, env_file, token, term, mode in CASES:
                observation = directory / 'child.json'
                observation.unlink(missing_ok=True)
                (directory / 'fixture.env').write_text(env_file)
                entry = {'command': str(node), 'args': [str(HERE / 'server.mjs'), str(observation)], 'env': override}
                if env_file:
                    entry['envFile'] = str(directory / 'fixture.env')
                servers = {'fixture': entry}
                config = {'mcp': {'servers': servers}} if shape == 'mcp.servers' else {shape: servers}
                path = directory / 'mcp.json'
                path.write_text(json.dumps(config))
                run = subprocess.run([str(node), str(cli), 'config', str(path), '--format', 'json'],
                                     env=inherited, capture_output=True, text=True, timeout=20)
                report = json.loads(run.stdout)
                observed = json.loads(observation.read_text())
                expected = {TOKEN: token, 'TERM': term, MODE: mode, KEEP: 'unrelated-value'}
                expected_tools = ['read_records', 'write_records'] if token else ['read_records']
                passed = (observed == {'environment': expected, 'tools': expected_tools}
                          and report['summary']['complete'] and run.returncode == 0
                          and report['summary']['toolCount'] == len(expected_tools))
                records.append({'shape': shape, 'case': name, 'expected': expected, 'observed': observed,
                                'toolCount': report['summary']['toolCount'], 'complete': report['summary']['complete'],
                                'exitCode': run.returncode, 'matchesExpectation': passed})
    result = {'node': subprocess.check_output([str(node), '--version'], text=True).strip(),
              'platform': os.name, 'cases': len(records), 'matched': sum(row['matchesExpectation'] for row in records),
              'records': records}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + '\n')
    print(f"{result['matched']}/{result['cases']} child environments and tool inventories match expectations")


if __name__ == '__main__':
    main()
