// Small HubSpot CRM client. Runs in the main process only, so the token
// never reaches the page. Uses Node's built-in fetch.

const { getObject } = require('./objects');

const BASE_URL = 'https://api.hubapi.com';
const PAGE_SIZE = 50;
const BATCH_SIZE = 100; // HubSpot's limit for batch endpoints

class HubSpotError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HubSpotError';
    this.status = status;
    this.details = details;
  }
}

function createClient(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('[hubspot] A private app token is required');
  }

  async function request(method, path, body) {
    const url = new URL(path, BASE_URL);
    if (url.origin !== BASE_URL) throw new Error('[hubspot] Refusing request to another host');

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);

    if (!res.ok && res.status !== 207) {
      throw new HubSpotError(res.status, friendlyMessage(res.status, data), data);
    }
    return data;
  }

  function propertyList(type) {
    return getObject(type).fields.map((f) => f.key);
  }

  return {
    // Cheap call that fails fast on a bad token or missing scopes.
    async verify() {
      await request('GET', '/crm/v3/objects/contacts?limit=1');
      return true;
    },

    // List records, or search them when a query is given. `after` is the paging cursor.
    async list(type, { query = '', after } = {}) {
      const properties = propertyList(type);
      let data;
      if (query.trim()) {
        data = await request('POST', `/crm/v3/objects/${type}/search`, {
          query: query.trim(),
          properties,
          limit: PAGE_SIZE,
          after,
        });
      } else {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), properties: properties.join(',') });
        if (after) params.set('after', after);
        data = await request('GET', `/crm/v3/objects/${type}?${params}`);
      }
      return {
        records: (data.results || []).map((r) => ({ id: r.id, properties: r.properties || {} })),
        next: data.paging?.next?.after || null,
        total: data.total ?? null,
      };
    },

    async get(type, id) {
      const params = new URLSearchParams({ properties: propertyList(type).join(',') });
      const r = await request('GET', `/crm/v3/objects/${type}/${encodeURIComponent(id)}?${params}`);
      return { id: r.id, properties: r.properties || {} };
    },

    async update(type, id, properties) {
      const r = await request('PATCH', `/crm/v3/objects/${type}/${encodeURIComponent(id)}`, {
        properties: onlyKnownFields(type, properties),
      });
      return { id: r.id, properties: r.properties || {} };
    },

    async create(type, properties) {
      const r = await request('POST', `/crm/v3/objects/${type}`, {
        properties: onlyKnownFields(type, properties),
      });
      return { id: r.id, properties: r.properties || {} };
    },

    // Create many contacts. Tries batches of 100 first; if a batch is rejected,
    // retries that batch one by one so the user sees which rows failed and why.
    async importContacts(rows, onProgress = () => {}) {
      const results = { created: 0, failed: [] };
      for (let start = 0; start < rows.length; start += BATCH_SIZE) {
        const batch = rows.slice(start, start + BATCH_SIZE);
        try {
          const data = await request('POST', '/crm/v3/objects/contacts/batch/create', {
            inputs: batch.map((r) => ({ properties: onlyKnownFields('contacts', r.properties) })),
          });
          const errors = data?.errors || [];
          if (errors.length === 0) {
            results.created += batch.length;
          } else {
            // 207: partial success. Fall back to single creates to pin down failures.
            await createOneByOne(batch, results);
          }
        } catch (err) {
          if (err.status === 401 || err.status === 403) throw err;
          await createOneByOne(batch, results);
        }
        onProgress(Math.min(start + batch.length, rows.length), rows.length);
      }
      return results;
    },
  };

  async function createOneByOne(batch, results) {
    for (const row of batch) {
      try {
        await request('POST', '/crm/v3/objects/contacts', {
          properties: onlyKnownFields('contacts', row.properties),
        });
        results.created += 1;
      } catch (err) {
        if (err.status === 401 || err.status === 403) throw err;
        results.failed.push({ line: row.line, reason: err.message });
      }
    }
  }
}

function onlyKnownFields(type, properties) {
  const allowed = new Set(getObject(type).fields.map((f) => f.key));
  const out = {};
  for (const [k, v] of Object.entries(properties || {})) {
    if (allowed.has(k)) out[k] = v == null ? '' : String(v);
  }
  return out;
}

function friendlyMessage(status, data) {
  if (status === 401) return 'HubSpot rejected the token. Check that you copied the whole token.';
  if (status === 403) return 'The token is missing a scope this action needs. See the README for the scope list.';
  if (status === 409) return data?.message || 'A record with this value already exists.';
  if (status === 429) return 'HubSpot rate limit hit. Wait a few seconds and try again.';
  return data?.message || `HubSpot returned an error (${status}).`;
}

module.exports = { createClient, HubSpotError, onlyKnownFields };
