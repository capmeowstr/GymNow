const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'assets/booking-engine.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(root, 'assets/runner.js'), 'utf8');
function fixture(unauthenticated) {
  const calls = [], events = [], listeners = new Map(), storage = new Map();
  let created = false;
  const now = Date.now();
  const start = new Date(now - 60000).toISOString(), end = new Date(now + 60000).toISOString();
  const location = { origin: 'https://arkkies.com' };
  const window = {
    addEventListener: (name, cb) => listeners.set(name, cb),
    removeEventListener: name => listeners.delete(name),
  };
  Object.defineProperty(location, 'href', {set: value => {
    const url = new URL(value);
    const event = {type:url.searchParams.get('type'), value:url.searchParams.get('value')}; events.push(event);
    if (event.type === 'passes') queueMicrotask(() => listeners.get('gym-now-pass')({detail:{token:'run-token',id:'subscription-b'}}));
  }});
  const context = vm.createContext({
    GYM_NOW_CONFIG: {outlet:'AGRKHG01',gymName:'Keat Hong',passId:'',token:'run-token'},
    location,window,Date,AbortController,setTimeout,clearTimeout,encodeURIComponent,
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    fetch: async (url, options) => {
      calls.push({url,options});
      let result = {};
      if (url.endsWith('/sessions/whoami')) {
        if (unauthenticated) return {ok:false,status:401};
        result = {identity:{id:'mock-user-b'}};
      } else if (url.endsWith('/subscription/active')) {
        result = {active_subscriptions:[{subscription:{id:'subscription-b'},pass:{name:'Annual gym plan',access_type:'gym-access',allowed_bookings_at:'AGRKHG01'}}]};
      } else if (url.includes('/slot/destination/')) {
        result = {selections:[{selection_date_time_start:start,selection_date_time_end:end,slot:{id:'slot-b',outlet_id:'AGRKHG01',type:'gym-time',requires:'gym-access'}}]};
      } else if (url.endsWith('/booking')) {
        if (options.method === 'POST') created = true;
        else result = {bookings:created?[{id:'booking-b',time_start:start,time_end:end,purpose_type:'gym-time',booking_slot:{outlet_id:'AGRKHG01'}}]:[]};
      } else throw new Error('Unexpected endpoint');
      return {ok:true,status:200,text:async()=>JSON.stringify(result)};
    }
  });
  return {context,calls,events};
}
test('composed Android script selects a native pass, books once, and emits a verified entry reference', async () => {
  const f = fixture(false); await vm.runInContext(script,f.context);
  assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);
  assert.ok(f.events.some(e=>e.type==='passes'));
  assert.deepEqual(f.events.filter(e=>e.type==='done'),[{type:'done',value:'booking-b'}]);
  assert.ok(f.calls.every(c=>c.url.startsWith('https://api.arkkies.com/v2/') && c.options.credentials==='include'));
  assert.ok(f.calls.every(c=>c.options.headers['X-Ark-Outlet']==='AGRKHG01'));
});
test('composed Android script requests official sign-in when the session expires, without posting a booking', async () => {
  const f = fixture(true); await vm.runInContext(script,f.context);
  assert.ok(f.events.some(e=>e.type==='auth'));
  assert.equal(f.calls.filter(c=>c.options.method==='POST').length,0);
});
test('a session for a different account cannot book using a saved login account', async () => {
  const f = fixture(false); f.context.GYM_NOW_CONFIG.expectedIdentity = 'saved-user-a';
  await vm.runInContext(script, f.context);
  assert.ok(f.events.some(e => e.type === 'error' && e.value.includes('different Ark account')));
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 0);
});
