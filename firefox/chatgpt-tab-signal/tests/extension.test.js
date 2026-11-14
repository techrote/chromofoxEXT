"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const { join, dirname } = require("node:path");
const vm = require("node:vm");
const ROOT = join(__dirname, '..');

test('Firefox manifest contains only local settings permission and expected host matches', () => {
  const m = JSON.parse(readFileSync(join(ROOT,'manifest.json'),'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.permissions, ['storage']);
  assert.equal(m.action.default_popup, 'popup/popup.html');
  assert.deepEqual(m.content_scripts[0].matches, ['https://chatgpt.com/*','https://chat.openai.com/*']);
  for (const path of [
    ...m.content_scripts.flatMap(c => c.js),
    ...m.background.scripts,
    m.action.default_popup,
    ...Object.values(m.action.default_icon),
    ...m.web_accessible_resources.flatMap(r => r.resources)
  ]) assert(existsSync(join(ROOT, path)), 'Missing extension file: ' + path);
});

test('toolbar badges are independent per-tab, and the setting can clear them', async () => {
  let listener;
  const calls=[];
  const browser={
    runtime:{onMessage:{addListener(fn){listener=fn;}}},
    action:{
      async setBadgeText(arg){calls.push(['text',arg]);},
      async setBadgeBackgroundColor(arg){calls.push(['color',arg]);}
    }
  };
  vm.runInNewContext(readFileSync(join(ROOT,'background.js'),'utf8'),{browser,Promise});
  await listener({kind:'chatgpt-tab-signal/status',phase:'working',toolbarBadge:true},{tab:{id:4}});
  await listener({kind:'chatgpt-tab-signal/status',phase:'done',toolbarBadge:true},{tab:{id:7}});
  await listener({kind:'chatgpt-tab-signal/status',phase:'done',toolbarBadge:false},{tab:{id:7}});
  assert.equal(calls.find(c=>c[0]==='text'&&c[1].tabId===4)[1].text,'…');
  const tab7 = calls.filter(c => c[0]==='text' && c[1].tabId===7);
  assert.equal(tab7[0][1].text,'✓');
  assert.equal(tab7[1][1].text,'');
});
