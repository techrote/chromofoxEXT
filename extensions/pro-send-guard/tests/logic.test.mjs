import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const sandbox = { globalThis: null };
sandbox.globalThis = sandbox;
vm.runInNewContext(await readFile(path.join(src, 'mode.js'), 'utf8'), sandbox);
const L = sandbox.ChromofoxProSendLogic;

test('model family, effort and Pro variants classify without treating subscription text as selection', () => {
  for (const value of ['Pro', 'Pro Standard', 'Pro Extended', 'GPT-6 Pro', 'GPT-5.6 Pro', 'GPT-5.6 Sol Pro', '5.6 Pro', 'Model: Pro', 'Pro · Extended']) {
    assert.equal(L.classify(value), 'pro', value);
  }
  for (const value of ['Instant', 'Thinking', 'Medium', 'High', 'Extra High', 'GPT-5.6 Sol', 'GPT-6 Thinking']) {
    assert.equal(L.classify(value), 'non-pro', value);
  }
  for (const value of ['Upgrade to Pro', 'Get Pro', 'Your Pro plan', 'Pro account', 'Professional', 'GPT-6', '', 'Send message']) {
    assert.equal(L.classify(value), 'unknown', value);
  }
});

test('builds both MV3 browser targets with document_start and no network permissions', async () => {
  const res = spawnSync(process.execPath, [path.join(root, 'build.mjs')], { encoding:'utf8' });
  assert.equal(res.status, 0, res.stderr);
  for (const browser of ['firefox', 'chrome']) {
    const dir = path.join(root, 'dist', browser);
    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions, ['storage']);
    assert.equal(manifest.background, undefined);
    assert.equal(manifest.host_permissions, undefined);
    assert.equal(manifest.content_scripts[0].run_at, 'document_start');
    assert.deepEqual(manifest.content_scripts[0].matches, ['https://chatgpt.com/*', 'https://chat.openai.com/*']);
    assert.deepEqual(manifest.content_scripts[0].js, ['mode.js', 'content.js']);
    for (const filename of ['mode.js', 'content.js', 'popup.js', 'popup.html', 'popup.css']) await stat(path.join(dir, filename));
    if (browser === 'firefox') assert.ok(manifest.browser_specific_settings.gecko.id);
    else assert.equal(manifest.browser_specific_settings, undefined);
  }
});

test('all scripts parse, never use network, runtime no synthetic dispatch or transcript logging', async () => {
  for (const filename of ['mode.js', 'content.js', 'popup.js']) {
    const source = await readFile(path.join(src, filename), 'utf8');
    new vm.Script(source, { filename });
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket)\s*\(/);
  }
  const source = await readFile(path.join(src, 'content.js'), 'utf8');
  assert.doesNotMatch(source, /dispatchEvent|\.click\(/);
  assert.match(source, /stopImmediatePropagation/);
  assert.match(source, /expiresAt/);
});
