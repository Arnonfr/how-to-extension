const $ = (id) => document.getElementById(id);
const saveButton = $('save');
const authButton = $('auth');
const statusEl = $('status');
const hebrew = chrome.i18n.getUILanguage().startsWith('he');
const copy = hebrew ? {
  heading: 'כל המתכונים שלך, ביחד.', intro: 'שומרים מתכון ישירות לאוסף שלך.',
  loading: 'טוען את הדף הנוכחי...', checking: 'בודק את האוסף שלך...',
  signIn: 'התחברות עם Google', signOut: 'התנתקות', signInFirst: 'כדי לשמור, יש להתחבר עם אותו חשבון Google שבאפליקציה.',
  invalid: 'פתחו דף מתכון או סרטון YouTube כדי לשמור.', saving: 'שומר את המתכון. אפשר לסגור את החלונית.',
  saved: 'המתכון שמור באוסף שלך.', duplicate: 'המתכון כבר נמצא באוסף שלך.',
  error: 'הפעולה לא הושלמה. נסו שוב.',
} : {
  heading: 'Your recipes, together.', intro: 'Save a recipe straight to your collection.',
  loading: 'Loading current page...', checking: 'Checking your collection...',
  signIn: 'Sign in with Google', signOut: 'Sign out', signInFirst: 'Sign in with the same Google account you use in the app to save.',
  invalid: 'Open a recipe page or a YouTube video to save.', saving: 'Saving your recipe. You can close this popup.',
  saved: 'Saved to your recipes.', duplicate: 'Already in your recipes.', error: 'Something went wrong. Please try again.',
};
document.documentElement.lang = hebrew ? 'he' : 'en';
document.documentElement.dir = hebrew ? 'rtl' : 'ltr';
$('book').textContent = hebrew ? 'המתכונים שלי' : 'My recipes';
$('page-title').textContent = copy.loading;

const icons = {
  save: '<path d="M12 5v14M5 12h14"/>',
  open: '<path d="M7 17 17 7M7 7h10v10"/>',
  busy: '<path d="M20 12a8 8 0 1 1-5.5-7.6"/>',
};
let tab = null;
let email = null;
let recipe = null;
let busy = true;
const send = async (message) => {
  const result = await chrome.runtime.sendMessage(message);
  if (!result) throw new Error(copy.error);
  return result;
};
function setStatus(text = '', kind = '') {
  statusEl.textContent = text;
  statusEl.className = `status meta ${kind}`;
}
function render() {
  $('account').hidden = !email;
  $('account-email').textContent = email || '';
  $('account-email').title = email || '';
  authButton.textContent = email ? copy.signOut : copy.signIn;
  authButton.disabled = busy;
  saveButton.disabled = busy || !email || !tab;
  saveButton.dataset.busy = String(busy);
  saveButton.setAttribute('aria-busy', String(busy));
  // Keep the two action labels exactly as requested, in both interface languages.
  $('action-label').textContent = recipe ? 'Open recipe' : 'Save to my recipes';
  $('action-label').dir = 'ltr';
  $('action-icon').innerHTML = icons[busy ? 'busy' : recipe ? 'open' : 'save'];
  if (recipe?.title) $('page-title').textContent = recipe.title;
}
async function refresh() {
  busy = true;
  recipe = null;
  render();
  setStatus(copy.checking);
  try {
    const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = current && /^https?:\/\//.test(current.url || '') ? current : null;
    $('page-title').textContent = tab?.title || copy.invalid;
    $('page-source').textContent = tab ? new URL(tab.url).hostname.replace(/^www\./, '') : '';
    const state = await send({ type: 'getState', url: tab?.url });
    email = state.email ?? null;
    recipe = state.saved ?? null;
    if (state.error) setStatus(state.error, 'error');
    else setStatus(!email ? copy.signInFirst : !tab ? copy.invalid : recipe ? copy.saved : '');
  } catch (cause) { setStatus(cause.message || copy.error, 'error'); }
  finally { busy = false; render(); }
}
authButton.addEventListener('click', async () => {
  busy = true;
  render();
  setStatus('');
  try {
    const result = await send({ type: email ? 'signOut' : 'signIn' });
    if (result.error) throw new Error(result.error);
    email = result.email ?? null;
    recipe = null;
    await refresh();
  } catch (cause) { setStatus(cause.message || copy.error, 'error'); }
  finally { busy = false; render(); }
});
saveButton.addEventListener('click', async () => {
  if (busy || !email || !tab) return;
  busy = true;
  render();
  try {
    if (recipe) {
      const result = await send({ type: 'openRecipe', recipeId: recipe.id });
      if (result.error) {
        await refresh();
        throw new Error(result.error === 'auth' ? copy.signInFirst : result.error);
      }
      window.close();
      return;
    }
    setStatus(copy.saving);
    const result = await send({ type: 'save', url: tab.url, tabId: tab.id });
    if (result.error === 'auth') {
      email = null;
      recipe = null;
      setStatus(copy.signInFirst, 'error');
    } else if (result.error) throw new Error(result.error);
    else if (result.saved?.id) {
      recipe = result.saved;
      setStatus(result.duplicate ? copy.duplicate : copy.saved);
    } else throw new Error(copy.error);
  } catch (cause) { setStatus(cause.message || copy.error, 'error'); }
  finally { busy = false; render(); }
});
void refresh();

$('book').addEventListener('click', async () => {
  try { const result = await send({ type: 'openBook' }); if (result.error) throw new Error(result.error); window.close(); }
  catch (cause) { setStatus(cause.message || copy.error, 'error'); }
});
