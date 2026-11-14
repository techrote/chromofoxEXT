"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const cfg = require("../src/config.js");
const { MotionEngine, interpolateSpeed, easedProgress } = require("../src/motion.js");

test("disabled until owner opts in", () => {
  assert.equal(cfg.DEFAULTS.enabled, false);
  assert.equal(cfg.normalize({}).enabled, false);
});
test("editable ladder interpolates between ascending buffer-depth speed limits", () => {
  const rows = cfg.parseLadder("0:55\n1:100\n3:190");
  assert.equal(rows.length, 3);
  assert.equal(interpolateSpeed(2, rows), 145);
  assert.equal(interpolateSpeed(99, rows), 190);
  for (const invalid of ["", "0:55", "1:50\n1:80", "0:80\n2:20", "a:b\n1:5", "1:0\n2:3"]) {
    assert.equal(cfg.parseLadder(invalid), null, invalid);
  }
});
test("persisted settings are bounded and invalid values rejected", () => {
  const c = cfg.normalize({ mode:"bad", animatedCurve:"back", lineHeightPx:-5, speedLadder:"bad", maxLagLines:999, enabled:"yes" });
  assert.equal(c.mode, "buffer");
  assert.equal(c.animatedCurve, "quadratic");
  assert.equal(c.lineHeightPx, 0);
  assert.equal(c.maxLagLines, 40);
  assert.equal(c.enabled, false);
  assert.equal(c.speedLadder, cfg.DEFAULTS.speedLadder);
});
test("buffer drains faster when deeper", () => {
  const engine = new MotionEngine({ mode:"buffer" }, 24);
  engine.feed(24);
  const first = engine.remaining - engine.advance(16);
  engine.clear();
  engine.feed(144);
  const deep = engine.remaining - engine.advance(16);
  assert.ok(first > 0 && deep > first && deep < 144);
});
test("all modes progress monotonically and eventually settle", () => {
  for (const mode of cfg.MODES) {
    const engine = new MotionEngine({ mode }, 25);
    engine.feed(120);
    let previous = engine.remaining;
    for (let i = 0; i < 10000 && engine.remaining > 0; i++) {
      const next = engine.advance(16);
      assert.ok(next <= previous + 1e-8 && next >= 0, mode + " frame " + i);
      previous = next;
    }
    assert.equal(engine.remaining, 0, mode);
  }
});
test("negative, nonfinite inputs never create motion", () => {
  const engine = new MotionEngine({ mode:"push" }, 24);
  for (const value of [-1, NaN, Infinity, -Infinity]) engine.feed(value);
  assert.equal(engine.remaining, 0);
  assert.equal(engine.advance(NaN), 0);
});
test("backlog remains bounded in every mode", () => {
  for (const mode of cfg.MODES) {
    const engine = new MotionEngine({ mode, maxLagLines:5 }, 25);
    engine.feed(1_000_000);
    assert.equal(engine.remaining, 125);
    engine.advance(16);
    assert.ok(engine.remaining < 125);
    engine.feed(1_000_000);
    assert.equal(engine.remaining, 125);
  }
});
test("soft push ramps from rest, not immediately to full speed", () => {
  const e = new MotionEngine({ mode:"push", pushSpeedLimit:500 }, 24);
  e.feed(120);
  e.advance(16);
  const first = e.velocity;
  assert.ok(first > 0 && first < 100);
  for (let i = 0; i < 25; i++) e.advance(16);
  assert.ok(e.velocity > first);
});
test("soft push additional line demand never teleports velocity", () => {
  const e = new MotionEngine({ mode:"push" }, 24);
  e.feed(24); e.advance(16);
  const speed = e.velocity;
  e.feed(72);
  assert.equal(e.velocity, speed);
  assert.ok(e.remaining > 72);
  e.advance(16);
  assert.ok(e.velocity < 480);
});
test("acceleration and deceleration amplitudes are independently adjustable", () => {
  const accelerate = easedProgress(.15, .3, .3, 3, 1, 0);
  const decelerate = easedProgress(.15, .3, .3, 3, 0, 1);
  assert.notEqual(accelerate, decelerate);
  assert.equal(easedProgress(.4, .3, .3, 3, 0, 0), .4);
});
test("animated easing is monotonic and reaches both endpoints", () => {
  for (const power of [1, 2, 3, 5]) {
    let prior = 0;
    for (let i = 0; i <= 100; i++) {
      const p = easedProgress(i / 100, .25, .3, power, 1);
      assert.ok(p >= prior - 1e-10 && p <= 1 + 1e-10);
      prior = p;
    }
    assert.ok(Math.abs(prior - 1) < 1e-10);
  }
});
test("amplitude zero is linear and full amplitude has eased ends", () => {
  assert.equal(easedProgress(.2, .3, .3, 3, 0), .2);
  assert.ok(easedProgress(.1, .3, .3, 3, 1) < .1);
  assert.ok(easedProgress(.9, .3, .3, 3, 1) > .9);
});
test("animated line steps respect backlog catch-up", () => {
  const slow = new MotionEngine({mode:"animated",animatedCatchup:0,animatedDurationMs:400},24);
  const fast = new MotionEngine({mode:"animated",animatedCatchup:1,animatedDurationMs:400},24);
  slow.feed(240); fast.feed(240); slow.advance(64); fast.advance(64);
  assert.equal(slow.activeStep, 24);
  assert.equal(fast.activeStep, 24);
  assert.ok(fast.remaining < slow.remaining);
});
test("background-tab time does not replay stale animation", () => {
  const e = new MotionEngine({mode:"animated"},25);
  e.feed(100); e.advance(4000);
  assert.equal(e.remaining, 0);
  assert.equal(e.activeStep, 0);
});
test("three models yield different responses to matched inputs", () => {
  const results = {};
  for (const mode of cfg.MODES) {
    const e = new MotionEngine({mode},24);
    results[mode] = [24,0,24,24,0,48,0,0,24].map(x => {e.feed(x);return e.advance(16)});
  }
  assert.notDeepEqual(results.buffer, results.push);
  assert.notDeepEqual(results.push, results.animated);
});
