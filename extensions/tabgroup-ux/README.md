# TABGROUP-UX-001 · Phase A — Firefox Tab Groups Enhanced

Experimental **Firefox-first** WebExtension targeting **Firefox 159 / Windows 11**. Firefox 138+ native tab-group APIs are required. [Feature issue #11](https://github.com/techrote/chromofoxEXT/issues/11).

This component is independent of other chromofoxEXT extensions. It requires **no host/page permissions**, telemetry, native messaging, network calls or remote scripts.

## Shipped Phase A features

- Popup lists native Firefox tab groups in the current window and toggles **Soft lock** per group.
- Full group manager lists all windows' native groups, with a per-group membership lock, global pause and opt-in default lock for new groups. By default all groups are unlocked.
- Edit the native group title and an appearance profile. Local previews support solid, linear gradients, banded stripes and a 256-colour LUT.
- 2–8 colour stops, angle, stripe count, 256 individually editable hex cells, bulk LUT import/export, JSON appearance import/export, five palette presets and scaled, seeded LUT randomisation.
- Native Firefox tab strip receives **only one of its nine named colours** (automatically approximated or explicitly chosen). Arbitrary patterns are stored and previewed for future Phase B integration.
- Stable group identity stored via Firefox's session-associated values on each member tab, not by raw group ID or title. On restart identities reconstruct from current member tabs.
- Conflicting or duplicate restored identities are explicitly marked unmanaged rather than automatically merged, with an explicit reset/unlock action.
- A locked tab moved away from its group is restored on a best-effort basis **after** the browser reports the move. If the sole group member was moved away, a new native group can be created with its former title and named colour.

## Limitations and safety

1. **Phase B**, not A, includes native tab-strip gradients, tab-close-X hiding, and two-sided draggable group bookends. Phase A does not style Firefox's native tab strip.
2. There is **no pre-drag veto** in the supported WebExtensions API. Recovery can briefly reorder or flicker tabs. Other extensions and browser operations can bypass recovery. This is not kiosk/close protection.
3. Locked tabs transferred to another window are left there; the extension never forcibly steals a tab back to a different window. Normal cross-window group moves are observed separately.
4. A pinned tab is not forcibly regrouped: grouping it would silently unpin it.
5. Private groups are excluded from managed identity because their session restoration is not durable. Any unreadable/ambiguous identities are visibly unmanaged.
6. Firefox's browser session restoration settings affect what can be recovered. If the session stamp is absent on restore, the group gets a new identity and the configured new-group lock default is applied. Existing titles do **not** act as identities.
7. Closed tabs are **never reopened**. Removing or disabling the extension leaves native tab groups intact; extension-specific stored state may be deleted on uninstall.

## Temporary Firefox installation

1. Download a source-matched GitHub Actions artifact ZIP from this PR, or check out the feature branch.
2. Extract it. Visit **about:debugging#/runtime/this-firefox** in Firefox 138+.
3. Click **Load Temporary Add-on** and select the **manifest.json** file at the ZIP root (or extensions/tabgroup-ux/manifest.json in the checkout).
4. Create two or more native Firefox tab groups and open the toolbar button. Open **Group manager & palettes** for the extended editor.
5. Test switching soft locks, dragging grouped tabs out and between groups, editing an appearance, changing Firefox native named colour, and changing windows.

Temporary add-ons do **not** survive Firefox restart. For genuine restart/restore acceptance, install a developer-signed build instead. An unsigned source ZIP is not permanently installable in normal release Firefox.

**Escape:** In the extension manager, tick **Pause membership protection** to stop recovery. Reset a conflicting group with **Reset group identity (unlock)**. Disable/remove the add-on through Firefox Add-ons or about:debugging.

## Tests and source identity

From extensions/tabgroup-ux:

- npm run check
- python scripts/validate.py

No Node dependencies are required beyond Node 20+. GitHub Actions runs the same checks on Linux and Windows, records source commit/tree IDs, and publishes the temporary add-on ZIP from the exact PR HEAD.

Automated tests cover deterministic LUT generation, invalid imports, CSS sanitisation, tab-group identity collisions, lock/unlock and reattachment, singleton deletion recovery, windows, private groups, pausing, group-ID remapping on session restore, native named colour saving and deliberate tab closure.

**Acceptance:** Source-matched CI does not substitute for physical Windows 11 / Firefox 159 testing. This branch/PR stays **Draft/HOLD**; do not merge or publish before owner review.

## Architecture and source provenance

- Firefox MV3 **background event page**, using the supported scripts mechanism rather than a Chrome-style service worker.
- src/service.js serialises native tab events and UI mutations; all user-visible operations occur through the extension's own runtime messaging.
- src/core.js is an independently developed colour/LUT engine. Its UX is inspired by [PlasmaTerm's web LUT editor](https://github.com/techrote/PlasmaTerm/tree/web-v0.1a/web), but **no AGPL-3.0 PlasmaTerm source was copied**.
- The manager uses local HTML/CSS/JS, no CDN or webpage content scripts. Group titles are inserted with DOM text nodes, not unsanitised HTML.

References: [MDN tabGroups](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabGroups), [MDN tabs.group](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/group) and [MDN sessions.setTabValue](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sessions/setTabValue).
