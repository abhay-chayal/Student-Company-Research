// Fake students for trying the fix page on your own computer (DEV_SEED=1 npm run dev).
// Only used with the in-memory database. Nothing here is real data.
const { getDb } = require('../lib/db');
const { nameKey, websiteKey } = require('../lib/normalize');

const DETAILS = { employee_strength: '201-1,000', package_lpa: 6.5, revenue_amount: 250, revenue_unit: 'Crore', revenue_currency: 'INR' };
const company = (name, website, domain, domainLink, generalLink, details) => ({
  name, name_key: nameKey(name).key, website, domain_key: websiteKey(website).key, domain, domain_link: domainLink, general_link: generalLink, ...(details || {}),
});

async function seed() {
  const db = getDb();
  if (db.mode !== 'memory') throw new Error('The dev seed only runs on the in-memory database.');
  await db.submit({
    rollNo: '99TEST001', rollKey: '99TEST001', name: 'Test Student One', email: 'one@test.dev',
    companies: [
      company('Alpha Works', 'alphaworks-qa-test.com', 'Data Engineer', 'https://alphaworks-qa-test.com/jobs/data-engineer-1', ''),
      company('Beta Labs', 'betalabs-qa-test.com', 'Data Analyst', 'hr@betalabs-qa-test.com', ''),
      company('Gamma Soft', 'gammasoft-qa-test.com', 'Data Engineer', 'https://gammasoft-qa-test.com/careers', ''),
      company('Delta Systems', 'deltasystems-qa-test.com', 'Full Stack Developer', 'https://deltasystems-qa-test.com', ''),
      company('Epsilon IT', 'epsilonit-qa-test.com', 'General (not domain specific)', '', 'https://epsilonit-qa-test.com/careers'),
    ],
  });
  await db.submit({
    rollNo: '99TEST002', rollKey: '99TEST002', name: 'Test Student Two', email: 'two@test.dev',
    companies: ['Zeta One', 'Zeta Two', 'Zeta Three', 'Zeta Four', 'Zeta Five'].map((n, i) => company(n, `zeta${i + 1}-qa-test.com`, 'Data Engineer', `https://zeta${i + 1}-qa-test.com/jobs/role-${i + 1}`, '', DETAILS)),
  });
  const items = [
    { roll: '99TEST001', name_key: nameKey('Alpha Works').key, status: 'accepted', reason: '' },
    { roll: '99TEST001', name_key: nameKey('Beta Labs').key, status: 'accepted', reason: '' },
    { roll: '99TEST001', name_key: nameKey('Gamma Soft').key, status: 'to_fix', reason: '' },
    { roll: '99TEST001', name_key: nameKey('Delta Systems').key, status: 'to_fix', reason: '' },
    { roll: '99TEST001', name_key: nameKey('Epsilon IT').key, status: 'to_fix', reason: '' },
    ...['Zeta One', 'Zeta Two', 'Zeta Three', 'Zeta Four', 'Zeta Five'].map((n) => ({ roll: '99TEST002', name_key: nameKey(n).key, status: 'accepted', reason: '' })),
  ];
  await db.applyReview(items);
  // Fake CS students for the apply page (150 companies with names from A to Z), all of them published.
  const PRE = ['Acme', 'Brightlabs', 'Cobalt', 'Delta', 'Evergreen', 'Fusion', 'Gamma', 'Helix', 'Ionic', 'Juniper', 'Kite', 'Lumen', 'Meridian', 'Nimbus', 'Orbit', 'Pixel', 'Quanta', 'Rivet', 'Summit', 'Tessera', 'Umbra', 'Vertex', 'Willow', 'Xenon', 'Yonder', 'Zephyr'];
  const SUF = ['Tech', 'Labs', 'Systems', 'Software'];
  const DOM = ['Data Engineer', 'Data Analyst', 'Software enginner', 'General (not domain specific)', 'Marketing', 'Full Stack Developer', 'ML / AI Engineer'];
  for (let n = 1; n <= 30; n++) {
    const roll = '99EARCS' + String(n).padStart(3, '0');
    await db.submit({
      rollNo: roll, rollKey: roll, name: 'Fake CS Student ' + n, email: 'cs' + n + '@test.dev',
      companies: [1, 2, 3, 4, 5].map((j) => {
        const idx = n * 5 + j, nm = PRE[idx % 26] + ' ' + SUF[idx % 4] + ' ' + idx, slug = nm.toLowerCase().replace(/[^a-z0-9]/g, '');
        return company(nm, `${slug}-qa-test.com`, DOM[idx % DOM.length], j === 5 ? `hr@${slug}-qa-test.com` : `https://${slug}-qa-test.com/jobs/role`, j === 3 ? `https://${slug}-qa-test.com/freshers` : j === 4 ? `hr@${slug}-qa-test.com` : '', DETAILS);
      }),
    });
  }
  await require('../lib/applybatch').publishAll(db, { source: 'manual' });
  console.log('Dev seed: Test Student One (99TEST001 / one@test.dev) has 2 accepted, 3 to fix; Test Student Two (99TEST002 / two@test.dev) has all accepted.');
}

module.exports = { seed };
