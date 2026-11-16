const {test} = require('node:test');
const assert = require('node:assert/strict');
const {signInArk} = require('../assets/login.js');

const base = 'https://api.arkkies.com/v2/auth/provider/public';
const action = base + '/self-service/login?flow=afc21755-6418-4b22-b24d-81bf87618d30';
const secret = 'test-only-secret-!漢字';
function fixture(overrides = {}) {
  const calls = [];
  const config = {identifier: 'person@example.test', password: secret, expectedIdentity: 'account-a'};
  const responses = [
    {status: 200, data: {ui: {action, method: 'POST', nodes: [
      {group: 'default', attributes: {name: 'identifier', value: ''}},
      {group: 'default', attributes: {name: 'csrf_token', value: 'test-only-csrf'}},
      {group: 'password', attributes: {name: 'password', type: 'password'}}
    ]}}},
    {status: 200, data: {}},
    {status: 200, data: {identity: {id: 'account-a', traits: {email: 'person@example.test'}}}}
  ];
  const deps = {origin: 'https://arkkies.com', pathname: '/login', fetch: async (url, options) => {
    calls.push({url, options});
    const response = responses[calls.length - 1];
    if (!response) throw new Error('Unexpected repeated request');
    if (response.throw) throw new Error('test-only network error containing ' + secret);
    return {status: response.status, ok: response.status >= 200 && response.status < 300,
      json: async () => response.data};
  }, ...overrides};
  return {config, responses, deps, calls, run: () => signInArk(config, deps)};
}
test('uses fresh CSRF by name, posts only to the official endpoint, then verifies the account', async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), {type: 'success', identity: 'account-a'});
  assert.deepEqual(f.calls.map(x => x.url), [base + '/self-service/login/browser?refresh=true', action, base + '/sessions/whoami']);
  const body = JSON.parse(f.calls[1].options.body);
  assert.deepEqual(body, {csrf_token: 'test-only-csrf', method: 'password', password: secret, identifier: 'person@example.test'});
  assert.ok(f.calls.every(x => x.options.credentials === 'include' && x.options.redirect === 'error' && !x.url.includes(secret)));
  assert.equal(f.config.password, '');
});
test('rejects an incorrect password once and does not book or repeat sign-in', async () => {
  const f = fixture(); f.responses[1] = {status: 400, data: {error: {message: secret}}};
  assert.deepEqual(await f.run(), {type: 'invalid'});
  assert.equal(f.calls.length, 2); assert.equal(f.config.password, '');
});
test('rate limiting stops sign-in immediately', async () => {
  const f = fixture(); f.responses[1].status = 429;
  assert.deepEqual(await f.run(), {type: 'limited'}); assert.equal(f.calls.length, 2);
});
test('does not expose server errors or passwords in network failures', async () => {
  const f = fixture(); f.responses[1].throw = true;
  const result = await f.run(); assert.deepEqual(result, {type: 'network'});
  assert.ok(!JSON.stringify(result).includes(secret)); assert.equal(f.config.password, '');
});
test('an unauthenticated whoami never counts as successful login', async () => {
  const f = fixture(); f.responses[2] = {status: 401, data: {}};
  assert.deepEqual(await f.run(), {type: 'verification'});
});
test('the saved account cannot silently change', async () => {
  const f = fixture(); f.responses[2].data.identity.id = 'account-b';
  assert.deepEqual(await f.run(), {type: 'mismatch'});
});
test('a manually supplied password must match the returned email when present', async () => {
  const f = fixture(); f.config.expectedIdentity = ''; f.responses[2].data.identity.traits.email = 'someone-else@example.test';
  assert.deepEqual(await f.run(), {type: 'mismatch'});
});
test('email comparison is case insensitive and identifiers are trimmed', async () => {
  const f = fixture(); f.config.identifier = '  Person@Example.Test  ';
  assert.equal((await f.run()).type, 'success');
  assert.equal(JSON.parse(f.calls[1].options.body).identifier, 'Person@Example.Test');
});
test('also supports the password_identifier field used by the published web client', async () => {
  const f = fixture(); f.responses[0].data.ui.nodes[0].attributes.name = 'password_identifier';
  assert.equal((await f.run()).type, 'success');
  assert.equal(JSON.parse(f.calls[1].options.body).password_identifier, 'person@example.test');
});
test('refuses credential submission to lookalike origins and unrelated API actions', async () => {
  for (const url of ['https://api.arkkies.com.evil.test/v2/auth/provider/public/self-service/login?flow=afc21755-6418-4b22-b24d-81bf87618d30',
    action.replace('https:', 'http:'), action.replace('api.arkkies.com', 'user@api.arkkies.com'),
    action.replace('/self-service/login?', '/self-service/settings?'), action + '&return_to=https://evil.test', action + '#fragment']) {
    const f = fixture(); f.responses[0].data.ui.action = url;
    assert.deepEqual(await f.run(), {type: 'blocked'}); assert.equal(f.calls.length, 1);
  }
});
test('does not run on other pages or origins', async () => {
  for (const overrides of [{origin: 'https://evil.test'}, {origin: 'https://arkkies.com.evil.test'}, {pathname: '/entry'}]) {
    const f = fixture(overrides); assert.deepEqual(await f.run(), {type: 'blocked'}); assert.equal(f.calls.length, 0);
  }
});
test('missing password or CSRF fields require website verification', async () => {
  for (const name of ['csrf_token', 'password']) {
    const f = fixture(); f.responses[0].data.ui.nodes = f.responses[0].data.ui.nodes.filter(n => n.attributes.name !== name);
    assert.deepEqual(await f.run(), {type: 'verification'}); assert.equal(f.calls.length, 1);
  }
});
test('unfamiliar or malformed login flow does not send a password', async () => {
  const f = fixture(); f.responses[0].data = {ui: {action, method: 'GET', nodes: []}};
  assert.deepEqual(await f.run(), {type: 'unavailable'}); assert.equal(f.calls.length, 1);
});
test('verification requirements are handed back to the official website', async () => {
  for (const status of [403, 422]) {
    const f = fixture(); f.responses[1].status = status;
    assert.deepEqual(await f.run(), {type: 'verification'}); assert.equal(f.calls.length, 2);
  }
});
