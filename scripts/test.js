// Quick self-check of the rules. Run: npm test
process.env.SKIP_DNS = '1';
process.env.SKIP_LINK_LIVE = '1';
delete process.env.SUPABASE_URL;
process.env.ADMIN_PASSWORD = 'secret-test-pw';
const assert = require('assert');
const { nameKey, coreKey, websiteKey, rollNumber, emailAddress, hiringLink, domainText } = require('../lib/normalize');
const { evaluate, hasErrors } = require('../lib/evaluate');
const { getDb } = require('../lib/db');

let passed = 0;
const t = (label, fn) =>
  Promise.resolve()
    .then(fn)
    .then(() => { passed++; })
    .catch((e) => { console.log('FAIL:', label, '\n  ', e.message); process.exitCode = 1; });

const same = (a, b) => assert.strictEqual(nameKey(a).key, nameKey(b).key, `${a} vs ${b}`);
const site = (s) => websiteKey(s).key;

// A complete, valid company row.
const co = (name, website, extra) => ({
  name, website, domain: 'Data Engineer', domainLink: 'https://example.com/careers/data-engineer-fresher', generalLink: '', ...extra,
});
const slug = (n) => n.toLowerCase().replace(/[^a-z]/g, '');
const five = (names) => names.map((n) => co(n, `${slug(n)}.com`));
const EMAIL = 'student@gmail.com';

