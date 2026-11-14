#!/usr/bin/env python3
"""Verify byte-exact archived source files against pinned Git blob IDs."""
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "docs" / "SOURCE_INTEGRITY.json").read_text(encoding="utf-8"))
failures = []
for relative, expected in manifest["files"].items():
    f = ROOT / relative
    if not f.is_file():
        failures.append(f"missing: {relative}")
        continue
    data = f.read_bytes()
    got = hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\\0" + data).hexdigest()
    if got != expected:
        failures.append(f"mismatch: {relative}: {got} != {expected}")
if failures:
    print("\n".join(failures), file=sys.stderr)
    raise SystemExit(1)
print(f"PASS: {len(manifest['files'])} source and archive Git blob identities")
