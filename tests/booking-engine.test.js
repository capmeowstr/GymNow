const { test } = require('node:test');
const assert = require('node:assert/strict');
const createEngine = require('../assets/booking-engine.js');
const engine = createEngine();
const clone = value => JSON.parse(JSON.stringify(value));
const instant = Date.parse('2026-10-20T11:00:00+08:00');
const active = { id: 'existing', purpose_type: 'gym-time', time_start: '2026-10-20T09:00:00+08:00',
  time_end: '2026-10-20T12:00:00+08:00', booking_slot: { id: 'slot', outlet_id: 'AGRKHG01', doors: ['door'] } };
const subscription = { subscription: { id: 'monthly' }, pass: { name: 'Monthly Season Pass',
  access_type: 'gym-access', allowed_bookings_at: 'AGRBIS01,AGRKHG01' } };
const selection = { id: 'selection', selection_date_time_start: active.time_start,
  selection_date_time_end: active.time_end, slot: { id: 'slot', type: 'gym-time', outlet_id: 'AGRKHG01', requires: 'gym-access' } };
function fixture(config = {}) {
  const calls = [], opened = [], records = config.records || new Set(config.pending || []);
  const core = createEngine({ outlet: config.outlet || 'AGRKHG01' });
  let reads = 0, created = false;
  const options = {
    now: config.now || (() => instant),
    choosePass: config.choosePass,
    pending: { has: k => records.has(k), mark: k => records.add(k), clear: k => records.delete(k) },
    openEntry: async id => opened.push(id),
    request: async (path, data = {}) => {
      calls.push({ path, method: data.method || 'GET', body: data.body });
      if (config.authenticationError) throw Object.assign(new Error('Session expired'), { status: 401 });
      if (path === '/auth/provider/public/sessions/whoami') return config.badIdentity ? {} : { identity: { id: config.account || 'account-one' } };
      if (data.method === 'POST') {
        if (!config.noCreation) created = true;
        if (config.postError) throw config.postError;
        return {};
      }
      if (path === '/brand/outlet/booking') {
        reads++;
        if (config.malformed) return { bookings: {} };
        if (created) return { bookings: [clone({ ...active, id: 'new', booking_slot: { ...active.booking_slot, outlet_id: config.outlet || 'AGRKHG01' } })] };
        if (config.nullBookings) return { bookings: null };
        if (config.concurrent && reads >= 2) return { bookings: [clone(active)] };
        return { bookings: clone(config.bookings || []) };
      }
      if (path === '/customer/subscription/active') return { active_subscriptions: clone(config.passes || [subscription]) };
      if (path.includes('/slot/')) return { selections: clone(config.slots || [selection]) };
      throw new Error('Unexpected path: ' + path);
    }
  };
  return { run: () => core.run(options), calls, opened, records,
    posts: () => calls.filter(c => c.method === 'POST') };
}
test('reuses current booking without looking at passes or creating anything', async () => {
  const f = fixture({ bookings: [active] });
  assert.deepEqual(await f.run(), { reused: true, bookingId: 'existing' });
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.opened, ['existing']);
});
test('books exactly the selected current slot using only the monthly subscription', async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), { reused: false, bookingId: 'new' });
  assert.equal(f.posts().length, 1);
  assert.deepEqual(f.posts()[0].body, { time_start: active.time_start, time_end: active.time_end,
    purpose_type: 'gym-time', booking_slot_id: 'slot', corresponding_item_ids: ['monthly'] });
  assert.equal(f.records.size, 0);
});
test('ignores a current booking at another outlet', async () => {
  const b = clone(active); b.booking_slot.outlet_id = 'AGRBIS01';
  const f = fixture({ bookings: [b] });
  await f.run(); assert.equal(f.posts().length, 1); assert.deepEqual(f.opened, ['new']);
});
test('does not treat an expired or future booking as current', async () => {
  const b = clone(active); b.time_end = '2026-10-20T10:00:00+08:00';
  const c = clone(active); c.time_start = '2026-10-20T12:00:00+08:00'; c.time_end = '2026-10-20T15:00:00+08:00';
  const f = fixture({ bookings: [b, c] }); await f.run(); assert.equal(f.posts().length, 1);
});
test('stops when several current bookings are returned', async () => {
  const f = fixture({ bookings: [active, { ...active, id: 'another' }] });
  await assert.rejects(f.run(), /More than one/); assert.equal(f.posts().length, 0);
});
test('stops for no active subscription', async () => {
  const f = fixture({ passes: [] }); await assert.rejects(f.run(), /No active gym subscription/); assert.equal(f.posts().length, 0);
});
test('does not substitute a subscription with the wrong access type', async () => {
  const pass = clone(subscription); pass.pass.access_type = 'class-access';
  const f = fixture({ passes: [pass] }); await assert.rejects(f.run(), /No active gym subscription/); assert.equal(f.posts().length, 0);
});
test('requires the subscription to cover Keat Hong', async () => {
  const pass = clone(subscription); pass.pass.allowed_bookings_at = 'AGRBIS01';
  const f = fixture({ passes: [pass] }); await assert.rejects(f.run(), /No active gym subscription/); assert.equal(f.posts().length, 0);
});
test('stops rather than guessing between two monthly subscriptions', async () => {
  const f = fixture({ passes: [subscription, { ...subscription, subscription: { id: 'second' } }] });
  await assert.rejects(f.run(), /Several gym subscriptions/); assert.equal(f.posts().length, 0);
});
test('stops for no current available slot', async () => {
  const f = fixture({ slots: [] }); await assert.rejects(f.run(), /no available gym slot/); assert.equal(f.posts().length, 0);
});
test('does not book a future slot', async () => {
  const s = clone(selection); s.selection_date_time_start = '2026-10-20T12:00:00+08:00'; s.selection_date_time_end = '2026-10-20T15:00:00+08:00';
  const f = fixture({ slots: [s] }); await assert.rejects(f.run(), /no available gym slot/); assert.equal(f.posts().length, 0);
});
test('stops if overlapping available slots are ambiguous', async () => {
  const f = fixture({ slots: [selection, selection] }); await assert.rejects(f.run(), /Several current slots/); assert.equal(f.posts().length, 0);
});
test('stops if the slot requires an additional pass', async () => {
  const s = clone(selection); s.slot.requires = 'gym-access,class-access';
  const f = fixture({ slots: [s] }); await assert.rejects(f.run(), /additional pass/); assert.equal(f.posts().length, 0);
});
test('stops if it cannot prove the slot pass requirement', async () => {
  const s = clone(selection); s.slot.requires = '';
  const f = fixture({ slots: [s] }); await assert.rejects(f.run(), /additional pass/); assert.equal(f.posts().length, 0);
});
test('checks again before booking and reuses a concurrently created booking', async () => {
  const f = fixture({ concurrent: true }); assert.equal((await f.run()).reused, true); assert.equal(f.posts().length, 0);
});
test('a timed out POST can succeed; verification recovers it without a second POST', async () => {
  const f = fixture({ postError: new Error('Timeout') }); await f.run();
  assert.equal(f.posts().length, 1); assert.deepEqual(f.opened, ['new']);
});
test('keeps an uncertain attempt marker and does not automatically resubmit', async () => {
  const f = fixture({ noCreation: true, postError: new Error('Timeout') });
  await assert.rejects(f.run(), /could not be verified/); assert.equal(f.posts().length, 1); assert.equal(f.records.size, 1);
  await assert.rejects(f.run(), /earlier booking attempt/); assert.equal(f.posts().length, 1);
});
test('clears the attempt marker after an explicit rejected request', async () => {
  const f = fixture({ noCreation: true, postError: Object.assign(new Error('Slot full'), { status: 409 }) });
  await assert.rejects(f.run(), /Slot full/); assert.equal(f.records.size, 0);
});
test('authentication failure never creates a booking', async () => {
  const f = fixture({ authenticationError: true }); await assert.rejects(f.run(), /Session expired/); assert.equal(f.posts().length, 0);
});
test('unfamiliar booking response stops without a write', async () => {
  const f = fixture({ malformed: true }); await assert.rejects(f.run(), /unfamiliar/); assert.equal(f.posts().length, 0);
});
test('Singapore timestamps work for naive dates and midnight rollover', () => {
  assert.equal(engine.timestamp('2026-10-20 09:00:00'), Date.parse('2026-10-20T09:00:00+08:00'));
  assert.equal(engine.contains('2026-10-20T23:00:00+08:00', '2026-10-21T02:00:00+08:00', Date.parse('2026-10-21T01:00:00+08:00')), true);
});
test('slot start is inclusive and slot end is exclusive', () => {
  assert.equal(engine.contains(active.time_start, active.time_end, engine.timestamp(active.time_start)), true);
  assert.equal(engine.contains(active.time_start, active.time_end, engine.timestamp(active.time_end)), false);
});
test('a time boundary crossed during checking stops before POST', async () => {
  let calls = 0;
  const before = Date.parse('2026-10-20T11:59:59+08:00'), after = Date.parse('2026-10-20T12:00:00+08:00');
  const f = fixture({ now: () => ++calls >= 4 ? after : before });
  await assert.rejects(f.run(), /time slot changed/); assert.equal(f.posts().length, 0);
});
test('another account can use an annual gym subscription without a hardcoded pass name', async () => {
  const pass = clone(subscription); pass.pass.name = 'Annual Gym Membership'; pass.subscription.id = 'annual-two';
  const f = fixture({ account: 'account-two', passes: [pass] });
  await f.run(); assert.deepEqual(f.posts()[0].body.corresponding_item_ids, ['annual-two']);
});
test('an explicit subscription choice is used when several match', async () => {
  const pass = clone(subscription); pass.subscription.id = 'chosen-pass'; pass.pass.name = 'Another active subscription';
  const f = fixture({ passes: [subscription, pass], choosePass: async () => 'chosen-pass' });
  await f.run(); assert.deepEqual(f.posts()[0].body.corresponding_item_ids, ['chosen-pass']);
});
test('a stale subscription choice from another account cannot be used', async () => {
  const f = fixture({ choosePass: async () => 'a-pass-this-account-does-not-own' });
  await assert.rejects(f.run(), /No subscription was selected/); assert.equal(f.posts().length, 0);
});
test('account-scoped pending markers do not block a different account', async () => {
  const records = new Set();
  const first = fixture({ records, account: 'first-user', noCreation: true, postError: new Error('Lost response') });
  await assert.rejects(first.run(), /could not be verified/); assert.equal(records.size, 1);
  const second = fixture({ records, account: 'second-user' });
  await second.run(); assert.equal(second.posts().length, 1); assert.equal(records.size, 1);
});
test('a matching subscription can book a different configured outlet', async () => {
  const slot = clone(selection); slot.slot.outlet_id = 'AGRBIS01';
  const f = fixture({ outlet: 'AGRBIS01', slots: [slot] });
  await f.run(); assert.equal(f.posts().length, 1);
  assert.ok(f.calls.some(c => c.path.includes('/destination/AGRBIS01/')));
});
test('missing authenticated identity stops before any booking request', async () => {
  const f = fixture({ badIdentity: true });
  await assert.rejects(f.run(), e => e.code === 'AUTH'); assert.equal(f.posts().length, 0);
});
test('a malformed outlet cannot become an API path', () => {
  assert.throws(() => createEngine({outlet: 'AGRKHG01/../../'}), /Invalid gym ID/);
});
test('a null empty booking collection can be booked normally', async () => {
  const f = fixture({ nullBookings: true });
  await f.run(); assert.equal(f.posts().length, 1); assert.deepEqual(f.opened, ['new']);
});
