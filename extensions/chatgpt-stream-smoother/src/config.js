(function (root) {
  "use strict";

  const DEFAULTS = Object.freeze({
    enabled: false,
    mode: "buffer",
    lineHeightPx: 0,
    bottomThresholdPx: 72,
    maxLagLines: 10,
    suspendAfterScrollMs: 1300,
    respectReducedMotion: true,
    speedLadder: "0:55\n1:100\n3:190\n6:350\n12:650",
    pushAcceleration: 850,
    pushBraking: 1200,
    pushSpeedLimit: 480,
    pushRampMs: 180,
    pushLineGain: 0.85,
    animatedDurationMs: 230,
    animatedAccelerationPct: 28,
    animatedDecelerationPct: 28,
    animatedCurve: "quadratic",
    animatedAccelerationStrengthPct: 100,
    animatedDecelerationStrengthPct: 100,
    animatedCatchup: 0.35
  });

  const MODES = Object.freeze(["buffer", "push", "animated"]);
  const CURVES = Object.freeze(["linear", "quadratic", "cubic", "quintic"]);

  function numeric(value, min, max, fallback) {
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  // Each row is "buffer depth in lines : maximum speed in pixels/second".
  // The table is intentionally user-editable rather than a hard-coded curve.
  function parseLadder(value) {
    if (typeof value !== "string") return null;
    const rows = value.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
    if (rows.length < 2 || rows.length > 32) return null;
    let previousDepth = -1;
    let previousSpeed = -1;
    const ladder = [];
    for (const row of rows) {
      const match = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(row);
      if (!match) return null;
      const depth = Number(match[1]);
      const speed = Number(match[2]);
      if (!Number.isFinite(depth) || !Number.isFinite(speed) ||
          depth > 200 || speed < 1 || speed > 20000 ||
          depth <= previousDepth || speed < previousSpeed) return null;
      ladder.push({ depth, speed });
      previousDepth = depth;
      previousSpeed = speed;
    }
    return ladder;
  }

  function normalize(raw) {
    const value = raw && typeof raw === "object" ? raw : {};
    const mode = MODES.includes(value.mode) ? value.mode : DEFAULTS.mode;
    const curve = CURVES.includes(value.animatedCurve) ? value.animatedCurve : DEFAULTS.animatedCurve;
    const ladder = parseLadder(value.speedLadder);
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULTS.enabled,
      mode,
      lineHeightPx: numeric(value.lineHeightPx, 0, 90, DEFAULTS.lineHeightPx),
      bottomThresholdPx: numeric(value.bottomThresholdPx, 0, 250, DEFAULTS.bottomThresholdPx),
      maxLagLines: numeric(value.maxLagLines, 1, 40, DEFAULTS.maxLagLines),
      suspendAfterScrollMs: numeric(value.suspendAfterScrollMs, 250, 10000, DEFAULTS.suspendAfterScrollMs),
      respectReducedMotion: typeof value.respectReducedMotion === "boolean" ?
        value.respectReducedMotion : DEFAULTS.respectReducedMotion,
      speedLadder: ladder ? value.speedLadder : DEFAULTS.speedLadder,
      pushAcceleration: numeric(value.pushAcceleration, 20, 10000, DEFAULTS.pushAcceleration),
      pushBraking: numeric(value.pushBraking, 20, 10000, DEFAULTS.pushBraking),
      pushSpeedLimit: numeric(value.pushSpeedLimit, 10, 3000, DEFAULTS.pushSpeedLimit),
      pushRampMs: numeric(value.pushRampMs, 10, 2000, DEFAULTS.pushRampMs),
      pushLineGain: numeric(value.pushLineGain, 0.05, 4, DEFAULTS.pushLineGain),
      animatedDurationMs: numeric(value.animatedDurationMs, 45, 2000, DEFAULTS.animatedDurationMs),
      animatedAccelerationPct: numeric(value.animatedAccelerationPct, 0, 45, DEFAULTS.animatedAccelerationPct),
      animatedDecelerationPct: numeric(value.animatedDecelerationPct, 0, 45, DEFAULTS.animatedDecelerationPct),
      animatedCurve: curve,
      animatedAccelerationStrengthPct: numeric(value.animatedAccelerationStrengthPct, 0, 100, DEFAULTS.animatedAccelerationStrengthPct),
      animatedDecelerationStrengthPct: numeric(value.animatedDecelerationStrengthPct, 0, 100, DEFAULTS.animatedDecelerationStrengthPct),
      animatedCatchup: numeric(value.animatedCatchup, 0, 2, DEFAULTS.animatedCatchup)
    };
  }

  const api = Object.freeze({ DEFAULTS, MODES, CURVES, normalize, parseLadder });
  root.CFSSConfig = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(globalThis);
