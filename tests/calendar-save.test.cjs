const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const source = html.slice(html.indexOf('let calSaving=false;'), html.indexOf("document.addEventListener('keydown',e=>{if(e.key==='Enter'&&document.activeElement?.id==='calEvent')"));
function mount(fetch) {
  const elements = {
    calDate: { value: '2026-11-10' }, calEvent: { value: 'Dinner' },
    calAdd: { disabled: false }, calSaveStatus: { textContent: '' },
  };
  let reloads = 0;
  const context = {
    document: { getElementById: id => elements[id] }, fetch,
    SB_URL: 'https://example.test', sbHeaders: {}, console: { log() {} },
    loadCalFromSupabase: async () => { reloads++; }, renderCal() {},
  };
  vm.runInNewContext(source, context);
  return { elements, save: context.addCal, get reloads() { return reloads; } };
}

for (const failure of ['HTTP rejection', 'network error']) {
  test(`failed calendar save keeps the draft and supports retry: ${failure}`, async () => {
    let fail = true;
    const app = mount(async () => {
      if (!fail) return { ok: true };
      if (failure === 'network error') throw new Error('offline');
      return { ok: false, status: 403 };
    });
    await app.save();
    assert.equal(app.elements.calEvent.value, 'Dinner');
    assert.equal(app.elements.calDate.value, '2026-11-10');
    assert.equal(app.elements.calAdd.disabled, false);
    assert.match(app.elements.calSaveStatus.textContent, /Could not save/);
    assert.equal(app.reloads, 0);
    fail = false;
    await app.save();
    assert.equal(app.elements.calEvent.value, '');
    assert.equal(app.reloads, 1);
    assert.equal(app.elements.calSaveStatus.textContent, 'Event saved.');
  });
}

test('repeated Add/Enter while saving sends only one request', async () => {
  let resolve;
  let requests = 0;
  const app = mount(() => { requests++; return new Promise(done => { resolve = done; }); });
  const pending = app.save();
  assert.equal(app.elements.calAdd.disabled, true);
  await app.save();
  assert.equal(requests, 1);
  resolve({ ok: true });
  await pending;
  assert.equal(app.elements.calAdd.disabled, false);
  assert.equal(app.reloads, 1);
});

test('a successful save does not erase a newly edited draft', async () => {
  let resolve;
  const app = mount(() => new Promise(done => { resolve = done; }));
  const pending = app.save();
  app.elements.calEvent.value = 'Lunch';
  resolve({ ok: true });
  await pending;
  assert.equal(app.elements.calEvent.value, 'Lunch');
});
