"""Offline Chromium MV3 test of real document_start isolated-world injection.

The temporary test extension is copied from the production build, with only
an extra localhost match in its manifest. No ChatGPT traffic or real sends.
"""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
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

class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        data = HTML.encode()
        self.send_response(200)
        self.send_header('Content-Type','text/html; charset=utf-8')
        self.send_header('Content-Length',str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass


def main():
    subprocess.run(['node','build.mjs'],cwd=ROOT,check=True,capture_output=True)
    with TemporaryDirectory(prefix='pro-send-guard-') as temp, ThreadingHTTPServer(('127.0.0.1',0),Fixture) as http:
        origin = f'http://127.0.0.1:{http.server_port}'
        thread = Thread(target=http.serve_forever,daemon=True)
        thread.start()
        try:
            ext = Path(temp)/'extension'
            shutil.copytree(ROOT/'dist'/'chrome',ext)
            manifest_path=ext/'manifest.json'
            manifest=json.loads(manifest_path.read_text())
            assert manifest['content_scripts'][0]['run_at']=='document_start'
            manifest['content_scripts'][0]['matches'].append('http://127.0.0.1/*')
            manifest_path.write_text(json.dumps(manifest))
            with sync_playwright() as p:
                args=[f'--disable-extensions-except={ext}',f'--load-extension={ext}','--no-sandbox']
                opts=dict(user_data_dir=str(Path(temp)/'profile'),headless=True,channel='chromium',args=args)
                if os.getenv('CHROME_BIN'):
                    opts['executable_path']=os.environ['CHROME_BIN']
                    del opts['channel']
                context=p.chromium.launch_persistent_context(**opts)
                try:
                    page=context.new_page()
                    decisions=[False,True,True]
                    dialogs=[]
                    def on_dialog(dialog):
                        assert dialog.type=='confirm',dialog.type
                        assert 'Pro' in dialog.message,dialog.message
                        dialogs.append(dialog.message)
                        assert decisions,'unexpected extra confirmation'
                        (dialog.accept if decisions.pop(0) else dialog.dismiss)()
                    page.on('dialog',on_dialog)
                    page.goto(origin,wait_until='load')
                    assert page.evaluate('typeof window.__chromofoxProSendGuardInstalled')=='undefined', 'Content script must be isolated'
                    page.click('#composer-submit-button')
                    assert page.evaluate('window.sent')==0,'Cancel did not block requestSubmit'
                    assert page.locator('#draft').input_value()=='Draft survives cancellation'
                    assert len(dialogs)==1,dialogs
                    page.click('#composer-submit-button')
                    assert page.evaluate('window.sent')==1,'Approval must submit once'
                    assert len(dialogs)==2,f'duplicate prompts: {dialogs}'
                    page.click('#composer-submit-button')
                    assert page.evaluate('window.sent')==2
                    assert len(dialogs)==3,'Every new Pro send must reprompt'
                    assert not decisions
                    print('PASS: packaged Chromium MV3 document_start isolated-world dialogs/cancel/approve/repeat/requestSubmit')
                finally:
                    context.close()
        finally:
            http.shutdown()
            thread.join(timeout=3)

if __name__=='__main__':
    main()
