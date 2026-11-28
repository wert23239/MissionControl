const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const source = html.slice(html.indexOf('function renderNotes('), html.indexOf('// Journal / Ta-da List'));

function mount(initial, filter) {
  let notes = initial;
  const tabs = { innerHTML: '' };
  const list = { innerHTML: '' };
  const context = {
    noteFilter: filter, getNotes: () => notes,
    document: { getElementById: id => id === 'filterTabs' ? tabs : list },
    inlineJsString: JSON.stringify, escapeHtml: text => String(text),
    catColors: {}, noteDeleting: new Set(), noteDeleteKey: note => note.text,
  };
  vm.runInNewContext(source, context);
  return { context, tabs, list, render: () => context.renderNotes(), set notes(value) { notes = value; } };
}

test('deleting the last note in a selected category falls back to All and shows remaining notes', () => {
  const app = mount([
    { text: 'Book note', cat: 'Book' },
    { text: 'Other note', cat: 'General' },
  ], 'Book');
  app.render();
  assert.match(app.list.innerHTML, /Book note/);
  assert.doesNotMatch(app.list.innerHTML, /Other note/);
  app.notes = [{ text: 'Other note', cat: 'General' }];
  app.render();
  assert.equal(app.context.noteFilter, 'All');
  assert.match(app.tabs.innerHTML, /class="filter-tab active"[^>]*>All/);
  assert.match(app.list.innerHTML, /Other note/);
  assert.doesNotMatch(app.list.innerHTML, /No notes yet/);
});

test('valid category selections persist, and deleting the final note leaves All selected', () => {
  const app = mount([{ text: 'Remaining book note', cat: 'Book' }], 'Book');
  app.render();
  assert.equal(app.context.noteFilter, 'Book');
  app.notes = [];
  app.render();
  assert.equal(app.context.noteFilter, 'All');
  assert.match(app.list.innerHTML, /No notes yet/);
});
