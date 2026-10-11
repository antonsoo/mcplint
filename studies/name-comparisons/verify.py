"""Run the built/installed CLI against controlled MCP SDK stdio servers.

Python 3 on POSIX; no external services or tool execution. Each audit has a
256 MiB V8 old-space limit and a 20-second watchdog. Core dumps are disabled.
The temporary configs start only the checked-in metadata fixture server.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import shutil
import signal
import subprocess
import tempfile
import time

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--cli", type=Path, default=HERE.parents[1] / "dist/cli.js")
parser.add_argument("--node", default=shutil.which("node"))
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--observe", action="store_true", help="record baseline failures without asserting")
args = parser.parse_args()
cases = {
    "long-near": (["fetch_" + "a" * 8192], ["fetch_" + "a" * 8191 + "b"]),
    "long-far": (["fetch_" + "a" * 8192], ["fetch_" + "b" * 8192]),
    "length-skew": (["fetch_" + "a" * 8192], ["fetch_invoice"]),
    "catalogue": (
        ["lookup_" + str(i).zfill(5) + "_reference_details" for i in range(600)],
        ["fetch_" + str(i).zfill(5) + "_invoice_metadata" for i in range(600)],
    ),
}


def prepare():
    os.setsid()
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


rows = []
with tempfile.TemporaryDirectory(prefix="mcplint-names-") as temporary:
    for case, names in cases.items():
        directory = Path(temporary) / case
        directory.mkdir()
        config = {"mcpServers": {}}
        for i, ns in enumerate(names):
            path = directory / f"{i}.json"
            path.write_text(json.dumps([
                {"name": name,
                 "description": "Read the recorded fixture metadata for a named object. No side effects.",
                 "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}}
                for name in ns
            ]))
            config["mcpServers"][str(i)] = {
                "command": args.node, "args": [str(HERE / "server.mjs"), str(path)]}
        path = directory / "config.json"
        path.write_text(json.dumps(config))
        started = time.monotonic()
        process = subprocess.Popen(
            [args.node, "--max-old-space-size=256", str(args.cli.resolve()), "config", str(path),
             "--format", "json", "--fail-on", "error"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, preexec_fn=prepare)
        timed_out = False
        try:
            stdout, stderr = process.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = process.communicate()
        report = json.loads(stdout) if stdout else None
        row = {
            "case": case, "nameLengths": [[len(n) for n in ns][:3] for ns in names],
            "tools": sum(map(len, names)), "elapsedSeconds": round(time.monotonic() - started, 3),
            "returncode": process.returncode, "timeout": timed_out,
            "outOfMemory": "heap out of memory" in stderr.decode(errors="replace"),
            "reportBytes": len(stdout), "summary": report["summary"] if report else None,
            "shadowing": sum(f["ruleId"] == "naming/shadowing" for f in report["findings"]) if report else None,
            "inputSha256": [hashlib.sha256((directory / f"{i}.json").read_bytes()).hexdigest() for i in range(2)],
        }
        rows.append(row)
        print(json.dumps(row), flush=True)
        if not args.observe:
            assert not timed_out and report is not None, row
            assert report["summary"]["complete"] and report["summary"]["toolCount"] == row["tools"], row
            assert process.returncode == (0 if case == "catalogue" else 1), row
            assert row["shadowing"] == (1 if case == "long-near" else 0), row
            if case.startswith("long-"):
                assert report["summary"]["byRule"]["naming/invalid-chars"] == 2, row
args.out.write_text(json.dumps({
    "node": subprocess.check_output([args.node, "--version"], text=True).strip(),
    "heapMiB": 256, "deadlineSeconds": 20, "results": rows}, indent=2) + "\n")
