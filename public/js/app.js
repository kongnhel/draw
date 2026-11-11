const root = document.documentElement;
const assetVersion = document.querySelector('meta[name="asset-version"]')?.content || '';
const versionedAsset = (url) => (assetVersion ? `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(assetVersion)}` : url);
const toggleButton = document.querySelector('.theme-toggle');
const themeStorageKey = 'artspace-sketchbook-theme';

try {
  ['artspace-mood-v1', 'artspace-mood-volume-v1', 'artspace-mood-started-v1'].forEach((key) => localStorage.removeItem(key));
  root.removeAttribute('data-mood');
  root.classList.remove('mood-start-open');
} catch (error) {
}
const pageCleanups = [];

const isLowPerfDevice = () => {
  if (root.getAttribute('data-perf') === 'low') return true;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const memory = Number(navigator.deviceMemory) || 8;
  const cores = Number(navigator.hardwareConcurrency) || 8;
  return memory <= 2
    || (memory <= 4 && cores <= 4)
    || Boolean(connection && (connection.saveData || /(^|-)2g$/.test(connection.effectiveType || '')));
};

let imageEditorModulePromise = null;

const loadImageEditorModule = () => {
  if (window.ArtSpaceImageEditor) return Promise.resolve(window.ArtSpaceImageEditor);
  if (imageEditorModulePromise) return imageEditorModulePromise;

  imageEditorModulePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = versionedAsset('/js/image-editor.js');
    script.async = true;
    script.onload = () => {
      if (window.ArtSpaceImageEditor) resolve(window.ArtSpaceImageEditor);
      else reject(new Error('The image studio is unavailable.'));
    };
    script.onerror = () => reject(new Error('The image studio is unavailable.'));
    document.head.appendChild(script);
  }).catch((error) => {
    imageEditorModulePromise = null;
    throw error;
  });

  return imageEditorModulePromise;
};

const registerPageCleanup = (cleanup) => {
  if (typeof cleanup === 'function') pageCleanups.push(cleanup);
};

const runPageCleanups = () => {
  while (pageCleanups.length) {
    const cleanup = pageCleanups.pop();
    try {
      cleanup();
    } catch (error) {
    }
  }
};

const applyTheme = (theme) => {
  const safeTheme = theme === 'light' ? 'light' : 'dark';
  root.setAttribute('data-theme', safeTheme);
  localStorage.setItem(themeStorageKey, safeTheme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', safeTheme === 'light' ? '#f8f5ed' : '#171717');

  if (toggleButton) {
    toggleButton.setAttribute('aria-label', safeTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
    toggleButton.title = safeTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
  }
};

applyTheme(localStorage.getItem(themeStorageKey) || 'dark');

const setActionLabel = (button, text) => {
  const label = button?.querySelector('[data-action-label]');
  if (label) label.textContent = text;
  else if (button) button.textContent = text;
};

const updateLikeButton = (button, liked) => {
  if (!button) return;
  button.classList.toggle('active', liked);
  setActionLabel(button, liked ? 'Unlike' : 'Like');
  button.setAttribute('aria-pressed', String(Boolean(liked)));
  if (button.classList.contains('ad-tool') || button.classList.contains('ad-reaction')) {
    button.setAttribute('aria-label', liked ? 'Unlike this artwork' : 'Like this artwork');
  } else if (button.classList.contains('pf-art-action')) {
    button.setAttribute('aria-label', liked ? 'Unlike this artwork' : 'Like this artwork');
    button.title = liked ? 'Unlike' : 'Like';
  }

  if (liked && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    button.classList.remove('like-pop');
    void button.offsetWidth;
    button.classList.add('like-pop');
    button.addEventListener('animationend', () => button.classList.remove('like-pop'), { once: true });
  }
};

const updateSavedButton = (button, saved) => {
  if (!button) return;
  button.classList.toggle('active', saved);
  setActionLabel(button, saved ? 'Saved' : 'Save');
  button.setAttribute('aria-pressed', String(saved));
  if (button.classList.contains('ad-tool') || button.classList.contains('ad-reaction')) {
    button.setAttribute('aria-label', saved ? 'Remove from saved artwork' : 'Save this artwork');
  } else if (button.classList.contains('pf-art-action')) {
    button.setAttribute('aria-label', saved ? 'Remove from saved artwork' : 'Save this artwork');
    button.title = saved ? 'Remove from saved artwork' : 'Save this artwork';
  }
};

const updateLikeCounter = (card, likesCount) => {
  const counters = new Set();
  if (card) {
    card.querySelectorAll('[data-portfolio-likes], [data-nb-like-count], .metric-inline span:first-child').forEach((counter) => counters.add(counter));
  }
  document.querySelectorAll('[data-detail-likes-count], [data-viewer-like-count]').forEach((counter) => counters.add(counter));
  if (!counters.size) return;

  counters.forEach((likeCounter) => {
    const value = Number.parseInt(likeCounter.textContent.replace(/[^\d]/g, ''), 10) || 0;
    const nextCount = Math.max(0, likesCount ?? value);
    const isPlainCounter = likeCounter.hasAttribute('data-portfolio-likes')
      || likeCounter.hasAttribute('data-nb-like-count')
      || likeCounter.hasAttribute('data-viewer-like-count')
      || likeCounter.hasAttribute('data-detail-likes-count');
    likeCounter.textContent = isPlainCounter ? String(nextCount) : `❤ ${nextCount}`;
  });
  if (card?.hasAttribute('data-portfolio-card') && Number.isFinite(Number(likesCount))) {
    card.dataset.likes = String(Math.max(0, Number(likesCount)));
  }
};

const burstLikeHearts = (button) => {
  if (!button || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const heart = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.2-4.6-9.4-9.4A5.4 5.4 0 0 1 12 6.6a5.4 5.4 0 0 1 9.4 4A13.6 13.6 0 0 1 12 20Z"/></svg>';
  for (let index = 0; index < 6; index += 1) {
    const span = document.createElement('span');
    span.className = 'ad-heart-burst';
    span.innerHTML = heart;
    span.style.setProperty('--drift', `${(Math.random() * 46 - 23).toFixed(1)}px`);
    span.style.setProperty('--rise', `${(46 + Math.random() * 34).toFixed(1)}px`);
    span.style.setProperty('--spin', `${(Math.random() * 40 - 20).toFixed(1)}deg`);
    span.style.animationDelay = `${index * 35}ms`;
    button.appendChild(span);
    window.setTimeout(() => span.remove(), 1200 + index * 40);
  }
};

const bindQuickActions = () => {
  document.querySelectorAll('form[action$="/like"]').forEach((form) => {
    if (form.dataset.quickBound === 'true') return;
    form.dataset.quickBound = 'true';
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (form.dataset.busy === 'true') return;
      form.dataset.busy = 'true';
      const button = form.querySelector('button');
      const card = form.closest('.art-card, [data-portfolio-card], [data-nb-artwork]');

      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          body: new URLSearchParams(new FormData(form))
        });

        if (!response.ok) {
          throw new Error('Like request failed');
        }

        const data = await response.json();
        updateLikeButton(button, data.liked);
        updateLikeCounter(card, data.likes_count);
        if (data.liked) burstLikeHearts(button);
        const artworkId = form.action.match(/\/art\/(\d+)\/like$/)?.[1];
        if (artworkId) document.dispatchEvent(new CustomEvent('artwork:like-changed', { detail: { id: artworkId, liked: data.liked, likes: data.likes_count } }));
      } catch (error) {
        form.submit();
      } finally {
        form.dataset.busy = 'false';
      }
    });
  });

  document.querySelectorAll('form[action$="/bookmark"]').forEach((form) => {
    if (form.dataset.quickBound === 'true') return;
    form.dataset.quickBound = 'true';
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (form.dataset.busy === 'true') return;
      form.dataset.busy = 'true';
      const button = form.querySelector('button');

      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          body: new URLSearchParams(new FormData(form))
        });

        if (!response.ok) {
          throw new Error('Bookmark request failed');
        }

        const data = await response.json();
        updateSavedButton(button, data.bookmarked);
        if (button && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          button.classList.remove('save-pop');
          void button.offsetWidth;
          button.classList.add('save-pop');
          button.addEventListener('animationend', () => button.classList.remove('save-pop'), { once: true });
        }
        showPinToast(data.bookmarked ? 'Saved to your collection.' : 'Removed from saved artwork.', 'success');
        const artworkId = form.action.match(/\/art\/(\d+)\/bookmark$/)?.[1];
        if (artworkId) document.dispatchEvent(new CustomEvent('artwork:bookmark-changed', { detail: { id: artworkId, saved: data.bookmarked } }));
      } catch (error) {
        form.submit();
      } finally {
        form.dataset.busy = 'false';
      }
    });
  });
};

const bindPortfolioCollection = () => {
  const collection = document.querySelector('[data-portfolio]');
  const gallery = collection?.querySelector('[data-portfolio-gallery]');
  if (!collection || !gallery) return;

  const cards = Array.from(gallery.querySelectorAll('[data-portfolio-card]'));
  if (!cards.length) return;

  const searchInput = collection.querySelector('[data-portfolio-search]');
  const searchClear = collection.querySelector('[data-portfolio-search-clear]');
  const sortButtons = Array.from(collection.querySelectorAll('[data-portfolio-sort]'));
  const categoryButtons = Array.from(collection.querySelectorAll('[data-portfolio-category]'));
  const resetButtons = Array.from(collection.querySelectorAll('[data-portfolio-reset]'));
  const statusLabel = collection.querySelector('[data-portfolio-status]');
  const noResults = collection.querySelector('[data-portfolio-no-results]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const originalOrder = cards.slice();
  let activeSort = 'all';
  let activeCategory = 'all';
  let filterTimer = null;

  const normalize = (value) => String(value || '').trim().toLowerCase();

  const setPressed = (buttons, current) => {
    buttons.forEach((button) => {
      const isActive = button === current;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  };

  const applyFilters = (animate = true) => {
    const term = normalize(searchInput?.value);
    const visibleCards = cards.filter((card) => {
      const matchesCategory = activeCategory === 'all'
        || normalize(card.dataset.category) === activeCategory;
      const searchText = normalize(`${card.dataset.title} ${card.dataset.tags} ${card.dataset.category} ${card.dataset.artist}`);
      return matchesCategory && (!term || searchText.includes(term));
    });

    if (activeSort === 'popular') {
      visibleCards.sort((a, b) => Number(b.dataset.likes || 0) - Number(a.dataset.likes || 0));
    } else if (activeSort === 'recent') {
      visibleCards.sort((a, b) => Number(b.dataset.created || 0) - Number(a.dataset.created || 0));
    } else {
      visibleCards.sort((a, b) => originalOrder.indexOf(a) - originalOrder.indexOf(b));
    }

    cards.forEach((card) => {
      card.hidden = !visibleCards.includes(card);
    });
    visibleCards.forEach((card) => gallery.appendChild(card));

    if (statusLabel) {
      statusLabel.innerHTML = visibleCards.length === 1
        ? 'Showing <strong>1</strong> piece'
        : `Showing <strong>${visibleCards.length}</strong> of <strong>${cards.length}</strong> pieces`;
    }

    if (noResults) noResults.hidden = visibleCards.length !== 0;

    const hasActiveFilters = Boolean(term) || activeCategory !== 'all';
    resetButtons.forEach((button) => {
      button.hidden = !hasActiveFilters;
    });

    if (searchClear) searchClear.hidden = !(searchInput && searchInput.value);

    if (!animate || reducedMotion.matches) return;

    gallery.classList.remove('is-filtering');
    void gallery.offsetWidth;
    gallery.classList.add('is-filtering');
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(() => gallery.classList.remove('is-filtering'), 340);
  };

  const resetFilters = () => {
    activeSort = 'all';
    activeCategory = 'all';
    if (searchInput) searchInput.value = '';
    setPressed(sortButtons, sortButtons.find((button) => button.dataset.portfolioSort === 'all'));
    setPressed(categoryButtons, categoryButtons.find((button) => button.dataset.portfolioCategory === 'all'));
    applyFilters();
  };

  sortButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activeSort = button.dataset.portfolioSort || 'all';
      setPressed(sortButtons, button);
      applyFilters();
    });
  });

  categoryButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const nextCategory = normalize(button.dataset.portfolioCategory || 'all');
      activeCategory = activeCategory === nextCategory && nextCategory !== 'all' ? 'all' : nextCategory;
      setPressed(
        categoryButtons,
        categoryButtons.find((item) => normalize(item.dataset.portfolioCategory) === activeCategory)
      );
      applyFilters();
    });
  });

  searchInput?.addEventListener('input', () => applyFilters());

  searchInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !searchInput.value) return;
    searchInput.value = '';
    applyFilters();
    searchInput.focus();
  });

  searchClear?.addEventListener('click', () => {
    if (!searchInput) return;
    searchInput.value = '';
    applyFilters();
    searchInput.focus();
  });

  resetButtons.forEach((button) => button.addEventListener('click', resetFilters));

  applyFilters(false);
};

const autoResizeTextarea = (textarea, maxHeight = 170) => {
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
};

const bindArtworkEditPreview = () => {
  const form = document.querySelector('[data-artwork-edit-form]');
  if (!form) return;

  const titleInput = form.querySelector('[data-ae-title]');
  const descriptionInput = form.querySelector('[data-ae-description]');
  const categoryInput = form.querySelector('[data-ae-category]');
  const previewTitle = document.querySelector('[data-ae-preview-title]');
  const previewCategory = document.querySelector('[data-ae-preview-category]');
  const titleCount = document.querySelector('[data-ae-title-count]');
  const descriptionCount = document.querySelector('[data-ae-description-count]');

  const update = () => {
    if (previewTitle && titleInput) {
      previewTitle.textContent = titleInput.value.trim() || 'Untitled artwork';
    }
    if (previewCategory && categoryInput) {
      previewCategory.textContent = categoryInput.selectedOptions[0]?.textContent.trim() || 'Artwork';
    }
    if (titleCount && titleInput) {
      titleCount.textContent = `${titleInput.value.length}/120`;
    }
    if (descriptionCount && descriptionInput) {
      descriptionCount.textContent = `${descriptionInput.value.length}/1200`;
    }
    autoResizeTextarea(descriptionInput);
  };

  form.addEventListener('input', update);
  form.addEventListener('change', update);
  update();
};

const bindArtworkEditForm = () => {
  const page = document.querySelector('.ae-page--compact');
  const form = page?.querySelector('[data-artwork-edit-form]');
  if (!page || !form) return;

  const saveButton = form.querySelector('[data-ae-save]');
  const saveLabel = form.querySelector('[data-ae-save-label]');
  const status = form.querySelector('[data-ae-save-status]');
  const initialLabel = saveLabel?.textContent || 'Save changes';
  const unsavedMessage = page.dataset.aeUnsavedMessage || 'You have unsaved changes. Leave without saving?';
  const savingLabel = page.dataset.aeSavingLabel || 'Saving…';
  const successLabel = page.dataset.aeSuccessLabel || 'Saved. Returning to artwork…';
  const savedLabel = page.dataset.aeSavedLabel || 'Saved';
  const errorLabel = page.dataset.aeErrorLabel || 'We could not save your changes. Please try again.';

  const imagesGrid = page.querySelector('[data-ae-images-grid]');
  const imagesInput = page.querySelector('[data-ae-images-input]');
  const imagesAddTrigger = page.querySelector('[data-ae-images-add-trigger]');
  const imagesCount = page.querySelector('[data-ae-images-count]');
  const imagesError = page.querySelector('[data-ae-images-error]');
  const maxFileSize = 8 * 1024 * 1024;
  const maxPages = 6;
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const allowedExtension = /\.(jpe?g|png|webp)$/i;
  let pages = [];
  let coverKey = '';
  let pageUid = 0;
  let imagesDirty = false;
  let dragPageKey = null;

  const initialImagesNode = page.querySelector('[data-ae-initial-images]');
  if (initialImagesNode) {
    try {
      const initial = JSON.parse(initialImagesNode.textContent || '[]');
      if (Array.isArray(initial)) {
        pages = initial
          .filter((image) => image && image.image_url)
          .map((image) => ({
            kind: 'existing',
            id: Number(image.id) || 0,
            imageUrl: image.image_url,
            thumbUrl: image.thumbnail_url || image.image_url
          }));
      }
    } catch (error) {
      pages = [];
    }
  }
  coverKey = pages.length ? `existing:${pages[0].id}` : '';

  const serialize = () => JSON.stringify([...new FormData(form).entries()].map(([key, value]) => (
    value instanceof File ? `file:${value.name}:${value.size}` : [key, value]
  )));
  const initial = serialize();
  let dirty = false;
  let isSubmitting = false;

  const setStatus = (message, type = '') => {
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('is-error', type === 'error');
    status.classList.toggle('is-success', type === 'success');
  };

  const showImagesError = (message) => {
    if (!imagesError) return;
    imagesError.textContent = message;
    imagesError.hidden = !message;
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const syncDirty = () => {
    dirty = serialize() !== initial || imagesDirty;
  };

  const markImagesDirty = () => {
    imagesDirty = true;
    syncDirty();
  };

  const updateImagesCount = () => {
    if (!imagesCount) return;
    const count = pages.length;
    imagesCount.textContent = `${count} ${count === 1 ? 'page' : 'pages'} of 6`;
  };

  const updateCoverPreview = () => {
    const previewImage = page.querySelector('.ae-preview-frame img');
    if (!previewImage) return;
    const cover = pages.find((entry) => coverKey === (entry.kind === 'existing' ? `existing:${entry.id}` : `new:${entry.uid}`));
    if (cover && previewImage.src !== cover.thumbUrl) {
      previewImage.src = cover.thumbUrl;
    }
  };

  const renderPages = () => {
    updateImagesCount();
    updateCoverPreview();
    if (!imagesGrid) return;

    if (pages.length === 0) {
      imagesGrid.replaceChildren();
      return;
    }

    const tiles = pages.map((entry, index) => {
      const tile = document.createElement('div');
      tile.className = 'studio-media-tile';
      tile.draggable = true;
      tile.dataset.pageKey = entry.kind === 'existing' ? `existing:${entry.id}` : `new:${entry.uid}`;
      if (tile.dataset.pageKey === coverKey) tile.classList.add('is-cover');

      const thumb = document.createElement('div');
      thumb.className = 'studio-media-thumb';

      const image = document.createElement('img');
      image.src = entry.kind === 'existing' ? entry.thumbUrl : entry.previewUrl;
      image.alt = `Artwork page ${index + 1}`;
      image.decoding = 'async';
      image.draggable = false;

      const order = document.createElement('span');
      order.className = 'studio-media-order';
      order.textContent = String(index + 1);

      const coverBadge = document.createElement('span');
      coverBadge.className = 'studio-media-cover-badge';
      coverBadge.textContent = 'Cover';

      thumb.append(image, order, coverBadge);

      const meta = document.createElement('div');
      meta.className = 'studio-media-meta';

      const name = document.createElement('strong');
      name.textContent = entry.kind === 'existing' ? `Saved page · № ${entry.id}` : entry.file.name;

      const size = document.createElement('em');
      size.textContent = entry.kind === 'existing' ? 'Already in your artwork' : formatFileSize(entry.file.size);

      meta.append(name, size);

      const actions = document.createElement('div');
      actions.className = 'studio-media-actions';

      const iconButtons = [
        { action: 'cover', title: tile.dataset.pageKey === coverKey ? 'This is the cover page' : 'Set as cover page', icon: 'M12 2l2.9 6.3 6.9.6-5.2 4.6 1.5 6.8L12 16.9 5.9 20.3l1.5-6.8L2.2 8.9l6.9-.6Z', disabled: tile.dataset.pageKey === coverKey },
        { action: 'up', title: 'Move up', icon: 'm6 14 6-6 6 6', disabled: index === 0 },
        { action: 'down', title: 'Move down', icon: 'm6 10 6 6 6-6', disabled: index === pages.length - 1 },
        { action: 'remove', title: entry.kind === 'existing' ? 'Remove this saved page' : 'Remove this new page', icon: 'M5 7h14M9 7V5c0-1 .6-1.5 1.5-1.5h3C14.4 3.5 15 4 15 5v2M7 7l1 13h8l1-13M10 10v7M14 10v7', danger: true }
      ];

      if (entry.kind === 'new') {
        iconButtons.splice(1, 0, { action: 'edit', title: 'Edit this page', icon: 'M4 20l1.2-4.2L14.5 6.5a2.12 2.12 0 0 1 3 3L8.2 18.8 4 20Z' });
      }

      iconButtons.forEach((config) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `studio-media-btn${config.danger ? ' is-danger' : ''}`;
        button.dataset.pageAction = config.action;
        button.title = config.title;
        button.setAttribute('aria-label', config.title);
        if (config.disabled) button.disabled = true;
        button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${config.icon}" /></svg>`;
        actions.append(button);
      });

      tile.append(thumb, meta, actions);
      return tile;
    });

    imagesGrid.replaceChildren(...tiles);
  };

  const revokePagePreview = (entry) => {
    if (entry.previewUrl) {
      URL.revokeObjectURL(entry.previewUrl);
      entry.previewUrl = '';
    }
  };

  const findPageIndex = (key) => pages.findIndex((entry) => (
    entry.kind === 'existing' ? `existing:${entry.id}` : `new:${entry.uid}`
  ) === key);

  const setCoverPage = (key) => {
    if (findPageIndex(key) === -1) return;
    coverKey = key;
    markImagesDirty();
    showImagesError('');
    renderPages();
  };

  const removePage = (key) => {
    const index = findPageIndex(key);
    if (index === -1) return;
    revokePagePreview(pages[index]);
    pages.splice(index, 1);
    if (coverKey === key) {
      coverKey = pages.length
        ? (pages[0].kind === 'existing' ? `existing:${pages[0].id}` : `new:${pages[0].uid}`)
        : '';
    }
    markImagesDirty();
    showImagesError('');
    renderPages();
  };

  const movePage = (key, direction) => {
    const index = findPageIndex(key);
    if (index === -1) return;
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    const [moved] = pages.splice(index, 1);
    pages.splice(target, 0, moved);
    markImagesDirty();
    renderPages();
  };

  const openPageEditor = async (file) => {
    try {
      const editor = await loadImageEditorModule();
      return await editor.open({ file, mode: 'artwork', maxBytes: maxFileSize });
    } catch (error) {
      showImagesError(error.userMessage || 'The artwork studio could not open on this device. Your original image will be used.');
      return file;
    }
  };

  const editNewPage = async (key) => {
    const index = findPageIndex(key);
    if (index === -1 || pages[index].kind !== 'new') return;
    const entry = pages[index];
    const edited = await openPageEditor(entry.sourceFile || entry.file);
    if (!edited || findPageIndex(key) !== index) return;
    revokePagePreview(entry);
    entry.file = edited;
    entry.previewUrl = URL.createObjectURL(edited);
    markImagesDirty();
    renderPages();
  };

  const addPages = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    let rejected = '';

    for (const file of incoming) {
      if (pages.length >= maxPages) {
        rejected = 'You can add up to 6 images per artwork.';
        break;
      }

      const validType = allowedTypes.has(file.type) || allowedExtension.test(file.name);
      if (!validType) {
        rejected = rejected || 'That file is not a JPG, PNG, or WEBP image. Choose one of those formats.';
        continue;
      }
      if (file.size > maxFileSize) {
        rejected = rejected || 'That image is larger than 8 MB. Please choose a smaller file.';
        continue;
      }
      if (file.size === 0) {
        rejected = rejected || 'That image appears to be empty. Please choose another file.';
        continue;
      }

      const duplicate = pages.some((entry) => (
        entry.kind === 'new' && entry.sourceFile.name === file.name && entry.sourceFile.size === file.size
      ));
      if (duplicate) {
        rejected = rejected || 'That image is already in your artwork.';
        continue;
      }

      pages.push({
        kind: 'new',
        uid: ++pageUid,
        file,
        sourceFile: file,
        previewUrl: URL.createObjectURL(file)
      });
    }

    if (rejected) showImagesError(rejected);
    if (pages.length && !coverKey) {
      coverKey = pages[0].kind === 'existing' ? `existing:${pages[0].id}` : `new:${pages[0].uid}`;
    }
    imagesInput.value = '';
    markImagesDirty();
    renderPages();
  };

  if (imagesInput) {
    imagesInput.addEventListener('change', () => addPages(imagesInput.files));
  }

  imagesAddTrigger?.addEventListener('click', (event) => {
    event.stopPropagation();
    imagesInput?.click();
  });

  if (imagesGrid) {
    imagesGrid.addEventListener('click', async (event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-page-action]') : null;
      if (!button) return;
      const tile = button.closest('[data-page-key]');
      if (!tile) return;

      const key = tile.dataset.pageKey;
      const action = button.dataset.pageAction;

      if (action === 'cover') setCoverPage(key);
      else if (action === 'up') movePage(key, -1);
      else if (action === 'down') movePage(key, 1);
      else if (action === 'remove') removePage(key);
      else if (action === 'edit') await editNewPage(key);
    });

    imagesGrid.addEventListener('dragstart', (event) => {
      const tile = event.target instanceof Element ? event.target.closest('[data-page-key]') : null;
      if (!tile) return;
      dragPageKey = tile.dataset.pageKey;
      tile.classList.add('is-dragging');
      try {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', dragPageKey);
      } catch (error) {
        /* older browsers */
      }
    });

    imagesGrid.addEventListener('dragover', (event) => {
      if (dragPageKey === null) return;
      event.preventDefault();
      try {
        event.dataTransfer.dropEffect = 'move';
      } catch (error) {
        /* older browsers */
      }
      const tile = event.target instanceof Element ? event.target.closest('[data-page-key]') : null;
      imagesGrid.querySelectorAll('.is-drop-target').forEach((node) => node.classList.remove('is-drop-target'));
      if (tile && tile.dataset.pageKey !== dragPageKey) tile.classList.add('is-drop-target');
    });

    imagesGrid.addEventListener('drop', (event) => {
      if (dragPageKey === null) return;
      event.preventDefault();
      event.stopPropagation();
      const tile = event.target instanceof Element ? event.target.closest('[data-page-key]') : null;
      const fromIndex = findPageIndex(dragPageKey);
      const targetIndex = tile ? findPageIndex(tile.dataset.pageKey) : -1;
      dragPageKey = null;
      if (fromIndex === -1 || targetIndex === -1) {
        renderPages();
        return;
      }
      const [moved] = pages.splice(fromIndex, 1);
      let insertIndex = targetIndex;
      if (fromIndex < targetIndex) insertIndex -= 1;
      pages.splice(insertIndex, 0, moved);
      markImagesDirty();
      renderPages();
    });

    imagesGrid.addEventListener('dragend', () => {
      dragPageKey = null;
      imagesGrid.querySelectorAll('.is-dragging, .is-drop-target').forEach((node) => node.classList.remove('is-dragging', 'is-drop-target'));
    });
  }

  renderPages();

  const handleInput = () => syncDirty();

  const beforeUnload = (event) => {
    if (!dirty || isSubmitting) return;
    event.preventDefault();
    event.returnValue = '';
  };

  const confirmLeave = (event) => {
    if (!dirty || isSubmitting) return;
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link) return;
    if (link.target === '_blank' || link.hasAttribute('download')) return;
    const href = link.getAttribute('href') || '';
    if (!href || href.startsWith('#')) return;
    if (!window.confirm(unsavedMessage)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  };

  const submit = async (event) => {
    if (isSubmitting) {
      event.preventDefault();
      return;
    }

    if (!form.checkValidity()) {
      return;
    }

    if (pages.length === 0) {
      event.preventDefault();
      setStatus('An artwork needs at least one image. Keep a page or add new ones.', 'error');
      return;
    }

    event.preventDefault();
    isSubmitting = true;
    dirty = false;
    imagesDirty = false;
    form.setAttribute('aria-busy', 'true');
    if (saveButton) saveButton.disabled = true;
    if (saveButton) saveButton.classList.add('is-loading');
    if (saveLabel) saveLabel.textContent = savingLabel;
    setStatus(savingLabel);

    try {
      const formData = new FormData(form);
      formData.delete('images');

      const newFiles = [];
      const tokens = pages.map((entry) => {
        if (entry.kind === 'existing') return String(entry.id);
        newFiles.push(entry.file);
        return `new:${newFiles.length - 1}`;
      });
      newFiles.forEach((file) => formData.append('images', file, file.name));
      formData.set('image_order', JSON.stringify(tokens));
      formData.set('cover_image_id', coverKey.startsWith('new:') ? coverKey : coverKey.replace(/^existing:/, ''));

      const response = await fetch(form.action, {
        method: 'POST',
        body: formData,
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json'
        }
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        payload = null;
      }

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || errorLabel);
      }

      setStatus(successLabel, 'success');
      if (saveLabel) saveLabel.textContent = savedLabel;
      window.setTimeout(() => {
        window.location.assign(payload.artworkUrl || `/art/${form.dataset.artworkId || ''}`);
      }, 700);
    } catch (error) {
      isSubmitting = false;
      syncDirty();
      form.removeAttribute('aria-busy');
      if (saveButton) saveButton.disabled = false;
      if (saveButton) saveButton.classList.remove('is-loading');
      if (saveLabel) saveLabel.textContent = initialLabel;
      setStatus(error.message || errorLabel, 'error');
    }
  };

  const handleDeleteStart = () => { isSubmitting = true; };
  const handleDeleteFailed = () => { isSubmitting = false; syncDirty(); };

  form.addEventListener('input', handleInput);
  form.addEventListener('change', handleInput);
  form.addEventListener('submit', submit);
  document.addEventListener('click', confirmLeave, true);
  document.addEventListener('artwork-delete:start', handleDeleteStart);
  document.addEventListener('artwork-delete:failed', handleDeleteFailed);
  window.addEventListener('beforeunload', beforeUnload);
  registerPageCleanup(() => {
    document.removeEventListener('click', confirmLeave, true);
    document.removeEventListener('artwork-delete:start', handleDeleteStart);
    document.removeEventListener('artwork-delete:failed', handleDeleteFailed);
    window.removeEventListener('beforeunload', beforeUnload);
    pages.forEach(revokePagePreview);
  });
};

