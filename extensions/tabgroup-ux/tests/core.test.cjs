'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');

test('256 RGB values form a smooth, endpoint-correct LUT', () => {
  const colors = C.makeLut(['#112233','#5588AA','#ABCDEF']);
  assert.equal(colors.length,256);
  assert.equal(colors[0], '#112233');
  assert.equal(colors[255], '#ABCDEF');
  assert.ok(colors.every(c => /^#[0-9A-F]{6}$/.test(c)));
});
test('deterministic bounded randomisation, zero scale is a no-op', () => {
  const before = C.makeLut(['#FFFF00','#00FFFF']);
  const first = C.randomiseLut(before, 1850, 25);
  assert.deepEqual(first, C.randomiseLut(before, 1850, 25));
  assert.notDeepEqual(first, C.randomiseLut(before, 1851, 25));
  assert.deepEqual(C.randomiseLut(before, 1850, 0), before);
  assert.ok(first.every(c => /^#[A-F0-9]{6}$/.test(c)));
  assert.equal(first.length, 256);
  assert.deepEqual(C.randomiseLut(before, 1850, -2), before);
});
test('all pattern CSS strings are drawn only from sanitized values', () => {
  for(const mode of C.MODES) {
    const input = C.normalizeAppearance({mode,angle:90,bands:8,stops:['#113355','#88AACC']});
    assert.ok(C.previewCss(input).startsWith(mode === 'solid' ? '#' : 'linear-gradient('));
    assert.equal(C.previewCss(input).includes('url('),false);
  }
  const a = C.normalizeAppearance({mode: 'evil', stops: ['url(https://attacker/)', '#AABBCC']},'pink');
  assert.equal(a.mode,'solid');
  assert.equal(a.stops[0],'#AABBCC');
  assert.ok(!C.previewCss(a).includes('url'));
});
test('native palette always maps to exactly one Firefox-supported colour', () => {
  for(const color of Object.keys(C.COLORS)) {
    const a = C.normalizeAppearance({nativeColor:color}, 'blue');
    assert.equal(C.nativeColor(a), color);
  }
  assert.ok(C.COLORS[C.nativeColor(C.normalizeAppearance({mode:'lut'},'red'))]);
});
test('appearance imports reject bad size, style, angle, poisoned fields', () => {
  const valid = C.normalizeAppearance({mode:'lut',stops:['#123456','#ABCDEF']});
  assert.equal(C.parseImportedAppearance(valid).lut.length,256);
  assert.throws(()=>C.parseImportedAppearance({mode:'gradient',stops:['#AA0000','javascript:evil']}),/2–8/);
  assert.throws(()=>C.parseImportedAppearance({...valid,lut:valid.lut.slice(1)}),/256/);
  assert.throws(()=>C.parseImportedAppearance({...valid, nativeColor:'evil'}),/native Firefox/);
  assert.throws(()=>C.parseImportedAppearance({...valid, angle:999}),/Angle/);
  assert.throws(()=>C.parseImportedAppearance({...valid,bands:-1}),/Bands/);
  assert.throws(()=>C.parseImportedAppearance({mode:'invalid',stops:['#000000','#FFFFFF']}),/mode/);
  assert.throws(()=>C.parseImportedAppearance(null),/appearance object/);
});
test('LUT bulk import: 256 exact, valid entries or atomic rejection', () => {
  const lut = C.makeLut(['#010203','#F0F1F2']);
  assert.deepEqual(C.parseLutText(lut.map(s => s.slice(1)).join(', ')),lut);
  assert.deepEqual(C.parseLutText('[ "' + lut[0] + '", ' + lut.slice(1).join(', ') + ' ]'),lut);
  assert.throws(()=>C.parseLutText(lut.slice(0,-1).join(' ')),/256/);
  assert.throws(()=>C.parseLutText([...lut.slice(0,10),'#NOPE',...lut.slice(11)].join(' ')),/valid/);
  assert.throws(()=>C.parseLutText('x'.repeat(10000)),/too large/);
});
test('tab identity is stable through groupId change and conflicts are explicit', () => {
  const stamp = uid => ({v:1,uid});
  assert.deepEqual(C.resolveIdentity([null,stamp('g_00000001'),stamp('g_00000001')]),
    {uid:'g_00000001',conflict:false});
  assert.deepEqual(C.resolveIdentity([stamp('g_00000001'),stamp('g_00000002')]),
    {uid:null,conflict:true});
  assert.equal(C.resolveIdentity([null, undefined]).uid,null);
  assert.equal(C.identityOf({v:2,uid:'g_00000001'}),null);
});
