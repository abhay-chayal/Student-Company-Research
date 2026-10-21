// Tests the REAL database code (supabase/schema.sql and the seed) on a real PostgreSQL that is
// started just for this run. Run: npm run test:sql
// It checks what the in-memory tests cannot: uniqueness under truly simultaneous requests,
// all-or-nothing saving, locking of accepted companies, and that the public cannot read the data.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Pool, Client } = require('pg');
const { nameKey } = require('../lib/normalize');

const PORT = 54329;
const root = path.join(__dirname, '..');
let passed = 0;
const results = [];
async function t(label, fn) {
  try { await fn(); passed++; results.push(['ok', label]); } catch (e) { process.exitCode = 1; results.push(['FAIL', label + '\n     ' + String(e.message).split('\n').join('\n     ')]); }
}

const company = (name, site, extra = {}) => ({
  name, name_key: nameKey(name).key, website: site || `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
  domain_key: (site || name.toLowerCase().replace(/[^a-z0-9]/g, '')).replace(/\..*$/, '').replace(/[^a-z0-9]/g, ''),
  domain: 'Data Engineer', domain_link: 'https://example.com/careers/data-engineer-fresher', general_link: '', ...extra,
});
const five = (names, extra) => names.map((n) => company(n, null, extra));

(async () => {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const dir = path.join(os.tmpdir(), 'fec-pg-test-' + Date.now());
  const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: PORT, persistent: false, onLog: () => {}, onError: () => {} });
  console.log('starting a temporary PostgreSQL...');
  await server.initialise();
  await server.start();
  await server.createDatabase('fec');

  const conn = { host: '127.0.0.1', port: PORT, user: 'postgres', password: 'pw', database: 'fec' };
  const admin = new Client(conn);
  await admin.connect();
  const pool = new Pool({ ...conn, max: 40 });
  const q = (sql, params) => pool.query(sql, params);
  const submit = async (roll, email, names, extra) => (await q('select submit_entry($1,$2,$3,$4,$5::jsonb) as r', [roll, roll, 'Student ' + roll, email, JSON.stringify(Array.isArray(names) && typeof names[0] === 'string' ? five(names, extra) : names)])).rows[0].r;

  try {
    // Supabase provides these roles; a plain PostgreSQL does not.
    await admin.query('create role anon nologin; create role authenticated nologin; create role service_role nologin;');
    const schema = fs.readFileSync(path.join(root, 'supabase', 'schema.sql'), 'utf8');
    const seed = fs.readFileSync(path.join(root, 'supabase', 'seed_reserved.sql'), 'utf8');

    await t('schema.sql runs, and can be run again without errors', async () => {
      await admin.query(schema);
      await admin.query(schema);
    });
    await t('the college list loads, and loads again without duplicates', async () => {
      await admin.query(seed);
      const first = (await q('select count(*)::int as n from reserved_companies')).rows[0].n;
      await admin.query(seed);
      const second = (await q('select count(*)::int as n from reserved_companies')).rows[0].n;
      assert(first > 600, 'rows loaded: ' + first);
      assert.strictEqual(first, second);
    });

    // ---------------- the main submission ----------------
    await t('a valid submission is saved with email, domain and links', async () => {
      const r = await submit('22SQL00001', 'a@x.com', ['Snowflake', 'Databricks', 'Fractal Analytics', 'Tiger Analytics', 'Sigmoid']);
      assert.strictEqual(r.ok, true, JSON.stringify(r));
      const row = (await q("select s.email, count(*)::int n, min(c.domain) d from students s join companies c on c.student_id = s.id where s.roll_key = '22SQL00001' group by s.email")).rows[0];
      assert.deepStrictEqual([row.email, row.n, row.d], ['a@x.com', 5, 'Data Engineer']);
    });
    await t('the same roll number cannot submit twice', async () => {
      const r = await submit('22SQL00001', 'a@x.com', ['Other One', 'Other Two', 'Other Three', 'Other Four', 'Other Five']);
      assert.strictEqual(r.roll, true);
    });
    await t('a company already taken, or on the college list, is refused with every conflict listed', async () => {
      const r = await submit('22SQL00002', 'b@x.com', ['Snowflake', 'Fresh Two', 'Wipro', 'Fresh Four', 'Fresh Five']);
      assert.strictEqual(r.ok, false);
      const fields = r.conflicts.map((c) => `${c.position}:${c.field}:${c.taken}`).sort();
      assert(fields.includes('1:name:Snowflake') && fields.includes('1:website:Snowflake'), JSON.stringify(fields));
      assert(fields.some((f) => f.startsWith('3:name:Wipro')), JSON.stringify(fields));
      assert.strictEqual((await q("select count(*)::int n from students where roll_key = '22SQL00002'")).rows[0].n, 0, 'nothing saved');
    });
    await t('a college-list company is also caught by its website', async () => {
      const r = await submit('22SQL00003', 'c@x.com', [company('Brand New Name', 'daffodilsoftware.com'), ...five(['Fresh B', 'Fresh C', 'Fresh D', 'Fresh E'])]);
      assert.strictEqual(r.ok, false);
      assert(r.conflicts.some((c) => c.position === 1 && c.field === 'website'), JSON.stringify(r));
    });
    await t('the unique constraints hold even if the function were bypassed', async () => {
      await assert.rejects(q("insert into companies (student_id, position, name, name_key, website, domain_key) select id, 1, 'x', 'snowflake', 'x.com', 'xdomain' from students limit 1"), /duplicate key|unique/i);
    });

    // ---------------- simultaneous requests ----------------
    await t('40 students submit the same five companies at the same instant: exactly one wins', async () => {
      const names = ['Racing Alpha', 'Racing Beta', 'Racing Gamma', 'Racing Delta', 'Racing Epsilon'];
      const out = await Promise.all(Array.from({ length: 40 }, (_, i) => submit('22RACE' + String(i).padStart(4, '0'), `r${i}@x.com`, names)));
      assert.strictEqual(out.filter((r) => r.ok).length, 1, JSON.stringify(out.map((r) => r.ok)));
      assert.strictEqual((await q("select count(*)::int n from companies where name_key like 'racing%'")).rows[0].n, 5);
    });
    await t('120 students with overlapping choices: nobody shares a company, nobody is left with a part-saved entry', async () => {
      const pool120 = Array.from({ length: 150 }, (_, i) => 'Pool Company ' + String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26)));
      let seed2 = 7;
      const rnd = () => (seed2 = (seed2 * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const pick = () => { const s = new Set(); while (s.size < 5) s.add(pool120[Math.floor(rnd() * pool120.length)]); return [...s]; };
      const out = await Promise.all(Array.from({ length: 120 }, (_, i) => submit('22MIX' + String(i).padStart(5, '0'), `m${i}@x.com`, pick())));
      const winners = out.filter((r) => r.ok).length;
      assert(winners > 0 && winners < 120, 'winners: ' + winners);
      const dupes = (await q("select name_key, count(*) from companies group by name_key having count(*) > 1")).rows;
      assert.strictEqual(dupes.length, 0, 'duplicate companies: ' + JSON.stringify(dupes));
      const dupSites = (await q("select domain_key, count(*) from companies group by domain_key having count(*) > 1")).rows;
      assert.strictEqual(dupSites.length, 0, 'duplicate websites: ' + JSON.stringify(dupSites));
      const partial = (await q("select s.roll_key, count(c.id)::int n from students s left join companies c on c.student_id = s.id group by s.roll_key having count(c.id) <> 5")).rows;
      assert.strictEqual(partial.length, 0, 'students with a part-saved entry: ' + JSON.stringify(partial));
      assert.strictEqual((await q("select count(*)::int n from students where roll_key like '22MIX%'")).rows[0].n, winners);
    });
    await t('a name that is a different company\'s website is refused (cross-check) under load', async () => {
      const a = submit('22XCHK0001', 'x1@x.com', [company('Crosswise One', 'crosswise.com'), ...five(['Cx A', 'Cx B', 'Cx C', 'Cx D'])]);
      const b = submit('22XCHK0002', 'x2@x.com', [company('Crosswise', 'unrelatedsite.com'), ...five(['Cy A', 'Cy B', 'Cy C', 'Cy D'])]);
      const out = await Promise.all([a, b]);
      assert.strictEqual(out.filter((r) => r.ok).length, 1, JSON.stringify(out));
    });

    // ---------------- review import ----------------
    await t('review results are imported, bad statuses are ignored', async () => {
      const items = [
        { roll: '22SQL00001', name_key: 'snowflake', status: 'accepted', reason: '' },
        { roll: '22SQL00001', name_key: 'databricks', status: 'to_fix', reason: 'Only the general careers page was given.' },
        { roll: '22SQL00001', name_key: 'fractalanalytics', status: 'to_fix', reason: 'The website does not belong to this company.' },
        { roll: '22SQL00001', name_key: 'tigeranalytics', status: 'pending', reason: 'email only' },
        { roll: '22SQL00001', name_key: 'sigmoid', status: 'hacked', reason: 'not a status' },
        { roll: 'NOSUCH', name_key: 'nothing', status: 'accepted', reason: '' },
      ];
      const n = (await q('select apply_review($1::jsonb) n', [JSON.stringify(items)])).rows[0].n;
      assert.strictEqual(n, 4);
      const st = (await q("select name_key, review_status from companies c join students s on s.id = c.student_id where s.roll_key = '22SQL00001' order by position")).rows;
      assert.deepStrictEqual(st.map((r) => r.review_status), ['accepted', 'to_fix', 'to_fix', 'pending', 'new']);
    });

    // ---------------- fix my companies ----------------
    const fix = async (roll, email, position, extra = {}) => (await q('select fix_company($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) r',
      [roll, email, position, extra.domain ?? 'Data Engineer', extra.dl ?? 'https://databricks.com/careers/data-engineer-fresher-1', extra.gl ?? '', extra.name ?? null, extra.nk ?? null, extra.site ?? null, extra.dk ?? null])).rows[0].r;
    await t('fix: wrong email or roll number is refused', async () => {
      assert.strictEqual((await fix('22SQL00001', 'wrong@x.com', 2)).code, 'identity');
      assert.strictEqual((await fix('NOSUCH', 'a@x.com', 2)).code, 'identity');
      assert.strictEqual((await fix('22SQL00001', 'A@X.COM', 9)).code, 'missing', 'email match ignores capitals; a missing position is reported');
    });
    await t('fix: an accepted company is locked', async () => {
      assert.strictEqual((await fix('22SQL00001', 'a@x.com', 1)).code, 'locked');
    });
    await t('fix: a link correction is saved and marked for re-check', async () => {
      const r = await fix('22SQL00001', 'a@x.com', 2, { dl: 'https://databricks.com/company/careers/job-12345' });
      assert.strictEqual(r.ok, true, JSON.stringify(r));
      const c = (await q("select domain_link, review_status, fixed_at is not null f, name from companies where name_key = 'databricks'")).rows[0];
      assert.deepStrictEqual([c.domain_link, c.review_status, c.f, c.name], ['https://databricks.com/company/careers/job-12345', 'resubmitted', true, 'Databricks']);
    });
    await t('fix: a website correction cannot take another company\'s website or one on the college list', async () => {
      let r = await fix('22SQL00001', 'a@x.com', 3, { name: 'Fractal Analytics', nk: 'fractalanalytics', site: 'snowflake.com', dk: 'snowflake' });
      assert.strictEqual(r.code, 'conflict', JSON.stringify(r));
      r = await fix('22SQL00001', 'a@x.com', 3, { name: 'Wipro', nk: 'wipro', site: 'fractal.ai', dk: 'fractal' });
      assert.strictEqual(r.code, 'conflict', JSON.stringify(r));
      r = await fix('22SQL00001', 'a@x.com', 3, { name: 'Fractal Analytics', nk: 'fractalanalytics', site: 'fractal.ai', dk: 'fractal' });
      assert.strictEqual(r.ok, true, JSON.stringify(r));
      assert.strictEqual((await q("select domain_key from companies where name_key = 'fractalanalytics'")).rows[0].domain_key, 'fractal');
    });
    await t('fix: replacing a company releases the old one and reserves the new one', async () => {
      const before = (await q("select name_key, domain_key from companies where student_id = (select id from students where roll_key = '22SQL00001') and position = 4")).rows[0];
      const r = await fix('22SQL00001', 'a@x.com', 4, { name: 'Brand New Co', nk: 'brandnewco', site: 'brandnewco.io', dk: 'brandnewco' });
      assert.strictEqual(r.ok, true, JSON.stringify(r));
      assert.strictEqual((await q('select count(*)::int n from companies where name_key = $1 or domain_key = $2', [before.name_key, before.domain_key])).rows[0].n, 0, 'old company is free');
      assert.strictEqual((await q("select count(*)::int n from companies where name_key = 'brandnewco' and domain_key = 'brandnewco'")).rows[0].n, 1);
      // somebody else can now take the old company
      const again = await submit('22REL00001', 'rel@x.com', [before.name_key, 'Rel B', 'Rel C', 'Rel D', 'Rel E']);
      assert.strictEqual(again.ok, true, JSON.stringify(again));
    });
    await t('history: changes are recorded; restore is refused while the old company is taken, works once it is free, and can be undone', async () => {
      // 22SQL00001 position 4 was replaced by "Brand New Co" in the test above
      const h = (await q("select * from company_history where roll_key = '22SQL00001' and position = 4 and source = 'fix' order by id desc limit 1")).rows[0];
      assert(h && h.name_key && h.name_key !== 'brandnewco', 'the old company was saved to the history');
      // 22REL00001 took the old company above, so it cannot be restored now
      let r = (await q('select restore_company($1) r', [h.id])).rows[0].r;
      assert.strictEqual(r.code, 'conflict', JSON.stringify(r));
      assert.strictEqual((await q("select count(*)::int n from companies where name_key = 'brandnewco'")).rows[0].n, 1, 'nothing changed');
      // free the old company again, then restore
      await q("delete from students where roll_key = '22REL00001'");
      r = (await q('select restore_company($1) r', [h.id])).rows[0].r;
      assert.strictEqual(r.ok, true, JSON.stringify(r));
      assert.strictEqual((await q('select count(*)::int n from companies where name_key = $1', [h.name_key])).rows[0].n, 1);
      assert.strictEqual((await q("select count(*)::int n from companies where name_key = 'brandnewco'")).rows[0].n, 0);
      const undo = (await q("select id from company_history where roll_key = '22SQL00001' and position = 4 and source = 'restore' and name_key = 'brandnewco'")).rows[0];
      assert(undo, 'the restore itself is in the history');
      assert.strictEqual((await q('select restore_company($1) r', [undo.id])).rows[0].r.ok, true, 'the restore can be undone');
      assert.strictEqual((await q("select count(*)::int n from companies where name_key = 'brandnewco'")).rows[0].n, 1);
      assert.strictEqual((await q('select restore_company(987654321) r')).rows[0].r.code, 'missing');
    });
    await t('fix: 25 students claim the same new website at once - exactly one wins', async () => {
      const tasks = [];
      for (let i = 0; i < 25; i++) {
        const roll = '22FIX' + String(i).padStart(5, '0');
        const r = await submit(roll, `f${i}@x.com`, [`Fixer ${i} A`, `Fixer ${i} B`, `Fixer ${i} C`, `Fixer ${i} D`, `Fixer ${i} E`]);
        assert.strictEqual(r.ok, true);
        await q('select apply_review($1::jsonb)', [JSON.stringify([{ roll, name_key: nameKey(`Fixer ${i} A`).key, status: 'to_fix', reason: 'The website does not belong' }])]);
        tasks.push([roll, `f${i}@x.com`, `Fixer ${i} A`]);
      }
      const out = await Promise.all(tasks.map(([roll, email, name]) => fix(roll, email, 1, { name, nk: nameKey(name).key, site: 'contested.com', dk: 'contested' })));
      assert.strictEqual(out.filter((r) => r.ok).length, 1, JSON.stringify(out.map((r) => r.code || 'ok')));
      assert.strictEqual((await q("select count(*)::int n from companies where domain_key = 'contested'")).rows[0].n, 1);
    });

    // ---------------- who can read the data ----------------
    await t('the public (anon) role cannot read or call anything', async () => {
      const c = new Client(conn);
      await c.connect();
      try {
        for (const sql of ['select * from students', 'select * from companies', 'select * from reserved_companies', 'select * from company_history', 'select restore_company(1)',
          "select submit_entry('X','X','X','x@x.com','[]'::jsonb)", "select fix_company('X','x@x.com',1,'d','','')", "select apply_review('[]'::jsonb)"]) {
          await c.query('set role anon');
          await assert.rejects(c.query(sql), /permission denied/i, 'anon must not run: ' + sql);
          await c.query('reset role');
        }
      } finally { await c.end(); }
    });
    await t('the server (service_role) can use the functions', async () => {
      const c = new Client(conn);
      await c.connect();
      try {
        await c.query('set role service_role');
        const r = await c.query("select apply_review('[]'::jsonb) n");
        assert.strictEqual(r.rows[0].n, 0);
      } finally { await c.end(); }
    });
  } finally {
    await pool.end().catch(() => {});
    await admin.end().catch(() => {});
    await server.stop().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }

  for (const [state, label] of results) console.log(`${state === 'ok' ? '  ok  ' : ' FAIL '} ${label}`);
  console.log(`\n${passed} of ${results.length} database checks passed${process.exitCode ? ', some FAILED' : ''}`);
})().catch((e) => { console.error(e); process.exit(1); });
