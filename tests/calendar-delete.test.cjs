const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const source = html.slice(html.indexOf('const calDeleting=new Set();'), html.indexOf('function renderCal(){'));
function mount(fetch) {
  const status = { textContent: '' };
  const button = { disabled: false };
  let reloads = 0;
  let renders = 0;
  const context = {
    document: { getElementById: () => status }, fetch,
    SB_URL: 'https://example.test', sbHeaders: {}, console: { log() {} },
    loadCalFromSupabase: async () => { reloads++; }, renderCal: () => { renders++; },
  };
  vm.runInNewContext(source, context);
  return { context, status, button, remove: (id = 'event-1') => context.deleteCal(id, button),
    get reloads() { return reloads; }, get renders() { return renders; } };
}

for (const failure of ['HTTP rejection', 'network error']) {
  test(`calendar deletion reports ${failure}, keeps events, and supports retry`, async () => {
    let fail = true;
    const app = mount(async () => {
      if (!fail) return { ok: true };
      if (failure === 'network error') throw new Error('offline');
      return { ok: false, status: 403 };
    });
    await app.remove();
    assert.match(app.status.textContent, /Could not delete event/);
    assert.equal(app.button.disabled, false);
    assert.equal(app.reloads, 0);
    assert.equal(app.renders, 0);
    fail = false;
    await app.remove();
    assert.equal(app.status.textContent, 'Event deleted.');
    assert.equal(app.reloads, 1);
    assert.equal(app.renders, 1);
  });
}

test('duplicate deletes send one request and re-enable the button afterwards', async () => {
  let resolve;
  let requests = 0;
  const app = mount(() => { requests++; return new Promise(done => { resolve = done; }); });
  const pending = app.remove();
  assert.equal(app.button.disabled, true);
  await app.remove();
  assert.equal(requests, 1);
  resolve({ ok: true });
  await pending;
  assert.equal(app.button.disabled, false);
  assert.equal(app.reloads, 1);
});

test('event IDs are encoded as a single query value', async () => {
  let url;
  const app = mount(async value => { url = value; return { ok: true }; });
  await app.remove('event&other=eq.1');
  assert.equal(url, 'https://example.test/rest/v1/calendar?id=eq.event%26other%3Deq.1');
});

test('delete completion is safe when the status element is unmounted', async () => {
  const app = mount(async () => ({ ok: true }));
  app.context.document.getElementById = () => null;
  await app.context.deleteCal('event-1');
  assert.equal(app.reloads, 1);
});
