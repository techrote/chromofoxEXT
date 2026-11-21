import { cp, copyFile, mkdir, readFile, rm, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dest = path.join(root, "dist", "extension");
await rm(dest, { recursive: true, force: true });
await mkdir(path.join(dest, "vendor"), { recursive: true });
await cp(path.join(root, "src", "extension"), dest, { recursive: true });
for (const [source, name] of [
  ["@xterm/xterm/lib/xterm.js", "xterm.js"],
  ["@xterm/xterm/css/xterm.css", "xterm.css"],
  ["@xterm/addon-fit/lib/addon-fit.js", "addon-fit.js"]
]) {
  await copyFile(path.join(root, "node_modules", ...source.split("/")), path.join(dest, "vendor", name));
}
for (const [folder, label] of [["@xterm/xterm", "xterm"], ["@xterm/addon-fit", "addon-fit"]]) {
  const base = path.join(root, "node_modules", ...folder.split("/"));
  for (const filename of ["LICENSE", "LICENSE.md"]) {
    try {
      await access(path.join(base, filename));
      await copyFile(path.join(base, filename), path.join(dest, "vendor", label + "-LICENSE.txt"));
      break;
    } catch {}
  }
}
const manifest = JSON.parse(await readFile(path.join(dest, "manifest.json"), "utf8"));
if (manifest.browser_specific_settings.gecko.id !== "terminal-tabs@chromofoxext.local") {
  throw new Error("Unexpected Firefox extension identity");
}
console.log("Built offline, Firefox-first terminal extension:", dest);
