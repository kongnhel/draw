(() => {
  'use strict';

  const studio = document.querySelector('[data-admin-studio]');
  if (!studio) return;

  const search = studio.querySelector('[data-admin-search]');
  const statusFilter = studio.querySelector('[data-admin-status-filter]');
  const rows = [...studio.querySelectorAll('[data-admin-row]')];
  const groups = ['artworks', 'users', 'reports'];

  const applyFilters = () => {
    const query = (search?.value || '').trim().toLowerCase();
    const status = statusFilter?.value || 'all';
    const visibleByGroup = { artworks: 0, users: 0, reports: 0 };

    rows.forEach((row) => {
      const group = row.dataset.adminGroup || '';
      const haystack = (row.dataset.search || '').toLowerCase();
      const matchesQuery = !query || haystack.includes(query);
      const matchesStatus = group !== 'artworks' || status === 'all' || row.dataset.status === status;
      const matches = matchesQuery && matchesStatus;
      row.hidden = !matches;
      if (matches && visibleByGroup[group] !== undefined) visibleByGroup[group] += 1;
    });

    groups.forEach((group) => {
      const empty = studio.querySelector(`[data-admin-empty="${group}"]`);
      if (empty) empty.hidden = visibleByGroup[group] > 0;
    });
  };

  search?.addEventListener('input', applyFilters);
  statusFilter?.addEventListener('change', applyFilters);
  search?.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    search.value = '';
    applyFilters();
  });

  studio.querySelectorAll('[data-admin-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      studio.querySelectorAll('[data-admin-tab]').forEach((item) => item.classList.remove('is-active'));
      tab.classList.add('is-active');
    });
  });

  applyFilters();
})();
