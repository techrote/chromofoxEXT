"use strict";

const canvas = document.getElementById("qr");
const linkField = document.getElementById("link");
const statusLine = document.getElementById("status");
const copyButton = document.getElementById("copy-link");
const saveButton = document.getElementById("save-png");

function status(message, error = false) {
  statusLine.textContent = message;
  statusLine.dataset.error = error ? "true" : "false";
}

function readLinkFragment() {
  const fragment = window.location.hash.slice(1);
  if (!fragment) {
    throw new Error("No link was supplied. Right-click a link to open its QR code.");
  }
  try {
    const decoded = decodeURIComponent(fragment);
    if (decoded.length === 0) throw new Error("Empty link");
    return decoded;
  } catch {
    throw new Error("The link could not be decoded.");
  }
}

function drawQr(link) {
  // Vendored MIT-licensed qrcode-generator. 'M' has 15% error recovery.
  const qr = qrcode(0, "M");
  qr.addData(link, "Byte");
  qr.make();

  const quietZone = 4; // Required white border, measured in QR modules.
  const modules = qr.getModuleCount();
  const sideModules = modules + quietZone * 2;
  const scale = Math.max(4, Math.ceil(800 / sideModules));
  canvas.width = sideModules * scale;
  canvas.height = sideModules * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas drawing is unavailable.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  for (let y = 0; y < modules; y++) {
    for (let x = 0; x < modules; x++) {
      if (qr.isDark(y, x)) {
        ctx.fillRect((x + quietZone) * scale, (y + quietZone) * scale, scale, scale);
      }
    }
  }
}

let selectedLink = "";
try {
  selectedLink = readLinkFragment();
  linkField.value = selectedLink;
  drawQr(selectedLink);
  saveButton.disabled = false;
  status("Ready to scan");
} catch (error) {
  status(error instanceof Error ? error.message : "Could not generate a QR code.", true);
}

copyButton.addEventListener("click", async () => {
  if (!selectedLink) return;
  try {
    await navigator.clipboard.writeText(selectedLink);
    status("Link copied");
  } catch {
    status("Clipboard access was denied. Select and copy the link above.", true);
    linkField.focus();
    linkField.select();
  }
});

saveButton.addEventListener("click", () => {
  if (saveButton.disabled) return;
  try {
    const anchor = document.createElement("a");
    anchor.href = canvas.toDataURL("image/png");
    anchor.download = "link-qr.png";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    status("PNG saved");
  } catch {
    status("Could not save PNG.", true);
  }
});
