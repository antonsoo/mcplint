"""Print observations from retained captures; no inferred or invented values."""
import json
import sys

before, after = [json.load(open(path, encoding="utf-8")) for path in sys.argv[1:3]]
print("mcplint / actual HTTP redirect captures")
print("Synthetic credentials; local peers; actual SDK clients and CLI")
print()
print(f"{'Observed result':<49} {'Before':>8} {'After':>8}")
print("-" * 67)
for label, measure in [
    ("Cases that contacted the other origin", lambda r: r["cases_contacting_other_origin"]),
    ("Receiver requests carrying the API key", lambda r: sum(bool(x["api_key"]) for c in r["results"] for x in c["receiver_requests"])),
    ("Receiver requests carrying an MCP session ID", lambda r: sum(bool(x["session"]) for c in r["results"] for x in c["receiver_requests"])),
    ("Allowed same-origin cases completed", lambda r: sum(c["agrees"] for c in r["results"] if c["kind"] == "allowed")),
]:
    print(f"{label:<49} {measure(before):>8} {measure(after):>8}")
print()
example = next(c for c in after["results"] if c["entrypoint"] == "cli" and c["transport"] == "auto" and c["kind"] == "initial")
print("Actual blocked CLI diagnostic:")
print(example["outcome"]["diagnostic"])
print()
print(f'Capture checks: {after["cases"] - after["disagreements"]}/{after["cases"]} agree')
print("No package release or hosted deployment.")
