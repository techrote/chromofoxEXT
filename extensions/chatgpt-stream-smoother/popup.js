(() => {
  "use strict";
  const api = typeof browser !== "undefined" ? browser : chrome;
  const { DEFAULTS, normalize } = globalThis.CFSSConfig;
  const enabled = document.getElementById("enabled");
  const mode = document.getElementById("mode");
  const status = document.getElementById("status");
  async function save(patch) {
    try { await api.storage.local.set(patch); status.textContent = "Saved."; }
    catch (error) { status.textContent = "Could not save settings: " + error.message; }
  }
  api.storage.local.get(DEFAULTS).then((raw) => {
    const settings = normalize(raw);
    enabled.checked = settings.enabled;
    mode.value = settings.mode;
  }).catch((error) => { status.textContent = "Cannot read settings: " + error.message; });
  enabled.addEventListener("change", () => save({ enabled: enabled.checked }));
  mode.addEventListener("change", () => save({ mode: mode.value }));
  document.getElementById("advanced").addEventListener("click", () => api.runtime.openOptionsPage());
})();
