'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
require('../src/core.js');
const {createService} = require('../src/service.js');
const C = require('../src/core.js');

function evt() {
  const callbacks = [];
  return {
    addListener(fn) {callbacks.push(fn);},
    emit(...args) {for(const fn of callbacks) fn(...args);}
  };
}
function mockBrowser(shared) {
  const store = shared || {
    groups: new Map(), tabs: new Map(), values: new Map(), local: new Map(), next: 300
  };
  function clone(v) {return v === undefined ? undefined : JSON.parse(JSON.stringify(v));}
  const gEvents = {onCreated:evt(),onRemoved:evt(),onMoved:evt(),onUpdated:evt()};
  const tEvents = {onCreated:evt(),onUpdated:evt(),onAttached:evt(),onRemoved:evt()};
  function removeEmpty() {
    for(const group of store.groups.values()) {
      if(![...store.tabs.values()].some(t => t.groupId === group.id)) {
        store.groups.delete(group.id);
        gEvents.onRemoved.emit(clone(group));
      }
    }
  }
  function change(tabId, groupId, windowId) {
    const tab = store.tabs.get(tabId);
    if(!tab) throw new Error('Tab not found.');
    tab.groupId = groupId;
    if(windowId != null) tab.windowId = windowId;
    removeEmpty();
    tEvents.onUpdated.emit(tabId,{groupId},clone(tab));
  }
  const b = {
    runtime:{id:'tabgroup-ux@chromofoxext.local',onMessage:evt()},
    storage:{local:{
      async get(key) {return {[key]:clone(store.local.get(key))};},
      async set(object) {for(const [k,v] of Object.entries(object)) store.local.set(k,clone(v));}
    }},
    sessions:{
      async getTabValue(id,key) {
        if(!store.tabs.has(id)) throw new Error('Tab missing.');
        if(store.readFailure === id) throw new Error('Session store unavailable.');
        return clone(store.values.get(id + ':' + key));
      },
      async setTabValue(id,key,value) {
        if(!store.tabs.has(id)) throw new Error('Tab missing.');
        store.values.set(id + ':' + key,clone(value));
      },
      async removeTabValue(id,key) {
        if(!store.tabs.has(id)) throw new Error('Tab missing.');
        store.values.delete(id + ':' + key);
      }
    },
    tabs:{
      ...tEvents,
      async query(filter={}) {
        return [...store.tabs.values()].filter(t => 
          (filter.groupId == null || t.groupId === filter.groupId) &&
          (filter.windowId == null || t.windowId === filter.windowId)).map(clone);
      },
      async get(id) {
        if(!store.tabs.has(id)) throw new Error('Tab missing.');
        return clone(store.tabs.get(id));
      },
      async group({tabIds, groupId, createProperties}) {
        const ids=Array.isArray(tabIds) ? tabIds : [tabIds];
        if(groupId == null) {
          groupId = store.next++;
          const first = store.tabs.get(ids[0]);
          const group = {id: groupId, title:'',color:'blue',collapsed:false,
            windowId: createProperties?.windowId ?? first?.windowId ?? 1};
          store.groups.set(groupId,group);
          gEvents.onCreated.emit(clone(group));
        }
        if(!store.groups.has(groupId)) throw new Error('Group absent.');
        const windowId=store.groups.get(groupId).windowId;
        for(const id of ids) {
          if(!store.tabs.has(id) || store.tabs.get(id).windowId !== windowId) throw new Error('Window mismatch');
        }
        for(const id of ids) change(id,groupId);
        return groupId;
      },
      async ungroup(tabIds) {
        for(const id of Array.isArray(tabIds) ? tabIds : [tabIds]) change(id,-1);
      }
    },
    tabGroups:{
      ...gEvents,
      async query(filter={}) {
        return [...store.groups.values()].filter(g => filter.windowId == null || filter.windowId === g.windowId).map(clone);
      },
      async get(id) {if(!store.groups.has(id))throw new Error('Group missing');return clone(store.groups.get(id));},
      async update(id,properties) {
        if(!store.groups.has(id)) throw new Error('Group missing');
        Object.assign(store.groups.get(id),clone(properties));
        const group=clone(store.groups.get(id));gEvents.onUpdated.emit(group);return group;
      }
    }
  };
  const addGroup = (id,windowId,title='Group',color='blue') =>
    store.groups.set(id,{id,windowId,title,color,collapsed:false});
  const addTab = (id,groupId,windowId=1,incognito=false) =>
    store.tabs.set(id,{id,groupId,windowId,incognito,pinned:false});
  const move = (tabId,groupId,windowId) => change(tabId,groupId,windowId);
  const newTab = (id,groupId,windowId=1) => {
    addTab(id,groupId,windowId);
    tEvents.onCreated.emit(clone(store.tabs.get(id)));
    if(groupId !== -1) tEvents.onUpdated.emit(id,{groupId},clone(store.tabs.get(id)));
  };
  const close = (id) => {
    store.tabs.delete(id); removeEmpty();tEvents.onRemoved.emit(id,{});
  };
  return {b,store,addGroup,addTab,move,newTab,close};
}
let sequence=0;
function svc(mock) {
  return createService(mock.b,{createUid:()=> 'g_' + String(++sequence).padStart(8,'0'),
    logger:{warn() {}}});
}
async function settled(service) {for(let n=0;n<8;n++){await service.whenIdle();await Promise.resolve();}}
async function withSimpleGroup() {
  const m=mockBrowser();m.addGroup(100,1,'Work','purple');m.addTab(1,100);m.addTab(2,100);
  const s=svc(m);await s.start();await settled(s);
  return {m,s};
}
test('adopts native group and persists stable ID on all member tabs',async()=>{
  const {m,s}=await withSimpleGroup();
  const a=s.view().groups[0];
  assert.equal(a.title,'Work'); assert.equal(a.color,'purple');assert.equal(a.locked,false);
  assert.equal(a.uid,m.store.values.get('1:'+C.STAMP_KEY).uid);
  assert.equal(a.uid,m.store.values.get('2:'+C.STAMP_KEY).uid);
  assert.equal(a.appearance.lut.length,256);
  assert.equal(m.store.local.get(C.STORE_KEY).version,1);
});
test('locked tab dragged out is restored to original native group',async()=>{
  const {m,s}=await withSimpleGroup();
  await s.handleMessage({app:'tabgroup-ux',action:'lock',groupId:100,locked:true});
  m.move(1,-1);await settled(s);
  assert.equal(m.store.tabs.get(1).groupId,100);
  assert.equal(s.view().groups[0].locked,true);
});
test('locked tab dragged to a different group returns, other group remains intact',async()=>{
  const {m,s}=await withSimpleGroup();
  m.addGroup(101,1,'Other','green');m.addTab(3,101);
  await s.reconcile();
  await s.handleMessage({app:'tabgroup-ux',action:'lock',groupId:100,locked:true});
  m.move(1,101);await settled(s);
  assert.equal(m.store.tabs.get(1).groupId,100);
  assert.equal(m.store.tabs.get(3).groupId,101);
  assert.equal(s.view().groups.find(g=>g.id===101).status,'managed');
});
test('unlocking permits a move to another group without identity poisoning',async()=>{
  const {m,s}=await withSimpleGroup();
  m.addGroup(101,1,'Other','green');m.addTab(3,101);await s.reconcile();
  m.move(1,101);await settled(s);
  assert.equal(m.store.tabs.get(1).groupId,101);
  const target=s.view().groups.find(g=>g.id===101);
  assert.equal(target.status,'managed');
  assert.equal(m.store.values.get('1:'+C.STAMP_KEY).uid,target.uid);
});
test('a locked singleton can reconstitute its group after ungrouping',async()=>{
  const m=mockBrowser();m.addGroup(100,1,'Single','orange');m.addTab(1,100);
  const s=svc(m);await s.start();await s.handleMessage({app:'tabgroup-ux',action:'lock',groupId:100,locked:true});
  m.move(1,-1);await settled(s);
  const tab=m.store.tabs.get(1);
  assert.notEqual(tab.groupId,-1);
  assert.equal(m.store.groups.get(tab.groupId).title,'Single');
  assert.equal(m.store.groups.get(tab.groupId).color,'orange');
  assert.equal(s.view().groups[0].locked,true);
});
test('locks never steal a tab back into a different browser window',async()=>{
  const {m,s}=await withSimpleGroup();
  await s.handleMessage({app:'tabgroup-ux',action:'lock',groupId:100,locked:true});
  m.move(1,-1,2);await settled(s);
  assert.equal(m.store.tabs.get(1).windowId,2);
  assert.equal(m.store.tabs.get(1).groupId,-1);
  assert.equal(m.store.values.has('1:'+C.STAMP_KEY),false);
});
test('paused protection permits movement and adopts the destination identity',async()=>{
  const {m,s}=await withSimpleGroup();
  m.addGroup(101,1,'Other');m.addTab(3,101);await s.reconcile();
  await s.handleMessage({app:'tabgroup-ux',action:'lock',groupId:100,locked:true});
  await s.handleMessage({app:'tabgroup-ux',action:'settings',settings:{paused:true}});
  m.move(1,101);await settled(s);
  assert.equal(m.store.tabs.get(1).groupId,101);
  assert.equal(s.view().groups.find(g=>g.id===101).status,'managed');
  await s.handleMessage({app:'tabgroup-ux',action:'settings',settings:{paused:false}});
  assert.equal(m.store.tabs.get(1).groupId,101);
});
test('new member receives an existing group identity with no restoration bounce',async()=>{
  const {m,s}=await withSimpleGroup();
  await s.handleMessage({app:'tabgroup-ux',action:'lock',groupId:100,locked:true});
  m.newTab(9,100);await settled(s);
  assert.equal(m.store.tabs.get(9).groupId,100);
  assert.equal(m.store.values.get('9:'+C.STAMP_KEY).uid,s.view().groups[0].uid);
});
test('group IDs can change on full session restore without losing lock settings',async()=>{
  const {m,s}=await withSimpleGroup();
  await s.handleMessage({app:'tabgroup-ux',action:'lock',groupId:100,locked:true});
  const uid=s.view().groups[0].uid;
  m.store.groups.delete(100);m.addGroup(222,1,'Work','purple');
  m.store.tabs.get(1).groupId=222;m.store.tabs.get(2).groupId=222;
  const restarted=mockBrowser(m.store);const s2=svc(restarted);await s2.start();
  assert.equal(s2.view().groups[0].id,222);
  assert.equal(s2.view().groups[0].uid,uid);
  assert.equal(s2.view().groups[0].locked,true);
});
test('ambiguous mixed restored stamp identities are non-destructive',async()=>{
  const m=mockBrowser();m.addGroup(100,1,'Mixed');m.addTab(1,100);m.addTab(2,100);
  m.store.values.set('1:'+C.STAMP_KEY,{v:1,uid:'g_00000011'});
  m.store.values.set('2:'+C.STAMP_KEY,{v:1,uid:'g_00000022'});
  const s=svc(m);await s.start();
  assert.equal(s.view().groups[0].status,'conflict');
  assert.equal(s.view().groups[0].uid,null);
  assert.equal(m.store.tabs.get(1).groupId,100);
  assert.equal(m.store.tabs.get(2).groupId,100);
  assert.equal(m.store.values.get('1:'+C.STAMP_KEY).uid,'g_00000011');
  await assert.rejects(s.handleMessage({app:'tabgroup-ux',action:'lock',groupId:100,locked:true}),/conflict/);
  await s.handleMessage({app:'tabgroup-ux',action:'resetIdentity',groupId:100});
  assert.equal(s.view().groups[0].status,'managed');
  assert.equal(s.view().groups[0].locked,false);
});
test('duplicate identities split across two groups are both marked conflicts',async()=>{
  const m=mockBrowser();m.addGroup(100,1);m.addGroup(101,1);m.addTab(1,100);m.addTab(2,101);
  for(const id of [1,2])m.store.values.set(id+':'+C.STAMP_KEY,{v:1,uid:'g_00000033'});
  const s=svc(m);await s.start();
  assert.ok(s.view().groups.every(g=>g.status==='conflict'));
  assert.equal(m.store.groups.size,2);
});
test('private groups and unreadable sessions cannot be accidentally locked',async()=>{
  const m=mockBrowser();m.addGroup(100,1);m.addTab(1,100,1,true);m.addGroup(101,2);m.addTab(2,101,2);
  m.store.readFailure=2;
  const s=svc(m);await s.start();
  assert.equal(s.view().groups.find(g=>g.id===100).status,'private');
  assert.equal(s.view().groups.find(g=>g.id===101).status,'unavailable');
  assert.equal(m.store.values.size,0);
});
test('group closure never reopens a deliberately closed tab',async()=>{
  const {m,s}=await withSimpleGroup();
  await s.handleMessage({app:'tabgroup-ux',action:'lock',groupId:100,locked:true});
  m.close(1);m.close(2);await settled(s);
  assert.equal(m.store.tabs.size,0);
  assert.equal(m.store.groups.size,0);
});
test('palette save updates named Firefox colour, not arbitrary browser chrome',async()=>{
  const {m,s}=await withSimpleGroup();
  const group=s.view().groups[0];
  const appearance=C.normalizeAppearance({mode:'gradient',nativeColor:'yellow',stops:['#000000','#FFFFFF']});
  await s.handleMessage({app:'tabgroup-ux',action:'appearance',groupId:100,appearance});
  assert.equal(m.store.groups.get(100).color,'yellow');
  assert.equal(s.view().groups[0].appearance.mode,'gradient');
  assert.equal(s.view().groups[0].appearance.lut.length,256);
  const bad={...appearance,lut:['#000000']};
  await assert.rejects(s.handleMessage({app:'tabgroup-ux',action:'appearance',groupId:100,appearance:bad}),/256/);
  assert.equal(s.view().groups[0].appearance.mode,'gradient');
  assert.equal(group.uid,s.view().groups[0].uid);
});
test('messages reject external senders and unsupported actions',async()=>{
  const {s}=await withSimpleGroup();
  await assert.rejects(s.handleMessage({app:'tabgroup-ux',action:'lock',groupId:100,locked:true},{id:'other-extension'}),/External/);
  await assert.rejects(s.handleMessage({app:'tabgroup-ux',action:'garbage'}),/Unsupported/);
});

