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
    assert page.evaluate('ChromofoxProSendLogic.selectedMode(document).mode') == 'pro', 'High effort cannot override an identified Pro model'
    page.click('#send')
    assert page.evaluate('window.sent') == 0 and len(page.evaluate('window._confirmMessages')) == 2
    page.close()

    # Independent composers must be resolved per event target. Earlier editor
    # precedes main composer in DOM; neither Send click nor form may route to it.
    multi_html = '''<!doctype html><html><body><aside><button id="sidebar-high"
      data-testid="model-switcher-dropdown-button">High</button></aside><main>
      <div data-testid="composer" id="edit-composer">
        <button data-testid="model-switcher-dropdown-button">High</button>
        <form id="edit-form"><textarea name="prompt-textarea" id="edit-draft">Edit draft</textarea></form>
        <button id="edit-send" aria-label="Send">Send</button>
      </div>
      <div data-testid="composer" id="main-composer">
        <div role="combobox" id="active-model">Pro Extended</div>
        <form id="main-form"><div class="ProseMirror" contenteditable="true" id="main-draft">Main draft</div></form>
        <button id="main-send" aria-label="Send">Send</button>
      </div>
      </main></body></html>'''
    multi_app = '''window.mainSent=0;window.editSent=0;
      document.querySelector('#main-send').onclick=()=>document.querySelector('#main-form').requestSubmit();
      document.querySelector('#edit-send').onclick=()=>document.querySelector('#edit-form').requestSubmit();
      document.querySelector('#main-form').onsubmit=e=>{e.preventDefault();window.mainSent++};
      document.querySelector('#edit-form').onsubmit=e=>{e.preventDefault();window.editSent++};void 0;'''
    page = new_page(browser, multi_html, multi_app)
    check = page.evaluate('''() => {
      const L=ChromofoxProSendLogic;
      const b=document.querySelector('#main-send');
      const f=document.querySelector('#main-form');
      const e=document.querySelector('#main-draft');
      const r=L.composerRoot(document,b);
      return {root:r?.id, form:L.isComposerForm(f,document),
        send:L.isSendButton(b,document), enter:L.closestEditor(e)===e,
        model:L.selectedMode(document,r).mode,
        sidebar:L.selectedMode(document,L.composerRoot(document,document.querySelector('#edit-send'))).mode};
    }''')
    assert check=={'root':'main-composer','form':True,'send':True,'enter':True,
                    'model':'pro','sidebar':'non-pro'}, check
    page.click('#main-send')
    assert page.evaluate('window.mainSent')==0
    assert page.locator('#main-draft').inner_text()=='Main draft'
    assert len(page.evaluate('window._confirmMessages'))==1
    # Another composer is genuinely High and must not inherit the Pro approval.
    page.click('#edit-send')
    assert page.evaluate('window.editSent')==1
    assert len(page.evaluate('window._confirmMessages'))==1
    page.evaluate('window._confirmResult=true')
    page.click('#main-send')
    assert page.evaluate('window.mainSent')==1
    assert len(page.evaluate('window._confirmMessages'))==2, page.evaluate('window._confirmMessages')
    page.locator('#main-draft').focus()
    page.keyboard.press('Enter')
    assert len(page.evaluate('window._confirmMessages'))==3, 'Enter must target focused second editor'
    page.evaluate('window._confirmResult=false')
    page.wait_for_timeout(450)  # Existing Enter approval's one-shot window has expired.
    page.locator('#main-form').evaluate('(form)=>form.requestSubmit()')
    assert page.evaluate('window.mainSent')==1
    assert len(page.evaluate('window._confirmMessages'))==4, 'Direct form submit requires own confirmation'
    # Change Pro to unrecognised model; unrelated visible High may not suppress.
    page.evaluate('document.querySelector("#active-model").textContent="Unrecognised Next Model"')
    assert page.evaluate('''() => ChromofoxProSendLogic.selectedMode(document,
      ChromofoxProSendLogic.composerRoot(document,document.querySelector('#main-send'))).mode''')=='unknown'
    page.click('#main-send')
    assert page.evaluate('window.mainSent')==1
    assert 'cannot verify' in page.evaluate('window._confirmMessages[4]')
    # The user can opt out of unknown-model warnings, never automatically for High elsewhere.
    page.evaluate('''() => {
      window._settings.protectUnknown=false;
      for(const cb of window._changeListeners) cb({protectUnknown:{newValue:false}},'local');
    }''')
    page.click('#main-send')
    assert page.evaluate('window.mainSent')==2
    assert len(page.evaluate('window._confirmMessages'))==5
    page.close()

    # Two unnamed form+external-button shells: no global editor pick is allowed.
    unnamed_html = '''<!doctype html><html><body><main>
      <section id="edit-shell"><form id="edit-form"><textarea name="prompt-textarea">Edit</textarea></form>
        <button id="edit-send" aria-label="Send">Send</button></section>
      <section id="main-shell"><form id="main-form"><textarea name="prompt-textarea">New</textarea></form>
        <button id="main-send" aria-label="Send">Send</button></section>
      </main></body></html>'''
    page = new_page(browser,unnamed_html,'''
      window.mainSent=0;
      document.querySelector('#main-send').onclick=()=>document.querySelector('#main-form').requestSubmit();
      document.querySelector('#main-form').onsubmit=e=>{e.preventDefault();window.mainSent++};void 0;
    ''')
    assert page.evaluate('''() => {
      const L=ChromofoxProSendLogic;
      return L.composerRoot(document,document.querySelector('#main-send'))?.id==='main-shell' &&
        L.composerRoot(document,document.querySelector('#main-form'))?.id==='main-shell' &&
        L.isSendButton(document.querySelector('#main-send'),document) &&
        L.isComposerForm(document.querySelector('#main-form'),document);
    }''')
    page.click('#main-send')
    assert page.evaluate('window.mainSent')==0
    assert len(page.evaluate('window._confirmMessages'))==1
    page.evaluate('window._confirmResult=true')
    page.click('#main-send')
    assert page.evaluate('window.mainSent')==1
    assert len(page.evaluate('window._confirmMessages'))==2
    page.close()

    # A header selector may contribute only with an explicit association to
    # this composer; another visible High with no association is irrelevant.
    linked_html = '''<!doctype html><html><body>
      <header><button data-testid="model-switcher-button">High</button>
      <button data-testid="model-switcher-dropdown-button" aria-controls="main-composer">Pro Standard</button>
      </header><main><div data-testid="composer" id="main-composer">
        <textarea name="prompt-textarea">Draft</textarea>
        <button id="send" aria-label="Send">Send</button>
      </div></main></body></html>'''
    page = new_page(browser,linked_html,'window.sent=0; document.querySelector("#send").onclick=()=>window.sent++; void 0;')
    assert page.evaluate('''() => {
       const L=ChromofoxProSendLogic;
       return L.selectedMode(document,L.composerRoot(document,document.querySelector('#send'))).mode;
    }''')=='pro'
    page.click('#send')
    assert page.evaluate('window.sent')==0
    assert len(page.evaluate('window._confirmMessages'))==1
    page.close()

    print('PASS: two active composers, independent approvals, unrelated visible model controls, unnamed paired forms')

    print('PASS: alternate textarea/ProseMirror/button layouts, JS sends, external requestSubmit, hidden/stale/ambiguous models')

