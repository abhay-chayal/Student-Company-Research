// Quick self-check of the rules. Run: npm test
process.env.SKIP_DNS = '1';
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
  name, website, domain: 'Data Engineer', domainLink: 'https://example.com/careers', generalLink: '', ...extra,
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
    assert.strictEqual(c0.domain_link, 'https://example.com/careers');
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
    r = await full(co('Zylker', 'zylker.com', { domainLink: '', generalLink: 'zylker.com/freshers' }));
    assert(!hasErrors(r), 'fresher link only is fine');
    assert.strictEqual(r.clean.companies[0].general_link, 'https://zylker.com/freshers');
    r = await full(co('Zylker', 'zylker.com', { domainLink: 'hr@zylker.com', generalLink: 'https://zylker.com/freshers' }));
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

  console.log(`${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`);
})();
