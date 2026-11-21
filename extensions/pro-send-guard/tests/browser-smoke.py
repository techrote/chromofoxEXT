"""Offline Chromium browser regression. No connection to ChatGPT is made."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
HTML = '''<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>
  <button aria-label="Upgrade to Pro" id="upsell">Upgrade to Pro</button>
  <main>
    <div data-testid="composer" id="composer">
      <button type="button" data-testid="model-switcher-dropdown-button" id="model">Pro</button>
      <form id="chat-form">
        <div id="prompt-textarea" contenteditable="true" role="textbox">Draft must stay</div>
        <button data-testid="send-button" type="submit" id="send">Send</button>
      </form>
    </div>
  </main>
</body></html>'''
SETUP = '''
window._settings = { enabled: true, protectUnknown: true };
window._changeListeners = [];
window.chrome = {
  runtime: { lastError: null },
  storage: {
    local: { get: (_defaults, cb) => cb(window._settings) },
    onChanged: { addListener: callback => window._changeListeners.push(callback) }
  }
};
window._confirmResult = false;
window._confirmMessages = [];
window.confirm = message => { window._confirmMessages.push(message); return window._confirmResult; };
void 0;
'''
APP = '''
window.sent = 0;
window.sentTrusted = [];
document.getElementById('chat-form').addEventListener('submit', event => {
 event.preventDefault(); window.sent++; window.sentTrusted.push(event.isTrusted);
 document.getElementById('prompt-textarea').textContent = '';
});
window.setModel = (label, testid = 'model-switcher-dropdown-button') => {
 const button = document.getElementById('model');
 button.textContent = label;
 button.setAttribute('data-testid', testid);
};
window.setPreference = (key, value) => {
 window._settings[key] = value;
 for (const cb of window._changeListeners) cb({ [key]: {newValue:value} }, 'local');
};
window.resetDraft = () => { document.getElementById('prompt-textarea').textContent = 'Draft must stay'; };
void 0;
'''


def new_page(browser, html=HTML, app=APP):
    page = browser.new_page()
    page.set_content(html)
    page.evaluate(SETUP)
    page.add_script_tag(path=str(ROOT / 'src/mode.js'))
    page.add_script_tag(path=str(ROOT / 'src/content.js'))
    page.evaluate(app)
    return page


def state(page):
    return page.evaluate('({sent:window.sent, draft:document.getElementById("prompt-textarea").textContent, confirmations:window._confirmMessages.slice()})')


def additional_layout_regressions(browser):
    # A sibling Send button invokes JS requestSubmit. Click and submit have
    # different DOM targets but MUST share precisely one approval.
    sibling_html = '''<!doctype html><html><body><main>
      <div id="composer" data-testid="composer">
        <button id="model" data-testid="model-switcher-dropdown-button">Pro</button>
        <form id="chat-form"><textarea name="prompt-textarea" id="draft">Draft must stay</textarea></form>
        <button type="button" id="send" aria-label="Send">Send</button>
      </div></main></body></html>'''
    app = '''window.sent=0;
      document.querySelector('#send').addEventListener('click', () => document.querySelector('form').requestSubmit());
      document.querySelector('form').addEventListener('submit', e=>{e.preventDefault();window.sent++});'''
    page = new_page(browser, sibling_html, app)
    page.click('#send')
    assert page.evaluate('window.sent') == 0
    assert len(page.evaluate('window._confirmMessages')) == 1
    assert page.locator('#draft').input_value() == 'Draft must stay'
    page.evaluate('window._confirmResult=true')
    page.click('#send')
    assert page.evaluate('window.sent') == 1, page.evaluate('window._confirmMessages')
    assert len(page.evaluate('window._confirmMessages')) == 2, page.evaluate('window._confirmMessages')
    page.click('#send')
    assert page.evaluate('window.sent') == 2
    assert len(page.evaluate('window._confirmMessages')) == 3, 'One prompt per gesture, not per event'
    page.close()

    # ProseMirror div with no role/testid and a standalone button which sends
    # only through JS onClick (no native form submit).
    prose_html = '''<!doctype html><html><body><main>
      <div data-testid="composer" id="composer">
        <button data-testid="model-switcher-dropdown-button" id="model">GPT-6 Pro</button>
        <div class="ProseMirror" contenteditable="true" id="draft">Draft must stay</div>
        <button type="button" id="composer-submit-button" aria-label="Send">Send</button>
      </div></main></body></html>'''
    app = '''window.sent=0;
      document.getElementById('composer-submit-button').addEventListener('click',()=>{window.sent++;});'''
    page = new_page(browser, prose_html, app)
    page.click('#composer-submit-button')
    assert page.evaluate('window.sent') == 0
    assert len(page.evaluate('window._confirmMessages')) == 1
    assert page.locator('#draft').inner_text() == 'Draft must stay'
    page.evaluate('window._confirmResult = true')
    page.click('#composer-submit-button')
    assert page.evaluate('window.sent') == 1
    page.locator('#draft').focus()
    page.keyboard.press('Enter')
    assert len(page.evaluate('window._confirmMessages')) == 3, 'Bare ProseMirror Enter must be covered'
    page.close()

    # Unlabelled generic textarea is accepted ONLY inside a visible composer.
    generic_html = '''<!doctype html><html><body><main>
      <div data-testid="composer"><button data-testid="model-switcher-button">Pro</button>
      <textarea id="draft">Draft must stay</textarea><button aria-label="Send" id="send">Send</button>
      </div></main></body></html>'''
    page = new_page(browser, generic_html, 'window.sent=0; document.querySelector("#send").onclick=()=>window.sent++; void 0;')
    page.click('#send')
    assert page.evaluate('window.sent') == 0
    assert len(page.evaluate('window._confirmMessages')) == 1
    page.close()

    # Hidden model controls cannot override an unrecognised current model.
    # CSS visibility, aria-hidden ancestors and inert are disqualifying.
    hidden_html = '''<!doctype html><html><body><main>
      <div data-testid="composer">
        <div style="display:none"><button data-testid="model-switcher-dropdown-button">High</button></div>
        <div style="visibility:hidden"><button data-testid="reasoning-effort-button">Medium</button></div>
        <div aria-hidden="true"><button data-testid="model-switcher-button">Instant</button></div>
        <div inert><button data-testid="model-switcher-dropdown-button">Extra High</button></div>
        <button id="model" data-testid="other-new-model-picker">Unrecognised New Model</button>
        <div class="ProseMirror" contenteditable="true">Draft must stay</div>
        <button id="send" aria-label="Send">Send</button>
      </div></main></body></html>'''
    page = new_page(browser, hidden_html, 'window.sent=0;document.querySelector("#send").onclick=()=>window.sent++; void 0;')
    assert page.evaluate('ChromofoxProSendLogic.selectedMode(document).mode') == 'unknown'
    page.click('#send')
    assert page.evaluate('window.sent') == 0
    assert 'cannot verify' in page.evaluate('window._confirmMessages[0]')
    page.evaluate('''() => { document.getElementById('model').dataset.testid='model-switcher-dropdown-button'; document.getElementById('model').textContent='Pro'; }''')
    assert page.evaluate('ChromofoxProSendLogic.selectedMode(document).mode') == 'pro'
    page.evaluate('''() => { const b=document.createElement('button'); b.dataset.testid='thinking-effort-button';b.textContent='High';document.querySelector('[data-testid="composer"]').prepend(b); }''')
    assert page.evaluate('ChromofoxProSendLogic.selectedMode(document).mode') == 'unknown', 'Conflicting visible labels are not certainly non-Pro'
    page.click('#send')
    assert page.evaluate('window.sent') == 0 and len(page.evaluate('window._confirmMessages')) == 2
    page.close()

    print('PASS: alternate textarea/ProseMirror/button layouts, JS sends, external requestSubmit, hidden/stale/ambiguous models')

def main():
    with sync_playwright() as p:
        chrome = os.environ.get('CHROME_BIN') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
        opts = {'headless': True, 'args': ['--no-sandbox']}
        if chrome: opts['executable_path'] = chrome
        else: opts['channel'] = 'chromium'
        browser = p.chromium.launch(**opts)
        try:
            page = new_page(browser)
            # Click cancel blocks original submit and retains draft.
            page.click('#send')
            assert state(page)['sent'] == 0
            assert state(page)['draft'] == 'Draft must stay'
            assert len(state(page)['confirmations']) == 1, state(page)
            assert 'Pro' in state(page)['confirmations'][0]
            # Approval allows original browser event and its implicit form submit, no duplication.
            page.evaluate('window._confirmResult = true')
            page.click('#send')
            assert state(page)['sent'] == 1, state(page)
            assert len(state(page)['confirmations']) == 2, state(page)
            page.evaluate('window.resetDraft()')
            page.click('#send')
            assert state(page)['sent'] == 2
            assert len(state(page)['confirmations']) == 3, 'A new click must require a new confirmation'
            page.close()

            page = new_page(browser)
            page.locator('#prompt-textarea').focus()
            page.keyboard.press('Enter')
            assert state(page)['sent'] == 0 and state(page)['draft'] == 'Draft must stay', state(page)
            assert len(state(page)['confirmations']) == 1, state(page)
            page.evaluate('window._confirmResult = true')
            page.keyboard.press('Enter')
            # Browser fixture has no React Enter handler, so the approval must not synthesize a submit.
            assert state(page)['sent'] == 0, 'Must not synthesize a send on Enter'
            assert len(state(page)['confirmations']) == 2
            page.keyboard.press('Shift+Enter')
            assert len(state(page)['confirmations']) == 2, 'Shift+Enter is a newline'
            page.evaluate('''() => { const e=new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}); document.getElementById('prompt-textarea').dispatchEvent(e); }''')
            assert len(state(page)['confirmations']) == 2, 'IME composition must not prompt'
            page.close()

            page = new_page(browser)
            # Specific non-Pro effort is safe; upsell elsewhere must not cause Pro prompt.
            for model in ['Instant', 'Medium', 'High', 'Extra High', 'Thinking']:
                page.evaluate('(label) => window.setModel(label)', model)
                page.click('#send')
                assert state(page)['sent'] > 0 and len(state(page)['confirmations']) == 0, (model,state(page))
                page.evaluate('window.resetDraft()')
            # A separate effort selector reporting Pro overrides a general model label.
            page.evaluate('''() => { window.setModel('GPT-6'); const b=document.createElement('button'); b.dataset.testid='reasoning-effort-button'; b.textContent='Pro Extended'; document.getElementById('composer').prepend(b); }''')
            page.click('#send')
            assert state(page)['sent'] == 5 and len(state(page)['confirmations']) == 1, state(page)
            page.close()

            page = new_page(browser)
            page.evaluate('window.setModel("GPT-6")')
            page.click('#send')
            assert state(page)['sent'] == 0 and 'cannot verify' in state(page)['confirmations'][0], state(page)
            page.evaluate('window.setPreference("protectUnknown",false)')
            page.click('#send')
            assert state(page)['sent'] == 1 and len(state(page)['confirmations']) == 1, state(page)
            page.evaluate('window.setPreference("enabled",false)')
            page.evaluate('window.setModel("Pro Standard")')
            page.click('#send')
            assert state(page)['sent'] == 2 and len(state(page)['confirmations']) == 1, state(page)
            page.close()
            additional_layout_regressions(browser)
            print('PASS: offline Chromium cancel/approve/Enter/Shift+Enter/IME/effort/upsell/unknown/preferences')
        finally:
            browser.close()

if __name__ == '__main__':
    main()