def adversarial_fail_open_regressions(browser):
    # Two visible forms share a single named composer and a JS-only Send footer.
    # No unique editor is identifiable from the button. The guard must protect
    # the recognized Send with an unknown-model confirmation, NOT fail open.
    shared_html = '''<!doctype html><html><body><main>
      <div data-testid="composer" id="shared-composer">
        <button data-testid="model-switcher-dropdown-button">Pro</button>
        <form id="first-form"><textarea name="prompt-textarea" id="first-draft">First draft</textarea></form>
        <form id="second-form"><textarea name="prompt-textarea" id="second-draft">Second draft</textarea></form>
        <footer><button id="shared-js" aria-label="Send">Send</button>
          <button id="shared-submit" aria-label="Send">Send</button></footer>
      </div></main></body></html>'''
    shared_app = '''window.sentJS=0;window.sentForm=0;
      document.querySelector('#shared-js').onclick=()=>window.sentJS++;
      document.querySelector('#shared-submit').onclick=()=>document.querySelector('#second-form').requestSubmit();
      document.querySelector('#second-form').onsubmit=e=>{e.preventDefault();window.sentForm++};
      document.querySelector('#first-form').onsubmit=e=>e.preventDefault();void 0;'''
    page = new_page(browser, shared_html, shared_app)
    route=page.evaluate('''() => {const L=ChromofoxProSendLogic;
      const js=document.querySelector('#shared-js');
      const sub=document.querySelector('#shared-submit');
      const form=document.querySelector('#second-form');
      return {clickRoot:L.composerRoot(document,js)?.id,
        button:L.isSendButton(js,document), other:L.isSendButton(sub,document),
        form:L.isComposerForm(form,document),
        selected:L.selectedMode(document,L.composerRoot(document,js)).mode};} ''')
    assert route=={'clickRoot':'shared-composer','button':True,'other':True,'form':True,'selected':'unknown'},route
    page.click('#shared-js')
    assert page.evaluate('window.sentJS')==0
    assert page.locator('#first-draft').input_value()=='First draft'
    assert page.locator('#second-draft').input_value()=='Second draft'
    assert len(page.evaluate('window._confirmMessages'))==1
    assert 'cannot verify' in page.evaluate('window._confirmMessages[0]')
    page.evaluate('window._confirmResult=true')
    page.click('#shared-js')
    assert page.evaluate('window.sentJS')==1
    assert len(page.evaluate('window._confirmMessages'))==2
    # Approval of the JS-only Send must not authorise another trusted click.
    page.click('#shared-submit')
    assert page.evaluate('window.sentForm')==1
    assert len(page.evaluate('window._confirmMessages'))==3, 'One confirm for click plus requestSubmit'
    page.click('#shared-submit')
    assert page.evaluate('window.sentForm')==2
    assert len(page.evaluate('window._confirmMessages'))==4, 'Every new Send gesture must prompt'
    # Direct form submission is still protected independently from the shared footer.
    page.wait_for_timeout(420)
    page.evaluate('window._confirmResult=false')
    page.locator('#second-form').evaluate('(f)=>f.requestSubmit()')
    assert page.evaluate('window.sentForm')==2
    assert len(page.evaluate('window._confirmMessages'))==5
    page.close()

    # An unnamed common shell has the same conservative fallback. The named
    # composer selector is not a precondition to protect a recognisable Send.
    unnamed_html = shared_html.replace('data-testid="composer" id="shared-composer"', 'id="shared-composer"')
    page = new_page(browser, unnamed_html, shared_app)
    assert page.evaluate('''() => {const L=ChromofoxProSendLogic;
      return L.composerRoot(document,document.querySelector('#shared-submit'))?.id;}''')=='shared-composer'
    page.click('#shared-submit')
    assert page.evaluate('window.sentForm')==0
    assert len(page.evaluate('window._confirmMessages'))==1
    page.evaluate('window._confirmResult=true')
    page.click('#shared-submit')
    assert page.evaluate('window.sentForm')==1, {'sent':page.evaluate('window.sentForm'), 'messages':page.evaluate('window._confirmMessages')}
    assert len(page.evaluate('window._confirmMessages'))==2, 'Unnamed shared click and form must get one prompt'
    # An approved JS-only click is NOT a reusable ticket for a later direct
    # form.submit; the cross-form allowance ends at the event-task boundary.
    page.click('#shared-js')
    assert page.evaluate('window.sentJS')==1
    assert len(page.evaluate('window._confirmMessages'))==3
    page.evaluate('window._confirmResult=false')
    page.locator('#second-form').evaluate('(f)=>f.requestSubmit()')
    assert page.evaluate('window.sentForm')==1
    assert len(page.evaluate('window._confirmMessages'))==4, 'Distinct form submit cannot borrow shared-footer approval'
    page.close()

    # Visible header Pro cannot be overridden by an unrelated local High
    # reasoning-effort widget. A standalone effort label has no model-family
    # authority, and so the default unknown-mode protection must apply.
    effort_html = '''<!doctype html><html><body>
      <header><button data-testid="model-switcher-dropdown-button">Pro</button></header><main>
      <div data-testid="composer" id="active-composer">
        <button id="effort" data-testid="reasoning-effort-button">High</button>
        <textarea name="prompt-textarea" id="draft">Pro model draft</textarea>
        <button id="send" aria-label="Send">Send</button>
      </div></main></body></html>'''
    page = new_page(browser,effort_html,'''window.sent=0;
      document.querySelector('#send').onclick=()=>window.sent++;void 0;''')
    assert page.evaluate('''() => { const L=ChromofoxProSendLogic;
       return L.selectedMode(document,L.composerRoot(document,document.querySelector('#send'))).mode; }''')=='unknown'
    page.click('#send')
    assert page.evaluate('window.sent')==0
    assert len(page.evaluate('window._confirmMessages'))==1
    assert 'cannot verify' in page.evaluate('window._confirmMessages[0]')
    page.evaluate('window._confirmResult=true')
    page.click('#send')
    assert page.evaluate('window.sent')==1
    assert len(page.evaluate('window._confirmMessages'))==2
    # Verified model switcher Instant is independent of the effort High.
    page.evaluate('''() => {const b=document.createElement('button');
      b.id='model';b.dataset.testid='model-switcher-dropdown-button';
      b.textContent='Instant';document.querySelector('#active-composer').prepend(b); }''')
    assert page.evaluate('''() => {const L=ChromofoxProSendLogic;
      return L.selectedMode(document,L.composerRoot(document,document.querySelector('#send'))).mode;}''')=='non-pro'
    page.click('#send')
    assert page.evaluate('window.sent')==2
    assert len(page.evaluate('window._confirmMessages'))==2
    page.evaluate("document.querySelector('#model').textContent='Pro Extended'")
    assert page.evaluate('''() => {const L=ChromofoxProSendLogic;
      return L.selectedMode(document,L.composerRoot(document,document.querySelector('#send'))).mode;}''')=='pro'
    page.evaluate('window._confirmResult=false')
    page.click('#send')
    assert page.evaluate('window.sent')==2
    assert len(page.evaluate('window._confirmMessages'))==3
    page.close()
    print('PASS: ambiguous shared-composer Send and effort-as-model false negative regressions')


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
            adversarial_fail_open_regressions(browser)
            print('PASS: offline Chromium cancel/approve/Enter/Shift+Enter/IME/effort/upsell/unknown/preferences')
        finally:
            browser.close()

if __name__ == '__main__':
    main()
