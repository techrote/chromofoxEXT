(() => {
  "use strict";
  const C = globalThis.CGPTTimestamp;
  const store = browser.storage.local;
  const $ = id => document.getElementById(id);
  const checkboxes = ['enabled', 'showSeconds', 'firstSeen'];
  const status = (message, error = false) => {
    $('status').textContent = message;
    $('status').classList.toggle('error', error);
  };
  async function refresh() {
    const data = await store.get(null);
    const settings = C.normalSettings(data[C.SETTINGS_KEY]);
    for (const name of checkboxes) $(name).checked = settings[name];
    $('count').textContent = Object.entries(data).filter(([key, rec]) => key.startsWith(C.PREFIX) && C.validRecord(rec)).length.toLocaleString();
  }
  async function saveSetting(name, value) {
    // Read just before writing to preserve other settings from open popups.
    const data = await store.get(C.SETTINGS_KEY);
    await store.set({ [C.SETTINGS_KEY]: { ...C.normalSettings(data[C.SETTINGS_KEY]), [name]: value } });
    status('Setting saved.');
  }
  for (const name of checkboxes) {
    $(name).addEventListener('change', () => saveSetting(name, $(name).checked).catch(e => status(e.message, true)));
  }
  $('export').addEventListener('click', async () => {
    try {
      const stored = await store.get(null);
      const entries = Object.fromEntries(Object.entries(stored).filter(([key, rec]) => key.startsWith(C.PREFIX) && C.validRecord(rec)));
      const payload = { format: 'cgpt-timestamps-v1', exportedAt: new Date().toISOString(), records: entries };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'chatgpt-timestamps-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      status('Exported ' + Object.keys(entries).length + ' timestamps.');
    } catch (e) { status('Export failed: ' + e.message, true); }
  });
  $('import').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', async () => {
    const file = $('file').files?.[0];
    if (!file) return;
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('File exceeds 30 MB limit.');
      const parsed = JSON.parse(await file.text());
      if (parsed?.format !== 'cgpt-timestamps-v1' || !parsed.records ||
          typeof parsed.records !== 'object' || Array.isArray(parsed.records)) {
        throw new Error('Unrecognised export format.');
      }
      const previous = await store.get(null);
      const merged = {};
      for (const [key, record] of Object.entries(parsed.records)) {
        if (!key.startsWith(C.PREFIX) || !C.validRecord(record)) continue;
        const selected = C.chooseRecord(previous[key], record);
        if (selected !== previous[key]) merged[key] = selected;
      }
      if (Object.keys(merged).length) await store.set(merged);
      await refresh();
      status('Imported ' + Object.keys(merged).length + ' new or improved records.');
    } catch (e) { status('Import failed: ' + e.message, true); }
    finally { $('file').value = ''; }
  });
  $('clear').addEventListener('click', async () => {
    const okay = confirm('Delete all locally saved ChatGPT message timestamps? This cannot be undone without a JSON backup.');
    if (!okay) return;
    try {
      const data = await store.get(null);
      const keys = Object.keys(data).filter(k => k.startsWith(C.PREFIX));
      if (keys.length) await store.remove(keys);
      await refresh();
      status('Deleted ' + keys.length + ' records.');
    } catch (e) { status('Delete failed: ' + e.message, true); }
  });
  refresh().catch(e => status('Storage failed: ' + e.message, true));
})();
