'use strict';
const C = TabGroupCore;
const $ = id => document.getElementById(id);
const PRESETS = Object.freeze({
  Aurora: ['#0B3948','#2A8C9E','#6EB56C','#AE61E3'],
  Ember: ['#53193D','#C94D55','#E89F53','#FFDE87'],
  Glacier: ['#11335C','#277DA8','#93D4F0','#E5FAFF'],
  Violet: ['#240948','#6244BC','#CA79E3','#FF9ABD'],
  Mono: ['#191B21','#5A626C','#B4BAC0','#EFF2F5']
});
let state = {settings: {}, groups: []};
let selectedId = null, draft = null, dirty = false;
function ask(action, args) {
  return browser.runtime.sendMessage({app: 'tabgroup-ux', action, ...(args || {})});
}
function status(text, error) {
  $('status').textContent = text;
  $('status').style.color = error ? '#ffb7ad' : '#b4d8a8';
}
function current() { return state.groups.find(g => g.id === selectedId) || null; }
function updateDirty(value) {
  dirty = value;
  $('dirty').textContent = dirty ? 'Unsaved colour changes' : 'Saved';
}
function confirmLeave() {
  return !dirty || window.confirm('Discard unsaved appearance changes?');
}
function make(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}
function renderGroups() {
  const target = $('groups');
  target.replaceChildren();
  if (!state.groups.length) target.append(make('p', 'help', 'No native groups found. Create a group in Firefox to begin.'));
  for (const g of state.groups) {
    const item = make('div', 'group-item' + (g.id === selectedId ? ' selected' : ''));
    const top = make('div', 'group-item-header');
    const swatch = make('div', 'group-swatch');
    swatch.style.background = g.appearance ? C.previewCss(g.appearance, g.color) : C.COLORS[g.color] || '#555';
    const choose = make('button', 'group-choice');
    choose.type = 'button';
    choose.append(make('strong', null, g.title || 'Unnamed group'),
      make('small', null, 'Window ' + g.windowId + ' · ' + g.count + ' tab(s) · ' + g.color));
    choose.addEventListener('click', () => select(g.id));
    top.append(swatch, choose);
    item.append(top);
    const lock = make('input');
    lock.type = 'checkbox';
    lock.checked = g.locked;
    lock.disabled = g.status !== 'managed';
    lock.setAttribute('aria-label', 'Lock membership of ' + (g.title || 'Unnamed group'));
    lock.addEventListener('change', async () => {
      lock.disabled = true;
      try {
        state = await ask('lock', {groupId: g.id, locked: lock.checked});
        status('Membership lock updated.');
        renderGroups();
        if (selectedId === g.id) $('lock').checked = lock.checked;
      } catch (error) {
        status(String(error.message || error), true);
        await load(false);
      }
    });
    const label = make('label');
    label.append(lock, document.createTextNode(' Lock membership (soft)'));
    item.append(label);
    if (g.status !== 'managed') {
      item.append(make('p', 'group-warning', 'Group identity: ' + g.status + '. No protection is applied.'));
      if (g.status === 'conflict' || g.status === 'unavailable') {
        const reset = make('button', 'reset', 'Reset group identity (unlock)');
        reset.type = 'button';
        reset.addEventListener('click', async () => {
          if (!window.confirm('Reset identity for these tabs? This group will become unlocked; other groups will not be modified.')) return;
          try { state = await ask('resetIdentity', {groupId: g.id}); status('Identity reset and unlocked.'); renderGroups(); }
          catch (error) {status(String(error.message || error), true);}
        });
        item.append(reset);
      }
    }
    target.append(item);
  }
}
function select(groupId) {
  if (groupId !== selectedId && !confirmLeave()) return;
  selectedId = groupId;
  loadEditor();
  renderGroups();
}
function loadEditor() {
  const g = current();
  $('editor').hidden = !g || g.status !== 'managed';
  $('empty-editor').hidden = Boolean(g && g.status === 'managed');
  if (!g || g.status !== 'managed') {
    $('empty-editor').querySelector('p').textContent = g
      ? 'This group cannot safely be edited (' + g.status + '). Resolve its identity in the group list.'
      : 'Use the native Firefox tab strip to create a group. Select it here to configure membership and colours.';
    draft = null;
    updateDirty(false);
    return;
  }
  $('group-title').textContent = g.title || 'Unnamed group';
  $('group-meta').textContent = 'Window ' + g.windowId + ' · Group ' + g.id + ' · ' + g.count + ' tabs';
  $('rename').value = g.title;
  $('lock').checked = g.locked;
  draft = C.normalizeAppearance(g.appearance, g.color);
  updateDirty(false);
  updateControls();
}
function updateControls() {
  if (!draft) return;
  $('mode').value = draft.mode;
  $('native-colour').value = draft.nativeColor;
  $('angle').value = String(draft.angle);
  $('bands').value = String(draft.bands);
  $('bands').disabled = draft.mode !== 'bands';
  renderStops();
  renderLut();
  preview();
}
function preview() {
  if (!draft) return;
  $('preview').style.background = C.previewCss(draft, current().color);
  const native = C.nativeColor(draft, current().color);
  $('preview').textContent = 'Preview · Firefox native colour: ' + native;
}
function changed() {
  updateDirty(true);
  preview();
}
function renderStops() {
  const box = $('stops');
  box.replaceChildren();
  for (let index = 0; index < draft.stops.length; index++) {
    const row = make('div','stop-row');
    const label = make('span','stop-label','Stop ' + (index + 1));
    const color = make('input');
    color.type = 'color';
    color.value = draft.stops[index];
    color.setAttribute('aria-label', 'Stop ' + (index + 1) + ' colour');
    const text = make('input');
    text.type = 'text'; text.maxLength = 7; text.value = draft.stops[index];
    text.setAttribute('aria-label', 'Stop ' + (index + 1) + ' RGB hex');
    function apply(value) {
      const v = C.hex(value);
      if (!v) {status('Invalid six-digit RGB colour.', true); text.value = draft.stops[index];return;}
      draft.stops[index] = v; color.value = v; text.value = v; changed();
    }
    color.addEventListener('input', () => apply(color.value));
    text.addEventListener('change', () => apply(text.value));
    const remove = make('button',null,'Remove');
    remove.type = 'button'; remove.disabled = draft.stops.length <= 2;
    remove.addEventListener('click', () => {
      if (draft.stops.length <= 2) return;
      draft.stops.splice(index, 1); renderStops(); changed();
    });
    row.append(label,color,text,remove);
    box.append(row);
  }
  $('add-stop').disabled = draft.stops.length >= 8;
}
function renderLut() {
  if (!draft) return;
  const grid = $('lut-grid');
  grid.replaceChildren();
  for (let i = 0; i < C.LUT_SIZE; i++) {
    const input = make('input');
    input.type = 'text'; input.maxLength = 7;
    input.value = draft.lut[i].slice(1);
    input.setAttribute('aria-label', 'LUT colour ' + (i + 1) + ' RGB hex');
    input.style.backgroundColor = draft.lut[i];
    const channels = [1,3,5].map(k => parseInt(draft.lut[i].slice(k,k+2),16));
    input.style.color = channels[0] * 0.299 + channels[1] * 0.587 + channels[2] * 0.114 > 142 ? '#101117' : '#fff';
    input.addEventListener('focus', () => input.select());
    input.addEventListener('change', () => {
      const h = C.hex(input.value);
      if (!h) {
        input.setAttribute('aria-invalid','true');
        status('LUT cell ' + (i + 1) + ': invalid RGB value.',true);
        return;
      }
      draft.lut[i] = h;
      renderLut();
      changed();
    });
    grid.append(input);
  }
}
async function load(restoreEditor) {
  try {
    state = await ask('list');
    $('paused').checked = state.settings.paused;
    $('default-lock').checked = state.settings.defaultLocked;
    if (!state.groups.some(g => g.id === selectedId)) selectedId = state.groups.length ? state.groups[0].id : null;
    renderGroups();
    if (restoreEditor !== false) loadEditor();
    status(state.groups.length + ' native tab group(s) loaded.');
  } catch (error) { status('Cannot load groups: ' + String(error.message || error), true); }
}
async function settingsChange(name, value) {
  try { state = await ask('settings', {settings: {[name]: value}}); renderGroups(); status('Settings saved.'); }
  catch (error) { status(String(error.message || error), true); $('paused').checked = !!state.settings.paused; $('default-lock').checked = !!state.settings.defaultLocked; }
}
$('paused').addEventListener('change', e => settingsChange('paused', e.target.checked));
$('default-lock').addEventListener('change', e => settingsChange('defaultLocked', e.target.checked));
$('refresh').addEventListener('click', async () => {if (confirmLeave()) await load(true);});
$('lock').addEventListener('change', async e => {
  const g = current();
  if (!g) return;
  try {state = await ask('lock', {groupId:g.id, locked:e.target.checked});renderGroups(); status('Membership lock saved.');}
  catch (error) {e.target.checked = !e.target.checked; status(String(error.message || error),true);}
});
$('save-name').addEventListener('click', async () => {
  const g = current(); if (!g) return;
  try {state = await ask('rename', {groupId:g.id, title:$('rename').value});renderGroups();loadEditor();status('Group renamed.');}
  catch (error) {status(String(error.message || error),true);}
});
$('mode').addEventListener('change', e => {if (draft) {draft.mode = e.target.value; $('bands').disabled = draft.mode !== 'bands';changed();}});
$('native-colour').addEventListener('change', e => {if(draft){draft.nativeColor=e.target.value;changed();}});
$('angle').addEventListener('change', e => {if(draft){draft.angle=C.clamp(Number(e.target.value)||0,0,360);e.target.value=draft.angle;changed();}});
$('bands').addEventListener('change', e => {if(draft){draft.bands=Math.floor(C.clamp(Number(e.target.value)||2,2,32));e.target.value=draft.bands;changed();}});
$('add-stop').addEventListener('click', () => {if(draft && draft.stops.length<8){draft.stops.push(draft.stops[draft.stops.length-1]);renderStops();changed();}});
for (const [name,stops] of Object.entries(PRESETS)) {
  const btn=make('button',null,name);
  btn.type='button';btn.addEventListener('click',()=>{if(draft){draft.stops=stops.slice();draft.lut=C.makeLut(draft.stops);draft.mode='gradient';draft.nativeColor='auto';updateControls();changed();}});
  $('presets').append(btn);
}
$('build-lut').addEventListener('click',()=>{if(draft){draft.lut=C.makeLut(draft.stops);renderLut();changed();}});
$('random-scale').addEventListener('input',e=>$('random-value').textContent=e.target.value+'%');
$('randomise').addEventListener('click',()=>{
  if(!draft)return;
  const seed = (Date.now() ^ Math.floor(Math.random()*4294967296)) >>> 0;
  draft.lut = C.randomiseLut(draft.lut,seed,Number($('random-scale').value));
  draft.mode='lut';$('mode').value='lut';renderLut();changed();
});
$('import-lut').addEventListener('click',()=>{
  if(!draft)return;
  try { const lut=C.parseLutText($('bulk').value);draft.lut=lut;draft.mode='lut';$('mode').value='lut';renderLut();changed();status('256 colours imported. Save appearance to persist.');}
  catch(error){status(String(error.message||error),true);}
});
$('export-lut').addEventListener('click',()=>{
  if(!draft)return;
  $('bulk').value=Array.from({length:32},(_,i)=>draft.lut.slice(i*8,i*8+8).map(s=>s.slice(1)).join(', ')).join('\n');
  status('LUT exported to text field.');
});
$('export-json').addEventListener('click',()=>{
  if(draft){$('json').value=JSON.stringify({schema:1,...draft},null,2);status('Appearance JSON exported.');}
});
$('import-json').addEventListener('click',()=>{
  if(!draft)return;
  try {draft=C.parseImportedAppearance(JSON.parse($('json').value),current().color);updateControls();changed();status('Appearance JSON imported. Save to persist.');}
  catch(error){status(String(error.message||error),true);}
});
$('save-appearance').addEventListener('click',async()=>{
  if(!draft||!current())return;
  try {
    const g=current();state=await ask('appearance',{groupId:g.id,appearance:draft});
    loadEditor();renderGroups();status('Appearance saved. Native Firefox colour updated; custom pattern retained locally.');
  } catch(error){status(String(error.message||error),true);}
});
$('discard').addEventListener('click',()=>loadEditor());
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
load(true);
