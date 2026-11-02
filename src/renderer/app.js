// Page logic. Talks to HubSpot only through window.crm (see preload.js).
// All record data is written with textContent, never innerHTML.

const $ = (id) => document.getElementById(id);

const state = {
  objects: {},
  type: 'contacts',
  query: '',
  next: null,
  records: [],
  selected: null, // { id, properties } being edited, or { id: null } for a new record
  listToken: 0,   // ignores slow responses from an older search
};

// ---------- helpers ----------

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  if (text != null) node.textContent = text;
  return node;
}

let toastTimer;
function toast(message, isError = false) {
  const t = $('toast');
  t.textContent = message;
  t.classList.toggle('error', isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 5000 : 2500);
}

// Unwraps { ok, data, error } from the main process. Sends you back to the
// connect screen if the token stopped working.
async function call(promise) {
  const res = await promise;
  if (res.ok) return res.data;
  if (res.status === 401) {
    showConnect('Your token stopped working. Paste it again.');
  }
  throw new Error(res.error);
}

function recordTitle(type, props) {
  const def = state.objects[type];
  const title = def.titleFields.map((k) => props[k]).filter(Boolean).join(' ');
  return title || (def.fallbackField && props[def.fallbackField]) || '(no name)';
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------- connect ----------

function showConnect(message) {
  $('app').hidden = true;
  $('connect').hidden = false;
  $('connect-error').hidden = !message;
  $('connect-error').textContent = message || '';
  $('token').focus();
}

$('connect-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('connect-btn');
  btn.disabled = true;
  btn.textContent = 'Connecting…';
  $('connect-error').hidden = true;
  try {
    await call(window.crm.connect($('token').value));
    $('token').value = ''; // don't keep it in the page
    $('connect').hidden = true;
    $('app').hidden = false;
    selectType('contacts');
  } catch (err) {
    $('connect-error').textContent = err.message;
    $('connect-error').hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Connect';
  }
});

$('disconnect-btn').addEventListener('click', async () => {
  await window.crm.disconnect();
  closePanel();
  showConnect();
});

// ---------- tabs ----------

function buildTabs() {
  const tabs = $('tabs');
  for (const [type, def] of Object.entries(state.objects)) {
    const b = el('button', { class: 'tab', dataset: { type } }, def.label);
    b.addEventListener('click', () => selectType(type));
    tabs.append(b);
  }
  $('import-tab').addEventListener('click', showImport);
}

function setActiveTab(key) {
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', (t.dataset.type || t.dataset.view) === key);
  });
}

function selectType(type) {
  state.type = type;
  state.query = '';
  $('search').value = '';
  $('view-title').textContent = state.objects[type].label;
  $('records-view').hidden = false;
  $('import-view').hidden = true;
  setActiveTab(type);
  closePanel();
  buildHead();
  loadRecords();
}

// ---------- table ----------

function buildHead() {
  const def = state.objects[state.type];
  const labels = Object.fromEntries(def.fields.map((f) => [f.key, f.label]));
  const head = $('table-head');
  head.replaceChildren(el('th', {}, 'Name'), ...def.columns.map((c) => el('th', {}, labels[c] || c)));
}

async function loadRecords({ append = false } = {}) {
  const token = ++state.listToken;
  $('list-error').hidden = true;
  if (!append) {
    state.records = [];
    state.next = null;
    $('table-body').replaceChildren();
    $('count').textContent = 'Loading…';
  }
  $('more-btn').disabled = true;
  try {
    const page = await call(window.crm.list(state.type, { query: state.query, after: append ? state.next : undefined }));
    if (token !== state.listToken) return; // a newer search started
    state.records.push(...page.records);
    state.next = page.next;
    renderRows(page.records);
    const total = page.total != null ? ` of ${page.total}` : '';
    $('count').textContent = `${state.records.length}${total} shown`;
  } catch (err) {
    if (token !== state.listToken) return;
    $('list-error').textContent = err.message;
    $('list-error').hidden = false;
    $('count').textContent = '';
  } finally {
    if (token === state.listToken) {
      $('more-btn').hidden = !state.next;
      $('more-btn').disabled = false;
      $('empty').hidden = state.records.length > 0 || !$('list-error').hidden;
    }
  }
}

function renderRows(records) {
  const def = state.objects[state.type];
  const body = $('table-body');
  for (const r of records) {
    const tr = el('tr', { dataset: { id: r.id } });
    tr.append(el('td', {}, recordTitle(state.type, r.properties)));
    for (const c of def.columns) tr.append(el('td', {}, r.properties[c] || ''));
    tr.addEventListener('click', () => openRecord(r.id));
    body.append(tr);
  }
}

function updateRow(record) {
  const i = state.records.findIndex((r) => r.id === record.id);
  if (i >= 0) state.records[i] = record;
  const tr = document.querySelector(`tr[data-id="${CSS.escape(record.id)}"]`);
  if (!tr) return;
  const def = state.objects[state.type];
  const cells = [recordTitle(state.type, record.properties), ...def.columns.map((c) => record.properties[c] || '')];
  tr.querySelectorAll('td').forEach((td, idx) => { td.textContent = cells[idx]; });
}

$('search').addEventListener('input', debounce((e) => {
  state.query = e.target.value;
  loadRecords();
}, 300));

$('more-btn').addEventListener('click', () => loadRecords({ append: true }));

// ---------- edit panel ----------

