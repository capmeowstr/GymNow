// Runs in Ark's own document. No password fields, cookies or tokens are read.
(async function () {
  'use strict';
  const config = GYM_NOW_CONFIG;
  if (location.origin !== 'https://arkkies.com' || window.__gymNowJobToken === config.token) return;
  window.__gymNowJobToken = config.token;
  function signal(type, value) {
    const url = 'gymnow://event?token=' + encodeURIComponent(config.token) + '&type=' + encodeURIComponent(type) +
      '&value=' + encodeURIComponent(String(value || ''));
    location.href = url;
  }
  async function request(path, options = {}) {
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), 18000);
    try {
      const response = await fetch('https://api.arkkies.com/v2' + path, {
        method: options.method || 'GET', credentials: 'include', redirect: 'error',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Ark-Outlet': config.outlet },
        body: options.body ? JSON.stringify(options.body) : undefined, signal: control.signal
      });
      if (!response.ok) {
        const error = new Error(response.status === 401 ? 'Please sign in to Ark below.' :
          'Ark declined the request (HTTP ' + response.status + '). Check your booking in the portal.');
        error.status = response.status;
        if (response.status === 401) error.code = 'AUTH';
        throw error;
      }
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    } finally { clearTimeout(timer); }
  }
  const pending = {
    has: key => localStorage.getItem('gym-now-pending|' + key) === '1',
    mark: key => localStorage.setItem('gym-now-pending|' + key, '1'),
    clear: key => localStorage.removeItem('gym-now-pending|' + key)
  };
  async function choosePass(passes) {
    if (config.passId && passes.some(p => p.id === config.passId)) return config.passId;
    return new Promise((resolve, reject) => {
      function receive(event) {
        if (!event.detail || event.detail.token !== config.token) return;
        window.removeEventListener('gym-now-pass', receive);
        if (event.detail.id === null) reject(new Error('Booking cancelled before submission.'));
        else resolve(String(event.detail.id));
      }
      window.addEventListener('gym-now-pass', receive);
      signal('passes', JSON.stringify(passes));
    });
  }
  try {
    await createArkGymEngine(config).run({
      request, pending, choosePass,
      notify: text => signal('status', text),
      openEntry: async id => signal('done', id)
    });
  } catch (error) {
    signal(error.code === 'AUTH' ? 'auth' : 'error', error.message || 'The request failed. Check your booking in Ark.');
  }
})();