const bindArtworkDeleteDialog = () => {
  const modal = document.querySelector('[data-delete-modal]');
  if (!modal) return;

  const openButton = document.querySelector('[data-delete-open]');
  const card = modal.querySelector('[data-delete-card]');
  const form = modal.querySelector('[data-delete-form]');
  const submitButton = modal.querySelector('[data-delete-submit]');
  const status = modal.querySelector('[data-delete-status]');
  const cancelButtons = Array.from(modal.querySelectorAll('[data-delete-cancel]'));
  const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let lastTrigger = null;
  let isDeleting = false;

  const setStatus = (message, type = '') => {
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('is-error', type === 'error');
    status.classList.toggle('is-success', type === 'success');
  };

  const getFocusable = () => Array
    .from(modal.querySelectorAll(focusableSelector))
    .filter((element) => element.tabIndex >= 0 && !element.disabled);

  const resetButtons = () => {
    card?.setAttribute('aria-busy', 'false');
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = 'Delete artwork';
    }
    cancelButtons.forEach((button) => {
      button.disabled = false;
    });
  };

  const open = () => {
    lastTrigger = document.activeElement;
    isDeleting = false;
    setStatus('');
    resetButtons();
    modal.hidden = false;
    document.body.classList.add('ae-modal-open');
    modal.querySelector('.ae-modal-cancel')?.focus();
  };

  const close = () => {
    if (isDeleting) return;
    modal.hidden = true;
    document.body.classList.remove('ae-modal-open');
    setStatus('');
    if (lastTrigger && typeof lastTrigger.focus === 'function') lastTrigger.focus();
  };

  openButton?.addEventListener('click', open);
  cancelButtons.forEach((button) => button.addEventListener('click', close));

  const handleDeleteKeydown = (event) => {
    if (modal.hidden) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = getFocusable();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', handleDeleteKeydown);
  registerPageCleanup(() => document.removeEventListener('keydown', handleDeleteKeydown));

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isDeleting) return;

    isDeleting = true;
    card?.setAttribute('aria-busy', 'true');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Deleting…';
    }
    cancelButtons.forEach((button) => {
      button.disabled = true;
    });
    setStatus('Deleting this page…');
    document.dispatchEvent(new CustomEvent('artwork-delete:start'));

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json'
        }
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        payload = null;
      }

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'We could not delete this artwork. Please try again.');
      }

      setStatus('Artwork deleted. Returning to your collection…', 'success');
      const redirectUrl = payload.redirectUrl || form.dataset.deleteRedirect || '/';
      window.setTimeout(() => window.location.assign(redirectUrl), 650);
    } catch (error) {
      isDeleting = false;
      document.dispatchEvent(new CustomEvent('artwork-delete:failed'));
      resetButtons();
      setStatus(error.message || 'We could not delete this artwork. Please try again.', 'error');
    }
  });
};

const bindProfileFlash = () => {
  const flash = document.querySelector('[data-profile-flash]');
  if (!flash) return;

  flash.querySelector('[data-profile-flash-close]')?.addEventListener('click', () => {
    flash.hidden = true;
    const url = new URL(window.location.href);
    url.searchParams.delete('deleted');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  });
};

const bindCommentForms = () => {
  document.querySelectorAll('.comment-form').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const textarea = form.querySelector('textarea[name="body"]');
      const button = form.querySelector('button[type="submit"]');
      const message = (textarea?.value || '').trim();

      if (!textarea || !message) {
        if (textarea) textarea.focus();
        return;
      }

      const previousText = button ? button.textContent : 'Post comment';
      if (button) {
        button.disabled = true;
        button.textContent = 'Posting...';
      }

      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          body: new URLSearchParams({ body: message })
        });

        if (!response.ok) {
          throw new Error('Comment request failed');
        }

        const data = await response.json();
        if (!data.ok || !data.comment) {
          throw new Error('Comment not accepted');
        }

        const list = document.querySelector('.comment-list');
        if (list) {
          const emptyState = list.querySelector('.empty-state');
          if (emptyState) emptyState.remove();

          const item = document.createElement('div');
          item.className = 'comment-item ad-comment';

          const avatar = document.createElement('img');
          avatar.className = 'ad-comment-avatar';
          avatar.src = data.comment.avatar || '/images/default-avatar.svg';
          avatar.alt = data.comment.display_name || data.comment.username;
          avatar.addEventListener('error', () => {
            if (!avatar.src.endsWith('/images/default-avatar.svg')) {
              avatar.src = '/images/default-avatar.svg';
            }
          }, { once: true });

          const body = document.createElement('div');
          body.className = 'comment-body';

          const name = document.createElement('strong');
          name.textContent = data.comment.display_name || data.comment.username;

          const text = document.createElement('p');
          text.textContent = data.comment.body;

          body.appendChild(name);
          body.appendChild(text);
          item.appendChild(avatar);
          item.appendChild(body);
          list.prepend(item);
        }

        const commentSummary = [...document.querySelectorAll('.info-item')].find((item) => item.querySelector('span')?.textContent.trim() === 'Comments');
        if (commentSummary) {
          const counter = commentSummary.querySelector('strong');
          if (counter) counter.textContent = data.comments_count ?? '0';
        }

        form.reset();
      } catch (error) {
        form.submit();
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = previousText;
        }
      }
    });
  });
};

// ---------- Artwork share dialog ----------

const getShareDialog = () => document.querySelector('[data-share-dialog]');

let shareDialogContext = null;

const updateShareCounters = (count) => {
  if (!Number.isFinite(Number(count))) return;
  document.querySelectorAll('[data-shares-count]').forEach((counter) => {
    counter.textContent = String(Math.max(0, Number(count)));
  });
};

const trackArtworkShare = async (platform) => {
  const context = shareDialogContext;
  if (!context || !context.id) return;
  try {
    const response = await fetch(`/art/${encodeURIComponent(context.id)}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ platform })
    });
    if (!response.ok) return;
    const data = await response.json();
    if (data?.ok) updateShareCounters(data.shares_count);
  } catch (error) {
    /* share tracking is best-effort */
  }
};

const copyArtworkLink = async (text) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    /* fall through to the legacy copy path */
  }
  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    return copied;
  } catch (error) {
    return false;
  }
};

const setShareNote = (dialog, message, tone = '') => {
  const note = dialog?.querySelector('[data-share-note]');
  if (!note) return;
  note.textContent = message || '';
  note.classList.remove('is-success', 'is-error');
  if (tone) note.classList.add(`is-${tone}`);
};

const buildShareLinks = (context) => {
  const url = encodeURIComponent(context.url);
  const text = encodeURIComponent(context.text);
  return {
    telegram: `https://t.me/share/url?url=${url}&text=${text}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${context.text} ${context.url}`)}`,
    x: `https://twitter.com/intent/tweet?url=${url}&text=${text}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
    email: `mailto:?subject=${encodeURIComponent(context.title || 'ArtSpace artwork')}&body=${encodeURIComponent(`${context.text}\n\n${context.url}`)}`
  };
};

const isMobileShareDevice = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

const openShareDialog = (context) => {
  const dialog = getShareDialog();
  if (!dialog) return false;

  shareDialogContext = context;

  const previewImage = dialog.querySelector('[data-share-preview-image]');
  const previewTitle = dialog.querySelector('[data-share-preview-title]');
  const previewArtist = dialog.querySelector('[data-share-preview-artist]');
  const previewCategory = dialog.querySelector('[data-share-preview-category]');
  const urlInput = dialog.querySelector('[data-share-url-input]');
  const nativeButton = dialog.querySelector('[data-share-native]');
  const copyButton = dialog.querySelector('[data-share-copy]');
  const copyLabel = dialog.querySelector('[data-share-copy-label]');

  if (previewImage) {
    if (context.image) previewImage.src = new URL(context.image, window.location.origin).href;
    else previewImage.src = '/images/default-artwork.svg';
    previewImage.onerror = () => { previewImage.src = '/images/default-artwork.svg'; };
  }
  if (previewTitle) previewTitle.textContent = context.title || 'Artwork on ArtSpace';
  if (previewArtist) previewArtist.textContent = context.artist ? `by ${context.artist}` : 'ArtSpace community';
  if (previewCategory) previewCategory.textContent = context.category || 'Artwork';
  if (urlInput) urlInput.value = context.url || '';
  if (nativeButton) nativeButton.hidden = typeof navigator.share !== 'function';
  if (copyButton) copyButton.classList.remove('is-copied');
  if (copyLabel) copyLabel.textContent = 'Copy link';
  const internalMessage = dialog.querySelector('[data-share-message]');
  if (internalMessage) internalMessage.value = '';
  setShareNote(dialog, '');

  dialog.showModal();
  dialog.querySelector('[data-share-close]')?.focus({ preventScroll: true });
  return true;
};

const bindShareDialog = () => {
  const dialog = getShareDialog();
  if (!dialog || dialog.dataset.shareDialogBound === 'true') return;
  dialog.dataset.shareDialogBound = 'true';

  dialog.querySelector('[data-share-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog.querySelectorAll('[data-share-platform]').forEach((button) => {
    button.addEventListener('click', () => {
      const context = shareDialogContext;
      if (!context) return;
      const platform = button.dataset.sharePlatform;

      if (platform === 'messenger') {
        if (isMobileShareDevice()) {
          setShareNote(dialog, 'Opening Messenger…');
          window.location.href = `fb-messenger://share/?link=${encodeURIComponent(context.url)}`;
          trackArtworkShare('messenger');
        } else {
          setShareNote(dialog, 'Messenger sharing works from a phone. On desktop, copy the link or use “Share with device”.');
        }
        return;
      }

      const link = buildShareLinks(context)[platform];
      if (!link) return;
      setShareNote(dialog, `Opening ${button.textContent.trim() || platform}…`);
      window.open(link, '_blank', 'noopener,noreferrer');
      trackArtworkShare(platform);
      window.setTimeout(() => { if (dialog.open) dialog.close(); }, 450);
    });
  });

  const copyButton = dialog.querySelector('[data-share-copy]');
  const copyLabel = dialog.querySelector('[data-share-copy-label]');
  copyButton?.addEventListener('click', async () => {
    const context = shareDialogContext;
    if (!context || copyButton.dataset.busy === 'true') return;
    copyButton.dataset.busy = 'true';
    const copied = await copyArtworkLink(context.url || '');
    if (copied) {
      if (copyLabel) copyLabel.textContent = 'Copied!';
      copyButton.classList.add('is-copied');
      setShareNote(dialog, 'Link copied!', 'success');
      trackArtworkShare('copy');
      window.setTimeout(() => {
        if (copyButton.isConnected) {
          copyButton.classList.remove('is-copied');
          if (copyLabel) copyLabel.textContent = 'Copy link';
        }
      }, 1800);
    } else {
      setShareNote(dialog, 'Could not copy automatically. Select the link and copy it manually.', 'error');
    }
    copyButton.dataset.busy = 'false';
  });

  dialog.querySelector('[data-share-native]')?.addEventListener('click', async () => {
    const context = shareDialogContext;
    if (!context || typeof navigator.share !== 'function') return;
    try {
      await navigator.share({ title: context.title, text: context.text, url: context.url });
      setShareNote(dialog, 'Shared. Thanks for passing it along!', 'success');
      trackArtworkShare('native');
    } catch (error) {
      if (error?.name !== 'AbortError') setShareNote(dialog, 'Sharing was cancelled or is unavailable here.');
    }
  });

  const internalButton = dialog.querySelector('[data-share-internal-submit]');
  const internalMessage = dialog.querySelector('[data-share-message]');

  internalButton?.addEventListener('click', async () => {
    const context = shareDialogContext;
    if (!context || !context.id || internalButton.dataset.busy === 'true') return;

    internalButton.dataset.busy = 'true';
    internalButton.classList.add('is-loading');
    setShareNote(dialog, 'Sharing to your feed…');

    try {
      const response = await fetch(`/art/${encodeURIComponent(context.id)}/share`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          platform: 'internal',
          message: (internalMessage?.value || '').trim()
        })
      });

      if (response.status === 401) {
        setShareNote(dialog, 'Log in to share inside ArtSpace.', 'error');
        return;
      }

      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        payload = null;
      }

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'We could not share this artwork right now.');
      }

      if (typeof payload.shares_count === 'number') updateShareCounters(payload.shares_count);
      if (internalMessage) internalMessage.value = '';
      setShareNote(dialog, 'Shared to your feed. Thanks for passing it along!', 'success');
      showPinToast('Shared to your ArtSpace feed.');
      window.setTimeout(() => { if (dialog.open) dialog.close(); }, 700);
    } catch (error) {
      setShareNote(dialog, error.message || 'We could not share this artwork right now.', 'error');
    } finally {
      internalButton.dataset.busy = 'false';
      internalButton.classList.remove('is-loading');
    }
  });
};

const buildShareContextFromButton = (button) => ({
  id: button.dataset.shareId || '',
  title: button.dataset.shareTitle || 'ArtSpace artwork',
  text: button.dataset.shareText || 'Artwork on ArtSpace',
  url: new URL(button.dataset.shareUrl || window.location.pathname, window.location.origin).toString(),
  image: button.dataset.shareImage || '',
  artist: button.dataset.shareArtist || '',
  category: button.dataset.shareCategory || ''
});

const bindShareButtons = () => {
  if (document.documentElement.dataset.shareButtonsBound === 'true') return;
  document.documentElement.dataset.shareButtonsBound = 'true';

  document.addEventListener('click', async (event) => {
    const button = event.target instanceof Element
      ? event.target.closest('[data-share-artwork]')
      : null;
    if (!button || button.closest('[data-share-dialog]')) return;

    event.preventDefault();
    const context = buildShareContextFromButton(button);
    document.querySelectorAll('[data-post-menu]').forEach((menu) => { menu.hidden = true; });
    document.querySelectorAll('[data-post-menu-toggle]').forEach((toggle) => toggle.setAttribute('aria-expanded', 'false'));

    if (openShareDialog(context)) return;

    try {
      if (navigator.share) {
        await navigator.share({ title: context.title, text: context.text, url: context.url });
        return;
      }
      if (await copyArtworkLink(context.url)) {
        const label = button.querySelector('[data-share-label]');
        if (label) {
          const original = label.textContent;
          label.textContent = 'Copied!';
          window.setTimeout(() => { if (label.isConnected) label.textContent = original; }, 1600);
        }
      }
    } catch (error) {
      if (error?.name !== 'AbortError') {
        const label = button.querySelector('[data-share-label]');
        if (label) label.textContent = 'Share unavailable';
      }
    }
  });
};

const bindFollowForms = () => {
  document.querySelectorAll('[data-follow-form]').forEach((form) => {
    if (form.dataset.followBound === 'true') return;
    form.dataset.followBound = 'true';

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (form.dataset.busy === 'true') return;
      form.dataset.busy = 'true';
      const button = form.querySelector('button');
      const label = button?.querySelector('[data-follow-label]');
      const icon = button?.querySelector('svg');
      if (button) button.disabled = true;

      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
          credentials: 'same-origin',
          body: new URLSearchParams(new FormData(form))
        });
        const data = await response.json();
        if (!response.ok || !data?.ok) throw new Error(data?.error || 'We could not update that follow. Please try again.');

        const following = Boolean(data.following);
        if (button) {
          button.classList.toggle('is-following', following);
          button.setAttribute('aria-pressed', String(following));
        }
        if (label) label.textContent = following ? 'Following artist' : 'Follow artist';
        if (icon) icon.innerHTML = following ? '<path d="M5 12.5l4.5 4.5L19 7.5" />' : '<path d="M12 5v14M5 12h14" />';

        const followersCount = Number(data.followers_count);
        if (Number.isFinite(followersCount)) {
          document.querySelectorAll('[data-followers-count]').forEach((counter) => {
            counter.textContent = String(followersCount);
          });
          document.querySelectorAll('[data-followers-label]').forEach((counter) => {
            counter.textContent = followersCount === 1 ? 'follower' : 'followers';
          });
        }
        showPinToast(following ? 'You are now following this artist.' : 'Unfollowed the artist.', 'success');
      } catch (error) {
        showPinToast(error.message || 'We could not update that follow. Please try again.', 'error');
      } finally {
        if (button) button.disabled = false;
        form.dataset.busy = 'false';
      }
    });
  });
};

const bindReportDialog = () => {
  const dialog = document.querySelector('[data-report-dialog]');
  if (!dialog || dialog.dataset.reportBound === 'true') return;
  dialog.dataset.reportBound = 'true';

  const form = dialog.querySelector('[data-report-form]');
  const note = dialog.querySelector('[data-report-note]');
  const cancelButton = dialog.querySelector('[data-report-cancel]');
  const submitButton = form?.querySelector('button[type="submit"]');

  const setNote = (message, tone = '') => {
    if (!note) return;
    note.textContent = message || '';
    note.classList.remove('is-success', 'is-error');
    if (tone) note.classList.add(`is-${tone}`);
  };

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  cancelButton?.addEventListener('click', () => dialog.close());

  document.querySelectorAll('[data-report-open]').forEach((button) => {
    if (button.dataset.reportOpenBound === 'true') return;
    button.dataset.reportOpenBound = 'true';
    button.addEventListener('click', () => {
      form?.reset();
      setNote('');
      dialog.showModal();
      form?.querySelector('input[name="report_reason"]')?.focus();
    });
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (form.dataset.busy === 'true') return;

    const reasonInput = form.querySelector('input[name="report_reason"]:checked');
    if (!reasonInput) {
      setNote('Choose a reason so the moderation desk knows what to check.', 'error');
      return;
    }

    const details = String(form.querySelector('[name="report_details"]')?.value || '').trim().slice(0, 400);
    const reason = details ? `${reasonInput.value} — ${details}` : reasonInput.value;
    const hiddenReason = form.querySelector('input[name="reason"]');
    if (hiddenReason) hiddenReason.value = reason;

    form.dataset.busy = 'true';
    if (submitButton) submitButton.disabled = true;

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ reason })
      });
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'We could not send that report. Please try again.');
      setNote('Thank you — this artwork has been sent to the moderation desk.', 'success');
      showPinToast('Report sent to the moderation desk.', 'success');
      window.setTimeout(() => { if (dialog.open) dialog.close(); }, 1100);
    } catch (error) {
      setNote(error.message || 'We could not send that report. Please try again.', 'error');
    } finally {
      form.dataset.busy = 'false';
      if (submitButton) submitButton.disabled = false;
    }
  });
};

const bindArtworkDescription = () => {
  const page = document.querySelector('[data-artwork-detail]');
  const description = page?.querySelector('[data-description]');
  const toggle = page?.querySelector('[data-description-toggle]');
  if (!description || !toggle || toggle.dataset.descriptionBound === 'true') return;
  toggle.dataset.descriptionBound = 'true';

  toggle.addEventListener('click', () => {
    const collapsed = description.classList.toggle('is-clamped');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.textContent = collapsed ? 'Read more' : 'Show less';
  });
};

// ---------- Artwork detail comment system ----------

let artworkCommentsBound = false;
let commentPendingDelete = '';

const getArtworkDetailRoot = () => document.querySelector('[data-artwork-detail]');

const updateCommentCounters = (count) => {
  const total = Number(count);
  if (!Number.isFinite(total)) return;
  document.querySelectorAll('[data-comments-count]').forEach((counter) => {
    counter.textContent = String(Math.max(0, total));
  });
  document.querySelectorAll('[data-comments-label]').forEach((label) => {
    label.textContent = Math.max(0, total) === 1 ? 'comment' : 'comments';
  });
};

const enhanceCommentMedia = (root) => {
  root?.querySelectorAll?.('img[data-fallback-src]').forEach((image) => {
    bindArtworkImageFallback(image, image.closest('.ad-comment'));
  });
};

const ensureCommentsEmptyState = (list) => {
  if (!list || list.querySelector('.ad-comment') || list.querySelector('[data-comments-empty]')) return;
  const empty = document.createElement('div');
  empty.className = 'empty-state ad-comments-empty';
  empty.setAttribute('data-comments-empty', '');
  empty.innerHTML =
    '<svg viewBox="0 0 80 80" aria-hidden="true"><path d="M20 58l5-17 24-24 11 11-24 24-16 6Z" /><path d="M44 22l11 11" /><path d="M14 66c8-2 16-2 24 0" /></svg>' +
    '<p class="ad-comments-empty-title">No thoughts yet.</p>' +
    '<p>The conversation has cleared. Start it again with a note.</p>';
  list.appendChild(empty);
};

const REPLY_TOGGLE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-3-.4-4.2-1.1L3 21l1.7-4.7A8.4 8.4 0 0 1 3.5 12 8.5 8.5 0 0 1 12 3.5 8.5 8.5 0 0 1 21 12Z" /></svg>';

const getReplyTotal = (article) => {
  const container = article?.querySelector(':scope > .ad-comment-main > .ad-comment-replies');
  if (!container) return 0;
  return container.querySelectorAll('.ad-reply-slot > .ad-comment').length;
};

const setReplyLabels = (article, total) => {
  if (!article) return;
  const labels = article.querySelectorAll(':scope > .ad-comment-main > .ad-comment-actions [data-replies-label], :scope > .ad-comment-main > [data-replies-toggle] [data-replies-label]');
  labels.forEach((label) => {
    const expanded = label.closest('[data-replies-toggle]')?.getAttribute('aria-expanded') !== 'false';
    label.textContent = expanded ? 'Hide replies' : `View ${total} ${total === 1 ? 'reply' : 'replies'}`;
  });
};

const refreshReplyCount = (article) => {
  if (!article) return;
  const total = getReplyTotal(article);
  if (total === 0) return;

  let countButton = article.querySelector(':scope > .ad-comment-main > .ad-comment-actions [data-replies-toggle]');
  if (!countButton) {
    const actions = article.querySelector(':scope > .ad-comment-main > .ad-comment-actions');
    if (actions) {
      countButton = document.createElement('button');
      countButton.type = 'button';
      countButton.className = 'ad-comment-action ad-comment-replies-count';
      countButton.dataset.repliesToggle = '';
      countButton.setAttribute('aria-expanded', 'true');
      countButton.innerHTML = `${REPLY_TOGGLE_SVG}<span data-replies-label></span>`;
      actions.appendChild(countButton);
    }
  }

  if (countButton) {
    countButton.setAttribute('aria-expanded', 'true');
    const label = countButton.querySelector('[data-replies-label]');
    if (label) label.textContent = total === 1 ? '1 reply' : `${total} replies`;
  }
};

const insertCommentHtml = (html, parentId) => {
  const list = document.querySelector('[data-comment-list]');
  if (!list || !html) return null;

  const holder = document.createElement('div');
  holder.innerHTML = html.trim();
  const article = holder.firstElementChild;
  if (!(article instanceof HTMLElement)) return null;

  if (parentId) {
    const parent = list.querySelector(`.ad-comment[data-comment-id="${CSS.escape(String(parentId))}"]`);
    if (!parent) return null;
    let replies = parent.querySelector(':scope > .ad-comment-main > .ad-comment-replies');
    if (!replies) {
      replies = document.createElement('div');
      replies.className = 'ad-comment-replies';
      (parent.querySelector(':scope > .ad-comment-main') || parent).appendChild(replies);
    }
    replies.classList.remove('is-collapsed');
    const slot = document.createElement('div');
    slot.className = 'ad-reply-slot';
    slot.appendChild(article);
    replies.appendChild(slot);
    refreshReplyCount(parent);
  } else {
    const emptyState = list.querySelector('[data-comments-empty]');
    if (emptyState) emptyState.remove();
    list.prepend(article);
  }

  enhanceCommentMedia(article);
  return article;
};

const closeOpenCommentForms = (exceptForm) => {
  document.querySelectorAll('[data-reply-form]:not([hidden]), [data-comment-edit-form]:not([hidden])').forEach((openForm) => {
    if (openForm === exceptForm) return;
    openForm.hidden = true;
    if (openForm.matches('[data-reply-form]')) {
      openForm.closest('.ad-comment')
        ?.querySelector(':scope > .ad-comment-main > .ad-comment-actions [data-comment-reply-toggle]')
        ?.setAttribute('aria-expanded', 'false');
    }
  });
};

const toggleCommentLike = async (button) => {
  const commentId = button.dataset.commentId;
  if (!commentId || button.dataset.busy === 'true') return;
  button.dataset.busy = 'true';

  try {
    const response = await fetch(`/comments/${encodeURIComponent(commentId)}/like`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin'
    });
    if (response.status === 401) {
      window.location.assign('/login');
      return;
    }
    const data = await response.json();
    if (!response.ok || !data?.ok) throw new Error(data?.error || 'We could not update that like. Please try again.');

    const liked = Boolean(data.liked);
    const count = Number(data.likes_count);
    const selector = `[data-comment-like][data-comment-id="${CSS.escape(String(data.comment_id ?? commentId))}"]`;
    document.querySelectorAll(selector).forEach((node) => {
      node.classList.toggle('is-liked', liked);
      node.setAttribute('aria-pressed', String(liked));
      node.setAttribute('aria-label', liked ? 'Unlike this comment' : 'Like this comment');
      const counter = node.querySelector('[data-comment-like-count]');
      if (counter && Number.isFinite(count)) counter.textContent = String(Math.max(0, count));
    });
  } catch (error) {
    showPinToast(error.message || 'We could not update that like. Please try again.', 'error');
  } finally {
    button.dataset.busy = 'false';
  }
};

const submitCommentEdit = async (form, event) => {
  event.preventDefault();
  const commentId = form.dataset.commentId || form.closest('.ad-comment')?.dataset.commentId;
  const textarea = form.querySelector('textarea');
  const body = (textarea?.value || '').trim();

  if (!commentId || !textarea || !body) {
    textarea?.focus();
    return;
  }
  if (form.dataset.busy === 'true') return;

  form.dataset.busy = 'true';
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;

  try {
    const response = await fetch(`/comments/${encodeURIComponent(commentId)}/edit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json'
      },
      credentials: 'same-origin',
      body: JSON.stringify({ body })
    });

    if (response.status === 401) {
      window.location.assign('/login');
      return;
    }

    const data = await response.json();
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || 'We could not save that edit. Please try again.');
    }

    const article = form.closest('.ad-comment');
    const text = article?.querySelector('[data-comment-text]');
    if (text) {
      if (typeof data.body_html === 'string') text.innerHTML = data.body_html;
      else text.textContent = body;
    }

    const edited = article?.querySelector('[data-comment-edited]');
    if (edited) edited.hidden = false;

    textarea.defaultValue = body;
    form.hidden = true;
    showPinToast('Comment updated.', 'success');
  } catch (error) {
    showPinToast(error.message || 'We could not save that edit. Please try again.', 'error');
  } finally {
    form.dataset.busy = 'false';
    if (submitButton) submitButton.disabled = false;
  }
};

const handleCommentFormSubmit = async (event) => {
  if (!(event.target instanceof Element)) return;

  const editForm = event.target.closest('[data-comment-edit-form]');
  if (editForm) {
    await submitCommentEdit(editForm, event);
    return;
  }

  const form = event.target.closest('[data-comment-form], [data-reply-form]');
  if (!form || form.dataset.busy === 'true') return;

  const artworkId = getArtworkDetailRoot()?.dataset.artworkId;
  if (!artworkId) return;

  event.preventDefault();

  const textarea = form.querySelector('textarea[name="body"]');
  const body = (textarea?.value || '').trim();
  if (!textarea || !body) {
    textarea?.focus();
    return;
  }

  const isReply = form.matches('[data-reply-form]');
  const parentId = isReply ? String(form.dataset.commentId || '') : '';
  const submitButton = form.querySelector('button[type="submit"]');

  form.dataset.busy = 'true';
  if (textarea) textarea.disabled = true;
  if (submitButton) submitButton.disabled = true;

  try {
    const response = await fetch(`/art/${encodeURIComponent(artworkId)}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ body, parent_id: parentId || undefined })
    });
    if (response.status === 401) {
      window.location.assign('/login');
      return;
    }
    const data = await response.json();
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || 'Your comment could not be posted. Please try again.');
    }

    const inserted = insertCommentHtml(data.comment_html, parentId);
    if (inserted) {
      inserted.classList.add('is-new');
      window.setTimeout(() => inserted.classList.remove('is-new'), 1700);
      inserted.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }

    updateCommentCounters(data.comments_count);
    form.reset();
    const charCounter = form.querySelector('[data-comment-char]');
    if (charCounter) charCounter.textContent = `0 / ${textarea.getAttribute('maxlength') || '2000'}`;

    if (isReply) form.hidden = true;
    else textarea.focus();

    showPinToast(isReply ? 'Reply posted.' : 'Your note was posted.', 'success');
  } catch (error) {
    showPinToast(error.message || 'Your comment could not be posted. Please try again.', 'error');
  } finally {
    form.dataset.busy = 'false';
    if (textarea) textarea.disabled = false;
    if (submitButton) submitButton.disabled = false;
  }
};

