// Database layer. Uses Supabase when SUPABASE_URL is set; otherwise an in-memory
// store (only for trying the app on your own computer - data is lost on restart).
const fs = require('fs');
const path = require('path');

const useSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

// Companies already taken before any student starts (the college's existing list).
function loadReservedFile() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'reserved-companies.json'), 'utf8'));
  } catch (err) {
    return [];
  }
}

function memoryDb() {
  const students = []; // { id, roll_key, roll_no, name, email, created_at, companies: [...] }
  const reserved = loadReservedFile(); // [{ name, key }]
  let nextId = 1;

  const allCompanies = () => students.flatMap((s) => s.companies);

  return {
    mode: 'memory',
    async rollExists(rollKey) {
      return students.some((s) => s.roll_key === rollKey);
    },
    async takenMap(keys) {
      const map = new Map();
      for (const c of allCompanies()) {
        if (keys.includes(c.name_key) && !map.has(c.name_key)) map.set(c.name_key, c.name);
        if (keys.includes(c.domain_key) && !map.has(c.domain_key)) map.set(c.domain_key, c.name);
      }
      for (const r of reserved) if (keys.includes(r.key) && !map.has(r.key)) map.set(r.key, r.name);
      return map;
    },
    async allNames() {
      return [
        ...allCompanies().map((c) => ({ name: c.name, name_key: c.name_key })),
        ...reserved.map((r) => ({ name: r.name, name_key: r.key })),
      ];
    },
    async suggest(q) {
      return [
        ...allCompanies().map((c) => ({ name: c.name, key: c.name_key })),
        ...reserved.map((r) => ({ name: r.name, key: r.key })),
      ]
        .filter((c) => c.key.includes(q))
        .map((c) => ({ name: c.name, prefix: c.key.startsWith(q) }));
    },
    async submit({ rollNo, rollKey, name, email, companies }) {
      if (students.some((s) => s.roll_key === rollKey)) return { ok: false, roll: true };
      const existing = allCompanies();
      const conflicts = [];
      companies.forEach((c, i) => {
        // A key counts as taken if it matches a student's company name or website, or the college list.
        const byName =
          existing.find((e) => e.name_key === c.name_key || e.domain_key === c.name_key) ||
          reserved.find((r) => r.key === c.name_key);
        if (byName) conflicts.push({ position: i + 1, field: 'name', taken: byName.name });
        const bySite =
          existing.find((e) => e.domain_key === c.domain_key || e.name_key === c.domain_key) ||
          reserved.find((r) => r.key === c.domain_key);
        if (bySite) conflicts.push({ position: i + 1, field: 'website', taken: bySite.name });
      });
      if (conflicts.length) return { ok: false, conflicts };
      students.push({
        id: nextId++, roll_key: rollKey, roll_no: rollNo, name, email: email || '', created_at: new Date().toISOString(),
        companies: companies.map((c, i) => ({ position: i + 1, ...c })),
      });
      return { ok: true };
    },
    async listAll() {
      return students.map((s) => ({ ...s }));
    },
    async reservedCount() {
      return reserved.length;
    },
    async deleteByRoll(rollKey) {
      const i = students.findIndex((s) => s.roll_key === rollKey);
      if (i === -1) return false;
      students.splice(i, 1);
      return true;
    },
  };
}

function supabaseDb() {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const fail = (error) => {
    throw new Error(error.message || 'Database error');
  };

  // Supabase returns at most 1000 rows per request, so read big tables page by page.
  async function fetchAll(table, columns) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select(columns).order('id', { ascending: true }).range(from, from + 999);
      if (error) fail(error);
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  }

  return {
    mode: 'supabase',
    async rollExists(rollKey) {
      const { data, error } = await sb.from('students').select('id').eq('roll_key', rollKey).limit(1);
      if (error) fail(error);
      return data.length > 0;
    },
    async takenMap(keys) {
      const map = new Map();
      if (!keys.length) return map;
      const list = keys.join(',');
      const [companies, reserved] = await Promise.all([
        sb.from('companies').select('name, name_key, domain_key').or(`name_key.in.(${list}),domain_key.in.(${list})`),
        sb.from('reserved_companies').select('name, name_key').in('name_key', keys),
      ]);
      if (companies.error) fail(companies.error);
      if (reserved.error) fail(reserved.error);
      for (const c of companies.data) {
        if (keys.includes(c.name_key) && !map.has(c.name_key)) map.set(c.name_key, c.name);
        if (keys.includes(c.domain_key) && !map.has(c.domain_key)) map.set(c.domain_key, c.name);
      }
      for (const r of reserved.data) if (!map.has(r.name_key)) map.set(r.name_key, r.name);
      return map;
    },
    async allNames() {
      const [companies, reserved] = await Promise.all([fetchAll('companies', 'id, name, name_key'), fetchAll('reserved_companies', 'id, name, name_key')]);
      return [...companies, ...reserved].map((c) => ({ name: c.name, name_key: c.name_key }));
    },
    async suggest(q) {
      const [companies, reserved] = await Promise.all([
        sb.from('companies').select('name, name_key').like('name_key', `%${q}%`).limit(40),
        sb.from('reserved_companies').select('name, name_key').like('name_key', `%${q}%`).limit(40),
      ]);
      if (companies.error) fail(companies.error);
      if (reserved.error) fail(reserved.error);
      return [...companies.data, ...reserved.data].map((c) => ({ name: c.name, prefix: c.name_key.startsWith(q) }));
    },
    async submit({ rollNo, rollKey, name, email, companies }) {
      const { data, error } = await sb.rpc('submit_entry', {
        p_roll_no: rollNo,
        p_roll_key: rollKey,
        p_name: name,
        p_email: email || '',
        p_companies: companies,
      });
      if (error) fail(error);
      return data;
    },
    async listAll() {
      const { data, error } = await sb
        .from('students')
        .select('id, roll_key, roll_no, name, email, created_at, companies(position, name, name_key, website, domain_key, domain, domain_link, general_link)')
        .order('created_at', { ascending: true })
        .range(0, 999);
      if (error) fail(error);
      for (const s of data) s.companies.sort((a, b) => a.position - b.position);
      return data;
    },
    async reservedCount() {
      const { count, error } = await sb.from('reserved_companies').select('id', { count: 'exact', head: true });
      if (error) fail(error);
      return count || 0;
    },
    async deleteByRoll(rollKey) {
      const { data, error } = await sb.from('students').delete().eq('roll_key', rollKey).select('id');
      if (error) fail(error);
      return data.length > 0;
    },
  };
}

let instance;
function getDb() {
  if (!instance) instance = useSupabase ? supabaseDb() : memoryDb();
  return instance;
}

module.exports = { getDb };
