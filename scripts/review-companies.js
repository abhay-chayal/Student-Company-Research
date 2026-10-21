// Full review of a company-research export: is every company genuine, and does it have a link
// to a specific job? Produces a status for every company and the lists the college needs.
//
//   node scripts/review-companies.js <export.xlsx> <output-folder> [--stage=fetch|render|websites|report|all]
//
// Stages cache their results in the output folder, so the slow steps run once:
//   fetch     open every link (plain request)             -> fetch-cache.json
//   render    re-open uncertain links in a real browser   -> render-cache.json
//   websites  check that each website belongs to its company -> website-cache.json
//   report    judge, apply manual overrides, write the workbook and results.json
// Manual decisions live in <output-folder>/overrides.json so every result can be explained.
// The outputs hold student names and emails. Keep them out of the repository.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { tldParse } = (() => { try { return { tldParse: require('tldts').parse }; } catch (e) { return {}; } })();
const { readAddress, openPage, decide, checkEmail, V, JOB_WORDS, isEmail, val } = require('./check-links');
const { nameKey } = require('../lib/normalize');

const args = process.argv.slice(2);
const input = args[0];
const outDir = args[1];
const stage = ((args.find((a) => a.startsWith('--stage=')) || '--stage=all').split('=')[1]);
if (!input || !outDir) { console.error('Usage: node scripts/review-companies.js <export.xlsx> <output-folder> [--stage=...]'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

const file = (n) => path.join(outDir, n);
const readJson = (n, d) => (fs.existsSync(file(n)) ? JSON.parse(fs.readFileSync(file(n), 'utf8')) : d);
const writeJson = (n, o) => fs.writeFileSync(file(n), JSON.stringify(o));

const STATUS = {
  ACCEPTED: 'Accepted',
  EMAIL: 'Pending: email only',
  GENERAL: 'Pending: general page',
  VERIFY: 'Pending: needs manual check',
  REDO: 'To redo',
};

// ---------- read the export ----------
async function loadRows() {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(input);
  const sheet = book.getWorksheet('Student Research') || book.worksheets[0];
  const head = sheet.getRow(1).values.slice(1).map(val);
  const col = (n) => head.findIndex((h) => String(h).toLowerCase().startsWith(n)) + 1;
  const C = { sno: col('s.no'), name: col('student name'), roll: col('rtu roll'), email: col('email'), company: col('company'), website: col('website'), domain: col('domain'), dlink: col('domain-specific'), flink: col('fresher') || col('general') };
  if (Object.values(C).some((x) => x < 1)) throw new Error('Missing columns. Header: ' + head.join(', '));
  const rows = [];
  sheet.eachRow((r, i) => {
    if (i === 1) return;
    const g = (k) => String(val(r.getCell(C[k]).value) || '').trim();
    rows.push({ sno: val(r.getCell(C.sno).value), name: g('name'), roll: g('roll'), email: g('email'), company: g('company'), website: g('website'), domain: g('domain'), dlink: g('dlink'), flink: g('flink') });
  });
  return rows;
}

const distinctLinks = (rows) => [...new Set(rows.flatMap((r) => [r.dlink, r.flink]).filter((x) => x && !isEmail(x)))];
const needsPage = (u) => ['posting', 'listing', 'other', 'careers'].includes(readAddress(u).kind);

// ---------- stage: fetch ----------
async function stageFetch(rows) {
  const cache = readJson('fetch-cache.json', {});
  const legacy = path.join(path.dirname(input), '.link-check-cache.json');
  if (fs.existsSync(legacy)) { const old = JSON.parse(fs.readFileSync(legacy, 'utf8')); for (const [k, v] of Object.entries(old)) if (!cache[k]) cache[k] = v; }
  const todo = distinctLinks(rows).filter((u) => needsPage(u) && !cache[u]);
  console.log(`fetch: ${todo.length} links to open (${Object.keys(cache).length} cached)`);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: 24 }, async () => {
    while (next < todo.length) {
      const u = todo[next++];
      cache[u] = await openPage(u);
      if (++done % 100 === 0) { console.log(`  ${done}/${todo.length}`); writeJson('fetch-cache.json', cache); }
    }
  }));
  writeJson('fetch-cache.json', cache);
}

