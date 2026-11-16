// Optional browser integration tests: npm install --no-save playwright
// All pages and requests are local fixtures; these never contact Ark.
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const source = fs.readFileSync(path.join(__dirname, '../assets/entry-selector.js'), 'utf8');
const entry = 'https://arkkies.com/entry?booking-id=mock-booking-a';
let browser;
before(async () => {
  browser = await chromium.launch({headless: true, args: ['--no-sandbox'],
    ...(process.env.GYM_NOW_TEST_CHROMIUM ? {executablePath: process.env.GYM_NOW_TEST_CHROMIUM} : {})});
});
after(async () => { if (browser) await browser.close(); });

function customHTML(options = [{name: 'Toilet'}, {name: 'main door'}], selected = '') {
  return `<!doctype html><html><body><main id="screen">
    <p>Select door to unlock</p><div id="entry-control">
      <div id="door" role="combobox" tabindex="0" aria-expanded="false" aria-haspopup="listbox">${selected}</div>
      <button id="unlock">Unlock</button></div></main>
    <script>
    window.actions = {unlocks: 0, opens: 0, choices: []};
    document.getElementById('unlock').onclick = () => actions.unlocks++;
    document.getElementById('door').onmousedown = function(event) {
      if (event.button !== 0 || document.getElementById('door-menu')) return;
      actions.opens++;
      this.setAttribute('aria-expanded', 'true'); this.setAttribute('aria-controls', 'door-menu');
      document.getElementById('screen').setAttribute('aria-hidden', 'true');
      const list = document.createElement('ul'); list.id = 'door-menu'; list.setAttribute('role', 'listbox');
      for (const spec of ${JSON.stringify(options)}) {
        const option = document.createElement('li'); option.setAttribute('role', 'option'); option.textContent = spec.name;
        if (spec.disabled) option.setAttribute('aria-disabled', 'true');
        if (spec.hidden) option.hidden = true;
        option.onclick = () => {
          actions.choices.push(spec.name); this.textContent = spec.name;
          this.setAttribute('aria-expanded', 'false'); list.remove();
          document.getElementById('screen').removeAttribute('aria-hidden');
        };
        list.append(option);
      }
      document.body.append(list);
    };
    </script></body></html>`;
}

async function fixture(t, html = customHTML(), url = entry) {
  const context = await browser.newContext();
  t.after(() => context.close());
  await context.route('**/*', route => route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: html}));
  const page = await context.newPage();
  await page.goto(url); await page.addScriptTag({content: source});
  return {
    page,
    step: () => page.evaluate(config => selectArkMainDoor(config), {entryUrl: entry, token: 'test-run'}),
    actions: () => page.evaluate(() => window.actions)
  };
}

test('opens the Material UI style portal and confirms Main Door, with no Unlock click', async t => {
  const f = await fixture(t, customHTML([{name: 'Toilet'}, {name: '  main\u200b   door  '}]));
  assert.equal(await f.step(), 'waiting');
  assert.equal(await f.step(), 'waiting');
  assert.equal(await f.step(), 'selected');
  assert.deepEqual(await f.actions(), {unlocks: 0, opens: 1, choices: ['  main\u200b   door  ']});
});

test('waits for asynchronous entry rendering', async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => { document.getElementById('screen').hidden = true; });
  assert.equal(await f.step(), 'waiting');
  await f.page.evaluate(() => { document.getElementById('screen').hidden = false; });
  await f.step(); await f.step();
  assert.equal(await f.step(), 'selected');
  assert.equal((await f.actions()).unlocks, 0);
});

test('an already selected Main Door needs no interaction', async t => {
  const f = await fixture(t, customHTML(undefined, 'Main Door'));
  assert.equal(await f.step(), 'selected');
  assert.deepEqual(await f.actions(), {unlocks: 0, opens: 0, choices: []});
});

