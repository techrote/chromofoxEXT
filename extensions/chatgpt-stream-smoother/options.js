(() => {
  "use strict";
  const api = typeof browser !== "undefined" ? browser : chrome;
  const { DEFAULTS, normalize, parseLadder } = globalThis.CFSSConfig;
  const status = document.getElementById("status");
  const fields = Array.from(document.querySelectorAll("[data-key]"));
  function showMode() {
    const mode = document.getElementById("mode").value;
    for (const panel of document.querySelectorAll("[data-mode-panel]")) {
      panel.hidden = panel.dataset.modePanel !== mode;
    }
  }
  function fill(raw) {
    const settings = normalize(raw);
    for (const input of fields) {
      const value = settings[input.dataset.key];
      if (input.type === "checkbox") input.checked = Boolean(value);
      else input.value = String(value);
    }
    showMode();
  }
  function collect() {
    const raw = {};
    for (const input of fields) {
      raw[input.dataset.key] = input.type === "checkbox" ? input.checked : input.value;
    }
    if (!parseLadder(raw.speedLadder)) {
      status.textContent = "Invalid speed ladder: provide 2–32 ascending depth:speed pairs with non-decreasing speeds.";
      return null;
    }
    for (const input of fields.filter((item) => item.type === "number")) {
      const number = Number(input.value);
      if (!input.value.trim() || !Number.isFinite(number) || !input.validity.valid) {
        status.textContent = "Invalid value for " + input.parentElement.textContent.trim() + ".";
        return null;
      }
    }
    return normalize(raw);
  }
  document.getElementById("mode").addEventListener("change", showMode);
  document.getElementById("save").addEventListener("click", async () => {
    const settings = collect();
    if (!settings) return;
    try {
      await api.storage.local.set(settings);
      status.textContent = "Saved. Active ChatGPT tabs update immediately.";
    } catch (error) {
      status.textContent = "Could not save settings: " + error.message;
    }
  });
  document.getElementById("reset").addEventListener("click", () => {
    fill(DEFAULTS);
    status.textContent = "Defaults loaded into form. Select Save settings to apply.";
  });
  api.storage.local.get(DEFAULTS).then(fill).catch((error) => {
    fill(DEFAULTS);
    status.textContent = "Could not load stored settings: " + error.message;
  });
})();
