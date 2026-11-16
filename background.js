// HowTo Recipe Saver - background service worker (MV3, classic so importScripts works).
// Talks to the same backend as the web and native apps: the server-side import
// endpoint on Vercel (Gemini key stays server-side) and Supabase (anon key is
// public by design; row-level security does the protecting).
importScripts('supabase.js');

const SUPABASE_URL = 'https://kbnqajuwnhzwtnybqixn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Ehkh7YzpNA1rHdWrzmFgxw_94ih3t3L';
const API_BASE = 'https://howto-liart.vercel.app';

const storage = {
  getItem: (key) => chrome.storage.local.get(key).then((result) => result[key] ?? null),
  setItem: (key, value) => chrome.storage.local.set({ [key]: value }),
  removeItem: (key) => chrome.storage.local.remove(key),
};

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage,
    persistSession: true,
    // MV3 service workers sleep, so the library's timer-based refresh is
    // unreliable; refresh explicitly before each use instead.
    autoRefreshToken: false,
    detectSessionInUrl: false,
    flowType: 'implicit',
  },
});

const youtubeHosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'];

function youtubeId(url) {
  if (!youtubeHosts.includes(url.hostname)) return null;
  const [kind, id] = url.pathname.split('/').filter(Boolean);
  const candidate = url.hostname === 'youtu.be' ? kind
    : kind === 'watch' ? url.searchParams.get('v')
    : ['shorts', 'live', 'embed'].includes(kind) ? id : null;
  return candidate && /^[\w-]{11}$/.test(candidate) ? candidate : null;
}

async function getSession() {
  const { data: { session: current } } = await sb.auth.getSession();
  if (!current) return null;
  if (current.expires_at && current.expires_at * 1000 < Date.now() + 60000) {
    const { data, error } = await sb.auth.refreshSession();
    if (error) return null;
    return data.session;
  }
  return current;
}

async function signIn() {
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: chrome.identity.getRedirectURL(), skipBrowserRedirect: true },
  });
  if (error || !data?.url) throw new Error('Could not start Google sign-in. Try again.');
  const finalUrl = await chrome.identity.launchWebAuthFlow({ url: data.url, interactive: true });
  if (!finalUrl) throw new Error('Sign-in was cancelled.');
  const params = new URLSearchParams(new URL(finalUrl).hash.slice(1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) throw new Error('Google sign-in did not finish. Try again.');
  const { data: session, error: sessionError } = await sb.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (sessionError || !session.user) throw new Error('Could not finish signing in. Try again.');
  return session.user;
}

