// Selects a named door through Ark's visible control on a verified entry page.
// The only interactions are opening that control and choosing its Main Door option.
function selectArkMainDoor(config) {
  'use strict';
  const target = new URL(config.entryUrl);
  if (location.origin !== 'https://arkkies.com' || location.pathname !== '/entry' ||
      target.origin !== location.origin || target.pathname !== '/entry' ||
      location.search !== target.search || !target.searchParams.get('booking-id')) return 'wrong-page';

  const normalize = value => String(value || '').replace(/[\u200b-\u200d\ufeff]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
  const visible = element => element && element.getClientRects().length > 0 &&
    !element.closest('[hidden]') && getComputedStyle(element).visibility !== 'hidden';
  const enabled = element => !element.disabled && element.getAttribute('aria-disabled') !== 'true';
  let state = window.__gymNowDoorSelection;
  if (!state || state.token !== config.token) {
    state = {token: config.token, field: null, opened: false, requested: false, complete: false};
    window.__gymNowDoorSelection = state;
  }
  if (state.complete) return 'selected';

  const labels = Array.from(document.querySelectorAll('p, label, legend, h1, h2, h3, h4, h5, h6'))
    .filter(element => visible(element) && normalize(element.textContent) === 'select door to unlock');
  if (!labels.length) return 'waiting';
  if (labels.length !== 1) return 'ambiguous';
  const container = labels[0].nextElementSibling;
  if (!container) return 'waiting';
  const fields = Array.from(container.querySelectorAll('select, [role="combobox"], [aria-haspopup="listbox"]'))
    .filter(visible);
  if (!fields.length) return 'waiting';
  if (fields.length !== 1) return 'ambiguous';
  const field = fields[0];
  if (!enabled(field)) return 'waiting';
  if (state.field !== field) {
    state.field = field;
    state.opened = false;
    state.requested = false;
  }

  if (field.tagName === 'SELECT') {
    const options = Array.from(field.options).filter(option => normalize(option.textContent) === 'main door');
    if (!options.length) return field.options.length > 1 ? 'unavailable' : 'waiting';
    if (options.length !== 1) return 'ambiguous';
    const option = options[0];
    if (!enabled(option) || (option.parentElement.tagName === 'OPTGROUP' && option.parentElement.disabled)) return 'unavailable';
    if (field.value === option.value) { state.complete = true; return 'selected'; }
    if (!state.requested) {
      state.requested = true;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(field, option.value);
      field.dispatchEvent(new Event('change', {bubbles: true}));
    }
    return 'waiting';
  }

  if (normalize(field.textContent) === 'main door') { state.complete = true; return 'selected'; }
  if (state.requested) return 'waiting';
  const ids = (field.getAttribute('aria-controls') || field.getAttribute('aria-owns') || '').trim().split(/\s+/).filter(Boolean);
  const owned = ids.map(id => document.getElementById(id)).filter(element => visible(element) && element.getAttribute('role') === 'listbox');
  const menus = ids.length ? owned : (field.getAttribute('aria-expanded') === 'true' ?
    Array.from(document.querySelectorAll('[role="listbox"]')).filter(visible) : []);
  if (menus.length > 1) return 'ambiguous';
  if (menus.length === 1) {
    const options = Array.from(menus[0].querySelectorAll('[role="option"]')).filter(visible);
    const mainDoors = options.filter(option => normalize(option.textContent) === 'main door');
    if (mainDoors.length > 1) return 'ambiguous';
    if (!mainDoors.length) return options.length ? 'unavailable' : 'waiting';
    if (!enabled(mainDoors[0])) return 'unavailable';
    state.requested = true;
    mainDoors[0].click();
    return 'waiting';
  }
  if (!state.opened) {
    state.opened = true;
    field.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true, view: window, button: 0, buttons: 1}));
  }
  return 'waiting';
}