const openCommentConfirm = (commentId) => {
  const dialog = document.querySelector('[data-comment-confirm]');
  if (!dialog) return;
  commentPendingDelete = commentId;
  dialog.showModal();
  dialog.querySelector('[data-confirm-ok]')?.focus({ preventScroll: true });
};

const deleteComment = async (commentId) => {
  const artworkId = getArtworkDetailRoot()?.dataset.artworkId;
  if (!artworkId) return;

  try {
    const response = await fetch(`/comments/${encodeURIComponent(commentId)}/delete`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin'
    });
    if (response.status === 401) {
      window.location.assign('/login');
      return;
    }
    const data = await response.json();
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || 'We could not delete that comment. Please try again.');
    }

    const deletedIds = new Set((Array.isArray(data.deleted_ids) ? data.deleted_ids : []).map(String));
    deletedIds.add(String(commentId));
    document.querySelectorAll('.ad-comment[data-comment-id]').forEach((article) => {
      if (deletedIds.has(String(article.dataset.commentId))) article.remove();
    });

    ensureCommentsEmptyState(document.querySelector('[data-comment-list]'));
    updateCommentCounters(data.comments_count);
    showPinToast('Comment deleted.', 'success');
  } catch (error) {
    showPinToast(error.message || 'We could not delete that comment. Please try again.', 'error');
  }
};

const loadMoreComments = async (button) => {
  const artworkId = getArtworkDetailRoot()?.dataset.artworkId;
  const nextPage = button.dataset.nextPage;
  if (!artworkId || !nextPage || button.dataset.busy === 'true') return;

  button.dataset.busy = 'true';
  const label = button.querySelector('span');
  const originalLabel = label?.textContent || '';
  if (label) label.textContent = 'Loading…';

  try {
    const response = await fetch(`/art/${encodeURIComponent(artworkId)}/comments?page=${encodeURIComponent(nextPage)}`, {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin'
    });
    if (response.status === 401) {
      window.location.assign('/login');
      return;
    }
    const data = await response.json();
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || 'We could not load more comments. Please try again.');
    }

    const list = document.querySelector('[data-comment-list]');
    if (list && data.html) {
      const emptyState = list.querySelector('[data-comments-empty]');
      if (emptyState) emptyState.remove();
      const holder = document.createElement('div');
      holder.innerHTML = data.html;
      while (holder.firstElementChild) {
        const node = holder.firstElementChild;
        list.appendChild(node);
        enhanceCommentMedia(node);
      }
    }

    updateCommentCounters(data.comments_count);

    if (data.has_more && data.next_page) {
      button.dataset.nextPage = String(data.next_page);
    } else {
      button.closest('.ad-comment-more-wrap')?.remove();
    }
  } catch (error) {
    showPinToast(error.message || 'We could not load more comments. Please try again.', 'error');
  } finally {
    button.dataset.busy = 'false';
    if (label && label.isConnected) label.textContent = originalLabel;
  }
};

const handleCommentClick = (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const likeButton = target.closest('[data-comment-like]');
  if (likeButton) {
    event.preventDefault();
    toggleCommentLike(likeButton);
    return;
  }

  const replyToggle = target.closest('[data-comment-reply-toggle]');
  if (replyToggle) {
    event.preventDefault();
    const article = replyToggle.closest('.ad-comment');
    const form = article?.querySelector(':scope > .ad-comment-main > [data-reply-form]');
    if (!form) return;
    const willShow = form.hidden;
    closeOpenCommentForms(form);
    form.hidden = !willShow;
    replyToggle.setAttribute('aria-expanded', String(willShow));
    if (willShow) form.querySelector('textarea')?.focus();
    return;
  }

  const editToggle = target.closest('[data-comment-edit-toggle]');
  if (editToggle) {
    event.preventDefault();
    const article = editToggle.closest('.ad-comment');
    const form = article?.querySelector(':scope > .ad-comment-main > .ad-comment-bubble > [data-comment-edit-form]');
    if (!form) return;
    const willShow = form.hidden;
    closeOpenCommentForms(form);
    form.hidden = !willShow;
    if (willShow) {
      const field = form.querySelector('textarea');
      field?.focus();
      field?.setSelectionRange(field.value.length, field.value.length);
    }
    return;
  }

  const editCancel = target.closest('[data-comment-edit-cancel]');
  if (editCancel) {
    event.preventDefault();
    const form = editCancel.closest('[data-comment-edit-form]');
    if (form) {
      form.hidden = true;
      const field = form.querySelector('textarea');
      if (field) field.value = field.defaultValue;
    }
    return;
  }

  const replyCancel = target.closest('[data-reply-cancel]');
  if (replyCancel) {
    event.preventDefault();
    const form = replyCancel.closest('[data-reply-form]');
    if (form) {
      form.hidden = true;
      form.closest('.ad-comment')
        ?.querySelector(':scope > .ad-comment-main > .ad-comment-actions [data-comment-reply-toggle]')
        ?.setAttribute('aria-expanded', 'false');
    }
    return;
  }

  const repliesToggle = target.closest('[data-replies-toggle]');
  if (repliesToggle) {
    event.preventDefault();
    const article = repliesToggle.closest('.ad-comment');
    const container = article?.querySelector(':scope > .ad-comment-main > .ad-comment-replies');
    if (!article || !container) return;
    const collapsed = container.classList.toggle('is-collapsed');
    article
      .querySelectorAll(':scope > .ad-comment-main > .ad-comment-actions [data-replies-toggle], :scope > .ad-comment-main > [data-replies-toggle]')
      .forEach((button) => button.setAttribute('aria-expanded', String(!collapsed)));

    const total = getReplyTotal(article);
    article
      .querySelectorAll(':scope > .ad-comment-main > .ad-comment-actions [data-replies-label], :scope > .ad-comment-main > [data-replies-toggle] [data-replies-label]')
      .forEach((label) => {
        const isCount = label.closest('.ad-comment-replies-count');
        label.textContent = collapsed
          ? `View ${total} ${total === 1 ? 'reply' : 'replies'}`
          : (isCount ? (total === 1 ? '1 reply' : `${total} replies`) : 'Hide replies');
      });
    return;
  }

  const deleteButton = target.closest('[data-comment-delete]');
  if (deleteButton) {
    event.preventDefault();
    const article = deleteButton.closest('.ad-comment');
    if (article?.dataset.commentId) openCommentConfirm(article.dataset.commentId);
    return;
  }

  const moreButton = target.closest('[data-comments-more]');
  if (moreButton) {
    event.preventDefault();
    loadMoreComments(moreButton);
  }
};

const handleCommentInput = (event) => {
  const textarea = event.target instanceof Element ? (event.target.closest('textarea[name="body"]') || (event.target.matches('textarea[name="body"]') ? event.target : null)) : null;
  if (!textarea) return;
  const form = textarea.closest('[data-comment-form], [data-reply-form]');
  const counter = form?.querySelector('[data-comment-char]');
  if (!counter) return;
  counter.textContent = `${String(textarea.value.length)} / ${textarea.getAttribute('maxlength') || '2000'}`;
};

const bindCommentConfirmDialog = () => {
  const dialog = document.querySelector('[data-comment-confirm]');
  if (!dialog || dialog.dataset.confirmBound === 'true') return;
  dialog.dataset.confirmBound = 'true';

  dialog.querySelector('[data-confirm-cancel]')?.addEventListener('click', () => {
    commentPendingDelete = '';
    dialog.close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      commentPendingDelete = '';
      dialog.close();
    }
  });
  dialog.querySelector('[data-confirm-ok]')?.addEventListener('click', async () => {
    const commentId = commentPendingDelete;
    commentPendingDelete = '';
    dialog.close();
    if (commentId) await deleteComment(commentId);
  });
};

const bindArtworkComments = () => {
  if (artworkCommentsBound || !getArtworkDetailRoot()) return;
  artworkCommentsBound = true;

  document.addEventListener('submit', handleCommentFormSubmit);
  document.addEventListener('click', handleCommentClick);
  document.addEventListener('input', handleCommentInput);
  bindCommentConfirmDialog();
  enhanceCommentMedia(document);
};

const bindScrollReveal = () => {
  const targets = document.querySelectorAll('.ad-reveal');
  if (!targets.length) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    targets.forEach((target) => target.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries, currentObserver) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      currentObserver.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px 48px 0px' });
  registerPageCleanup(() => observer.disconnect());

  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

  targets.forEach((target, index) => {
    const rect = target.getBoundingClientRect();
    if (rect.top < viewportHeight && rect.bottom > 0) {
      target.classList.add('is-visible');
      return;
    }

    target.classList.add('ad-reveal-pending');
    target.style.transitionDelay = `${(index % 5) * 70}ms`;
    observer.observe(target);
  });
};

const markCurrentNavigation = () => {
  const currentPath = window.location.pathname.replace(/\/$/, '') || '/';

  document.querySelectorAll('.nav-link-group a').forEach((link) => {
    const linkPath = new URL(link.href, window.location.origin).pathname.replace(/\/$/, '') || '/';
    const isCurrent = linkPath === currentPath || (linkPath !== '/' && currentPath.startsWith(`${linkPath}/`));

    link.classList.toggle('is-current', isCurrent);
    if (isCurrent) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
};

const revealArtworkCards = () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;

  const cards = document.querySelectorAll('.art-card');
  if (!cards.length) return;

  const observer = new IntersectionObserver((entries, currentObserver) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      currentObserver.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px 40px 0px' });
  registerPageCleanup(() => observer.disconnect());

  cards.forEach((card, index) => {
    card.classList.add('motion-pending');
    card.style.transitionDelay = `${(index % 6) * 55}ms`;
    observer.observe(card);
  });
};

const bindArtworkImageFallback = (image, container) => {
  if (!image || image.dataset.imageFallbackBound === 'true') return;
  image.dataset.imageFallbackBound = 'true';

  const handleError = () => {
    const fallback = image.dataset.fallbackSrc;
    const fallbackUrl = fallback ? new URL(fallback, window.location.href).href : '';

    if (fallbackUrl && image.currentSrc !== fallbackUrl && image.dataset.fallbackTried !== 'true') {
      image.dataset.fallbackTried = 'true';
      image.src = fallback;
      return;
    }

    container?.classList.add('is-image-missing');
  };

  image.addEventListener('error', handleError);
  if (image.hasAttribute('src') && image.complete && image.naturalWidth === 0) handleError();
};

let boundFlipbookExperience = null;
let pageFlipLibraryPromise = null;

const loadPageFlipLibrary = () => {
  if (window.St?.PageFlip) return Promise.resolve();
  if (pageFlipLibraryPromise) return pageFlipLibraryPromise;

  pageFlipLibraryPromise = new Promise((resolve) => {
    const existing = document.querySelector('script[data-page-flip-loader]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => resolve(), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = versionedAsset('/vendor/page-flip.browser.js');
    script.async = true;
    script.dataset.pageFlipLoader = 'true';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => resolve(), { once: true });
    document.head.appendChild(script);
  });

  return pageFlipLibraryPromise;
};

const bindFlipbook = () => {
  const experience = document.querySelector('[data-art-book]');
  const book = experience?.querySelector('[data-book-root]');
  if (!experience || !book || !window.St?.PageFlip) return;
  if (boundFlipbookExperience === experience) return;
  boundFlipbookExperience = experience;

  const pages = [...book.querySelectorAll('[data-book-page]')];
  const artworkPages = pages.filter((page) => page.querySelector('[data-book-image]'));
  const previousButton = experience.querySelector('[data-book-prev]');
  const nextButton = experience.querySelector('[data-book-next]');
  const currentLabel = experience.querySelector('[data-book-current]');
  const liveLabel = experience.querySelector('[data-book-live]');
  const closeBookButton = experience.querySelector('[data-book-close]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!pages.length || !artworkPages.length) return;

  const pageFlip = new window.St.PageFlip(book, {
    width: 480,
    height: 580,
    size: 'stretch',
    minWidth: 250,
    maxWidth: 480,
    minHeight: 360,
    maxHeight: 580,
    drawShadow: true,
    flippingTime: reducedMotion ? 1 : 1000,
    usePortrait: true,
    autoSize: false,
    maxShadowOpacity: 0.3,
    showCover: true,
    mobileScrollSupport: false,
    clickEventForward: true,
    useMouseEvents: true,
    swipeDistance: 28,
    disableFlipByClick: false
  });

  const bookSoundCues = new Map();
  const bookCueKinds = ['open', 'page', 'reveal', 'close'];
  let bookAudioContext = null;
  let bookPageTimer = 0;
  let bookRevealTimer = 0;
  let bookCloseTimer = 0;
  let bookResetTimer = 0;

  const getBookAudioContext = () => {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) return null;
    if (!bookAudioContext || bookAudioContext.state === 'closed') bookAudioContext = new AudioContextConstructor();
    if (bookAudioContext.state === 'suspended') bookAudioContext.resume().catch(() => {});
    return bookAudioContext;
  };

  const playBookSynthCue = (kind) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    try {
      const audioContext = getBookAudioContext();
      if (!audioContext) return;
      const now = audioContext.currentTime;
      const oscillator = audioContext.createOscillator();
      const volume = audioContext.createGain();
      const shape = kind === 'close'
        ? { start: 520, end: 260, duration: 0.28 }
        : kind === 'page'
          ? { start: 330, end: 440, duration: 0.2 }
          : { start: 180, end: 620, duration: 0.5 };

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(shape.start, now);
      oscillator.frequency.exponentialRampToValueAtTime(shape.end, now + shape.duration);
      volume.gain.setValueAtTime(0.0001, now);
      volume.gain.exponentialRampToValueAtTime(kind === 'open' || kind === 'close' ? 0.02 : 0.014, now + 0.04);
      volume.gain.exponentialRampToValueAtTime(0.0001, now + shape.duration);
      oscillator.connect(volume);
      volume.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + shape.duration);
    } catch {
    }
  };

  const createBookCue = (kind) => {
    const cue = new Audio(`/audio/art-${kind}.wav`);
    cue.preload = 'auto';
    cue.volume = kind === 'reveal' ? 0.12 : 0.16;
    cue.addEventListener('error', () => {
      cue.dataset.unavailable = 'true';
    }, { once: true });
    cue.load();
    bookSoundCues.set(kind, cue);
    return cue;
  };

  const playBookCue = (kind) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let soundPref = 'off';
    try { soundPref = localStorage.getItem('artspace-art-sound') || 'off'; } catch { /* private mode */ }
    if (soundPref !== 'on') return;

    try {
      let cue = bookSoundCues.get(kind);
      if (!cue) cue = createBookCue(kind);

      if (cue.dataset.unavailable) {
        playBookSynthCue(kind);
        return;
      }

      cue.pause();
      cue.currentTime = 0;
      cue.play().catch(() => playBookSynthCue(kind));
    } catch {
      playBookSynthCue(kind);
    }
  };

  const resetBookAudioCues = () => {
    bookSoundCues.forEach((cue) => {
      cue.pause();
      cue.currentTime = 0;
    });
  };

  const clearBookAudioCues = () => {
    resetBookAudioCues();
    bookSoundCues.forEach((cue) => {
      cue.removeAttribute('src');
      cue.load();
    });
    bookSoundCues.clear();

    if (bookAudioContext && bookAudioContext.state !== 'closed') {
      bookAudioContext.close().catch(() => {});
    }
    bookAudioContext = null;
  };

  const warmBookCues = () => {
    bookCueKinds.forEach((kind) => {
      if (!bookSoundCues.has(kind)) createBookCue(kind);
    });
  };
  experience.addEventListener('pointerenter', warmBookCues, { once: true, passive: true });
  experience.addEventListener('focusin', warmBookCues, { once: true });
  experience.addEventListener('touchstart', warmBookCues, { once: true, passive: true });
  window.addEventListener('pagehide', clearBookAudioCues, { once: true });

  let bookOpenState = false;
  const setBookOpenState = (next) => {
    bookOpenState = next;
    experience.dataset.open = String(next);
    book.classList.toggle('is-open', next);
    if (closeBookButton) closeBookButton.hidden = !next;
  };

  const syncBookOpenState = (pageIndex) => {
    const next = pageIndex > 0;
    setBookOpenState(next);
    if (!next) {
      book.classList.remove('is-opening', 'is-open');
      window.clearTimeout(bookRevealTimer);
    }
  };

  const openBook = (flip = false) => {
    if (!pageFlip || bookOpenState) return;
    setBookOpenState(true);
    book.classList.add('is-opening');
    book.classList.remove('is-closing');
    playBookCue('open');
    window.clearTimeout(bookPageTimer);
    window.clearTimeout(bookRevealTimer);
    window.clearTimeout(bookCloseTimer);
    window.clearTimeout(bookResetTimer);
    bookPageTimer = window.setTimeout(() => playBookCue('page'), reducedMotion ? 0 : 220);
    bookRevealTimer = window.setTimeout(() => {
      if (bookOpenState) {
        book.classList.remove('is-opening');
        book.classList.add('is-open');
        playBookCue('reveal');
      }
    }, reducedMotion ? 0 : 1000);
    if (flip) pageFlip.flipNext();
  };

  const closeBook = () => {
    if (!pageFlip || !bookOpenState) return;
    setBookOpenState(false);
    book.classList.add('is-closing');
    playBookCue('close');
    pageFlip.flip(0);
    window.clearTimeout(bookPageTimer);
    window.clearTimeout(bookRevealTimer);
    bookPageTimer = window.setTimeout(() => playBookCue('page'), reducedMotion ? 0 : 220);
    bookResetTimer = window.setTimeout(resetBookAudioCues, reducedMotion ? 0 : 1800);
    bookCloseTimer = window.setTimeout(() => {
      book.classList.remove('is-closing');
    }, reducedMotion ? 0 : 1000);
  };

  const loadNearbyImages = (pageIndex) => {
    const firstArtworkIndex = Math.max(0, Math.min(artworkPages.length - 1, pageIndex - 1));
    const firstToLoad = Math.max(0, firstArtworkIndex - 1);
    const lastToLoad = Math.min(artworkPages.length - 1, firstArtworkIndex + 3);

    for (let index = firstToLoad; index <= lastToLoad; index += 1) {
      const image = artworkPages[index].querySelector('[data-book-image]');
        if (!image || image.hasAttribute('src') || !image.dataset.src) continue;
      bindArtworkImageFallback(image, image.closest('.book-artwork-link'));
      image.src = image.dataset.src;
      delete image.dataset.src;
    }
  };

  const updateBookControls = (pageIndex = pageFlip.getCurrentPageIndex()) => {
    const spreadIndex = pageFlip.getPageCollection().getCurrentSpreadIndex();
    const portrait = pageFlip.getOrientation() === 'portrait';
    const lastSpreadIndex = portrait ? artworkPages.length : Math.ceil(artworkPages.length / 2);
    book.dataset.orientation = portrait ? 'portrait' : 'landscape';

    if (previousButton) previousButton.disabled = spreadIndex === 0;
    if (nextButton) nextButton.disabled = spreadIndex >= lastSpreadIndex;

    if (pageIndex === 0) {
      if (currentLabel) currentLabel.textContent = 'Cover';
      if (liveLabel) liveLabel.textContent = 'Turn the cover to explore the collection.';
      return;
    }

    const firstArtworkIndex = Math.min(artworkPages.length - 1, Math.max(0, pageIndex - 1));
    const lastArtworkIndex = portrait
      ? firstArtworkIndex
      : Math.min(artworkPages.length - 1, firstArtworkIndex + 1);
    const firstPageNumber = String(firstArtworkIndex + 1).padStart(2, '0');
    const lastPageNumber = String(lastArtworkIndex + 1).padStart(2, '0');
      const pageRange = firstArtworkIndex === lastArtworkIndex
        ? firstPageNumber
        : `${firstPageNumber}-${lastPageNumber}`;

    if (currentLabel) currentLabel.textContent = pageRange;
    if (liveLabel) {
      const title = artworkPages[firstArtworkIndex].querySelector('.book-artwork-title')?.textContent.trim();
      const artist = artworkPages[firstArtworkIndex].querySelector('.book-artwork-artist')?.textContent.trim().replace(/^by\s+/i, '');
      liveLabel.textContent = title && artist ? `${title} by ${artist}` : title || 'Artwork collection';
    }
  };

  pageFlip.loadFromHTML(pages);
  registerPageCleanup(() => {
    window.clearTimeout(bookPageTimer);
    window.clearTimeout(bookRevealTimer);
    window.clearTimeout(bookCloseTimer);
    window.clearTimeout(bookResetTimer);
    window.removeEventListener('pagehide', clearBookAudioCues);
    clearBookAudioCues();
    try {
      pageFlip.destroy();
    } catch (error) {
    }
    boundFlipbookExperience = null;
  });
  loadNearbyImages(0);
  experience.addEventListener('mousedown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const interactive = target?.closest('a[href], button, form, input, textarea, select, [contenteditable], .book-controls, [data-book-close]');
    if (interactive || event.defaultPrevented) return;
    if (bookOpenState) return;
    openBook();
  }, true);

  pageFlip.on('flip', (event) => {
    loadNearbyImages(event.data);
    updateBookControls(event.data);
    syncBookOpenState(event.data);
  });
  pageFlip.on('changeOrientation', () => updateBookControls());

  closeBookButton?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeBook();
  });

  previousButton?.addEventListener('click', () => {
    playBookCue('page');
    pageFlip.flipPrev();
  });
  nextButton?.addEventListener('click', () => {
    if (!bookOpenState) {
      openBook(true);
      return;
    }
    playBookCue('page');
    pageFlip.flipNext();
  });
  book.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      playBookCue('page');
      pageFlip.flipPrev();
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (!bookOpenState) {
        openBook(true);
      } else {
        playBookCue('page');
        pageFlip.flipNext();
      }
    }
    if (event.key === 'Escape' && bookOpenState) {
      event.preventDefault();
      closeBook();
    }
  });

  updateBookControls(0);
};