// ---------- judging a link ----------
const UNCERTAIN = new Set([V.POSTING_LIKELY, V.UNCLEAR, V.BLOCKED, V.DOWN, V.CLOSED]);
function judgeFetched(url, caches) {
  const addr = readAddress(url);
  return decide(addr, caches.fetch[url]);
}
function judgeLink(url, caches, overrides) {
  if (overrides.links && overrides.links[url]) return { ...overrides.links[url], manual: true, page: caches.render[url] || caches.fetch[url] };
  const base = judgeFetched(url, caches);
  const f = caches.fetch[url];
  const rendered = caches.render[url];
  const addr = readAddress(url);
  if (!UNCERTAIN.has(base.v) || !rendered) return { ...base, page: f };
  const r = decide(addr, rendered);
  // A hard "not found" from the server stays closed unless the browser really finds a job there.
  if (base.v === V.CLOSED && f && (f.status === 404 || f.status === 410) && [V.CLOSED, V.DOWN, V.UNCLEAR, V.BLOCKED].includes(r.v)) return { ...base, page: f };
  if (r.v === V.DOWN && base.v !== V.DOWN) return { ...base, page: f };
  return { ...r, page: rendered, viaBrowser: true };
}

// ---------- stage: render ----------
async function stageRender(rows) {
  const { renderAll } = require('./review/render');
  const caches = { fetch: readJson('fetch-cache.json', {}), render: readJson('render-cache.json', {}) };
  const overrides = readJson('overrides.json', {});
  const todo = distinctLinks(rows).filter((u) => needsPage(u) && !caches.render[u] && !(overrides.links && overrides.links[u]) && UNCERTAIN.has(judgeFetched(u, caches).v));
  console.log(`render: ${todo.length} uncertain links to open in a browser`);
  let done = 0;
  const out = await renderAll(todo, {
    workers: 5,
    onDone: (u, r) => { caches.render[u] = r; if (++done % 25 === 0) { console.log(`  ${done}/${todo.length}`); writeJson('render-cache.json', caches.render); } },
  });
  writeJson('render-cache.json', { ...caches.render, ...out });
}

// ---------- website belongs to company? ----------
const STOP = new Set(['the', 'and', 'of', 'pvt', 'ltd', 'limited', 'private', 'inc', 'llp', 'india', 'technologies', 'technology', 'solutions', 'software', 'systems', 'services', 'group', 'global', 'labs', 'tech', 'consulting', 'company', 'corp', 'corporation', 'digital', 'infotech', 'it', 'ai', 'pvt.', 'ltd.', 'co', 'private']);
const tokensOf = (name) => name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t && !STOP.has(t));
function labelOf(site) {
  try {
    const u = new URL(/^https?:/i.test(site) ? site : 'https://' + site);
    const p = tldParse ? tldParse(u.hostname) : null;
    return { host: u.hostname.replace(/^www\./, ''), label: (p && p.domainWithoutSuffix ? p.domainWithoutSuffix : u.hostname.split('.')[0]).toLowerCase().replace(/[^a-z0-9]/g, '') };
  } catch (e) { return { host: site, label: '' }; }
}
function lev(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}
/** Does the web address look like the company name? (cheap first pass) */
function addressResembles(company, site) {
  const { label } = labelOf(site);
  const toks = tokensOf(company);
  const joined = toks.join('');
  if (!joined || !label) return true;
  if (label.includes(joined) || joined.includes(label)) return true;
  if (toks.some((t) => t.length >= 3 && label.includes(t))) return true;
  const init = toks.map((t) => t[0]).join('');
  if (init.length >= 2 && (label === init || label.startsWith(init))) return true;
  if (lev(joined, label) <= 2) return true;
  return toks.some((t) => t.length >= 4 && lev(t, label.slice(0, t.length)) <= 1);
}
function pageMentions(company, page) {
  const toks = tokensOf(company);
  const hay = [page.title, page.ogTitle, page.siteName, page.h1, page.lead, page.text].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
  const joined = toks.join('');
  const compact = hay.replace(/ /g, '');
  if (joined && compact.includes(joined)) return true;
  return toks.some((t) => t.length >= 4 && hay.includes(t));
}
async function stageWebsites(rows) {
  const cache = readJson('website-cache.json', {});
  const pairs = new Map();
  for (const r of rows) if (!addressResembles(r.company, r.website)) pairs.set(`${r.company.toLowerCase()}|${labelOf(r.website).host}`, r);
  const todo = [...pairs.entries()].filter(([k]) => !cache[k]);
  console.log(`websites: ${pairs.size} whose address does not resemble the name; ${todo.length} to open`);
  let next = 0;
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (next < todo.length) {
      const [k, r] = todo[next++];
      const host = labelOf(r.website).host;
      const f = await openPage('https://' + host + '/');
      let page = f;
      if (!f || f.error || (f.textLength || 0) < 300 || f.status >= 400) {
        try { const { renderAll } = require('./review/render'); const out = await renderAll(['https://' + host + '/'], { workers: 1 }); page = out['https://' + host + '/']; } catch (e) { /* keep fetch result */ }
      }
      let status = 'unknown';
      if (page && !page.error && page.status < 400) status = pageMentions(r.company, { ...page, text: page.text || page.lead || '' }) ? 'match' : 'mismatch';
      cache[k] = { status, title: (page && (page.title || page.ogTitle) || '').slice(0, 120), host };
    }
  }));
  writeJson('website-cache.json', cache);
}

