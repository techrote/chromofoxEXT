# ChatGPT Stream Smoother — experimental v0.1.0

Self-contained, no-build Firefox/Chromium MV3 extension for chatgpt.com. Smooths the hard vertical jumps as streaming replies grow. This is a **prototype, not yet tested on the live ChatGPT UI**.

## Modes

| Model | Mechanism | Controls |
| --- | --- | --- |
| Standard input buffer | Measured displacement enters a visual lag buffer; interpolate release speed from a user-editable list of depth (lines) : speed (px/s) limits | Arbitrary ascending depth/speed table, auto or manual line height, max lag |
| Soft push | Each new displacement increases ramped acceleration demand; dynamic braking and speed ceiling | Acceleration, braking, speed cap, ramp duration, line impulse gain |
| Animated | Retain line-by-line progression, but ease each step's velocity separately | Line duration, separate acceleration/deceleration fractions and amplitudes, curve, catch-up |

The feature alters *visual movement*, not token streaming, insertion or content. It leaves ChatGPT's internal scroll API and actual scroll position unchanged.

## Motion adapter

Find the latest assistant message and its scrollable conversation wrapper, including reverse-flex layouts. Observe DOM mutations and measure a stable message anchor. On a small upward position change during streaming, translate the wrapper downward before paint to compensate for the jump. Drain the resulting visual offset with requestAnimationFrame and the selected model.

Manual wheel, touch or keyboard scrolling suspends smoothing immediately. Moving away from the bottom, resizing, changing conversations, disabling the extension or reduced-motion preferences restores native scrolling. The adapter fails closed if it cannot identify an independently movable wrapper; it does not move the sidebar or composer. A maximum lag cap limits pathologically slow settings and burst growth.

## Install temporarily and test

**Firefox first:** open about:debugging#/runtime/this-firefox, choose **Load Temporary Add-on**, and pick this folder's manifest.json. Open chatgpt.com, click the toolbar icon and **enable smoothing** (off by default). Fine-grained controls open an options tab; press **Save settings** to apply.

**Chromium:** chrome://extensions → Developer mode → Load unpacked → choose this extension folder.

### Owner acceptance

- [ ] At the bottom of a lengthy streamed reply, all three modes visibly smooth movement.
- [ ] Editing buffer speed rows, push acceleration/braking and animated ramp shape makes a noticeable difference.
- [ ] Wheel/trackpad upward during generation interrupts smoothing with no forced downward scroll; returning to the bottom resumes.
- [ ] Switching the toolbar toggle off during generation returns to unmodified native scrolling.
- [ ] Conversations can be changed, scrolled, resized and virtualized without moving the composer, sidebar or overlay controls.
- [ ] System reduced-motion preference works; override only when explicitly selected.
- [ ] Firefox acceptance first, then Chromium; inspect frame pacing and performance in very long threads.

## Qualification boundary

Source is independent of the pending historical-archive PR. Run deterministic model tests with: node --test test/*.test.cjs. No dependencies, model-content capture, analytics, external requests or broad host permissions; only storage permission and chatgpt.com content-script access.

ChatGPT's DOM and scrolling algorithm are not stable public APIs. A new renderer, virtualized turn replacement, reverse-scroll coordinate change or streaming of dynamically sized media may invalidate the adapter; in those cases it should release control rather than break site navigation. Large sudden layout shifts can still jump once because lag is deliberately bounded. **Do not merge without Firefox owner acceptance and a Chromium smoke test.**