const bindArtViewer = () => {
  const viewer = document.querySelector('[data-art-viewer]');
  if (!viewer || typeof viewer.showModal !== 'function') return;

  const viewerImage = viewer.querySelector('[data-viewer-image]');
  const imageStage = viewer.querySelector('.art-viewer-stage');
  const drawnFrame = viewer.querySelector('[data-viewer-frame]');
  const particleLayer = viewer.querySelector('[data-viewer-particles]');
  const titleLabel = viewer.querySelector('[data-viewer-title]');
  const artistLabel = viewer.querySelector('[data-viewer-artist]');
  const descriptionLabel = viewer.querySelector('[data-viewer-description]');
  const dateLabel = viewer.querySelector('[data-viewer-date]');
  const countLabel = viewer.querySelector('[data-viewer-count]');
  const detailLink = viewer.querySelector('[data-viewer-detail]');
  const previousButton = viewer.querySelector('[data-viewer-prev]');
  const nextButton = viewer.querySelector('[data-viewer-next]');
  const closeButton = viewer.querySelector('[data-viewer-close]');
  const zoomButton = viewer.querySelector('[data-viewer-zoom]');
  const fullscreenButton = viewer.querySelector('[data-viewer-fullscreen]');
  const soundButton = viewer.querySelector('[data-viewer-sound]');
  const effectsButton = viewer.querySelector('[data-viewer-effects]');
  const likeForm = viewer.querySelector('[data-viewer-like-form]');
  const likeButton = viewer.querySelector('[data-viewer-like]');
  const likeCountLabel = viewer.querySelector('[data-viewer-like-count]');
  const bookmarkForm = viewer.querySelector('[data-viewer-bookmark-form]');
  const bookmarkButton = viewer.querySelector('[data-viewer-bookmark]');
  const shareButton = viewer.querySelector('[data-viewer-share]');
  const likeLabel = viewer.querySelector('[data-viewer-like-label]');
  const bookmarkLabel = viewer.querySelector('[data-viewer-bookmark-label]');
  const shareLabel = viewer.querySelector('[data-viewer-share-label]');
  const relatedToggle = viewer.querySelector('[data-viewer-related-toggle]');
  const relatedPanel = viewer.querySelector('[data-viewer-related]');
  const relatedList = viewer.querySelector('[data-viewer-related-list]');
  const relatedClose = viewer.querySelector('[data-viewer-related-close]');
  const viewerCaption = viewer.querySelector('.art-viewer-caption');
  let relatedScrollTop = 0;
  const ownerActions = viewer.querySelector('[data-viewer-owner-actions]');
  const editLink = viewer.querySelector('[data-viewer-edit]');
  const deleteForm = viewer.querySelector('[data-viewer-delete-form]');
  const downloadLink = viewer.querySelector('[data-viewer-download]');
  const currentUsername = document.querySelector('meta[name="current-username"]')?.getAttribute('content') || '';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const effectNames = ['portrait', 'sketch', 'digital', 'nature', 'khmer', 'default'];
  const effectParticles = {
    portrait: ['petal', 'flower', 'glow', 'spark'],
    sketch: ['pencil', 'paper', 'graphite', 'sketch-line'],
    digital: ['paint', 'paint-stroke', 'spark', 'glow'],
    nature: ['leaf', 'flower', 'wind', 'glow'],
    khmer: ['gold', 'ornament', 'spark', 'paper'],
    default: ['paper', 'spark', 'glow', 'leaf']
  };
  const audioCues = new Map();
  let artworkRecords = [];
  let activeIndex = 0;
  let activeOpener = null;
  let transitionClone = null;
  let animationTimer = 0;
  let soundTimer = 0;
  let shareTimer = 0;
  let parallaxFrame = 0;
  let frameResizeObserver = null;
  let loadSequence = 0;
  let soundEnabled = localStorage.getItem('artspace-art-sound') === 'on';
  let visualEffectsEnabled = localStorage.getItem('artspace-art-effects') !== 'off';
  let audioContext = null;
  let isZoomed = false;
  let panX = 0;
  let panY = 0;
  let panStart = null;
  let pointerX = 0.5;
  let pointerY = 0.5;

  const setSoundButtonState = () => {
    soundButton?.setAttribute('aria-pressed', String(soundEnabled));
    soundButton?.setAttribute('aria-label', soundEnabled ? 'Mute sound' : 'Enable sound');
    if (soundButton) soundButton.title = soundEnabled ? 'Mute sound' : 'Enable subtle sound';
  };

  const setEffectsButtonState = () => {
    effectsButton?.setAttribute('aria-pressed', String(visualEffectsEnabled));
    effectsButton?.setAttribute('aria-label', visualEffectsEnabled ? 'Disable visual effects' : 'Enable visual effects');
    if (effectsButton) effectsButton.title = visualEffectsEnabled ? 'Disable visual effects' : 'Enable visual effects';
    viewer.classList.toggle('effects-off', !visualEffectsEnabled);
  };

  const setViewerActionLabel = (button, label, text) => {
    if (label) label.textContent = text;
    else if (button) button.textContent = text;
  };

  const resolveEffectPreset = (artwork) => {
    if (effectNames.includes(artwork.effect) && artwork.effect !== 'default') return artwork.effect;
    const metadata = `${artwork.category} ${artwork.tags} ${artwork.title}`.toLowerCase();
    if (/khmer|traditional|ornament/.test(metadata)) return 'khmer';
    if (/portrait|human|figure|character|anime|manga/.test(metadata)) return 'portrait';
    if (/pencil|sketch|graphite|drawing/.test(metadata)) return 'sketch';
    if (/digital|3d art|abstract/.test(metadata)) return 'digital';
    if (/nature|landscape|forest|botanical|flower/.test(metadata)) return 'nature';
    return 'default';
  };

  const updateArtworkFrame = () => {
    if (!drawnFrame || !viewerImage?.naturalWidth || !imageStage) return;
    const stageBounds = imageStage.getBoundingClientRect();
    const scale = Math.min(stageBounds.width / viewerImage.naturalWidth, stageBounds.height / viewerImage.naturalHeight);
    const frameWidth = viewerImage.naturalWidth * scale;
    const frameHeight = viewerImage.naturalHeight * scale;
    drawnFrame.style.width = `${frameWidth}px`;
    drawnFrame.style.height = `${frameHeight}px`;
    drawnFrame.style.left = `${(stageBounds.width - frameWidth) / 2}px`;
    drawnFrame.style.top = `${(stageBounds.height - frameHeight) / 2}px`;
    if (!drawnFrame.classList.contains('is-drawn')) requestAnimationFrame(() => drawnFrame.classList.add('is-drawn'));
  };

  const getArtworkRecords = () => {
    const bookPages = [...document.querySelectorAll('[data-book-page][data-artwork-view]')];
    const otherArtwork = [...document.querySelectorAll('[data-artwork-view][data-artwork-id]')]
      .filter((element) => !element.hasAttribute('data-book-page'));
    const seenIds = new Set();

    return [...bookPages, ...otherArtwork].flatMap((element) => {
      const id = element.dataset.artworkId;
      const fullImage = element.dataset.artworkFull;
      if (!id || !fullImage || seenIds.has(id)) return [];
      seenIds.add(id);
      return [{
        id,
        href: `/art/${encodeURIComponent(id)}`,
        fullImage,
        thumbnail: element.dataset.artworkThumb || '',
        title: element.dataset.artworkTitle || 'Untitled artwork',
        description: element.dataset.artworkDescription || '',
        category: element.dataset.artworkCategory || '',
        tags: element.dataset.artworkTags || '',
        effect: element.dataset.artworkEffect || 'auto',
        artist: element.dataset.artworkArtist || 'ArtSpace artist',
        artistUrl: element.dataset.artworkArtistUrl || '',
        date: element.dataset.artworkDate || '',
        liked: element.dataset.artworkLiked === 'true',
        saved: element.dataset.artworkSaved === 'true',
        likes: Number(element.dataset.artworkLikes || 0)
      }];
    });
  };

  const playSynthSound = (kind) => {
    if (!soundEnabled) return;

    try {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) return;
      if (!audioContext || audioContext.state === 'closed') audioContext = new AudioContextConstructor();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});

      const now = audioContext.currentTime;
      const oscillator = audioContext.createOscillator();
      const volume = audioContext.createGain();
      const soundShape = kind === 'close'
        ? { start: 520, end: 260, duration: 0.28 }
        : kind === 'page'
          ? { start: 330, end: 440, duration: 0.2 }
          : { start: 180, end: 620, duration: 0.5 };

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(soundShape.start, now);
      oscillator.frequency.exponentialRampToValueAtTime(soundShape.end, now + soundShape.duration);
      volume.gain.setValueAtTime(0.0001, now);
      volume.gain.exponentialRampToValueAtTime(kind === 'open' ? 0.022 : 0.014, now + 0.04);
      volume.gain.exponentialRampToValueAtTime(0.0001, now + soundShape.duration);
      oscillator.connect(volume);
      volume.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + soundShape.duration);
    } catch (error) {
      soundEnabled = false;
      localStorage.setItem('artspace-art-sound', 'off');
      setSoundButtonState();
    }
  };

  const playSound = (kind) => {
    if (!soundEnabled) return;
    const cueName = ['open', 'reveal', 'page', 'close'].includes(kind) ? kind : 'open';

    try {
      let cue = audioCues.get(cueName);
      if (!cue) {
        cue = new Audio(`/audio/art-${cueName}.wav`);
        cue.preload = 'none';
        cue.volume = cueName === 'reveal' ? 0.12 : 0.16;
        cue.addEventListener('error', () => cue.dataset.unavailable = 'true', { once: true });
        audioCues.set(cueName, cue);
      }

      if (cue.dataset.unavailable) {
        playSynthSound(cueName);
        return;
      }

      cue.pause();
      cue.currentTime = 0;
      cue.play().catch(() => playSynthSound(cueName));
    } catch (error) {
      playSynthSound(cueName);
    }
  };

  const closeAudio = () => {
    audioCues.forEach((cue) => {
      cue.pause();
      cue.currentTime = 0;
      cue.removeAttribute('src');
      cue.load();
    });
    audioCues.clear();
    if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {});
    audioContext = null;
  };

  const createParticles = (preset) => {
    if (!particleLayer) return;
    particleLayer.replaceChildren();
    if (reducedMotion || !visualEffectsEnabled) return;

    const lowPerf = isLowPerfDevice();
    const lowPower = lowPerf
      || window.matchMedia('(max-width: 640px), (pointer: coarse)').matches
      || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4)
      || navigator.connection?.saveData;
    const particleCount = lowPerf ? 3 : lowPower ? 5 : 9;
    const kinds = effectParticles[preset] || effectParticles.default;

    for (let index = 0; index < particleCount; index += 1) {
      const particle = document.createElement('span');
      const kind = kinds[index % kinds.length];
      particle.className = `art-particle art-particle--${kind}`;
      particle.setAttribute('aria-hidden', 'true');
      particle.style.setProperty('--particle-left', `${Math.round(Math.random() * 100)}%`);
      particle.style.setProperty('--particle-drift', `${Math.round((Math.random() - 0.5) * 28)}vw`);
      particle.style.setProperty('--particle-duration', `${(4.5 + Math.random() * 3.5).toFixed(2)}s`);
      particle.style.setProperty('--particle-delay', `${(index * 110 + Math.random() * 220).toFixed(0)}ms`);
      particle.style.setProperty('--particle-spin', `${Math.round((Math.random() - 0.5) * 540)}deg`);
      particle.style.setProperty('--particle-size', `${(0.72 + Math.random() * 0.72).toFixed(2)}`);
      particleLayer.appendChild(particle);
      particle.addEventListener('animationend', () => particle.remove(), { once: true });
    }
  };

  const updateRelatedWorks = (artwork) => {
    if (!relatedList || !relatedPanel || !relatedToggle) return;
    const matches = [];
    const matchedIndices = new Set();

    artworkRecords.forEach((record, index) => {
      if (record.id === artwork.id) return;
      const score = (record.artist === artwork.artist ? 2 : 0) + (record.category === artwork.category ? 1 : 0);
      if (!score) return;
      const match = { record, index, score };
      const insertAt = matches.findIndex((candidate) => candidate.score < score);
      matches.splice(insertAt < 0 ? matches.length : insertAt, 0, match);
      matchedIndices.add(index);
      if (matches.length > 4) {
        const removed = matches.pop();
        matchedIndices.delete(removed.index);
      }
    });

    for (let index = 0; matches.length < 4 && index < artworkRecords.length; index += 1) {
      if (artworkRecords[index].id === artwork.id || matchedIndices.has(index)) continue;
      matches.push({ record: artworkRecords[index], index, score: 0 });
      matchedIndices.add(index);
    }

    relatedList.replaceChildren();
    matches.forEach(({ record, index }) => {
      const button = document.createElement('button');
      button.className = 'art-viewer-related-item';
      button.type = 'button';
      button.dataset.artworkIndex = String(index);
      button.setAttribute('aria-label', `View ${record.title} by ${record.artist}`);

      const thumbnail = document.createElement('img');
      thumbnail.src = record.thumbnail || record.fullImage;
      thumbnail.alt = '';
      thumbnail.loading = 'lazy';

      const title = document.createElement('span');
      title.textContent = record.title;
      title.setAttribute('data-i18n-skip', '');
      button.append(thumbnail, title);
      relatedList.appendChild(button);
    });

    relatedPanel.hidden = matches.length === 0;
    relatedToggle.disabled = matches.length === 0;
    relatedToggle.setAttribute('aria-expanded', 'false');
    if (matches.length) relatedPanel.hidden = true;
  };

  const updateViewerControls = () => {
    if (countLabel) countLabel.textContent = `${String(activeIndex + 1).padStart(2, '0')} / ${String(artworkRecords.length).padStart(2, '0')}`;
    if (previousButton) previousButton.disabled = activeIndex <= 0;
    if (nextButton) nextButton.disabled = activeIndex >= artworkRecords.length - 1;
  };

  const showArtwork = (index, direction = 0) => {
    if (!artworkRecords.length) return;
    activeIndex = Math.max(0, Math.min(artworkRecords.length - 1, index));
    const artwork = artworkRecords[activeIndex];
    const preset = resolveEffectPreset(artwork);
    const requestId = ++loadSequence;
    const glowColors = {
      portrait: 'rgba(217, 164, 160, 0.3)',
      sketch: 'rgba(207, 199, 183, 0.2)',
      digital: 'rgba(195, 142, 151, 0.28)',
      nature: 'rgba(166, 186, 149, 0.27)',
      khmer: 'rgba(215, 183, 121, 0.32)',
      default: 'rgba(222, 194, 157, 0.22)'
    };

    viewer.classList.remove('is-revealed', 'is-image-missing', 'is-changing-next', 'is-changing-previous', ...effectNames.map((name) => `effect-${name}`));
    viewer.classList.add(`effect-${preset}`);
    viewer.classList.toggle('effects-off', !visualEffectsEnabled);
    viewer.dataset.effect = preset;
    viewer.style.setProperty('--viewer-glow', glowColors[preset]);
    if (direction) viewer.classList.add(direction > 0 ? 'is-changing-next' : 'is-changing-previous');
    viewer.classList.add('is-loading');
    drawnFrame?.classList.remove('is-drawn');
    createParticles(preset);
    updateRelatedWorks(artwork);
    if (viewerImage) {
      viewerImage.alt = artwork.title;
      viewerImage.onload = () => {
        if (requestId !== loadSequence) return;
        viewer.classList.remove('is-changing-next', 'is-changing-previous', 'is-loading');
        viewer.classList.add('is-revealed');
        updateArtworkFrame();
      };
      viewerImage.onerror = () => {
        if (requestId === loadSequence) {
          viewer.classList.remove('is-changing-next', 'is-changing-previous', 'is-loading');
          viewer.classList.add('is-image-missing', 'is-revealed');
          drawnFrame?.classList.remove('is-drawn');
        }
      };
      viewerImage.src = artwork.fullImage;
      if (viewerImage.complete) {
        viewer.classList.remove('is-loading');
        if (viewerImage.naturalWidth) {
          viewer.classList.add('is-revealed');
          updateArtworkFrame();
        }
        else if (viewerImage.getAttribute('src')) viewer.classList.add('is-image-missing', 'is-revealed');
      }
    }

    if (titleLabel) titleLabel.textContent = artwork.title;
    if (artistLabel) {
      artistLabel.textContent = artwork.artist;
      artistLabel.href = artwork.artistUrl || '#';
    }
    if (descriptionLabel) {
      descriptionLabel.textContent = artwork.description;
      descriptionLabel.hidden = !artwork.description;
    }
    if (dateLabel) dateLabel.textContent = artwork.date;
    if (detailLink) detailLink.href = artwork.href;
    const isOwner = Boolean(currentUsername && artwork.artistUrl === `/profile/${currentUsername}`);
    if (ownerActions) ownerActions.hidden = !isOwner;
    if (editLink) editLink.href = `${artwork.href}/edit`;
    if (deleteForm) deleteForm.action = `${artwork.href}/delete`;
    if (downloadLink) downloadLink.href = artwork.fullImage;
    setViewerActionLabel(shareButton, shareLabel, 'Share');
    if (likeForm) likeForm.action = `${artwork.href}/like`;
    if (likeButton) {
      setViewerActionLabel(likeButton, likeLabel, artwork.liked ? 'Unlike' : 'Like');
      likeButton.classList.toggle('active', artwork.liked);
      likeButton.setAttribute('aria-pressed', String(artwork.liked));
    }
    if (likeCountLabel) likeCountLabel.textContent = String(artwork.likes || 0);
    if (bookmarkForm) bookmarkForm.action = `${artwork.href}/bookmark`;
    if (bookmarkButton) {
      setViewerActionLabel(bookmarkButton, bookmarkLabel, artwork.saved ? 'Saved' : 'Save');
      bookmarkButton.classList.toggle('active', artwork.saved);
      bookmarkButton.setAttribute('aria-pressed', String(artwork.saved));
    }
    if (zoomButton) {
      isZoomed = false;
      panX = 0;
      panY = 0;
      viewerImage?.classList.remove('is-zoomed');
      viewerImage?.style.setProperty('--pan-x', '0px');
      viewerImage?.style.setProperty('--pan-y', '0px');
      zoomButton.setAttribute('aria-label', 'Zoom in');
      zoomButton.title = 'Zoom in';
    }
    updateViewerControls();
  };

  const createTransitionClone = (sourceImage, destination) => {
    if (!sourceImage || !destination || reducedMotion) return null;
    const sourceBounds = sourceImage.getBoundingClientRect();
    if (sourceBounds.width < 2 || sourceBounds.height < 2 || !sourceImage.naturalWidth) return null;

    const clone = document.createElement('img');
    clone.className = 'art-transition-clone';
    clone.alt = '';
    clone.src = sourceImage.currentSrc || sourceImage.dataset.src || sourceImage.src;
    clone.style.top = `${sourceBounds.top}px`;
    clone.style.left = `${sourceBounds.left}px`;
    clone.style.width = `${sourceBounds.width}px`;
    clone.style.height = `${sourceBounds.height}px`;
    clone.style.objectFit = getComputedStyle(sourceImage).objectFit || 'cover';
    viewer.appendChild(clone);

    requestAnimationFrame(() => {
      const targetBounds = destination.getBoundingClientRect();
      clone.style.top = `${targetBounds.top}px`;
      clone.style.left = `${targetBounds.left}px`;
      clone.style.width = `${targetBounds.width}px`;
      clone.style.height = `${targetBounds.height}px`;
      clone.style.objectFit = 'contain';
      clone.classList.add('is-expanding');
    });

    return clone;
  };

  const clearViewer = () => {
    window.clearTimeout(animationTimer);
    window.clearTimeout(soundTimer);
    window.clearTimeout(shareTimer);
    if (parallaxFrame) cancelAnimationFrame(parallaxFrame);
    frameResizeObserver?.disconnect();
    frameResizeObserver = null;
    animationTimer = 0;
    soundTimer = 0;
    shareTimer = 0;
    parallaxFrame = 0;
    loadSequence += 1;
    transitionClone?.remove();
    transitionClone = null;
    particleLayer?.replaceChildren();
    viewer.classList.remove('is-open', 'is-revealed', 'is-closing', 'is-changing-next', 'is-changing-previous', 'is-image-missing', 'is-loading', ...effectNames.map((name) => `effect-${name}`));
    viewer.classList.toggle('effects-off', !visualEffectsEnabled);
    viewerImage?.classList.remove('is-zoomed');
    viewerImage?.classList.remove('is-panning');
    if (viewerImage) {
      viewerImage.onload = null;
      viewerImage.onerror = null;
      viewerImage.removeAttribute('src');
      viewerImage.alt = '';
    }
    viewerImage?.style.setProperty('--pan-x', '0px');
    viewerImage?.style.setProperty('--pan-y', '0px');
    panX = 0;
    panY = 0;
    panStart = null;
    relatedPanel.hidden = true;
    relatedToggle?.setAttribute('aria-expanded', 'false');
    relatedScrollTop = 0;
    if (viewerCaption) viewerCaption.scrollTop = 0;
    document.body.classList.remove('art-viewer-open');
    setSoundButtonState();
    setEffectsButtonState();
    closeAudio();
  };

  const closeViewer = () => {
    if (!viewer.open || viewer.classList.contains('is-closing')) return Promise.resolve();
    viewer.classList.add('is-closing');
    playSound('close');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    const sourceImage = activeOpener?.querySelector('img');
    const source = sourceImage?.isConnected ? sourceImage : null;
    const sourceBounds = source?.getBoundingClientRect();
    const imageBounds = viewerImage?.getBoundingClientRect();

    transitionClone?.remove();
    transitionClone = null;
    if (!reducedMotion && sourceBounds?.width > 1 && imageBounds?.width > 1 && viewerImage?.naturalWidth) {
      transitionClone = createTransitionClone(viewerImage, source);
      if (transitionClone) {
        transitionClone.style.top = `${imageBounds.top}px`;
        transitionClone.style.left = `${imageBounds.left}px`;
        transitionClone.style.width = `${imageBounds.width}px`;
        transitionClone.style.height = `${imageBounds.height}px`;
        transitionClone.style.objectFit = 'contain';
        viewerImage.classList.remove('is-revealed');
        requestAnimationFrame(() => {
          transitionClone?.classList.remove('is-expanding');
          transitionClone?.style.setProperty('top', `${sourceBounds.top}px`);
          transitionClone?.style.setProperty('left', `${sourceBounds.left}px`);
          transitionClone?.style.setProperty('width', `${sourceBounds.width}px`);
          transitionClone?.style.setProperty('height', `${sourceBounds.height}px`);
          transitionClone?.style.setProperty('object-fit', getComputedStyle(sourceImage).objectFit || 'cover');
        });
      }
    }

    return new Promise((resolve) => {
      animationTimer = window.setTimeout(() => {
        if (viewer.open) viewer.close();
        clearViewer();
        if (activeOpener?.isConnected) activeOpener.focus({ preventScroll: true });
        activeOpener = null;
        resolve();
      }, reducedMotion ? 0 : 760);
    });
  };

  const openViewer = (record, sourceImage, opener) => {
    artworkRecords = getArtworkRecords();
    activeIndex = Math.max(0, artworkRecords.findIndex((artwork) => artwork.id === record.id));
    activeOpener = opener;
    viewer.classList.remove('is-open', 'is-revealed', 'is-closing', 'is-image-missing');
    document.body.classList.add('art-viewer-open');
    viewer.showModal();
    if (window.ResizeObserver && imageStage) {
      frameResizeObserver = new ResizeObserver(updateArtworkFrame);
      frameResizeObserver.observe(imageStage);
    }
    setSoundButtonState();
    setEffectsButtonState();
    showArtwork(activeIndex);
    playSound(resolveEffectPreset(artworkRecords[activeIndex]) === 'sketch' ? 'page' : 'open');
    soundTimer = window.setTimeout(() => {
      if (viewer.open) playSound('reveal');
    }, reducedMotion ? 0 : 520);
    viewer.focus({ preventScroll: true });

    requestAnimationFrame(() => {
      viewer.classList.add('is-open');
      transitionClone = createTransitionClone(sourceImage, imageStage);
      if (transitionClone) {
        animationTimer = window.setTimeout(() => {
          transitionClone?.remove();
          transitionClone = null;
          viewer.classList.add('is-revealed');
        }, reducedMotion ? 0 : 780);
      } else {
        viewer.classList.add('is-revealed');
      }
    });
  };

  const changeArtwork = (direction) => {
    const nextIndex = activeIndex + direction;
    if (nextIndex < 0 || nextIndex >= artworkRecords.length) return;
    playSound('page');
    showArtwork(nextIndex, direction);
  };

  document.addEventListener('artwork:like-changed', (event) => {
    document.querySelectorAll('[data-artwork-view]').forEach((element) => {
      if (element.dataset.artworkId === event.detail.id) element.dataset.artworkLiked = String(event.detail.liked);
    });
    const artwork = artworkRecords.find((record) => record.id === event.detail.id);
    if (!artwork) return;
    artwork.liked = event.detail.liked;
    artwork.likes = event.detail.likes;
    if (activeIndex === artworkRecords.indexOf(artwork)) {
      if (likeCountLabel) likeCountLabel.textContent = String(artwork.likes);
      if (likeButton) {
        likeButton.setAttribute('aria-pressed', String(artwork.liked));
        setViewerActionLabel(likeButton, likeLabel, artwork.liked ? 'Unlike' : 'Like');
      }
    }
  });

  document.addEventListener('artwork:bookmark-changed', (event) => {
    document.querySelectorAll('[data-artwork-view]').forEach((element) => {
      if (element.dataset.artworkId === event.detail.id) element.dataset.artworkSaved = String(event.detail.saved);
    });
    const artwork = artworkRecords.find((record) => record.id === event.detail.id);
    if (!artwork) return;
    artwork.saved = event.detail.saved;
    if (activeIndex === artworkRecords.indexOf(artwork) && bookmarkButton) {
      setViewerActionLabel(bookmarkButton, bookmarkLabel, artwork.saved ? 'Saved' : 'Save');
      bookmarkButton.classList.toggle('active', artwork.saved);
      bookmarkButton.setAttribute('aria-pressed', String(artwork.saved));
    }
  });

  previousButton?.addEventListener('click', () => changeArtwork(-1));
  nextButton?.addEventListener('click', () => changeArtwork(1));
  closeButton?.addEventListener('click', closeViewer);
  effectsButton?.addEventListener('click', () => {
    visualEffectsEnabled = !visualEffectsEnabled;
    localStorage.setItem('artspace-art-effects', visualEffectsEnabled ? 'on' : 'off');
    setEffectsButtonState();
    if (visualEffectsEnabled) createParticles(viewer.dataset.effect || 'default');
    else particleLayer?.replaceChildren();
  });

  relatedToggle?.addEventListener('click', () => {
    const expanded = relatedToggle.getAttribute('aria-expanded') === 'true';
    relatedToggle.setAttribute('aria-expanded', String(!expanded));
    relatedPanel.hidden = expanded;
    if (!expanded) {
      relatedScrollTop = viewerCaption?.scrollTop || 0;
      relatedPanel.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
      relatedList.querySelector('button')?.focus({ preventScroll: true });
    } else if (viewerCaption) {
      viewerCaption.scrollTop = relatedScrollTop;
    }
  });
  relatedClose?.addEventListener('click', () => {
    relatedPanel.hidden = true;
    relatedToggle?.setAttribute('aria-expanded', 'false');
    if (viewerCaption) viewerCaption.scrollTop = relatedScrollTop;
    relatedToggle?.focus({ preventScroll: true });
  });
  relatedList?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-artwork-index]') : null;
    if (!target) return;
    const index = Number(target.dataset.artworkIndex);
    if (!Number.isInteger(index)) return;
    showArtwork(index, index > activeIndex ? 1 : -1);
  });

  shareButton?.addEventListener('click', async () => {
    const artwork = artworkRecords[activeIndex];
    if (!artwork) return;
    const shareContext = {
      id: artwork.id,
      title: artwork.title,
      text: `${artwork.title} by ${artwork.artist}`,
      url: new URL(artwork.href, window.location.origin).href,
      image: artwork.thumbnail || artwork.fullImage,
      artist: artwork.artist,
      category: artwork.category
    };
    if (openShareDialog(shareContext)) return;

    const shareData = { title: artwork.title, text: shareContext.text, url: shareContext.url };
    try {
      if (navigator.share) await navigator.share(shareData);
      else if (await copyArtworkLink(shareData.url)) {
        setViewerActionLabel(shareButton, shareLabel, 'Copied');
        window.clearTimeout(shareTimer);
        shareTimer = window.setTimeout(() => {
          if (shareButton.isConnected) setViewerActionLabel(shareButton, shareLabel, 'Share');
        }, 1400);
      }
    } catch (error) {
      if (error.name !== 'AbortError') setViewerActionLabel(shareButton, shareLabel, 'Share unavailable');
    }
  });

  imageStage?.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (isZoomed) {
      panStart = { x: event.clientX, y: event.clientY, panX, panY };
      viewerImage?.classList.add('is-panning');
      viewerImage?.setPointerCapture(event.pointerId);
    } else if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      panStart = { x: event.clientX, y: event.clientY, panX: 0, panY: 0, swipe: true };
    }
  });

  imageStage?.addEventListener('pointermove', (event) => {
    if (!panStart || !isZoomed || panStart.swipe) return;
    const bounds = imageStage.getBoundingClientRect();
    panX = Math.max(-bounds.width * 0.38, Math.min(bounds.width * 0.38, panStart.panX + event.clientX - panStart.x));
    panY = Math.max(-bounds.height * 0.38, Math.min(bounds.height * 0.38, panStart.panY + event.clientY - panStart.y));
    viewerImage?.style.setProperty('--pan-x', `${panX}px`);
    viewerImage?.style.setProperty('--pan-y', `${panY}px`);
  });

  imageStage?.addEventListener('pointerup', (event) => {
    if (!panStart) return;
    if (panStart.swipe) {
      const deltaX = event.clientX - panStart.x;
      const deltaY = event.clientY - panStart.y;
      if (Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) changeArtwork(deltaX < 0 ? 1 : -1);
    }
    panStart = null;
    viewerImage?.classList.remove('is-panning');
  });
  imageStage?.addEventListener('pointercancel', () => {
    panStart = null;
    viewerImage?.classList.remove('is-panning');
  });

  viewer.addEventListener('pointermove', (event) => {
    if (reducedMotion || !visualEffectsEnabled || isLowPerfDevice() || event.pointerType === 'touch' || window.matchMedia('(pointer: coarse)').matches) return;
    pointerX = event.clientX / window.innerWidth - 0.5;
    pointerY = event.clientY / window.innerHeight - 0.5;
    if (parallaxFrame) return;
    parallaxFrame = requestAnimationFrame(() => {
      parallaxFrame = 0;
      particleLayer?.querySelectorAll('.art-particle').forEach((particle, index) => {
        const depth = 0.4 + (index % 4) * 0.2;
        particle.style.setProperty('--particle-parallax-x', `${Math.round(pointerX * 28 * depth)}px`);
        particle.style.setProperty('--particle-parallax-y', `${Math.round(pointerY * 18 * depth)}px`);
      });
    });
  });
  viewer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeViewer();
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      changeArtwork(-1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      changeArtwork(1);
    }
  });

  viewer.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeViewer();
  });
  viewer.addEventListener('click', (event) => {
    if (event.target === viewer) closeViewer();
  });

  detailLink?.addEventListener('click', (event) => {
    const destination = detailLink.href;
    event.preventDefault();
    closeViewer().then(() => {
      if (window.ArtSpaceNavigation?.navigate) window.ArtSpaceNavigation.navigate(destination);
      else window.location.assign(destination);
    });
  });

  zoomButton?.addEventListener('click', () => {
    isZoomed = !isZoomed;
    if (!isZoomed) {
      panX = 0;
      panY = 0;
      viewerImage?.style.setProperty('--pan-x', '0px');
      viewerImage?.style.setProperty('--pan-y', '0px');
    }
    viewerImage?.classList.toggle('is-zoomed', isZoomed);
    zoomButton.setAttribute('aria-label', isZoomed ? 'Reset zoom' : 'Zoom in');
    zoomButton.title = isZoomed ? 'Reset zoom' : 'Zoom in';
  });

  fullscreenButton?.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        try {
          await viewer.requestFullscreen();
        } catch (error) {
          await document.documentElement.requestFullscreen();
        }
      }
      const isFullscreen = Boolean(document.fullscreenElement);
      fullscreenButton.setAttribute('aria-label', isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
      fullscreenButton.title = isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen';
    } catch (error) {
      fullscreenButton.disabled = true;
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (!fullscreenButton) return;
    const isFullscreen = Boolean(document.fullscreenElement);
    fullscreenButton.setAttribute('aria-label', isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
    fullscreenButton.title = isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen';
  });

  soundButton?.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem('artspace-art-sound', soundEnabled ? 'on' : 'off');
    if (!soundEnabled) closeAudio();
    if (soundEnabled) playSound('page');
    setSoundButtonState();
  });

  viewer.addEventListener('close', clearViewer);
};

if (toggleButton) {
  toggleButton.addEventListener('click', () => {
    const nextTheme = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(nextTheme);
  });
}

bindArtViewer();

