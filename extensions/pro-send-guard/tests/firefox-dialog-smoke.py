"""Firefox native confirm/capture semantics via document-start-equivalent init script.

This is NOT a real signed/temporary Firefox extension installation test.
It is an offline check of Firefox dialogs and browser event propagation; the
owner must still accept the actual Firefox 159 extension against ChatGPT.
"""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent

HTML = '''<!doctype html><html><body><main><div data-testid="composer">
<button data-testid="model-switcher-dropdown-button">Pro</button>
<form id="form"><div class="ProseMirror" contenteditable="true" id="draft">Draft remains</div></form>
<button id="composer-submit-button" aria-label="Send">Send</button>
</div></main><script>
window.sent=0;
document.querySelector('#composer-submit-button').addEventListener('click',()=>document.querySelector('#form').requestSubmit());
document.querySelector('#form').addEventListener('submit',e=>{e.preventDefault();window.sent++;});
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

def main():
    stub='''window.chrome={runtime:{lastError:null},storage:{local:{get:(_v,cb)=>cb({enabled:true,protectUnknown:true})},onChanged:{addListener:()=>{}}}};'''
    code=stub+(ROOT/'src/mode.js').read_text()+(ROOT/'src/content.js').read_text()
    with ThreadingHTTPServer(('127.0.0.1',0),Fixture) as http:
        thread=Thread(target=http.serve_forever,daemon=True);thread.start()
        try:
            with sync_playwright() as p:
                browser=p.firefox.launch(headless=True)
                try:
                    context=browser.new_context()
                    context.add_init_script(script=code)
                    page=context.new_page()
                    confirmations=[]
                    decisions=[False,True,True]
                    def on_dialog(d):
                        assert d.type=='confirm'
                        assert 'Pro' in d.message
                        confirmations.append(d.message)
                        assert decisions, 'Unexpected extra confirmation'
                        (d.accept if decisions.pop(0) else d.dismiss)()
                    page.on('dialog',on_dialog)
                    page.goto(f'http://127.0.0.1:{http.server_port}',wait_until='load')
                    page.click('#composer-submit-button')
                    assert page.evaluate('window.sent')==0
                    assert page.locator('#draft').inner_text()=='Draft remains'
                    page.click('#composer-submit-button')
                    assert page.evaluate('window.sent')==1
                    page.click('#composer-submit-button')
                    assert page.evaluate('window.sent')==2
                    assert len(confirmations)==3
                    print('PASS: Firefox native confirm cancel/approval/repeat and JS requestSubmit (document-start-equivalent)')
                finally:browser.close()
        finally:http.shutdown();thread.join(timeout=3)

if __name__=='__main__':main()
