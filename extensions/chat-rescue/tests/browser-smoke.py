"""Offline Chromium integration smoke tests against simulated stuck ChatGPT shell.
Run: python tests/browser-smoke.py. No external services or real ChatGPT accounts.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

SRC = Path(__file__).resolve().parents[1] / 'src'
URL = 'https://chatgpt.com/c/6af99b19-4190-83ed-8628-7b601cdf1194'
HTML = '''<!DOCTYPE html><html><head><style>
body { margin:0; background:#15131b; color:white; }
main { position:relative; margin-left:60px; height:92vh; width:calc(100vw - 60px); }
.animate-spin { position:absolute; left:49%; top:48%; width:25px; height:25px; border-radius:50%; border:3px solid #bbb; }
</style></head><body><aside>ChatGPT</aside><main><div class="animate-spin" role="progressbar"></div></main></body></html>'''

def msg(page, command, approach=None):
    return page.evaluate('''([command, approach])=>{
      let result=null;
      window.__rescueListener({protocol:'CHAT_RESCUE_V1',command,approach},null,r=>{result=r});
      return result;
    }''', [command, approach])

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':1100,'height':800})
    context.add_init_script('''window.chrome=window.chrome||{};window.chrome.runtime={onMessage:{addListener:function(f){window.__rescueListener=f}},lastError:null};''')
    page = context.new_page()
    page.set_content(HTML)
    page.evaluate('(url) => window.__mockUrl = url', URL)
    page.add_script_tag(path=str(SRC/'logic.js'))
    # Offline test adapter only: virtualize location.href, since network policy forbids navigation to ChatGPT.
    page.add_script_tag(content=(SRC/'content.js').read_text().replace('location.href', 'window.__mockUrl'))
    assert msg(page,'state')['state']['state'] == 'loading-indicator'

    # Artificial events do not claim trusted input; all button/form targets avoided.
    count = page.evaluate('''() => {window.__pulseCount=0;document.querySelector('main').addEventListener('click', e=>{if(!e.isTrusted)window.__pulseCount++});return 0}''')
    assert msg(page,'start','pulse')['ok']
    page.wait_for_timeout(3400)
    status = msg(page,'state')['state']
    assert status['last']['approach']=='pulse',status
    assert status['last']['outcome']=='not-confirmed',status
    assert page.evaluate('window.__pulseCount') <=16
    assert page.evaluate('window.__pulseCount') >=1

    # Cancellation should clear pending observation and release the active slot.
    assert msg(page,'start','guided')['ok']
    assert msg(page,'stop')['ok']
    assert msg(page,'state')['state']['last']['outcome']=='cancelled'
    assert msg(page,'state')['state']['active'] is None

    # Genuine click events are measured separately from synthetic pulses.
    assert msg(page,'start','guided')['ok']
    spinner = page.locator('[role="progressbar"]').bounding_box()
    page.mouse.click(spinner['x']+spinner['width']/2+15, spinner['y']+spinner['height']/2)
    page.wait_for_timeout(100)
    active = msg(page,'state')['state']['active']
    assert active['clicksNear']>=1,active
    assert msg(page,'stop')['ok']

    # A SPA route change must cancel a running test and avoid cross-thread success.
    assert msg(page,'start','guided')['ok']
    page.evaluate("window.__mockUrl='https://chatgpt.com/c/99999999-9999-4999-8999-999999999999'")
    page.wait_for_timeout(500)
    page.evaluate('(url) => window.__mockUrl = url', URL)
    moved = msg(page,'state')['state']
    assert moved['active'] is None,moved
    assert moved['last']['outcome']=='cancelled',moved

    # Wake should preserve initial scroll and observe appearance of a message marker.
    page.evaluate('''() => setTimeout(()=>{const el=document.createElement('article');el.dataset.testid='conversation-turn-0';document.querySelector('main').appendChild(el)},500)''')
    assert msg(page,'start','safe-sequence')['ok']
    page.wait_for_timeout(2200)
    final = msg(page,'state')['state']
    assert final['state']=='messages-visible',final
    assert final['last']['outcome']=='messages-visible',final
    print('PASS: loading evidence, bounded synthetic events, stop, trusted click count, safe sequence, recovery observation')
    browser.close()
