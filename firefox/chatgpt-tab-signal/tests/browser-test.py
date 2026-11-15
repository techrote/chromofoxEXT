"""Headless browser integration against a simulated ChatGPT composer.
Run: python tests/browser-test.py (requires Playwright + Chromium).
This validates the content script, but not the actual live chatgpt.com UI.
"""
import asyncio
from pathlib import Path
import re
from playwright.async_api import async_playwright

DIR = Path(__file__).resolve().parent

async def main():
    await test_browser()

async def test_browser():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        try:
            page = await browser.new_page()
            errors = []
            page.on('pageerror', lambda err: errors.append(str(err)))
            fixture = (DIR / 'browser-fixture.html').read_text()
            scripts = re.findall(r'<script(?: [^>]*)?>(.*?)</script>', fixture, flags=re.S)
            bare_html = re.sub(r'<script(?: [^>]*)?>.*?</script>', '', fixture, flags=re.S)
            await page.set_content(bare_html)
            await page.add_script_tag(content=scripts[0])
            await page.add_script_tag(content=(DIR.parent / 'core.js').read_text())
            await page.add_script_tag(content=(DIR.parent / 'content.js').read_text())
            await page.wait_for_function("window.__phase() === 'idle'")
            assert await page.title() == 'CyberSand PR #566'
            original = await page.evaluate('window.__favicon()')
            assert original == './original.png'
            print('PASS: initial idle; title/favicon unmodified')

            await page.evaluate('window.__addStop()')
            await page.wait_for_function("window.__phase() === 'working'")
            assert (await page.title()).startswith('⏳ ')
            assert 'working64.png' in await page.evaluate('window.__favicon()')
            print('PASS: Stop button produces working title/favicon')

            await page.evaluate("document.title = 'Revised conversation title'")
            await page.wait_for_function("document.title === '⏳ Revised conversation title'")
            print('PASS: host changes to title are preserved')

            await page.evaluate('window.__removeStop()')
            await page.wait_for_function("window.__phase() === 'done'")
            assert (await page.title()).startswith('✓ ')
            assert 'done64.png' in await page.evaluate('window.__favicon()')
            print('PASS: finishing changes favicon to green and latches completion')

            await page.wait_for_timeout(400)
            assert await page.evaluate('window.__phase()') == 'done'
            await page.click('#send')
            await page.wait_for_function("window.__phase() === 'idle'")
            assert await page.title() == 'Revised conversation title'
            assert await page.evaluate('window.__favicon()') == original
            print('PASS: interaction clears status, restores original icon/title')

            await page.evaluate('window.__addStop()')
            await page.wait_for_function("window.__phase() === 'working'")
            await page.click('#stop')
            await page.evaluate('window.__removeStop()')
            await page.wait_for_function("window.__phase() === 'stopped'")
            assert (await page.title()).startswith('■ ')
            print('PASS: manual Stop is not counted as successful completion')

            await page.evaluate('window.__addStop()')
            await page.wait_for_function("window.__phase() === 'working'")
            await page.evaluate('''() => {
                const a = document.createElement('div');
                a.role = 'alert'; a.textContent = 'Something went wrong';
                document.getElementById('messages').append(a);
                window.__removeStop();
            }''')
            await page.wait_for_function("window.__phase() === 'error'")
            assert (await page.title()).startswith('! ')
            print('PASS: visible failure detected')

            await page.evaluate('''async () => {
              document.querySelector('[role="alert"]').remove();
              await browser.storage.local.set({titleIndicator:false, faviconIndicator:false, toolbarBadge:false});
            }''')
            await page.wait_for_function("document.title === 'Revised conversation title'")
            assert await page.evaluate('window.__favicon()') == original
            assert (await page.evaluate('window.__messages.at(-1).toolbarBadge')) is False
            print('PASS: settings disable indicators and restore original title/favicon')

            await page.evaluate('''async () => {
              await browser.storage.local.set({titleIndicator:true, faviconIndicator:true, toolbarBadge:true});
              history.pushState({}, '', '#/c/new-conversation');
              window.dispatchEvent(new PopStateEvent('popstate'));
            }''')
            await page.wait_for_function("window.__phase() === 'idle'")
            assert await page.title() == 'Revised conversation title'
            print('PASS: conversation navigation resets indicator')

            await page.evaluate('window.__addIconOnlyStop()')
            await page.wait_for_function("window.__phase() === 'working'")
            await page.click('#stop')
            await page.evaluate('window.__removeStop()')
            await page.wait_for_function("window.__phase() === 'stopped'")
            print('PASS: October 2026 icon-only Stop glyph fallback')
            # Simulate an offscreen completion and then a return to the tab.
            await page.evaluate('''() => {
              window.__removeStop();
              Object.defineProperty(document, 'visibilityState', { configurable:true, get:()=>window.__vis });
              Object.defineProperty(document, 'hasFocus', { configurable:true, value:()=>window.__focused });
              window.__vis = 'hidden'; window.__focused = false;
              document.dispatchEvent(new Event('visibilitychange'));
              window.__addStop();
            }''')
            await page.wait_for_function("window.__phase() === 'working'")
            await page.evaluate('window.__removeStop()')
            await page.wait_for_function("window.__phase() === 'done'")
            await page.wait_for_timeout(400)
            assert await page.evaluate('window.__phase()') == 'done'
            await page.evaluate('''() => {
              window.__vis = 'visible'; window.__focused = true;
              document.dispatchEvent(new Event('visibilitychange'));
            }''')
            await page.wait_for_function("window.__phase() === 'idle'", timeout=5500)
            print('PASS: background completion remains latched and clears after return')

            assert not errors, f'Browser console errors: {errors}'
            print('PASS: no uncaught browser exceptions')
        finally:
            await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
