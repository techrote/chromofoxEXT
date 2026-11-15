# Firefox UI tweak: Hide individual tab close (X) buttons

**Status:** Firefox 159 / Windows 11 implementation candidate. Manual browser acceptance pending.

Firefox WebExtensions cannot change Firefox's native tab-strip appearance. This is a Firefox-profile `userChrome.css` customization, **not** a WebExtension or an `.xpi`. It is intentionally independent of the other chromofoxEXT prototypes.

## Effect

- Hides the X button on standard Firefox tabs, including the active tab.
- Preserves middle-click, Ctrl+W, and tab context-menu closing.
- Does not affect close buttons inside webpages.
- Requires a browser restart. Vertical tabs and later Firefox releases need separate acceptance.

## Manual installation

1. Open `about:profiles` and identify **This is the profile in use**. Open its **Root Directory**.
2. Create its `chrome` folder if necessary. Create or append to `chrome/userChrome.css`, **preserving existing CSS**:

   ```css
   /* chromofoxEXT hide-tab-close-buttons BEGIN */
   #tabbrowser-tabs .tab-close-button {
       display: none !important;
   }
   /* chromofoxEXT hide-tab-close-buttons END */
   ```

3. In `about:config`, set `toolkit.legacyUserProfileCustomizations.stylesheets` to `true`.
4. Quit Firefox completely and reopen it.

## Windows PowerShell install/remove helper

From this directory:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\manage-tab-close-buttons.ps1 -Action Install
```

The helper asks for the **exact** Firefox profile path shown by `about:profiles`. Or pass `-ProfilePath 'C:\...\Firefox\Profiles\...'`. It requires `prefs.js` in that directory, adds only its marked CSS block, creates a timestamped backup before edits, and is safe to rerun. It does **not** automatically change preferences.

To remove just this feature:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\manage-tab-close-buttons.ps1 -Action Remove
```

After removal, restart Firefox. Keep `toolkit.legacyUserProfileCustomizations.stylesheets=true` if other custom browser CSS needs it.

## Acceptance

- [ ] X is absent on selected and background horizontal tabs.
- [ ] Tab selection, middle click, Ctrl+W, context menu, pin/unpin work.
- [ ] An existing `userChrome.css` still works after install/remove.
- [ ] Rerunning installation or removal changes nothing.
- [ ] Evaluate vertical tabs separately if used.

**Support boundary:** Mozilla regards userChrome.css as unsupported advanced customization, so selectors may change. No live Firefox UI testing has been performed.

References: [Mozilla advanced customization](https://support.mozilla.org/en-US/kb/firefox-advanced-customization-and-configuration) and [Mozilla tab X customization discussion](https://support.mozilla.org/en-US/questions/1288218).
