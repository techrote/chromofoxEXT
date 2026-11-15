"use strict";
const Core = globalThis.ActionsJumperCore;
const ownerInput = document.getElementById("owner");
const queryInput = document.getElementById("active-query");
const presetsInput = document.getElementById("presets");
const picker = document.getElementById("preset-picker");
const saveStatus = document.getElementById("save-status");
const list = document.getElementById("history-list");
const empty = document.getElementById("history-empty");
let usage = {};

function report(message, error = false) {
  saveStatus.textContent = message;
  saveStatus.classList.toggle("error", error);
}

function updatePicker() {
  const oldSelected = queryInput.value;
  picker.replaceChildren();
  try {
    const presets = Core.parsePresets(presetsInput.value);
    const custom = document.createElement("option");
    custom.textContent = "Custom query";
    custom.value = "__custom__";
    picker.append(custom);
    for (const preset of presets) {
      const option = document.createElement("option");
      option.textContent = preset.label;
      option.value = preset.query;
      picker.append(option);
    }
    const match = presets.find(p => p.query === Core.normaliseQuery(oldSelected));
    picker.value = match ? match.query : "__custom__";
  } catch (_error) {
    const option = document.createElement("option");
    option.textContent = "Correct the presets below";
    option.value = "__custom__";
    picker.append(option);
  }
}

function renderPopularity() {
  const selectedOwner = ownerInput.value.trim().toLowerCase();
  const candidates = Object.entries(usage)
    .filter(([key, record]) => key.startsWith(`${selectedOwner}/`) && record?.count > 0)
    .sort((a, b) => {
      const delta = Core.popularityScore(b[1]) - Core.popularityScore(a[1]);
      return Math.abs(delta) > 1e-8 ? delta : (b[1].count - a[1].count);
    }).slice(0, 15);
  list.replaceChildren();
  empty.hidden = candidates.length > 0;
  for (const [key, record] of candidates) {
    const li = document.createElement("li");
    const label = document.createElement("strong");
    label.textContent = record.name || key.slice(selectedOwner.length + 1);
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = `${record.count} opens`;
    li.append(label, count);
    list.append(li);
  }
}

picker.addEventListener("change", () => {
  if (picker.value !== "__custom__") queryInput.value = picker.value;
});
queryInput.addEventListener("input", updatePicker);
presetsInput.addEventListener("input", updatePicker);
ownerInput.addEventListener("input", renderPopularity);

document.getElementById("configuration").addEventListener("submit", async event => {
  event.preventDefault();
  const owner = ownerInput.value.trim();
  if (!Core.validOwner(owner)) return report("Invalid GitHub account name.", true);
  try {
    const presets = Core.parsePresets(presetsInput.value);
    const activeQuery = Core.normaliseQuery(queryInput.value);
    if (activeQuery.length > 500) throw new Error("The active filter must be 500 characters or fewer.");
    await browser.storage.local.set({ owner, activeQuery, presets: Core.presetsText(presets) });
    report("Configuration saved.");
    updatePicker();
  } catch (error) {
    report(error.message, true);
  }
});

document.getElementById("clear-history").addEventListener("click", async () => {
  const owner = ownerInput.value.trim().toLowerCase();
  if (!Core.validOwner(owner)) return report("Enter a valid account first.", true);
  if (!window.confirm(`Clear autocomplete popularity for all ${owner} repositories?`)) return;
  const all = await browser.storage.local.get("usage");
  usage = Object.fromEntries(Object.entries(all.usage || {}).filter(([key]) => !key.startsWith(`${owner}/`)));
  await browser.storage.local.set({ usage });
  renderPopularity();
  report("Popularity history cleared for this account.");
});

(async () => {
  const all = await browser.storage.local.get(null);
  const settings = Core.settingsFromStorage(all);
  usage = all.usage || {};
  ownerInput.value = settings.owner;
  queryInput.value = settings.activeQuery;
  presetsInput.value = Core.presetsText(settings.presets);
  updatePicker();
  renderPopularity();
})();
