"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core.js");
const NOW = Date.UTC(2026, 9, 25, 18, 0, 0);
const DAY = 86400000;

function visited(name, count, score, time = NOW) {
  return { count, score, lastUsed: time, name };
}

test("GitHub owner and repo validation excludes URL injection", () => {
  assert.equal(Core.validOwner("techrote"), true);
  assert.equal(Core.validOwner("my-org"), true);
  assert.equal(Core.validOwner("not/a/path"), false);
  assert.equal(Core.validOwner("-bad"), false);
  assert.equal(Core.validRepo("cybersand"), true);
  assert.equal(Core.validRepo("some.repo_name"), true);
  assert.equal(Core.validRepo("../../malicious"), false);
  assert.equal(Core.validRepo("not a repo"), false);
});

test("Actions URL encodes custom filters and skips empty filter", () => {
  assert.equal(Core.buildActionsUrl("techrote", "cybersand", "is:in_progress"),
    "https://github.com/techrote/cybersand/actions?query=is%3Ain_progress");
  assert.equal(Core.buildActionsUrl("techrote", "cybersand", "is:in_progress branch:main"),
    "https://github.com/techrote/cybersand/actions?query=is%3Ain_progress%20branch%3Amain");
  assert.equal(Core.buildActionsUrl("techrote", "CISmon", ""),
    "https://github.com/techrote/CISmon/actions");
  assert.throws(() => Core.buildActionsUrl("a", "x/y", ""));
});

test("v1 filters and owner settings migrate without overwriting", () => {
  const settings = Core.settingsFromStorage({ owner: "other-org", filters: "Running | is:in_progress\nOnly main | branch:main" });
  assert.equal(settings.owner, "other-org");
  assert.equal(settings.activeQuery, "is:in_progress");
  assert.equal(settings.presets[1].query, "branch:main");
  assert.equal(Core.settingsFromStorage({ activeQuery: "" }).activeQuery, "");
});

test("filter presets allow an empty query and additional pipe in query", () => {
  const presets = Core.parsePresets("Running | is:in_progress\nAll | \nCustom | branch:main | special");
  assert.equal(presets[1].query, "");
  assert.equal(presets[2].query, "branch:main | special");
  assert.throws(() => Core.parsePresets("invalid"));
});

test("a recent repeated visit beats unknown alphabetical repos for one-letter input", () => {
  const names = ["Caaa", "c3niffernggnuage", "CISmon", "cybersand", "cooltool"];
  const history = {
    "techrote/cybersand": visited("cybersand", 24, 20),
    "techrote/cismon": visited("CISmon", 4, 3),
  };
  const ranked = Core.rankRepositories(names, history, "techrote", "c", 8, NOW);
  assert.deepEqual(ranked.slice(0, 2).map(i => i.name), ["cybersand", "CISmon"]);
  assert.equal(ranked.at(-1).score, 0);
});

test("two-letter sorting uses decayed use rate rather than absolute lifetime count", () => {
  const history = {
    "techrote/concordia": visited("concordia", 999, 30, NOW - 180 * DAY),
    "techrote/cotogna": visited("cotogna", 6, 4, NOW),
  };
  const ranked = Core.rankRepositories(["concordia", "cotogna", "cobalt"], history, "techrote", "co", 8, NOW);
  assert.equal(ranked[0].name, "cotogna");
  assert.equal(ranked[1].name, "concordia");
});

test("long prefixes prefer exact matching even if another repo is popular", () => {
  const usage = { "techrote/cybersand-extra": visited("cybersand-extra", 100, 60) };
  const ranked = Core.rankRepositories(["cybersand-extra", "cybersand"], usage, "techrote", "cybersand", 8, NOW);
  assert.equal(ranked[0].name, "cybersand");
});

test("private previously-used repos appear in completion without API listing", () => {
  const usage = { "techrote/cyberprivate": visited("cyberprivate", 2, 2) };
  const results = Core.rankRepositories(["cybersand"], usage, "techrote", "cy", 8, NOW);
  assert.equal(results[0].name, "cyberprivate");
});

test("empty input only offers actual personal favourites, not an alphabetised catalog", () => {
  const hist = { "techrote/brepo": visited("brepo", 1, 1) };
  assert.deepEqual(Core.rankRepositories(["arepo", "brepo", "crepo"], hist, "techrote", "", 8, NOW).map(r => r.name), ["brepo"]);
});

test("ghost completion renders the exact candidate tail only for prefix matches", () => {
  assert.equal(Core.ghostSuffix("cy", "cybersand"), "bersand");
  assert.equal(Core.ghostSuffix("CY", "cybersand"), "bersand");
  assert.equal(Core.ghostSuffix("sand", "cybersand"), "");
  assert.equal(Core.ghostSuffix("cybersand", "cybersand"), "");
});

test("recency half-life and count increments are stable", () => {
  const first = Core.incrementUsage(undefined, NOW, "cybersand");
  assert.deepEqual(first, { count: 1, score: 1, lastUsed: NOW, name: "cybersand" });
  assert.equal(Core.popularityScore(first, NOW + 30 * DAY), 0.5);
  const second = Core.incrementUsage(first, NOW + 30 * DAY, "cybersand");
  assert.equal(second.score, 1.5);
  assert.equal(second.count, 2);
});
