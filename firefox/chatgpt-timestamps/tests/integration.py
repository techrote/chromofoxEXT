"""Synthetic DOM integration smoke test (Chromium used only as browser engine)."""
from playwright.sync_api import sync_playwright
from pathlib import Path
import json, time
ROOT=Path(__file__).resolve().parents[1]
HTML='''<!DOCTYPE html><html><body><main><article data-turn="user" data-turn-id="old-user-0001"><div data-message-author-role="user" data-message-id="old-user-0001">Old question</div></article><article data-turn="assistant" data-turn-id="old-assistant-0001"><div data-message-author-role="assistant" data-message-id="old-assistant-0001">Old answer</div></article></main><form id="composer"><div contenteditable="true" id="prompt-textarea"></div><button type="button" data-testid="send-button" id="send">Send</button></form></body></html>'''
shim='''
  (()=> {
    const listeners=[];const localStore=window.__mockSaved||{};
    window.browser={storage:{onChanged:{addListener:fn=>listeners.push(fn)},local:{
      async get(keys){const data=localStore;if(keys==null)return data;if(typeof keys==='string')return {[keys]:data[keys]};if(Array.isArray(keys))return Object.fromEntries(keys.map(k=>[k,data[k]]));return data;},
      async set(values){const data=localStore;const changes={};for(const[k,v]of Object.entries(values)){changes[k]={oldValue:data[k],newValue:v};data[k]=v;}window.__mockSaved=data;listeners.forEach(fn=>fn(changes,'local'));},
      async remove(keys){const data=localStore;const changes={};for(const k of keys){changes[k]={oldValue:data[k],newValue:undefined};delete data[k];}window.__mockSaved=data;listeners.forEach(fn=>fn(changes,'local'));}
    }}};
  })()
'''

def install(page):
  page.evaluate(shim)
  page.add_script_tag(path=str(ROOT/'shared.js'))
  page.evaluate("""() => {const c=window.CGPTTimestamp;window.__route='/c/abc12345';window.CGPTTimestamp={...c,conversationId:()=>c.conversationId(window.__route)};}""")
  page.add_script_tag(path=str(ROOT/'content.js'))
  page.wait_for_timeout(200)

with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  context=browser.new_context()
  page=context.new_page()
  errors=[]
  page.on('pageerror',lambda e: errors.append(str(e)))
  page.goto('about:blank')
  page.set_content(HTML)
  install(page)
  assert page.locator('.cgpt-timestamp-label').count()==0, 'old turns must not get invented creation times'
  # Send action; request causes a user turn followed by the assistant.
  page.locator('#send').click()
  page.evaluate('''() => {const main=document.querySelector('main');main.insertAdjacentHTML('beforeend','<article data-turn="user" data-turn-id="new-user-0001"><div data-message-author-role="user" data-message-id="new-user-0001">New question</div></article>');}''')
  page.locator('article[data-turn-id="new-user-0001"] .cgpt-timestamp-label').wait_for(timeout=3000)
  page.evaluate('''() => document.querySelector('main').insertAdjacentHTML('beforeend','<article data-turn="assistant" data-turn-id="new-assistant-0001"><div data-message-author-role="assistant" data-message-id="new-assistant-0001">New answer</div></article>')''')
  page.locator('article[data-turn-id="new-assistant-0001"] .cgpt-timestamp-label').wait_for(timeout=3000)
  page.wait_for_timeout(200)
  db=page.evaluate("window.__mockSaved")
  saved={k:v for k,v in db.items() if k.startswith('cgpt-timestamp:v1:')}
  assert len(saved)==2, (saved,errors)
  assert sorted(v['source'] for v in saved.values())==['reply-start','sent'], saved
  assert not errors, errors
  # Reload, restore DOM from persisted extension-local storage (shim is reattached).
  saved_for_reload=page.evaluate('window.__mockSaved')
  page.goto('about:blank')
  page.set_content(HTML)
  page.evaluate('(records) => window.__mockSaved=records', saved_for_reload)
  install(page)
  page.evaluate('''() => {document.querySelector('main').insertAdjacentHTML('beforeend','<article data-turn="user" data-turn-id="new-user-0001"><div data-message-author-role="user" data-message-id="new-user-0001">New question</div></article><article data-turn="assistant" data-turn-id="new-assistant-0001"><div data-message-author-role="assistant" data-message-id="new-assistant-0001">New answer</div></article>');}''')
  page.locator('article[data-turn-id="new-assistant-0001"] .cgpt-timestamp-label').wait_for(timeout=3000)
  assert page.locator('.cgpt-timestamp-label').count()==2, 'saved timestamps should restore only for known IDs'
  # No timestamp for old unseen chat after navigating, and no cross-talk to other conversation.
  page.evaluate("window.__route='/c/otherchat9876'")
  page.evaluate('''() => {document.querySelector('main').innerHTML='<article data-turn="user" data-turn-id="other-old-0001"><div data-message-author-role="user" data-message-id="other-old-0001">Earlier historical message</div></article>'; }''')
  page.wait_for_timeout(750)
  assert page.locator('.cgpt-timestamp-label').count()==0
  assert len({k:v for k,v in page.evaluate("window.__mockSaved").items() if k.startswith('cgpt-timestamp:v1:')})==2
  # Opt-in to first-seen timestamps: label must say First seen, and be persisted.
  page.evaluate('''() => browser.storage.local.set({'cgpt-timestamp:settings:v1':{enabled:true,showSeconds:false,firstSeen:true}})''')
  page.locator('.cgpt-timestamp-label').wait_for(timeout=3000)
  assert page.locator('.cgpt-timestamp-label').inner_text().startswith('First seen: ')
  assert not errors, errors
  print('PASS: old messages unlabelled by default; send and assistant capture; persistent restore; navigation isolation; first-seen opt-in')
  browser.close()

