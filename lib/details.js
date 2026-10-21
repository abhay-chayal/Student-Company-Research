// Rules for one company's "domain" and "where to apply" fields.
// Used by the student form (evaluate.js) and by the "fix my companies" step (api/fix.js).
const { cleanText, domainText, hiringLink } = require('./normalize');
const { GENERAL, ALL_DOMAINS } = require('./domains');
const { judgeLink, stripTracking, pasteProblem } = require('./linkrules');

/**
 * One link or email field. field is "dlink" (domain-specific) or "glink" (fresher hiring).
 * A link that looks wrong for the field is not refused: it comes back with a warning
 * ("it may not be approved") and the student may still save it. Only text that cannot be a link or an email is an error.
 */
function linkField(raw, field) {
  const text = cleanText(raw);
  if (text) {
    const problem = pasteProblem(text);
    if (problem) return { error: problem };
  }
  const r = hiringLink(raw);
  if (r.error) return { error: r.error };
  if (r.empty) return { empty: true };
  if (r.kind === 'email') return { value: r.value, kind: 'email' };
  const clean = stripTracking(r.value);
  const verdict = judgeLink(clean, { field });
  if (!verdict.ok && verdict.kind === 'invalid') return { error: verdict.message };
  return { value: clean, kind: 'link', verdict: verdict.kind, warning: verdict.ok ? null : verdict.message };
}

/**
 * row: { domain, domainOther, domainLink, generalLink } as sent by the browser.
 * requireAll: also complain about things that are still missing.
 * Returns { errors: { domain, other, dlink, glink }, warnings: { dlink, glink }, out: { domain, general, dlink, glink, dlinkIsLink, glinkIsLink } }.
 */
function parseDetails(row, { requireAll }) {
  const errors = { domain: null, other: null, dlink: null, glink: null };
  const warnings = { dlink: null, glink: null };
  const out = { domain: null, general: false, dlink: null, glink: null, dlinkIsLink: false, glinkIsLink: false };

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
    const r = linkField(row.domainLink, 'dlink');
    if (r.error) errors.dlink = r.error; else if (!r.empty) { out.dlink = r.value; out.dlinkIsLink = r.kind === 'link'; warnings.dlink = r.warning || null; }
  }
  const g = linkField(row.generalLink, 'glink');
  if (g.error) errors.glink = g.error; else if (!g.empty) { out.glink = g.value; out.glinkIsLink = g.kind === 'link'; warnings.glink = g.warning || null; }

  // At least one way to apply must be given.
  if (requireAll && !errors.dlink && !errors.glink && !out.dlink && !out.glink) {
    if (out.general) errors.glink = 'Enter the fresher hiring link or email.';
    else errors.dlink = 'Enter a link or email for this domain, or a fresher hiring link or email below.';
  }
  return { errors, warnings, out };
}

module.exports = { parseDetails, linkField };
