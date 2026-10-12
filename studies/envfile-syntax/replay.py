#!/usr/bin/env python3
"""Run actual config/envFile launches against a synthetic authentication fixture."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node', required=True, type=Path)
    parser.add_argument('--cli', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    node, cli = args.node.resolve(), args.cli.resolve()
    cases = json.loads((HERE / 'cases.json').read_text())
    environment = dict(os.environ)
    for key in ('MCPLINT_ENVFILE_TOKEN', 'MCPLINT_ENVFILE_NOTE'):
        environment.pop(key, None)
    records = []
    with tempfile.TemporaryDirectory(prefix='mcplint-envfile-replay-') as temporary:
        directory = Path(temporary)
        for case in cases:
            expected = {'token': case['token'], 'note': case.get('note')}
            expected_path, observation = directory / 'expected.json', directory / 'child.json'
            expected_path.write_text(json.dumps(expected))
            observation.unlink(missing_ok=True)
            (directory / 'fixture.env').write_bytes(case['text'].encode('utf-8'))
            config = {'servers': {'fixture': {'command': str(node),
                      'args': [str(HERE / 'server.mjs'), str(expected_path), str(observation)],
                      'envFile': str(directory / 'fixture.env')}}}
            path = directory / 'mcp.json'
            path.write_text(json.dumps(config))
            run = subprocess.run([str(node), str(cli), 'config', str(path), '--format', 'json', '--fail-on', 'error'],
                                 env=environment, capture_output=True, text=True, timeout=20)
            report = json.loads(run.stdout)
            observed = json.loads(observation.read_text())
            passed = (observed == expected and run.returncode == 0 and report['summary']['complete']
                      and report['summary']['toolCount'] == 1)
            records.append({'case': case['id'], 'expected': expected, 'observed': observed,
                            'exitCode': run.returncode, 'complete': report['summary']['complete'],
                            'tools': report['summary']['toolCount'], 'matchesExpectation': passed})
    result = {'node': subprocess.check_output([str(node), '--version'], text=True).strip(),
              'platform': os.name, 'cases': len(records), 'matched': sum(row['matchesExpectation'] for row in records),
              'records': records}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + '\n')
    print(f"{result['matched']}/{result['cases']} .env files launch the expected fixture successfully")


if __name__ == '__main__':
    main()
