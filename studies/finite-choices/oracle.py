"""Independent JSON Schema instance validation; no MCP tool calls or type coercion."""

import hashlib
import importlib.metadata
import json
import gzip
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

source, output = map(Path, sys.argv[1:])
payload = gzip.decompress(source.read_bytes()) if source.suffix == ".gz" else source.read_bytes()
data = json.loads(payload)
for control in data["controls"]:
    schema = control["schema"]
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    accepted = [validator.is_valid(value) for value in schema["enum"]]
    assert accepted == control["accepted"]
    assert len(control["conflicts"]) == (0 if any(accepted) else 1)
for native in data["native"]:
    schema = native["schema"]
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    assert all(not validator.is_valid(item["value"]) for item in native["candidates"])
result = {
    "jsonschema_version": importlib.metadata.version("jsonschema"),
    "controls_checked": len(data["controls"]),
    "native_contradictions_checked": len(data["native"]),
    "uncompressed_input_sha256": hashlib.sha256(payload).hexdigest(),
    "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "all_accepted_values_and_conflicts_agree": True,
    "tool_calls": 0,
}
output.write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))
