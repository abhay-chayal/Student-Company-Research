// Quick self-check of the rules. Run: npm test
process.env.SKIP_DNS = '1';
delete process.env.SUPABASE_URL;
const assert = require('assert');
const { nameKey, websiteKey, rollNumber, hiringLink, domainText } = require('../lib/normalize');
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

(async () => {
  await t('name variants collapse', () => {
    ['WIPRO', 'wipro', 'Wi_pro', 'W.i.p.r.o', 'wi pro', 'Wipro Pvt. Ltd.', 'Wipro Private Limited', 'Wipro Technologies India', 'The Wipro', 'Wîpro'].forEach((v) => same('Wipro', v));
    same('Microsoft', 'Microsoft Corporation');
    same('Procter & Gamble', 'Procter and Gamble');
    assert.notStrictEqual(nameKey('Amadeus').key, nameKey('Amazon').key);
  });
  await t('bad names rejected', () => {
    ['', 'a', 'aaaa', 'test', '!!!', 'Wіpro' /* cyrillic i */, '公司'].forEach((v) => assert(nameKey(v).error, `should reject "${v}"`));
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

  const base = { name: 'Asha Verma', roll: '22ECEAD001', companies: five(['Wipro', 'Infosys', 'Snowflake', 'Databricks', 'Fractal']) };

  await t('first submission saves, with domain and links', async () => {
    const r = await evaluate(base, { requireAll: true });
    assert(!hasErrors(r), JSON.stringify(r));
    const c0 = r.clean.companies[0];
    assert.strictEqual(c0.domain, 'Data Engineer');
    assert.strictEqual(c0.domain_link, 'https://example.com/careers');
    assert.strictEqual(c0.general_link, '');
    assert.strictEqual((await getDb().submit(r.clean)).ok, true);
  });
  await t('stored row keeps the new fields', async () => {
    const all = await getDb().listAll();
    assert.strictEqual(all[0].companies[0].domain, 'Data Engineer');
    assert.strictEqual(all[0].companies[0].domain_link, 'https://example.com/careers');
  });
  await t('same roll number is blocked', async () => {
    const r = await evaluate({ ...base, companies: five(['A1 Corp', 'B2 Corp', 'C3 Corp', 'D4 Corp', 'E5 Corp']) }, { requireAll: true });
    assert(r.student.roll, 'roll should be flagged');
  });
  await t('taken company blocked by name variants', async () => {
    for (const v of ['WIPRO', 'Wipro Pvt Ltd', 'wi_pro', 'Wipro Technologies']) {
      const r = await evaluate({ ...base, roll: '22ECEAD002', companies: [co(v, 'different.com'), ...five(['Zeta', 'Eta', 'Theta', 'Iota'])] }, { requireAll: true });
      assert(/already taken/.test(r.companies[0].name || ''), `${v}: ${JSON.stringify(r.companies[0])}`);
    }
  });
  await t('taken company blocked by website variants', async () => {
    for (const w of ['wipro.in', 'https://www.wipro.co.uk/careers', 'careers.wipro.com']) {
      const r = await evaluate({ roll: '22ECEAD002', companies: [co('Brand New Name', w)] });
      assert(/already taken/.test(r.companies[0].website || ''), `${w}: ${JSON.stringify(r.companies[0])}`);
    }
  });
  await t("name matching someone else's website is blocked", async () => {
    const r = await evaluate({ roll: '22ECEAD002', companies: [co('Wipro', 'wipro-new-domain.com')] });
    assert(r.companies[0].name, 'name wipro already taken');
  });
  await t('duplicate inside one form is blocked', async () => {
    const r = await evaluate({ name: 'Ravi', roll: '22ECEAD003', companies: [
      co('Zomato', 'zomato.com'), co('Zomato Ltd', 'zomato.in'), co('Swiggy', 'swiggy.com'), co('Other', 'swiggy.in')] });
    assert(r.companies[1].name && r.companies[1].website, JSON.stringify(r.companies[1]));
    assert(r.companies[3].website, JSON.stringify(r.companies[3]));
    assert(!r.companies[0].name && !r.companies[0].website, 'first occurrence is fine');
  });
  await t("a company's own name and website may match", async () => {
    const r = await evaluate({ name: 'Ravi', roll: '22ECEAD003', companies: [co('Amazon', 'amazon.com')] });
    assert(!r.companies[0].name && !r.companies[0].website, JSON.stringify(r.companies[0]));
  });

  // ---- domain and hiring-link rules ----
  const ok5 = (first) => [first, ...five(['Zeta', 'Eta', 'Theta', 'Iota'])];
  const full = (first) => evaluate({ name: 'Ravi Kumar', roll: '22ECEAD050', companies: ok5(first) }, { requireAll: true });

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
    r = await full(co('Zylker', 'zylker.com', { domainLink: 'hr@zylker.com', generalLink: '' }));
    assert(!hasErrors(r), 'domain email only is fine');
    r = await full(co('Zylker', 'zylker.com', { domainLink: '', generalLink: 'zylker.com/freshers' }));
    assert(!hasErrors(r), 'general link only is fine');
    assert.strictEqual(r.clean.companies[0].general_link, 'https://zylker.com/freshers');
    r = await full(co('Zylker', 'zylker.com', { domainLink: 'hr@zylker.com', generalLink: 'https://zylker.com/freshers' }));
    assert(!hasErrors(r), 'both is fine');
  });
  await t('General company needs the general link only', async () => {
    let r = await full(co('Zylker', 'zylker.com', { domain: '__general__', domainLink: '', generalLink: '' }));
    assert(r.companies[0].glink, 'general link required');
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
    for (const v of ['Wiprro', 'Wipor', 'Wipros', 'Wipro Group', 'Wipro Global Ltd', 'Infosis', 'Infosyss', 'Databrick', 'Snowflak']) {
      const key = nameKey(v).key;
      const r = await evaluate({ name: 'Ravi', roll: '22ECEAD009', companies: [co(v, 'unrelated-site.com')] });
      assert(/already taken/.test(r.companies[0].name || ''), `${v} (${key}): ${JSON.stringify(r.companies[0])}`);
    }
  });
  await t('genuinely different names are allowed', async () => {
    for (const v of ['Intellect Design', 'Zoho', 'Tiger Analytics', 'Swiggy', 'Amadeus', 'Oracle']) {
      const r = await evaluate({ name: 'Ravi', roll: '22ECEAD009', companies: [co(v, v.toLowerCase().replace(/ /g, '') + '.com')] });
      assert(!r.companies[0].name, `${v}: ${r.companies[0].name}`);
    }
  });
  await t('near-duplicates inside one form are blocked', async () => {
    const r = await evaluate({ name: 'Ravi', roll: '22ECEAD009', companies: [co('Freshworks', 'freshworks.com'), co('Freshwork', 'freshwrk.com')] });
    assert(/Too similar/.test(r.companies[1].name || ''), JSON.stringify(r.companies[1]));
  });
  await t('simultaneous submissions: only one wins', async () => {
    const mk = (roll) => ({ name: 'Racer', roll, companies: five(['Racecorp', 'Race Two', 'Race Three', 'Race Four', 'Race Five']) });
    const results = await Promise.all(['22RACE0001', '22RACE0002', '22RACE0003'].map((roll) => evaluate(mk(roll), { requireAll: true }).then((r) => getDb().submit(r.clean))));
    assert.strictEqual(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  });
  await t('typeahead finds taken names', async () => {
    const hits = await getDb().suggest('wip');
    assert(hits.some((h) => h.name === 'Wipro' && h.prefix));
    const mid = await getDb().suggest('nfos');
    assert(mid.some((h) => h.name === 'Infosys' && !h.prefix));
  });

  console.log(`${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`);
})();
