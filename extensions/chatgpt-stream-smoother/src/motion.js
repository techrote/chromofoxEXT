(function (root) {
  "use strict";

  const CONFIG = root.CFSSConfig ||
    (typeof require === "function" ? require("./config.js") : null);

  function interpolateSpeed(depth, ladder) {
    if (depth <= ladder[0].depth) return ladder[0].speed;
    for (let i = 1; i < ladder.length; i += 1) {
      if (depth <= ladder[i].depth) {
        const low = ladder[i - 1];
        const high = ladder[i];
        const fraction = (depth - low.depth) / (high.depth - low.depth);
        return low.speed + fraction * (high.speed - low.speed);
      }
    }
    return ladder[ladder.length - 1].speed;
  }

  // Integrated trapezoidal/curved velocity profile. No overshoot or easing
  // discontinuity, and acceleration and deceleration can be adjusted separately.
  function easedProgress(t, accelerationFraction, decelerationFraction, power, strength) {
    const u = Math.max(0, Math.min(1, t));
    const a = Math.max(0, Math.min(0.45, accelerationFraction));
    const d = Math.max(0, Math.min(0.45, decelerationFraction));
    const p = Math.max(1, power);
    const area = 1 - (a + d) * p / (p + 1);
    let integrated;
    if (a > 0 && u < a) {
      integrated = Math.pow(u, p + 1) / ((p + 1) * Math.pow(a, p));
    } else if (u <= 1 - d) {
      integrated = a / (p + 1) + (u - a);
    } else if (d > 0) {
      integrated = a / (p + 1) + (1 - a - d) +
        d / (p + 1) * (1 - Math.pow((1 - u) / d, p + 1));
    } else {
      integrated = a / (p + 1) + (u - a);
    }
    const smooth = integrated / area;
    return (1 - strength) * u + strength * smooth;
  }

  const POWERS = { linear: 1, quadratic: 2, cubic: 3, quintic: 5 };

  class MotionEngine {
    constructor(options, linePx) {
      this.options = CONFIG.normalize(options);
      this.linePx = Math.max(8, Math.min(90, Number(linePx) || 24));
      this.maxLagPx = this.linePx * this.options.maxLagLines;
      this.ladder = CONFIG.parseLadder(this.options.speedLadder);
      this.clear();
    }

    clear() {
      this.remaining = 0;
      this.velocity = 0;
      this.drive = 0;
      this.activeStep = 0;
      this.stepElapsedMs = 0;
      this.stepDurationMs = 0;
    }

    feed(pixels) {
      const delta = Number(pixels);
      if (!Number.isFinite(delta) || delta <= 0) return this.remaining;
      this.remaining = Math.min(this.maxLagPx, this.remaining + delta);
      return this.remaining;
    }

    advance(milliseconds) {
      let dt = Number(milliseconds);
      if (!Number.isFinite(dt) || dt <= 0 || this.remaining <= 0) return this.remaining;
      // Returning from a background tab should not replay seconds of stale text.
      if (dt > 300) {
        this.clear();
        return 0;
      }
      dt = Math.min(dt, 80);
      if (this.options.mode === "push") this.advancePush(dt / 1000);
      else if (this.options.mode === "animated") this.advanceAnimated(dt);
      else this.advanceBuffer(dt / 1000);
      if (this.remaining < 0.25) this.clear();
      return this.remaining;
    }

    advanceBuffer(dt) {
      const speed = interpolateSpeed(this.remaining / this.linePx, this.ladder);
      this.remaining = Math.max(0, this.remaining - speed * dt);
    }

    advancePush(dt) {
      const opt = this.options;
      const demand = Math.min(1, this.remaining / this.linePx * opt.pushLineGain);
      const blend = 1 - Math.exp(-dt * 1000 / opt.pushRampMs);
      this.drive += (demand - this.drive) * blend;
      const stoppingSpeed = Math.sqrt(2 * opt.pushBraking * this.remaining);
      const targetSpeed = Math.min(opt.pushSpeedLimit,
        stoppingSpeed, opt.pushSpeedLimit * demand);
      if (this.velocity < targetSpeed) {
        this.velocity = Math.min(targetSpeed,
          this.velocity + opt.pushAcceleration * this.drive * dt);
      } else {
        this.velocity = Math.max(targetSpeed, this.velocity - opt.pushBraking * dt);
      }
      this.remaining = Math.max(0, this.remaining - this.velocity * dt);
    }

    advanceAnimated(dt) {
      let budget = dt;
      let loops = 0;
      while (budget > 0.001 && this.remaining > 0.001 && loops < 20) {
        loops += 1;
        if (!this.activeStep) {
          this.activeStep = Math.min(this.linePx, this.remaining);
          const extraLines = Math.max(0, this.remaining / this.linePx - 2);
          const factor = 1 + Math.min(10, extraLines) * this.options.animatedCatchup;
          this.stepDurationMs = Math.max(45, this.options.animatedDurationMs / factor);
          this.stepElapsedMs = 0;
        }
        const available = this.stepDurationMs - this.stepElapsedMs;
        const slice = Math.min(budget, available);
        const before = this.stepElapsedMs / this.stepDurationMs;
        const after = (this.stepElapsedMs + slice) / this.stepDurationMs;
        const ease = (progress) => easedProgress(progress,
          this.options.animatedAccelerationPct / 100,
          this.options.animatedDecelerationPct / 100,
          POWERS[this.options.animatedCurve],
          this.options.animatedStrengthPct / 100);
        this.remaining = Math.max(0, this.remaining -
          this.activeStep * (ease(after) - ease(before)));
        this.stepElapsedMs += slice;
        budget -= slice;
        if (this.stepElapsedMs >= this.stepDurationMs - 0.0001) {
          this.activeStep = 0;
          this.stepElapsedMs = 0;
        }
      }
    }
  }

  const api = Object.freeze({ MotionEngine, interpolateSpeed, easedProgress });
  root.CFSSMotion = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(globalThis);
