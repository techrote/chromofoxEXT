import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(dir, '..');
const src = path.join(project, 'src');
const sandbox = { URL, Math, globalThis: null };
sandbox.globalThis = sandbox;
vm.runInNewContext(await readFile(path.join(src, 'logic.js'), 'utf8'), sandbox);
const L = sandbox.ChatRescueLogic;

test('accepts only ChatGPT conversation URLs', () => {
  assert.equal(L.conversationId('https://chatgpt.com/c/6af99b19-4190-83ed-8628-7b601cdf1194'), '6af99b19-4190-83ed-8628-7b601cdf1194');
  assert.equal(L.conversationId('https://chat.openai.com/c/12345678?x=1'), '12345678');
  for (const unsafe of ['https://evilchatgpt.com/c/12345678','https://chatgpt.com.evil.test/c/12345678','http://chatgpt.com/c/12345678','https://chatgpt.com/g/g-foo','https://chatgpt.com/c/no']) {
    assert.equal(L.conversationId(unsafe), null, unsafe);
  }
});

test('classifies only DOM-backed evidence, never claims full transcript', () => {
  assert.equal(L.stateFromEvidence({ eligible: false, turnCount: 20, spinnerFound: false }), 'not-conversation');
  assert.equal(L.stateFromEvidence({ eligible: true, turnCount: 1, spinnerFound: true }), 'messages-visible');
  assert.equal(L.stateFromEvidence({ eligible: true, turnCount: 0, hasError: true, spinnerFound: true }), 'error-visible');
  assert.equal(L.stateFromEvidence({ eligible: true, turnCount: 0, hasError: false, spinnerFound: true }), 'loading-indicator');
  assert.equal(L.stateFromEvidence({ eligible: true, turnCount: 0, hasError: false, spinnerFound: false }), 'unconfirmed');
});

test('pulses and guided click testing are bounded', () => {
  const points = L.ringPoints({x:200,y:100},25,L.PULSE_COUNT);
  assert.equal(points.length,16);
  assert.equal(points[0].x,225);
  assert.ok(points.every(p=>p.x>=175&&p.x<=225&&p.y>=75&&p.y<=125));
  assert.equal(L.withinRadius(220,100,{x:200,y:100},25),true);
  assert.equal(L.withinRadius(280,100,{x:200,y:100},25),false);
  assert.equal(L.MAX_CLICKS,30);
  assert.equal(L.MAX_DURATION_MS,16000);
});

test('both browser builds use minimal permissions and no background or remote dependencies', async () => {
  const res = spawnSync(process.execPath,[path.join(project,'build.mjs')],{encoding:'utf8'});
  assert.equal(res.status,0,res.stderr);
  for(const browser of ['firefox','chrome']) {
    const dir=path.join(project,'dist',browser);
    const m=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'));
    assert.equal(m.manifest_version,3);
    assert.deepEqual(m.permissions,['activeTab']);
    assert.equal(m.background,undefined);
    assert.equal(m.host_permissions,undefined);
    assert.deepEqual(m.content_scripts[0].matches,['https://chatgpt.com/*','https://chat.openai.com/*']);
    for(const file of ['content.js','logic.js','popup.js','popup.html','popup.css']) await stat(path.join(dir,file));
    if(browser==='firefox') assert.ok(m.browser_specific_settings.gecko.id);
    else assert.equal(m.browser_specific_settings,undefined);
  }
});

test('scripts parse and do not contain fetch / XHR calls', async () => {
  for(const file of ['content.js','logic.js','popup.js']) {
    const code=await readFile(path.join(src,file),'utf8');
    new vm.Script(code,{filename:file});
    assert.doesNotMatch(code,/\b(?:fetch|XMLHttpRequest)\s*\(/);
  }
});
