const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const notesSource = html.slice(html.indexOf('function getNotes('), html.indexOf('async function addNote('));

function loadNotes(raw, blocked = false) {
  const context = {
    localStorage: {
      getItem() { if (blocked) throw new Error('Storage blocked'); return raw; },
      setItem(key, value) { raw = value; },
    },
  };
  vm.runInNewContext(notesSource, context);
  return context;
}

test('malformed, missing, non-array, and blocked note storage recover to an empty list', () => {
  for (const raw of [null, '', '{broken', 'null', '{}', '42', '"notes"']) {
    assert.equal(loadNotes(raw).getNotes().length, 0, String(raw));
  }
  assert.equal(loadNotes(null, true).getNotes().length, 0);
});

test('invalid note rows are skipped while valid notes retain their content and metadata', () => {
  const valid = { text: 'Finish chapter', cat: 'Book', time: '2026-11-23T20:00:00Z', id: 'note-1', done: true };
  const context = loadNotes(JSON.stringify([null, 3, 'text', [], {}, { text: null }, valid, { text: 'Uncategorized' }]));
  assert.deepEqual(JSON.parse(JSON.stringify(context.getNotes())), [valid, { text: 'Uncategorized', cat: 'General' }]);
});

test('new notes can be saved after a corrupt cache without rewriting storage during reads', () => {
  const context = loadNotes('{broken');
  const notes = context.getNotes();
  notes.unshift({ text: 'Recovered note', cat: 'General' });
  context.saveNotes(notes);
  assert.equal(context.getNotes()[0].text, 'Recovered note');
});
