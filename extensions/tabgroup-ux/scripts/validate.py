#!/usr/bin/env python3
"""Offline Firefox Phase A package validator (no network or dependencies)."""
import json
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
assert manifest["manifest_version"] == 3
assert manifest["browser_specific_settings"]["gecko"]["strict_min_version"] == "138.0"
assert sorted(manifest["permissions"]) == ["sessions", "storage", "tabGroups"]
assert "host_permissions" not in manifest
assert "content_scripts" not in manifest
assert "nativeMessaging" not in manifest["permissions"]
files = (manifest["background"]["scripts"]
         + [manifest["action"]["default_popup"], manifest["options_ui"]["page"]])
for name in files:
    assert (ROOT / name).is_file(), f"Missing extension component: {name}"
for html in ("popup.html", "manager.html"):
    content = (ROOT / html).read_text(encoding="utf-8")
    assert "http://" not in content and "https://" not in content, "No runtime CDN dependencies"
    assert "<script" in content
print("PASS: Firefox MV3 manifest, exact extension files, local-only surface and permissions")

class IdParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
    def handle_starttag(self, tag, attrs):
        props = dict(attrs)
        if "id" in props:
            assert props["id"] not in self.ids, f"Duplicate HTML id: {props['id']}"
            self.ids.add(props["id"])

for page, script in (("manager.html", "manager.js"), ("popup.html", "popup.js")):
    doc = IdParser()
    doc.feed((ROOT / page).read_text(encoding="utf-8"))
    source = (ROOT / script).read_text(encoding="utf-8")
    if script == "manager.js":
        used = set(re.findall(r"\$\('([^']+)'\)", source))
    else:
        used = set(re.findall(r"querySelector\('#([^']+)'\)", source))
    missing = used - doc.ids
    assert not missing, f"{script} refers to missing controls: {sorted(missing)}"
print("PASS: every referenced manager/popup control has an existing unique HTML id")
