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
HTML = '''<!doctype html><html lang="en"><body><main><div data-testid="composer">
<button data-testid="model-switcher-dropdown-button">Pro</button>
<form id="chat-form"><textarea name="prompt-textarea" id="draft">Draft survives cancellation</textarea></form>
<button type="button" id="composer-submit-button" aria-label="Send">Send</button>
</div></main><script>window.sent=0;
document.getElementById('composer-submit-button').addEventListener('click',()=>document.getElementById('chat-form').requestSubmit());
document.getElementById('chat-form').addEventListener('submit',e=>{e.preventDefault();window.sent++;});
</script></body></html>'''

class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        data=HTML.encode()
        self.send_response(200)
        self.send_header('Content-Type','text/html; charset=utf-8')
        self.send_header('Content-Length',str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def log_message(self,fmt,*args):pass


def isolated_world_state(cdp, contexts):
    details=[]
    for ctx in contexts:
        if not str(ctx.get('origin','')).startswith('chrome-extension://'):continue
        try:
            result=cdp.send('Runtime.evaluate',{
                'contextId':ctx['id'],
                'expression':'''JSON.stringify({
                    installed:Boolean(globalThis.__chromofoxProSendGuardInstalled),
                    logicLoaded:Boolean(globalThis.ChromofoxProSendLogic),
                    model:globalThis.ChromofoxProSendLogic?.selectedMode(document),
                    sendRecognised:globalThis.ChromofoxProSendLogic?.isSendButton(document.querySelector('#composer-submit-button'),document)
                })''',
                'returnByValue':True
            })
            details.append({'origin':ctx.get('origin'),'value':result.get('result',{}).get('value'),
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
            with sync_playwright() as p:
                args=[f'--disable-extensions-except={ext}',f'--load-extension={ext}','--no-sandbox']
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
                    decisions=[False,True,True]
                    dialogs=[]
                    def on_dialog(dialog):
                        assert dialog.type=='confirm',dialog.type
                        dialogs.append(dialog.message)
                        assert 'Pro' in dialog.message,dialog.message
                        assert decisions,'Unexpected extra confirmation'
                        (dialog.accept if decisions.pop(0) else dialog.dismiss)()
                    page.on('dialog',on_dialog)
                    # Chromium installs unpacked extensions asynchronously at profile
                    # startup. The first navigation can race registration. Retry
                    # document loads on the same localhost origin, not production.
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
                    assert any('"installed":true' in str(o.get('value')) and '"sendRecognised":true' in str(o.get('value')) for o in isolated),str(isolated)
                    page.click('#composer-submit-button')
                    assert page.evaluate('window.sent')==0,'Cancel did not block requestSubmit: '+repr(dialogs)
                    assert page.locator('#draft').input_value()=='Draft survives cancellation'
                    assert len(dialogs)==1,dialogs
                    page.click('#composer-submit-button')
                    assert page.evaluate('window.sent')==1,'Approval did not send exactly once'
                    assert len(dialogs)==2,'Duplicate confirmation for single send'
                    page.click('#composer-submit-button')
                    assert page.evaluate('window.sent')==2
                    assert len(dialogs)==3 and not decisions,'New gesture failed to reprompt'
                    print('PASS: packaged Chromium MV3 isolated document_start, native confirm, cancel/approve/repeat/requestSubmit')
                finally:browser.close()
        finally:server.shutdown();thread.join(timeout=3)

if __name__=='__main__':main()
