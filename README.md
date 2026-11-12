# HowTo Recipe Saver — Chrome extension

Save a recipe from any page or YouTube video straight into your **HowTo** cookbook, the same
cookbook the web app (howto-liart.vercel.app) and the native app read. Sign in once with
Google; the recipe shows up in the app on your phone.

## How it works

1. The popup offers **Sign in with Google** (Supabase Auth, same accounts as the app).
2. On a recipe page or YouTube video, click **Save this recipe**.
3. The extension calls the existing server-side import endpoint (`POST /api/import` on the
   Vercel backend — the Gemini key stays server-side and the free-tier rate limit applies,
   one import per 10 minutes site-wide).
4. The recipe is upserted into `saved_recipes` in Supabase under your user, with the exact
   row shape the apps use (`user_id`, `recipe_id`, `recipe`). No changes to the apps.

Saving a page you already saved is free: the extension checks your cookbook first and
skips the import.

## Install (no Chrome Web Store)

1. Download and unzip this repo (Code → Download ZIP).
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. **Load unpacked** → pick the unzipped folder.
4. Pin “HowTo Recipe Saver” to the toolbar.

The manifest pins a fixed extension key, so the extension ID (and therefore the Google
sign-in redirect) stays stable across machines: `pggeiekplhcfafblgjjpaebehelmoand`.

## Design

The popup uses the same design tokens as the app (`src/theme.ts` in `Arnonfr/how-to-app`):
warm dark background `#14110F`, amber accent `#E8A33D`, serif headings. English only.

## Files

- `manifest.json` — MV3, fixed key, minimal permissions (`identity`, `storage`,
  `activeTab`, `scripting` + the two backend hosts).
- `background.js` — service worker: Google sign-in via `chrome.identity`, session refresh,
  import call, Supabase upsert. All Supabase work lives here; the popup only messages it.
- `popup.html` / `popup.js` — the small popup UI.
- `supabase.js` — vendored UMD build of `@supabase/supabase-js` v2 (no build step).

## Cost

Everything runs on the existing free tiers: Supabase free tier, the existing Vercel
backend, and the existing site-wide Gemini free-tier import cap. Publishing to the Chrome
Web Store (a $5 one-time developer fee) is **not** done and needs the owner's explicit
approval first.

## Related

- Native app repo: https://github.com/Arnonfr/how-to-app
- Web app + backend repo: https://github.com/Arnonfr/how-to
- Live web app: https://howto-liart.vercel.app
