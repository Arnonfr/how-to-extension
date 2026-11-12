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
// and enforces the free-tier cap (one import per 10 minutes site-wide).
async function importRecipe(url, videoId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 75000);
  let response;
  try {
    response = await fetch(`${API_BASE}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(videoId
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
    throw new Error('The importer is resting (free tier: one import per 10 minutes). Try again soon.');
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
  if (error || !data) return null;
  const recipes = data.map((row) => row.recipe).filter(Boolean);
  if (videoId) return recipes.find((recipe) => recipe.videoId === videoId) ?? null;
  return recipes.find((recipe) => recipe.source?.url === url) ?? null;
}

async function save(url) {
  const session = await getSession();
  if (!session?.user) return { error: 'auth' };
  const videoId = youtubeId(new URL(url));
  const existing = await alreadySaved(session.user.id, url, videoId);
  if (existing) return { saved: existing, duplicate: true };
  const recipe = await importRecipe(url, videoId);
  await upsertRecipe(session.user.id, recipe);
  return { saved: recipe };
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
      return respond(getSession().then((session) => ({ email: session?.user?.email ?? null })));
    case 'signIn':
      return respond(signIn().then((user) => ({ email: user.email ?? null })));
    case 'signOut':
      return respond(sb.auth.signOut({ scope: 'local' }).then(() => ({ email: null })));
    case 'save':
      return respond(save(message.url));
    default:
      return undefined;
  }
});
