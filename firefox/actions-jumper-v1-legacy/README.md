# GitHub Actions Jumper for Firefox

Compact toolbar popup that autocompletes repository names for a chosen GitHub user/organisation and opens GitHub Actions with a saved query preset.

## Try it in Firefox (temporary unsigned install)
1. Extract `firefox-actions-jumper.zip`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and select the extracted `manifest.json`.
4. Click the Actions Jumper toolbar icon, type a repository name and press Enter.
5. Open the gear button to change owner and search presets.

Temporary add-ons are removed on browser restart. Persistent Firefox installation normally requires Mozilla signing via AMO (this is NOT a signed add-on). You can submit this package for signing.

## Defaults
Owner: `techrote`
- Running: `is:in_progress`
- Queued: `is:queued`
- Failed: `conclusion:failure`
- All runs: empty query

For custom filters use one line per preset: `Name | query`.
For example: `Running main | is:in_progress branch:main`.
The selected query is URL encoded into `/actions?query=...`.

## Privacy / limitations
- Uses anonymous GitHub REST API to autocomplete **public** repositories.
- No personal access token, no browsing-history or page-reading permission.
- Caches repository names for 10 minutes, falls back to stored suggestions when offline or rate-limited.
- Reads a maximum of 1000 repositories for one owner. Private repos may be typed manually.
- Queries navigate to GitHub, which applies its own Actions filters.
- The add-on requests access only to `api.github.com` plus local storage permission.