// The same import call the native app makes: the server holds the Gemini key
// and enforces its current free-tier quota. No paid fallback is used.
async function importRecipe(url, videoId, pageText) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 75000);
  let response;
  try {
    response = await fetch(`${API_BASE}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(pageText
        ? { mode: 'text', lang: 'original', text: pageText, sourceUrl: url }
        : videoId
        ? { mode: 'video', lang: 'original', videoId }
        : { mode: 'url', lang: 'original', url }),
    });
  } catch {
    throw new Error('Could not reach the importer. Check your connection and try again.');
  } finally {
    clearTimeout(timeout);
  }
  const data = await response.json().catch(() => null);
  if (response.status === 429) {
    throw new Error('The import limit has been reached. Try again later.');
  }
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Could not import this page. Try again.');
  }
  const recipe = data?.recipe;
  if (!recipe || typeof recipe.id !== 'string' || !Array.isArray(recipe.chapters) || !recipe.chapters.length) {
    throw new Error('No recipe steps were found on this page.');
  }
  return recipe;
}

// Same row shape as the apps: saved_recipes(user_id, recipe_id, recipe).
async function upsertRecipe(userId, recipe) {
  const { error } = await sb.from('saved_recipes').upsert(
    { user_id: userId, recipe_id: recipe.id, recipe },
    { onConflict: 'user_id,recipe_id', ignoreDuplicates: true },
  );
  if (error) throw new Error('Could not save to your cookbook. Try again.');
}

async function alreadySaved(userId, url, videoId) {
  const { data, error } = await sb.from('saved_recipes')
    .select('recipe').eq('user_id', userId);
  if (error) throw new Error('Could not check your recipes. Try again.');
  if (!data) return null;
  const recipes = data.map((row) => row.recipe).filter(Boolean);
  if (videoId) return recipes.find((recipe) => recipe.videoId === videoId) ?? null;
  return recipes.find((recipe) => recipe.source?.url === url) ?? null;
}

// Reads the open page's text in the user's own browser. Sites behind bot
// protection (Cloudflare walls) answer the server's fetch with a challenge,
// but the recipe is right here in the tab, so a text import still works.
async function extractPageText(tabId, expectedUrl) {
  if (!tabId) return '';
  try {
    const current = await chrome.tabs.get(tabId);
    if (current.url !== expectedUrl) return '';
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const root = document.querySelector('article, main, [itemtype*="Recipe"]') || document.body;
        return (document.title + '\n\n' + (root?.innerText || '')).replace(/\n{3,}/g, '\n\n').trim().slice(0, 15000);
      },
    });
    return typeof result?.result === 'string' ? result.result : '';
  } catch {
    return '';
  }
}

// Server-side page reading failures the tab fallback can recover from.
function isPageFetchError(message) {
  return /could not be opened|No recipe text could be read|blocks automatic recipe reading|No recipe steps were found/i.test(message || '');
}

function validPageUrl(value) {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url : null; } catch { return null; }
}

const savesInFlight = new Map();

async function stateForPage(url) {
  const session = await getSession();
  const email = session?.user?.email ?? null;
  const parsed = validPageUrl(url);
  if (!email || !parsed) return { email };
  const key = `${session.user.id}:${parsed.href}`;
  const pending = savesInFlight.get(key);
  if (pending) {
    try { const result = await pending; return { email, ...result }; }
    catch (cause) { return { email, error: cause.message }; }
  }
  try { return { email, saved: await alreadySaved(session.user.id, parsed.href, youtubeId(parsed)) }; }
  catch (cause) { return { email, error: cause.message }; }
}

async function saveOnce(url, tabId) {
  const parsed = validPageUrl(url);
  if (!parsed) throw new Error('Open a recipe page or a YouTube video to save.');
  const session = await getSession();
  if (!session?.user) return { error: 'auth' };
  const key = `${session.user.id}:${parsed.href}`;
  if (savesInFlight.has(key)) return savesInFlight.get(key);
  const pending = save(parsed.href, tabId).finally(() => savesInFlight.delete(key));
  savesInFlight.set(key, pending);
  return pending;
}

async function save(url, tabId) {
  const session = await getSession();
  if (!session?.user) return { error: 'auth' };
  const videoId = youtubeId(new URL(url));
  const existing = await alreadySaved(session.user.id, url, videoId);
  if (existing) return { saved: existing, duplicate: true };
  let recipe;
  try {
    recipe = await importRecipe(url, videoId);
  } catch (cause) {
    const pageText = !videoId && isPageFetchError(cause?.message) ? await extractPageText(tabId, url) : '';
    if (pageText.length < 500) throw cause;
    recipe = await importRecipe(url, null, pageText);
  }
  await upsertRecipe(session.user.id, recipe);
  return { saved: recipe };
}

// Replace the stored recipe (used by tag edits). Upsert without
// ignoreDuplicates so the row actually updates; fall back to delete+insert
// if the project's RLS has no update policy.
async function updateRecipe(userId, recipe) {
  const { error } = await sb.from('saved_recipes').upsert(
    { user_id: userId, recipe_id: recipe.id, recipe },
    { onConflict: 'user_id,recipe_id' },
  );
  if (!error) return;
  const { error: deleteError } = await sb.from('saved_recipes').delete()
    .eq('user_id', userId).eq('recipe_id', recipe.id);
  if (deleteError) throw new Error('Could not save the tags. Try again.');
  await upsertRecipe(userId, recipe);
}

async function setTags(recipeId, tags) {
  const session = await getSession();
  if (!session?.user) return { error: 'auth' };
  const { data, error } = await sb.from('saved_recipes')
    .select('recipe').eq('user_id', session.user.id).eq('recipe_id', recipeId).maybeSingle();
  if (error || !data?.recipe) throw new Error('Could not load the recipe. Try again.');
  await updateRecipe(session.user.id, { ...data.recipe, tags });
  return { tags };
}

// The save finishes in the background; the page toast is the confirmation.
async function showToast(tabId, recipe, duplicate) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'howto:toast', recipe, duplicate });
  } catch {
    // Some pages (chrome://, the Web Store) cannot be injected; the popup
    // status still reports the result when it is open.
  }
}

// Transfer only the selected recipe to the existing web reader's local cache.
// Extension OAuth and web OAuth are separate: opening must not depend on a
// second sign-in or put any authentication token in a URL.
async function openRecipe(recipeId) {
  const session = await getSession();
  if (!session?.user) return { error: 'auth' };
  if (typeof recipeId !== 'string' || !/^[\w-]{1,24}$/.test(recipeId)) {
    throw new Error('This recipe cannot be opened. Save it again.');
  }
  const { data, error } = await sb.from('saved_recipes').select('recipe')
    .eq('user_id', session.user.id).eq('recipe_id', recipeId).maybeSingle();
  if (error || data?.recipe?.id !== recipeId) throw new Error('Could not find this recipe. Try saving it again.');
  const tab = await chrome.tabs.create({ url: `${API_BASE}/import.html`, active: false });
  try {
    await new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); };
      const ready = () => { cleanup(); resolve(); };
      const listener = (id, info) => { if (id === tab.id && info.status === 'complete') ready(); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Could not open the recipe reader. Try again.')); }, 20000);
      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.get(tab.id).then((current) => { if (current.status === 'complete') ready(); }).catch((cause) => { cleanup(); reject(cause); });
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (recipe) => localStorage.setItem(`howto.recipe.${recipe.id}`, JSON.stringify(recipe)),
      args: [data.recipe],
    });
    await chrome.tabs.update(tab.id, { url: `${API_BASE}/?v=${encodeURIComponent(recipeId)}`, active: true });
    return { opened: true };
  } catch (cause) {
    await chrome.tabs.remove(tab.id).catch(() => {});
    throw cause;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const respond = (promise) => {
    promise.then(sendResponse).catch((cause) => {
      sendResponse({ error: cause instanceof Error ? cause.message : 'Something went wrong. Try again.' });
    });
    return true;
  };
  switch (message?.type) {
    case 'getState':
      return respond(stateForPage(message.url));
    case 'signIn':
      return respond(signIn().then((user) => ({ email: user.email ?? null })));
    case 'signOut':
      return respond(sb.auth.signOut({ scope: 'local' }).then(() => ({ email: null })));
    case 'save':
      return respond((async () => {
        const result = await saveOnce(message.url, message.tabId);
        if (!result.error && message.tabId) {
          await showToast(message.tabId, result.saved, !!result.duplicate);
        }
        return result;
      })());
    case 'openBook':
      return respond(chrome.tabs.create({ url: `${API_BASE}/import.html?view=book` }).then(() => ({ opened: true })));
    case 'openRecipe':
      return respond(openRecipe(message.recipeId));
    case 'setTags':
      return respond(setTags(message.recipeId, Array.isArray(message.tags) ? message.tags : []));
    default:
      return undefined;
  }
});
