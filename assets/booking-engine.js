/* Gym Now Android v0.2. Uses the requests in Ark's public web client, checked 20 Oct 2026. */
function createArkGymEngine(configuration) {
  'use strict';
  configuration = configuration || {};
  const outlet = configuration.outlet || 'AGRKHG01';
  const gymName = configuration.gymName || 'the selected gym';
  if (!/^[A-Z0-9]{6,16}$/.test(outlet)) throw new Error('Invalid gym ID.');
  const base = '/brand/outlet/booking';
  const fail = message => { throw new Error(message); };
  function timestamp(value) {
    if (typeof value !== 'string') return NaN;
    let text = value.trim();
    if (/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(text)) {
      text = text.replace(' ', 'T') + '+08:00';
    }
    return Date.parse(text);
  }
  function contains(start, end, at) {
    const a = timestamp(start), b = timestamp(end);
    return Number.isFinite(a) && Number.isFinite(b) && a <= at && at < b;
  }
  function array(data, key) {
    if (data && Object.prototype.hasOwnProperty.call(data, key) && data[key] === null) return [];
    if (!data || !Array.isArray(data[key])) fail('The portal returned an unfamiliar response. Open the portal and book normally.');
    return data[key];
  }
  function current(bookings, at) {
    const matches = bookings.filter(b => b && b.booking_slot && b.booking_slot.outlet_id === outlet &&
      b.purpose_type === 'gym-time' && contains(b.time_start, b.time_end, at));
    if (matches.length > 1) fail('More than one current gym booking was found. Choose the correct one in the portal.');
    if (matches.length && !matches[0].id) fail('The current booking has no entry reference. Check it in the portal.');
    return matches[0];
  }
  async function run(options) {
    const { request, openEntry, now = Date.now, notify = () => {}, pending, choosePass } = options;
    const readBookings = async () => array(await request(base), 'bookings');
    const open = async (booking, reused) => {
      notify(reused ? 'Opening your existing booking…' : 'Booking verified. Opening Remote Entry…');
      await openEntry(booking.id);
      return { reused, bookingId: booking.id };
    };
    notify('Checking your sign-in…');
    const session = await request('/auth/provider/public/sessions/whoami');
    if (!session || !session.identity || !session.identity.id) {
      const error = new Error('Please sign in to Ark below.'); error.code = 'AUTH'; throw error;
    }
    const accountScope = String(session.identity.id);
    if (configuration.expectedIdentity && accountScope !== configuration.expectedIdentity)
      fail('A different Ark account is signed in. Use Account → Switch Ark account before booking.');
    notify('Checking your current booking…');
    let booking = current(await readBookings(), now());
    if (booking) return open(booking, true);
    notify('Checking your active gym subscription…');
    const subscriptions = array(await request('/customer/subscription/active'), 'active_subscriptions');
    const passes = subscriptions.filter(s => s && s.subscription && s.subscription.id && s.pass && typeof s.pass.name === 'string' &&
      s.pass.access_type === 'gym-access' &&
      String(s.pass.allowed_bookings_at || '').split(',').map(x => x.trim()).includes(outlet));
    if (!passes.length) fail('No active gym subscription covers ' + gymName + '. Check the gym selection and your membership in Ark.');
    let chosen;
    if (choosePass) {
      const id = await choosePass(passes.map(p => ({ id: String(p.subscription.id), name: p.pass.name })));
      chosen = passes.find(p => String(p.subscription.id) === String(id));
      if (!chosen) fail('No subscription was selected. No booking was created.');
    } else {
      if (passes.length !== 1) fail('Several gym subscriptions match. Select one before booking.');
      chosen = passes[0];
    }
    notify('Finding the slot covering now…');
    const path = base + '/slot/destination/' + outlet + '/filter/access-type/type/gym-access/days/7/topic/*';
    const selections = array(await request(path), 'selections');
    const matches = selections.filter(s => s && s.slot && s.slot.outlet_id === outlet &&
      s.slot.type === 'gym-time' && contains(s.selection_date_time_start, s.selection_date_time_end, now()));
    if (matches.length !== 1) fail(matches.length ? 'Several current slots match. Choose one in the portal.' :
      'There is no available gym slot covering now. Check the portal for availability.');
    const selection = matches[0];
    const requires = String(selection.slot.requires || '').split(',').map(x => x.trim()).filter(Boolean);
    if (!selection.slot.id || requires.length !== 1 || requires[0] !== 'gym-access') {
      fail('This slot needs a different or additional pass. Complete this booking in the portal.');
    }
    booking = current(await readBookings(), now());
    if (booking) return open(booking, true);
    if (!contains(selection.selection_date_time_start, selection.selection_date_time_end, now())) {
      fail('The time slot changed while checking. Run Gym Now again.');
    }
    const signature = [accountScope, outlet, selection.slot.id, selection.selection_date_time_start,
      selection.selection_date_time_end].join('|');
    if (pending && pending.has(signature)) fail('An earlier booking attempt has an uncertain result. Check Bookings in the portal before trying again.');
    const body = {
      time_start: selection.selection_date_time_start,
      time_end: selection.selection_date_time_end,
      purpose_type: selection.slot.type,
      booking_slot_id: selection.slot.id,
      corresponding_item_ids: [chosen.subscription.id]
    };
    if (pending) pending.mark(signature);
    notify('Booking ' + gymName + ' for the current slot…');
    let postError;
    try { await request(base, { method: 'POST', body }); }
    catch (error) { postError = error; }
    // A lost response can still mean success. Read back; never repeat the POST.
    try { booking = current(await readBookings(), now()); }
    catch { fail('The booking result could not be checked. Open Bookings in the portal before trying again.'); }
    if (booking) {
      if (pending) pending.clear(signature);
      return open(booking, false);
    }
    if (postError && postError.status >= 400 && postError.status < 500) {
      if (pending) pending.clear(signature);
      fail(postError.message);
    }
    fail('The booking could not be verified. Check Bookings in the portal before trying again.');
  }
  return { run, outlet, timestamp, contains };
}
if (typeof module !== 'undefined' && module.exports) module.exports = createArkGymEngine;
