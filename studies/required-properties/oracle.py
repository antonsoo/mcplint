"""Independent Draft 2020-12 instance validation; requires Python jsonschema."""
import json
import platform
from importlib.metadata import version
from pathlib import Path
import sys

import jsonschema

here = Path(__file__).resolve().parent
results = []
for case in json.loads((here / "cases.json").read_text()):
    try:
        jsonschema.Draft202012Validator.check_schema(case["schema"])
        validate = jsonschema.Draft202012Validator(case["schema"])
        results.append(dict(id=case["id"], compiles=True,
                            acceptsInstance=validate.is_valid(case["instance"]),
                            acceptsEmpty=validate.is_valid({})))
    except jsonschema.SchemaError:
        results.append(dict(id=case["id"], compiles=False))
report = dict(python=platform.python_version(), jsonschema=version("jsonschema"), cases=results)
Path(sys.argv[1]).write_text(json.dumps(report, indent=2) + "\n")
