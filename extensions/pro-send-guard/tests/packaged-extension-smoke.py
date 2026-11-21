"""Offline Chromium MV3 test of the EXACT production package at ChatGPT origin.

Routes fulfill the ChatGPT URL locally; no live site/network access or Pro sends.
The full Chromium channel is required for actual headless extension loading.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright
import json
import os
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent
HTML = '''<!doctype html><html><body><main><div data-testid="composer">
<button data-testid="model-switcher-dropdown-button">Pro</button>
<form id="chat-form"><textarea name="prompt-textarea" id="draft">Draft survives cancellation</textarea></form>
<button type="button" id="composer-submit-button" aria-label="Send">Send</button>
</div></main><script>window.sent=0;
document.getElementById('composer-submit-button').addEventListener('click',()=>document.getElementById('chat-form').requestSubmit());
document.getElementById('chat-form').addEventListener('submit',e=>{e.preventDefault();window.sent++;});
</script></body></html>'''


def isolated_world_state(cdp, contexts):
    details = []
    for ctx in contexts:
        if not str(ctx.get('origin', '')).startswith('chrome-extension://'):
            continue
        try:
            result = cdp.send('Runtime.evaluate', {
                'contextId': ctx['id'],
                'expression': '''JSON.stringify({
                    installed: Boolean(globalThis.__chromofoxProSendGuardInstalled),
                    logicLoaded: Boolean(globalThis.ChromofoxProSendLogic),
                    model: globalThis.ChromofoxProSendLogic?.selectedMode(document),
                    sendRecognised: globalThis.ChromofoxProSendLogic?.isSendButton(document.querySelector('#composer-submit-button'), document)
                })''',
                'returnByValue': True
            })
            details.append({'name': ctx.get('name'), 'origin': ctx.get('origin'), 'result': result.get('result',{}).get('value'), 'error': result.get('exceptionDetails',{}).get('text')})
        except Exception as error:
            details.append({'origin': ctx.get('origin'), 'error': str(error)[:250]})
    return details


def main():
    subprocess.run(['node','build.mjs'],cwd=ROOT,check=True,capture_output=True)
    with TemporaryDirectory(prefix='pro-send-guard-') as temp:
        ext=Path(temp)/'extension'
        shutil.copytree(ROOT/'dist'/'chrome',ext)
        manifest=json.loads((ext/'manifest.json').read_text())
        assert manifest['content_scripts'][0]['run_at']=='document_start'
        assert manifest['content_scripts'][0]['matches']==['https://chatgpt.com/*','https://chat.openai.com/*']
        with sync_playwright() as p:
            args=[f'--disable-extensions-except={ext}',f'--load-extension={ext}','--no-sandbox']
            opts=dict(user_data_dir=str(Path(temp)/'profile'),headless=True,channel='chromium',args=args)
            if os.getenv('CHROME_BIN'):
                opts['executable_path']=os.environ['CHROME_BIN']
                del opts['channel']
            context=p.chromium.launch_persistent_context(**opts)
            try:
                # Every request is routed. No external ChatGPT connections are made.
                context.route('**/*',lambda route:route.abort())
                context.route('https://chatgpt.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body=HTML))
                page=context.new_page()
                worlds=[]
                cdp=context.new_cdp_session(page)
                cdp.on('Runtime.executionContextCreated',lambda e:worlds.append(e['context']))
                cdp.send('Runtime.enable')
                decisions=[False,True,True]
                dialogs=[]
                def on_dialog(dialog):
                    assert dialog.type=='confirm',dialog.type
                    assert 'Pro' in dialog.message,dialog.message
                    dialogs.append(dialog.message)
                    assert decisions,'unexpected extra confirmation'
                    (dialog.accept if decisions.pop(0) else dialog.dismiss)()
                page.on('dialog',on_dialog)
                page.goto('https://chatgpt.com/',wait_until='load')
                assert page.evaluate('typeof window.__chromofoxProSendGuardInstalled')=='undefined', 'Content script must be isolated'
                isolated=isolated_world_state(cdp,worlds)
                assert isolated, 'No Chromium extension isolated context was created; worlds='+str([(w.get('name'),w.get('origin')) for w in worlds])
                assert any('"installed":true' in str(x.get('result')) for x in isolated), 'Content script not installed in isolated world: '+str(isolated)
                assert any('"sendRecognised":true' in str(x.get('result')) for x in isolated), 'Content script did not recognise Send control: '+str(isolated)
                page.click('#composer-submit-button')
                if page.evaluate('window.sent')!=0:
                    raise AssertionError('Cancel did not block requestSubmit; dialogs='+repr(dialogs)+' isolated='+repr(isolated_world_state(cdp,worlds)))
                assert page.locator('#draft').input_value()=='Draft survives cancellation'
                assert len(dialogs)==1,dialogs
                page.click('#composer-submit-button')
                assert page.evaluate('window.sent')==1,'Approval must submit once'
                assert len(dialogs)==2,f'duplicate prompts: {dialogs}'
                page.click('#composer-submit-button')
                assert page.evaluate('window.sent')==2
                assert len(dialogs)==3,'Every new Pro send must reprompt'
                assert not decisions
                print('PASS: exact packaged Chromium MV3, ChatGPT-origin offline route, isolated document_start, cancel/approve/repeat/requestSubmit')
            finally:
                context.close()

if __name__=='__main__':
    main()
