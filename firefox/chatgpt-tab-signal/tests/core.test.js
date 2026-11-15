"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { StateMachine, PREFIX, DEFAULTS } = require("../core.js");

const working = { stopVisible: true, errorVisible: false };
const idle = { stopVisible: false, errorVisible: false };

test("opening idle conversation never falsely marks a completion", () => {
  const state = new StateMachine();
  assert.equal(state.phase, "idle");
  assert.equal(state.observe(idle, 1), false);
  assert.equal(state.phase, "idle");
});

test("generating -> successfully completed stays latched until reset", () => {
  const state = new StateMachine();
  assert.equal(state.observe(working, 100), true);
  assert.equal(state.phase, "working");
  assert.equal(state.observe(working, 200), false);
  assert.equal(state.observe(idle, 300), true);
  assert.equal(state.phase, "done");
  state.observe(idle, 350);
  assert.equal(state.phase, "done");
  assert.equal(state.reset(400), true);
  assert.equal(state.phase, "idle");
});

test("user clicking Stop is not misreported as completion", () => {
  const state = new StateMachine();
  state.observe(working, 10);
  state.markStopRequested();
  state.observe(working, 11);
  state.observe(idle, 12);
  assert.equal(state.phase, "stopped");
});

test("visible failure alert gives an error state", () => {
  const state = new StateMachine();
  state.observe(working, 10);
  state.observe({ stopVisible: false, errorVisible: true }, 11);
  assert.equal(state.phase, "error");
});

test("late error alert within the transition window reclassifies completion", () => {
  const state = new StateMachine();
  state.observe(working, 10);
  state.observe(idle, 11);
  state.observe({ stopVisible: false, errorVisible: true }, 100);
  assert.equal(state.phase, "error");
});

test("old error alerts do not retroactively change a completed response", () => {
  const state = new StateMachine();
  state.observe(working, 10);
  state.observe(idle, 11);
  state.observe({ stopVisible: false, errorVisible: true }, 9999);
  assert.equal(state.phase, "done");
});

test("starting a subsequent response resets latched status to working", () => {
  const state = new StateMachine();
  state.observe(working, 1);
  state.markStopRequested();
  state.observe(idle, 2);
  assert.equal(state.phase, "stopped");
  state.observe(working, 3);
  assert.equal(state.phase, "working");
  state.observe(idle, 4);
  assert.equal(state.phase, "done");
});

test("manual clearing of working state is the caller's responsibility", () => {
  const state = new StateMachine();
  state.observe(working, 100);
  assert.equal(state.phase, "working");
});

test("expected title indicator symbols and settings exist", () => {
  assert.deepEqual(Object.keys(PREFIX), ["idle", "working", "done", "stopped", "error"]);
  assert.equal(PREFIX.idle, "");
  assert.equal(DEFAULTS.latchUntilVisited, true);
});