test('a native select dispatches a change to the Main Door value', async t => {
  const f = await fixture(t, `<!doctype html><p>Select door to unlock</p><div>
    <select id="door"><option value="">Select</option><option value="toilet">Toilet</option><option value="main">Main Door</option></select>
    <button id="unlock">Unlock</button></div><script>
    window.actions={unlocks:0,changes:[]};
    document.getElementById('door').onchange=e=>actions.changes.push(e.target.value);
    document.getElementById('unlock').onclick=()=>actions.unlocks++;</script>`);
  assert.equal(await f.step(), 'waiting');
  assert.equal(await f.step(), 'selected');
  assert.deepEqual(await f.actions(), {unlocks: 0, changes: ['main']});
});

test('similar door names do not substitute for Main Door', async t => {
  const f = await fixture(t, customHTML([{name: 'Main Door Exit'}, {name: 'Rear Main Door'}, {name: 'Toilet'}]));
  await f.step(); assert.equal(await f.step(), 'unavailable');
  assert.deepEqual((await f.actions()).choices, []);
  assert.equal((await f.actions()).unlocks, 0);
});

test('duplicate Main Door options leave the choice to the user', async t => {
  const f = await fixture(t, customHTML([{name: 'Main Door'}, {name: 'main door'}]));
  await f.step(); assert.equal(await f.step(), 'ambiguous');
  assert.deepEqual((await f.actions()).choices, []);
});

test('a disabled Main Door is not clicked', async t => {
  const f = await fixture(t, customHTML([{name: 'Main Door', disabled: true}, {name: 'Toilet'}]));
  await f.step(); assert.equal(await f.step(), 'unavailable');
  assert.deepEqual((await f.actions()).choices, []);
});

test('ignores hidden duplicates and other listboxes when the control owns its portal', async t => {
  const f = await fixture(t, customHTML([{name: 'Main Door', hidden: true}, {name: 'Main Door'}]));
  await f.page.evaluate(() => {
    const list = document.createElement('ul'); list.setAttribute('role', 'listbox');
    list.innerHTML = '<li role="option">Main Door</li>'; document.body.append(list);
    list.onclick = () => { throw new Error('Unrelated dropdown clicked'); };
  });
  await f.step(); await f.step(); assert.equal(await f.step(), 'selected');
  assert.deepEqual((await f.actions()).choices, ['Main Door']);
});

test('rejects another booking, login page, and an origin lookalike', async t => {
  for (const url of ['https://arkkies.com/entry?booking-id=mock-booking-b',
    'https://arkkies.com/login', 'https://arkkies.com.evil.test/entry?booking-id=mock-booking-a']) {
    const f = await fixture(t, customHTML(), url);
    assert.equal(await f.step(), 'wrong-page');
    assert.deepEqual(await f.actions(), {unlocks: 0, opens: 0, choices: []});
  }
});

test('multiple controls in the door area are not guessed', async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => {
    const other = document.createElement('select'); other.innerHTML='<option>Main Door</option>';
    document.getElementById('entry-control').append(other);
  });
  assert.equal(await f.step(), 'ambiguous');
  assert.equal((await f.actions()).opens, 0);
});

test('selection finishes once and allows the user to change doors afterwards', async t => {
  const f = await fixture(t);
  await f.step(); await f.step(); assert.equal(await f.step(), 'selected');
  await f.page.evaluate(() => { document.getElementById('door').textContent = 'Toilet'; });
  assert.equal(await f.step(), 'selected');
  assert.equal(await f.page.locator('#door').innerText(), 'Toilet');
  assert.equal((await f.actions()).opens, 1);
});

test('an unrelated page without the door label is untouched', async t => {
  const f = await fixture(t);
  await f.page.evaluate(() => { document.querySelector('p').textContent = 'Choose subscription'; });
  assert.equal(await f.step(), 'waiting');
  assert.deepEqual(await f.actions(), {unlocks: 0, opens: 0, choices: []});
});
