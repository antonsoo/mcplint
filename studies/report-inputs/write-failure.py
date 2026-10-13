"""Limit only the child to 4,096 bytes per file; no disk is filled.

Exercise a real POSIX EFBIG failure for a report and a new metadata snapshot.
"""
import argparse
import hashlib
import json
from pathlib import Path
import resource
import signal
import subprocess


parser = argparse.ArgumentParser()
parser.add_argument("directory", type=Path)
parser.add_argument("cli", type=Path)
parser.add_argument("--node", default="node")
parser.add_argument("--expect", choices=["before", "after"], default="after")
args = parser.parse_args()
root = args.directory.resolve()
root.mkdir()
fixture = (Path(__file__).resolve().parents[2] / "tests/fixtures/reference-servers/server-filesystem.json").read_bytes()


def limit_file_size():
    resource.setrlimit(resource.RLIMIT_FSIZE, (4096, 4096))
    signal.signal(signal.SIGXFSZ, signal.SIG_IGN)


cases = []
for kind in ["report", "snapshot"]:
    directory = root / kind
    directory.mkdir()
    (directory / "tools.json").write_bytes(fixture)
    (directory / "report.json").write_text("previous report")
    flags = ["--snapshot", "new.json"] if kind == "snapshot" else []
    result = subprocess.run(
        [args.node, str(args.cli.resolve()), "file", "tools.json", "--format", "json", "--output", "report.json", *flags],
        cwd=directory, capture_output=True, text=True, preexec_fn=limit_file_size,
    )
    assert result.returncode == 2, result.stderr
    assert "EFBIG" in result.stderr, result.stderr
    assert (directory / "tools.json").read_bytes() == fixture
    report = (directory / "report.json").read_bytes()
    preserved = report == b"previous report"
    assert preserved == (args.expect == "after" or kind == "snapshot")
    snapshot = directory / "new.json"
    assert snapshot.exists() == (args.expect == "before" and kind == "snapshot")
    if snapshot.exists():
        assert snapshot.stat().st_size == 4096
    assert not any(p.name.endswith(".tmp") for p in directory.iterdir())
    cases.append({"kind": kind, "exit": result.returncode, "osError": "EFBIG", "inputPreserved": True,
                  "reportPreserved": preserved, "reportBytes": len(report), "reportSha256": hashlib.sha256(report).hexdigest(),
                  "snapshotExists": snapshot.exists(), "temporaryFiles": 0})
receipt = {"mode": args.expect, "limitBytes": 4096, "cases": cases}
(root / "write-failure.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt))
