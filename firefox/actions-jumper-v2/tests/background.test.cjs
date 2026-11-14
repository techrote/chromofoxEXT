"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function mockExtension() {
  const storage = {};
  const listeners = {};
  const tabsCreated = [];
  const tabsUpdated = [];
  let fetchCalls = 0;
  const browser = {
    storage: { local: {
      async get(key) {
        if (key === null) return structuredClone(storage);
        if (typeof key === "string") return { [key]: structuredClone(storage[key]) };
        return structuredClone(storage);
      },
      async set(values) { Object.assign(storage, structuredClone(values)); },
    }},
    runtime: {
      onMessage: { addListener(fn) { listeners.message = fn; } },
      getURL(path) { return `moz-extension://test/${path}`; },
      openOptionsPage: async () => {},
    },
    windows: { async create() { return { id: 1 }; } },
    tabs: {
      async create(opts) { tabsCreated.push(opts); return { id: tabsCreated.length }; },
      async update(opts) { tabsUpdated.push(opts); return { id: tabsUpdated.length }; },
    },
    omnibox: {
      setDefaultSuggestion(value) { listeners.defaultSuggestion = value; },
      onInputStarted: { addListener(fn) { listeners.started = fn; } },
      onInputChanged: { addListener(fn) { listeners.changed = fn; } },
      onInputEntered: { addListener(fn) { listeners.entered = fn; } },
      onInputCancelled: { addListener(fn) { listeners.cancelled = fn; } },
    },
  };
  const fakeFetch = async () => {
    fetchCalls++;
    return {
      ok: true,
      async json() { return [
        { name: "CISmon" },
        { name: "cybersand" },
        { name: "c3niffernggnuage" },
      ]; },
    };
  };
  const context = vm.createContext({
    browser, fetch: fakeFetch, globalThis: undefined, AbortController,
    setTimeout, clearTimeout, console,
  });
  // In a WebExtension, globalThis is the shared background context.
  context.globalThis = context;
  const source = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
  vm.runInContext(source("core.js"), context, { filename: "core.js" });
  vm.runInContext(source("background.js"), context, { filename: "background.js" });
  return { storage, listeners, tabsCreated, tabsUpdated, get fetchCalls() { return fetchCalls; } };
}

test("background fetches repos, applies active filter and records use", async () => {
  const app = mockExtension();
  const send = msg => app.listeners.message(msg);
  await send({ type: "refresh", owner: "techrote" });
  const state = await send({ type: "snapshot" });
  assert.deepEqual([...state.names], ["c3niffernggnuage", "CISmon", "cybersand"]);
  assert.equal(app.fetchCalls, 1);
  await send({ type: "navigate", repo: "cybersand" });
  assert.equal(app.tabsCreated[0].url,
    "https://github.com/techrote/cybersand/actions?query=is%3Ain_progress");
  assert.equal(app.storage.usage["techrote/cybersand"].count, 1);
  const suggestions = await send({ type: "suggest", text: "c" });
  assert.equal(suggestions[0].name, "cybersand");
  await send({ type: "refresh", owner: "techrote" });
  assert.equal(app.fetchCalls, 1, "fresh cache avoids redundant API requests");
});

test("omnibox address bar suggestions and selected navigation use shared history", async () => {
  const app = mockExtension();
  await app.listeners.message({ type: "refresh", owner: "techrote" });
  await app.listeners.message({ type: "navigate", repo: "CISmon" });
  const suggestions = await new Promise(resolve => app.listeners.changed("c", resolve));
  assert.equal(suggestions[0].content, "CISmon");
  app.listeners.entered("cybersand", "currentTab");
  // Omnibox listener returns immediately, work is async.
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(app.tabsUpdated[0].url,
    "https://github.com/techrote/cybersand/actions?query=is%3Ain_progress");
});
