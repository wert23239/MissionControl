const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.includes('let noteSaving=false;') ? 'let noteSaving=false;' : 'async function addNote(){';
const source = html.slice(html.indexOf(start), html.indexOf("document.addEventListener('keydown',e=>{if(e.key==='Enter'&&document.activeElement?.id==='noteInput')"));

function mount(insert, blocked = false) {
  const elements = {
    noteInput: { value: 'Keep my idea' }, noteCat: { value: 'Book' },
    noteAdd: { disabled: false }, noteSaveStatus: { textContent: '' },
  };
  let notes = [];
  const context = {
    document: { getElementById: id => elements[id] }, sbInsert: insert,
    getNotes: () => [...notes],
    saveNotes(next) { if (blocked) throw new Error('Storage blocked'); notes = next; },
    renderNotes() {},
  };
  vm.runInNewContext(source, context);
  return { elements, save: context.addNote, get notes() { return notes; } };
}

test('pending note saves keep the draft visible and suppress duplicate Add/Enter requests', async () => {
  let resolve;
  let requests = 0;
  const app = mount(() => { requests++; return new Promise(done => { resolve = done; }); });
  const pending = app.save();
  assert.equal(app.elements.noteInput.value, 'Keep my idea');
  assert.equal(app.elements.noteAdd.disabled, true);
  await app.save();
  assert.equal(requests, 1);
  resolve([{ id: 'note-uuid' }]);
  await pending;
  assert.equal(app.notes.length, 1);
  assert.equal(app.notes[0].id, 'note-uuid');
  assert.equal(app.elements.noteInput.value, '');
  assert.equal(app.elements.noteAdd.disabled, false);
});

for (const failure of ['network', 'HTTP error payload', 'empty response']) {
  test(`failed sync preserves local fallback and reports its limitations: ${failure}`, async () => {
    const app = mount(async () => {
      if (failure === 'network') throw new Error('offline');
      return failure === 'empty response' ? [] : { message: 'permission denied' };
    });
    await app.save();
    assert.equal(app.notes[0].text, 'Keep my idea');
    assert.equal(app.elements.noteInput.value, '');
    assert.match(app.elements.noteSaveStatus.textContent, /only in this browser/);
    assert.equal(app.elements.noteAdd.disabled, false);
  });
}

test('failure of both cloud and local saves retains the draft and allows retry', async () => {
  let fail = true;
  const app = mount(async () => {
    if (fail) throw new Error('offline');
    return [{ id: 'saved-on-retry' }];
  }, true);
  await app.save();
  assert.equal(app.elements.noteInput.value, 'Keep my idea');
  assert.match(app.elements.noteSaveStatus.textContent, /Could not save/);
  assert.equal(app.elements.noteAdd.disabled, false);
  fail = false;
  await app.save();
  assert.equal(app.elements.noteInput.value, '');
  assert.match(app.elements.noteSaveStatus.textContent, /Note synced/);
});

test('cache failure after remote success does not retry insertion or claim the note was lost', async () => {
  let requests = 0;
  const app = mount(async () => { requests++; return [{ id: 'cloud-only' }]; }, true);
  await app.save();
  assert.equal(requests, 1);
  assert.equal(app.elements.noteInput.value, '');
  assert.match(app.elements.noteSaveStatus.textContent, /Note synced/);
  assert.equal(app.elements.noteAdd.disabled, false);
});

test('a successful save does not erase a newer draft or change its category', async () => {
  let resolve;
  const app = mount(() => new Promise(done => { resolve = done; }));
  const pending = app.save();
  app.elements.noteInput.value = 'Next idea';
  app.elements.noteCat.value = 'Ideas';
  resolve([{ id: 'first' }]);
  await pending;
  assert.equal(app.elements.noteInput.value, 'Next idea');
  assert.equal(app.elements.noteCat.value, 'Ideas');
  assert.equal(app.notes[0].text, 'Keep my idea');
  assert.equal(app.notes[0].cat, 'Book');
});

test('note save feedback is exposed as a live status', () => {
  assert.match(html, /id="noteSaveStatus" role="status" aria-live="polite"/);
  assert.match(html, /id="noteAdd" onclick="addNote\(\)"/);
});