// ---------- company-level judgement ----------
const REASON = {
  careers: "Only the company's general careers page was given. Paste the link of the specific job you are targeting.",
  home: "Only the company's home page was given. Paste the link of the specific job you are targeting.",
  search: 'A search or social page was given. Paste the link of the specific job on the company or job site.',
  listing: 'A list or search of jobs was given. Open the job you want and paste that job\'s own link.',
  closed: 'The job link no longer works or the job is closed. Give a link to a current job.',
  down: 'The link could not be opened or is not a hiring page. Give a working link to a specific job.',
  unclear: 'The link is not a clear hiring page. Give a working link to a specific job.',
  site: "The website does not belong to this company. Enter the company's own official website.",
  nolinks: 'No usable link was given. Give a link to a specific job.',
};
const kindOf = (v) => ({ [V.CAREERS]: 'careers', [V.HOME]: 'home', [V.SEARCH]: 'search', [V.LISTING]: 'listing', [V.CLOSED]: 'closed', [V.DOWN]: 'down', [V.BLOCKED]: 'down', [V.UNCLEAR]: 'unclear', [V.INVALID]: 'unclear', [V.EMAIL_BAD]: 'down' }[v] || 'unclear');
const WEAK_ORDER = ['closed', 'down', 'unclear', 'search', 'listing', 'home', 'careers']; // worst first

/** Does the job page (or its address) mention the company the student named? */
function relatesToCompany(r, link, page) {
  const toks = tokensOf(r.company);
  const joined = toks.join('');
  const site = labelOf(r.website).label;
  const hay = (link + ' ' + [page && page.title, page && page.ogTitle, page && page.siteName, page && page.h1, page && page.lead].filter(Boolean).join(' ')).toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!joined && !site) return true;
  if (joined && hay.includes(joined)) return true;
  if (site && site.length >= 4 && hay.includes(site)) return true;
  return toks.some((t) => t.length >= 4 && hay.includes(t));
}

