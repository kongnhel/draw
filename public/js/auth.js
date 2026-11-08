(() => {
  'use strict';

  const toggles = document.querySelectorAll('[data-password-toggle]');
  if (!toggles.length) return;

  toggles.forEach((toggle) => {
    const field = toggle.closest('.auth-field');
    const input = field ? field.querySelector('input') : null;
    if (!input) return;

    toggle.addEventListener('click', () => {
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', String(reveal));
      toggle.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');

      const cursor = input.value.length;
      input.focus({ preventScroll: true });
      try {
        input.setSelectionRange(cursor, cursor);
      } catch (error) {
        /* input type may not support selection */
      }
    });
  });
})();
