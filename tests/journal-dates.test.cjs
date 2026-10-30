const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const dateHelper = html.slice(html.indexOf('function localDateKey('), html.indexOf('async function sbGet('));
const activity = html.slice(html.indexOf('async function loadRecentActivity('), html.indexOf('\nloadRecentActivity();'));
const addEntry = html.slice(html.indexOf('async function addJournalEntry('), html.indexOf('async function renderJournal('));

async function journalAt(instant, zone, dates) {
  const previousZone = process.env.TZ;
  process.env.TZ = zone;
  try {
    class FixedDate extends Date {
      constructor(...args) { super(...(args.length ? args : [instant])); }
      static now() { return +new Date(instant); }
    }
    const elements = {
      journalInput: { value: 'Finished a project' },
      journalCat: { value: 'Work' },
      overviewActivity: { innerHTML: '' },
    };
    let saved;
    const context = {
      Date: FixedDate, SB_URL: 'https://example.test', sbHeaders: {},
      document: { getElementById: id => elements[id] },
      renderJournal() {}, jCatColors: {}, escapeHtml: value => String(value),
      fetch: async (url, options) => {
        if (options.method === 'POST') saved = JSON.parse(options.body);
        return { ok: true, json: async () => dates.map(date => ({ date, entry: date })) };
      },
    };
    vm.runInNewContext(`${dateHelper}\n${activity}\n${addEntry}`, context);
    await context.addJournalEntry();
    await context.loadRecentActivity();
    return { savedDate: saved.date, activity: elements.overviewActivity.innerHTML };
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
}

for (const [name, instant, zone, today, yesterday] of [
  ['New York evening after UTC midnight', '2026-10-30T00:00:00Z', 'America/New_York', '2026-10-29', '2026-10-28'],
  ['Tokyo morning before UTC midnight', '2026-10-31T16:30:00Z', 'Asia/Tokyo', '2026-11-01', '2026-10-31'],
  ['spring DST short day', '2026-03-09T04:30:00Z', 'America/New_York', '2026-03-09', '2026-03-08'],
  ['autumn DST long day', '2026-11-02T04:30:00Z', 'America/New_York', '2026-11-01', '2026-10-31'],
  ['local year boundary', '2027-01-01T01:00:00Z', 'America/New_York', '2026-12-31', '2026-12-30'],
]) {
  test(`Journal saves and labels local dates correctly: ${name}`, async () => {
    const result = await journalAt(instant, zone, [today, yesterday]);
    assert.equal(result.savedDate, today);
    assert.match(result.activity, /Today<\/div>/);
    assert.match(result.activity, /Yesterday<\/div>/);
    assert.ok(result.activity.indexOf('Today</div>') < result.activity.indexOf(today));
    assert.ok(result.activity.indexOf('Yesterday</div>') < result.activity.indexOf(yesterday));
  });
}
