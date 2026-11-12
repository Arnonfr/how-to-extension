const account = document.getElementById('account');
const saveButton = document.getElementById('save');
const authButton = document.getElementById('auth');
const status = document.getElementById('status');

const send = (message) => chrome.runtime.sendMessage(message);

function setStatus(text, kind = '') {
  status.textContent = text;
  status.className = `status ${kind}`;
}

function render(email) {
  const signedIn = !!email;
  account.hidden = !signedIn;
  account.textContent = signedIn ? email : '';
  saveButton.hidden = !signedIn;
  authButton.textContent = signedIn ? 'Sign out' : 'Sign in with Google';
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:\/\//.test(tab.url ?? '')) return null;
  return tab;
}

async function refresh() {
  const state = await send({ type: 'getState' });
  render(state?.email ?? null);
}

authButton.addEventListener('click', async () => {
  authButton.disabled = true;
  setStatus('');
  try {
    const signedIn = !account.hidden;
    const result = await send({ type: signedIn ? 'signOut' : 'signIn' });
    if (result?.error) setStatus(result.error, 'error');
    render(result?.email ?? null);
  } finally {
    authButton.disabled = false;
  }
});

saveButton.addEventListener('click', async () => {
  saveButton.disabled = true;
  setStatus('');
  try {
    const tab = await activeTab();
    if (!tab) {
      setStatus('This page cannot be saved. Open a recipe page or a YouTube video.', 'error');
      return;
    }
    setStatus('Saving in the background - a banner confirms on the page.');
    const result = await send({ type: 'save', url: tab.url, tabId: tab.id });
    if (result?.error === 'auth') {
      render(null);
      setStatus('Sign in with Google first.', 'error');
    } else if (result?.error) {
      setStatus(result.error, 'error');
    } else if (result?.duplicate) {
      setStatus(`Already in your cookbook: ${result.saved.title}`, 'done');
    } else if (result?.saved) {
      setStatus(`Saved: ${result.saved.title}`, 'done');
    }
  } finally {
    saveButton.disabled = false;
  }
});

void refresh();