const initStudioDashboard = () => {
  const studioDashboard = document.querySelector('[data-studio-dashboard]');
  if (!studioDashboard) return;

  const studioCollectionDialog = document.querySelector('[data-collection-dialog]');
  const studioMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const studioSoundStorageKey = 'artspace-pencil-sound';
  const studioSoundButton = studioDashboard.querySelector('[data-pencil-sound]');
  const studioSoundState = studioDashboard.querySelector('[data-pencil-sound-state]');
  let studioSoundEnabled = localStorage.getItem(studioSoundStorageKey) === 'on';
  let studioAudioContext = null;
  let studioLastStroke = 0;

  const prepareStudioDoodles = (scope) => {
    scope?.querySelectorAll('[data-doodle] path, .studio-art-frame-line path').forEach((path) => {
      if (!path.hasAttribute('pathLength')) path.setAttribute('pathLength', '1');
    });
  };

  const setStudioSection = (sectionId) => {
    if (!sectionId) return;
    studioDashboard.querySelectorAll('[data-studio-nav]').forEach((link) => {
      link.classList.toggle('is-active', link.dataset.studioNav === sectionId);
    });
  };

  const studioNavLinks = Array.from(studioDashboard.querySelectorAll('[data-studio-nav]'));
  const studioSections = studioNavLinks
    .map((link) => document.getElementById(link.dataset.studioNav))
    .filter(Boolean);
  let studioScrollFrame = null;

  const updateStudioSectionFromScroll = () => {
    studioScrollFrame = null;
    if (!studioSections.length) return;
    const marker = window.scrollY + 170;
    let currentSection = studioSections[0];

    studioSections.forEach((section) => {
      const sectionTop = section.getBoundingClientRect().top + window.scrollY;
      if (sectionTop <= marker) currentSection = section;
    });

    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
      currentSection = studioSections[studioSections.length - 1];
    }

    setStudioSection(currentSection.id);
  };

  const requestStudioSectionUpdate = () => {
    if (studioScrollFrame !== null) return;
    studioScrollFrame = window.requestAnimationFrame(updateStudioSectionFromScroll);
  };

  studioNavLinks.forEach((link) => {
    link.addEventListener('click', () => setStudioSection(link.dataset.studioNav));
  });

  window.addEventListener('scroll', requestStudioSectionUpdate, { passive: true });
  window.addEventListener('resize', requestStudioSectionUpdate);
  updateStudioSectionFromScroll();

  const studioRevealTargets = [
    ...studioDashboard.querySelectorAll('[data-doodle], .studio-art-card, .studio-stat-card, .studio-quick-card'),
    ...(studioCollectionDialog ? studioCollectionDialog.querySelectorAll('[data-doodle]') : [])
  ];

  prepareStudioDoodles(studioDashboard);
  prepareStudioDoodles(studioCollectionDialog);

  if (!studioMotionQuery.matches && 'IntersectionObserver' in window) {
    const studioRevealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        studioRevealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -4% 0px' });
    registerPageCleanup(() => studioRevealObserver.disconnect());

    studioDashboard.classList.add('is-enhanced');
    studioCollectionDialog?.classList.add('is-enhanced');
    studioRevealTargets.forEach((target) => studioRevealObserver.observe(target));
  } else {
    studioRevealTargets.forEach((target) => target.classList.add('is-visible'));
  }

  if (studioCollectionDialog) {
    const openStudioCollectionDialog = () => {
      if (typeof studioCollectionDialog.showModal === 'function') {
        if (!studioCollectionDialog.open) studioCollectionDialog.showModal();
      } else {
        studioCollectionDialog.setAttribute('open', '');
      }
      document.body.classList.add('studio-dialog-open');
      window.setTimeout(() => {
        studioCollectionDialog.querySelector('#collection-name')?.focus();
      }, 80);
    };

    const closeStudioCollectionDialog = () => {
      if (typeof studioCollectionDialog.close === 'function') {
        studioCollectionDialog.close();
      } else {
        studioCollectionDialog.removeAttribute('open');
        document.body.classList.remove('studio-dialog-open');
      }
    };

    document.querySelectorAll('[data-open-collection]').forEach((button) => {
      button.addEventListener('click', openStudioCollectionDialog);
    });

    studioCollectionDialog.querySelectorAll('[data-close-collection]').forEach((button) => {
      button.addEventListener('click', closeStudioCollectionDialog);
    });

    studioCollectionDialog.addEventListener('click', (event) => {
      if (event.target === studioCollectionDialog) closeStudioCollectionDialog();
    });

    studioCollectionDialog.addEventListener('close', () => {
      document.body.classList.remove('studio-dialog-open');
    });
  }

  const getStudioAudioContext = () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!studioAudioContext) studioAudioContext = new AudioContextClass();
    if (studioAudioContext.state === 'suspended') studioAudioContext.resume();
    return studioAudioContext;
  };

  const playStudioPencilStroke = () => {
    if (!studioSoundEnabled) return;
    const now = window.performance.now();
    if (now - studioLastStroke < 60) return;
    studioLastStroke = now;

    const audioContext = getStudioAudioContext();
    if (!audioContext) return;

    const duration = 0.1;
    const buffer = audioContext.createBuffer(1, Math.floor(audioContext.sampleRate * duration), audioContext.sampleRate);
    const channel = buffer.getChannelData(0);

    for (let index = 0; index < channel.length; index += 1) {
      const progress = index / channel.length;
      channel[index] = (Math.random() * 2 - 1) * (1 - progress) * 0.16;
    }

    const source = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.value = 1400 + Math.random() * 1100;
    filter.Q.value = 0.9;
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, audioContext.currentTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    source.connect(filter).connect(gain).connect(audioContext.destination);
    source.start();
  };

  const setStudioSoundState = () => {
    if (!studioSoundButton) return;
    studioSoundButton.setAttribute('aria-pressed', studioSoundEnabled ? 'true' : 'false');
    studioSoundButton.title = studioSoundEnabled ? 'Disable pencil sounds' : 'Enable pencil sounds';
    if (studioSoundState) studioSoundState.textContent = studioSoundEnabled ? 'On' : 'Off';
  };

  setStudioSoundState();

  studioSoundButton?.addEventListener('click', () => {
    studioSoundEnabled = !studioSoundEnabled;
    localStorage.setItem(studioSoundStorageKey, studioSoundEnabled ? 'on' : 'off');
    setStudioSoundState();
    if (studioSoundEnabled) {
      getStudioAudioContext();
      playStudioPencilStroke();
    }
  });

  [studioDashboard, studioCollectionDialog].forEach((scope) => {
    scope?.addEventListener('pointerdown', (event) => {
      if (event.target instanceof Element && event.target.closest('a, button')) {
        playStudioPencilStroke();
      }
    }, { passive: true });
  });

  registerPageCleanup(() => {
    window.removeEventListener('scroll', requestStudioSectionUpdate);
    window.removeEventListener('resize', requestStudioSectionUpdate);
    if (studioScrollFrame !== null) window.cancelAnimationFrame(studioScrollFrame);
    if (studioAudioContext && studioAudioContext.state !== 'closed') studioAudioContext.close().catch(() => {});
  });
};

const initUploadPage = () => {
  const uploadPage = document.querySelector('[data-upload-studio]');
  if (!uploadPage) return;

  const form = uploadPage.querySelector('[data-upload-form]');
  const dropzone = uploadPage.querySelector('[data-upload-dropzone]');
  const fileInput = uploadPage.querySelector('#images');
  const emptyState = uploadPage.querySelector('[data-upload-empty]');
  const mediaGrid = uploadPage.querySelector('[data-media-grid]');
  const addMore = uploadPage.querySelector('[data-add-more]');
  const addMoreTrigger = uploadPage.querySelector('[data-add-more-trigger]');
  const fileError = uploadPage.querySelector('[data-upload-error]');
  const formError = uploadPage.querySelector('[data-upload-form-error]');
  const formErrorText = uploadPage.querySelector('[data-upload-form-error-text]');
  const dismissError = uploadPage.querySelector('[data-upload-dismiss-error]');
  const titleInput = uploadPage.querySelector('#title');
  const descriptionInput = uploadPage.querySelector('#description');
  const categoryInput = uploadPage.querySelector('#category');
  const coverIndexInput = uploadPage.querySelector('[data-cover-index]');
  const publishButton = uploadPage.querySelector('[data-upload-publish]');
  const publishLabel = uploadPage.querySelector('[data-upload-publish-label]');
  const draftButton = uploadPage.querySelector('[data-upload-draft]');
  const readiness = uploadPage.querySelector('[data-upload-readiness]');
  const progressPanel = uploadPage.querySelector('[data-upload-progress]');
  const progressPercent = uploadPage.querySelector('[data-upload-progress-percent]');
  const progressLine = uploadPage.querySelector('[data-upload-progress-line]');
  const progressTrack = uploadPage.querySelector('[data-upload-progress-track]');
  const progressLabel = uploadPage.querySelector('[data-upload-progress-label]');
  const progressDetail = uploadPage.querySelector('[data-upload-progress-detail]');
  const progressKicker = uploadPage.querySelector('[data-upload-progress-kicker]');
  const successPanel = uploadPage.querySelector('[data-upload-success]');
  const successImage = uploadPage.querySelector('[data-upload-success-image]');
  const successTitle = uploadPage.querySelector('[data-upload-success-title]');
  const successNote = uploadPage.querySelector('[data-upload-success-note]');
  const successView = uploadPage.querySelector('[data-upload-success-view]');
  const maxFileSize = 8 * 1024 * 1024;
  const maxFiles = 6;
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const allowedExtension = /\.(jpe?g|png|webp)$/i;
  let items = [];
  let coverUid = null;
  let uidCounter = 0;
  let isUploading = false;
  let uploadMode = 'publish';
  let activeRequest = null;
  let dragDepth = 0;
  let dragTileUid = null;

  if (!form || !dropzone || !fileInput || !publishButton || !draftButton) return;

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const clearFileError = () => {
    if (!fileError) return;
    fileError.hidden = true;
    fileError.textContent = '';
    dropzone.removeAttribute('aria-invalid');
  };

  const showFileError = (message) => {
    if (!fileError) return;
    fileError.textContent = message;
    fileError.hidden = false;
    dropzone.setAttribute('aria-invalid', 'true');
  };

  const clearFormError = () => {
    if (!formError) return;
    formError.hidden = true;
    if (formErrorText) formErrorText.textContent = '';
  };

  const showFormError = (message, scrollToError = true) => {
    if (!formError || !formErrorText) return;
    formErrorText.textContent = message;
    formError.hidden = false;
    if (scrollToError) {
      formError.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const getReadinessMessage = () => {
    const missing = [];
    if (items.length === 0) missing.push('a drawing');
    if (!titleInput?.value.trim()) missing.push('a title');
    if (!categoryInput?.value) missing.push('a category');
    if (missing.length === 0) return 'Ready when you are. Publish this page to your collection.';
    if (missing.length === 1) return `Add ${missing[0]} to finish this page.`;
    if (missing.length === 2) return `Add ${missing[0]} and ${missing[1]} to finish this page.`;
    return `Add ${missing[0]}, ${missing[1]}, and ${missing[2]} to finish this page.`;
  };

  const updateReadiness = () => {
    const ready = items.length > 0 && Boolean(titleInput?.value.trim() && categoryInput?.value);
    publishButton.disabled = !ready || isUploading;
    draftButton.disabled = !ready || isUploading;
    if (readiness) {
      readiness.textContent = isUploading ? 'Your page is being pressed into the gallery…' : getReadinessMessage();
      readiness.classList.toggle('is-ready', ready && !isUploading);
    }
  };

  const resetProgress = () => {
    if (!progressPanel) return;
    progressPanel.classList.remove('is-complete', 'is-processing');
    if (progressPercent) progressPercent.textContent = '0%';
    if (progressLine) progressLine.style.strokeDashoffset = '100';
    if (progressTrack) progressTrack.style.setProperty('--upload-progress', '0%');
    if (progressLabel) progressLabel.textContent = 'Uploading your page…';
    if (progressDetail) progressDetail.textContent = 'Keep this page open while the ink dries.';
    if (progressKicker) progressKicker.textContent = 'Pressing pencil to paper';
  };

  const setProgress = (value) => {
    const percent = Math.max(0, Math.min(100, Math.round(value)));
    if (progressPercent) progressPercent.textContent = `${percent}%`;
    if (progressLine) progressLine.style.strokeDashoffset = String(100 - percent);
    if (progressTrack) progressTrack.style.setProperty('--upload-progress', `${percent}%`);

    if (percent >= 100) {
      progressPanel?.classList.add('is-processing');
      if (progressKicker) progressKicker.textContent = 'Drying the ink';
      if (progressLabel) progressLabel.textContent = 'Finishing your gallery page…';
      if (progressDetail) progressDetail.textContent = 'Your drawing arrived. We are pressing it into its final page shape.';
      return;
    }

    if (percent > 0) {
      if (progressDetail) progressDetail.textContent = 'Sending your drawing to the studio…';
    }
  };

  const revokeItemPreview = (item) => {
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
      item.previewUrl = '';
    }
  };

  const setCover = (uid) => {
    if (!items.some((item) => item.uid === uid)) return;
    coverUid = uid;
    renderMedia();
  };

  const removeItem = (uid) => {
    const index = items.findIndex((item) => item.uid === uid);
    if (index === -1) return;
    revokeItemPreview(items[index]);
    items.splice(index, 1);
    if (coverUid === uid) {
      coverUid = items.length ? items[0].uid : null;
    }
    clearFileError();
    renderMedia();
  };

  const moveItem = (uid, direction) => {
    const index = items.findIndex((item) => item.uid === uid);
    if (index === -1) return;
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const [moved] = items.splice(index, 1);
    items.splice(target, 0, moved);
    renderMedia();
  };

  const createMediaTile = (item, index) => {
    const tile = document.createElement('div');
    tile.className = 'studio-media-tile';
    tile.draggable = true;
    tile.dataset.tileUid = String(item.uid);
    if (item.uid === coverUid) tile.classList.add('is-cover');

    const thumb = document.createElement('div');
    thumb.className = 'studio-media-thumb';

    const image = document.createElement('img');
    image.src = item.previewUrl;
    image.alt = `Page ${index + 1} preview`;
    image.decoding = 'async';
    image.draggable = false;

    const order = document.createElement('span');
    order.className = 'studio-media-order';
    order.textContent = String(index + 1);

    const coverBadge = document.createElement('span');
    coverBadge.className = 'studio-media-cover-badge';
    coverBadge.textContent = 'Cover';

    thumb.append(image, order, coverBadge);

    const meta = document.createElement('div');
    meta.className = 'studio-media-meta';

    const name = document.createElement('strong');
    name.textContent = item.file.name;

    const size = document.createElement('em');
    size.textContent = `${formatFileSize(item.file.size)} · ${(item.file.type || 'image').replace('image/', '').toUpperCase()}`;

    meta.append(name, size);

    const actions = document.createElement('div');
    actions.className = 'studio-media-actions';

    const iconButtons = [
      { action: 'cover', title: item.uid === coverUid ? 'This is the cover page' : 'Set as cover page', icon: 'M12 2l2.9 6.3 6.9.6-5.2 4.6 1.5 6.8L12 16.9 5.9 20.3l1.5-6.8L2.2 8.9l6.9-.6Z', disabled: item.uid === coverUid },
      { action: 'edit', title: 'Edit this page', icon: 'M4 20l1.2-4.2L14.5 6.5a2.12 2.12 0 0 1 3 3L8.2 18.8 4 20Z' },
      { action: 'up', title: 'Move up', icon: 'm6 14 6-6 6 6', disabled: index === 0 },
      { action: 'down', title: 'Move down', icon: 'm6 10 6 6 6-6', disabled: index === items.length - 1 },
      { action: 'remove', title: 'Remove this page', icon: 'M5 7h14M9 7V5c0-1 .6-1.5 1.5-1.5h3C14.4 3.5 15 4 15 5v2M7 7l1 13h8l1-13M10 10v7M14 10v7', danger: true }
    ];

    iconButtons.forEach((config) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `studio-media-btn${config.danger ? ' is-danger' : ''}`;
      button.dataset.tileAction = config.action;
      button.title = config.title;
      button.setAttribute('aria-label', config.title);
      if (config.disabled) button.disabled = true;
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${config.icon}" /></svg>`;
      actions.append(button);
    });

    tile.append(thumb, meta, actions);
    return tile;
  };

  const renderMedia = () => {
    const hasItems = items.length > 0;
    if (emptyState) emptyState.hidden = hasItems;
    if (mediaGrid) {
      mediaGrid.hidden = !hasItems;
      if (hasItems) {
        mediaGrid.replaceChildren(...items.map((item, index) => createMediaTile(item, index)));
      } else {
        mediaGrid.replaceChildren();
      }
    }
    if (addMore) addMore.hidden = !hasItems;
    dropzone.classList.toggle('has-file', hasItems);
    if (coverIndexInput) {
      const coverIndex = items.findIndex((item) => item.uid === coverUid);
      coverIndexInput.value = String(coverIndex >= 0 ? coverIndex : 0);
    }
    updateReadiness();
  };

  const validateFile = (file) => {
    if (!(allowedTypes.has(file.type) || allowedExtension.test(file.name))) {
      return 'That file is not a JPG, PNG, or WEBP image. Choose one of those formats.';
    }
    if (file.size > maxFileSize) {
      return 'That image is larger than 8 MB. Please choose a smaller file.';
    }
    if (file.size === 0) {
      return 'That image appears to be empty. Please choose another file.';
    }
    return '';
  };

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length || isUploading) return;

    let rejected = '';

    for (const file of incoming) {
      if (items.length >= maxFiles) {
        rejected = 'You can add up to 6 images per artwork.';
        break;
      }

      const message = validateFile(file);
      if (message) {
        rejected = rejected || message;
        continue;
      }

      const duplicate = items.some((item) => (
        item.sourceFile.name === file.name && item.sourceFile.size === file.size
      ));
      if (duplicate) {
        rejected = rejected || 'That image is already in your artwork.';
        continue;
      }

      items.push({
        uid: ++uidCounter,
        file,
        sourceFile: file,
        previewUrl: URL.createObjectURL(file),
        edited: false
      });
    }

    if (rejected) showFileError(rejected);
    if (items.length && coverUid === null) coverUid = items[0].uid;
    fileInput.value = '';
    renderMedia();
  };

  const editTileFile = async (uid) => {
    const item = items.find((candidate) => candidate.uid === uid);
    if (!item) return;

    try {
      const edited = await openArtworkEditor(item.sourceFile || item.file);
      if (!edited || !items.some((candidate) => candidate.uid === uid)) return;
      revokeItemPreview(item);
      item.file = edited;
      item.edited = true;
      item.previewUrl = URL.createObjectURL(edited);
      renderMedia();
    } catch (error) {
      showFileError(error.userMessage || 'The artwork studio could not open on this device. Your original image will be used.');
    }
  };

  const openArtworkEditor = async (file) => {
    try {
      const editor = await loadImageEditorModule();
      return await editor.open({ file, mode: 'artwork', maxBytes: maxFileSize });
    } catch (error) {
      showFileError(error.userMessage || 'The artwork studio could not open on this device. Your original image will be used.');
      return file;
    }
  };

  const restoreActions = () => {
    isUploading = false;
    activeRequest = null;
    window.__artspaceUploading = false;
    form.removeAttribute('aria-busy');
    publishButton.classList.remove('is-loading');
    if (publishLabel) publishLabel.textContent = 'Publish Artwork';
    draftButton.textContent = 'Save as draft';
    updateReadiness();
  };

  const showUploadError = (message) => {
    restoreActions();
    if (progressPanel) progressPanel.hidden = true;
    resetProgress();
    showFormError(message);
  };

  const showSuccess = (payload) => {
    isUploading = false;
    activeRequest = null;
    window.__artspaceUploading = false;
    form.removeAttribute('aria-busy');
    publishButton.classList.remove('is-loading');
    if (progressPercent) progressPercent.textContent = '100%';
    if (progressLine) progressLine.style.strokeDashoffset = '0';
    if (progressTrack) progressTrack.style.setProperty('--upload-progress', '100%');
    progressPanel?.classList.remove('is-processing');
    progressPanel?.classList.add('is-complete');
    if (progressKicker) progressKicker.textContent = 'Page published';
    if (progressLabel) progressLabel.textContent = 'Your page is safe in the collection.';
    if (progressDetail) progressDetail.textContent = 'The ink is dry.';

    const wasDraft = Boolean(payload?.isDraft);
    const isPrivate = Boolean(payload?.isPrivate);
    const isHidden = wasDraft || isPrivate;

    if (successTitle) {
      successTitle.textContent = wasDraft
        ? 'Your draft is tucked safely into your collection!'
        : isPrivate
          ? 'Your artwork is saved in your private collection!'
          : 'Your artwork has been added to your collection!';
    }
    if (successNote) {
      successNote.textContent = wasDraft
        ? 'Only you can see it until you are ready to publish.'
        : isPrivate
          ? 'Only you can see it until you choose to share it.'
          : 'It is added to your gallery and ready for the world to see.';
    }
    if (successImage && payload?.artworkImageUrl) {
      successImage.src = payload.artworkImageUrl;
      successImage.alt = wasDraft
        ? 'Your saved draft artwork'
        : isPrivate
          ? 'Your privately saved artwork'
          : 'Your newly published artwork';
    }
    if (successView) {
      successView.href = isHidden
        ? (payload?.artworkEditUrl || '/dashboard')
        : (payload?.artworkUrl || '/dashboard');
      successView.textContent = wasDraft ? 'View Draft' : isPrivate ? 'View in Studio' : 'View Artwork';
    }

    window.setTimeout(() => {
      form.hidden = true;
      if (successPanel) {
        successPanel.hidden = false;
        successPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        successTitle?.focus({ preventScroll: true });
      }
    }, 380);
  };

  const startUpload = (mode) => {
    if (isUploading) return;

    if (items.length === 0) {
      showFileError('Add an image of your artwork before publishing.');
      dropzone.focus();
      return;
    }

    if (!titleInput?.value.trim()) {
      showFormError('Give your artwork a title before publishing.');
      titleInput?.focus();
      return;
    }

    if (!categoryInput?.value) {
      showFormError('Choose a category for your artwork.');
      categoryInput?.focus();
      return;
    }

    clearFileError();
    clearFormError();
    isUploading = true;
    window.__artspaceUploading = true;
    uploadMode = mode;
    form.setAttribute('aria-busy', 'true');
    publishButton.disabled = true;
    draftButton.disabled = true;
    if (progressPanel) progressPanel.hidden = false;
    resetProgress();
    setProgress(0);

    if (mode === 'draft') {
      draftButton.textContent = 'Saving…';
    } else {
      publishButton.classList.add('is-loading');
      if (publishLabel) publishLabel.textContent = 'Publishing…';
    }
    updateReadiness();

    const formData = new FormData(form);
    formData.delete('images');
    items.forEach((item) => formData.append('images', item.file, item.file.name));
    const coverIndex = items.findIndex((item) => item.uid === coverUid);
    formData.set('cover_index', String(coverIndex >= 0 ? coverIndex : 0));
    formData.delete('save_as_draft');
    if (uploadMode === 'draft') formData.append('save_as_draft', 'on');

    const xhr = new XMLHttpRequest();
    activeRequest = xhr;
    xhr.open('POST', form.getAttribute('action') || '/upload', true);
    xhr.timeout = 120000;
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.setRequestHeader('Accept', 'application/json');

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      setProgress((event.loaded / event.total) * 100);
    });

    xhr.upload.addEventListener('load', () => {
      setProgress(100);
    });

    xhr.addEventListener('load', () => {
      let payload = null;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch (error) {
        payload = null;
      }

      if (xhr.status >= 200 && xhr.status < 300 && payload?.ok) {
        showSuccess(payload);
        return;
      }

      showUploadError(payload?.error || 'We could not publish this page. Please try again.');
    });

    xhr.addEventListener('error', () => {
      showUploadError('The upload lost its connection. Check your connection and try again.');
    });

    xhr.addEventListener('timeout', () => {
      showUploadError('This upload took too long. Please try again with a smaller image.');
    });

    xhr.send(formData);
  };

  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
  });

  dropzone.addEventListener('click', (event) => {
    if (isUploading) return;
    if (event.target instanceof Element && event.target.closest('button, label, input')) return;
    fileInput.click();
  });

  dropzone.addEventListener('keydown', (event) => {
    if (isUploading) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target instanceof Element && event.target.closest('button, input')) return;
    event.preventDefault();
    fileInput.click();
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (isUploading) return;
      if (event.dataTransfer && !Array.from(event.dataTransfer.types || []).includes('Files')) return;
      if (eventName === 'dragenter') dragDepth += 1;
      dropzone.classList.add('is-dragging');
    });
  });

  dropzone.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropzone.classList.remove('is-dragging');
  });

  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove('is-dragging');
    if (dragTileUid !== null) {
      dragTileUid = null;
      return;
    }
    addFiles(event.dataTransfer?.files);
  });

  if (mediaGrid) {
    mediaGrid.addEventListener('click', async (event) => {
      if (isUploading) return;
      const button = event.target instanceof Element ? event.target.closest('[data-tile-action]') : null;
      if (!button) return;
      const tile = button.closest('[data-tile-uid]');
      if (!tile) return;

      const uid = Number(tile.dataset.tileUid);
      const action = button.dataset.tileAction;

      if (action === 'cover') setCover(uid);
      else if (action === 'up') moveItem(uid, -1);
      else if (action === 'down') moveItem(uid, 1);
      else if (action === 'remove') removeItem(uid);
      else if (action === 'edit') await editTileFile(uid);
    });

    mediaGrid.addEventListener('dragstart', (event) => {
      if (isUploading) {
        event.preventDefault();
        return;
      }
      const tile = event.target instanceof Element ? event.target.closest('[data-tile-uid]') : null;
      if (!tile) return;
      dragTileUid = Number(tile.dataset.tileUid);
      tile.classList.add('is-dragging');
      try {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(dragTileUid));
      } catch (error) {
        /* older browsers */
      }
    });

    mediaGrid.addEventListener('dragover', (event) => {
      if (dragTileUid === null) return;
      event.preventDefault();
      try {
        event.dataTransfer.dropEffect = 'move';
      } catch (error) {
        /* older browsers */
      }
      const tile = event.target instanceof Element ? event.target.closest('[data-tile-uid]') : null;
      mediaGrid.querySelectorAll('.is-drop-target').forEach((node) => node.classList.remove('is-drop-target'));
      if (tile && Number(tile.dataset.tileUid) !== dragTileUid) tile.classList.add('is-drop-target');
    });

    mediaGrid.addEventListener('drop', (event) => {
      if (dragTileUid === null) return;
      event.preventDefault();
      event.stopPropagation();
      const tile = event.target instanceof Element ? event.target.closest('[data-tile-uid]') : null;
      const fromIndex = items.findIndex((item) => item.uid === dragTileUid);
      const targetIndex = tile ? items.findIndex((item) => item.uid === Number(tile.dataset.tileUid)) : -1;
      dragTileUid = null;
      if (fromIndex === -1 || targetIndex === -1) {
        renderMedia();
        return;
      }
      const [moved] = items.splice(fromIndex, 1);
      let insertIndex = targetIndex;
      if (fromIndex < targetIndex) insertIndex -= 1;
      items.splice(insertIndex, 0, moved);
      renderMedia();
    });

    mediaGrid.addEventListener('dragend', () => {
      dragTileUid = null;
      mediaGrid.querySelectorAll('.is-dragging, .is-drop-target').forEach((node) => node.classList.remove('is-dragging', 'is-drop-target'));
    });
  }

  addMoreTrigger?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!isUploading) fileInput.click();
  });

  dismissError?.addEventListener('click', clearFormError);
  titleInput?.addEventListener('input', updateReadiness);
  categoryInput?.addEventListener('change', updateReadiness);
  descriptionInput?.addEventListener('input', () => autoResizeTextarea(descriptionInput));
  autoResizeTextarea(descriptionInput);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (isUploading) return;
    const isDraft = event.submitter === draftButton;
    startUpload(isDraft ? 'draft' : 'publish');
  });

  const handleUploadBeforeUnload = (event) => {
    if (!isUploading) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', handleUploadBeforeUnload);
  registerPageCleanup(() => {
    window.removeEventListener('beforeunload', handleUploadBeforeUnload);
    if (activeRequest && typeof activeRequest.abort === 'function') activeRequest.abort();
    items.forEach(revokeItemPreview);
    window.__artspaceUploading = false;
  });

  if (fileError) fileError.hidden = true;
  if (progressPanel) progressPanel.hidden = true;
  renderMedia();
};

