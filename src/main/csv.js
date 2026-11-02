// CSV reading for contact imports. Handles quoted fields, commas and
// line breaks inside quotes, escaped quotes ("") and Windows line endings.

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  if (text.charCodeAt(0) === 0xfeff) i = 1; // skip BOM (Excel adds one)
  const sep = guessSeparator(text.slice(i));

  for (; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (inQuotes) throw new Error('[csv] A quoted field is never closed');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// Dutch Excel saves CSV with semicolons. Decide from the header line.
function guessSeparator(text) {
  const header = text.split(/\r?\n/, 1)[0];
  const commas = (header.match(/,/g) || []).length;
  const semis = (header.match(/;/g) || []).length;
  return semis > commas ? ';' : ',';
}

// Common header spellings -> HubSpot property names.
const HEADER_ALIASES = {
  firstname: 'firstname', 'first name': 'firstname', voornaam: 'firstname',
  lastname: 'lastname', 'last name': 'lastname', achternaam: 'lastname', surname: 'lastname',
  email: 'email', 'e-mail': 'email', 'email address': 'email',
  phone: 'phone', 'phone number': 'phone', telefoon: 'phone', mobile: 'phone',
  company: 'company', 'company name': 'company', bedrijf: 'company',
  jobtitle: 'jobtitle', 'job title': 'jobtitle', title: 'jobtitle', functie: 'jobtitle',
  lifecyclestage: 'lifecyclestage', 'lifecycle stage': 'lifecyclestage',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Turns CSV text into contact rows ready to send, plus rows it skipped and why.
function csvToContacts(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('[csv] The file needs a header row and at least one contact');

  const headers = rows[0].map((h) => HEADER_ALIASES[h.trim().toLowerCase()] || null);
  const unknownHeaders = rows[0].filter((h, i) => !headers[i]).map((h) => h.trim());
  if (!headers.includes('email')) throw new Error('[csv] The file needs an "email" column');

  const contacts = [];
  const skipped = [];
  const seen = new Set();

  rows.slice(1).forEach((cells, idx) => {
    const line = idx + 2; // 1-based, counting the header
    const properties = {};
    headers.forEach((key, col) => {
      if (key && cells[col] != null && cells[col].trim() !== '') properties[key] = cells[col].trim();
    });

    const email = (properties.email || '').toLowerCase();
    if (!email) return skipped.push({ line, reason: 'No email address' });
    if (!EMAIL_RE.test(email)) return skipped.push({ line, reason: `"${properties.email}" is not a valid email` });
    if (seen.has(email)) return skipped.push({ line, reason: `${email} appears earlier in the file` });
    seen.add(email);
    properties.email = email;
    contacts.push({ line, properties });
  });

  return { contacts, skipped, unknownHeaders };
}

module.exports = { parseCsv, csvToContacts };
