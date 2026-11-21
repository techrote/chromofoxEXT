"""Offline real Chromium MV3 content-script injection regression.

The test copies the production-built package and appends a localhost match
ONLY to the temporary copy's manifest. Production JS remains unchanged.
A directly served local HTML document avoids Playwright route-fulfill pitfalls.
No ChatGPT requests or Pro messages are made.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from playwright.sync_api import sync_playwright
import json
import os
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent
HTML = '''<!doctype html><html lang="en"><body>
<aside><button data-testid="model-switcher-dropdown-button">High</button></aside>
<main><div id="edit-composer" data-testid="composer">
<button data-testid="model-switcher-dropdown-button">High</button>
<form id="edit-form"><textarea id="edit-draft" name="prompt-textarea">Edit draft</textarea></form>
<button type="button" id="edit-send" aria-label="Send">Send</button>
</div><div id="main-composer" data-testid="composer">
<div role="combobox" id="active-model">Pro Extended</div>
<form id="chat-form"><textarea name="prompt-textarea" id="draft">Draft survives cancellation</textarea></form>
<button type="button" id="composer-submit-button" aria-label="Send">Send</button>
</div></main><script>window.sent=0;window.editSent=0;
document.querySelector('#edit-send').addEventListener('click',()=>document.querySelector('#edit-form').requestSubmit());
document.querySelector('#edit-form').addEventListener('submit',e=>{e.preventDefault();window.editSent++;});
document.getElementById('composer-submit-button').addEventListener('click',()=>document.getElementById('chat-form').requestSubmit());
document.getElementById('chat-form').addEventListener('submit',e=>{e.preventDefault();window.sent++;});
</script></body></html>'''

SHARED_HTML = '''<!doctype html><html lang="en"><body><main>
<div data-testid="composer" id="shared-composer">
<button data-testid="model-switcher-dropdown-button">Pro</button>
<form id="first-form"><textarea name="prompt-textarea" id="first-draft">First draft</textarea></form>
<form id="second-form"><textarea name="prompt-textarea" id="second-draft">Second draft</textarea></form>
<footer><button id="shared-js" aria-label="Send">Send</button>
<button id="shared-submit" aria-label="Send">Send</button></footer>
</div></main><script>
window.sharedSent=0;window.formSent=0;
document.querySelector('#shared-js').addEventListener('click',()=>window.sharedSent++);
document.querySelector('#shared-submit').addEventListener('click',()=>document.querySelector('#second-form').requestSubmit());
document.querySelector('#second-form').addEventListener('submit',e=>{e.preventDefault();window.formSent++;});
document.querySelector('#first-form').addEventListener('submit',e=>e.preventDefault());
</script></body></html>'''

EFFORT_HTML = '''<!doctype html><html lang="en"><body>
<header><button data-testid="model-switcher-dropdown-button">Pro</button></header>
<main><div data-testid="composer" id="effort-composer">
<button data-testid="reasoning-effort-button" id="effort">High</button>
<textarea name="prompt-textarea" id="effort-draft">Draft stays</textarea>
<button aria-label="Send" id="effort-send">Send</button>
</div></main><script>
window.effortSent=0;
document.querySelector('#effort-send').addEventListener('click',()=>window.effortSent++);
</script></body></html>'''

class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        data=(SHARED_HTML if self.path.startswith('/shared') else EFFORT_HTML if self.path.startswith('/effort') else HTML).encode()
        self.send_response(200)
        self.send_header('Content-Type','text/html; charset=utf-8')
        self.send_header('Content-Length',str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def log_message(self,fmt,*args):pass


def isolated_world_state(cdp, contexts):
    details=[]
    for ctx in contexts:
        # A content script runs in an isolated world, but recent Chromium
        # versions do not promise that the world origin starts with
        # chrome-extension://. Test the actual production sentinel and verify
        # that it is NOT the page's default execution context.
        if ctx.get('auxData',{}).get('isDefault') is True: continue
        try:
            result=cdp.send('Runtime.evaluate',{
                'contextId':ctx['id'],
                'expression':'''JSON.stringify({
                    installed:Boolean(globalThis.__chromofoxProSendGuardInstalled),
                    logicLoaded:Boolean(globalThis.ChromofoxProSendLogic),
                    model:globalThis.ChromofoxProSendLogic?.selectedMode(document,globalThis.ChromofoxProSendLogic?.composerRoot(document,document.querySelector('#composer-submit-button'))),
                    mainComposer:globalThis.ChromofoxProSendLogic?.composerRoot(document,document.querySelector('#composer-submit-button'))?.id,
                    editRecognised:globalThis.ChromofoxProSendLogic?.isSendButton(document.querySelector('#edit-send'),document),
                    formRecognised:globalThis.ChromofoxProSendLogic?.isComposerForm(document.querySelector('#chat-form'),document),
                    sendRecognised:globalThis.ChromofoxProSendLogic?.isSendButton(document.querySelector('#composer-submit-button'),document)
                })''',
                'returnByValue':True
            })
            value=result.get('result',{}).get('value')
            parsed=json.loads(value or '{}')
            if parsed.get('installed'):
                details.append({'origin':ctx.get('origin'),'value':value,
                    'exception':result.get('exceptionDetails',{}).get('text')})
        except Exception as err:details.append({'origin':ctx.get('origin'),'error':str(err)[:250]})
    return details


def diagnostics(cdp, contexts, profile):
    print('DEBUG contexts:', [(c.get('name'),c.get('origin')) for c in contexts],flush=True)
    try:
        flags=cdp.send('Browser.getBrowserCommandLine').get('arguments',[])
        print('DEBUG extension flags:',[v for v in flags if any(x in v for x in ['extension','headless','user-data-dir'])],flush=True)
    except Exception as err:print('DEBUG command line unavailable:',str(err)[:200],flush=True)
    try:
        targets=cdp.send('Target.getTargets').get('targetInfos',[])
        print('DEBUG targets:',[(t.get('type'),t.get('url')) for t in targets if 'extension' in t.get('url','')],flush=True)
    except Exception as err:print('DEBUG targets unavailable:',str(err)[:200],flush=True)
    try:
        pref=json.loads((profile/'Default'/'Preferences').read_text())
        print('DEBUG registered extension ids:',list(pref.get('extensions',{}).get('settings',{})),flush=True)
    except Exception as err:print('DEBUG preferences unavailable:',str(err)[:200],flush=True)


def main():
    subprocess.run(['node','build.mjs'],cwd=ROOT,check=True,capture_output=True)
    with TemporaryDirectory(prefix='pro-send-guard-') as tmp, ThreadingHTTPServer(('127.0.0.1',0),Fixture) as server:
        thread=Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            root=Path(tmp)
            ext=root/'extension'
            shutil.copytree(ROOT/'dist'/'chrome',ext)
            manifest_path=ext/'manifest.json'
            manifest=json.loads(manifest_path.read_text())
            assert manifest['content_scripts'][0]['run_at']=='document_start'
            assert manifest['content_scripts'][0]['matches']==['https://chatgpt.com/*','https://chat.openai.com/*']
            manifest['content_scripts'][0]['matches'].append('http://127.0.0.1/*')
            manifest_path.write_text(json.dumps(manifest))
            profile=root/'profile'
            # Control extension: identical Playwright launch mode, but no project
            # files, permissions, storage or model logic. This isolates Chromium
            # registration failure from the package under test.
            control=root/'control'
            control.mkdir()
            (control/'manifest.json').write_text(json.dumps({
                'manifest_version':3,'name':'MV3 Registration Control',
                'version':'0.0.1','content_scripts':[{
                    'matches':['http://127.0.0.1/*'],
                    'js':['probe.js'],'run_at':'document_start'}]
            }))
            (control/'probe.js').write_text(
                "const mark=()=>document.documentElement?.setAttribute('data-mv3-control','loaded');"
                "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',mark,{once:true})}"
                "else{mark()}")
            with sync_playwright() as p:
                # CDP installs only after Chromium has initialized its profile.
                # A synchronous success ID avoids falsely assuming that CLI
                # side-loading completed, and requires no background worker.
                probe_args=['--no-sandbox','--enable-unsafe-extension-debugging']
                probe_opts=dict(user_data_dir=str(root/'probe-profile'),
                    headless=False,channel='chromium',
                    ignore_default_args=['--disable-extensions'],args=probe_args)
                if os.getenv('CHROME_BIN'):
                    probe_opts['executable_path']=os.environ['CHROME_BIN']
                    del probe_opts['channel']
                probe=p.chromium.launch_persistent_context(**probe_opts)
                try:
                    control_page=probe.new_page()
                    assert probe.browser is not None, 'Persistent context missing owning browser for CDP install'
                    probe_cdp=probe.browser.new_browser_cdp_session()
                    control_install=probe_cdp.send('Extensions.loadUnpacked',{'path':str(control.resolve())})
                    assert control_install.get('id'), 'Control MV3 failed to register via Extensions.loadUnpacked'
                    print('REGISTRATION CONTROL ID:',control_install['id'],flush=True)
                    control_page.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='load')
                    for _ in range(5):
                        if control_page.locator('html').get_attribute('data-mv3-control')=='loaded':
                            break
                        control_page.wait_for_timeout(400)
                        control_page.reload()
                    probe_loaded=control_page.locator('html').get_attribute('data-mv3-control')=='loaded'
                    print('REGISTRATION CONTROL:',probe_loaded,flush=True)
                    assert probe_loaded, 'Chromium could not load a trivial MV3 content-script extension: harness/browser registration failure'
                finally:
                    probe.close()
                args=['--no-sandbox','--enable-unsafe-extension-debugging']
                opts=dict(user_data_dir=str(profile),headless=False,channel='chromium',ignore_default_args=['--disable-extensions'],args=args)
                if os.getenv('CHROME_BIN'):
                    opts['executable_path']=os.environ['CHROME_BIN'];del opts['channel']
                browser=p.chromium.launch_persistent_context(**opts)
                try:
                    page=browser.new_page()
                    contexts=[]
                    cdp=browser.new_cdp_session(page)
                    cdp.on('Runtime.executionContextCreated',lambda e:contexts.append(e['context']))
                    cdp.send('Runtime.enable')
                    assert browser.browser is not None, 'Persistent context missing owning browser for CDP install'
                    install_cdp=browser.browser.new_browser_cdp_session()
                    installed=install_cdp.send('Extensions.loadUnpacked',{'path':str(ext.resolve())})
                    assert installed.get('id'), 'Pro Send Guard failed to register via Extensions.loadUnpacked'
                    print('PACKAGED EXTENSION ID:',installed['id'],flush=True)
                    decisions=[False,True,True,False]
                    dialogs=[]
                    def on_dialog(dialog):
                        assert dialog.type=='confirm',dialog.type
                        dialogs.append(dialog.message)
                        assert 'Pro' in dialog.message,dialog.message
                        assert decisions,'Unexpected extra confirmation'
                        (dialog.accept if decisions.pop(0) else dialog.dismiss)()
                    page.on('dialog',on_dialog)
                    # The CDP installer returned an extension ID before navigation;
                    # the listener below must therefore run at document_start.
                    page.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='load')
                    isolated=isolated_world_state(cdp,contexts)
                    for attempt in range(1, 7):
                        if isolated:
                            break
                        page.wait_for_timeout(800)
                        contexts.clear()
                        page.reload(wait_until='load')
                        isolated=isolated_world_state(cdp,contexts)
                    if not isolated:
                        diagnostics(cdp,contexts,profile)
                        raise AssertionError('No isolated extension execution context was created after bounded installation retries')
                    assert page.evaluate('typeof window.__chromofoxProSendGuardInstalled')=='undefined','Guard marker leaked from isolated world'
                    assert any(
                        (lambda v: v.get('installed') and v.get('sendRecognised') and
                         v.get('formRecognised') and v.get('editRecognised') and
                         v.get('mainComposer')=='main-composer' and
                         v.get('model',{}).get('mode')=='pro')(json.loads(o.get('value') or '{}'))
                        for o in isolated),str(isolated)
                    page.click('#composer-submit-button')
                    assert page.evaluate('window.sent')==0,'Cancel did not block requestSubmit: '+repr(dialogs)
                    assert page.locator('#draft').input_value()=='Draft survives cancellation'
                    assert len(dialogs)==1,dialogs
                    page.click('#composer-submit-button')
                    assert page.evaluate('window.sent')==1,'Approval did not send exactly once'
                    assert len(dialogs)==2,'Duplicate confirmation for single send'
                    page.click('#composer-submit-button')
                    assert page.evaluate('window.sent')==2
                    assert len(dialogs)==3 and len(decisions)==1,'New gesture failed to reprompt'
                    page.click('#edit-send')
                    assert page.evaluate('window.editSent')==1,'Unrelated High edit composer must remain separately routable'
                    assert len(dialogs)==3,'A High edit composer cannot borrow a Pro confirmation'
                    page.evaluate("document.querySelector('#active-model').textContent='Unrecognised Next Model'")
                    page.click('#composer-submit-button')
                    assert page.evaluate('window.sent')==2,'Unrecognised active model must not be suppressed by unrelated High'
                    assert len(dialogs)==4 and not decisions,'Unknown selector should confirm'
                    assert 'cannot verify' in dialogs[3].lower(),dialogs[3]

                    # P1-A: one named composer containing two visible forms and
                    # a shared JS-only Send footer. It must NOT silently bypass.
                    decisions.extend([False, True, True, False, True])
                    page.goto(f'http://127.0.0.1:{server.server_port}/shared',wait_until='load')
                    assert page.evaluate('typeof window.__chromofoxProSendGuardInstalled')=='undefined'
                    page.click('#shared-js')
                    assert page.evaluate('window.sharedSent')==0
                    assert len(dialogs)==5 and 'cannot verify' in dialogs[-1].lower()
                    assert page.locator('#first-draft').input_value()=='First draft'
                    assert page.locator('#second-draft').input_value()=='Second draft'
                    page.click('#shared-js')
                    assert page.evaluate('window.sharedSent')==1 and len(dialogs)==6
                    page.click('#shared-submit')
                    assert page.evaluate('window.formSent')==1 and len(dialogs)==7, 'Shared click/requestSubmit must confirm once'
                    # A later *distinct* direct submit must not borrow approval.
                    page.locator('#second-form').evaluate('(form)=>form.requestSubmit()')
                    assert page.evaluate('window.formSent')==1 and len(dialogs)==8
                    page.click('#shared-submit')
                    assert page.evaluate('window.formSent')==2 and len(dialogs)==9 and not decisions

                    # P1-B: visible but UNLINKED header Pro plus in-composer
                    # High reasoning-effort is UNKNOWN, not authoritative non-Pro.
                    decisions.extend([False, True, False])
                    page.goto(f'http://127.0.0.1:{server.server_port}/effort',wait_until='load')
                    assert page.evaluate('typeof window.__chromofoxProSendGuardInstalled')=='undefined'
                    page.click('#effort-send')
                    assert page.evaluate('window.effortSent')==0 and len(dialogs)==10
                    assert 'cannot verify' in dialogs[-1].lower(),dialogs[-1]
                    assert page.locator('#effort-draft').input_value()=='Draft stays'
                    page.click('#effort-send')
                    assert page.evaluate('window.effortSent')==1 and len(dialogs)==11
                    # A genuinely identified non-Pro model picker overrides an
                    # unrelated High effort control without a confirmation.
                    page.evaluate("""() => { const b=document.createElement('button');
                        b.id='local-model';b.dataset.testid='model-switcher-dropdown-button';
                        b.textContent='Instant';document.querySelector('#effort-composer').prepend(b); }""")
                    page.click('#effort-send')
                    assert page.evaluate('window.effortSent')==2 and len(dialogs)==11
                    page.evaluate("document.querySelector('#local-model').textContent='Pro Extended'")
                    page.click('#effort-send')
                    assert page.evaluate('window.effortSent')==2 and len(dialogs)==12 and not decisions
                    print('PASS: packaged Chromium MV3 document_start, ambiguous shared-footer JS sends, model-versus-effort provenance, repeated/cross-form confirmations')
                finally:browser.close()
        finally:server.shutdown();thread.join(timeout=3)

if __name__=='__main__':main()