const createJourneySound = () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  const STORAGE_KEY = 'artspace-journey-sound';
  let context = null;
  let noiseBuffer = null;
  let scratchSource = null;
  let scratchGain = null;
  let scratchStopTimer = 0;
  let lastTapAt = 0;
  let enabled = false;
  let destroyed = false;

  try {
    enabled = window.localStorage.getItem(STORAGE_KEY) === 'on';
  } catch (error) {
    enabled = false;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'journey-sound';
  button.setAttribute('aria-pressed', 'false');
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4Z" /><path class="journey-sound-waves" d="M16 9a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12" /><path class="journey-sound-mute" d="m16.5 9.5 5 5m0-5-5 5" /></svg><span data-journey-sound-label>Sound off</span>';
  document.body.appendChild(button);

  const label = button.querySelector('[data-journey-sound-label]');

  const updateButton = () => {
    button.classList.toggle('is-on', enabled);
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', enabled ? 'Disable pencil sound' : 'Enable pencil sound');
    button.title = enabled ? 'Disable pencil sound' : 'Enable pencil sound';
    if (label) label.textContent = enabled ? 'Sound on' : 'Sound off';
  };

  const ensureContext = () => {
    if (destroyed) return null;
    if (!context) {
      try {
        context = new AudioContextClass();
        const length = Math.max(1, Math.floor(context.sampleRate * 1.2));
        noiseBuffer = context.createBuffer(1, length, context.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;

        scratchSource = context.createBufferSource();
        scratchSource.buffer = noiseBuffer;
        scratchSource.loop = true;

        const highpass = context.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 450;

        const bandpass = context.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = 1850;
        bandpass.Q.value = 0.8;

        scratchGain = context.createGain();
        scratchGain.gain.value = 0;
        scratchSource.connect(highpass).connect(bandpass).connect(scratchGain).connect(context.destination);
        scratchSource.start();
      } catch (error) {
        context = null;
        return null;
      }
    }
    if (context.state === 'suspended') context.resume().catch(() => {});
    return context;
  };

  const stopScratch = (immediate = false) => {
    if (scratchStopTimer) {
      window.clearTimeout(scratchStopTimer);
      scratchStopTimer = 0;
    }
    if (!scratchGain || !context) return;
    const now = context.currentTime;
    scratchGain.gain.cancelScheduledValues(now);
    scratchGain.gain.setTargetAtTime(0, now, immediate ? 0.03 : 0.12);
  };

  const startScratch = () => {
    if (!enabled || destroyed || document.hidden) return;
    const ctx = ensureContext();
    if (!ctx || !scratchGain) return;
    const now = ctx.currentTime;
    scratchGain.gain.cancelScheduledValues(now);
    scratchGain.gain.setTargetAtTime(0.16, now, 0.06);
    if (scratchStopTimer) window.clearTimeout(scratchStopTimer);
    scratchStopTimer = window.setTimeout(() => {
      scratchStopTimer = 0;
      stopScratch();
    }, 180);
  };

  const tap = () => {
    if (!enabled || destroyed || document.hidden) return;
    const ctx = ensureContext();
    if (!ctx || !noiseBuffer) return;
    const nowMs = performance.now();
    if (nowMs - lastTapAt < 120) return;
    lastTapAt = nowMs;

    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1150;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(now);
    source.stop(now + 0.16);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, now);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.0001, now);
    oscGain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  };

  const setVisible = (visible) => {
    button.classList.toggle('is-visible', Boolean(visible) && !destroyed);
    if (!visible) stopScratch(true);
  };

  const onButtonClick = () => {
    enabled = !enabled;
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    } catch (error) {}
    if (enabled) ensureContext();
    else stopScratch(true);
    updateButton();
  };

  const onVisibilityChange = () => {
    if (document.hidden) stopScratch(true);
  };

  button.addEventListener('click', onButtonClick);
  document.addEventListener('visibilitychange', onVisibilityChange);

  if (enabled) {
    const unlock = () => {
      ensureContext();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true, passive: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  updateButton();

  return {
    setVisible,
    startScratch,
    stopScratch,
    tap,
    destroy() {
      destroyed = true;
      if (scratchStopTimer) window.clearTimeout(scratchStopTimer);
      button.removeEventListener('click', onButtonClick);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      button.remove();
      try { scratchSource?.stop(); } catch (error) {}
      try { context?.close(); } catch (error) {}
      context = null;
    }
  };
};

const createSketchJourney = (scope, options = {}) => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const containerSelector = options.containerSelector || '[data-explore-masonry]';
  const cardSelector = options.cardSelector || '[data-explore-card]';
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clamp01 = (value) => Math.max(0, Math.min(1, value));

  let container = null;
  let svg = null;
  let cards = [];
  let segments = [];
  let revealedIds = new Set();
  let resizeObserver = null;
  let mutationObserver = null;
  let intersectionObserver = null;
  let reducedMotionListener = null;
  let listeners = null;
  let frame = 0;
  let updateFrame = 0;
  let fallbackTimer = 0;
  let signature = '';
  let hoveredIndex = -1;
  let destroyed = false;
  let currentColumns = 3;
  let reducedMotion = reducedMotionQuery.matches;
  let sound = null;
  let inView = false;
  let journeyTop = 0;
  let journeyBottom = 0;
  let lastProgress = -1;
  let hasUpdated = false;

  const getCards = () => (container ? Array.from(container.querySelectorAll(cardSelector)) : []);
  const cardId = (card, index) => String(card.dataset.artworkId || index);

  const getColumns = () => {
    if (typeof options.getColumns === 'function') {
      return options.getColumns(container, scope);
    }
    const width = container?.clientWidth || scope.clientWidth || window.innerWidth;
    if (width >= 1040) return 3;
    if (width >= 560) return 2;
    return 1;
  };

  const applyLayout = () => {
    const columns = getColumns();
    currentColumns = columns;
    const width = container.clientWidth || 0;
    container.dataset.journeyCols = String(columns);
    container.dataset.journeyNarrow = String(columns === 1 && width < 460);
    container.style.setProperty('--journey-cols', String(columns));

    cards.forEach((card, index) => {
      const row = Math.floor(index / columns);
      const slot = index % columns;
      const column = row % 2 === 1 ? columns - 1 - slot : slot;
      let offset = 0;
      if (columns === 3) offset = [0, 22, 9][(row + column) % 3];
      else if (columns === 2) offset = [0, 18][(row + column) % 2];
      else offset = [0, 14, 4][row % 3];

      card.style.gridColumn = String(column + 1);
      card.style.gridRow = String(row + 1);
      card.style.setProperty('--journey-offset', `${offset}px`);
      card.dataset.journeyRow = String(row);
      card.dataset.journeyCol = String(column);
      card.dataset.journeyAlign = columns === 1 ? (row % 2 === 0 ? 'left' : 'right') : '';
    });
  };

  const appendPath = (fragment, d, index, ghost) => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('pathLength', '1');
    path.classList.add('sketch-journey-path');
    if (ghost) path.classList.add('sketch-journey-path--ghost');
    path.dataset.from = String(index);
    path.dataset.to = String(index + 1);
    path.style.setProperty('--journey-path-index', String(Math.min(index, 14)));
    path.style.strokeDashoffset = '1';
    fragment.appendChild(path);
    return path;
  };

  const prepareCards = () => {
    cards.forEach((card, index) => {
      const id = cardId(card, index);
      if (index === 0) revealedIds.add(id);
      const revealed = reducedMotion || index === 0 || revealedIds.has(id);
      card.classList.toggle('journey-card-pending', !revealed);
      card.classList.toggle('journey-card-revealed', revealed);
    });
  };

  const revealCard = (card, index, playSound) => {
    const id = cardId(card, index);
    if (revealedIds.has(id)) return false;
    revealedIds.add(id);
    card.classList.remove('journey-card-pending');
    card.classList.add('journey-card-revealed');
    if (playSound) sound?.tap();
    return true;
  };

  const revealAll = () => {
    cards.forEach((card, index) => {
      revealedIds.add(cardId(card, index));
      card.classList.remove('journey-card-pending');
      card.classList.add('journey-card-revealed');
    });
    segments.forEach((segment) => {
      segment.main.style.strokeDashoffset = '0';
      segment.ghost.style.strokeDashoffset = '0';
    });
  };

  const updateProgress = () => {
    updateFrame = 0;
    try {
    if (destroyed || !container) return;

    if (reducedMotion) {
      revealAll();
      sound?.setVisible(false);
      hasUpdated = true;
      return;
    }

    if (!cards.length) {
      sound?.setVisible(false);
      return;
    }

    if (cards.length < 2) {
      revealAll();
      sound?.setVisible(false);
      return;
    }

    const scrollY = window.scrollY || window.pageYOffset || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
    const span = journeyBottom - journeyTop;
    const progress = clamp01(span > 0 ? (scrollY + viewportHeight * 0.55 - journeyTop) / span : 1);
    const increased = hasUpdated && progress > lastProgress + 0.0005;
    let drawing = false;

    segments.forEach((segment) => {
      let local = segment.end > segment.start ? (progress - segment.start) / (segment.end - segment.start) : 1;
      local = clamp01(local);
      if (progress >= segment.start && progress < segment.end) local = Math.max(local, 0.035);
      if (local > 0.001 && local < 0.999) drawing = true;
      segment.main.style.strokeDashoffset = String(1 - local);
      segment.ghost.style.strokeDashoffset = String(1 - Math.max(0, local - 0.045));
    });

    cards.forEach((card, index) => {
      if (index === 0) return;
      const segment = segments[index - 1];
      if (!segment) return;
      if (progress >= segment.end - 0.001 || progress >= 0.999) {
        revealCard(card, index, increased);
      }
    });

    if (progress >= 0.999) {
      cards.forEach((card, index) => {
        if (index > 0) revealCard(card, index, false);
      });
      sound?.stopScratch();
    } else if (increased && drawing) {
      sound?.startScratch();
    } else {
      sound?.stopScratch();
    }

    sound?.setVisible(inView && !document.hidden);
    lastProgress = progress;
    hasUpdated = true;

    if (fallbackTimer) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = 0;
    }
    } catch (error) {
      revealAll();
      sound?.setVisible(false);
    }
  };

  const scheduleUpdate = () => {
    if (destroyed || updateFrame) return;
    updateFrame = window.requestAnimationFrame(updateProgress);
  };

  const scheduleDraw = () => {
    if (destroyed || frame) return;
    frame = window.requestAnimationFrame(draw);
  };

  const draw = () => {
    frame = 0;
    try {
    if (destroyed || !container || !svg) return;

    cards = getCards();
    if (!cards.length) {
      svg.replaceChildren();
      segments = [];
      signature = '';
      sound?.setVisible(false);
      return;
    }

    if (!reducedMotion && !sound && cards.length > 1) sound = createJourneySound();

    applyLayout();
    container.classList.add('journey-measuring');
    cards.forEach((card) => card.classList.remove('journey-card-pending', 'journey-card-revealed'));

    const containerRect = container.getBoundingClientRect();
    const width = Math.max(1, Math.round(container.clientWidth));
    const height = Math.max(1, Math.round(container.scrollHeight));
    const points = cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        card,
        left: rect.left - containerRect.left,
        top: rect.top - containerRect.top,
        width: rect.width,
        height: rect.height,
        right: rect.right - containerRect.left,
        bottom: rect.bottom - containerRect.top
      };
    });

    const nextSignature = `${width}x${height}|${currentColumns}|${points
      .map((point) => `${Math.round(point.left)},${Math.round(point.top)},${Math.round(point.width)},${Math.round(point.height)}`)
      .join(';')}`;
    if (nextSignature === signature) {
      prepareCards();
      window.requestAnimationFrame(() => container?.classList.remove('journey-measuring'));
      scheduleUpdate();
      return;
    }
    signature = nextSignature;

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));

    const fragment = document.createDocumentFragment();
    const connections = [];
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index];
      const to = points[index + 1];
      const sameRow = from.card.dataset.journeyRow === to.card.dataset.journeyRow;
      const wobble = index % 2 === 0 ? 1 : -1;
      let d;
      let ghostD;

      if (sameRow) {
        const rightward = to.left > from.left;
        const startX = rightward ? from.right - from.width * 0.22 : from.left + from.width * 0.22;
        const endX = rightward ? to.left + to.width * 0.22 : to.right - to.width * 0.22;
        const startY = from.bottom + 4;
        const endY = to.bottom + 4;
        const dip = 28 + (index % 3) * 7;
        const c1x = startX + (endX - startX) * 0.26;
        const c2x = startX + (endX - startX) * 0.74;
        const c1y = Math.max(startY, endY) + dip;
        const c2y = c1y;
        d = `M ${startX.toFixed(1)} ${startY.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${endX.toFixed(1)} ${endY.toFixed(1)}`;
        ghostD = `M ${(startX + 1.5).toFixed(1)} ${(startY + 1).toFixed(1)} C ${(c1x + 2).toFixed(1)} ${(c1y + 2.5).toFixed(1)}, ${(c2x - 2).toFixed(1)} ${(c2y + 2.5).toFixed(1)}, ${(endX - 1.5).toFixed(1)} ${(endY + 1).toFixed(1)}`;
      } else {
        const narrow = currentColumns === 1 && width < 460;
        const startX = narrow ? from.left + 16 : from.left + from.width * 0.5;
        const endX = narrow ? to.left + 16 : to.left + to.width * 0.5;
        const startY = from.bottom + 5;
        const endY = to.top - 5;
        const dy = Math.max(20, endY - startY);
        const c1x = startX + wobble * 12;
        const c2x = endX - wobble * 12;
        const c1y = startY + dy * 0.38;
        const c2y = startY + dy * 0.62;
        d = `M ${startX.toFixed(1)} ${startY.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${endX.toFixed(1)} ${endY.toFixed(1)}`;
        ghostD = `M ${(startX + 1.5).toFixed(1)} ${(startY + 1).toFixed(1)} C ${(c1x + 2).toFixed(1)} ${(c1y + 2).toFixed(1)}, ${(c2x - 2).toFixed(1)} ${(c2y - 2).toFixed(1)}, ${(endX - 1.5).toFixed(1)} ${(endY + 1).toFixed(1)}`;
      }

      const ghostPath = appendPath(fragment, ghostD, index, true);
      const mainPath = appendPath(fragment, d, index, false);
      connections.push({ main: mainPath, ghost: ghostPath });
    }

    svg.replaceChildren(fragment);

    const weights = connections.map(({ main }) => {
      try {
        return Math.max(1, main.getTotalLength());
      } catch (error) {
        return 1;
      }
    });
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    let accumulated = 0;
    segments = connections.map((connection, index) => {
      const start = accumulated / totalWeight;
      accumulated += weights[index];
      return { ...connection, start, end: accumulated / totalWeight };
    });

    const scrollY = window.scrollY || window.pageYOffset || 0;
    const top = Math.min(...points.map((point) => point.top));
    const bottom = Math.max(...points.map((point) => point.bottom));
    journeyTop = containerRect.top + scrollY + top;
    journeyBottom = containerRect.top + scrollY + bottom;

    hoveredIndex = -1;
    prepareCards();
    hasUpdated = false;
    lastProgress = -1;
    window.requestAnimationFrame(() => container?.classList.remove('journey-measuring'));
    scheduleUpdate();

    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    fallbackTimer = window.setTimeout(() => {
      fallbackTimer = 0;
      if (!hasUpdated) revealAll();
    }, 2500);
    } catch (error) {
      revealAll();
      container?.classList.remove("journey-measuring");
    }
  };

  const setHover = (index) => {
    if (index === hoveredIndex) return;
    hoveredIndex = index;
    svg?.querySelectorAll('.sketch-journey-path').forEach((path) => {
      const from = Number(path.dataset.from);
      const to = Number(path.dataset.to);
      path.classList.toggle('is-hovered', index >= 0 && (from === index || to === index));
    });
  };

  const teardown = () => {
    if (frame) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
    if (updateFrame) {
      window.cancelAnimationFrame(updateFrame);
      updateFrame = 0;
    }
    if (fallbackTimer) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = 0;
    }
    revealAll();
    sound?.destroy();
    sound = null;
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    intersectionObserver?.disconnect();
    if (reducedMotionListener) {
      reducedMotionQuery.removeEventListener?.('change', reducedMotionListener);
      reducedMotionListener = null;
    }
    listeners?.abort();
    resizeObserver = null;
    mutationObserver = null;
    intersectionObserver = null;
    listeners = null;

    if (container) {
      container.classList.remove('sketch-journey', 'is-visible', 'journey-measuring');
      container.removeAttribute('data-journey-cols');
      container.removeAttribute('data-journey-narrow');
      container.querySelector('.sketch-journey-lines')?.remove();
    }

    container = null;
    svg = null;
    cards = [];
    segments = [];
    revealedIds = new Set();
    signature = '';
    hoveredIndex = -1;
    inView = false;
    journeyTop = 0;
    journeyBottom = 0;
    lastProgress = -1;
    hasUpdated = false;
  };

  const bindHover = (signal) => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    container.addEventListener('pointerover', (event) => {
      const target = event.target instanceof Element ? event.target.closest(cardSelector) : null;
      if (!target) return;
      const index = cards.indexOf(target);
      if (index !== -1) setHover(index);
    }, { signal });

    container.addEventListener('pointerout', (event) => {
      const target = event.target instanceof Element ? event.target.closest(cardSelector) : null;
      if (!target) return;
      if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
      setHover(-1);
    }, { signal });
  };

  const setup = () => {
    container.classList.add('sketch-journey');
    svg = container.querySelector('.sketch-journey-lines');
    if (!svg) {
      svg = document.createElementNS(SVG_NS, 'svg');
      svg.classList.add('sketch-journey-lines');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      container.prepend(svg);
    }

    cards = getCards();
    listeners = new AbortController();
    container.addEventListener('load', scheduleDraw, { capture: true, signal: listeners.signal });
    window.addEventListener('resize', scheduleDraw, { passive: true, signal: listeners.signal });
    window.addEventListener('scroll', scheduleUpdate, { passive: true, signal: listeners.signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        sound?.stopScratch();
        sound?.setVisible(false);
      } else {
        scheduleUpdate();
      }
    }, { signal: listeners.signal });

    if (!reducedMotion && cards.length > 1) sound = createJourneySound();

    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(scheduleDraw);
      resizeObserver.observe(container);
      cards.forEach((card) => resizeObserver.observe(card));
    }

    if ('MutationObserver' in window) {
      mutationObserver = new MutationObserver(scheduleDraw);
      mutationObserver.observe(container, { childList: true });
    }

    if ('IntersectionObserver' in window) {
      intersectionObserver = new IntersectionObserver((entries) => {
        const entry = entries[0];
        inView = Boolean(entry && entry.isIntersecting);
        if (inView) container?.classList.add('is-visible');
        sound?.setVisible(inView);
        scheduleUpdate();
      }, { threshold: 0.04, rootMargin: '0px 0px -8% 0px' });
      intersectionObserver.observe(container);
    } else {
      inView = true;
      container.classList.add('is-visible');
      sound?.setVisible(true);
    }

    reducedMotionListener = (event) => {
      reducedMotion = event.matches;
      if (reducedMotion) {
        revealAll();
        sound?.destroy();
        sound = null;
        container?.classList.add('is-visible');
      } else {
        if (!sound) sound = createJourneySound();
        scheduleDraw();
      }
    };
    reducedMotionQuery.addEventListener?.('change', reducedMotionListener);

    bindHover(listeners.signal);
    scheduleDraw();
  };

  const sync = () => {
    if (destroyed) return;
    const next = scope.querySelector(containerSelector);
    if (!next) {
      teardown();
      return;
    }

    if (next !== container) {
      teardown();
      container = next;
      setup();
    } else {
      cards = getCards();
      if (resizeObserver) cards.forEach((card) => resizeObserver.observe(card));
      scheduleDraw();
    }
  };

  const destroy = () => {
    destroyed = true;
    teardown();
  };

  return { sync, refresh: scheduleDraw, destroy };
};

const initExplorePage = () => {
  const explorePage = document.querySelector('[data-explore-page]');
  if (!explorePage) return;

  const pageController = new AbortController();
  const pageSignal = pageController.signal;
  registerPageCleanup(() => {
    pageController.abort();
    if (exploreRequest) exploreRequest.abort();
  });
  const journey = createSketchJourney(explorePage, {
    getColumns: (container, scope) => {
      const width = container?.clientWidth || scope.clientWidth || window.innerWidth;
      return width >= 1040 ? 3 : 2;
    }
  });
  registerPageCleanup(() => journey.destroy());

  const exploreForm = explorePage.querySelector('[data-explore-form]');
  const exploreGallery = document.getElementById('explore-gallery');
  const exploreQueryInput = explorePage.querySelector('[data-explore-query]');
  const exploreCategoryInput = explorePage.querySelector('[data-explore-category-input]');
  const exploreSortInput = explorePage.querySelector('[data-explore-sort-input]');
  const exploreReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const exploreAnnouncer = document.createElement('p');
  let exploreRequest = null;
  let exploreState = exploreForm ? {
    q: (exploreForm.elements.q?.value || '').trim(),
    category: exploreForm.elements.category?.value || 'all',
    sort: exploreForm.elements.sort?.value || 'latest'
  } : { q: '', category: 'all', sort: 'latest' };

  exploreAnnouncer.className = 'studio-explore-sr-only';
  exploreAnnouncer.setAttribute('aria-live', 'polite');
  explorePage.prepend(exploreAnnouncer);

  const getExploreResults = () => exploreGallery?.querySelector('[data-explore-results]') || null;

  const bindExploreMedia = (scope = explorePage) => {
    scope.querySelectorAll('[data-explore-card], .studio-explore-spotlight').forEach((container) => {
      const image = container.querySelector('img');
      if (!image || image.dataset.exploreFallbackBound === 'true') return;
      image.dataset.exploreFallbackBound = 'true';
      bindArtworkImageFallback(image, container);
    });

    scope.querySelectorAll('[data-explore-avatar]').forEach((image) => {
      if (image.dataset.exploreAvatarBound === 'true') return;
      image.dataset.exploreAvatarBound = 'true';
      const fallback = image.dataset.exploreAvatar;
      if (!fallback) return;
      const handleAvatarError = () => {
        if (image.getAttribute('src') === fallback) return;
        image.src = fallback;
      };
      image.addEventListener('error', handleAvatarError);
      if (image.complete && image.naturalWidth === 0) handleAvatarError();
    });
  };

  const buildExploreUrl = (nextState) => {
    const url = new URL('/explore', window.location.origin);
    if (nextState.category && nextState.category !== 'all') url.searchParams.set('category', nextState.category);
    if (nextState.sort && nextState.sort !== 'latest') url.searchParams.set('sort', nextState.sort);
    if (nextState.q) url.searchParams.set('q', nextState.q);
    return url;
  };

  const getExploreStateFromUrl = (url) => {
    const sortAliases = {
      newest: 'latest',
      views: 'views',
      viewed: 'views',
      'most-viewed': 'views',
      popular: 'popular',
      liked: 'popular',
      'most-liked': 'popular',
      trending: 'popular'
    };
    const rawSort = (url.searchParams.get('sort') || 'latest').toLowerCase();
    return {
      q: (url.searchParams.get('q') || '').trim(),
      category: (url.searchParams.get('category') || 'all').toLowerCase(),
      sort: sortAliases[rawSort] || 'latest'
    };
  };

  const syncExploreControls = () => {
    if (exploreQueryInput && document.activeElement !== exploreQueryInput) exploreQueryInput.value = exploreState.q;
    if (exploreCategoryInput) exploreCategoryInput.value = exploreState.category;
    if (exploreSortInput) exploreSortInput.value = exploreState.sort;

    explorePage.querySelectorAll('[data-explore-category]').forEach((link) => {
      link.href = buildExploreUrl({ ...exploreState, category: link.dataset.exploreCategory }).toString();
      const isActive = link.dataset.exploreCategory === exploreState.category;
      link.classList.toggle('is-active', isActive);
      if (isActive) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    explorePage.querySelectorAll('[data-explore-sort]').forEach((link) => {
      link.href = buildExploreUrl({ ...exploreState, sort: link.dataset.exploreSort }).toString();
      const isActive = link.dataset.exploreSort === exploreState.sort;
      link.classList.toggle('is-active', isActive);
      if (isActive) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  };

  const updateExploreTotalLabel = (total) => {
    const totalLabel = explorePage.querySelector('[data-explore-total-label]');
    if (totalLabel) totalLabel.textContent = `${Number(total) || 0} ${Number(total) === 1 ? 'work' : 'works'}`;
  };

  const announceExploreResults = (total) => {
    exploreAnnouncer.textContent = `${Number(total) || 0} ${Number(total) === 1 ? 'artwork' : 'artworks'} found.`;
  };

  const loadExplore = async (url, options = {}) => {
    const { push = true, scroll = true } = options;
    const currentResults = getExploreResults();
    if (!currentResults) {
      window.location.assign(url.toString());
      return;
    }

    if (exploreRequest) exploreRequest.abort();
    const controller = new AbortController();
    exploreRequest = controller;
    const fetchUrl = new URL(url);
    fetchUrl.searchParams.set('partial', '1');
    currentResults.classList.add('is-loading');
    currentResults.setAttribute('aria-busy', 'true');
    const skeleton = currentResults.querySelector('[data-explore-skeleton]');
    if (skeleton) skeleton.hidden = false;

    try {
      const response = await fetch(fetchUrl, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        signal: controller.signal
      });
      if (!response.ok) throw new Error('Explore request failed');

      const html = await response.text();
      const documentFragment = new DOMParser().parseFromString(html, 'text/html');
      const incomingResults = documentFragment.querySelector('[data-explore-results]');
      if (!incomingResults) throw new Error('Explore response was incomplete');

      exploreState = getExploreStateFromUrl(url);
      currentResults.replaceWith(incomingResults);
      syncExploreControls();
      updateExploreTotalLabel(incomingResults.dataset.total);
      announceExploreResults(incomingResults.dataset.total);
      bindExploreMedia(incomingResults);
      bindQuickActions();
      journey.sync();

      if (push) window.history.pushState({ explore: true }, '', url.toString());
      if (scroll) exploreGallery.scrollIntoView({ behavior: exploreReducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
    } catch (error) {
      if (error.name === 'AbortError') return;
      currentResults.classList.remove('is-loading');
      currentResults.setAttribute('aria-busy', 'false');
      if (skeleton) skeleton.hidden = true;
      window.location.assign(url.toString());
    } finally {
      if (exploreRequest === controller) exploreRequest = null;
    }
  };

  exploreForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(exploreForm);
    loadExplore(buildExploreUrl({
      q: String(formData.get('q') || '').trim(),
      category: String(formData.get('category') || 'all'),
      sort: String(formData.get('sort') || 'latest')
    }));
  }, { signal: pageSignal });

  explorePage.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const moreButton = target.closest('[data-explore-more]');
    if (moreButton) {
      const results = getExploreResults();
      const nextUrl = moreButton.dataset.nextUrl;
      if (!results || !nextUrl || moreButton.disabled) return;

      const fetchUrl = new URL(nextUrl, window.location.origin);
      fetchUrl.searchParams.set('partial', '1');
      const originalMarkup = moreButton.innerHTML;
      moreButton.disabled = true;
      moreButton.querySelector('span').textContent = 'Turning the page...';

      try {
        const response = await fetch(fetchUrl, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!response.ok) throw new Error('Could not load more artwork');

        const html = await response.text();
        const documentFragment = new DOMParser().parseFromString(html, 'text/html');
        const incomingResults = documentFragment.querySelector('[data-explore-results]');
        const incomingMasonry = incomingResults?.querySelector('[data-explore-masonry]');
        const currentMasonry = results.querySelector('[data-explore-masonry]');
        if (!incomingResults || !incomingMasonry || !currentMasonry) throw new Error('Could not load more artwork');

        const postKeyOf = (card) => card.dataset.postKey || `artwork-${card.dataset.artworkId || ''}`;
        const existingKeys = new Set([...currentMasonry.querySelectorAll('[data-explore-card]')].map(postKeyOf));
        incomingMasonry.querySelectorAll('[data-explore-card]').forEach((card) => {
          if (!existingKeys.has(postKeyOf(card))) currentMasonry.appendChild(card);
        });
        applyHiddenPosts();

        const incomingMeta = incomingResults.querySelector('[data-explore-meta]');
        const currentMeta = results.querySelector('[data-explore-meta]');
        if (incomingMeta && currentMeta) currentMeta.replaceWith(incomingMeta);

        results.querySelector('.studio-explore-more-wrap')?.remove();
        const incomingMore = incomingResults.querySelector('[data-explore-more]');
        if (incomingMore) {
          const nextWrap = document.createElement('div');
          nextWrap.className = 'studio-explore-more-wrap';
          nextWrap.appendChild(incomingMore);
          results.appendChild(nextWrap);
        } else {
          const endNote = incomingResults.querySelector('.studio-explore-end-note');
          if (endNote) results.appendChild(endNote);
        }

        results.dataset.page = incomingResults.dataset.page;
        results.dataset.total = incomingResults.dataset.total;
        results.dataset.hasMore = incomingResults.dataset.hasMore;
        updateExploreTotalLabel(incomingResults.dataset.total);
        announceExploreResults(incomingResults.dataset.total);
        bindExploreMedia(currentMasonry);
        bindQuickActions();
        journey.refresh();
      } catch (error) {
        moreButton.innerHTML = originalMarkup;
        moreButton.disabled = false;
        exploreAnnouncer.textContent = 'More artwork could not be loaded. Please try again.';
      }

      return;
    }

    const link = target.closest('a[data-explore-link]');
    if (!link) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === '_blank') return;

    const url = new URL(link.href, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname !== '/explore') return;
    event.preventDefault();
    loadExplore(url);
  }, { signal: pageSignal });

  document.addEventListener('artwork:like-changed', (event) => {
    explorePage.querySelectorAll('[data-explore-likes-for]').forEach((label) => {
      if (label.dataset.exploreLikesFor === String(event.detail.id)) label.textContent = String(event.detail.likes);
    });
  }, { signal: pageSignal });

  document.addEventListener('artwork:bookmark-changed', (event) => {
    explorePage.querySelectorAll('[data-explore-card]').forEach((card) => {
      if (card.dataset.artworkId !== String(event.detail.id)) return;
      const button = card.querySelector('.studio-explore-save button');
      if (button) button.setAttribute('aria-label', event.detail.saved ? 'Remove from saved artworks' : 'Save artwork');
    });
  }, { signal: pageSignal });

  bindExploreMedia();
  syncExploreControls();
  journey.sync();
};

const initHomePage = () => {
  const homePage = document.querySelector('[data-sketch-home]');
  if (!homePage) return;

  const bookSection = homePage.querySelector('#art-book');
  const bookExperience = homePage.querySelector('[data-art-book]');
  if (bookSection && bookExperience) {
    bookSection.addEventListener('pointerenter', loadPageFlipLibrary, { once: true, passive: true });
    bookSection.addEventListener('touchstart', loadPageFlipLibrary, { once: true, passive: true });
    if ('IntersectionObserver' in window) {
      const bookObserver = new IntersectionObserver((entries, observer) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        loadPageFlipLibrary().then(() => bindFlipbook());
      }, { rootMargin: '200px 0px' });
      registerPageCleanup(() => bookObserver.disconnect());
      bookObserver.observe(bookSection);
    } else {
      loadPageFlipLibrary().then(() => bindFlipbook());
    }
  }

  const homeReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionTargets = [...homePage.querySelectorAll('[data-motion]')];
  if (motionTargets.length && !homeReducedMotion.matches && 'IntersectionObserver' in window) {
    motionTargets.forEach((target, index) => {
      target.classList.add('motion-pending');
      target.style.setProperty('--motion-delay', `${(index % 4) * 70}ms`);
    });

    const motionObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.remove('motion-pending');
        entry.target.classList.add('is-motion-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
    registerPageCleanup(() => motionObserver.disconnect());

    motionTargets.forEach((target) => motionObserver.observe(target));
  } else {
    motionTargets.forEach((target) => target.classList.remove('motion-pending'));
  }

  homePage.querySelectorAll('a[href^="#"]').forEach((link) => {
    const hash = link.getAttribute('href');
    if (!hash || hash === '#') return;
    const destination = document.querySelector(hash);
    if (!destination) return;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      if (hash === '#art-book') loadPageFlipLibrary();
      destination.scrollIntoView({
        behavior: homeReducedMotion.matches ? 'auto' : 'smooth',
        block: 'start'
      });
      window.history.replaceState(null, '', hash);
    });
  });

  const journey = createSketchJourney(homePage, {
    containerSelector: '[data-home-journey]',
    cardSelector: '[data-journey-card]',
    getColumns: (container, scope) => {
      const width = container?.clientWidth || scope.clientWidth || window.innerWidth;
      return width >= 1080 ? 3 : 2;
    }
  });
  registerPageCleanup(() => journey.destroy());
  journey.sync();
};

const PIN_TOAST_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-.8 4.6 3 3.1v2.1H6.8v-2.1l3-3.1L9 4Z" /><path d="M12 14v6" /></svg>';

const ensurePinToastStack = () => {
  let stack = document.querySelector('[data-pin-toast-stack]');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'pin-toast-stack';
    stack.setAttribute('data-pin-toast-stack', '');
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  return stack;
};

