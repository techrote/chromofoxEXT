#!/usr/bin/env node
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(project, 'src');
const out = path.join(project, 'dist');
for (const browser of ['firefox', 'chrome']) {
  const dest = path.join(out, browser);
  await mkdir(dest, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(src, `manifest.${browser}.json`), 'utf8'));
  await writeFile(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const file of ['logic.js', 'content.js', 'popup.js', 'popup.html', 'popup.css']) await copyFile(path.join(src, file), path.join(dest, file));
  console.log(`Built ${browser}: ${dest}`);
}
