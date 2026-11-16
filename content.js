// HowTo Recipe Saver - content script: the post-save toast and tag editor.
// Injected on demand by the background worker after a save completes.
// Light design tokens and bundled Google Sans match the current app home.
(() => {
  if (window.__howtoToastLoaded) return;
  window.__howtoToastLoaded = true;

  const fontStyle = document.createElement('style');
  fontStyle.textContent = `@font-face { font-family: 'Cookit Sans'; src: url('${chrome.runtime.getURL('fonts/GoogleSans-Regular.woff2')}') format('woff2'); font-weight: 400; }`;
  document.documentElement.appendChild(fontStyle);

  const COLORS = {
    bg: '#162D25',
    surface: '#29473A',
    raised: '#29473A',
    text: '#FFF8E9',
    dim: '#E6E2D2',
    accent: '#EAC883',
    outline: '#6D8074',
    danger: '#FFB4A8',
  };
  const WEB_RECIPE_URL = (id) => `https://howto-liart.vercel.app/?v=${encodeURIComponent(id)}`;

  const TAG_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;
  const CLOSE_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  let toast = null;
  let hideTimer = null;

  function baseStyles(el) {
    el.style.cssText = `
      position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
      width: 30%; min-width: 260px; max-width: 460px;
      background: ${COLORS.bg}; color: ${COLORS.text};
      border: 1px solid ${COLORS.outline}; border-radius: 19px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.12);
      font-family: 'Cookit Sans', sans-serif; font-size: 13px;
      z-index: 2147483647; direction: ltr; text-align: left;
    `;
  }

  function removeToast() {
    clearTimeout(hideTimer);
    toast?.remove();
    toast = null;
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(removeToast, 1500);
  }

  function showToast(recipe, duplicate) {
    removeToast();
    closeTagPanel();
    toast = document.createElement('div');
    baseStyles(toast);
    toast.style.cssText += `
      display: flex; align-items: center; gap: 10px;
      height: 38px; padding: 0 12px; cursor: pointer;
    `;

    const label = document.createElement('span');
    label.style.cssText = `flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: 'Cookit Sans', sans-serif;`;
    label.textContent = duplicate ? 'Already in your cookbook' : 'Saved to Cookit';

    const tagButton = document.createElement('button');
    tagButton.title = 'Manage tags';
    tagButton.setAttribute('aria-label', 'Manage tags');
    tagButton.innerHTML = TAG_ICON;
    tagButton.style.cssText = `
      display: flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 7px; flex: none;
      background: ${COLORS.raised}; color: ${COLORS.accent};
      border: 1px solid ${COLORS.outline}; cursor: pointer;
    `;
    tagButton.addEventListener('click', (event) => {
      event.stopPropagation();
      clearTimeout(hideTimer);
      openTagPanel(recipe);
    });

    toast.append(label, tagButton);
    // Clicking the banner body (not the tag button) opens the recipe.
    toast.addEventListener('click', () => window.open(WEB_RECIPE_URL(recipe.id), '_blank'));
    // The spec is a 1.5s flash; hovering keeps it around so the buttons are usable.
    toast.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    toast.addEventListener('mouseleave', scheduleHide);

    document.documentElement.appendChild(toast);
    scheduleHide();
  }

  let panel = null;

  function closeTagPanel() {
    panel?.remove();
    panel = null;
  }

  function chip(tag, onRemove) {
    const el = document.createElement('span');
    el.style.cssText = `
      display: inline-flex; align-items: center; gap: 5px;
      background: ${COLORS.raised}; border: 1px solid ${COLORS.outline};
      color: ${COLORS.text}; border-radius: 999px; padding: 3px 8px 3px 10px;
      font-size: 12px;
    `;
    const text = document.createElement('span');
    text.textContent = tag;
    const remove = document.createElement('button');
    remove.innerHTML = CLOSE_ICON;
    remove.title = `Remove tag ${tag}`;
    remove.style.cssText = `
      display: flex; background: none; border: none; color: ${COLORS.dim};
      cursor: pointer; padding: 0; align-items: center;
    `;
    remove.addEventListener('click', onRemove);
    el.append(text, remove);
    return el;
  }

  function openTagPanel(recipe) {
    closeTagPanel();
    let tags = Array.isArray(recipe.tags) ? [...recipe.tags] : [];

    panel = document.createElement('div');
    baseStyles(panel);
    panel.style.cssText += 'padding: 14px; bottom: 64px;';

    const title = document.createElement('div');
    title.style.cssText = `font-family: 'Cookit Sans', sans-serif; font-size: 15px; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
    title.textContent = 'Tags';

    const subtitle = document.createElement('div');
    subtitle.style.cssText = `color: ${COLORS.dim}; font-size: 12px; margin-bottom: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
    subtitle.textContent = recipe.title;
    subtitle.dir = 'auto';

    const chipRow = document.createElement('div');
    chipRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; min-height: 24px; align-items: center;';

    const status = document.createElement('div');
    status.style.cssText = `color: ${COLORS.dim}; font-size: 11px; min-height: 14px; margin-top: 8px;`;

    const renderChips = () => {
      chipRow.textContent = '';
      if (!tags.length) {
        const empty = document.createElement('span');
        empty.style.cssText = `color: ${COLORS.dim}; font-size: 12px;`;
        empty.textContent = 'No tags yet';
        chipRow.appendChild(empty);
        return;
      }
      tags.forEach((tag) => chipRow.appendChild(chip(tag, () => update(tags.filter((item) => item !== tag)))));
    };

    const update = async (next) => {
      const previous = tags;
      tags = next;
      renderChips();
      status.style.color = COLORS.dim;
      status.textContent = 'Saving...';
      const result = await chrome.runtime.sendMessage({ type: 'setTags', recipeId: recipe.id, tags });
      if (result?.error) {
        tags = previous;
        renderChips();
        status.style.color = COLORS.danger;
        status.textContent = result.error === 'auth' ? 'Sign in again from the extension popup.' : result.error;
      } else {
        recipe.tags = tags;
        status.style.color = COLORS.accent;
        status.textContent = 'Saved';
      }
    };

    const form = document.createElement('form');
    form.style.cssText = 'display: flex; gap: 8px;';
    const input = document.createElement('input');
    input.placeholder = 'Add a tag';
    input.maxLength = 40;
    input.style.cssText = `
      flex: 1; background: ${COLORS.surface}; color: ${COLORS.text};
      border: none; border-bottom: 1px solid ${COLORS.outline}; border-radius: 0;
      padding: 7px 0; font-size: 13px; outline: none;
    `;
    const add = document.createElement('button');
    add.type = 'submit';
    add.textContent = 'Add';
    add.style.cssText = `
      background: ${COLORS.accent}; color: #162D25; border: none;
      border-radius: 8px; padding: 7px 14px; font-size: 13px;
      font-weight: 600; cursor: pointer;
    `;
    form.append(input, add);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const tag = input.value.trim();
      if (!tag || tags.some((item) => item.toLowerCase() === tag.toLowerCase())) return;
      input.value = '';
      update([...tags, tag]);
    });

    const close = document.createElement('button');
    close.innerHTML = CLOSE_ICON;
    close.title = 'Close';
    close.style.cssText = `
      position: absolute; top: 10px; right: 10px; display: flex;
      background: none; border: none; color: ${COLORS.dim}; cursor: pointer;
    `;
    close.addEventListener('click', () => { closeTagPanel(); scheduleHide(); });

    panel.append(close, title, subtitle, chipRow, form, status);
    renderChips();
    document.documentElement.appendChild(panel);
    input.focus();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'howto:toast' && message.recipe?.id) showToast(message.recipe, !!message.duplicate);
  });
})();
