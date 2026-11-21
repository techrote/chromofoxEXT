/* Firefox-only native tab-group controller. No page/content-script access.
 * Membership locking is deliberately best effort and happens AFTER a move.
 */
(function (root) {
  'use strict';
  const C = root.TabGroupCore || (typeof require === 'function' && require('./core.js'));
  const NONE = -1;
  const SCHEMA = 1;

  function createService(b, options) {
    const config = options || {};
    const createUid = config.createUid || (() => 'g_' + crypto.randomUUID());
    const logger = config.logger || console;
    let data = {version: SCHEMA, settings: {defaultLocked: false, paused: false}, groups: Object.create(null)};
    let current = [];
    let groupToUid = new Map();
    let uidToGroup = new Map();
    let ready;
    let queue = Promise.resolve();

    function log(error) { if (logger && logger.warn) logger.warn('tabgroup-ux:', error); }
    function enqueue(job) {
      const response = queue.catch(() => {}).then(async () => {
        await ready;
        return job();
      });
      queue = response.catch(log);
      return response;
    }
    function validUid(uid) {
      return typeof uid === 'string' && /^g_[a-zA-Z0-9_-]{8,98}$/.test(uid);
    }
    function normalizeData(raw) {
      const value = raw && typeof raw === 'object' ? raw : {};
      const settings = value.settings && typeof value.settings === 'object' ? value.settings : {};
      const groups = Object.create(null);
      if (value.groups && typeof value.groups === 'object') {
        for (const [uid, record] of Object.entries(value.groups)) {
          if (!validUid(uid) || !record || typeof record !== 'object') continue;
          groups[uid] = {
            locked: record.locked === true,
            title: typeof record.title === 'string' ? record.title.slice(0, 100) : '',
            color: Object.hasOwn(C.COLORS, record.color) ? record.color : 'blue',
            appearance: C.normalizeAppearance(record.appearance, record.color)
          };
        }
      }
      return {
        version: SCHEMA,
        settings: {defaultLocked: settings.defaultLocked === true, paused: settings.paused === true},
        groups
      };
    }
    async function persist() {
      await b.storage.local.set({[C.STORE_KEY]: data});
    }
    async function readStamp(tabId) {
      try { return {ok: true, value: await b.sessions.getTabValue(tabId, C.STAMP_KEY)}; }
      catch (error) { return {ok: false, value: null}; }
    }
    async function writeStamp(tabId, uid) {
      try {
        await b.sessions.setTabValue(tabId, C.STAMP_KEY, {v: 1, uid});
        return true;
      } catch (error) {
        log('Cannot persist group identity for tab ' + tabId + ': ' + error);
        return false;
      }
    }
    async function reconcile() {
      // Each sweep uses current browser group/tab membership. Never trust historic groupIds.
      const [groups, tabs] = await Promise.all([b.tabGroups.query({}), b.tabs.query({})]);
      const byGroup = new Map();
      for (const t of tabs) if (t.groupId !== NONE) {
        if (!byGroup.has(t.groupId)) byGroup.set(t.groupId, []);
        byGroup.get(t.groupId).push(t);
      }
      const plans = [];
      const uidOccurrences = new Map();
      let changed = false;
      for (const group of groups) {
        const members = byGroup.get(group.id) || [];
        if (!members.length) continue;
        if (members.some(t => t.incognito)) {
          plans.push({group, members, uid: null, status: 'private'});
          continue;
        }
        const stamps = await Promise.all(members.map(t => readStamp(t.id)));
        if (stamps.some(s => !s.ok)) {
          plans.push({group, members, uid: null, status: 'unavailable'});
          continue;
        }
        const resolved = C.resolveIdentity(stamps.map(s => s.value));
        if (resolved.conflict) {
          plans.push({group, members, uid: null, status: 'conflict'});
          continue;
        }
        const uid = resolved.uid || createUid();
        if (!validUid(uid)) throw new Error('Generated group identity is invalid.');
        const plan = {group, members, stamps, uid, status: 'managed'};
        plans.push(plan);
        const ids = uidOccurrences.get(uid) || [];
        ids.push(group.id);
        uidOccurrences.set(uid, ids);
      }
      // Reused identity across two live groups is ambiguous. Never merge them.
      for (const plan of plans) {
        if (plan.uid && uidOccurrences.get(plan.uid).length > 1) plan.status = 'conflict';
      }
      const nextGroupToUid = new Map(), nextUidToGroup = new Map();
      for (const plan of plans) {
        if (plan.status !== 'managed') continue;
        const {group, members, stamps, uid} = plan;
        if (!Object.hasOwn(data.groups, uid)) {
          data.groups[uid] = {
            locked: data.settings.defaultLocked,
            title: String(group.title || '').slice(0, 100),
            color: group.color,
            appearance: C.normalizeAppearance(null, group.color)
          };
          changed = true;
        } else {
          const record = data.groups[uid];
          const title = String(group.title || '').slice(0, 100);
          if (record.title !== title || record.color !== group.color) {
            record.title = title;
            record.color = group.color;
            changed = true;
          }
        }
        for (let i = 0; i < members.length; i++) {
          if (C.identityOf(stamps[i].value) !== uid) {
            if (!(await writeStamp(members[i].id, uid))) plan.status = 'unavailable';
          }
        }
        if (plan.status === 'managed') {
          nextGroupToUid.set(group.id, uid);
          nextUidToGroup.set(uid, {id: group.id, windowId: group.windowId});
        }
      }
      groupToUid = nextGroupToUid;
      uidToGroup = nextUidToGroup;
      current = plans.map(p => ({
        id: p.group.id,
        windowId: p.group.windowId,
        title: String(p.group.title || ''),
        color: p.group.color,
        collapsed: Boolean(p.group.collapsed),
        count: p.members.length,
        uid: p.status === 'managed' ? p.uid : null,
        status: p.status,
        locked: p.status === 'managed' && data.groups[p.uid].locked,
        appearance: p.status === 'managed' ? data.groups[p.uid].appearance : null
      })).sort((a, b) => a.windowId - b.windowId || a.id - b.id);
      if (changed) await persist();
      return current;
    }

    async function onMembershipChanged(tabId) {
      let tab;
      try { tab = await b.tabs.get(tabId); }
      catch (error) { await reconcile(); return; } // Tab closed in the meantime.
      if (tab.incognito) { await reconcile(); return; }
      const stamp = await readStamp(tabId);
      const uid = stamp.ok ? C.identityOf(stamp.value) : null;
      const rec = uid && Object.hasOwn(data.groups, uid) ? data.groups[uid] : null;
      if (!data.settings.paused && rec && rec.locked) {
        const destination = uidToGroup.get(uid);
        if (destination && destination.windowId !== tab.windowId) {
          // Cross-window transfers are intentional enough to be left alone.
          // Do not steal a tab back into its old window or poison another group.
          try { await b.sessions.removeTabValue(tabId, C.STAMP_KEY); }
          catch (error) { log('Cannot clear transferred tab identity: ' + error); }
        } else if (!destination || tab.groupId !== destination.id) {
          if (tab.pinned) {
            log('Pinned tab ' + tabId + ' was not regrouped (grouping would unpin it).');
          } else {
            try {
              const groupId = destination
                ? await b.tabs.group({tabIds: [tabId], groupId: destination.id})
                : await b.tabs.group({tabIds: [tabId], createProperties: {windowId: tab.windowId}});
              if (!destination) {
                await b.tabGroups.update(groupId, {title: rec.title, color: rec.color});
              }
            } catch (error) {
              log('Soft-lock restoration skipped for tab ' + tabId + ': ' + error);
            }
          }
        }
      }
      await reconcile();
    }

    async function groupForAction(groupId) {
      if (!Number.isInteger(groupId)) throw new Error('Invalid group ID.');
      await reconcile();
      const item = current.find(g => g.id === groupId);
      if (!item) throw new Error('Tab group no longer exists.');
      if (item.status !== 'managed' || !item.uid) {
        throw new Error('Group identity is ' + item.status + '; resolve it before editing.');
      }
      return item;
    }
    async function setLock(groupId, locked) {
      const item = await groupForAction(groupId);
      data.groups[item.uid].locked = locked === true;
      await persist();
      await reconcile();
      return view();
    }
    async function setSettings(settings) {
      if (!settings || typeof settings !== 'object') throw new Error('Invalid settings.');
      if (Object.hasOwn(settings, 'defaultLocked')) data.settings.defaultLocked = settings.defaultLocked === true;
      if (Object.hasOwn(settings, 'paused')) data.settings.paused = settings.paused === true;
      await persist();
      return view();
    }
    async function saveAppearance(groupId, input) {
      const item = await groupForAction(groupId);
      const appearance = C.parseImportedAppearance(input, item.color);
      const color = C.nativeColor(appearance, item.color);
      // Commit the local palette first. Only native named colour is visible in
      // Firefox's tab strip; arbitrary gradients stay in extension previews.
      data.groups[item.uid].appearance = appearance;
      await persist();
      await b.tabGroups.update(groupId, {color});
      await reconcile();
      return view();
    }
    async function rename(groupId, title) {
      await groupForAction(groupId);
      if (typeof title !== 'string' || title.length > 100) throw new Error('Title must be 100 characters or less.');
      await b.tabGroups.update(groupId, {title});
      await reconcile();
      return view();
    }
    async function resetIdentity(groupId) {
      // Explicit escape from ambiguous, restored or conflicting identities.
      if (!Number.isInteger(groupId)) throw new Error('Invalid group ID.');
      const [group, tabs] = await Promise.all([b.tabGroups.get(groupId), b.tabs.query({groupId})]);
      if (!group || tabs.some(t => t.incognito)) throw new Error('Private groups are not supported.');
      const uid = createUid();
      if (!validUid(uid)) throw new Error('Generated group identity is invalid.');
      for (const tab of tabs) {
        if (!(await writeStamp(tab.id, uid))) throw new Error('Could not update every tab identity; retry.');
      }
      data.groups[uid] = {
        locked: false,
        title: String(group.title || ''),
        color: group.color,
        appearance: C.normalizeAppearance(null, group.color)
      };
      await persist();
      await reconcile();
      return view();
    }
    function view(windowId) {
      return {
        settings: {...data.settings},
        groups: current.filter(g => windowId == null || g.windowId === windowId)
          .map(g => ({...g, appearance: g.appearance ? {...g.appearance, lut: [...g.appearance.lut],
            stops: [...g.appearance.stops]} : null})),
        message: 'Membership locks are best-effort and restore tabs after a move. Native Firefox tab strip supports named solid colours only.'
      };
    }
    async function handleMessage(message, sender) {
      if (!message || message.app !== 'tabgroup-ux' || typeof message.action !== 'string')
        throw new Error('Unknown request.');
      if (sender && sender.id && sender.id !== b.runtime.id) throw new Error('External sender rejected.');
      const groupId = message.groupId;
      switch (message.action) {
        case 'list':
          await reconcile();
          return view(Number.isInteger(message.windowId) ? message.windowId : null);
        case 'lock': return setLock(groupId, message.locked);
        case 'settings': return setSettings(message.settings);
        case 'appearance': return saveAppearance(groupId, message.appearance);
        case 'rename': return rename(groupId, message.title);
        case 'resetIdentity': return resetIdentity(groupId);
        default: throw new Error('Unsupported action: ' + message.action);
      }
    }
    async function initialize() {
      const stored = await b.storage.local.get(C.STORE_KEY);
      data = normalizeData(stored[C.STORE_KEY]);
      await reconcile();
    }
    function start() {
      ready = initialize();
      function event(job) { enqueue(job).catch(log); }
      b.tabs.onUpdated.addListener((tabId, change) => {
        if (Object.hasOwn(change, 'groupId')) event(() => onMembershipChanged(tabId));
      }, {properties: ['groupId']});
      b.tabs.onCreated.addListener(tab => event(() => onMembershipChanged(tab.id)));
      b.tabs.onAttached.addListener((tabId) => event(() => onMembershipChanged(tabId)));
      b.tabs.onRemoved.addListener(() => event(reconcile));
      b.tabGroups.onCreated.addListener(() => event(reconcile));
      b.tabGroups.onRemoved.addListener(() => event(reconcile));
      b.tabGroups.onMoved.addListener(() => event(reconcile));
      b.tabGroups.onUpdated.addListener(() => event(reconcile));
      b.runtime.onMessage.addListener((message, sender) => {
        if (message && message.app === 'tabgroup-ux') return enqueue(() => handleMessage(message, sender));
        return false;
      });
      return ready;
    }
    return {start, view, reconcile, onMembershipChanged, handleMessage, ready: () => ready, whenIdle: () => queue};
  }
  root.TabGroupService = {createService};
  if (typeof module !== 'undefined' && module.exports) module.exports = {createService};
})(typeof globalThis !== 'undefined' ? globalThis : this);