function judgeCompany(r, ctx) {
  const key = `${r.roll}|${nameKey(r.company).key}`;
  const manual = ctx.overrides.companies && ctx.overrides.companies[key];
  const links = [['dlink', r.dlink], ['flink', r.flink]].filter(([, l]) => l);
  const verdicts = {};
  for (const [f, l] of links) verdicts[f] = isEmail(l) ? { ...ctx.emails[l], page: null } : judgeLink(l, ctx.caches, ctx.overrides);

  // website
  const wsKey = `${r.company.toLowerCase()}|${labelOf(r.website).host}`;
  const wsOverride = ctx.overrides.websites && ctx.overrides.websites[wsKey];
  let website = 'match';
  if (!addressResembles(r.company, r.website)) website = wsOverride ? wsOverride.status : (ctx.websites[wsKey] ? ctx.websites[wsKey].status : 'unknown');

  const jobs = Object.entries(verdicts).filter(([, v]) => v && [V.POSTING_OK, V.POSTING_LIKELY].includes(v.v));
  const emailOk = Object.values(verdicts).some((v) => v && v.v === V.EMAIL_OK);
  const best = jobs[0] && jobs[0][1];
  const page = best && best.page;
  const jobTitle = page ? (page.h1 || page.ogTitle || page.title || '').replace(/\s+/g, ' ').slice(0, 110) : '';

  let status, reason, why = Object.values(verdicts).filter(Boolean).map((v) => v.v).join(' / ');
  if (manual) { status = manual.status; reason = manual.reason || ''; why = 'manual: ' + (manual.note || ''); }
  else if (website === 'mismatch') { status = STATUS.REDO; reason = REASON.site; }
  else if (jobs.length && jobs.some(([, v]) => v.v === V.POSTING_OK)) {
    const okLink = jobs.find(([, v]) => v.v === V.POSTING_OK);
    const linkText = okLink[0] === 'dlink' ? r.dlink : r.flink;
    if (relatesToCompany(r, linkText, okLink[1].page)) { status = STATUS.ACCEPTED; reason = ''; }
    else { status = STATUS.VERIFY; reason = 'The job does not seem to be at this company. It will be checked by hand.'; why += ' (company not named on the job page)'; }
  }
  else if (jobs.length) { status = STATUS.VERIFY; reason = 'The link looks like a job but the site blocks automated checks. It will be checked by hand.'; why += ' (could not be confirmed automatically)'; }
  else if (emailOk) { status = STATUS.EMAIL; reason = 'Only an email was given (no job link). Add the link of the specific job if there is one.'; }
  else {
    const kinds = Object.values(verdicts).filter(Boolean).map((v) => kindOf(v.v));
    const generalOk = /general/i.test(r.domain) && Object.values(verdicts).some((v) => v && v.v === V.CAREERS);
    if (generalOk) { status = STATUS.GENERAL; reason = 'A general careers page was given for a company with no specific role. The college will decide if this is acceptable.'; }
    else { const worst = WEAK_ORDER.find((k) => kinds.includes(k)) || 'nolinks'; status = STATUS.REDO; reason = REASON[worst]; }
  }
  return { key, status, reason, why, verdicts, website, jobTitle, bestLink: best ? (jobs[0][0] === 'dlink' ? r.dlink : r.flink) : '' };
}