const showPinToast = (message, tone = 'success') => {
  const stack = ensurePinToastStack();
  const toast = document.createElement('div');
  toast.className = `pin-toast pin-toast--${tone}`;
  const icon = document.createElement('span');
  icon.className = 'pin-toast-icon';
  icon.innerHTML = tone === 'success'
    ? PIN_TOAST_ICON
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 2.8 20h18.4L12 4Z" /><path d="M12 10v4M12 17v.5" /></svg>';
  const text = document.createElement('p');
  text.textContent = message;
  toast.append(icon, text);
  stack.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => toast.remove(), 260);
  }, 3200);
};

const syncPinButtons = (artworkId, pinned) => {
  const id = String(artworkId);
  document.querySelectorAll('[data-pin-toggle]').forEach((button) => {
    if (String(button.dataset.artworkId) !== id) return;
    button.dataset.pinned = String(pinned);
    button.classList.toggle('is-pinned', pinned);
    button.classList.toggle('active', pinned);
    button.setAttribute('aria-pressed', String(pinned));
    const label = button.querySelector('[data-pin-label]');
    if (label) {
      label.textContent = pinned
        ? 'Pinned'
        : (button.hasAttribute('data-pin-label-long') ? 'Pin to homepage' : 'Pin');
    }
    if (button.classList.contains('ad-tool-pin') || button.classList.contains('ad-showcase-pin') || button.classList.contains('hs-hero-pin') || button.classList.contains('wall-action-pin') || button.classList.contains('nb-action-pin')) {
      button.title = pinned ? 'Unpin from homepage' : 'Pin to homepage';
      button.setAttribute('aria-label', pinned ? 'Unpin from the homepage' : 'Pin to the homepage');
    }
  });
};

const removePinCards = (artworkId) => {
  const id = String(artworkId);
  document.querySelectorAll('[data-pinned-card], [data-profile-pinned] .pf-art-card').forEach((card) => {
    if (String(card.dataset.artworkId) !== id) return;
    card.style.transition = 'opacity 0.24s ease, transform 0.24s ease';
    card.style.opacity = '0';
    card.style.transform = 'translateY(8px)';
    window.setTimeout(() => card.remove(), 250);
  });
};

const updatePinnedCounters = (count, limit) => {
  const pinnedTab = document.querySelector('.pf-tabs .pf-tab[href*="tab=pinned"] sup');
  if (pinnedTab && Number.isFinite(limit)) pinnedTab.textContent = `${count}/${limit}`;
  const profileGrid = document.querySelector('[data-profile-pinned]');
  if (!profileGrid) return;
  const collectionCount = document.querySelector('.pf-collection-count strong');
  if (collectionCount) collectionCount.textContent = String(count);
  const status = document.querySelector('[data-portfolio-status]');
  if (status) status.textContent = `Showing ${count} of ${count} pieces`;
};

const refreshPinnedCollection = async () => {
  const section = document.querySelector('[data-pinned-collection]');
  if (!section) return;
  try {
    const response = await fetch(`${window.location.pathname}${window.location.search}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/html' },
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (!response.ok) return;
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const next = doc.querySelector('[data-pinned-collection]');
    if (next) section.replaceWith(next);
  } catch (error) {
    /* the next page load will refresh the collection */
  }
};

const handlePinClick = async (event) => {
  const button = event.target instanceof Element ? event.target.closest('[data-pin-toggle]') : null;
  if (!button) return;

  event.preventDefault();
  event.stopPropagation();
  if (button.dataset.busy === 'true' || button.disabled) return;

  const artworkId = button.dataset.artworkId;
  if (!artworkId) return;
  const pinned = button.dataset.pinned === 'true';
  const action = pinned ? 'unpin' : 'pin';
  const optimisticPinned = !pinned;

  button.dataset.busy = 'true';
  button.disabled = true;
  syncPinButtons(artworkId, optimisticPinned);

  try {
    const response = await fetch(`/art/${encodeURIComponent(artworkId)}/${action}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin'
    });

    let payload = null;
    try { payload = await response.json(); } catch (error) { payload = null; }

    if (response.status === 401) {
      window.location.assign('/login');
      return;
    }

    if (!response.ok || !payload?.ok) {
      syncPinButtons(artworkId, pinned);
      showPinToast(payload?.error || 'We could not update that pin. Please try again.', 'error');
      return;
    }

    syncPinButtons(artworkId, Boolean(payload.pinned));
    if (!payload.pinned) {
      removePinCards(artworkId);
      updatePinnedCounters(payload.count, payload.limit);
    }
    const countLabel = Number.isFinite(payload.count) && Number.isFinite(payload.limit)
      ? ` ${payload.count} of ${payload.limit} pins in use.`
      : '';
    showPinToast(
      payload.pinned
        ? `Pinned to the community sketchbook.${countLabel}`
        : `Unpinned from the community sketchbook.${countLabel}`,
      'success'
    );

    await refreshPinnedCollection();

    if (!payload.pinned && document.querySelector('[data-profile-pinned]')) {
      window.setTimeout(() => {
        if (window.ArtSpaceNavigation?.refresh) window.ArtSpaceNavigation.refresh();
        else window.location.reload();
      }, 220);
    }
  } catch (error) {
    syncPinButtons(artworkId, pinned);
    showPinToast('The connection was interrupted. Please try again.', 'error');
  } finally {
    button.dataset.busy = 'false';
    button.disabled = false;
  }
};

document.addEventListener('click', handlePinClick);

document.addEventListener('artwork:like-changed', (event) => {
  const id = String(event.detail.id);
  document.querySelectorAll('.wall-card').forEach((card) => {
    if (String(card.dataset.artworkId) !== id) return;
    const button = card.querySelector('.wall-action-like');
    const count = card.querySelector('[data-wall-like-count]');
    if (count) count.textContent = String(event.detail.likes);
    if (!button) return;
    button.classList.toggle('active', Boolean(event.detail.liked));
    button.setAttribute('aria-pressed', String(Boolean(event.detail.liked)));
    button.setAttribute('aria-label', event.detail.liked ? 'Unlike this artwork' : 'Like this artwork');
    const label = button.querySelector('[data-action-label]');
    if (label) label.textContent = event.detail.liked ? 'Unlike' : 'Like';
  });
});

document.addEventListener('artwork:bookmark-changed', (event) => {
  const id = String(event.detail.id);
  document.querySelectorAll('.wall-card').forEach((card) => {
    if (String(card.dataset.artworkId) !== id) return;
    const button = card.querySelector('.wall-action-save');
    if (!button) return;
    button.classList.toggle('active', Boolean(event.detail.saved));
    button.setAttribute('aria-pressed', String(Boolean(event.detail.saved)));
    button.setAttribute('aria-label', event.detail.saved ? 'Remove from saved artworks' : 'Save artwork');
    const label = button.querySelector('[data-action-label]');
    if (label) label.textContent = event.detail.saved ? 'Saved' : 'Save';
  });
});

const REACTION_EMOJIS = { like: '👍', love: '❤️', care: '🥰', haha: '😂', wow: '😮', sad: '😢' };
const REACTION_NAMES = { like: 'Like', love: 'Love', care: 'Care', haha: 'Haha', wow: 'Wow', sad: 'Sad' };

const bindArtworkReactions = () => {
  const picker = document.querySelector('[data-reaction-picker]');
  const detailRoot = document.querySelector('[data-artwork-detail]');
  if (!picker || !detailRoot || picker.dataset.reactionBound === 'true') return;
  picker.dataset.reactionBound = 'true';

  const artworkId = detailRoot.dataset.artworkId;
  const form = picker.querySelector('[data-reaction-form]');
  const button = picker.querySelector('[data-reaction-button]');
  const menu = picker.querySelector('[data-reaction-picker-menu]');
  const emoji = picker.querySelector('[data-reaction-emoji]');
  const label = picker.querySelector('[data-action-label]');
  const summaryEmojis = document.querySelector('[data-reaction-summary-emojis]');
  const summaryCount = document.querySelector('[data-reaction-summary-count]');
  const summaryLabel = document.querySelector('[data-reaction-summary-label]');
  let currentReaction = form?.dataset.currentReaction || '';
  let holdTimer = 0;

  const renderSummary = (count, reactions) => {
    if (summaryCount) summaryCount.textContent = String(count);
    if (summaryLabel) summaryLabel.textContent = count === 1 ? 'reaction' : 'reactions';
    if (summaryEmojis && reactions) {
      const top = Object.keys(reactions)
        .filter((type) => reactions[type] > 0)
        .sort((left, right) => reactions[right] - reactions[left])
        .slice(0, 3);
      summaryEmojis.textContent = top.map((type) => REACTION_EMOJIS[type]).join(' ');
    }
  };

  const applyState = (reaction, count, reactions) => {
    currentReaction = reaction || '';
    if (form) form.dataset.currentReaction = currentReaction;
    if (emoji) emoji.textContent = REACTION_EMOJIS[currentReaction || 'like'];
    if (label) label.textContent = currentReaction ? REACTION_NAMES[currentReaction] : 'Like';
    if (button) {
      button.classList.toggle('active', Boolean(currentReaction));
      Object.keys(REACTION_EMOJIS).forEach((type) => {
        button.classList.toggle(`ad-reaction-${type}`, currentReaction === type || (!currentReaction && type === 'like'));
      });
      button.setAttribute('aria-pressed', String(Boolean(currentReaction)));
    }
    menu?.querySelectorAll('[data-reaction-choice]').forEach((choice) => {
      choice.classList.toggle('is-active', choice.dataset.reactionChoice === currentReaction);
    });
    document.querySelectorAll('[data-detail-likes-count]').forEach((node) => {
      node.textContent = String(count);
    });
    renderSummary(count, reactions);
    document.dispatchEvent(new CustomEvent('artwork:like-changed', {
      detail: { id: Number(artworkId), liked: Boolean(currentReaction), likes: count, reaction: currentReaction || null }
    }));
  };

  const closeMenu = () => {
    if (!menu) return;
    menu.hidden = true;
    button?.setAttribute('aria-expanded', 'false');
  };

  const openMenu = () => {
    if (!menu) return;
    menu.hidden = false;
    button?.setAttribute('aria-expanded', 'true');
  };

  button?.addEventListener('click', (event) => {
    event.preventDefault();
    if (holdTimer) return;
    if (menu && !menu.hidden) closeMenu();
    else openMenu();
  });

  button?.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    holdTimer = window.setTimeout(() => {
      holdTimer = 0;
      openMenu();
    }, 380);
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach((eventName) => {
    button?.addEventListener(eventName, () => {
      if (holdTimer) {
        window.clearTimeout(holdTimer);
        holdTimer = 0;
      }
    });
  });

  picker.addEventListener('click', async (event) => {
    const choice = event.target instanceof Element ? event.target.closest('[data-reaction-choice]') : null;
    if (!choice) return;
    event.preventDefault();

    const reaction = choice.dataset.reactionChoice;
    if (!reaction || !artworkId || choice.dataset.busy === 'true') return;

    choice.dataset.busy = 'true';
    closeMenu();

    try {
      const response = await fetch(`/art/${encodeURIComponent(artworkId)}/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json'
        },
        credentials: 'same-origin',
        body: JSON.stringify({ reaction })
      });

      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }

      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'We could not update that reaction. Please try again.');
      }

      applyState(data.reaction, data.likes_count, data.reactions);
      showPinToast(
        data.reaction ? `Reacted with ${REACTION_NAMES[data.reaction]}.` : 'Reaction removed.',
        'success'
      );
    } catch (error) {
      showPinToast(error.message || 'We could not update that reaction. Please try again.', 'error');
    } finally {
      choice.dataset.busy = 'false';
    }
  });

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('[data-reaction-picker]')) return;
    closeMenu();
  });

  const likersDialog = document.querySelector('[data-likers-dialog]');
  const likersSummary = likersDialog?.querySelector('[data-likers-summary]');
  const likersList = likersDialog?.querySelector('[data-likers-list]');
  const likersEmpty = likersDialog?.querySelector('[data-likers-empty]');
  const likersNote = likersDialog?.querySelector('[data-likers-note]');

  const openLikers = async () => {
    if (!likersDialog || !artworkId) return;
    likersList?.replaceChildren();
    if (likersEmpty) likersEmpty.hidden = true;
    if (likersNote) {
      likersNote.hidden = false;
      likersNote.textContent = 'Loading reactions…';
    }
    if (!likersDialog.open) likersDialog.showModal();

    try {
      const response = await fetch(`/art/${encodeURIComponent(artworkId)}/reactions`, {
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin'
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'We could not load those reactions.');
      }

      if (likersSummary) {
        likersSummary.replaceChildren();
        Object.keys(data.reactions || {}).forEach((type) => {
          const count = Number(data.reactions[type] || 0);
          if (!count) return;
          const chip = document.createElement('span');
          chip.className = 'ad-likers-chip';
          chip.textContent = `${REACTION_EMOJIS[type] || ''} ${count}`;
          likersSummary.appendChild(chip);
        });
      }

      if (likersList) {
        (data.users || []).forEach((user) => {
          const link = document.createElement('a');
          link.className = 'ad-likers-item';
          link.href = `/profile/${encodeURIComponent(user.username)}`;

          const avatar = document.createElement('img');
          avatar.src = user.avatar || '/images/default-avatar.svg';
          avatar.alt = '';
          avatar.loading = 'lazy';
          avatar.dataset.fallbackSrc = '/images/default-avatar.svg';

          const copy = document.createElement('span');
          copy.className = 'ad-likers-copy';
          const name = document.createElement('strong');
          name.textContent = user.display_name || user.username;
          const handle = document.createElement('small');
          handle.textContent = `@${user.username}`;
          copy.append(name, handle);

          const reaction = document.createElement('span');
          reaction.className = 'ad-likers-reaction';
          reaction.textContent = REACTION_EMOJIS[user.reaction] || '👍';

          link.append(avatar, copy, reaction);
          likersList.appendChild(link);
        });
      }

      if (likersEmpty) likersEmpty.hidden = Boolean(data.users && data.users.length);
      if (likersNote) likersNote.hidden = true;
    } catch (error) {
      if (likersNote) likersNote.textContent = error.message || 'We could not load those reactions.';
    }
  };

  document.querySelectorAll('[data-likers-open]').forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      openLikers();
    });
    trigger.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openLikers();
    });
  });

  likersDialog?.querySelector('[data-likers-close]')?.addEventListener('click', () => likersDialog.close());
  likersDialog?.addEventListener('click', (event) => {
    if (event.target === likersDialog) likersDialog.close();
  });
};

const NOTIFICATION_ACTIONS = {
  like: 'reacted to your artwork',
  comment: 'commented on your artwork',
  reply: 'replied to your comment',
  comment_like: 'liked your comment',
  mention: 'mentioned you',
  share: 'shared your artwork',
  follow: 'started following you'
};

const updateNotificationBadges = (unread) => {
  document.querySelectorAll('[data-notifications-badge]').forEach((badge) => {
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.hidden = !unread;
  });
  document.querySelectorAll('[data-notifications-toggle]').forEach((button) => {
    button.setAttribute('aria-label', unread > 0 ? `Notifications (${unread} unread)` : 'Notifications');
  });
};

const bindNotificationBell = () => {
  if (document.documentElement.dataset.notificationsBound === 'true') return;
  document.documentElement.dataset.notificationsBound = 'true';

  const wrap = document.querySelector('[data-notifications-wrap]');
  const toggle = wrap?.querySelector('[data-notifications-toggle]');
  const panel = wrap?.querySelector('[data-notifications-panel]');
  const list = wrap?.querySelector('[data-notifications-list]');
  if (!wrap || !toggle || !panel || !list) return;

  const renderItem = (item) => {
    const link = document.createElement('a');
    link.className = `notifications-panel-item${item.is_read ? '' : ' is-unread'}`;
    link.href = item.link || '/explore';
    link.dataset.notificationId = String(item.id);

    const avatarWrap = document.createElement('span');
    avatarWrap.className = 'notifications-panel-avatar';
    const avatar = document.createElement('img');
    avatar.src = item.actor_avatar || '/images/default-avatar.svg';
    avatar.alt = '';
    avatar.loading = 'lazy';
    avatar.dataset.fallbackSrc = '/images/default-avatar.svg';
    avatarWrap.appendChild(avatar);

    const copy = document.createElement('span');
    copy.className = 'notifications-panel-copy';
    const line = document.createElement('span');
    line.className = 'notifications-panel-line';
    const actor = document.createElement('strong');
    actor.textContent = item.actor_name || 'Someone';
    const action = document.createElement('span');
    action.textContent = NOTIFICATION_ACTIONS[item.type] || 'sent you an update';
    line.append(actor, document.createTextNode(' '), action);
    copy.appendChild(line);

    if (item.artwork_title) {
      const artwork = document.createElement('span');
      artwork.className = 'notifications-panel-artwork';
      artwork.textContent = `“${item.artwork_title}”`;
      copy.appendChild(artwork);
    }

    const time = document.createElement('time');
    time.textContent = item.created_at_label || '';
    copy.appendChild(time);

    const dot = document.createElement('span');
    dot.className = 'notifications-panel-dot';
    dot.setAttribute('aria-hidden', 'true');

    link.append(avatarWrap, copy, dot);
    link.addEventListener('click', () => {
      fetch(`/api/notifications/${encodeURIComponent(item.id)}/read`, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
        credentials: 'same-origin'
      }).catch(() => {});
    });
    return link;
  };

  const loadPanel = async () => {
    list.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'notifications-panel-empty';
    loading.textContent = 'Loading notifications…';
    list.appendChild(loading);

    try {
      const response = await fetch('/api/notifications', {
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Could not load notifications.');
      const data = await response.json();
      if (!data?.ok) throw new Error('Could not load notifications.');

      list.replaceChildren();
      if (!(data.items || []).length) {
        const empty = document.createElement('p');
        empty.className = 'notifications-panel-empty';
        empty.textContent = 'You are all caught up.';
        list.appendChild(empty);
      } else {
        (data.items || []).forEach((item) => list.appendChild(renderItem(item)));
      }
      updateNotificationBadges(Number(data.unread || 0));
    } catch (error) {
      list.replaceChildren();
      const failed = document.createElement('p');
      failed.className = 'notifications-panel-empty';
      failed.textContent = error.message || 'Could not load notifications.';
      list.appendChild(failed);
    }
  };

  const closePanel = () => {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  };

  toggle.addEventListener('click', async (event) => {
    event.preventDefault();
    const willOpen = panel.hidden;
    if (!willOpen) {
      closePanel();
      return;
    }
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    await loadPanel();
  });

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('[data-notifications-wrap]')) return;
    if (!panel.hidden) closePanel();
  });

  wrap.querySelector('[data-notifications-read-all]')?.addEventListener('click', async () => {
    try {
      await fetch('/api/notifications/read-all', {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
        credentials: 'same-origin'
      });
      updateNotificationBadges(0);
      list.querySelectorAll('.notifications-panel-item').forEach((item) => item.classList.remove('is-unread'));
    } catch (error) {
      /* keep silent, the panel still shows the current state */
    }
  });

  window.setInterval(async () => {
    try {
      const response = await fetch('/api/notifications', {
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin'
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data?.ok) updateNotificationBadges(Number(data.unread || 0));
    } catch (error) {
      /* ignore polling errors */
    }
  }, 60000);
};

const bindMentionAutocomplete = () => {
  if (document.documentElement.dataset.mentionBound === 'true') return;
  document.documentElement.dataset.mentionBound = 'true';

  let activeInput = null;
  let dropdown = null;
  let items = [];
  let activeIndex = -1;
  let debounceTimer = 0;
  let requestToken = 0;

  const ensureDropdown = () => {
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'mention-suggest';
      dropdown.hidden = true;
      dropdown.setAttribute('role', 'listbox');
    }
    const container = activeInput?.closest('dialog[open]') || document.body;
    if (dropdown.parentElement !== container) container.appendChild(dropdown);
    return dropdown;
  };

  const hide = () => {
    if (dropdown) dropdown.hidden = true;
    items = [];
    activeIndex = -1;
  };

  const position = () => {
    if (!activeInput || !dropdown) return;
    const rect = activeInput.getBoundingClientRect();
    dropdown.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 272))}px`;
    dropdown.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 230)}px`;
    dropdown.style.width = `${Math.max(230, Math.min(300, rect.width))}px`;
  };

  const choose = (index) => {
    const user = items[index];
    if (!user || !activeInput) return;

    const value = activeInput.value;
    const caret = activeInput.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const match = before.match(/@([A-Za-z0-9_]*)$/);
    if (!match) {
      hide();
      return;
    }

    const start = caret - match[0].length;
    const insert = `@${user.username} `;
    activeInput.value = value.slice(0, start) + insert + value.slice(caret);
    const newCaret = start + insert.length;
    activeInput.setSelectionRange(newCaret, newCaret);
    activeInput.dispatchEvent(new Event('input', { bubbles: true }));
    hide();
    activeInput.focus();
  };

  const render = () => {
    if (!dropdown) return;
    dropdown.replaceChildren();
    items.forEach((user, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `mention-suggest-item${index === activeIndex ? ' is-active' : ''}`;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(index === activeIndex));

      const avatar = document.createElement('img');
      avatar.className = 'mention-suggest-avatar';
      avatar.src = user.avatar || '/images/default-avatar.svg';
      avatar.alt = '';
      avatar.loading = 'lazy';
      avatar.dataset.fallbackSrc = '/images/default-avatar.svg';

      const copy = document.createElement('span');
      copy.className = 'mention-suggest-copy';
      const name = document.createElement('strong');
      name.textContent = user.display_name || user.username;
      const handle = document.createElement('small');
      handle.textContent = `@${user.username}`;
      copy.append(name, handle);

      button.append(avatar, copy);
      button.addEventListener('pointerdown', (event) => event.preventDefault());
      button.addEventListener('click', () => choose(index));
      dropdown.appendChild(button);
    });
    dropdown.hidden = !items.length;
  };

  const search = async (query) => {
    const token = ++requestToken;
    try {
      const response = await fetch(`/api/mentions/search?q=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin'
      });
      if (!response.ok) {
        hide();
        return;
      }
      const data = await response.json();
      if (token !== requestToken || !data?.ok) return;
      items = data.users || [];
      activeIndex = items.length ? 0 : -1;
      render();
      position();
    } catch (error) {
      hide();
    }
  };

  document.addEventListener('input', (event) => {
    const field = event.target instanceof Element ? event.target.closest('[data-mention-input]') : null;
    if (!field) return;

    activeInput = field;
    const value = field.value;
    const caret = field.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const match = before.match(/(^|[^\w@/])@([A-Za-z0-9_]{0,30})$/);
    if (!match) {
      hide();
      return;
    }

    ensureDropdown();
    position();
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => search(match[2]), 180);
  });

  document.addEventListener('keydown', (event) => {
    const field = event.target instanceof Element ? event.target.closest('[data-mention-input]') : null;
    if (!field || !dropdown || dropdown.hidden) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % items.length;
      render();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      render();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      if (activeIndex >= 0 && items.length) {
        event.preventDefault();
        choose(activeIndex);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      hide();
    }
  });

  document.addEventListener('focusout', (event) => {
    if (!(event.target instanceof Element) || !event.target.matches('[data-mention-input]')) return;
    window.setTimeout(() => {
      if (dropdown && !dropdown.matches(':hover')) hide();
    }, 140);
  });

  window.addEventListener('scroll', () => {
    if (dropdown && !dropdown.hidden) position();
  }, true);
};

const HIDDEN_POSTS_KEY = 'artspace-hidden-posts';

const readHiddenPosts = () => {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(HIDDEN_POSTS_KEY) || '[]'));
  } catch (error) {
    return new Set();
  }
};

const writeHiddenPosts = (hidden) => {
  try {
    window.localStorage.setItem(HIDDEN_POSTS_KEY, JSON.stringify([...hidden]));
  } catch (error) {
    /* private mode */
  }
};

const applyHiddenPosts = () => {
  const hidden = readHiddenPosts();
  if (!hidden.size) return;
  document.querySelectorAll('[data-post-key]').forEach((card) => {
    if (hidden.has(card.dataset.postKey)) card.remove();
  });
};

const bindSocialPostMenu = () => {
  if (document.documentElement.dataset.postMenuBound === 'true') return;
  document.documentElement.dataset.postMenuBound = 'true';

  const closeMenus = (except) => {
    document.querySelectorAll('[data-post-menu]').forEach((menu) => {
      if (menu !== except) menu.hidden = true;
    });
    document.querySelectorAll('[data-post-menu-toggle]').forEach((button) => {
      const menu = button.closest('article')?.querySelector('[data-post-menu]');
      if (menu !== except) button.setAttribute('aria-expanded', 'false');
    });
  };

  document.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const toggle = target.closest('[data-post-menu-toggle]');
    if (toggle) {
      event.preventDefault();
      const article = toggle.closest('article');
      const menu = article?.querySelector('[data-post-menu]');
      if (!menu) return;
      const willOpen = menu.hidden;
      closeMenus(menu);
      menu.hidden = !willOpen;
      toggle.setAttribute('aria-expanded', String(willOpen));
      return;
    }

    if (!target.closest('[data-post-menu]')) closeMenus();

    const copyButton = target.closest('[data-post-copy]');
    if (copyButton) {
      event.preventDefault();
      const artworkId = copyButton.dataset.artworkId;
      const copied = artworkId
        ? await copyArtworkLink(new URL(`/art/${artworkId}`, window.location.origin).toString())
        : false;
      showPinToast(copied ? 'Link copied.' : 'Could not copy the link.', copied ? 'success' : 'error');
      closeMenus();
      return;
    }

    const hideButton = target.closest('[data-post-hide]');
    if (hideButton) {
      event.preventDefault();
      const key = hideButton.dataset.postKey;
      if (key) {
        const hidden = readHiddenPosts();
        hidden.add(key);
        writeHiddenPosts(hidden);
      }
      hideButton.closest('[data-explore-card]')?.remove();
      showPinToast('Post hidden.');
      closeMenus();
      return;
    }

    const reportButton = target.closest('[data-post-report]');
    if (reportButton) {
      event.preventDefault();
      const artworkId = reportButton.dataset.artworkId;
      closeMenus();
      if (!artworkId || !window.confirm('Report this artwork for review?')) return;
      try {
        const response = await fetch(`/art/${encodeURIComponent(artworkId)}/report`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'application/json'
          },
          credentials: 'same-origin',
          body: JSON.stringify({ reason: 'Reported from the feed.' })
        });
        if (response.status === 401) {
          window.location.assign('/login');
          return;
        }
        const data = await response.json();
        if (!response.ok || !data?.ok) {
          throw new Error(data?.error || 'We could not send that report.');
        }
        showPinToast('Report sent to the moderation desk.', 'success');
      } catch (error) {
        showPinToast(error.message || 'We could not send that report.', 'error');
      }
      return;
    }

    const deleteButton = target.closest('[data-post-delete]');
    if (deleteButton) {
      event.preventDefault();
      const artworkId = deleteButton.dataset.artworkId;
      closeMenus();
      if (!artworkId || !window.confirm('Delete this artwork? This cannot be undone.')) return;
      try {
        const response = await fetch(`/art/${encodeURIComponent(artworkId)}/delete`, {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
          credentials: 'same-origin'
        });
        if (response.status === 401) {
          window.location.assign('/login');
          return;
        }
        const data = await response.json();
        if (!response.ok || !data?.ok) {
          throw new Error(data?.error || 'We could not delete that post.');
        }
        document
          .querySelectorAll(`[data-explore-card][data-artwork-id="${CSS.escape(String(artworkId))}"]`)
          .forEach((card) => card.remove());
        showPinToast('Artwork deleted.', 'success');
      } catch (error) {
        showPinToast(error.message || 'We could not delete that post.', 'error');
      }
    }
  });
};

const updateCommunityShareState = (shareId, payload) => {
  const posts = document.querySelectorAll(`[data-community-post][data-share-id="${CSS.escape(String(shareId))}"]`);

  posts.forEach((post) => {
    const likeButton = post.querySelector('[data-share-like]');
    if (likeButton) {
      likeButton.classList.toggle('is-active', Boolean(payload.reaction));
      likeButton.setAttribute('aria-pressed', String(Boolean(payload.reaction)));
      const label = post.querySelector('[data-share-like-label]');
      if (label) label.textContent = payload.reaction ? 'Reacted' : 'Like';
    }

    const menu = post.querySelector('[data-share-reaction-menu]');
    if (menu) {
      menu.hidden = true;
      menu.querySelectorAll('[data-share-reaction]').forEach((choice) => {
        choice.classList.toggle('is-active', choice.dataset.shareReaction === payload.reaction);
      });
    }

    post.querySelectorAll('[data-share-like-count], [data-share-summary-count]').forEach((node) => {
      node.textContent = String(payload.likes_count);
    });
    post.querySelectorAll('[data-share-summary-label]').forEach((node) => {
      node.textContent = payload.likes_count === 1 ? 'reaction' : 'reactions';
    });
  });
};

