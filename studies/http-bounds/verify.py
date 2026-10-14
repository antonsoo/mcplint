"""Check clean archive, installed package and retained HTTP-bound observations.

Expects the completed clean build/checks and three after replays in WORK_ROOT;
no missing or failed check is treated as success.
"""
import argparse
import hashlib
import io
import json
import subprocess
import tarfile
from pathlib import Path


def digest(raw):
    return {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}


def read(path):
    return json.loads(path.read_text())


def files(root):
    return {str(path.relative_to(root)): digest(path.read_bytes())
            for path in sorted(root.rglob('*')) if path.is_file()}


def normal(report):
    report = json.loads(json.dumps(report))
    report.pop('generatedAt')
    for server in report['servers']:
        server['label'] = 'loopback URL (ephemeral port)'
    return report


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('work_root', type=Path)
parser.add_argument('baseline_root', type=Path)
args = parser.parse_args()
root = args.work_root.resolve()
repo = Path(__file__).resolve().parents[2]
clean = root / 'clean'
results = repo / 'studies/http-bounds/results'
source = read(root / 'source-manifest.json')
for name, expected in source['files'].items():
    assert digest((clean / name).read_bytes()) == expected, name
base = 'b2b95661b0ebe3583a317b390c4392702219cf4a'
baseline_archive = subprocess.check_output(['git', 'archive', base], cwd=repo)
with tarfile.open(fileobj=io.BytesIO(baseline_archive)) as archive:
    baseline_files = [member for member in archive.getmembers() if member.isfile()]
    for member in baseline_files:
        assert archive.extractfile(member).read() == (args.baseline_root / member.name).read_bytes(), member.name
built = files(clean / 'dist')
assert built == files(repo / 'dist')
package = read(root / 'package-checks.json')
assert digest((root / package['tarball']).read_bytes()) == {key: package[key] for key in ['bytes', 'sha256']}
packed = {}
with tarfile.open(root / package['tarball']) as archive:
    for member in archive.getmembers():
        if member.isfile():
            name = member.name.removeprefix('package/')
            raw = archive.extractfile(member).read()
            assert raw == (clean / name).read_bytes() == (root / 'installed/node_modules/@antonsoloviev/mcplint' / name).read_bytes(), name
            packed[name] = digest(raw)
before, after = read(results / 'before.json'), read(results / 'after.json')
assert before['complete'] and after['complete'] and len(before['cases']) == len(after['cases']) == 9
assert after['driverSha256'] == before['driverSha256'] == digest((repo / 'studies/http-bounds/replay.mjs').read_bytes())['sha256']
for b, a in zip(before['cases'], after['cases'], strict=True):
    assert a['label'] == b['label']
    if not a['attack']:
        assert normal(a['report']) == normal(b['report'])
    else:
        assert b['signal'] == 'SIGABRT' and b['stdout'] == '' and 'heap out of memory' in b['stderr']
        assert a['signal'] is None and a['exit'] == (2 if a['attack'] == 'initialize' else 1)
        if a['report']:
            assert not a['report']['summary']['complete'] and a['report']['summary']['score'] is None
            assert a['report']['summary']['toolCount'] == 1 and a['report']['collection'][0]['retained'] == 1
installed_receipts = []
for label in ['clean-source', 'installed-current', 'installed-floor']:
    capture = read(root / label / 'receipt.json')
    assert capture['complete'] and len(capture['cases']) == 9
    for a, b in zip(capture['cases'], after['cases'], strict=True):
        assert a['label'] == b['label'] and a['exit'] == b['exit'] and a['signal'] == b['signal']
        assert normal(a['report']) == normal(b['report']) if a['report'] else a['stdout'] == b['stdout']
    receipt = {'node': capture['node'], 'workflows': 10, 'allExitStatesCorrect': True,
               'reportsMatchSource': True, 'normalization': 'Generation timestamp and ephemeral loopback URL label only.',
               'sourceCapture': 'after.json', 'sourceCaptureSha256': digest((results / 'after.json').read_bytes())['sha256'],
               'rawCapture': digest((root / label / 'receipt.json').read_bytes())}
    (results / (label + '.json')).write_text(json.dumps(receipt, indent=2) + '\n')
    installed_receipts.append(receipt)
