const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const localDateHelper = html.slice(html.indexOf('function localDateKey('), html.indexOf('async function sbGet('));
const packingDates = html.slice(html.indexOf('function todayISO('), html.indexOf('function readPackingLocal('));

function datesAt(instant, zone) {
  const previousZone = process.env.TZ;
  process.env.TZ = zone;
  try {
    class FixedDate extends Date {
      constructor(...args) { super(...(args.length ? args : [instant])); }
    }
    const context = { Date: FixedDate };
    vm.runInNewContext(`${localDateHelper}\n${packingDates}`, context);
    return { start: context.todayISO(), end: context.addDaysISO(3) };
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
}

test('Packing starts today, not tomorrow, on New York evenings after UTC midnight', () => {
  assert.deepEqual(datesAt('2026-10-29T00:00:00Z', 'America/New_York'), {
    start: '2026-10-28', end: '2026-10-31',
  });
});

test('Packing starts today, not yesterday, in time zones ahead of UTC', () => {
  assert.deepEqual(datesAt('2026-10-31T16:30:00Z', 'Asia/Tokyo'), {
    start: '2026-11-01', end: '2026-11-04',
  });
});

test('Packing adds calendar days across the spring daylight-saving boundary', () => {
  assert.deepEqual(datesAt('2026-03-06T04:30:00Z', 'America/New_York'), {
    start: '2026-03-05', end: '2026-03-08',
  });
});

test('Packing adds calendar days across the autumn daylight-saving boundary', () => {
  assert.deepEqual(datesAt('2026-10-31T03:30:00Z', 'America/New_York'), {
    start: '2026-10-30', end: '2026-11-02',
  });
});

test('Packing keeps trip defaults correct across year boundaries', () => {
  assert.deepEqual(datesAt('2027-01-01T01:00:00Z', 'America/New_York'), {
    start: '2026-12-31', end: '2027-01-03',
  });
});
