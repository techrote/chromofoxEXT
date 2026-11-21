"""Offline Chromium browser regression. No connection to ChatGPT is made."""
from pathlib import Path
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


def new_page(browser):
    page = browser.new_page()
    page.set_content(HTML)
    page.evaluate(SETUP)
    page.add_script_tag(path=str(ROOT / 'src/mode.js'))
    page.add_script_tag(path=str(ROOT / 'src/content.js'))
    page.evaluate(APP)
    return page


def state(page):
    return page.evaluate('({sent:window.sent, draft:document.getElementById("prompt-textarea").textContent, confirmations:window._confirmMessages.slice()})')


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
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
            print('PASS: offline Chromium cancel/approve/Enter/Shift+Enter/IME/effort/upsell/unknown/preferences')
        finally:
            browser.close()

if __name__ == '__main__':
    main()
