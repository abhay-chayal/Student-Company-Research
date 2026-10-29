// "Fix my companies": a student corrects the links and domain of a company they already submitted, and
// fills in the three details (employee strength, fresher package, revenue) for each of the five.
// Accepted companies are locked for links and name, but their three details stay open.
// Changing the company itself is switched off for now (ALLOW_COMPANY_CHANGE=1 turns it on).
const { cleanText, nameKey, coreKey, websiteKey } = require('./normalize');
const { parseDetails } = require('./details');
const { parseExtras } = require('./extras');
const { liveCheck } = require('./linklive');
const { isSimilar } = require('./similar');
const { getDb } = require('./db');
const { websiteExists } = require('./evaluate');

const companyChangeAllowed = () => process.env.ALLOW_COMPANY_CHANGE === '1';

// A company that is not accepted can have its links corrected (and, when switched on, be replaced by another company).
function editableParts(company) {
  const open = company.review_status !== 'accepted';
  return { links: open, identity: open && companyChangeAllowed(), details: true };
}

const NO_ERRORS = () => ({ name: null, website: null, domain: null, other: null, dlink: null, glink: null, strength: null, pkg: null, revenue: null });

/**
 * Checks one company the student is saving. input.detailsOnly = true saves only the three details
 * (every field required, any company, accepted ones too). Otherwise it saves links (and the three details
 * if the student typed any). Returns { fatal } when it cannot be edited, else
 * { errors, warnings, clean, extras, company }.
 */
async function evaluateFix(student, input) {
  const company = student.companies.find((c) => c.position === Number(input.position));
  if (!company) return { fatal: 'missing' };
  const errors = NO_ERRORS();
  const warnings = { dlink: null, glink: null };

  // ---- only the three details: open for every company ----
  if (input.detailsOnly) {
    const x = parseExtras(input, { requireAll: true });
    Object.assign(errors, x.errors);
    return { errors, warnings, clean: {}, extras: x.out, company, detailsOnly: true };
  }

  if (company.review_status === 'accepted') return { fatal: 'locked' };
  const can = editableParts(company);
  const db = getDb();

  const d = parseDetails(input, { requireAll: true });
  Object.assign(errors, d.errors);
  warnings.dlink = d.warnings.dlink; // allowed, but "may not be approved"
  warnings.glink = d.warnings.glink;

  // a job link that is closed or does not open is a warning, not a block
  await Promise.all(
    [['dlink', d.out.dlinkIsLink && d.out.dlink], ['glink', d.out.glinkIsLink && d.out.glink]]
      .filter(([, link]) => link)
      .map(async ([field, link]) => {
        if (errors[field] || warnings[field]) return;
        const r = await liveCheck(link, field);
        if (!r.ok) warnings[field] = r.message;
      })
  );

  const clean = { domain: d.out.domain, domain_link: d.out.dlink || '', general_link: d.out.glink || '' };

  // the three details are saved together with the links when the student has typed them
  const x = parseExtras(input, { requireAll: false });
  Object.assign(errors, x.errors);
  const extras = x.any ? x.out : null;

  // name and website (only when changing the company is switched on)
  if (can.identity) {
    const rawName = cleanText(input.name);
    const rawSite = cleanText(input.website);
    const nk = rawName ? nameKey(rawName) : null;
    const wk = rawSite ? websiteKey(rawSite) : null;
    if (nk && nk.error) errors.name = nk.error;
    if (wk && wk.error) errors.website = wk.error;
    const newName = nk && !nk.error && nk.key !== company.name_key ? nk : null;
    const newSite = wk && !wk.error && wk.key !== company.domain_key ? wk : null;
    if (newSite && !(await websiteExists(newSite.host, newSite.domain))) errors.website = 'This website could not be found. Check the spelling.';
    // A different company needs its own website: the old website must not stay behind the new name.
    if (newName && !newSite && !errors.name && !errors.website) {
      const sameCompany = isSimilar(newName.key, company.name_key) || (coreKey(rawName).length >= 3 && coreKey(rawName) === coreKey(company.name));
      if (!sameCompany) errors.website = 'You changed the company, so enter the official website of the new company.';
    }
    if (newName || newSite) {
      const keys = [newName && newName.key, newSite && newSite.key].filter(Boolean);
      const taken = await db.takenMap(keys);
      if (newName && taken.has(newName.key)) errors.name = errors.name || `"${taken.get(newName.key)}" is already taken.`;
      if (newSite && taken.has(newSite.key)) errors.website = errors.website || `This website belongs to "${taken.get(newSite.key)}", which is already taken.`;
      if (newName && !errors.name) {
        const mine = coreKey(rawName);
        const hit = (await db.allNames()).find((e) => e.name_key !== company.name_key && (isSimilar(newName.key, e.name_key) || (mine.length >= 3 && mine === coreKey(e.name))));
        if (hit) errors.name = `Too similar to "${hit.name}", which is already taken.`;
      }
    }
    if (rawName && !errors.name) Object.assign(clean, { name: rawName, name_key: (nk && nk.key) || company.name_key });
    if (rawSite && !errors.website) Object.assign(clean, { website: rawSite, domain_key: (wk && wk.key) || company.domain_key });
  }
  return { errors, warnings, clean, extras, company };
}

const hasErrors = (errors) => Object.values(errors).some(Boolean);

module.exports = { evaluateFix, editableParts, hasErrors, companyChangeAllowed };
