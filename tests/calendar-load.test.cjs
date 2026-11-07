const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const loadSource = html.slice(html.indexOf('let calCache=[];'), html.indexOf('let calSaving=false;'));
const renderSource = html.slice(html.indexOf('function renderCal(){'), html.indexOf('// Month Grid Calendar'));
function mount() {
  const elements = { calLoadStatus: { textContent: '' }, calList: { innerHTML: '' } };
  const context = {
    document: { getElementById: id => elements[id] },
    SB_URL: 'https://example.test', sbHeaders: {},
    fetch: async () => ({ ok: true, json: async () => [] }),
    escapeHtml: value => String(value), inlineActionArg: JSON.stringify,
  };
  vm.runInNewContext(loadSource + renderSource, context);
  return { context, elements, cache: () => JSON.parse(vm.runInNewContext('JSON.stringify(calCache)', context)) };
}

for (const failure of ['HTTP', 'network', 'invalid JSON', 'non-array']) {
  test(`calendar refresh retains loaded events after ${failure} failure, then recovers`, async () => {
    const app = mount();
    const dinner = [{ id: 'event-1', date: '2026-11-10', event: 'Dinner' }];
    app.context.fetch = async () => ({ ok: true, json: async () => dinner });
    await app.context.loadCalFromSupabase();
    app.context.fetch = async () => {
      if (failure === 'network') throw new Error('offline');
      return { ok: failure !== 'HTTP', status: 503, json: async () => {
        if (failure === 'invalid JSON') throw new SyntaxError('bad JSON');
        return { error: 'unexpected payload' };
      } };
    };
    await app.context.loadCalFromSupabase();
    app.context.renderCal();
    assert.deepEqual(app.cache(), dinner);
    assert.match(app.elements.calList.innerHTML, /Dinner/);
    assert.match(app.elements.calLoadStatus.textContent, /Could not refresh/);
    app.context.fetch = async () => ({ ok: true, json: async () => [] });
    await app.context.loadCalFromSupabase();
    app.context.renderCal();
    assert.deepEqual(app.cache(), []);
    assert.equal(app.elements.calLoadStatus.textContent, '');
    assert.match(app.elements.calList.innerHTML, /No events yet/);
  });
}

test('initial offline load does not falsely report an empty calendar', async () => {
  const app = mount();
  app.context.fetch = async () => { throw new Error('offline'); };
  await app.context.loadCalFromSupabase();
  app.context.renderCal();
  assert.match(app.elements.calList.innerHTML, /Events could not be loaded/);
  assert.doesNotMatch(app.elements.calList.innerHTML, /No events yet/);
});

test('load completion is safe when Calendar is not mounted', async () => {
  const app = mount();
  app.context.document.getElementById = () => null;
  await app.context.loadCalFromSupabase();
  assert.deepEqual(app.cache(), []);
});
