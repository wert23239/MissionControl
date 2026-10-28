const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const dateHelper = html.slice(html.indexOf('function localDateKey('), html.indexOf('async function sbGet('));
const exporter = html.slice(html.indexOf('function exportSpendingCSV('), html.indexOf('function renderMonth('));

function exportAt(instant, zone, mode = 'month', transactions) {
  const previousZone = process.env.TZ;
  process.env.TZ = zone;
  try {
    const downloads = [];
    let contents;
    class FixedDate extends Date {
      constructor(...args) { super(...(args.length ? args : [instant])); }
    }
    const context = {
      Date: FixedDate,
      allSpendingTxns: transactions ?? ['2026-10-31', '2026-11-01', '2026-12-31', '2027-01-01'].map(date => ({
        transaction_date: date, description: `Purchase ${date}`, amount: -10,
      })),
      alert: message => assert.fail(message),
      Blob: class { constructor(parts) { contents = parts.join(''); } },
      URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
      document: {
        body: { appendChild() {}, removeChild() {} },
        createElement: () => ({ click() { downloads.push(this.download); } }),
        getElementById: () => ({ value: 'Purchase' }),
      },
    };
    vm.runInNewContext(`${dateHelper}\n${exporter}`, context);
    context.exportSpendingCSV(mode);
    return { csv: contents, filename: downloads[0] };
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
}

test('monthly export stays in October on New York evenings after UTC rolls into November', () => {
  const { csv, filename } = exportAt('2026-11-01T00:30:00Z', 'America/New_York');
  assert.ok(csv.includes('Purchase 2026-10-31'));
  assert.ok(!csv.includes('Purchase 2026-11-01'));
  assert.equal(filename, 'spending-month-2026-10-31.csv');
});

test('monthly export advances at local midnight ahead of UTC', () => {
  const { csv, filename } = exportAt('2026-10-31T16:30:00Z', 'Asia/Tokyo');
  assert.ok(csv.includes('Purchase 2026-11-01'));
  assert.ok(!csv.includes('Purchase 2026-10-31'));
  assert.equal(filename, 'spending-month-2026-11-01.csv');
});

test('monthly export also respects the local year boundary', () => {
  const { csv, filename } = exportAt('2027-01-01T01:00:00Z', 'America/New_York');
  assert.ok(csv.includes('Purchase 2026-12-31'));
  assert.ok(!csv.includes('Purchase 2027-01-01'));
  assert.equal(filename, 'spending-month-2026-12-31.csv');
});

test('all and search exports keep their rows and use the local filename date', () => {
  for (const mode of ['all', 'search']) {
    const { csv, filename } = exportAt('2026-11-01T00:30:00Z', 'America/New_York', mode);
    assert.equal(csv.split('\n').length, 5);
    assert.equal(filename, `spending-${mode}-2026-10-31.csv`);
  }
});


test('CSV exports formula-like imported text as literal cells without changing numeric amounts', () => {
  const values = ['=1+1', '+SUM(1,2)', '-1+2', '@SUM(A1:A2)', '  =1+1', '\tmerchant', '\rmerchant', '\nmerchant'];
  for (const value of values) {
    const { csv } = exportAt('2026-10-27T20:00:00Z', 'America/New_York', 'all', [{
      transaction_date: '2026-10-27', description: value, amount: -12.5, category: value, type: value,
    }]);
    const literal = "'" + value;
    const cell = /[,"\r\n]/.test(literal) ? '"' + literal.replace(/"/g, '""') + '"' : literal;
    assert.equal(csv, `Date,Description,Amount,Category,Type\n2026-10-27,${cell},-12.5,${cell},${cell}`);
  }
});

test('CSV preserves ordinary descriptions, commas, quotes, and carriage-return line breaks', () => {
  for (const description of ['Coffee shop', 'Shop, Inc.', 'The "store"', 'Shop\rBranch', 'Shop\r\nBranch']) {
    const { csv } = exportAt('2026-10-27T20:00:00Z', 'America/New_York', 'all', [{
      transaction_date: '2026-10-27', description, amount: -10, category: '', type: '',
    }]);
    const cell = /[,"\r\n]/.test(description) ? '"' + description.replace(/"/g, '""') + '"' : description;
    assert.equal(csv, `Date,Description,Amount,Category,Type\n2026-10-27,${cell},-10,,`);
  }
});
