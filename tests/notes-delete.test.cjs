const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('index.html', 'utf8');
const source = html.slice(html.indexOf('const noteDeleting=new Set();'), html.indexOf('function toggleNote('));

function mount(remove, initial = [{ id: 'note-1', text: 'Keep my note', cat: 'Book' }]) {
  let notes = structuredClone(initial);
  let blocked = false;
  const status = { textContent: '' };
  const button = { disabled: false };
  const context = {
    document: { getElementById: () => status }, sbDelete: remove,
    getNotes: () => structuredClone(notes),
    saveNotes(next) { if (blocked) throw new Error('Storage blocked'); notes = next; },
    renderNotes() {},
  };
  vm.runInNewContext(source, context);
  return { context, status, button, remove: (i = 0) => context.deleteNote(i, button),
    get notes() { return notes; }, set notes(next) { notes = next; },
    set blocked(value) { blocked = value; } };
}

for (const failure of ['HTTP rejection', 'network error']) {
  test(`note deletion retains the note on ${failure} and supports retry`, async () => {
    let fail = true;
    const app = mount(async () => {
      if (fail && failure === 'network error') throw new Error('Offline');
      return { ok: !fail };
    });
    await app.remove();
    assert.equal(app.notes.length, 1);
    assert.match(app.status.textContent, /Could not delete note/);
    assert.equal(app.button.disabled, false);
    fail = false;
    await app.remove();
    assert.equal(app.notes.length, 0);
    assert.equal(app.status.textContent, 'Note deleted.');
  });
}

test('pending deletes suppress duplicates and preserve newer notes and edits', async () => {
  let resolve;
  let requests = 0;
  const app = mount((table, id) => {
    assert.equal(table, 'notes'); assert.equal(id, 'note-1');
    requests++;
    return new Promise(done => { resolve = done; });
  });
  const pending = app.remove();
  assert.equal(app.button.disabled, true);
  await app.remove();
  assert.equal(requests, 1);
  app.notes = [{ id: 'new', text: 'Added meanwhile' }, { ...app.notes[0], done: true }];
  resolve({ ok: true });
  await pending;
  assert.deepEqual(app.notes, [{ id: 'new', text: 'Added meanwhile' }]);
  assert.equal(app.button.disabled, false);
});

test('local-only deletion does not request cloud access', async () => {
  const app = mount(() => assert.fail('Unexpected cloud delete'), [{ text: 'Local', time: 'now', cat: 'General' }]);
  await app.remove();
  assert.equal(app.notes.length, 0);
});

test('blocked local deletion keeps the note and supports retry', async () => {
  const app = mount(() => assert.fail('Unexpected cloud delete'), [{ text: 'Local' }]);
  app.blocked = true;
  await app.remove();
  assert.equal(app.notes.length, 1);
  assert.match(app.status.textContent, /Could not delete note/);
  app.blocked = false;
  await app.remove();
  assert.equal(app.notes.length, 0);
});

test('remote success with a blocked cache reports partial deletion and supports retry', async () => {
  const app = mount(async () => ({ ok: true }));
  app.blocked = true;
  await app.remove();
  assert.equal(app.notes.length, 1);
  assert.match(app.status.textContent, /deleted from cloud, but browser storage/);
  app.blocked = false;
  await app.remove();
  assert.equal(app.notes.length, 0);
});

test('rerendered pending buttons recover after deletion fails', async () => {
  const app = mount(async () => ({ ok: false }));
  let pending;
  app.context.renderNotes = () => {
    pending = vm.runInNewContext('noteDeleting.size', app.context);
  };
  await app.remove();
  assert.equal(pending, 0);
  assert.match(html, /noteDeleting.has\(noteDeleteKey\(n\)\)\?'disabled'/);
  assert.match(html, /aria-label="Delete note"/);
});
