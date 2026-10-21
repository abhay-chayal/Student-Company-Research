// Checks every link in an admin export and says whether it leads to a real job posting.
//
//   node scripts/check-links.js "C:/path/company-research.xlsx" [output.xlsx]
//
// For each link it looks at the address itself (homepage? plain /careers? a job id?), opens it
// (alive? redirected to a general page? says "closed"?), and reads the page title and any
// machine-readable "JobPosting" data. Emails get a mail-server check. Results go in a new
// workbook with colour-coded verdicts, a summary, and a list of students to contact.
// The output contains student names and emails, so keep it out of the repository.
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const ExcelJS = require('exceljs');


const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const val = (v) => (v && v.text ? v.text : v && v.richText ? v.richText.map((t) => t.text).join('') : v && v.result !== undefined ? v.result : v);
const isEmail = (s) => /^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/.test(s) && !/^https?:/i.test(s);

// ---------- 1. read the address itself ----------
const { readAddress } = require('../lib/linkrules');

// ---------- 2. open the page ----------
const JOB_WORDS = /\b(engineer|developer|analyst|intern(ship)?|trainee|scientist|associate|manager|executive|consultant|designer|architect|programmer|specialist|lead|officer|apprentice|sde|swe|tester|qa|administrator)\b/i;
const CLOSED = /(no longer (?:available|accepting|open)|(?:position|job|role|vacancy|posting|requisition)[^.]{0,30}(?:has been |is |was )?(?:filled|closed|expired|removed|unavailable|no longer)|this (?:job|position|role|posting)[^.]{0,30}(?:expired|closed|filled)|applications? (?:are|is|have been)? ?closed|page (?:you are looking for )?(?:was |could )?not (?:be )?found|job not found|we couldn.?t find|oops|404|doesn.?t exist|does not exist|sorry,? (?:this|that))/i;

function stripTags(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;|&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
}

const hostSlots = new Map();
async function withHostLimit(host, fn) {
  while ((hostSlots.get(host) || 0) >= 2) await new Promise((r) => setTimeout(r, 120));
  hostSlots.set(host, (hostSlots.get(host) || 0) + 1);
  try { return await fn(); } finally { hostSlots.set(host, hostSlots.get(host) - 1); }
}