function highlightRow(id) {
  document.querySelectorAll('tbody tr').forEach((tr) => tr.classList.toggle('selected', tr.dataset.id === id));
}

async function openRecord(id) {
  highlightRow(id);
  showPanel();
  $('panel-title').textContent = 'Loading…';
  $('panel-form').replaceChildren();
  $('panel-status').textContent = '';
  try {
    const record = await call(window.crm.get(state.type, id));
    state.selected = record;
    renderPanel(record);
  } catch (err) {
    $('panel-title').textContent = 'Could not load record';
    $('panel-status').textContent = err.message;
  }
}

function openNew() {
  highlightRow(null);
  state.selected = { id: null, properties: {} };
  showPanel();
  renderPanel(state.selected);
}

function renderPanel(record) {
  const def = state.objects[state.type];
  const singular = def.label.replace(/s$/, '').replace(/ie$/, 'y').toLowerCase();
  $('panel-title').textContent = record.id ? recordTitle(state.type, record.properties) : `New ${singular}`;
  $('panel-status').textContent = record.id ? `ID ${record.id}` : '';
  const form = $('panel-form');
  form.replaceChildren();
  for (const f of def.fields) {
    const label = el('label', {}, f.label);
    const input = f.multiline ? el('textarea') : el('input', { type: 'text' });
    input.name = f.key;
    input.value = record.properties[f.key] || '';
    input.dataset.original = input.value;
    input.addEventListener('input', () => input.classList.toggle('changed', input.value !== input.dataset.original));
    label.append(input);
    form.append(label);
  }
  form.querySelector('input, textarea')?.focus();
}

function showPanel() {
  $('panel').hidden = false;
  $('app').classList.add('panel-open');
}

function closePanel() {
  $('panel').hidden = true;
  $('app').classList.remove('panel-open');
  state.selected = null;
  highlightRow(null);
}

$('panel-close').addEventListener('click', closePanel);
$('new-btn').addEventListener('click', openNew);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('panel').hidden) closePanel(); });

$('panel-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const sel = state.selected;
  if (!sel) return;

  // Only send what changed (or everything filled in, for a new record).
  const changes = {};
  $('panel-form').querySelectorAll('input, textarea').forEach((i) => {
    if (sel.id ? i.value !== i.dataset.original : i.value.trim() !== '') changes[i.name] = i.value.trim();
  });
  if (Object.keys(changes).length === 0) return toast('Nothing changed');

  const btn = $('save-btn');
  btn.disabled = true;
  try {
    if (sel.id) {
      const updated = await call(window.crm.update(state.type, sel.id, changes));
      // PATCH returns only some properties; merge so the row stays complete.
      const merged = { id: sel.id, properties: { ...sel.properties, ...updated.properties, ...changes } };
      state.selected = merged;
      updateRow(merged);
      renderPanel(merged);
      toast('Saved');
    } else {
      const created = await call(window.crm.create(state.type, changes));
      toast('Created');
      await loadRecords();
      openRecord(created.id);
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

// ---------- import ----------

function showImport() {
  closePanel();
  $('records-view').hidden = true;
  $('import-view').hidden = false;
  setActiveTab('import');
}

$('pick-btn').addEventListener('click', async () => {
  $('import-result').replaceChildren();
  try {
    const preview = await call(window.crm.pickImport());
    if (!preview) return; // cancelled
    $('import-preview').hidden = false;
    const extra = preview.unknownHeaders.length ? ` Columns ignored: ${preview.unknownHeaders.join(', ')}.` : '';
    $('import-summary').textContent =
      `${preview.fileName}: ${preview.count} contact${preview.count === 1 ? '' : 's'} ready to import, ${preview.skipped.length} skipped.${extra}`;
    $('import-sample').replaceChildren(...preview.sample.map((c) => {
      const p = c.properties;
      const tr = el('tr');
      tr.append(el('td', {}, String(c.line)), el('td', {}, p.email), el('td', {}, [p.firstname, p.lastname].filter(Boolean).join(' ')), el('td', {}, p.company || ''));
      return tr;
    }));
    $('import-skipped').replaceChildren(...preview.skipped.map((s) => el('li', {}, `Line ${s.line}: ${s.reason}`)));
    $('run-import-btn').disabled = preview.count === 0;
  } catch (err) {
    $('import-preview').hidden = true;
    toast(err.message.replace(/^\[csv\] /, ''), true);
  }
});

$('run-import-btn').addEventListener('click', async () => {
  const btn = $('run-import-btn');
  btn.disabled = true;
  $('import-progress').hidden = false;
  $('import-progress').value = 0;
  const stop = window.crm.onImportProgress(({ done, total }) => { $('import-progress').value = done / total; });
  try {
    const result = await call(window.crm.runImport());
    const out = $('import-result');
    out.replaceChildren(el('p', {}, `Imported ${result.created} contact${result.created === 1 ? '' : 's'}. ${result.failed.length} failed.`));
    if (result.failed.length) {
      out.append(el('ul', { class: 'skipped' }));
      out.lastChild.replaceChildren(...result.failed.map((f) => el('li', {}, `Line ${f.line}: ${f.reason}`)));
    }
    $('import-preview').hidden = true;
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
  } finally {
    stop();
    $('import-progress').hidden = true;
  }
});

// ---------- start ----------

(async function init() {
  const res = await window.crm.objects();
  state.objects = res.data;
  buildTabs();
  showConnect();
})();
