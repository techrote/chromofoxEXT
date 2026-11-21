'use strict';
const popupGroups = document.querySelector('#popup-groups');
const popupStatus = document.querySelector('#status');
function ask(action, payload) { return browser.runtime.sendMessage({app: 'tabgroup-ux', action, ...payload}); }
function row(group) {
  const item = document.createElement('div');
  item.className = 'popup-row';
  const name = document.createElement('strong');
  name.textContent = group.title || 'Unnamed group';
  const number = document.createElement('span');
  number.textContent = String(group.count) + ' tabs';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = group.locked;
  checkbox.disabled = group.status !== 'managed';
  checkbox.setAttribute('aria-label', 'Lock membership of ' + name.textContent);
  checkbox.addEventListener('change', async () => {
    checkbox.disabled = true;
    try { await ask('lock', {groupId: group.id, locked: checkbox.checked}); popupStatus.textContent = 'Updated.'; }
    catch (error) { checkbox.checked = !checkbox.checked; popupStatus.textContent = String(error.message || error); }
    finally { checkbox.disabled = group.status !== 'managed'; }
  });
  const label = document.createElement('label');
  label.append(checkbox, document.createTextNode('Soft lock'));
  item.append(name, number, label);
  if (group.status !== 'managed') {
    const problem = document.createElement('small');
    problem.textContent = 'Identity: ' + group.status + '. Resolve in manager.';
    item.append(problem);
  }
  return item;
}
async function load() {
  try {
    const w = await browser.windows.getCurrent();
    const state = await ask('list', {windowId: w.id});
    popupGroups.replaceChildren();
    if (!state.groups.length) popupStatus.textContent = 'No tab groups in this window.';
    else {
      popupStatus.textContent = state.groups.length + ' group(s)' + (state.settings.paused ? ' · protection paused' : '');
      state.groups.forEach(group => popupGroups.append(row(group)));
    }
  } catch (error) { popupStatus.textContent = 'Unable to read tab groups: ' + String(error.message || error); }
}
document.querySelector('#open-manager').addEventListener('click', () => browser.runtime.openOptionsPage());
load();
