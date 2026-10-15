const dns = require('dns').promises;
const { cleanText, nameKey, websiteKey, personName, rollNumber, domainText, hiringLink } = require('./normalize');
const { GENERAL, ALL_DOMAINS } = require('./domains');
const { getDb } = require('./db');
const { isSimilar } = require('./similar');

const COMPANY_COUNT = 5;
const dnsCache = new Map(); // host -> { ok, at }
const DNS_TTL_MS = 10 * 60 * 1000;

async function lookupWithTimeout(host, ms) {
  return Promise.race([
    dns.lookup(host),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

/** True if the website's domain exists on the internet. */
async function websiteExists(host, domain) {
  if (process.env.SKIP_DNS === '1') return true;
  const cached = dnsCache.get(domain);
  if (cached && Date.now() - cached.at < DNS_TTL_MS) return cached.ok;

  let ok = false;
  for (const candidate of [...new Set([host, domain, 'www.' + domain])]) {
    try {
      await lookupWithTimeout(candidate, 4000);
      ok = true;
      break;
    } catch (err) {
      if (err && err.code === 'ENOTFOUND') continue;
      if (err && err.message === 'timeout') continue;
    }
  }
  dnsCache.set(domain, { ok, at: Date.now() });
  return ok;
}

/**
 * Checks everything the student has typed so far.
 * Fields that are still empty get no message (unless requireAll is true).
 * Returns { student: {name, roll}, companies: [{name, website}], clean }.
 */
async function evaluate(input, { requireAll = false } = {}) {
  const db = getDb();
  const result = {
    student: { name: null, roll: null },
    companies: Array.from({ length: COMPANY_COUNT }, () => ({ name: null, website: null, domain: null, other: null, dlink: null, glink: null })),
    clean: null,
  };

  // --- student ---
  const rawName = cleanText(input.name);
  const rawRoll = cleanText(input.roll);
  let student = {};
  if (rawName || requireAll) {
    const r = personName(rawName);
    if (r.error) result.student.name = r.error;
    else student.name = r.value;
  }
  if (rawRoll || requireAll) {
    const r = rollNumber(rawRoll);
    if (r.error) result.student.roll = r.error;
    else {
      student.roll = r.value;
      if (await db.rollExists(r.value)) {
        result.student.roll = 'This roll number has already submitted its companies.';
      }
    }
  }

  // --- company names and websites ---
  const rows = Array.isArray(input.companies) ? input.companies : [];
  const parsed = [];
  for (let i = 0; i < COMPANY_COUNT; i++) {
    const row = rows[i] || {};
    const rawCompany = cleanText(row.name);
    const rawSite = cleanText(row.website);
    const p = { rawCompany, rawSite, nameKey: null, site: null };

    if (rawCompany || requireAll) {
      const r = nameKey(rawCompany);
      if (r.error) result.companies[i].name = r.error;
      else p.nameKey = r.key;
    }
    if (rawSite || requireAll) {
      const r = websiteKey(rawSite);
      if (r.error) result.companies[i].website = r.error;
      else p.site = r;
    }

    // domain (role) the student is targeting
    const rawDomain = cleanText(row.domain);
    if (rawDomain || requireAll) {
      if (!rawDomain) result.companies[i].domain = 'Choose a domain.';
      else if (rawDomain === '__general__') { p.domain = GENERAL; p.general = true; }
      else if (rawDomain === '__other__') {
        const r = domainText(row.domainOther);
        if (r.error) result.companies[i].other = r.error; else p.domain = r.value;
      } else if (ALL_DOMAINS.has(rawDomain)) p.domain = rawDomain;
      else result.companies[i].domain = 'Choose a domain from the list.';
    }

    // domain-specific link/email (not used for "General" companies)
    if (!p.general) {
      const r = hiringLink(row.domainLink);
      if (r.error) result.companies[i].dlink = r.error; else if (!r.empty) p.dlink = r.value;
    }
    const g = hiringLink(row.generalLink);
    if (g.error) result.companies[i].glink = g.error; else if (!g.empty) p.glink = g.value;

    // at least one way to apply must be given
    if (requireAll && !result.companies[i].dlink && !result.companies[i].glink && !p.dlink && !p.glink) {
      if (p.general) result.companies[i].glink = 'Enter the general fresher hiring link or email.';
      else result.companies[i].dlink = 'Enter a link or email for this domain, or a general fresher link or email below.';
    }
    parsed.push(p);
  }

  // The website must exist on the internet.
  await Promise.all(
    parsed.map(async (p, i) => {
      if (!p.site) return;
      if (!(await websiteExists(p.site.host, p.site.domain))) {
        result.companies[i].website = 'This website could not be found. Check the spelling.';
        p.site = null;
      }
    })
  );

  // Same company used twice in this form. A company's own name and website
  // naturally share a key (Amazon + amazon.com), so only other rows count.
  const seen = new Map(); // key -> row index
  parsed.forEach((p, i) => {
    const mine = [];
    if (p.nameKey) mine.push(['name', p.nameKey]);
    if (p.site) mine.push(['website', p.site.key]);
    for (const [field, key] of mine) {
      if (seen.has(key) && seen.get(key) !== i) {
        const msg = `Same company as #${seen.get(key) + 1} in this form.`;
        if (!result.companies[i][field]) result.companies[i][field] = msg;
      }
    }
    for (const [, key] of mine) if (!seen.has(key)) seen.set(key, i);
  });

  // Already taken by someone else?
  const keys = [...new Set(parsed.flatMap((p) => [p.nameKey, p.site && p.site.key]).filter(Boolean))];
  const taken = await db.takenMap(keys);
  parsed.forEach((p, i) => {
    if (p.nameKey && !result.companies[i].name && taken.has(p.nameKey)) {
      result.companies[i].name = `"${taken.get(p.nameKey)}" is already taken.`;
    }
    if (p.site && !result.companies[i].website && taken.has(p.site.key)) {
      result.companies[i].website = `This website belongs to "${taken.get(p.site.key)}", which is already taken.`;
    }
  });

  // Almost the same name as a taken one (a typo, or a few extra letters)?
  if (parsed.some((p) => p.nameKey)) {
    const existing = await db.allNames();
    parsed.forEach((p, i) => {
      if (!p.nameKey || result.companies[i].name) return;
      const hit = existing.find((e) => isSimilar(p.nameKey, e.name_key));
      if (hit) {
        result.companies[i].name = `Too similar to "${hit.name}", which is already taken.`;
        return;
      }
      for (let j = 0; j < i; j++) {
        if (parsed[j].nameKey && isSimilar(p.nameKey, parsed[j].nameKey)) {
          result.companies[i].name = `Too similar to company #${j + 1} in this form.`;
          return;
        }
      }
    });
  }

  result.clean = {
    rollNo: student.roll,
    rollKey: student.roll,
    name: student.name,
    companies: parsed.map((p) => ({
      name: p.rawCompany,
      name_key: p.nameKey,
      website: p.rawSite,
      domain_key: p.site && p.site.key,
      domain: p.domain || null,
      domain_link: p.dlink || '',
      general_link: p.glink || '',
    })),
  };
  return result;
}

function hasErrors(result) {
  return (
    Boolean(result.student.name || result.student.roll) ||
    result.companies.some((c) => Object.values(c).some(Boolean))
  );
}

module.exports = { evaluate, hasErrors, COMPANY_COUNT };