(async () => {
  await t('name variants collapse', () => {
    ['SNOWFLAKE', 'snowflake', 'Snow_flake', 'S.n.o.w.f.l.a.k.e', 'snow flake', 'Snowflake Pvt. Ltd.', 'Snowflake Private Limited', 'Snowflake Technologies India', 'The Snowflake', 'Snöwflake'].forEach((v) => same('Snowflake', v));
    same('Microsoft', 'Microsoft Corporation');
    same('Procter & Gamble', 'Procter and Gamble');
    assert.notStrictEqual(nameKey('Amadeus').key, nameKey('Amazon').key);
  });
  await t('bad names rejected', () => {
    ['', 'a', 'aaaa', 'test', '!!!', 'Wіpro' /* cyrillic i */, '公司'].forEach((v) => assert(nameKey(v).error, `should reject "${v}"`));
  });
  await t('loose key ignores words like Software and Systems', () => {
    assert.strictEqual(coreKey('Daffodil Software'), coreKey('Daffodil'));
    assert.strictEqual(coreKey('Encon Systems'), coreKey('Encon System'.replace('System', 'Systems')));
    assert.strictEqual(coreKey('Pinnacle Infotech Solutions'), coreKey('Pinnacle'));
    assert.notStrictEqual(coreKey('Tata Elxsi'), coreKey('Tata Motors'));
  });
  await t('website variants collapse', () => {
    ['amazon.com', 'amazon.in', 'https://www.amazon.co.uk/jobs', 'careers.amazon.ca', 'aws.amazon.com', 'HTTP://AMAZON.COM/x?y=1', 'amazon.com.', 'amazon.com:8080'].forEach((v) => assert.strictEqual(site(v), 'amazon', v));
    assert.strictEqual(site('tata-consultancy.com'), 'tataconsultancy');
    assert.strictEqual(site('bharat-petroleum.in'), site('bharatpetroleum.com'));
  });
  await t('bad websites rejected', () => {
    ['', 'wipro', 'localhost', '127.0.0.1', 'linkedin.com/company/wipro', 'foo.github.io', 'sites.google.com/view/x', 'ftp://wipro.com', 'wi pro.com', 'javascript:alert(1)', 'a.com'].forEach((v) => assert(websiteKey(v).error, `should reject "${v}"`));
  });
  await t('roll numbers', () => {
    assert.strictEqual(rollNumber(' 22ecead 001 ').value, '22ECEAD001');
    assert.strictEqual(rollNumber('22ECEAD-001').value, rollNumber('22ecead001').value);
    ['', '12', 'ABCDEFG', '@@@@@11'].forEach((v) => assert(rollNumber(v).error, v));
  });
  await t('student email', () => {
    assert.strictEqual(emailAddress(' Student.Name+x@Gmail.com ').value, 'student.name+x@gmail.com');
    assert.strictEqual(emailAddress('a@college.ac.in').value, 'a@college.ac.in');
    ['', 'student', 'student@', '@gmail.com', 'student@gmail', 'stu dent@gmail.com', 'a..b@gmail.com', '.a@gmail.com', 'a.@gmail.com', 'a@@gmail.com', 'a@gmail.notarealtld123', 'a@127.0.0.1'].forEach((v) => assert(emailAddress(v).error, `should reject "${v}"`));
  });
  await t('links and emails', () => {
    assert.strictEqual(hiringLink('').empty, true);
    assert.strictEqual(hiringLink('https://celebaltech.com/careers/data').value, 'https://celebaltech.com/careers/data');
    assert.strictEqual(hiringLink('celebaltech.com/careers').value, 'https://celebaltech.com/careers');
    assert.deepStrictEqual(hiringLink('HR@Celebaltech.com'), { value: 'hr@celebaltech.com', kind: 'email' });
    assert.strictEqual(hiringLink('mailto:hr@company.in').value, 'hr@company.in');
    ['hello', 'n/a', 'hr@', '@company.com', 'hr@company', 'ftp://x.com/a', 'javascript:alert(1)', 'https://user:pw@x.com', 'two words.com', 'http://127.0.0.1/x', 'a b@c.com'].forEach((v) => assert(hiringLink(v).error, `should reject "${v}"`));
  });
  await t('typed domains', () => {
    assert.strictEqual(domainText('Site Reliability Engineer').value, 'Site Reliability Engineer');
    ['', 'x', 'aaaa', 'none', '!!!', '公司'].forEach((v) => assert(domainText(v).error, `should reject "${v}"`));
  });

  // ---- the college's existing list ----
  const reservedCount = await getDb().reservedCount();
  await t('college list is loaded', () => assert(reservedCount > 600, `only ${reservedCount} reserved`));
  const check = async (name, website) => (await evaluate({ companies: [co(name, website)] })).companies[0];
  await t('a company on the college list is already taken', async () => {
    for (const [n, w] of [['Wipro', 'wipro-new.com'], ['Infosys', 'infosys-new.com'], ['Amazon', 'amazon-new.com'], ['Tech Mahindra', 'tm-new.com']]) {
      const c = await check(n, w);
      assert(/already taken/.test(c.name || ''), `${n}: ${JSON.stringify(c)}`);
    }
  });
  await t('variants of a listed company are also taken', async () => {
    const tries = ['WIPRO LTD', 'Wipro Technologies', 'Daffodil', 'Daffodil Software Pvt Ltd', 'Unthinkable', 'Mind Tree', 'Mindtree', 'Info Objects', 'A3 Logics', 'A3logics', 'Celebal', 'Tata Consultancy Services', 'TCS', 'IBM India', 'Kyndryl', 'Hexaware', 'Wiprro'];
    for (const n of tries) {
      const c = await check(n, slug(n) + '-new.com');
      assert(c.name, `"${n}" should be taken`);
    }
  });
  await t('a listed company is also caught by its website', async () => {
    const c = await check('Totally New Name', 'https://www.daffodilsoftware.com');
    assert(/already taken/.test(c.website || ''), JSON.stringify(c));
  });
  await t('typeahead shows listed companies', async () => {
    const hits = await getDb().suggest('daffo');
    assert(hits.some((h) => h.name === 'Daffodil Software' && h.prefix));
  });
  await t('listed companies are not students', async () => {
    assert.strictEqual((await getDb().listAll()).length, 0);
  });

  const base = { name: 'Asha Verma', roll: '22ECEAD001', email: EMAIL, companies: five(['Snowflake', 'Databricks', 'Fractal Analytics', 'Tiger Analytics', 'Sigmoid']) };

  await t('first submission saves, with email, domain and links', async () => {
    const r = await evaluate(base, { requireAll: true });
    assert(!hasErrors(r), JSON.stringify(r));
    assert.strictEqual(r.clean.email, EMAIL);
    const c0 = r.clean.companies[0];
    assert.strictEqual(c0.domain, 'Data Engineer');
    assert.strictEqual(c0.domain_link, 'https://example.com/careers/data-engineer-fresher');
    assert.strictEqual((await getDb().submit(r.clean)).ok, true);
  });
  await t('stored row keeps the email and new fields', async () => {
    const all = await getDb().listAll();
    assert.strictEqual(all[0].email, EMAIL);
    assert.strictEqual(all[0].companies[0].domain, 'Data Engineer');
  });
  await t('email is required and checked on submit', async () => {
    let r = await evaluate({ ...base, roll: '22ECEAD099', email: '' }, { requireAll: true });
    assert(r.student.email, 'missing email flagged');
    r = await evaluate({ ...base, roll: '22ECEAD099', email: 'not-an-email' }, { requireAll: true });
    assert(r.student.email, 'bad email flagged');
  });
  await t('same roll number is blocked', async () => {
    const r = await evaluate({ ...base, companies: five(['A1 Corp', 'B2 Corp', 'C3 Corp', 'D4 Corp', 'E5 Corp']) }, { requireAll: true });
    assert(r.student.roll, 'roll should be flagged');
  });
  await t('taken company blocked by name variants', async () => {
    for (const v of ['SNOWFLAKE', 'Snowflake Pvt Ltd', 'snow_flake', 'Snowflake Technologies']) {
      const r = await evaluate({ ...base, roll: '22ECEAD002', companies: [co(v, 'different.com'), ...five(['Zeta', 'Eta', 'Theta', 'Iota'])] }, { requireAll: true });
      assert(/already taken/.test(r.companies[0].name || ''), `${v}: ${JSON.stringify(r.companies[0])}`);
    }
  });
  await t('taken company blocked by website variants', async () => {
    for (const w of ['snowflake.in', 'https://www.snowflake.co.uk/careers', 'careers.snowflake.com']) {
      const r = await evaluate({ roll: '22ECEAD002', companies: [co('Brand New Name', w)] });
      assert(/already taken/.test(r.companies[0].website || ''), `${w}: ${JSON.stringify(r.companies[0])}`);
    }
  });
  await t("name matching someone else's website is blocked", async () => {
    const r = await evaluate({ roll: '22ECEAD002', companies: [co('Snowflake', 'snowflake-new-domain.com')] });
    assert(r.companies[0].name, 'name snowflake already taken');
  });
  await t('duplicate inside one form is blocked', async () => {
    const r = await evaluate({ name: 'Ravi', roll: '22ECEAD003', companies: [
      co('Zomato', 'zomato.com'), co('Zomato Ltd', 'zomato.in'), co('Swiggy', 'swiggy.com'), co('Other', 'swiggy.in')] });
    assert(r.companies[1].name && r.companies[1].website, JSON.stringify(r.companies[1]));
    assert(r.companies[3].website, JSON.stringify(r.companies[3]));
    assert(!r.companies[0].name && !r.companies[0].website, 'first occurrence is fine');
  });
  await t("a company's own name and website may match", async () => {
    const r = await evaluate({ name: 'Ravi', roll: '22ECEAD003', companies: [co('Cloudera', 'cloudera.com')] });
    assert(!r.companies[0].name && !r.companies[0].website, JSON.stringify(r.companies[0]));
  });

  // ---- domain and hiring-link rules ----
  const ok5 = (first) => [first, ...five(['Zeta', 'Eta', 'Theta', 'Iota'])];
  const full = (first) => evaluate({ name: 'Ravi Kumar', roll: '22ECEAD050', email: EMAIL, companies: ok5(first) }, { requireAll: true });

  await t('domain is required and must be on the list', async () => {
    let r = await full(co('Zylker', 'zylker.com', { domain: '' }));
    assert(r.companies[0].domain, 'missing domain flagged');
    r = await full(co('Zylker', 'zylker.com', { domain: 'Wizard' }));
    assert(/list/.test(r.companies[0].domain || ''), 'unknown domain flagged');
  });
  await t('"Other" domain needs typed text', async () => {
    let r = await full(co('Zylker', 'zylker.com', { domain: '__other__', domainOther: '' }));
    assert(r.companies[0].other, 'empty other flagged');
    r = await full(co('Zylker', 'zylker.com', { domain: '__other__', domainOther: 'Site Reliability Engineer' }));
    assert(!hasErrors(r), JSON.stringify(r));
    assert.strictEqual(r.clean.companies[0].domain, 'Site Reliability Engineer');
  });
  await t('role company: either link works, but not neither', async () => {
    let r = await full(co('Zylker', 'zylker.com', { domainLink: '', generalLink: '' }));
    assert(r.companies[0].dlink, 'neither given -> flagged');
    assert(/fresher hiring link/.test(r.companies[0].dlink), 'message uses the new wording');
    r = await full(co('Zylker', 'zylker.com', { domainLink: 'hr@zylker.com', generalLink: '' }));
    assert(!hasErrors(r), 'domain email only is fine');
    r = await full(co('Zylker', 'zylker.com', { domainLink: '', generalLink: 'zylker.com/careers/graduate-engineer-trainee' }));
    assert(!hasErrors(r), 'fresher link only is fine');
    assert.strictEqual(r.clean.companies[0].general_link, 'https://zylker.com/careers/graduate-engineer-trainee');
    r = await full(co('Zylker', 'zylker.com', { domainLink: 'hr@zylker.com', generalLink: 'https://zylker.com/careers/graduate-engineer-trainee' }));
    assert(!hasErrors(r), 'both is fine');
  });
  await t('General company needs the fresher link only', async () => {
    let r = await full(co('Zylker', 'zylker.com', { domain: '__general__', domainLink: '', generalLink: '' }));
    assert(/Enter the fresher hiring link/.test(r.companies[0].glink || ''), JSON.stringify(r.companies[0]));
    r = await full(co('Zylker', 'zylker.com', { domain: '__general__', domainLink: 'ignored@x.com', generalLink: 'https://zylker.com/freshers' }));
    assert(!hasErrors(r), JSON.stringify(r));
    assert.strictEqual(r.clean.companies[0].domain, 'General (not domain specific)');
    assert.strictEqual(r.clean.companies[0].domain_link, '', 'domain link dropped for General');
  });
  await t('garbage links are rejected', async () => {
    const r = await full(co('Zylker', 'zylker.com', { domainLink: 'not a link', generalLink: 'hr@' }));
    assert(r.companies[0].dlink && r.companies[0].glink, JSON.stringify(r.companies[0]));
  });

  // ---- stricter link rules ----
  const jobLinkError = async (link) => (await full(co('Zylker', 'zylker.com', { domainLink: link }))).companies[0].dlink;
  const jobLinkWarning = async (link) => (await full(co('Zylker', 'zylker.com', { domainLink: link }))).warnings[0].dlink;
  await t('careers pages, home pages and search pages only get a warning as the job link, and can still be saved', async () => {
    for (const bad of ['company.com', 'https://company.com/', 'https://company.com/careers', 'https://company.com/jobs', 'https://company.com/en/careers',
      'https://www.linkedin.com/company/wipro', 'https://www.google.com/search?q=data+engineer+jobs', 'https://freshersdunia.in/some-company-off-campus-recruitment-2026/',
      'https://company.com/contact-us', 'https://jobs.lever.co/acme', 'https://www.linkedin.com/posts/someone_hiring-for-data-engineers-123']) {
      const r = await full(co('Zylker', 'zylker.com', { domainLink: bad }));
      assert(r.warnings[0].dlink && /may not be approved/.test(r.warnings[0].dlink), `should warn about ${bad}`);
      assert(!hasErrors(r), `${bad} must still be allowed: ${JSON.stringify(r.companies[0])}`);
    }
  });
  await t('real job links are accepted', async () => {
    for (const good of ['https://company.com/careers/data-engineer-fresher', 'https://jobs.lever.co/acme/1a2b3c4d-1111-2222-3333-444455556666',
      'https://acme.wd1.myworkdayjobs.com/en-US/Careers/job/Pune/Software-Engineer_R-12345', 'https://www.amazon.jobs/en/jobs/10496769/data-engineer-intern-2027',
      'https://careers.tigeranalytics.com/#!/job-view/x-ops-trainee-campus-2027-hiring-chennai-tamil-nadu-india-2026093012572964',
      'https://boards.greenhouse.io/acme/jobs/1234567', 'https://www.linkedin.com/jobs/view/4476163990/']) {
      assert(!(await jobLinkError(good)) && !(await jobLinkWarning(good)), `should accept ${good} without a warning: ${await jobLinkWarning(good)}`);
    }
  });
  await t('tracking parameters are removed but real ones stay', async () => {
    const r = await full(co('Zylker', 'zylker.com', { domainLink: 'https://company.com/careers/data-engineer-fresher?utm_source=chatgpt.com&jobId=77&gclid=abc' }));
    assert(!hasErrors(r), JSON.stringify(r.companies[0]));
    assert.strictEqual(r.clean.companies[0].domain_link, 'https://company.com/careers/data-engineer-fresher?jobId=77');
  });
  await t('pasted accidents are refused', async () => {
    assert(/Two links/.test(await jobLinkError('https://a.com/job/12345 https://b.com/job/99999')));
    assert(/brackets/.test(await jobLinkError('[careers](https://a.com/careers/data-engineer)')));
    assert(/brackets/.test(await jobLinkError('microland.com/careers](https://www.microland.com/careers')));
  });
  await t('a careers page in the fresher field gives no warning; in the domain-specific field it does', async () => {
    let r = await full(co('Zylker', 'zylker.com', { domain: '__general__', domainLink: '', generalLink: 'https://zylker.com/careers/freshers' }));
    assert(!hasErrors(r), JSON.stringify(r.companies[0]));
    r = await full(co('Zylker', 'zylker.com', { domain: 'Data Engineer', domainLink: 'hr@zylker.com', generalLink: 'https://zylker.com/careers/freshers' }));
    assert(!hasErrors(r), JSON.stringify(r.companies[0]));
    r = await full(co('Zylker', 'zylker.com', { domain: 'Data Engineer', domainLink: 'https://zylker.com/careers', generalLink: '' }));
    assert(!hasErrors(r) && /careers page/.test(r.warnings[0].dlink), 'a careers page as the domain-specific link is only a warning');
    r = await full(co('Zylker', 'zylker.com', { domain: 'Data Engineer', domainLink: '', generalLink: 'https://zylker.com/' }));
    assert(!hasErrors(r) && /home page/.test(r.warnings[0].glink) && !/careers page/i.test(r.warnings[0].glink), 'the fresher warning does not mention careers pages');
  });
  await t('live check: refuses dead or closed jobs, lets unclear cases through', async () => {
    const http = require('http');
    const { liveCheck } = require('../lib/linklive');
    const page = (title, text) => `<html><head><title>${title}</title></head><body><h1>${title}</h1><p>${text.repeat(6)}</p></body></html>`;
    const server = http.createServer((req, res) => {
      const send = (code, body, headers) => { res.writeHead(code, { 'Content-Type': 'text/html', ...headers }); res.end(body); };
      if (req.url === '/job/11111') return send(404, page('Not found', 'Page not found. '));
      if (req.url === '/job/22222') return send(200, page('Data Engineer', 'This job is no longer accepting applications. '));
      if (req.url === '/job/33333') return send(302, '', { Location: '/careers' });
      if (req.url === '/careers') return send(200, page('Careers at Acme', 'Come and join us at Acme, we have many teams. '));
      if (req.url === '/job/44444') return send(200, page('Data Engineer - Acme', 'You will build pipelines. Apply now to join the team. '));
      if (req.url === '/job/55555') return send(403, 'blocked');
      if (req.url === '/info/page') return send(200, page('Welcome', 'We make pumps and valves for industry and agriculture across the world. '));
      send(404, 'no');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const saved = process.env.SKIP_LINK_LIVE;
    process.env.SKIP_LINK_LIVE = '0';
    try {
      assert.strictEqual((await liveCheck(base + '/job/11111')).ok, false, 'not found');
      assert.strictEqual((await liveCheck(base + '/job/22222')).ok, false, 'closed text');
      assert.strictEqual((await liveCheck(base + '/job/33333')).ok, false, 'redirect to a general page');
      assert.strictEqual((await liveCheck(base + '/job/44444')).ok, true, 'a live job');
      assert.strictEqual((await liveCheck(base + '/job/55555')).ok, true, 'blocked site is let through');
      assert.strictEqual((await liveCheck(base + '/info/page')).ok, false, 'not a hiring page');
    } finally {
      process.env.SKIP_LINK_LIVE = saved;
      server.close();
    }
  });

  await t('small spelling changes of a taken name are blocked', async () => {
    for (const v of ['Snowflak', 'Snowflakes', 'Snowfalke', 'Databrick', 'Databrickss', 'Fractal Analytic', 'Tiger Analytic']) {
      const key = nameKey(v).key;
      const r = await evaluate({ name: 'Ravi', roll: '22ECEAD009', companies: [co(v, 'unrelated-site.com')] });
      assert(/already taken/.test(r.companies[0].name || ''), `${v} (${key}): ${JSON.stringify(r.companies[0])}`);
    }
  });
  await t('genuinely different names are allowed', async () => {
    for (const v of ['Intellect Design', 'Zoho', 'Swiggy', 'Amadeus', 'Oracle', 'Snowplow']) {
      const r = await evaluate({ name: 'Ravi', roll: '22ECEAD009', companies: [co(v, v.toLowerCase().replace(/ /g, '') + '.com')] });
      assert(!r.companies[0].name, `${v}: ${r.companies[0].name}`);
    }
  });
  await t('near-duplicates inside one form are blocked', async () => {
    const r = await evaluate({ name: 'Ravi', roll: '22ECEAD009', companies: [co('Freshworks', 'freshworks.com'), co('Freshwork', 'freshwrk.com')] });
    assert(/Too similar/.test(r.companies[1].name || ''), JSON.stringify(r.companies[1]));
  });
  await t('simultaneous submissions: only one wins', async () => {
    const mk = (roll) => ({ name: 'Racer', roll, email: EMAIL, companies: five(['Racecorp', 'Race Two', 'Race Three', 'Race Four', 'Race Five']) });
    const results = await Promise.all(['22RACE0001', '22RACE0002', '22RACE0003'].map((roll) => evaluate(mk(roll), { requireAll: true }).then((r) => getDb().submit(r.clean))));
    assert.strictEqual(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  });
  await t('database refuses a listed company even if the checks were skipped', async () => {
    const r = await evaluate({ name: 'Sneaky', roll: '22SNEAK001', email: EMAIL, companies: five(['Zzyzx One', 'Zzyzx Two', 'Zzyzx Three', 'Zzyzx Four', 'Zzyzx Five']) }, { requireAll: true });
    assert(!hasErrors(r), JSON.stringify(r));
    r.clean.companies[2].name_key = nameKey('Wipro').key; // as if someone bypassed the form
    const out = await getDb().submit(r.clean);
    assert.strictEqual(out.ok, false);
    assert(out.conflicts.some((c) => c.position === 3 && c.field === 'name' && c.taken === 'Wipro'), JSON.stringify(out));
  });
  await t('typeahead finds taken names', async () => {
    const hits = await getDb().suggest('snow');
    assert(hits.some((h) => h.name === 'Snowflake' && h.prefix));
    const mid = await getDb().suggest('atabric');
    assert(mid.some((h) => h.name === 'Databricks' && !h.prefix));
  });

  // ---- admin: email column and the fresher-link heading ----
  const ExcelJS = require('exceljs');
  const admin = require('../api/admin');
  const callAdmin = (action, password = 'secret-test-pw') => new Promise((resolve) => {
    const chunks = [];
    const res = { statusCode: 200, setHeader() {}, end(body) { resolve({ status: res.statusCode, body }); } };
    admin({ method: 'GET', query: { action }, headers: { 'x-admin-password': password }, body: {} }, res);
  });
  await t('admin list: needs the password and shows email and the college-list count', async () => {
    assert.strictEqual((await callAdmin('list', 'wrong')).status, 401);
    const out = JSON.parse((await callAdmin('list')).body);
    assert.strictEqual(out.students[0].email, EMAIL);
    assert(out.reservedCount > 600);
  });
  await t('csv export: Email ID column and Fresher Hiring heading', async () => {
    const text = (await callAdmin('csv')).body;
    const header = text.split('\r\n')[0];
    assert(/"Email ID"/.test(header) && /"Fresher Hiring Link \/ Email"/.test(header), header);
    assert(!/General Fresher/.test(header), 'old heading must be gone');
    assert(text.includes(`"${EMAIL}"`), 'email value is in the rows');
  });
  await t('excel export: columns line up, email is a link, no merged cells', async () => {
    const out = await callAdmin('xlsx');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(out.body);
    const sheet = book.getWorksheet('Student Research');
    const head = sheet.getRow(1).values.slice(1);
    assert.deepStrictEqual(head.slice(0, 5), ['S.No', 'Student Name', 'RTU Roll No', 'Email ID', 'Company']);
    assert.strictEqual(head[8], 'Fresher Hiring Link / Email');
    const row = sheet.getRow(2);
    assert.strictEqual(row.getCell(1).value, 1);
    assert.strictEqual(row.getCell(3).value, '22ECEAD001');
    assert.strictEqual(row.getCell(4).value.text, EMAIL);
    assert(/^mailto:/.test(row.getCell(4).value.hyperlink));
    assert.strictEqual(Object.keys(sheet._merges || {}).length, 0);
  });

  // ---- review import and "fix my companies" ----
  const fixApi = require('../api/fix');
  const call = (handler, { method = 'POST', query = {}, body = {}, headers = {} } = {}) => new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, end(text) { let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ } resolve({ status: res.statusCode, json, text }); } };
    handler({ method, query, body, headers }, res);
  });
  const adminCall = (action, body, password = 'secret-test-pw') => call(admin, { query: { action }, body, headers: { 'x-admin-password': password } });
  const key = (n) => nameKey(n).key;
  const ASHA = { roll: '22ECEAD001', email: 'student@gmail.com' };
  const JOBLINK = 'https://databricks.com/company/careers/university-recruiting/software-engineering-intern-2027-6865687002';

  await t('admin review import: needs the password, ignores bad rows, sets statuses', async () => {
    const items = [
      { roll: '22ECEAD001', name_key: key('Snowflake'), status: 'Accepted', reason: '' },
      { roll: '22ecead 001', name_key: key('Databricks'), status: 'To redo', reason: "Only the company's general careers page was given." },
      { roll: '22ECEAD001', name_key: key('Fractal Analytics'), status: 'To redo', reason: 'The website does not belong to this company. Enter the official website.' },
      { roll: '22ECEAD001', name_key: key('Tiger Analytics'), status: 'Pending: email only', reason: 'Only an email was given.' },
      { roll: '22ECEAD001', name_key: key('Sigmoid'), status: 'To redo', reason: 'The job link no longer works.' },
      { roll: '22ECEAD001', name_key: key('Sigmoid'), status: 'nonsense', reason: 'ignored: not a real status' },
      { roll: 'NOSUCH9999', name_key: 'nothing', status: 'Accepted' },
    ];
    assert.strictEqual((await adminCall('review', { items }, 'wrong')).status, 401);
    assert.strictEqual((await adminCall('review', { items: [] })).status, 400);
    const out = await adminCall('review', { items });
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.json.valid, 6);
    assert.strictEqual(out.json.updated, 5, JSON.stringify(out.json));
    const me = (await getDb().listAll()).find((s) => s.roll_no === '22ECEAD001');
    assert.deepStrictEqual(me.companies.map((c) => c.review_status), ['accepted', 'to_fix', 'to_fix', 'pending', 'to_fix']);
  });
  await t('admin shows the review status in the list and the exports', async () => {
    const list = JSON.parse((await callAdmin('list')).body);
    assert.strictEqual(list.students[0].companies[0].review_status, 'accepted');
    const csv = (await callAdmin('csv')).body;
    assert(/"Review"$/.test(csv.split('\r\n')[0]), 'Review is the last heading');
    assert(csv.includes('"Accepted"') && csv.includes('"To fix"') && csv.includes('"Pending decision"'));
  });

  await t('fix: the roll number and email must match', async () => {
    assert.strictEqual(await getDb().getStudentForFix('22ECEAD001', 'someone@else.com'), null);
    assert.strictEqual(await getDb().getStudentForFix('NOSUCH9999', ASHA.email), null);
    assert((await getDb().getStudentForFix('22ECEAD001', 'STUDENT@Gmail.com')), 'email match ignores capital letters');
    let r = await call(fixApi, { body: { ...ASHA, email: 'someone@else.com', action: 'lookup' } });
    assert.strictEqual(r.status, 401);
    r = await call(fixApi, { body: { roll: '', email: '', action: 'lookup' } });
    assert.strictEqual(r.status, 400);
    r = await call(fixApi, { method: 'GET' });
    assert.strictEqual(r.status, 405);
  });
  await t('fix: lookup shows status, reason and what may be edited', async () => {
    const r = await call(fixApi, { body: { ...ASHA, action: 'lookup' } });
    assert.strictEqual(r.status, 200);
    const [snow, data, frac] = r.json.companies;
    assert.strictEqual(snow.review_status, 'accepted');
    assert.strictEqual(snow.editable.links, false);
    assert.strictEqual(data.editable.links, true);
    assert.strictEqual(data.editable.identity, true, 'any company that is not accepted can be changed');
    assert.strictEqual(snow.editable.identity, false, 'an accepted company is locked');
    assert.strictEqual(frac.editable.identity, true);
    assert(/general careers page/.test(data.review_note));
  });
  await t('fix: an accepted company is locked', async () => {
    const r = await call(fixApi, { body: { ...ASHA, action: 'save', company: { position: 1, domain: 'Data Engineer', domainLink: JOBLINK } } });
    assert.strictEqual(r.status, 409);
    assert(/accepted/.test(r.json.message));
    const me = await getDb().getStudentForFix('22ECEAD001', ASHA.email);
    assert.strictEqual(me.companies[0].domain_link, 'https://example.com/careers/data-engineer-fresher', 'unchanged');
  });
  await t('fix: a careers page only warns, a real job link is saved and marked for re-check', async () => {
    let r = await call(fixApi, { body: { ...ASHA, action: 'check', company: { position: 2, domain: 'Data Engineer', domainLink: 'https://databricks.com/company/careers' } } });
    assert.strictEqual(r.json.ok, true, 'a warning does not block');
    assert(/general careers page/.test(r.json.warnings.dlink), JSON.stringify(r.json));
    r = await call(fixApi, { body: { ...ASHA, action: 'check', company: { position: 2, domain: 'Data Engineer', domainLink: JOBLINK } } });
    assert.strictEqual(r.json.ok, true, 'check is a dry run');
    assert.strictEqual((await getDb().getStudentForFix('22ECEAD001', ASHA.email)).companies[1].review_status, 'to_fix', 'check saves nothing');
    r = await call(fixApi, { body: { ...ASHA, action: 'save', company: { position: 2, domain: 'Data Engineer', domainLink: JOBLINK + '?utm_source=chatgpt.com' } } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const c = (await getDb().getStudentForFix('22ECEAD001', ASHA.email)).companies[1];
    assert.strictEqual(c.domain_link, JOBLINK, 'tracking removed');
    assert.strictEqual(c.review_status, 'resubmitted');
    assert.strictEqual(c.name, 'Databricks', 'the company itself is unchanged');
  });
  await t('fix: a company that is not accepted can be replaced by another, and the old one is released', async () => {
    const base = { position: 5, domain: 'Data Engineer', domainLink: JOBLINK.replace('2027-6865687002', '2027-1111111') };
    let r = await call(fixApi, { body: { ...ASHA, action: 'save', company: { ...base, name: 'Totally Other Name' } } });
    assert.strictEqual(r.status, 400, 'a new name needs its own website');
    assert(/new company/.test(r.json.errors.website), JSON.stringify(r.json));
    assert.strictEqual((await getDb().takenMap(['sigmoid'])).has('sigmoid'), true, 'still reserved while unchanged');
    r = await call(fixApi, { body: { ...ASHA, action: 'save', company: { ...base, name: 'Totally Other Name', website: 'totally-other.com' } } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const c = (await getDb().getStudentForFix('22ECEAD001', ASHA.email)).companies[4];
    assert.strictEqual(c.name, 'Totally Other Name');
    assert.strictEqual(c.website, 'totally-other.com');
    assert.strictEqual(c.review_status, 'resubmitted');
    const taken = await getDb().takenMap(['sigmoid', 'totallyothername', 'totallyother']);
    assert.strictEqual(taken.has('sigmoid'), false, 'the old company is free for others');
    assert.strictEqual(taken.has('totallyothername'), true, 'the new company is reserved');
  });
  await t('history: every change is recorded, the admin can see it and restore an old version', async () => {
    let r = await adminCall('history', {}, 'wrong');
    assert.strictEqual(r.status, 401, 'history is for the admin only');
    r = await call(admin, { method: 'GET', query: { action: 'history', roll: '22ecead001' }, headers: { 'x-admin-password': 'secret-test-pw' } });
    assert.strictEqual(r.status, 200);
    const h = r.json.history.find((x) => x.name === 'Sigmoid');
    assert(h, 'the old Sigmoid values were saved');
    assert.strictEqual(h.website, 'sigmoid.com');
    assert.strictEqual(h.source, 'fix');
    r = await adminCall('restore', { id: h.id });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const c = (await getDb().getStudentForFix('22ECEAD001', ASHA.email)).companies[4];
    assert.strictEqual(c.name, 'Sigmoid');
    assert.strictEqual(c.website, 'sigmoid.com');
    const after = (await call(admin, { method: 'GET', query: { action: 'history', roll: '22ECEAD001' }, headers: { 'x-admin-password': 'secret-test-pw' } })).json.history;
    assert(after.some((x) => x.source === 'restore' && x.name === 'Totally Other Name'), 'the restore itself is recorded, so it can be undone');
    assert.strictEqual((await adminCall('restore', { id: 99999 })).status, 404);
  });
  await t('fix: a flagged website can be corrected, but not to one that is taken', async () => {
    const base = { position: 3, domain: 'Data Engineer', domainLink: 'https://fractal.ai/careers/data-engineer-fresher-4455' };
    let r = await call(fixApi, { body: { ...ASHA, action: 'save', company: { ...base, name: 'Fractal Analytics', website: 'snowflake.com' } } });
    assert.strictEqual(r.status, 400);
    assert(/already taken/.test(r.json.errors.website), JSON.stringify(r.json));
    r = await call(fixApi, { body: { ...ASHA, action: 'save', company: { ...base, name: 'Fractal Analytics', website: 'fractal.ai' } } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    const c = (await getDb().getStudentForFix('22ECEAD001', ASHA.email)).companies[2];
    assert.strictEqual(c.website, 'fractal.ai');
    assert.strictEqual(c.domain_key, 'fractal');
    assert.strictEqual(c.review_status, 'resubmitted');
    r = await call(fixApi, { body: { ...ASHA, action: 'save', company: { ...base, name: 'Wipro', website: 'fractal.ai' } } });
    assert.strictEqual(r.status, 400, 'a company on the college list cannot be switched to');
  });
  await t('fix: two students claiming the same new website at once - only one wins', async () => {
    const mkStudent = async (roll, email, names) => {
      const r = await evaluate({ name: 'Claimant', roll, email, companies: five(names) }, { requireAll: true });
      assert(!hasErrors(r), JSON.stringify(r));
      assert.strictEqual((await getDb().submit(r.clean)).ok, true);
      await getDb().applyReview(names.map((n) => ({ roll, name_key: key(n), status: 'to_fix', reason: 'The website does not belong to this company. Enter the official website.' })));
    };
    await mkStudent('22CLAIM001', 'one@gmail.com', ['Claimone Alpha', 'Claimone Beta', 'Claimone Gamma', 'Claimone Delta', 'Claimone Epsilon']);
    await mkStudent('22CLAIM002', 'two@gmail.com', ['Claimtwo Alpha', 'Claimtwo Beta', 'Claimtwo Gamma', 'Claimtwo Delta', 'Claimtwo Epsilon']);
    const claim = (who, email, name) => call(fixApi, { body: { roll: who, email, action: 'save', company: { position: 1, domain: 'Data Engineer', domainLink: 'https://contested.com/careers/data-engineer-fresher-9911', name, website: 'contested.com' } } });
    const results = await Promise.all([claim('22CLAIM001', 'one@gmail.com', 'Claimone Alpha'), claim('22CLAIM002', 'two@gmail.com', 'Claimtwo Alpha')]);
    assert.strictEqual(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.json)));
    const owners = (await getDb().listAll()).flatMap((s) => s.companies.filter((c) => c.domain_key === 'contested').map(() => s.roll_no));
    assert.strictEqual(owners.length, 1, 'exactly one company holds the website');
  });
  await t('fix: after correction the one-submission and duplicate rules still hold', async () => {
    const r = await evaluate({ name: 'Late Comer', roll: '22LATE0001', email: 'late@gmail.com', companies: five(['Fractal Analytics', 'Late Two', 'Late Three', 'Late Four', 'Late Five']) }, { requireAll: true });
    assert(/already taken/.test(r.companies[0].name), 'the corrected website keeps the company reserved');
  });

  // ---- hostile input ----
  const submitApi = require('../api/submit');
  await t('huge and hostile input is refused quickly and never crashes', async () => {
    const big = 'A'.repeat(1_000_000);
    const started = Date.now();
    const r = await evaluate({ name: big, roll: big, email: big + '@x.com', companies: Array.from({ length: 5 }, () => ({ name: big, website: big, domain: big, domainOther: big, domainLink: big, generalLink: big })) }, { requireAll: true });
    assert(hasErrors(r));
    assert(r.student.name && r.student.roll && r.student.email);
    assert(Date.now() - started < 3000, 'took ' + (Date.now() - started) + ' ms');
    const weird = await evaluate({ name: '<script>alert(1)</script>', roll: "22'; DROP TABLE students;--", email: '"><img src=x onerror=alert(1)>@x.com',
      companies: [{ name: '<img src=x onerror=alert(1)>', website: 'javascript:alert(1)', domain: '__other__', domainOther: '<b>x</b>', domainLink: 'javascript:alert(document.cookie)', generalLink: 'data:text/html,<script>1</script>' }] });
    assert(weird.student.name && weird.student.roll && weird.student.email);
    const c = weird.companies[0];
    assert(c.name && c.website && c.other && c.dlink && c.glink, JSON.stringify(c));
  });
  await t('odd request bodies do not crash the server routes', async () => {
    for (const body of [null, undefined, 'text', 42, [], { companies: 'x' }, { companies: [null, 7, 'a'] }, JSON.parse('{"__proto__":{"admin":true}}'), { roll: { a: 1 }, email: ['x'], name: {} }]) {
      for (const [name, handler] of [['submit', submitApi], ['fix', fixApi], ['check', require('../api/check')]]) {
        const r = await call(handler, { body });
        assert(r.status >= 200 && r.status < 500, `${name} with ${JSON.stringify(body)} gave ${r.status}`);
      }
    }
    assert.strictEqual({}.admin, undefined, 'prototype was not polluted');
  });
  await t('the hidden trap field makes a bot look successful but saves nothing', async () => {
    const before = (await getDb().listAll()).length;
    const r = await call(submitApi, { body: { hp: 'i am a bot', name: 'Bot Bot', roll: '99BOT00001', email: 'bot@x.com', companies: five(['Bot A', 'Bot B', 'Bot C', 'Bot D', 'Bot E']) } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await getDb().listAll()).length, before);
  });
  await t('exports never run a typed value as a formula', async () => {
    const evil = ['=HYPERLINK("http://evil.test","click")', '+cmd|"/c calc"!A0', '-2+3', '@SUM(A1)'];
    const companies = evil.concat(['Plain Five']).map((n, i) => ({ name: n, name_key: 'evil' + i, website: n, domain_key: 'evilsite' + i, domain: 'Data Engineer', domain_link: evil[i] || '', general_link: '' }));
    assert.strictEqual((await getDb().submit({ rollNo: '99EVIL0001', rollKey: '99EVIL0001', name: '=1+1', email: '@evil@x.com', companies })).ok, true);
    const csv = (await callAdmin('csv')).body;
    for (const e of evil) assert(!csv.includes(`"${e.replace(/"/g, '""')}"`), `${e} must not appear as a bare cell`);
    assert(csv.includes(`"'=1+1"`), 'student name defused');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await callAdmin('xlsx')).body);
    const cells = [];
    book.getWorksheet('Student Research').eachRow((row) => row.eachCell((cell) => cells.push(typeof cell.value === 'string' ? cell.value : (cell.value && cell.value.text) || '')));
    assert(!cells.some((v) => /^[=+\-@]/.test(v) && !/^[+\-]?\d/.test(v)), 'no cell starts with a formula character: ' + cells.find((v) => /^[=+\-@]/.test(v)));
    await getDb().deleteByRoll('99EVIL0001');
  });

  // ---- a full-size dataset ----
  await t('with 2,600 companies already saved, a check still answers in well under a second', async () => {
    const db = getDb();
    for (let s = 0; s < 520; s++) {
      const companies = Array.from({ length: 5 }, (_, i) => { const n = `Scale Company ${s} Number ${i}`; return { name: n, name_key: nameKey(n).key, website: `scale${s}n${i}.com`, domain_key: `scale${s}n${i}`, domain: 'Data Engineer', domain_link: '', general_link: '' }; });
      assert.strictEqual((await db.submit({ rollNo: `99SCALE${s}`, rollKey: `99SCALE${s}`, name: 'Scale ' + s, email: 'scale@x.com', companies })).ok, true);
    }
    const started = Date.now();
    const r = await evaluate({ name: 'Perf Test', roll: '99PERF0001', email: 'perf@x.com', companies: five(['Perf Alpha', 'Perf Beta', 'Perf Gamma', 'Perf Delta', 'Perf Epsilon']) }, { requireAll: true });
    const ms = Date.now() - started;
    assert(!hasErrors(r), JSON.stringify(r.companies[0]));
    assert(ms < 800, `took ${ms} ms`);
    const hit = await evaluate({ name: 'Perf Test', roll: '99PERF0001', email: 'perf@x.com', companies: [co('Scale Company 300 Numbr 2', 'x-new.com')] });
    assert(/Too similar|already taken/.test(hit.companies[0].name || ''), 'near-duplicate of one of 2,600 is still caught: ' + JSON.stringify(hit.companies[0]));
  });

  console.log(`${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`);
})();
