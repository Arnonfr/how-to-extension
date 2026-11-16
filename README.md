# Cookit Recipe Saver

Chrome extension for the same personal recipe collection as the Cookit app.

## Version 0.4.1

- Current app recipe-reader design: forest-green canvas, green rounded recipe cards, warm cream text and gold accent and bundled Google Sans with Hebrew glyphs. Based on `src/theme.ts`, `src/AppText.tsx` and `app/index.tsx` in the app, rather than the home screen palette.
- A standing Open my recipe book button is available independently of sign-in/save state.
- One main action: **Save to my recipes** becomes **Open recipe** after a successful save. A duplicate or a saved recipe detected when reopening the popup also shows Open recipe.
- Google sign-in and a small sign-out control. Uses the existing Supabase account and session refresh.
- English and Hebrew interface based on Chrome's UI language; Hebrew layout is RTL and recipe titles use their own text direction. The two main action labels stay in English as requested.
- Preserves the v0.3 fallback that imports text from the open recipe tab when a site blocks server-side reading. It checks that the tab still has the requested URL before reading it.
- Saves stay in the background when the popup closes. Concurrent requests for the same page in the active worker share one save operation.
- The bottom confirmation banner uses the same green design; its existing tag editor is retained.
- Open recipe checks the selected recipe belongs to the signed-in account, copies that recipe alone to the web reader's existing local cache, then opens the reader. It does not put OAuth tokens in URLs, create a public share link, or depend on a second web sign-in.

## Install or update

1. Unzip `Cookit-extension-0.4.1.zip` into a permanent folder.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Choose **Load unpacked** and select the folder containing `manifest.json`.
4. If updating the same installed folder, replace its files and press the extension's **Reload** button instead. The fixed extension key is unchanged, so the extension ID and OAuth redirect stay the same: `pggeiekplhcfafblgjjpaebehelmoand`.
5. Open a recipe page, click the extension and sign in with the same Google account as the app.

No build step, Chrome Web Store publication or payment is required.

## Backend and privacy

Uses the existing import endpoint on `https://howto-liart.vercel.app` and the existing Supabase `saved_recipes` table. The Gemini key stays on the server. Existing free-tier quota limits apply, with no paid fallback. It reads page metadata only when the popup is opened; recipe extraction starts on Save.

Runtime permissions remain `identity`, `storage`, `activeTab`, `scripting`, and the two existing backend hosts. Fonts are embedded locally in the stylesheet and confirmation script; no external font requests or web-accessible font resources are required. No analytics or remote scripts are added.

Google Sans is subset to Latin and Hebrew and distributed under the SIL Open Font License in the header of `popup.css`.

## Checks

Run `node --test tests/background.test.mjs` for the nine dependency-free worker tests: signed-out protection, concurrent save deduplication, saved-recipe detection, library errors, invalid pages, recipe opening missing/invalid recipe IDs, the v0.3 tab-text fallback and tab-navigation protection.

The actual Manifest V3 popup was also loaded in Chromium and visually checked in English and Hebrew. Controlled account/API responses were used to test sign-in/sign-out UI, Save-to-Open, reopen, error retry and unsupported pages. Full live Google OAuth and a production recipe write were not performed during that test run.