// ---------- report ----------
async function stageReport(rows) {
  const caches = { fetch: readJson('fetch-cache.json', {}), render: readJson('render-cache.json', {}) };
  const overrides = readJson('overrides.json', {});
  const websites = readJson('website-cache.json', {});
  const emails = {};
  for (const l of [...new Set(rows.flatMap((r) => [r.dlink, r.flink]).filter((x) => x && isEmail(x)))]) emails[l] = await checkEmail(l);
  const ctx = { caches, overrides, websites, emails };

  // links reused by several students are suspicious (copied from a friend)
  const used = new Map();
  for (const r of rows) for (const l of [r.dlink, r.flink]) if (l && !isEmail(l)) { if (!used.has(l)) used.set(l, new Set()); used.get(l).add(r.roll); }

  for (const r of rows) {
    r.j = judgeCompany(r, ctx);
    const shared = [r.dlink, r.flink].filter((l) => l && used.get(l) && used.get(l).size > 1);
    r.sharedLink = shared.length > 0;
  }

  const out = new ExcelJS.Workbook();
  const border = { style: 'thin', color: { argb: 'FFD0D5DD' } };
  const header = (ws, widths) => {
    ws.columns = widths.map(([h, w]) => ({ header: h, width: w }));
    const row = ws.getRow(1); row.height = 28;
    row.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }; c.alignment = { vertical: 'middle', wrapText: true }; });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };
  const fill = { [STATUS.ACCEPTED]: 'FFE3F1E4', [STATUS.EMAIL]: 'FFFFF2CC', [STATUS.GENERAL]: 'FFFFF2CC', [STATUS.VERIFY]: 'FFFFF2CC', [STATUS.REDO]: 'FFF8D7D3' };
  const link = (cell, v) => { if (typeof v === 'string' && /^https?:\/\//i.test(v)) cell.value = { text: v, hyperlink: v.slice(0, 2000) }; };

  const s1 = out.addWorksheet('All companies');
  header(s1, [['S.No', 7], ['Student', 22], ['RTU Roll No', 15], ['Email', 28], ['Company', 26], ['Website', 24], ['Domain', 22], ['Status', 20], ['What to fix', 56], ['Domain-specific link / email', 48], ['Fresher hiring link / email', 48], ['Job found', 40], ['Link verdicts', 40], ['Website check', 12], ['Link shared with other students', 14]]);
  rows.forEach((r, i) => {
    const row = s1.addRow([i + 1, r.name, r.roll, r.email, r.company, r.website, r.domain, r.j.status, r.j.reason, r.dlink, r.flink, r.j.jobTitle, r.j.why, r.j.website, r.sharedLink ? 'yes' : '']);
    row.alignment = { vertical: 'top', wrapText: true };
    row.getCell(8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill[r.j.status] } };
    link(row.getCell(10), r.dlink); link(row.getCell(11), r.flink);
  });
  s1.autoFilter = { from: 'A1', to: 'O1' };

  const accepted = rows.filter((r) => r.j.status === STATUS.ACCEPTED);
  const s2 = out.addWorksheet('Accepted');
  header(s2, [['RTU Roll No', 15], ['Student', 24], ['Company', 30], ['Domain', 24], ['Job found', 50], ['Job link', 60]]);
  accepted.sort((a, b) => a.roll.localeCompare(b.roll) || a.company.localeCompare(b.company)).forEach((r) => { const row = s2.addRow([r.roll, r.name, r.company, r.domain, r.j.jobTitle, r.j.bestLink]); link(row.getCell(6), r.j.bestLink); });

  const redo = rows.filter((r) => r.j.status === STATUS.REDO);
  const s3 = out.addWorksheet('To redo');
  header(s3, [['RTU Roll No', 15], ['Student', 24], ['Email', 28], ['Company', 28], ['Domain', 22], ['Reason', 70]]);
  redo.sort((a, b) => a.roll.localeCompare(b.roll)).forEach((r) => s3.addRow([r.roll, r.name, r.email, r.company, r.domain, r.j.reason]).alignment = { vertical: 'top', wrapText: true });

  const pending = rows.filter((r) => [STATUS.EMAIL, STATUS.GENERAL, STATUS.VERIFY].includes(r.j.status));
  const s4 = out.addWorksheet('Pending decision');
  header(s4, [['RTU Roll No', 15], ['Student', 24], ['Company', 28], ['Domain', 24], ['Status', 22], ['Link or email given', 60]]);
  pending.sort((a, b) => a.j.status.localeCompare(b.j.status) || a.roll.localeCompare(b.roll)).forEach((r) => s4.addRow([r.roll, r.name, r.company, r.domain, r.j.status, r.dlink || r.flink]));

  const per = new Map();
  for (const r of rows) { if (!per.has(r.roll)) per.set(r.roll, { name: r.name, roll: r.roll, email: r.email, a: 0, p: 0, d: 0, n: 0, fix: [] }); const p = per.get(r.roll); p.n++; if (r.j.status === STATUS.ACCEPTED) p.a++; else if (r.j.status === STATUS.REDO) { p.d++; p.fix.push(r.company); } else p.p++; }
  const s5 = out.addWorksheet('Per student');
  header(s5, [['RTU Roll No', 15], ['Student', 24], ['Email', 30], ['Companies', 11], ['Accepted', 10], ['Pending', 10], ['To redo', 10], ['Companies to redo', 70]]);
  [...per.values()].sort((a, b) => b.d - a.d || a.roll.localeCompare(b.roll)).forEach((p) => s5.addRow([p.roll, p.name, p.email, p.n, p.a, p.p, p.d, p.fix.join(', ')]));

  const tally = (f) => { const m = new Map(); rows.forEach((r) => { const k = f(r); m.set(k, (m.get(k) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const s6 = out.addWorksheet('Summary');
  s6.columns = [{ width: 52 }, { width: 14 }, { width: 12 }];
  const add = (a, b, c) => s6.addRow([a, b, c]);
  add('Companies reviewed', rows.length); add('Students', per.size); add('');
  add('Result', 'Companies', '%').font = { bold: true };
  for (const [k, n] of tally((r) => r.j.status)) add(k, n, Math.round((n / rows.length) * 1000) / 10 + '%');
  add(''); add('Reasons companies need to be redone', 'Companies').font = { bold: true };
  const rs = new Map(); redo.forEach((r) => rs.set(r.j.reason, (rs.get(r.j.reason) || 0) + 1)); [...rs.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => add(k, n));
  add(''); add('Students by number of accepted companies', 'Students').font = { bold: true };
  const dist = new Map(); [...per.values()].forEach((p) => dist.set(p.a, (dist.get(p.a) || 0) + 1)); [...dist.entries()].sort((a, b) => b[0] - a[0]).forEach(([k, n]) => add(`${k} of 5 accepted`, n));
  s6.eachRow((row) => { row.getCell(1).alignment = { wrapText: true, vertical: 'top' }; });
  await out.xlsx.writeFile(file('company-review.xlsx'));

  writeJson('results.json', rows.map((r) => ({ roll: r.roll, name: r.name, company: r.company, name_key: nameKey(r.company).key, status: r.j.status, reason: r.j.reason })));
  console.log(`\nReviewed ${rows.length} companies, ${per.size} students`);
  for (const [k, n] of tally((r) => r.j.status)) console.log(`  ${k.padEnd(24)} ${n}`);
  console.log('Reasons:'); [...rs.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k.slice(0, 95)}`));
  console.log('Wrote', file('company-review.xlsx'));
}

// ---------- final list: each column judged on its own ----------
// Either column may be filled, or both; one correct column is enough.
// Domain-specific column: a specific job link or an email. A careers page counts only for domain General.
// Fresher hiring column: a careers page, a job list, a specific job link or an email.
function judgeFinal(r, ctx) {
  const key = `${r.roll}|${nameKey(r.company).key}`;
  const manual = ctx.overrides.companies && ctx.overrides.companies[key];
  const out = { key, approved: false, d: 'bad', f: 'bad' };
  if (manual) { out.approved = manual.status === STATUS.ACCEPTED; out.d = out.f = 'manual'; return out; }
  const wsKey = `${r.company.toLowerCase()}|${labelOf(r.website).host}`;
  const wsOverride = ctx.overrides.websites && ctx.overrides.websites[wsKey];
  let website = 'match';
  if (!addressResembles(r.company, r.website)) website = wsOverride ? wsOverride.status : (ctx.websites[wsKey] ? ctx.websites[wsKey].status : 'unknown');
  const general = /general/i.test(r.domain);
  const judge = (link, pageKinds) => {
    if (!link) return 'empty';
    if (isEmail(link)) { const e = ctx.emails[link]; return e && e.v === V.EMAIL_OK ? 'ok-email' : 'bad-email'; }
    const v = judgeLink(link, ctx.caches, ctx.overrides);
    const related = relatesToCompany(r, link, v.page);
    if (v.v === V.POSTING_OK) return related ? 'ok-job' : 'other-company';
    if (v.v === V.POSTING_LIKELY) return 'unconfirmed';
    if (pageKinds.includes(v.v)) return related ? 'ok-page' : 'other-company';
    return 'bad';
  };
  out.d = judge(r.dlink, general ? [V.CAREERS] : []);
  out.f = judge(r.flink, [V.CAREERS, V.LISTING]);
  out.website = website;
  // A student may fill either column or both: one correct column is enough.
  out.approved = website !== 'mismatch' && (out.d.startsWith('ok') || out.f.startsWith('ok'));
  return out;
}

async function stageFinal(rows) {
  const caches = { fetch: readJson('fetch-cache.json', {}), render: readJson('render-cache.json', {}) };
  const overrides = readJson('overrides.json', {});
  const websites = readJson('website-cache.json', {});
  const emails = {};
  for (const l of [...new Set(rows.flatMap((r) => [r.dlink, r.flink]).filter((x) => x && isEmail(x)))]) emails[l] = await checkEmail(l);
  const ctx = { caches, overrides, websites, emails };
  for (const r of rows) r.fin = judgeFinal(r, ctx);
  rows.sort((a, b) => a.roll.localeCompare(b.roll) || a.company.localeCompare(b.company));
  const folder = path.join(outDir, 'deliverables');
  fs.mkdirSync(folder, { recursive: true });
  const label = (r) => (r.fin.approved ? 'Approved' : 'Not approved');

  const out = new ExcelJS.Workbook();
  const ws = out.addWorksheet('Final list');
  ws.columns = [{ header: 'S.No', width: 7 }, { header: 'RTU Roll No', width: 16 }, { header: 'Student Name', width: 28 }, { header: 'Company', width: 36 }, { header: 'Approved / Not approved', width: 24 }];
  ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  // Number, roll and name only on a student's first row; the other companies sit in sub-rows (no merged cells).
  let student = 0, lastRoll = null;
  rows.forEach((r) => {
    const first = r.roll !== lastRoll;
    if (first) student++;
    lastRoll = r.roll;
    const row = ws.addRow([first ? student : '', first ? r.roll : '', first ? r.name : '', r.company, label(r)]);
    row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: r.fin.approved ? 'FFE3F1E4' : 'FFF8D7D3' } };
    if (first) row.eachCell((c) => { c.border = { top: { style: 'thin', color: { argb: 'FF9AA5B1' } } }; });
  });

  const per = new Map();
  for (const r of rows) { if (!per.has(r.roll)) per.set(r.roll, { n: 0, a: 0 }); const p = per.get(r.roll); p.n++; if (r.fin.approved) p.a++; }
  const ap = rows.filter((r) => r.fin.approved).length;
  const S = out.addWorksheet('Summary');
  S.columns = [{ width: 50 }, { width: 12 }];
  S.addRow(['Companies', rows.length]); S.addRow(['Approved', ap]); S.addRow(['Not approved', rows.length - ap]); S.addRow([]);
  S.addRow(['Students', per.size]);
  for (let k = 5; k >= 0; k--) S.addRow([`Students with ${k} of 5 approved`, [...per.values()].filter((p) => p.a === k).length]);
  // A file that is open in Excel is locked: save under a new name instead of failing.
  const target = (base, ext) => {
    for (let n = 1; ; n++) {
      const p = path.join(folder, n === 1 ? `${base}.${ext}` : `${base}-v${n}.${ext}`);
      try { fs.closeSync(fs.openSync(p, 'a')); return p; } catch (e) { if (e.code !== 'EBUSY' && e.code !== 'EPERM') throw e; }
    }
  };
  const xlsxPath = target('FEC-28-final-list', 'xlsx');
  await out.xlsx.writeFile(xlsxPath);
  console.log('wrote', xlsxPath);

  const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const csv = [['S.No', 'RTU Roll No', 'Student Name', 'Company', 'Approved / Not approved']].concat(rows.map((r, i) => [i + 1, r.roll, r.name, r.company, label(r)]));
  fs.writeFileSync(target('FEC-28-final-list', 'csv'),'﻿' + csv.map((x) => x.map(q).join(',')).join('\r\n'));
  writeJson('final-results.json', rows.map((r) => ({ roll: r.roll, name: r.name, company: r.company, name_key: nameKey(r.company).key, status: r.fin.approved ? STATUS.ACCEPTED : STATUS.REDO, reason: '', d: r.fin.d, f: r.fin.f, website: r.fin.website })));

  const tally = {};
  for (const r of rows) { const k = `D:${r.fin.d.padEnd(14)} F:${r.fin.f}`; tally[k] = (tally[k] || 0) + 1; }
  console.log(`final: approved ${ap} | not approved ${rows.length - ap} | total ${rows.length}`);
  console.log(Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => String(n).padStart(5) + '  ' + k).join('\n'));
}

(async () => {
  const rows = await loadRows();
  console.log(`rows: ${rows.length}`);
  if (['fetch', 'all'].includes(stage)) await stageFetch(rows);
  if (['render', 'all'].includes(stage)) await stageRender(rows);
  if (['websites', 'all'].includes(stage)) await stageWebsites(rows);
  if (['report', 'all'].includes(stage)) await stageReport(rows);
  if (stage === 'final') await stageFinal(rows);
})();
