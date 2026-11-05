(() => {
  const form = document.querySelector('[data-pe-form]');
  if (!form) return;

  const MAX_FILE_BYTES = 3 * 1024 * 1024;
  const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const BIO_MIN = 12;

  const $ = (selector, root = form) => root.querySelector(selector);
  const $$ = (selector, root = form) => [...root.querySelectorAll(selector)];

  const bioInput = $('[data-pe-bio]');
  const bioCounter = $('[data-pe-counter]');
  const bioPreview = $('[data-pe-bio-preview]');
  const linksPreview = $('[data-pe-links-preview]');
  const unsavedNote = $('[data-pe-unsaved]');

  const linkDefs = [
    { key: 'website', label: 'Website', format: (value) => value.replace(/^https?:\/\//i, '').replace(/\/$/, '') },
    { key: 'instagram', label: 'Instagram', format: (value) => value.replace(/^@/, '') },
    { key: 'twitter', label: 'Twitter', format: (value) => value.replace(/^@/, '') },
  ];

  let dirty = false;
  let submitting = false;

  const markDirty = () => {
    if (dirty) return;
    dirty = true;
    if (unsavedNote) unsavedNote.hidden = false;
  };

  const readValue = (key) => (form.elements[key]?.value || '').trim();

  const updateCounter = () => {
    if (bioCounter) bioCounter.textContent = `${bioInput.value.length} / ${bioInput.maxLength}`;
    if (bioPreview) bioPreview.textContent = bioInput.value.trim() || 'Your bio will appear here.';
  };

  const updateChecks = () => {
    const states = {
      photo: form.dataset.hasAvatar === 'true',
      cover: form.dataset.hasCover === 'true',
      bio: bioInput.value.trim().length >= BIO_MIN,
      links: linkDefs.some((def) => readValue(def.key).length > 0),
    };

    $$('[data-pe-check]').forEach((item) => {
      const done = Boolean(states[item.dataset.peCheck]);
      item.classList.toggle('is-done', done);
    });
  };

  const updateLinkPreview = () => {
    if (!linksPreview) return;

    const chips = linkDefs
      .map((def) => ({ label: def.label, value: readValue(def.key) }))
      .filter((entry) => entry.value.length > 0)
      .map((entry) => {
        const def = linkDefs.find((item) => item.label === entry.label);
        const chip = document.createElement('span');
        chip.className = 'pe-preview-chip';
        chip.textContent = `${def.label} · ${def.format(entry.value)}`;
        return chip;
      });

    linksPreview.replaceChildren();

    if (!chips.length) {
      const empty = document.createElement('span');
      empty.className = 'pe-preview-empty';
      empty.textContent = 'No links yet.';
      linksPreview.append(empty);
    } else {
      chips.forEach((chip) => linksPreview.append(chip));
    }
  };

  const applyPreview = (kind, url) => {
    if (kind === 'avatar') {
      $$('[data-pe-avatar-preview]').forEach((image) => { image.src = url; });
      form.dataset.hasAvatar = 'true';
      return;
    }

    $$('[data-pe-cover-preview]').forEach((image) => { image.src = url; });
    $$('[data-pe-cover-bg]').forEach((element) => {
      element.style.backgroundImage = `url("${url}")`;
      element.classList.remove('is-default');
    });
    form.dataset.hasCover = 'true';
  };

  const noteFor = (kind) => $(`[data-pe-file-note="${kind}"]`);

  const setFile = (input, file) => {
    if (!file) return;

    const kind = input.dataset.peFile;
    const note = noteFor(kind);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      if (note) {
        note.textContent = 'That file type is not supported. Use JPG, PNG or WebP.';
        note.classList.add('is-error');
      }
      input.value = '';
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      if (note) {
        note.textContent = 'That image is larger than 3 MB. Try a smaller file.';
        note.classList.add('is-error');
      }
      input.value = '';
      return;
    }

    if (note) {
      const size = (file.size / (1024 * 1024)).toFixed(1);
      note.textContent = `${file.name} · ${size} MB`;
      note.classList.remove('is-error');
    }

    applyPreview(kind, URL.createObjectURL(file));
    updateChecks();
    markDirty();
  };

  const bindDropZone = (input) => {
    input.addEventListener('change', () => setFile(input, input.files?.[0]));

    const drop = input.closest('[data-pe-drop]');
    if (!drop) return;

    ['dragenter', 'dragover'].forEach((type) => {
      drop.addEventListener(type, (event) => {
        event.preventDefault();
        drop.classList.add('is-dragging');
      });
    });

    ['dragleave', 'dragend'].forEach((type) => {
      drop.addEventListener(type, () => drop.classList.remove('is-dragging'));
    });

    drop.addEventListener('drop', (event) => {
      event.preventDefault();
      drop.classList.remove('is-dragging');

      const file = event.dataTransfer?.files?.[0];
      if (!file) return;

      try {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
      } catch {
        return;
      }

      setFile(input, file);
    });
  };

  $$('[data-pe-file]').forEach(bindDropZone);

  form.addEventListener('input', markDirty);
  form.addEventListener('change', markDirty);
  form.addEventListener('submit', () => { submitting = true; });

  bioInput?.addEventListener('input', updateCounter);
  $$('[data-pe-link]').forEach((input) => input.addEventListener('input', updateLinkPreview));

  window.addEventListener('beforeunload', (event) => {
    if (!dirty || submitting) return;
    event.preventDefault();
    event.returnValue = '';
  });

  updateCounter();
  updateLinkPreview();
  updateChecks();
})();
