// Quick self-check of the duplicate rules. Run: npm test
process.env.SKIP_DNS = '1';
delete process.env.SUPABASE_URL;
const assert = require('assert');
const { nameKey, websiteKey, rollNumber } = require('../lib/normalize');
const { evaluate, hasErrors } = require('../lib/evaluate');
const { getDb } = require('../lib/db');

let passed = 0;
const t = (label, fn) => Promise.resolve(fn()).then(() => { passed++; }).catch((e) => { console.log('FAIL:', label, '\n  ', e.message); process.exitCode = 1; });

const same = (a, b) => assert.strictEqual(nameKey(a).key, nameKey(b).key, `${a} vs ${b}`);
const site = (s) => websiteKey(s).key;

const five = (offset, names) => names.map((n, i) => ({ name: n, website: `${n.toLowerCase().replace(/[^a-z]/g, '')}.com` }));

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
    ['amazon.com', 'amazon.in', 'https://www.amazon.co.uk/jobs', 'careers.amazon.ca', 'aws.amazon.com', 'HTTP://AMAZON.COM/x?y=1', 'amazon.com.', 'amazon.com:8080', 'user@amazon.com'.replace('user@', '')].forEach((v) => assert.strictEqual(site(v), 'amazon', v));
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

  const base = { name: 'Asha Verma', roll: '22ECEAD001', companies: five(0, ['Wipro', 'Infosys', 'Snowflake', 'Databricks', 'Fractal']) };

  await t('first submission saves', async () => {
    const r = await evaluate(base, { requireAll: true });
    assert(!hasErrors(r), JSON.stringify(r));
    const out = await getDb().submit(r.clean);
    assert.strictEqual(out.ok, true);
  });
  await t('same roll number is blocked', async () => {
    const r = await evaluate({ ...base, companies: five(0, ['A1 Corp', 'B2 Corp', 'C3 Corp', 'D4 Corp', 'E5 Corp']) }, { requireAll: true });
    assert(r.student.roll, 'roll should be flagged');
  });
  await t('taken company blocked by name variants', async () => {
    const tries = ['WIPRO', 'Wipro Pvt Ltd', 'wi_pro', 'Wipro Technologies'];
    for (const v of tries) {
      const r = await evaluate({ ...base, roll: '22ECEAD002', companies: [{ name: v, website: 'different.com' }, ...five(0, ['Zeta', 'Eta', 'Theta', 'Iota']).map((c) => c)] }, { requireAll: true });
      assert(/already taken/.test(r.companies[0].name || ''), `${v}: ${JSON.stringify(r.companies[0])}`);
    }
  });
  await t('taken company blocked by website variants', async () => {
    for (const w of ['wipro.in', 'https://www.wipro.co.uk/careers', 'careers.wipro.com']) {
      const r = await evaluate({ ...base, roll: '22ECEAD002', companies: [{ name: 'Brand New Name', website: w }] });
      assert(/already taken/.test(r.companies[0].website || ''), `${w}: ${JSON.stringify(r.companies[0])}`);
    }
  });
  await t('name matching someone else\'s website is blocked', async () => {
    const r = await evaluate({ roll: '22ECEAD002', companies: [{ name: 'Wipro', website: 'wipro-new-domain.com' }] });
    assert(r.companies[0].name, 'name wipro already taken');
  });
  await t('duplicate inside one form is blocked', async () => {
    const r = await evaluate({ name: 'Ravi', roll: '22ECEAD003', companies: [
      { name: 'Zomato', website: 'zomato.com' }, { name: 'Zomato Ltd', website: 'zomato.in' },
      { name: 'Swiggy', website: 'swiggy.com' }, { name: 'Other', website: 'swiggy.in' } ] });
    assert(r.companies[1].name && r.companies[1].website, JSON.stringify(r.companies[1]));
    assert(r.companies[3].website, JSON.stringify(r.companies[3]));
    assert(!r.companies[0].name && !r.companies[0].website, 'first occurrence is fine');
  });
  await t("a company's own name and website may match", async () => {
    const r = await evaluate({ name: 'Ravi', roll: '22ECEAD003', companies: [{ name: 'Amazon', website: 'amazon.com' }] });
    assert(!r.companies[0].name && !r.companies[0].website, JSON.stringify(r.companies[0]));
  });
  await t('simultaneous submissions: only one wins', async () => {
    const mk = (roll) => ({ name: 'Racer', roll, companies: five(0, ['Racecorp', 'Race Two', 'Race Three', 'Race Four', 'Race Five']) });
    const results = await Promise.all(['22RACE0001', '22RACE0002', '22RACE0003'].map((roll) => evaluate(mk(roll), { requireAll: true }).then((r) => getDb().submit(r.clean))));
    assert.strictEqual(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  });
  await t('small spelling changes of a taken name are blocked', async () => {
    for (const v of ['Wiprro', 'Wipor', 'Wipros', 'Wipro Group', 'Wipro Global Ltd', 'Infosis', 'Infosyss', 'Databrick', 'Snowflak']) {
      const key = nameKey(v).key;
      const r = await evaluate({ name: 'Ravi', roll: '22ECEAD009', companies: [{ name: v, website: 'unrelated-site.com' }] });
      assert(/already taken/.test(r.companies[0].name || ''), v + ' (' + key + '): ' + JSON.stringify(r.companies[0]));
    }
  });
  await t('genuinely different names are allowed', async () => {
    for (const v of ['Intellect Design', 'Zoho', 'Tiger Analytics', 'Swiggy', 'Amadeus', 'Oracle']) {
      const r = await evaluate({ name: 'Ravi', roll: '22ECEAD009', companies: [{ name: v, website: v.toLowerCase().replace(/ /g, '') + '.com' }] });
      assert(!r.companies[0].name, v + ': ' + r.companies[0].name);
    }
  });
  await t('near-duplicates inside one form are blocked', async () => {
    const r = await evaluate({ name: 'Ravi', roll: '22ECEAD009', companies: [
      { name: 'Freshworks', website: 'freshworks.com' }, { name: 'Freshwork', website: 'freshwrk.com' } ] });
    assert(/Too similar/.test(r.companies[1].name || ''), JSON.stringify(r.companies[1]));
  });
  await t('typeahead finds taken names', async () => {
    const hits = await getDb().suggest('wip');
    assert(hits.some((h) => h.name === 'Wipro' && h.prefix));
    const mid = await getDb().suggest('nfos');
    assert(mid.some((h) => h.name === 'Infosys' && !h.prefix));
  });

  console.log(`${passed} checks passed${process.exitCode ? ', some FAILED' : ''}`);
})();
