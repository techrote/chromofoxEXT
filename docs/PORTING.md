# Cross-browser development notes

Keep the original Chrome and Firefox snapshots intact. Do **not** assume copying the Chrome MV3 manifest into Firefox constitutes a working port.

- Verify background lifetimes: the Chrome QOL Suite uses a Manifest V3 `background.service_worker`; the Firefox utilities use their original Firefox-compatible background scripts or no background.
- Validate `browser_specific_settings.gecko`, permission prompts, extension IDs, popup/options behaviour, notifications, and extension-local storage under both engines.
- Check manifest `web_accessible_resources`, timing of content scripts and SPA navigation events.
- Avoid duplicate send interception if the consolidated Chrome QOL suite is co-installed with standalone send guards.
- Overlap worth future evaluation: Firefox Tab Signal vs Chrome Response Completion Watch. They solve related tab-attention tasks but do not share a single state model or selectors.
- Distinguish local **observed** state from ChatGPT server state, and local model/usage metadata from verified quota.
- Prefer a small browser-adapter boundary for DOM selectors and browser APIs rather than full rewrites before owner acceptance.

Any port or integration deserves a separate implementation branch, browser matrix, regression fixture updates and explicit user review. This archive import does not authorise publication or invasive browser automation.