const bindCommunityFeed = () => {
  if (document.documentElement.dataset.communityBound === 'true') return;
  document.documentElement.dataset.communityBound = 'true';

  const closeReactionMenus = (except) => {
    document.querySelectorAll('[data-share-reaction-menu]').forEach((menu) => {
      if (menu !== except) menu.hidden = true;
    });
  };

  document.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const likeButton = target.closest('[data-share-like]');
    if (likeButton) {
      event.preventDefault();
      const wrap = likeButton.closest('[data-community-reaction]');
      const menu = wrap?.querySelector('[data-share-reaction-menu]');
      if (!menu) return;
      const willOpen = menu.hidden;
      closeReactionMenus(menu);
      menu.hidden = !willOpen;
      return;
    }

    const reactionChoice = target.closest('[data-share-reaction]');
    if (reactionChoice) {
      event.preventDefault();
      const shareId = reactionChoice.dataset.shareId;
      const reaction = reactionChoice.dataset.shareReaction;
      if (!shareId || !reaction || reactionChoice.dataset.busy === 'true') return;

      reactionChoice.dataset.busy = 'true';
      try {
        const response = await fetch(`/community/${encodeURIComponent(shareId)}/like`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'application/json'
          },
          credentials: 'same-origin',
          body: JSON.stringify({ reaction })
        });
        if (response.status === 401) {
          window.location.assign('/login');
          return;
        }
        const data = await response.json();
        if (!response.ok || !data?.ok) {
          throw new Error(data?.error || 'We could not update that reaction.');
        }
        updateCommunityShareState(shareId, data);
        showPinToast(data.reaction ? `Reacted with ${REACTION_NAMES[data.reaction]}.` : 'Reaction removed.', 'success');
      } catch (error) {
        showPinToast(error.message || 'We could not update that reaction.', 'error');
      } finally {
        reactionChoice.dataset.busy = 'false';
      }
      return;
    }

    const copyButton = target.closest('[data-community-copy]');
    if (copyButton) {
      event.preventDefault();
      const shareId = copyButton.dataset.shareId;
      const copied = shareId
        ? await copyArtworkLink(new URL(`/community/${shareId}`, window.location.origin).toString())
        : false;
      showPinToast(copied ? 'Link copied.' : 'Could not copy the link.', copied ? 'success' : 'error');
      document.querySelectorAll('[data-post-menu]').forEach((menu) => { menu.hidden = true; });
      return;
    }

    const reportButton = target.closest('[data-community-report]');
    if (reportButton) {
      event.preventDefault();
      const artworkId = reportButton.dataset.artworkId;
      document.querySelectorAll('[data-post-menu]').forEach((menu) => { menu.hidden = true; });
      if (!artworkId || !window.confirm('Report this shared post for review?')) return;
      try {
        const response = await fetch(`/art/${encodeURIComponent(artworkId)}/report`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'application/json'
          },
          credentials: 'same-origin',
          body: JSON.stringify({ reason: 'Reported from the community feed.' })
        });
        if (response.status === 401) {
          window.location.assign('/login');
          return;
        }
        const data = await response.json();
        if (!response.ok || !data?.ok) {
          throw new Error(data?.error || 'We could not send that report.');
        }
        showPinToast('Report sent to the moderation desk.', 'success');
      } catch (error) {
        showPinToast(error.message || 'We could not send that report.', 'error');
      }
      return;
    }

    const deleteButton = target.closest('[data-community-delete]');
    if (deleteButton) {
      event.preventDefault();
      const shareId = deleteButton.dataset.shareId;
      document.querySelectorAll('[data-post-menu]').forEach((menu) => { menu.hidden = true; });
      if (!shareId || !window.confirm('Delete this shared post? The original artwork will stay online.')) return;
      try {
        const response = await fetch(`/community/${encodeURIComponent(shareId)}/delete`, {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
          credentials: 'same-origin'
        });
        if (response.status === 401) {
          window.location.assign('/login');
          return;
        }
        const data = await response.json();
        if (!response.ok || !data?.ok) {
          throw new Error(data?.error || 'We could not delete that share.');
        }
        document.querySelectorAll(`[data-community-post][data-share-id="${CSS.escape(String(shareId))}"]`).forEach((post) => post.remove());
        showPinToast('Shared post deleted.', 'success');
        if (document.querySelector('[data-community-post-page]')) {
          window.location.assign('/community');
        }
      } catch (error) {
        showPinToast(error.message || 'We could not delete that share.', 'error');
      }
      return;
    }

    const editToggle = target.closest('[data-community-edit-toggle]');
    if (editToggle) {
      event.preventDefault();
      document.querySelectorAll('[data-post-menu]').forEach((menu) => { menu.hidden = true; });
      const editor = document.querySelector('[data-community-message-editor]');
      if (!editor) return;
      const postRoot = document.querySelector('[data-community-post]');
      const currentMessage = postRoot?.querySelector('[data-share-message]')?.textContent?.trim() || '';
      const field = editor.querySelector('textarea');
      if (field) field.value = currentMessage;
      editor.hidden = false;
      field?.focus();
      field?.setSelectionRange(field.value.length, field.value.length);
      editor.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }

    const editCancel = target.closest('[data-community-edit-cancel]');
    if (editCancel) {
      event.preventDefault();
      const editor = editCancel.closest('[data-community-message-editor]');
      if (editor) editor.hidden = true;
      return;
    }

    if (!target.closest('[data-community-reaction]')) closeReactionMenus();
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target instanceof Element ? event.target.closest('[data-community-message-editor]') : null;
    if (!form) return;
    event.preventDefault();

    const shareId = form.dataset.shareId;
    const field = form.querySelector('textarea');
    const message = (field?.value || '').trim();
    if (!shareId || !field) return;

    try {
      const response = await fetch(`/community/${encodeURIComponent(shareId)}/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json'
        },
        credentials: 'same-origin',
        body: JSON.stringify({ message })
      });
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'We could not save that message.');
      }

      document.querySelectorAll(`[data-community-post][data-share-id="${CSS.escape(String(shareId))}"] [data-share-message]`).forEach((node) => {
        node.innerHTML = data.message_html || '';
        node.classList.toggle('is-empty', !data.message);
      });
      form.hidden = true;
      showPinToast('Sharing message updated.', 'success');
    } catch (error) {
      showPinToast(error.message || 'We could not save that message.', 'error');
    }
  });

  document.addEventListener('click', async (event) => {
    const moreButton = event.target instanceof Element ? event.target.closest('[data-community-more]') : null;
    if (!moreButton || moreButton.dataset.busy === 'true') return;

    event.preventDefault();
    const nextUrl = moreButton.dataset.nextUrl;
    const results = document.querySelector('[data-community-results]');
    const feed = results?.querySelector('[data-community-feed]');
    if (!nextUrl || !feed) return;

    moreButton.dataset.busy = 'true';
    const label = moreButton.querySelector('span');
    const original = label?.textContent || '';
    if (label) label.textContent = 'Turning the page…';
    const skeleton = results.querySelector('[data-community-skeleton]');
    if (skeleton) skeleton.hidden = false;

    try {
      const response = await fetch(nextUrl, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!response.ok) throw new Error('Could not load more community posts.');
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const incomingResults = doc.querySelector('[data-community-results]');
      const incomingFeed = incomingResults?.querySelector('[data-community-feed]');
      if (!incomingResults || !incomingFeed) throw new Error('Could not load more community posts.');

      const existing = new Set([...feed.querySelectorAll('[data-community-post]')].map((post) => post.dataset.shareId));
      incomingFeed.querySelectorAll('[data-community-post]').forEach((post) => {
        if (!existing.has(post.dataset.shareId)) feed.appendChild(post);
      });

      results.dataset.page = incomingResults.dataset.page;
      results.dataset.total = incomingResults.dataset.total;
      results.dataset.hasMore = incomingResults.dataset.hasMore;

      const incomingMeta = incomingResults.querySelector('[data-community-meta]');
      const currentMeta = results.querySelector('[data-community-meta]');
      if (incomingMeta && currentMeta) currentMeta.replaceWith(incomingMeta);

      results.querySelector('.community-more-wrap')?.remove();
      const incomingMore = incomingResults.querySelector('[data-community-more]');
      if (incomingMore) {
        const wrap = document.createElement('div');
        wrap.className = 'community-more-wrap';
        wrap.appendChild(incomingMore);
        results.appendChild(wrap);
      } else {
        const endNote = incomingResults.querySelector('.community-end-note');
        if (endNote) results.appendChild(endNote);
      }
    } catch (error) {
      showPinToast(error.message || 'Could not load more community posts.', 'error');
    } finally {
      moreButton.dataset.busy = 'false';
      if (label && label.isConnected) label.textContent = original;
      if (skeleton) skeleton.hidden = true;
    }
  });
};

const bindShareComments = () => {
  if (document.documentElement.dataset.shareCommentsBound === 'true') return;
  document.documentElement.dataset.shareCommentsBound = 'true';

  const getShareId = () => document.querySelector('[data-community-post]')?.dataset.shareId;

  const updateShareCommentCounters = (count) => {
    document.querySelectorAll('[data-share-comments-count]').forEach((node) => { node.textContent = String(count); });
    document.querySelectorAll('[data-share-comments-label]').forEach((node) => {
      node.textContent = count === 1 ? 'comment' : 'comments';
    });
    document.querySelectorAll('[data-share-comments-total]').forEach((node) => { node.textContent = String(count); });
  };

  const getShareReplyTotal = (article) => {
    const container = article?.querySelector(':scope > .ad-comment-main > .ad-comment-replies');
    return container ? container.querySelectorAll('.ad-reply-slot > .ad-comment').length : 0;
  };

  const refreshShareReplyCount = (article) => {
    if (!article) return;
    const total = getShareReplyTotal(article);
    if (!total) return;
    let countButton = article.querySelector(':scope > .ad-comment-main > .ad-comment-actions [data-share-replies-toggle]');
    if (!countButton) {
      const actions = article.querySelector(':scope > .ad-comment-main > .ad-comment-actions');
      if (actions) {
        countButton = document.createElement('button');
        countButton.type = 'button';
        countButton.className = 'ad-comment-action ad-comment-replies-count';
        countButton.dataset.shareRepliesToggle = '';
        countButton.setAttribute('aria-expanded', 'true');
        countButton.innerHTML = `${REPLY_TOGGLE_SVG}<span data-share-replies-label></span>`;
        actions.appendChild(countButton);
      }
    }
    if (countButton) {
      const label = countButton.querySelector('[data-share-replies-label]');
      if (label) label.textContent = total === 1 ? '1 reply' : `${total} replies`;
    }
  };

  const insertShareCommentHtml = (html, parentId) => {
    const list = document.querySelector('[data-share-comment-list]');
    if (!list || !html) return null;
    const holder = document.createElement('div');
    holder.innerHTML = html.trim();
    const article = holder.firstElementChild;
    if (!(article instanceof HTMLElement)) return null;

    if (parentId) {
      const parent = list.querySelector(`.ad-comment[data-share-comment-id="${CSS.escape(String(parentId))}"]`);
      if (!parent) return null;
      let replies = parent.querySelector(':scope > .ad-comment-main > .ad-comment-replies');
      if (!replies) {
        replies = document.createElement('div');
        replies.className = 'ad-comment-replies';
        (parent.querySelector(':scope > .ad-comment-main') || parent).appendChild(replies);
      }
      replies.classList.remove('is-collapsed');
      const slot = document.createElement('div');
      slot.className = 'ad-reply-slot';
      slot.appendChild(article);
      replies.appendChild(slot);
      refreshShareReplyCount(parent);
    } else {
      list.querySelector('[data-share-comments-empty]')?.remove();
      list.prepend(article);
    }

    enhanceCommentMedia(article);
    return article;
  };

  document.addEventListener('input', (event) => {
    const field = event.target instanceof Element ? event.target.closest('[data-share-comment-input]') : null;
    if (!field) return;
    const counter = document.querySelector('[data-share-comment-char]');
    if (counter) counter.textContent = `${field.value.length} / ${field.getAttribute('maxlength') || '2000'}`;
  });

  document.addEventListener('submit', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const editForm = target.closest('[data-share-comment-edit-form]');
    if (editForm) {
      event.preventDefault();
      const commentId = editForm.dataset.shareCommentId || editForm.closest('.ad-comment')?.dataset.shareCommentId;
      const field = editForm.querySelector('textarea');
      const body = (field?.value || '').trim();
      if (!commentId || !field || !body) {
        field?.focus();
        return;
      }
      try {
        const response = await fetch(`/community/comments/${encodeURIComponent(commentId)}/edit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'application/json'
          },
          credentials: 'same-origin',
          body: JSON.stringify({ body })
        });
        if (response.status === 401) {
          window.location.assign('/login');
          return;
        }
        const data = await response.json();
        if (!response.ok || !data?.ok) throw new Error(data?.error || 'We could not save that edit.');
        const article = editForm.closest('.ad-comment');
        const text = article?.querySelector('[data-share-comment-text]');
        if (text) text.innerHTML = data.body_html || '';
        const edited = article?.querySelector('[data-share-comment-edited]');
        if (edited) edited.hidden = false;
        field.defaultValue = body;
        editForm.hidden = true;
        showPinToast('Comment updated.', 'success');
      } catch (error) {
        showPinToast(error.message || 'We could not save that edit.', 'error');
      }
      return;
    }

    const form = target.closest('[data-share-comment-form], [data-share-reply-form]');
    if (!form) return;
    event.preventDefault();

    const shareId = getShareId();
    const field = form.querySelector('textarea[name="body"]');
    const body = (field?.value || '').trim();
    if (!shareId || !field || !body) {
      field?.focus();
      return;
    }

    const isReply = form.matches('[data-share-reply-form]');
    const parentId = isReply ? String(form.dataset.shareCommentId || '') : '';

    field.disabled = true;
    try {
      const response = await fetch(`/community/${encodeURIComponent(shareId)}/comment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json'
        },
        credentials: 'same-origin',
        body: JSON.stringify({ body, parent_id: parentId || undefined })
      });
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'Your comment could not be posted.');

      const inserted = insertShareCommentHtml(data.comment_html, parentId);
      if (inserted) {
        inserted.classList.add('is-new');
        window.setTimeout(() => inserted.classList.remove('is-new'), 1700);
        inserted.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }

      updateShareCommentCounters(data.comments_count);
      form.reset();
      if (isReply) form.hidden = true;
      const counter = document.querySelector('[data-share-comment-char]');
      if (counter && !isReply) counter.textContent = '0 / 2000';
      showPinToast(isReply ? 'Reply posted.' : 'Your note was posted.', 'success');
    } catch (error) {
      showPinToast(error.message || 'Your comment could not be posted.', 'error');
    } finally {
      field.disabled = false;
    }
  });

  document.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const replyToggle = target.closest('[data-share-reply-toggle]');
    if (replyToggle) {
      event.preventDefault();
      const article = replyToggle.closest('.ad-comment');
      const form = article?.querySelector(':scope > .ad-comment-main > [data-share-reply-form]');
      if (!form) return;
      const willShow = form.hidden;
      document.querySelectorAll('[data-share-reply-form]:not([hidden]), [data-share-comment-edit-form]:not([hidden])').forEach((openForm) => {
        if (openForm === form) return;
        openForm.hidden = true;
      });
      form.hidden = !willShow;
      replyToggle.setAttribute('aria-expanded', String(willShow));
      if (willShow) form.querySelector('textarea')?.focus();
      return;
    }

    const editToggle = target.closest('[data-share-edit-toggle]');
    if (editToggle) {
      event.preventDefault();
      const article = editToggle.closest('.ad-comment');
      const form = article?.querySelector(':scope > .ad-comment-main > .ad-comment-bubble > [data-share-comment-edit-form]');
      if (!form) return;
      const willShow = form.hidden;
      document.querySelectorAll('[data-share-reply-form]:not([hidden]), [data-share-comment-edit-form]:not([hidden])').forEach((openForm) => {
        if (openForm === form) return;
        openForm.hidden = true;
      });
      form.hidden = !willShow;
      if (willShow) {
        const field = form.querySelector('textarea');
        field?.focus();
        field?.setSelectionRange(field.value.length, field.value.length);
      }
      return;
    }

    const editCancel = target.closest('[data-share-edit-cancel]');
    if (editCancel) {
      event.preventDefault();
      const form = editCancel.closest('[data-share-comment-edit-form]');
      if (form) {
        form.hidden = true;
        const field = form.querySelector('textarea');
        if (field) field.value = field.defaultValue;
      }
      return;
    }

    const replyCancel = target.closest('[data-share-reply-cancel]');
    if (replyCancel) {
      event.preventDefault();
      const form = replyCancel.closest('[data-share-reply-form]');
      if (form) form.hidden = true;
      return;
    }

    const deleteButton = target.closest('[data-share-comment-delete]');
    if (deleteButton) {
      event.preventDefault();
      const commentId = deleteButton.dataset.shareCommentId;
      if (!commentId || !window.confirm('Delete this comment? Replies will be removed too.')) return;
      try {
        const response = await fetch(`/community/comments/${encodeURIComponent(commentId)}/delete`, {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
          credentials: 'same-origin'
        });
        if (response.status === 401) {
          window.location.assign('/login');
          return;
        }
        const data = await response.json();
        if (!response.ok || !data?.ok) throw new Error(data?.error || 'We could not delete that comment.');
        const deleted = new Set((data.deleted_ids || []).map(String));
        deleted.add(String(commentId));
        document.querySelectorAll('.ad-comment[data-share-comment-id]').forEach((article) => {
          if (deleted.has(String(article.dataset.shareCommentId))) article.remove();
        });
        updateShareCommentCounters(data.comments_count);
        showPinToast('Comment deleted.', 'success');
      } catch (error) {
        showPinToast(error.message || 'We could not delete that comment.', 'error');
      }
      return;
    }

    const repliesToggle = target.closest('[data-share-replies-toggle]');
    if (repliesToggle) {
      event.preventDefault();
      const article = repliesToggle.closest('.ad-comment');
      const container = article?.querySelector(':scope > .ad-comment-main > .ad-comment-replies');
      if (!article || !container) return;
      const collapsed = container.classList.toggle('is-collapsed');
      article
        .querySelectorAll(':scope > .ad-comment-main > .ad-comment-actions [data-share-replies-toggle], :scope > .ad-comment-main > [data-share-replies-toggle]')
        .forEach((button) => button.setAttribute('aria-expanded', String(!collapsed)));

      const total = getShareReplyTotal(article);
      article
        .querySelectorAll(':scope > .ad-comment-main > .ad-comment-actions [data-share-replies-label], :scope > .ad-comment-main > [data-share-replies-toggle] [data-share-replies-label]')
        .forEach((label) => {
          const isCount = label.closest('.ad-comment-replies-count');
          label.textContent = collapsed
            ? `View ${total} ${total === 1 ? 'reply' : 'replies'}`
            : (isCount ? (total === 1 ? '1 reply' : `${total} replies`) : 'Hide replies');
        });
      return;
    }

    const moreButton = target.closest('[data-share-comments-more]');
    if (moreButton) {
      event.preventDefault();
      const shareId = getShareId();
      const nextPage = moreButton.dataset.nextPage;
      if (!shareId || !nextPage || moreButton.dataset.busy === 'true') return;
      moreButton.dataset.busy = 'true';
      const label = moreButton.querySelector('span');
      const original = label?.textContent || '';
      if (label) label.textContent = 'Loading…';
      try {
        const response = await fetch(`/community/${encodeURIComponent(shareId)}/comments?page=${encodeURIComponent(nextPage)}`, {
          headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          credentials: 'same-origin'
        });
        const data = await response.json();
        if (!response.ok || !data?.ok) throw new Error(data?.error || 'We could not load more comments.');
        const list = document.querySelector('[data-share-comment-list]');
        if (list && data.html) {
          const holder = document.createElement('div');
          holder.innerHTML = data.html;
          while (holder.firstElementChild) {
            const node = holder.firstElementChild;
            list.appendChild(node);
            enhanceCommentMedia(node);
          }
        }
        updateShareCommentCounters(data.comments_count);
        if (data.has_more && data.next_page) {
          moreButton.dataset.nextPage = String(data.next_page);
        } else {
          moreButton.closest('.ad-comment-more-wrap')?.remove();
        }
      } catch (error) {
        showPinToast(error.message || 'We could not load more comments.', 'error');
      } finally {
        moreButton.dataset.busy = 'false';
        if (label && label.isConnected) label.textContent = original;
      }
    }
  });
};

const bindArtworkDetailGallery = () => {
  const gallery = document.querySelector('[data-gallery]');
  if (!gallery) return;

  const stage = gallery.querySelector('.ad-gallery-stage');
  const openButton = gallery.querySelector('[data-artwork-fullscreen]');
  const mainImage = gallery.querySelector('[data-gallery-main]');
  const prevButton = gallery.querySelector('[data-gallery-prev]');
  const nextButton = gallery.querySelector('[data-gallery-next]');
  const counter = gallery.querySelector('[data-gallery-counter]');
  const thumbs = Array.from(gallery.querySelectorAll('[data-gallery-thumb]'));
  const total = Math.max(1, Number(gallery.dataset.galleryCount || thumbs.length || 1));

  if (!stage || !openButton || !mainImage || total <= 1 || thumbs.length === 0) return;

  let currentIndex = Math.max(0, Number(mainImage.dataset.galleryIndex || 0));
  let transformEndpoint = '';
  let suppressNextClick = false;
  let pointerStartX = null;

  const currentSrc = mainImage.getAttribute('src') || '';
  if (currentSrc.includes('?tr=')) {
    transformEndpoint = currentSrc.split('?tr=')[0];
  } else if (currentSrc.includes('&tr=')) {
    transformEndpoint = currentSrc.split('&tr=')[0];
  }

  const buildMainSrc = (fullUrl) => {
    if (!transformEndpoint || !fullUrl.startsWith(transformEndpoint)) return fullUrl;
    const separator = fullUrl.includes('?') ? '&' : '?';
    return `${fullUrl}${separator}tr=w-1200,q-82,f-auto`;
  };

  const buildMainSrcset = (fullUrl) => {
    if (!transformEndpoint || !fullUrl.startsWith(transformEndpoint)) return '';
    const separator = fullUrl.includes('?') ? '&' : '?';
    return [640, 960, 1200, 1600]
      .map((width) => `${fullUrl}${separator}tr=w-${width},q-82,f-auto ${width}w`)
      .join(', ');
  };

  const goTo = (index) => {
    const nextIndex = ((index % total) + total) % total;
    const thumb = thumbs[nextIndex];
    if (!thumb) return;

    const fullUrl = thumb.dataset.galleryFull || '';
    if (!fullUrl) return;
    const thumbUrl = thumb.dataset.galleryThumbUrl || fullUrl;

    currentIndex = nextIndex;
    mainImage.dataset.galleryIndex = String(currentIndex);
    mainImage.src = buildMainSrc(fullUrl);
    const srcset = buildMainSrcset(fullUrl);
    if (srcset) mainImage.setAttribute('srcset', srcset);
    else mainImage.removeAttribute('srcset');
    mainImage.sizes = '(max-width: 900px) 92vw, 720px';
    mainImage.alt = openButton.dataset.artworkTitle || mainImage.alt;

    openButton.dataset.artworkFull = fullUrl;
    openButton.dataset.artworkThumb = thumbUrl;

    if (counter) counter.textContent = `${currentIndex + 1} / ${total}`;

    thumbs.forEach((node, nodeIndex) => {
      const isActive = nodeIndex === currentIndex;
      node.classList.toggle('is-active', isActive);
      node.setAttribute('aria-current', isActive ? 'true' : 'false');
    });

    thumbs[currentIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });

    gallery.classList.add('is-switching');
    window.setTimeout(() => gallery.classList.remove('is-switching'), 340);
  };

  thumbs.forEach((thumb, index) => {
    thumb.addEventListener('click', () => {
      if (index === currentIndex) return;
      goTo(index);
    });
  });

  prevButton?.addEventListener('click', () => goTo(currentIndex - 1));
  nextButton?.addEventListener('click', () => goTo(currentIndex + 1));

  gallery.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goTo(currentIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      goTo(currentIndex + 1);
    }
  });

  stage.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerStartX = event.clientX;
  });

  stage.addEventListener('click', (event) => {
    if (!suppressNextClick) return;
    event.preventDefault();
    event.stopPropagation();
    suppressNextClick = false;
  }, true);

  stage.addEventListener('pointerup', (event) => {
    if (pointerStartX === null) return;
    const delta = event.clientX - pointerStartX;
    pointerStartX = null;
    if (Math.abs(delta) < 40) return;
    if (event.target instanceof Element && event.target.closest('[data-gallery-prev], [data-gallery-next]')) return;
    suppressNextClick = true;
    goTo(currentIndex + (delta < 0 ? 1 : -1));
  });

  stage.addEventListener('pointercancel', () => {
    pointerStartX = null;
  });
};

const bindArtworkLightbox = () => {
  const lightbox = document.querySelector('[data-lightbox]');
  const openButton = document.querySelector('[data-artwork-fullscreen]');
  if (!lightbox || !openButton) return;

  const image = lightbox.querySelector('[data-lightbox-image]');
  const closeButton = lightbox.querySelector('[data-lightbox-close]');
  const prevButton = lightbox.querySelector('[data-lightbox-prev]');
  const nextButton = lightbox.querySelector('[data-lightbox-next]');
  const counter = lightbox.querySelector('[data-lightbox-counter]');
  if (!image) return;

  const thumbs = Array.from(document.querySelectorAll('[data-gallery-thumb]'));
  const mainImage = document.querySelector('[data-gallery-main]');
  const sources = thumbs.length
    ? thumbs.map((thumb) => thumb.dataset.galleryFull).filter(Boolean)
    : [openButton.dataset.artworkFull].filter(Boolean);
  if (!sources.length) return;

  const total = sources.length;
  let index = Math.max(0, Number(mainImage?.dataset.galleryIndex || 0)) % total;
  let pointerX = null;
  let transformEndpoint = '';

  const currentSrc = mainImage?.getAttribute('src') || '';
  if (currentSrc.includes('?tr=')) {
    transformEndpoint = currentSrc.split('?tr=')[0];
  } else if (currentSrc.includes('&tr=')) {
    transformEndpoint = currentSrc.split('&tr=')[0];
  }

  const fullSrc = (url) => {
    if (!transformEndpoint || !url.startsWith(transformEndpoint)) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}tr=w-1600,q-90,f-auto`;
  };

  const render = () => {
    image.src = fullSrc(sources[index]);
    image.alt = openButton.dataset.artworkTitle || image.alt || '';
    if (counter) counter.textContent = `${index + 1} / ${total}`;
  };

  const step = (direction) => {
    if (total < 2) return;
    index = ((index + direction) % total + total) % total;
    render();
    const thumb = thumbs[index];
    if (thumb) thumb.click();
  };

  const open = () => {
    const startIndex = Math.max(0, Number(mainImage?.dataset.galleryIndex || 0)) % total;
    index = startIndex;
    render();
    document.body.classList.add('ad-lightbox-open');
    if (typeof lightbox.showModal === 'function') {
      if (!lightbox.open) lightbox.showModal();
    } else {
      lightbox.setAttribute('open', '');
    }
    if (typeof lightbox.requestFullscreen === 'function') {
      lightbox.requestFullscreen().catch(() => {});
    }
    closeButton?.focus({ preventScroll: true });
  };

  const close = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (typeof lightbox.close === 'function' && lightbox.open) lightbox.close();
    else lightbox.removeAttribute('open');
    document.body.classList.remove('ad-lightbox-open');
    openButton.focus({ preventScroll: true });
  };

  openButton.addEventListener('click', open);
  closeButton?.addEventListener('click', close);
  prevButton?.addEventListener('click', () => step(-1));
  nextButton?.addEventListener('click', () => step(1));

  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) close();
  });

  lightbox.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });

  lightbox.addEventListener('close', () => {
    document.body.classList.remove('ad-lightbox-open');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  });

  lightbox.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    }
  });

  const stage = lightbox.querySelector('.ad-lightbox-stage');
  let suppressCloseClick = false;

  stage?.addEventListener('click', (event) => {
    if (suppressCloseClick) {
      suppressCloseClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    close();
  });

  stage?.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerX = event.clientX;
  });
  stage?.addEventListener('pointerup', (event) => {
    if (pointerX === null) return;
    const delta = event.clientX - pointerX;
    pointerX = null;
    if (Math.abs(delta) < 40) return;
    suppressCloseClick = true;
    step(delta < 0 ? 1 : -1);
  });
  stage?.addEventListener('pointercancel', () => {
    pointerX = null;
  });
};

const initPage = () => {
  bindQuickActions();
  bindPortfolioCollection();
  bindArtworkEditPreview();
  bindArtworkEditForm();
  bindArtworkDeleteDialog();
  bindProfileFlash();
  bindCommentForms();
  bindShareButtons();
  bindShareDialog();
  bindFollowForms();
  bindReportDialog();
  bindArtworkDescription();
  bindArtworkComments();
  bindArtworkDetailGallery();
  bindArtworkLightbox();
  bindArtworkReactions();
  bindNotificationBell();
  bindMentionAutocomplete();
  bindSocialPostMenu();
  applyHiddenPosts();
  bindScrollReveal();

  const heroArtwork = document.querySelector('[data-home-feature-image]');
  bindArtworkImageFallback(heroArtwork, heroArtwork?.closest('.home-hero-feature'));
  document.querySelectorAll('img[data-fallback-src]').forEach((image) => {
    bindArtworkImageFallback(image, image.closest('.art-card-media, .studio-explore-card, .studio-explore-spotlight, .book-artwork-link, .home-hero-feature, .pf-art-image, .nb-art-mount'));
  });

  markCurrentNavigation();
  revealArtworkCards();
  initStudioDashboard();
  initUploadPage();
  initExplorePage();
  initHomePage();
};

initPage();
window.ArtSpacePage = {
  init: initPage,
  cleanup: runPageCleanups,
  markCurrentNavigation
};
