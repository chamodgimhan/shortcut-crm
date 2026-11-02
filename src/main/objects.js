// Which HubSpot objects the app shows, and which fields it reads and edits.
// Keeping this in one place means adding a field is a one-line change.
// Plain data only, so it can be sent to the window as-is.

const OBJECTS = {
  contacts: {
    label: 'Contacts',
    titleFields: ['firstname', 'lastname'], fallbackField: 'email',
    fields: [
      { key: 'firstname', label: 'First name' },
      { key: 'lastname', label: 'Last name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'company', label: 'Company' },
      { key: 'jobtitle', label: 'Job title' },
      { key: 'lifecyclestage', label: 'Lifecycle stage' },
    ],
    columns: ['email', 'company', 'lifecyclestage'],
  },
  companies: {
    label: 'Companies',
    titleFields: ['name'], fallbackField: 'domain',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'domain', label: 'Website domain' },
      { key: 'industry', label: 'Industry' },
      { key: 'city', label: 'City' },
      { key: 'phone', label: 'Phone' },
    ],
    columns: ['domain', 'city', 'industry'],
  },
  deals: {
    label: 'Deals',
    titleFields: ['dealname'],
    fields: [
      { key: 'dealname', label: 'Deal name' },
      { key: 'amount', label: 'Amount' },
      { key: 'dealstage', label: 'Stage' },
      { key: 'pipeline', label: 'Pipeline' },
      { key: 'closedate', label: 'Close date' },
    ],
    columns: ['amount', 'dealstage', 'closedate'],
  },
  tickets: {
    label: 'Tickets',
    titleFields: ['subject'],
    fields: [
      { key: 'subject', label: 'Subject' },
      { key: 'content', label: 'Description', multiline: true },
      { key: 'hs_pipeline', label: 'Pipeline' },
      { key: 'hs_pipeline_stage', label: 'Stage' },
      { key: 'hs_ticket_priority', label: 'Priority' },
    ],
    columns: ['hs_pipeline_stage', 'hs_ticket_priority'],
  },
};

function getObject(type) {
  const obj = OBJECTS[type];
  if (!obj) throw new Error(`[objects] Unknown object type: ${type}`);
  return obj;
}

module.exports = { OBJECTS, getObject };
