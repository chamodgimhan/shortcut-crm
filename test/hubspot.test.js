const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, onlyKnownFields } = require('../src/main/hubspot');

// Swap global fetch for a fake that records calls and returns canned replies.
function fakeFetch(handler) {
  const calls = [];
  global.fetch = async (url, opts) => {
    const call = { url: String(url), method: opts.method, body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers.Authorization };
    calls.push(call);
    const [status, json] = handler(call, calls.length);
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  return calls;
}

test('list without query uses GET with properties', async () => {
  const calls = fakeFetch(() => [200, { results: [{ id: '1', properties: { email: 'a@example.com' } }], paging: { next: { after: '50' } } }]);
  const page = await createClient('pat-test').list('contacts');
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /\/crm\/v3\/objects\/contacts\?limit=50&properties=firstname%2Clastname%2Cemail/);
  assert.equal(calls[0].auth, 'Bearer pat-test');
  assert.equal(page.next, '50');
  assert.equal(page.records[0].properties.email, 'a@example.com');
});

test('search uses POST /search', async () => {
  const calls = fakeFetch(() => [200, { total: 0, results: [] }]);
  await createClient('pat-test').list('deals', { query: ' acme ' });
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].url, /\/deals\/search$/);
  assert.equal(calls[0].body.query, 'acme');
});

test('update only sends known fields', async () => {
  const calls = fakeFetch(() => [200, { id: '9', properties: {} }]);
  await createClient('pat-test').update('companies', '9', { name: 'X', hs_secret: 'nope' });
  assert.deepEqual(calls[0].body, { properties: { name: 'X' } });
  assert.equal(calls[0].method, 'PATCH');
});

test('bad token gives a readable error', async () => {
  fakeFetch(() => [401, { message: 'auth' }]);
  await assert.rejects(createClient('pat-bad').verify(), /rejected the token/);
});

test('import falls back to one-by-one when a batch is rejected', async () => {
  const rows = [
    { line: 2, properties: { email: 'a@example.com' } },
    { line: 3, properties: { email: 'dupe@example.com' } },
    { line: 4, properties: { email: 'c@example.com' } },
  ];
  const calls = fakeFetch((call) => {
    if (call.url.endsWith('/batch/create')) return [409, { message: 'Contact already exists' }];
    if (call.body.properties.email === 'dupe@example.com') return [409, { message: 'Contact already exists. Existing ID: 5' }];
    return [201, { id: 'x', properties: {} }];
  });
  const progress = [];
  const result = await createClient('pat-test').importContacts(rows, (d, t) => progress.push([d, t]));
  assert.equal(result.created, 2);
  assert.deepEqual(result.failed, [{ line: 3, reason: 'Contact already exists. Existing ID: 5' }]);
  assert.equal(calls.length, 4);
  assert.deepEqual(progress, [[3, 3]]);
});

test('import sends batches of 100', async () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ line: i + 2, properties: { email: `p${i}@example.com` } }));
  const calls = fakeFetch(() => [201, { results: [] }]);
  const result = await createClient('pat-test').importContacts(rows);
  assert.equal(result.created, 250);
  assert.deepEqual(calls.map((c) => c.body.inputs.length), [100, 100, 50]);
});

test('onlyKnownFields drops unknown keys and stringifies', () => {
  assert.deepEqual(onlyKnownFields('deals', { amount: 1200, foo: 1, dealname: null }), { amount: '1200', dealname: '' });
});
