(() => {
  'use strict';

  const root = document.documentElement;
  const locale = root.getAttribute('lang') || 'en';
  const dictionaryNode = document.querySelector('[data-i18n-km]');
  const FORM_STATE_KEY = 'artspace-form-state-v1';

  const monthMap = {
    Jan: 'មករា', Feb: 'កុម្ភៈ', Mar: 'មីនា', Apr: 'មេសា', May: 'ឧសភា', Jun: 'មិថុនា',
    Jul: 'កក្កដា', Aug: 'សីហា', Sep: 'កញ្ញា', Oct: 'តុលា', Nov: 'វិច្ឆិកា', Dec: 'ធ្នូ'
  };

  let phrases = {};
  let patterns = [];

  if (dictionaryNode) {
    try {
      const data = JSON.parse(dictionaryNode.textContent || '{}');
      phrases = data.phrases || {};
      patterns = (data.patterns || []).map((pattern) => ({
        regex: new RegExp(pattern.en, 'u'),
        value: pattern.km
      }));
    } catch (error) {
      phrases = {};
      patterns = [];
    }
  }

  const entityMap = {
    '&amp;': '&', '&mdash;': '—', '&ndash;': '–', '&rsquo;': '’', '&lsquo;': '‘',
    '&ldquo;': '“', '&rdquo;': '”', '&hellip;': '…', '&nbsp;': ' ', '&middot;': '·',
    '&nearr;': '↗', '&larr;': '←', '&rarr;': '→', '&times;': '×', '&#8627;': '↳',
    '&#10022;': '✦', '&copy;': '©', '&quot;': '"', '&#39;': "'"
  };

  const decode = (value) => String(value || '').replace(/&[a-zA-Z#0-9]+;/g, (entity) => (
    Object.prototype.hasOwnProperty.call(entityMap, entity) ? entityMap[entity] : entity
  ));

  const normalize = (value) => decode(value).replace(/\s+/g, ' ').trim();

  const translateMonths = (value) => value.replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, (month) => monthMap[month] || month);

  const lookup = (value) => {
    if (!value) return '';
    if (Object.prototype.hasOwnProperty.call(phrases, value)) return phrases[value];

    const segments = value.split(' · ');
    if (segments.length > 1) {
      let changed = false;
      const translatedSegments = segments.map((segment) => {
        if (Object.prototype.hasOwnProperty.call(phrases, segment)) {
          changed = true;
          return phrases[segment];
        }
        for (const pattern of patterns) {
          if (!pattern.regex.test(segment)) continue;
          changed = true;
          return translateMonths(segment.replace(pattern.regex, pattern.value));
        }
        const months = translateMonths(segment);
        if (months !== segment) changed = true;
        return months;
      });
      if (changed) return translatedSegments.join(' · ');
    }

    for (const pattern of patterns) {
      if (!pattern.regex.test(value)) continue;
      return translateMonths(value.replace(pattern.regex, pattern.value));
    }

    const months = translateMonths(value);
    return months !== value ? months : '';
  };

  const translateText = (value) => {
    const match = String(value || '').match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!match || !match[2]) return value;
    const core = normalize(match[2]);
    if (!core) return value;
    const translated = lookup(core);
    if (!translated || translated === core) return value;
    return `${match[1]}${translated}${match[3]}`;
  };

  const translateAttribute = (value) => {
    const core = normalize(value);
    if (!core) return value;
    return lookup(core) || value;
  };

  const HARD_SKIP = 'script, style, [data-i18n-km], [data-i18n-skip]';
  const CONTENT_SKIP = 'textarea, pre, code';

  const shouldHardSkip = (element) => Boolean(element && element.closest(HARD_SKIP));
  const shouldSkipContent = (element) => Boolean(element && element.closest(CONTENT_SKIP));

  const translateElementAttributes = (element) => {
    ['placeholder', 'title', 'aria-label', 'alt'].forEach((name) => {
      if (!element.hasAttribute(name)) return;
      const value = element.getAttribute(name);
      const translated = translateAttribute(value);
      if (translated !== value) element.setAttribute(name, translated);
    });
  };

  const processNode = (node) => {
    if (!node) return;

    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (!parent || shouldHardSkip(parent) || shouldSkipContent(parent)) return;
      const translated = translateText(node.nodeValue);
      if (translated !== node.nodeValue) node.nodeValue = translated;
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (shouldHardSkip(node)) return;

    translateElementAttributes(node);
    if (shouldSkipContent(node)) return;
    node.childNodes.forEach(processNode);
  };

  const queue = new Set();
  let frame = 0;

  const flush = () => {
    frame = 0;
    const nodes = [...queue];
    queue.clear();
    nodes.forEach(processNode);
  };

  const schedule = (node) => {
    if (!node) return;
    queue.add(node);
    if (frame) return;
    frame = window.requestAnimationFrame(flush);
  };

  if (locale === 'km' && dictionaryNode) {
    processNode(document.body);

    if ('MutationObserver' in window) {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'childList') {
            mutation.addedNodes.forEach(schedule);
          } else if (mutation.type === 'characterData') {
            schedule(mutation.target);
          } else if (mutation.type === 'attributes') {
            schedule(mutation.target);
          }
        });
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['placeholder', 'title', 'aria-label', 'alt']
      });
    }
  }

  /* ==========================================================================
     Language switch + unsaved form preservation
     The app is server-rendered, so the switch reloads the same route with the
     new locale cookie. Text/select/checkbox values are restored afterwards.
     ========================================================================== */
  const pageKey = () => `${window.location.pathname}${window.location.search}`;

  const saveFormState = () => {
    try {
      const forms = [...document.forms].map((form) => ({
        action: form.getAttribute('action') || '',
        method: form.getAttribute('method') || 'get',
        fields: [...form.elements]
          .filter((field) => field.name && !['submit', 'button', 'reset', 'file'].includes(field.type))
          .map((field) => ({
            name: field.name,
            type: field.type,
            value: field.value,
            checked: Boolean(field.checked)
          }))
      }));
      window.sessionStorage.setItem(FORM_STATE_KEY, JSON.stringify({ path: pageKey(), forms }));
    } catch (error) {
      /* private mode */
    }
  };

  const restoreFormState = () => {
    try {
      const raw = window.sessionStorage.getItem(FORM_STATE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw);
      window.sessionStorage.removeItem(FORM_STATE_KEY);
      if (!state || state.path !== pageKey() || !Array.isArray(state.forms)) return;

      state.forms.forEach((saved, formIndex) => {
        const form = document.forms[formIndex];
        if (!form) return;
        const fields = [...form.elements].filter((field) => field.name);
        saved.fields.forEach((savedField) => {
          const field = fields.find((candidate) => candidate.name === savedField.name);
          if (!field || field.type === 'file') return;
          if (field.type === 'checkbox' || field.type === 'radio') {
            field.checked = Boolean(savedField.checked);
          } else {
            field.value = savedField.value;
          }
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });
    } catch (error) {
      /* ignore malformed state */
    }
  };

  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('[data-language-switch]') : null;
    if (!link) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === '_blank') return;

    saveFormState();
    try {
      window.localStorage.setItem('artspace-locale', link.dataset.languageSwitch || '');
    } catch (error) {
      /* private mode */
    }
    root.classList.add('lang-switching');
  });

  restoreFormState();
})();