checks = read(root / 'checks.json')
assert [check['label'] for check in checks] == ['install', 'lint', 'types', 'unit', 'unit-de', 'build', 'browser', 'good-server', 'poisoned-server']
for check in checks:
    assert check['exit'] == check['expectedExit'], check['label']
    assert digest((root / (check['label'] + '.txt')).read_bytes()) == {'bytes': check['logBytes'], 'sha256': check['logSha256']}
    destination = results / 'checks' / (check['label'] + '.txt')
    destination.parent.mkdir(exist_ok=True)
    destination.write_bytes((root / (check['label'] + '.txt')).read_bytes())
browser = read(results / 'browser/receipt.json')
assert len(browser['observations']) == 8
for view in browser['observations']:
    assert view['offline'] and not view['overflow']
    assert view['sha256'] == digest((results / (view['name'] + '.html')).read_bytes())['sha256']
    assert view.get('receivedBytesMatch') is True or view.get('fileNavigationResponseUnavailable') is True
    for key in ['pageErrors', 'externalRequests', 'axeViolations']:
        assert view[key] == []
    if view['name'] == 'diff':
        assert view['downloadMatches']
        assert read(results / 'browser' / f"{view['engine']}-{view['width']}-diff-download.json") == read(results / 'diff.json')
assert read(results / 'diff.json')['complete'] is False
assert read(results / 'diff.json')['summary']['removed'] == 0
screenshots = files(repo / 'docs/assets/http-bounds')
assert len(screenshots) == 8
verification = {'implementationCommit': source['commit'], 'baselineCommit': base,
    'machine': '14 vCPU WSL2 Linux, 48 GB RAM', 'buildNode': 'v24.21.0', 'workingBuildNode': 'v26.7.0',
    'archiveFiles': len(source['files']), 'baselineArchiveFiles': len(baseline_files),
    'sourceArchive': digest((root / 'source.tar').read_bytes()), 'baselineArchive': digest(baseline_archive),
    'archivesByteVerified': True, 'archiveUnchangedAfterChecks': True,
    'buildFiles': built, 'workingBuildMatchesClean': True,
    'package': {**package, 'files': packed, 'installedBytesMatch': True, 'published': False},
    'checks': checks, 'oversizedCases': 6, 'beforeAborts': 6, 'afterAborts': 0,
    'unchangedSdkControlReports': 3, 'installedReplays': installed_receipts,
    'browserViews': 8, 'comparisonDownloads': 4, 'screenshots': screenshots, 'screenshotsInspected': True,
    'limits': ['Constructed 96 MiB responses, not a production server census or throughput benchmark.',
               '256 MiB is a child V8 old-space cap, not total RSS.',
               'Firefox file navigation exposes no response body; exact file path/input hashes are retained.',
               'Read bounds are not an overall memory/CPU sandbox; saved inputs and accumulated pages have separate limits.',
               'No npm publication, version tag or manual hosted deployment.'],
    'harnessNotes': ['Initial legacy raw server accepted the modern POST probe at /sse; corrected to 405 before retained runs.',
                     'Stream cancellation is asynchronous; the boundary check observes it after the next event-loop turn.',
                     'Replaced element-by-element 10 MiB test Buffer equality with an exact SHA-256 comparison to avoid harness cost.']}
(results / 'verification.json').write_text(json.dumps(verification, indent=2) + '\n')
print(json.dumps({'archiveFiles': len(source['files']), 'baselineArchiveFiles': len(baseline_files),
    'buildFiles': len(built), 'packedFiles': len(packed), 'packageBytes': package['bytes'], 'packageSha256': package['sha256']}))