async function openPage(raw) {
  const url = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
  const host = new URL(url).hostname;
  return withHostLimit(host, async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    try {
      const res = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' } });
      const type = res.headers.get('content-type') || '';
      let body = '';
      if (/html|json|text|xml/i.test(type)) body = (await res.text()).slice(0, 400000);
      const title = ((body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
      const ogTitle = ((body.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || [])[1] || '').trim();
      const h1 = stripTags(((body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '')).slice(0, 160);
      const text = stripTags(body);
      return {
        status: res.status, finalUrl: res.url, type, title: title.slice(0, 200), ogTitle: ogTitle.slice(0, 200), h1,
        jobPostingData: /["']@type["']\s*:\s*["']JobPosting["']/i.test(body),
        closedText: CLOSED.test((title + ' ' + h1 + ' ' + text.slice(0, 2500))),
        textLength: text.length, isPdf: /pdf/i.test(type),
      };
    } catch (err) {
      return { error: err.name === 'AbortError' ? 'timeout' : (err.cause && err.cause.code) || err.message };
    } finally { clearTimeout(timer); }
  });
}

// ---------- 3. decide ----------
const V = {
  POSTING_OK: 'Job posting (verified)',
  POSTING_LIKELY: 'Job posting (likely)',
  CLOSED: 'Dead or closed job',
  CAREERS: 'General careers page',
  LISTING: 'Job list or search page',
  HOME: 'Company home page',
  SEARCH: 'Search or social page',
  UNCLEAR: 'Not a clear hiring page',
  BLOCKED: "Couldn't verify (site blocks checks)",
  DOWN: "Couldn't open (error)",
  EMAIL_OK: 'Email (mail server found)',
  EMAIL_BAD: 'Email (no mail server)',
  INVALID: 'Not a valid link',
};

function decide(addr, page) {
  if (addr.kind === 'invalid') return { v: V.INVALID, why: addr.reason };
  if (addr.kind === 'search') return { v: V.SEARCH, why: addr.reason };
  if (addr.kind === 'homepage') return { v: V.HOME, why: addr.reason };
  // A careers address whose page is "not found" is a broken link, not just a general page.
  if (addr.kind === 'careers' && page && !page.error && (page.status === 404 || page.status === 410)) {
    return { v: V.DOWN, why: `The careers page was not found (HTTP ${page.status})` };
  }
  // A general careers address stays a careers page unless the page itself shows a specific job.
  if (addr.kind === 'careers' && (!page || page.error || page.status >= 400 || !JOB_WORDS.test([page.h1, page.ogTitle, page.title].filter(Boolean).join(' | ')))) {
    return { v: V.CAREERS, why: addr.reason };
  }
  if (!page || page.error) {
    const e = page && page.error;
    return { v: addr.kind === 'posting' ? V.POSTING_LIKELY : V.DOWN, why: addr.kind === 'posting' ? `Address looks like a job; page could not be opened (${e})` : `Could not open the page (${e})` };
  }
  const finalAddr = readAddress(page.finalUrl);
  // Short links (lnkd.in, share.google) are judged by where they land.
  if (addr.kind === 'other' && page.status < 400 && ['posting', 'listing', 'careers', 'homepage'].includes(finalAddr.kind)) {
    if (finalAddr.kind === 'homepage') return { v: V.HOME, why: 'Link lands on the company home page' };
    if (finalAddr.kind === 'careers') return { v: V.CAREERS, why: 'Link lands on a general careers page' };
    if (finalAddr.kind === 'listing') return { v: V.LISTING, why: 'Link lands on a list of jobs' };
    addr = finalAddr;
  }
  const heading = [page.h1, page.ogTitle, page.title].filter(Boolean).join(' | ');
  if (page.status === 404 || page.status === 410) {
    return addr.kind === 'posting'
      ? { v: V.CLOSED, why: `Page not found (HTTP ${page.status})` }
      : { v: V.DOWN, why: `Page not found (HTTP ${page.status}); not a job address anyway` };
  }
  if (page.status >= 500) return { v: V.DOWN, why: `Site error (HTTP ${page.status})` };
  if ([401, 403, 429, 999].includes(page.status)) {
    return { v: addr.kind === 'posting' ? V.POSTING_LIKELY : V.BLOCKED, why: addr.kind === 'posting' ? `Address looks like a job; site blocked the check (HTTP ${page.status})` : `Site blocked the check (HTTP ${page.status})` };
  }
  if (page.status >= 400) return { v: V.CLOSED, why: `Page error (HTTP ${page.status})` };
  if (addr.kind === 'posting' && (finalAddr.kind === 'homepage' || finalAddr.kind === 'careers') ) return { v: V.CLOSED, why: 'Job link redirects to a general page, so the job is probably gone' };
  // Words like "sorry" or "oops" appear on many ordinary pages, so only trust them for job addresses.
  if (page.closedText && !page.jobPostingData && addr.kind === 'posting') return { v: V.CLOSED, why: `Page says the job is gone or not found${heading ? ': ' + heading.slice(0, 90) : ''}` };
  // A hidden "job posting" tag on a careers LIST page is not proof of one job, so only trust it on a job address.
  if (page.jobPostingData && addr.kind === 'posting') return { v: V.POSTING_OK, why: `Page contains a job posting${heading ? ': ' + heading.slice(0, 100) : ''}` };
  if (addr.kind === 'posting') {
    if (JOB_WORDS.test(heading)) return { v: V.POSTING_OK, why: `Specific job address, page title: ${heading.slice(0, 100)}` };
    // A page read in a real browser: a role name near the top plus an Apply button is a job page.
    if (page.rendered && page.hasApply && JOB_WORDS.test(page.lead || '')) return { v: V.POSTING_OK, why: `Specific job address; page shows a role and an Apply button${heading ? ': ' + heading.slice(0, 70) : ''}` };
    return { v: V.POSTING_LIKELY, why: page.textLength < 600 ? 'Specific job address; page text is built by script and not readable here' : `Specific job address; title does not name a role${heading ? ': ' + heading.slice(0, 70) : ''}` };
  }
  if (addr.kind === 'listing') return { v: V.LISTING, why: addr.reason };
  // address was not clearly a job: use the page
  if (JOB_WORDS.test(heading) && finalAddr.kind !== 'homepage' && !/careers?\b|jobs?\b|openings?|opportunit/i.test(heading.replace(JOB_WORDS, ''))) {
    return { v: V.POSTING_LIKELY, why: `Page title names a role: ${heading.slice(0, 100)}` };
  }
  if (/careers?|jobs?|openings?|opportunit|join us|work with us|hiring/i.test(heading)) return { v: V.CAREERS, why: `Looks like a careers or job-list page: ${heading.slice(0, 100)}` };
  return { v: V.UNCLEAR, why: heading ? `Page title: ${heading.slice(0, 100)}` : 'Could not tell from the address or page' };
}

const mxCache = new Map();
async function checkEmail(addr) {
  const domain = addr.split('@')[1].toLowerCase();
  if (!mxCache.has(domain)) {
    let ok = false;
    try { ok = (await dns.resolveMx(domain)).length > 0; } catch (e) { try { ok = (await dns.resolve4(domain)).length > 0; } catch (e2) { ok = false; } }
    mxCache.set(domain, ok);
  }
  return mxCache.get(domain) ? { v: V.EMAIL_OK, why: 'The email domain accepts mail' } : { v: V.EMAIL_BAD, why: `${domain} has no mail server` };
}

// ---------- 4. run ----------
async function main() {
  const input = process.argv[2];
  if (!input) { console.error('Usage: node scripts/check-links.js <export.xlsx> [output.xlsx]'); process.exit(1); }
  const output = process.argv[3] || path.join(path.dirname(input), 'company-research-link-check.xlsx');
  const cacheFile = path.join(path.dirname(output), '.link-check-cache.json');
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(input);
  const sheet = book.getWorksheet('Student Research') || book.worksheets[0];
  const head = sheet.getRow(1).values.slice(1).map(val);
  const col = (name) => head.findIndex((h) => String(h).toLowerCase().startsWith(name)) + 1;
  const C = { sno: col('s.no'), name: col('student name'), roll: col('rtu roll'), email: col('email'), company: col('company'), website: col('website'), domain: col('domain'), dlink: col('domain-specific'), flink: col('fresher') || col('general') };
  if (Object.values(C).some((x) => x < 1)) throw new Error('Could not find all columns in the header: ' + head.join(', '));

  const rows = [];
  sheet.eachRow((r, i) => { if (i > 1) rows.push({ sno: val(r.getCell(C.sno).value), name: String(val(r.getCell(C.name).value) || ''), roll: String(val(r.getCell(C.roll).value) || ''), email: String(val(r.getCell(C.email).value) || ''), company: String(val(r.getCell(C.company).value) || ''), website: String(val(r.getCell(C.website).value) || ''), domain: String(val(r.getCell(C.domain).value) || ''), dlink: String(val(r.getCell(C.dlink).value) || '').trim(), flink: String(val(r.getCell(C.flink).value) || '').trim() }); });
  console.log(`rows: ${rows.length}`);

  const urls = [...new Set(rows.flatMap((r) => [r.dlink, r.flink]).filter((x) => x && !isEmail(x)))];
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  const todo = urls.filter((u) => { const a = readAddress(u); return ['posting', 'listing', 'other', 'careers'].includes(a.kind) && !cache[u]; });
  console.log(`links: ${urls.length} distinct; to open: ${todo.length}; already cached: ${urls.length - todo.length}`);

  let done = 0, next = 0;
  async function worker() {
    while (next < todo.length) {
      const u = todo[next++];
      cache[u] = await openPage(u);
      if (++done % 50 === 0) { console.log(`  opened ${done}/${todo.length}`); fs.writeFileSync(cacheFile, JSON.stringify(cache)); }
    }
  }
  await Promise.all(Array.from({ length: 24 }, worker));
  fs.writeFileSync(cacheFile, JSON.stringify(cache));

  const judge = async (link) => {
    if (!link) return null;
    if (isEmail(link)) return checkEmail(link);
    return decide(readAddress(link), cache[link]);
  };
  for (const r of rows) { r.dv = await judge(r.dlink); r.fv = await judge(r.flink); }

  const GOOD = new Set([V.POSTING_OK, V.POSTING_LIKELY, V.EMAIL_OK]);
  const rank = (x) => (x ? (x.v === V.POSTING_OK ? 5 : x.v === V.EMAIL_OK ? 4 : x.v === V.POSTING_LIKELY ? 3 : [V.BLOCKED, V.UNCLEAR, V.DOWN].includes(x.v) ? 2 : 1) : 0);
  for (const r of rows) {
    const best = rank(r.dv) >= rank(r.fv) ? r.dv : r.fv;
    r.best = best;
    r.result = !best ? 'No link' : best.v === V.POSTING_OK ? 'Good' : best.v === V.EMAIL_OK ? 'Good (email)' : best.v === V.POSTING_LIKELY ? 'Probably good' : [V.BLOCKED, V.UNCLEAR, V.DOWN].includes(best.v) ? 'Check by hand' : 'Needs a better link';
    r.needsFix = ['Needs a better link', 'No link'].includes(r.result);
  }

  // ---------- 5. write the workbook ----------
  const out = new ExcelJS.Workbook();
  const colour = (v) => (!v ? null : [V.POSTING_OK, V.EMAIL_OK].includes(v) ? 'FFE3F1E4' : v === V.POSTING_LIKELY ? 'FFEFF5DB' : [V.BLOCKED, V.UNCLEAR, V.DOWN].includes(v) ? 'FFFFF2CC' : 'FFF8D7D3');
  const header = (ws) => { const r = ws.getRow(1); r.height = 28; r.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }; c.alignment = { vertical: 'middle', wrapText: true }; }); ws.views = [{ state: 'frozen', ySplit: 1 }]; };

  const s1 = out.addWorksheet('Link check');
  s1.columns = [{ header: 'S.No', width: 7 }, { header: 'Student Name', width: 22 }, { header: 'RTU Roll No', width: 15 }, { header: 'Email ID', width: 28 }, { header: 'Company', width: 26 }, { header: 'Domain', width: 22 },
    { header: 'Result', width: 18 }, { header: 'Domain-specific link / email', width: 50 }, { header: 'Domain-specific verdict', width: 26 }, { header: 'Why', width: 46 },
    { header: 'Fresher hiring link / email', width: 50 }, { header: 'Fresher link verdict', width: 26 }, { header: 'Why', width: 46 }];
  header(s1);
  for (const r of rows) {
    const row = s1.addRow([r.sno, r.name, r.roll, r.email, r.company, r.domain, r.result, r.dlink, r.dv && r.dv.v, r.dv && r.dv.why, r.flink, r.fv && r.fv.v, r.fv && r.fv.why]);
    row.alignment = { vertical: 'top', wrapText: true };
    [[7, { v: r.result === 'Good' || r.result === 'Good (email)' ? V.POSTING_OK : r.result === 'Probably good' ? V.POSTING_LIKELY : r.result === 'Check by hand' ? V.UNCLEAR : V.CAREERS }], [9, r.dv], [12, r.fv]].forEach(([c, x]) => { const f = x && colour(x.v); if (f) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f } }; });
    [8, 11].forEach((c) => { const v = row.getCell(c).value; if (typeof v === 'string' && /^https?:\/\//i.test(v)) row.getCell(c).value = { text: v, hyperlink: v }; });
  }
  s1.autoFilter = { from: 'A1', to: 'M1' };

  const s2 = out.addWorksheet('Summary');
  s2.columns = [{ width: 44 }, { width: 14 }, { width: 14 }, { width: 14 }];
  const add = (a, b, c, d) => s2.addRow([a, b, c, d]);
  add('Company rows checked', rows.length).font = { bold: true };
  add('Students', new Set(rows.map((r) => r.roll)).size);
  add('');
  add('How the best link of each company was judged', 'Companies', '% of all').font = { bold: true };
  for (const k of ['Good', 'Good (email)', 'Probably good', 'Check by hand', 'Needs a better link', 'No link']) { const n = rows.filter((r) => r.result === k).length; add(k, n, Math.round((n / rows.length) * 1000) / 10 + '%'); }
  add('');
  add('Every verdict, both link fields together', 'Links').font = { bold: true };
  const tally = new Map();
  rows.forEach((r) => [r.dv, r.fv].forEach((x) => x && tally.set(x.v, (tally.get(x.v) || 0) + 1)));
  [...tally.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => add(k, n));
  add('');
  add('Notes').font = { bold: true };
  add('"Good" = the page itself shows a specific job. "Probably good" = the address looks like a job but the page could not be read (often because the site builds pages by script or blocks checks). "Check by hand" = could not tell. Closed jobs are only caught when the page says so.');
  s2.getCell(`A${s2.rowCount}`).alignment = { wrapText: true, vertical: 'top' };
  s2.mergeCells(`A${s2.rowCount}:D${s2.rowCount}`);
  s2.getRow(s2.rowCount).height = 70;

  const per = new Map();
  rows.forEach((r) => { const k = r.roll; if (!per.has(k)) per.set(k, { name: r.name, roll: r.roll, email: r.email, n: 0, bad: 0, hand: 0, fix: [] }); const p = per.get(k); p.n++; if (r.needsFix) { p.bad++; p.fix.push(r.company); } if (r.result === 'Check by hand') p.hand++; });
  const s3 = out.addWorksheet('Students to contact');
  s3.columns = [{ header: 'Student Name', width: 24 }, { header: 'RTU Roll No', width: 15 }, { header: 'Email ID', width: 30 }, { header: 'Companies', width: 11 }, { header: 'Need a better link', width: 18 }, { header: 'Which companies', width: 80 }];
  header(s3);
  [...per.values()].filter((p) => p.bad > 0).sort((a, b) => b.bad - a.bad).forEach((p) => s3.addRow([p.name, p.roll, p.email, p.n, p.bad, p.fix.join(', ')]));
  await out.xlsx.writeFile(output);

  console.log('\nBest-link result per company:');
  for (const k of ['Good', 'Good (email)', 'Probably good', 'Check by hand', 'Needs a better link', 'No link']) console.log(`  ${k.padEnd(22)} ${rows.filter((r) => r.result === k).length}`);
  console.log('\nAll verdicts:');
  [...tally.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${k.padEnd(40)} ${n}`));
  console.log(`\nStudents with at least one weak company: ${[...per.values()].filter((p) => p.bad > 0).length} of ${per.size}`);
  console.log('Wrote', output);
}

module.exports = { readAddress, openPage, decide, checkEmail, V, JOB_WORDS, CLOSED, stripTags, isEmail, val, UA };
if (require.main === module) main();
