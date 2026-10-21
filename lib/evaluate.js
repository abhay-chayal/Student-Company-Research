const dns = require('dns').promises;
const { cleanText, nameKey, coreKey, websiteKey, personName, rollNumber, emailAddress } = require('./normalize');
const { parseDetails } = require('./details');
const { liveCheck } = require('./linklive');
const { getDb } = require('./db');
const { isSimilar } = require('./similar');

const COMPANY_COUNT = 5;
const dnsCache = new Map(); // host -> { ok, at }
const DNS_TTL_MS = 10 * 60 * 1000;
const coreCache = new Map(); // name -> loose key, so long lists are not re-processed on every check
const coreOf = (name) => {
  if (!coreCache.has(name)) coreCache.set(name, coreKey(name));
  return coreCache.get(name);
};

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
    student: { name: null, roll: null, email: null },
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
  const rawEmail = cleanText(input.email);
  if (rawEmail || requireAll) {
    const r = emailAddress(rawEmail);
    if (r.error) result.student.email = r.error;
    else student.email = r.value;
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

    // domain (role) and where to apply
    const d = parseDetails(row, { requireAll });
    Object.assign(result.companies[i], d.errors);
    p.domain = d.out.domain;
    p.general = d.out.general;
    p.dlink = d.out.dlink;
    p.glink = d.out.glink;
    p.dlinkIsLink = d.out.dlinkIsLink;
    p.glinkIsLink = d.out.glinkIsLink;
    parsed.push(p);
  }

  // Job links must open and must not be closed (unclear cases are let through).
  await Promise.all(
    parsed.flatMap((p, i) =>
      [['dlink', p.dlinkIsLink && p.dlink], ['glink', p.glinkIsLink && p.glink]]
        .filter(([, link]) => link)
        .map(async ([field, link]) => {
          if (result.companies[i][field]) return;
          const r = await liveCheck(link);
          if (!r.ok) result.companies[i][field] = r.message;
        })
    )
  );

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
      const mine = coreOf(p.rawCompany);
      const hit = existing.find((e) => isSimilar(p.nameKey, e.name_key) || (mine.length >= 3 && mine === coreOf(e.name)));
      if (hit) {
        result.companies[i].name = `Too similar to "${hit.name}", which is already taken.`;
        return;
      }
      for (let j = 0; j < i; j++) {
        if (parsed[j].nameKey && (isSimilar(p.nameKey, parsed[j].nameKey) || (mine.length >= 3 && mine === coreOf(parsed[j].rawCompany)))) {
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
    email: student.email,
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
    Boolean(result.student.name || result.student.roll || result.student.email) ||
    result.companies.some((c) => Object.values(c).some(Boolean))
  );
}

module.exports = { evaluate, hasErrors, COMPANY_COUNT, websiteExists };