test('locked singleton dragged into a brand-new native group is returned to its original identity', async () => {
  const m=mockBrowser(); m.addGroup(100,1,'Keep','green'); m.addTab(1,100);
  const s=svc(m); await s.start();
  const before=s.view().groups[0].uid;
  await s.handleMessage({app:'tabgroup-ux',action:'lock',groupId:100,locked:true});
  const unwanted=await m.b.tabs.group({tabIds:[1],createProperties:{windowId:1}});
  await settled(s);
  assert.notEqual(m.store.tabs.get(1).groupId,unwanted);
  assert.equal(s.view().groups[0].uid,before);
  assert.equal(s.view().groups[0].locked,true);
  assert.equal(m.store.groups.size,1);
});
test('unlocked singleton dragged into a brand-new native group becomes a new unlocked identity', async () => {
  const m=mockBrowser(); m.addGroup(100,1,'Old'); m.addTab(1,100);
  const s=svc(m); await s.start(); const before=s.view().groups[0].uid;
  const groupId=await m.b.tabs.group({tabIds:[1],createProperties:{windowId:1}});
  await settled(s);
  assert.equal(m.store.tabs.get(1).groupId,groupId);
  assert.notEqual(s.view().groups[0].uid,before);
  assert.equal(s.view().groups[0].locked,false);
});
test('default lock applies only to fresh groups and pause can disable recovery', async () => {
  const m=mockBrowser();m.addGroup(100,1,'Existing');m.addTab(1,100);
  const s=svc(m);await s.start();
  await s.handleMessage({app:'tabgroup-ux',action:'settings',settings:{defaultLocked:true}});
  assert.equal(s.view().groups[0].locked,false);
  const gid=await m.b.tabs.group({tabIds:[1],createProperties:{windowId:1}});
  await settled(s);
  const newer=s.view().groups.find(g=>g.id===gid);
  assert.equal(newer.locked,true);
});
