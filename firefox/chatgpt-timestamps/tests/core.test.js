const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(readFileSync(require('node:path').join(__dirname, '../shared.js'), 'utf8'), context);
const C = context.CGPTTimestamp;

test('conversation routes', () => {
  assert.equal(C.conversationId('/c/12ab34cd-123'), '12ab34cd-123');
  assert.equal(C.conversationId('/g/g-Hello/c/12345678'), '12345678');
  assert.equal(C.conversationId('/'), null);
  assert.equal(C.conversationId('/share/12345678'), null);
  assert.equal(C.conversationId('/c/short'), null);
});
test('distinct per-message stable keys', () => {
  assert.notEqual(C.recordKey('abcde123', 'user', 'msg1'), C.recordKey('abcde123', 'assistant', 'msg1'));
  assert.notEqual(C.recordKey('abcde123', 'user', 'msg1'), C.recordKey('other123', 'user', 'msg1'));
  assert.equal(C.recordKey(null, 'user', 'msg1'), null);
});
test('record ranking preserves actual event over historical fallback', () => {
  const seen = { at: 1791000000000, source: 'first-seen' };
  const sent = { at: 1792000000000, source: 'sent' };
  assert.equal(C.chooseRecord(seen, sent), sent);
  assert.equal(C.chooseRecord(sent, seen), sent);
  assert.equal(C.chooseRecord(sent, { at: sent.at+1000, source:'sent' }), sent);
});
test('reject invalid records and settings', () => {
  assert.equal(Boolean(C.validRecord({at: '1792000000000', source:'sent'})), false);
  assert.equal(Boolean(C.validRecord({at: 1792000000000, source:'fake'})), false);
  assert.equal(C.normalSettings({ enabled: false, firstSeen: true, showSeconds: 'false' }).enabled, false);
  assert.equal(C.normalSettings({ enabled: false, firstSeen: true, showSeconds: 'false' }).showSeconds, false);
});
test('format differentiates historical timestamps', () => {
  assert.match(C.formatTimestamp({at:1792000000000,source:'first-seen'}, true), /^First seen: /);
  assert.doesNotMatch(C.formatTimestamp({at:1792000000000,source:'sent'}, false), /First seen/);
});
