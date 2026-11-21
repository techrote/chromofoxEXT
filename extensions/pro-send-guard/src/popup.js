(() => {
  'use strict';
  const defaults = { enabled: true, protectUnknown: true };
  const status = document.querySelector('#status');
  const controls = Object.fromEntries(Object.keys(defaults).map(key => [key, document.getElementById(key)]));
  function error(message) { status.className = 'error'; status.textContent = message; }
  chrome.storage.local.get(defaults, values => {
    if (chrome.runtime.lastError) { error('Cannot read preferences; protective defaults remain in effect.'); return; }
    for (const key of Object.keys(defaults)) controls[key].checked = typeof values[key] === 'boolean' ? values[key] : defaults[key];
  });
  for (const key of Object.keys(defaults)) controls[key].addEventListener('change', () => {
    chrome.storage.local.set({ [key]: controls[key].checked }, () => {
      if (chrome.runtime.lastError) error('Could not save preference.');
      else { status.className = ''; status.textContent = 'Saved'; }
    });
  });
})();
