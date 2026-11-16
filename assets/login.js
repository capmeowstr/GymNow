/* Ark's public browser login flow, verified against its client on 5 Nov 2026.
 * Passwords stay in this invocation and the official HTTPS request body.
 * No credential is written to web storage, URLs, logs, or result messages.
 */
async function signInArk(config, dependencies) {
  'use strict';
  dependencies = dependencies || {};
  const origin = dependencies.origin === undefined ? location.origin : dependencies.origin;
  const pathname = dependencies.pathname === undefined ? location.pathname : dependencies.pathname;
  if (origin !== 'https://arkkies.com' || pathname !== '/login') return {type: 'blocked'};
  if (!config || typeof config.identifier !== 'string' || !config.identifier.trim() ||
      typeof config.password !== 'string' || !config.password) return {type: 'invalid'};
  const request = dependencies.fetch || fetch;
  const api = 'https://api.arkkies.com';
  const base = api + '/v2/auth/provider/public';
  async function json(url, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await request(url, {
        method: body ? 'POST' : 'GET', credentials: 'include', redirect: 'error',
        headers: {Accept: 'application/json', 'Content-Type': 'application/json'},
        body: body ? JSON.stringify(body) : undefined, signal: controller.signal
      });
      let data = null;
      try { data = await response.json(); } catch (_) {}
      return {status: response.status, ok: response.ok, data};
    } finally { clearTimeout(timer); }
  }
  try {
    const flow = await json(base + '/self-service/login/browser?refresh=true');
    if (!flow.ok) return {type: flow.status === 429 ? 'limited' : 'unavailable'};
    const ui = flow.data && flow.data.ui;
    if (!ui || !Array.isArray(ui.nodes) || typeof ui.action !== 'string' ||
        String(ui.method).toUpperCase() !== 'POST') return {type: 'unavailable'};
    const action = new URL(ui.action, api + '/v2/');
    if (action.origin !== api || action.username || action.password || action.hash ||
        action.pathname !== '/v2/auth/provider/public/self-service/login' ||
        !/^[a-f0-9-]{16,80}$/i.test(action.searchParams.get('flow') || '') ||
        [...action.searchParams.keys()].some(key => key !== 'flow')) return {type: 'blocked'};
    const csrf = ui.nodes.find(n => n && n.attributes && n.attributes.name === 'csrf_token');
    const password = ui.nodes.find(n => n && n.group === 'password' && n.attributes && n.attributes.name === 'password');
    const identifier = ui.nodes.find(n => n && n.attributes &&
      (n.attributes.name === 'identifier' || n.attributes.name === 'password_identifier'));
    if (!csrf || typeof csrf.attributes.value !== 'string' || !csrf.attributes.value || !password)
      return {type: 'verification'};
    const body = {
      csrf_token: csrf.attributes.value, method: 'password',
      password: config.password
    };
    body[identifier ? identifier.attributes.name : 'password_identifier'] = config.identifier.trim();
    const login = await json(action.href, body);
    if (!login.ok) {
      if (login.status === 429) return {type: 'limited'};
      if (login.status === 400 || login.status === 401) return {type: 'invalid'};
      if (login.status === 403 || login.status === 422) return {type: 'verification'};
      return {type: 'unavailable'};
    }
    const session = await json(base + '/sessions/whoami');
    const identity = session.data && session.data.identity;
    if (!session.ok || !identity || typeof identity.id !== 'string' || !identity.id)
      return {type: 'verification'};
    if (config.expectedIdentity && identity.id !== config.expectedIdentity) return {type: 'mismatch'};
    // Where available, verify the email too before saving a manually supplied credential.
    const email = identity.traits && identity.traits.email;
    if (typeof email === 'string' && email.toLowerCase() !== config.identifier.trim().toLowerCase())
      return {type: 'mismatch'};
    return {type: 'success', identity: identity.id};
  } catch (_) { return {type: 'network'}; }
  finally { config.password = ''; }
}
if (typeof module !== 'undefined') module.exports = {signInArk};
