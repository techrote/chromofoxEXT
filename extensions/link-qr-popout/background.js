"use strict";

// Firefox uses browser; Chromium uses chrome. Both support these WebExtension APIs.
const ext = globalThis.browser || globalThis.chrome;
const MENU_ID = "link-qr-popout";

ext.runtime.onInstalled.addListener(() => {
  // Registered on install/update, not on every background worker wake-up.
  ext.contextMenus.create({
    id: MENU_ID,
    title: "Display link as QR code",
    contexts: ["link"]
  });
});

ext.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID || typeof info.linkUrl !== "string" || info.linkUrl.length === 0) {
    return;
  }

  // Encode only in the extension page fragment (not an external QR service).
  // A separate popout permits the user to scan the code without losing the page.
  const popupUrl = ext.runtime.getURL("popup.html") + "#" + encodeURIComponent(info.linkUrl);
  const result = ext.windows.create({
    url: popupUrl,
    type: "popup",
    width: 430,
    height: 555
  });

  if (result && typeof result.catch === "function") {
    result.catch((error) => console.error("Could not open the QR popout:", error));
  }
});
