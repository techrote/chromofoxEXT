/* Independently implemented palette and group-identity helpers.
 * PlasmaTerm's LUT editor inspired the UX; no PlasmaTerm source is copied.
 */
(function (root) {
  'use strict';

  const COLORS = Object.freeze({
    blue: '#3978D5', cyan: '#14A8B5', grey: '#888888',
    green: '#299B60', orange: '#D47C28', pink: '#CF5DAA',
    purple: '#8956CB', red: '#D24B48', yellow: '#CAA52A'
  });
  const MODES = Object.freeze(['solid', 'gradient', 'bands', 'lut']);
  const STAMP_KEY = 'chromofox.tabgroup-ux.v1.identity';
  const STORE_KEY = 'chromofox.tabgroup-ux.v1.state';
  const LUT_SIZE = 256;

  function clamp(x, low, high) {
    return Math.min(high, Math.max(low, x));
  }
  function hex(input) {
    if (typeof input !== 'string') return null;
    const s = input.trim().replace(/^#/, '').toUpperCase();
    return /^[0-9A-F]{6}$/.test(s) ? '#' + s : null;
  }
  function channels(color) {
    const h = hex(color) || '#000000';
    return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  }
  function colorFromChannels(rgb) {
    return '#' + rgb.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  function mix(a, b, t) {
    const x = channels(a), y = channels(b);
    return colorFromChannels(x.map((n, i) => n + (y[i] - n) * clamp(t, 0, 1)));
  }
  function makeLut(stops) {
    const valid = (Array.isArray(stops) ? stops : []).map(hex).filter(Boolean);
    const anchors = valid.length >= 2 ? valid : ['#3978D5', '#8956CB'];
    return Array.from({length: LUT_SIZE}, (_, index) => {
      const scaled = index * (anchors.length - 1) / (LUT_SIZE - 1);
      const k = Math.min(anchors.length - 2, Math.floor(scaled));
      const t = scaled - k;
      return mix(anchors[k], anchors[k + 1], t * t * (3 - 2 * t));
    });
  }
  function hsl(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    return colorFromChannels([0, 8, 4].map(n => {
      const k = (n + (h / 30)) % 12;
      return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
    }));
  }
  function rand(seed) {
    let s = (seed >>> 0) || 0x81EA0E1;
    return function () {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  }
  function randomiseLut(current, seed, scalePercent) {
    const base = Array.isArray(current) && current.length === LUT_SIZE && current.every(c => hex(c))
      ? current.map(hex) : makeLut(['#3978D5', '#8956CB']);
    const scale = clamp(Number(scalePercent) || 0, 0, 100) / 100;
    if (!scale) return base.slice();
    const next = rand(seed), baseHue = next() * 360, span = 50 + next() * 180;
    const anchors = Array.from({length: 8}, (_, i) => hsl(
      baseHue + span * (i / 7) + (next() - 0.5) * 32,
      0.55 + next() * 0.35, 0.28 + next() * 0.34
    ));
    anchors[7] = anchors[0];
    return base.map((c, i) => {
      const x = i * 7 / (LUT_SIZE - 1), k = Math.min(6, Math.floor(x));
      const t = x - k;
      return mix(c, mix(anchors[k], anchors[k + 1], t * t * (3 - 2 * t)), scale);
    });
  }
  function normalizeAppearance(source, baseColor) {
    const x = source && typeof source === 'object' ? source : {};
    const color = COLORS[baseColor] || COLORS.blue;
    const rawStops = Array.isArray(x.stops) ? x.stops : [color, '#6B64BD'];
    const stops = rawStops.map(hex).filter(Boolean).slice(0, 8);
    if (!stops.length) stops.push(color);
    if (stops.length === 1) stops.push(stops[0]);
    const lut = Array.isArray(x.lut) && x.lut.length === LUT_SIZE && x.lut.every(c => hex(c))
      ? x.lut.map(hex) : makeLut(stops);
    return {
      mode: MODES.includes(x.mode) ? x.mode : 'solid',
      angle: Number.isFinite(x.angle) ? clamp(x.angle, 0, 360) : 90,
      bands: Number.isInteger(x.bands) ? clamp(x.bands, 2, 32) : 8,
      stops, lut,
      nativeColor: x.nativeColor === 'auto' || Object.hasOwn(COLORS, x.nativeColor) ? x.nativeColor : 'auto'
    };
  }
  function previewCss(source, baseColor) {
    const a = normalizeAppearance(source, baseColor);
    if (a.mode === 'solid') return a.stops[0];
    if (a.mode === 'gradient') return 'linear-gradient(' + a.angle + 'deg, ' +
      a.stops.map((c, i) => c + ' ' + (i * 100 / (a.stops.length - 1)).toFixed(3) + '%').join(', ') + ')';
    if (a.mode === 'lut') return 'linear-gradient(' + a.angle + 'deg, ' +
      Array.from({length: 17}, (_, i) => a.lut[Math.min(255, Math.round(i * 255 / 16))] +
        ' ' + (i * 100 / 16).toFixed(3) + '%').join(', ') + ')';
    const colors = Array.from({length: a.bands}, (_, i) => {
      const n = Math.min(a.stops.length - 1, Math.floor(i * a.stops.length / a.bands));
      const start = (100 * i / a.bands).toFixed(3), end = (100 * (i + 1) / a.bands).toFixed(3);
      return a.stops[n] + ' ' + start + '% ' + end + '%';
    });
    return 'linear-gradient(' + a.angle + 'deg, ' + colors.join(', ') + ')';
  }
  function nativeColor(source, fallback) {
    const a = normalizeAppearance(source, fallback);
    if (a.nativeColor !== 'auto') return a.nativeColor;
    const v = a.mode === 'lut' ? a.lut[127] : a.stops[Math.floor(a.stops.length / 2)];
    const rgb = channels(v);
    let winner = 'blue', distance = Infinity;
    for (const [name, sample] of Object.entries(COLORS)) {
      const c = channels(sample);
      const diff = rgb.reduce((sum, n, i) => sum + (n - c[i]) ** 2, 0);
      if (diff < distance) { distance = diff; winner = name; }
    }
    return winner;
  }
  function identityOf(stamp) {
    return stamp && typeof stamp.uid === 'string' && /^[a-zA-Z0-9_-]{4,100}$/.test(stamp.uid)
      && stamp.v === 1 ? stamp.uid : null;
  }
  function resolveIdentity(stamps) {
    const ids = [...new Set(stamps.map(identityOf).filter(Boolean))];
    if (ids.length > 1) return {uid: null, conflict: true};
    return {uid: ids[0] || null, conflict: false};
  }
  function parseImportedAppearance(value, baseColor) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Not an appearance object.');
    if (!MODES.includes(value.mode)) throw new Error('Invalid appearance mode.');
    if (!Array.isArray(value.stops) || value.stops.length < 2 || value.stops.length > 8 ||
        !value.stops.every(v => hex(v))) throw new Error('Expected 2–8 valid RGB colour stops.');
    if (value.lut != null && (!Array.isArray(value.lut) || value.lut.length !== LUT_SIZE ||
        !value.lut.every(v => hex(v)))) throw new Error('LUT must contain exactly 256 RGB colours.');
    if (value.nativeColor != null && value.nativeColor !== 'auto' &&
        !Object.hasOwn(COLORS, value.nativeColor)) throw new Error('Invalid native Firefox colour.');
    if (value.angle != null && (!Number.isFinite(value.angle) || value.angle < 0 || value.angle > 360))
      throw new Error('Angle must be between 0 and 360.');
    if (value.bands != null && (!Number.isInteger(value.bands) || value.bands < 2 || value.bands > 32))
      throw new Error('Bands must be between 2 and 32.');
    return normalizeAppearance(value, baseColor);
  }
  function parseLutText(text) {
    if (typeof text !== 'string' || text.length > 4096) throw new Error('LUT input is too large.');
    const cleaned = text.replace(/[\[\]{}()"']/g, ' ');
    const list = cleaned.split(/[\s,;]+/).filter(Boolean);
    if (list.length !== LUT_SIZE || !list.every(value => hex(value)))
      throw new Error('Expected exactly 256 valid RGB values.');
    return list.map(hex);
  }
  const api = Object.freeze({
    COLORS, MODES, STAMP_KEY, STORE_KEY, LUT_SIZE,
    clamp, hex, mix, makeLut, randomiseLut, normalizeAppearance,
    previewCss, nativeColor, identityOf, resolveIdentity,
    parseImportedAppearance, parseLutText
  });
  root.TabGroupCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
