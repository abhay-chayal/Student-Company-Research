// Rules for one company's "domain" and "where to apply" fields.
// Used by the student form (evaluate.js) and by the admin Edit dialog (api/admin.js).
const { cleanText, domainText, hiringLink } = require('./normalize');
const { GENERAL, ALL_DOMAINS } = require('./domains');

/**
 * row: { domain, domainOther, domainLink, generalLink } as sent by the browser.
 * requireAll: also complain about things that are still missing.
 * Returns { errors: { domain, other, dlink, glink }, out: { domain, general, dlink, glink } }.
 */
function parseDetails(row, { requireAll }) {
  const errors = { domain: null, other: null, dlink: null, glink: null };
  const out = { domain: null, general: false, dlink: null, glink: null };

  const rawDomain = cleanText(row.domain);
  if (rawDomain || requireAll) {
    if (!rawDomain) errors.domain = 'Choose a domain.';
    else if (rawDomain === '__general__') { out.domain = GENERAL; out.general = true; }
    else if (rawDomain === '__other__') {
      const r = domainText(row.domainOther);
      if (r.error) errors.other = r.error; else out.domain = r.value;
    } else if (ALL_DOMAINS.has(rawDomain)) out.domain = rawDomain;
    else errors.domain = 'Choose a domain from the list.';
  }

  // The domain-specific link or email is not used for "General" companies.
  if (!out.general) {
    const r = hiringLink(row.domainLink);
    if (r.error) errors.dlink = r.error; else if (!r.empty) out.dlink = r.value;
  }
  const g = hiringLink(row.generalLink);
  if (g.error) errors.glink = g.error; else if (!g.empty) out.glink = g.value;

  // At least one way to apply must be given.
  if (requireAll && !errors.dlink && !errors.glink && !out.dlink && !out.glink) {
    if (out.general) errors.glink = 'Enter the fresher hiring link or email.';
    else errors.dlink = 'Enter a link or email for this domain, or a fresher hiring link or email below.';
  }
  return { errors, out };
}

module.exports = { parseDetails };
