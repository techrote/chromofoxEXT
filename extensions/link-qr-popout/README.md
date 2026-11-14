# Link QR Popout

A small standalone cross-browser extension that adds **Display link as QR code** to the native link right-click context menu. It opens a separate 430-pixel-wide popout window containing a locally generated QR code, the exact clicked link, Copy link and Save PNG buttons.

## Install for local testing

**Firefox (temporary, unsigned):**
1. Open about:debugging#/runtime/this-firefox.
2. Choose Load Temporary Add-on.
3. Select this directory's manifest.json file.

**Chrome / Chromium (unpacked):**
1. Open chrome://extensions and enable Developer mode.
2. Choose Load unpacked.
3. Select this directory (the one containing manifest.json).

The extension uses one Manifest V3 manifest across both browser families. Firefox uses the background.scripts entry; Chromium uses background.service_worker. Firefox temporary extensions are removed on browser restart. Permanent Firefox distribution requires appropriate add-on signing.

## Try it

Right-click an ordinary hyperlink, select **Display link as QR code**, and scan the popout with a phone. Try a link containing query parameters, percent escapes and a fragment: its complete URL should appear in the QR (the link itself, not the current tab). The popout may remain open while you use the original page.

**Privacy:** No network requests, content scripts, analytics, QR-generation service or host permissions. Only the contextMenus permission is requested. The selected URL is passed through the fragment of an internal extension page and is never sent to a remote service. QR encoding uses the locally bundled MIT-licensed qrcode-generator library. Beware that scanning a QR code on another device will open its embedded link using that device's browser; inspect links before navigating.

**Limits:** QR code Model 2 byte-mode capacity applies (up to 2,331 UTF-8 bytes at medium error correction); long links display a failure message rather than an invalid QR. Pages whose context menus are browser-restricted cannot expose the command. Clipboard access is tied to the Copy link button and may be denied by browser policy.

## Checks

Run from this directory, with Node.js 20 or newer:

    node --test tests/extension.test.cjs
    node --check background.js
    node --check popup.js

Then perform manual browser acceptance in Firefox and Chromium: installed menu, click-to-popout, real phone scan, Copy link, Save PNG, two links in separate popouts, and behavior following a browser restart. Automated tests cannot substitute for those browser checks.

## Source attribution

The bundled vendor/qrcode.js is the unmodified dist file from Kazuhiko Arase's MIT-licensed qrcode-generator:
https://github.com/kazuhikoarase/qrcode-generator/blob/83b7e8fe3fddd3b0368dbafd6ce56995bd25e3c8/js/dist/qrcode.js

The corresponding license is in vendor/LICENSE. Git blob SHA of the vendored JavaScript: df13f829bf41f36b82f0ed85751ed3b4c39cfeb8.
