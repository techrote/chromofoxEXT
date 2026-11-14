"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("manifest is one offline cross-browser MV3 package with minimum permission", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["contextMenus"]);
  assert.deepEqual(manifest.background.scripts, ["background.js"]);
  assert.equal(manifest.background.service_worker, "background.js");
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
});

test("only link context registers and forwards the exact clicked URL", () => {
  let installed, clicked, menu, popout;
  const api = {
    runtime: {
      onInstalled: { addListener: (cb) => { installed = cb; } },
      getURL: (p) => "moz-extension://test/" + p
    },
    contextMenus: {
      create: (properties) => { menu = properties; },
      onClicked: { addListener: (cb) => { clicked = cb; } }
    },
    windows: { create: (properties) => { popout = properties; return Promise.resolve(); } }
  };
  vm.runInNewContext(read("background.js"), { browser: api, console });
  installed();
  assert.equal(menu.id, "link-qr-popout");
  assert.deepEqual(Array.from(menu.contexts), ["link"]);
  const link = "https://example.org/a?alpha=%23&b=2#section";
  clicked({ menuItemId: "other-menu", linkUrl: link });
  assert.equal(popout, undefined);
  clicked({ menuItemId: "link-qr-popout" });
  assert.equal(popout, undefined);
  clicked({ menuItemId: menu.id, linkUrl: link });
  assert.equal(popout.type, "popup");
  assert.equal(new URL(popout.url).pathname, "/popup.html");
  assert.equal(decodeURIComponent(new URL(popout.url).hash.slice(1)), link);
});

function qrFactory() {
  const context = vm.createContext({});
  vm.runInContext(read("vendor/qrcode.js"), context);
  return context.qrcode;
}

test("bundled QR encoder creates valid-sized deterministic symbols including UTF-8", () => {
  const encode = qrFactory();
  const examples = ["https://example.org/", "https://example.org/?q=π&emoji=🎯#go"];
  for (const value of examples) {
    const qr = encode(0, "M");
    qr.addData(value, "Byte");
    qr.make();
    const size = qr.getModuleCount();
    assert.ok(size >= 21 && size <= 177 && (size - 17) % 4 === 0);
    assert.equal(typeof qr.isDark(0, 0), "boolean");
    assert.equal(qr.isDark(0, 0), true);
    assert.equal(qr.isDark(6, 6), true);
    const copy = encode(0, "M");
    copy.addData(value, "Byte");
    copy.make();
    assert.equal(copy.getModuleCount(), size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        assert.equal(qr.isDark(y, x), copy.isDark(y, x));
      }
    }
  }
});

test("oversized URLs are rejected instead of silently truncated", () => {
  const qr = qrFactory()(0, "M");
  qr.addData("https://example.org/" + "x".repeat(4000), "Byte");
  assert.throws(() => qr.make());
});

function runPopup(hash) {
  const handlers = {};
  const rects = [];
  const elements = {
    qr: {
      width: 0, height: 0,
      getContext: () => ({
        fillStyle: "",
        fillRect(x, y, w, h) { rects.push({ x, y, w, h, fill: this.fillStyle }); }
      }),
      toDataURL: () => "data:image/png;base64,AAAA"
    },
    link: { value: "", focus() {}, select() {} },
    status: { textContent: "", dataset: {} },
    "copy-link": { addEventListener: (name, fn) => { handlers.copy = fn; } },
    "save-png": { disabled: true, addEventListener: (name, fn) => { handlers.save = fn; } }
  };
  const downloaded = [];
  const clipboard = [];
  const document = {
    getElementById: (id) => elements[id],
    createElement: () => ({
      download: "", href: "",
      click() { downloaded.push({ name: this.download, data: this.href }); },
      remove() {}
    }),
    body: { appendChild() {} }
  };
  const context = vm.createContext({
    document,
    window: { location: { hash } },
    navigator: { clipboard: { writeText: async (value) => { clipboard.push(value); } } },
    console
  });
  vm.runInContext(read("vendor/qrcode.js"), context);
  vm.runInContext(read("popup.js"), context);
  return { elements, rects, handlers, clipboard, downloaded };
}

test("popout draws sharp black modules with four-module quiet zone and supports actions", async () => {
  const link = "https://example.org/a?name=é&emoji=🎯#frag";
  const p = runPopup("#" + encodeURIComponent(link));
  assert.equal(p.elements.link.value, link);
  assert.equal(p.elements["save-png"].disabled, false);
  assert.equal(p.elements.qr.width, p.elements.qr.height);
  assert.equal(p.rects[0].fill, "#ffffff");
  const black = p.rects.filter((r) => r.fill === "#000000");
  assert.ok(black.length > 100);
  const cell = black[0].w;
  assert.ok(black.every((r) => r.x >= cell * 4 && r.y >= cell * 4));
  assert.ok(black.every((r) => r.x + cell * 4 < p.elements.qr.width &&
    r.y + cell * 4 < p.elements.qr.height));
  await p.handlers.copy();
  assert.deepEqual(p.clipboard, [link]);
  p.handlers.save();
  assert.deepEqual(p.downloaded, [{ name: "link-qr.png", data: "data:image/png;base64,AAAA" }]);
});

test("empty, invalid and oversized links fail closed", () => {
  for (const hash of ["", "#%ZZ", "#" + encodeURIComponent("https://e.co/" + "x".repeat(4000))]) {
    const p = runPopup(hash);
    assert.equal(p.elements["save-png"].disabled, true);
    assert.equal(p.elements.status.dataset.error, "true");
    assert.ok(p.elements.status.textContent.length > 5);
  }
});
