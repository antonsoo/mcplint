#!/usr/bin/env python3
"""Summarize saved census replays; independently inspect every changed schema finding.

Requires Python jsonschema. Does not contact the registry or execute any server.
Run the four census.mjs commands in README.md first, then:
  python3 studies/schema-audit/compare.py
"""
import hashlib
import importlib.metadata
import json
from collections import Counter
from pathlib import Path
from urllib.parse import unquote

from jsonschema import Draft202012Validator, SchemaError

HERE = Path(__file__).resolve().parent
CENSUS = HERE.parent / "registry-census"
CACHE = CENSUS / "cache"


def load_rows(label):
    return [json.loads(line) for line in (CACHE / f"census-{label}.jsonl").read_text().splitlines()]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def schema_findings(row):
    return [f for f in row["findings"] if f["rule"] in {"schema/invalid", "safety/unchecked"}]


def counts(rows):
    findings = [f for row in rows for f in schema_findings(row)]
    return {
        "servers": len(rows), "tools": sum(row["tools"] for row in rows),
        "affectedServers": sum(bool(schema_findings(row)) for row in rows),
        "byRule": dict(Counter(f["rule"] for f in findings)),
        "byField": dict(Counter(f["message"].split()[0] for f in findings)),
    }


def local_pointer_exists(schema, ref):
    assert ref.startswith("#/"), f"Review non-pointer reference manually: {ref}"
    value = schema
    try:
        for segment in unquote(ref[2:]).split("/"):
            segment = segment.replace("~1", "/").replace("~0", "~")
            value = value[int(segment)] if isinstance(value, list) else value[segment]
    except (KeyError, IndexError, ValueError, TypeError):
        return False
    return True


report = {"baselineCommit": "b1438c0", "jsonschemaVersion": importlib.metadata.version("jsonschema"), "samples": {}}
for directory, suffix, manifest in [("servers", "", "manifest.json"), ("heldout", "-heldout", "manifest-heldout.json")]:
    before = load_rows(f"schemas-before{suffix}")
    after = load_rows(f"schemas-after{suffix}")
    assert [row["name"] for row in before] == [row["name"] for row in after]
    assert not any(row.get("failed") for row in before + after)
    changed = []
    sources = []
    oracle = Counter()
    output_schemas = 0
    for old, new in zip(before, after):
        name = new["name"]
        path = CACHE / directory / f"{hashlib.sha1(name.encode()).hexdigest()}.json"
        sources.append({"server": name, "sha256": digest(path)})
        raw = json.loads(path.read_text())
        output_schemas += sum("outputSchema" in tool for tool in raw["tools"])
        # No changes in attack, naming, description, token or portability findings.
        unaffected = lambda row: [f for f in row["findings"] if f["rule"] not in {"schema/invalid", "safety/unchecked"}]
        assert unaffected(old) == unaffected(new), name
        for finding in schema_findings(new):
            message = finding["message"]
            field = message.split()[0]
            matches = [tool for tool in raw["tools"] if tool["name"] == finding["subject"].removeprefix("tool:")]
            assert len(matches) == 1, f"Ambiguous tool attribution: {name}: {finding['subject']}"
            schema = matches[0][field]
            assert "$schema" not in schema, "Select the declared independent validator if this changes"
            if finding["rule"] == "schema/invalid":
                try:
                    Draft202012Validator.check_schema(schema)
                except SchemaError:
                    oracle["malformedSchemasConfirmed"] += 1
                else:
                    raise AssertionError(f"Independent validator accepted {name}: {finding}")
            elif 'JSON Schema compiler could not finish:' in message:
                Draft202012Validator.check_schema(schema)
                oracle["compilerLimitationsConfirmed"] += 1
            else:
                prefix = f"{field} could not be fully checked: Unresolved schema reference "
                assert message.startswith(prefix), message
                reference, _ = json.JSONDecoder().raw_decode(message[len(prefix):])
                assert not local_pointer_exists(schema, reference), f"Pointer exists: {name}: {reference}"
                oracle["missingLocalPointersConfirmed"] += 1
        if schema_findings(old) != schema_findings(new):
            changed.append({"server": name, "before": schema_findings(old), "after": schema_findings(new)})
    report["samples"][directory] = {
        "manifestSha256": digest(CENSUS / manifest), "outputSchemas": output_schemas,
        "before": counts(before), "after": counts(after), "independentChecks": dict(oracle),
        "sources": sources, "changed": changed,
    }

(HERE / "corpus-results.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({name: {k: v for k, v in sample.items() if k not in {"sources", "changed"}} for name, sample in report["samples"].items()}, indent=2))
