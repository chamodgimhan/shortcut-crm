const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseCsv, csvToContacts } = require('../src/main/csv');

test('quoted commas, escaped quotes and line breaks', () => {
  const rows = parseCsv('a,b,c\r\n"x, y","say ""hi""","line1\nline2"\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'say "hi"', 'line1\nline2']]);
});

test('semicolon files from Dutch Excel', () => {
  const rows = parseCsv('\uFEFFa;b\n1,5;2\n');
  assert.deepEqual(rows, [['a', 'b'], ['1,5', '2']]);
});

test('unclosed quote is an error', () => {
  assert.throws(() => parseCsv('a,b\n"open,1\n'), /never closed/);
});

test('sample file: valid rows kept, bad ones explained', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'samples', 'contacts.csv'), 'utf8');
  const { contacts, skipped } = csvToContacts(text);
  assert.equal(contacts.length, 4);
  assert.equal(contacts[0].properties.company, 'Vermeer & Co, BV');
  assert.equal(contacts[3].properties.company, 'Mulder "The Green" Farm');
  assert.equal(contacts[2].properties.phone, undefined); // empty cells are not sent
  assert.deepEqual(skipped.map((s) => s.line), [5]);
});

test('Dutch headers and duplicate emails', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'samples', 'contacts-dutch-excel.csv'), 'utf8');
  const { contacts, skipped } = csvToContacts(text);
  assert.equal(contacts.length, 2);
  assert.equal(contacts[0].properties.company, 'Jansen, Hout & Zn');
  assert.equal(contacts[1].properties.email, 'mark.visser@example.com');
  assert.match(skipped[0].reason, /earlier in the file/);
});

test('missing email column is rejected', () => {
  assert.throws(() => csvToContacts('name,phone\nA,1\n'), /email/);
});
