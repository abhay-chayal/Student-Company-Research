// Database layer. Uses Supabase when SUPABASE_URL is set; otherwise an in-memory
// store (only for trying the app on your own computer - data is lost on restart).

const useSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

function memoryDb() {
  const students = []; // { id, roll_key, roll_no, name, created_at, companies: [...] }
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
      return map;
    },
    async allNames() {
      return allCompanies().map((c) => ({ name: c.name, name_key: c.name_key }));
    },
    async suggest(q) {
      return allCompanies()
        .filter((c) => c.name_key.includes(q))
        .map((c) => ({ name: c.name, prefix: c.name_key.startsWith(q) }));
    },
    async submit({ rollNo, rollKey, name, companies }) {
      if (students.some((s) => s.roll_key === rollKey)) return { ok: false, roll: true };
      const existing = allCompanies();
      const conflicts = [];
      companies.forEach((c, i) => {
        const byName = existing.find((e) => e.name_key === c.name_key || e.domain_key === c.name_key);
        if (byName) conflicts.push({ position: i + 1, field: 'name', taken: byName.name });
        const bySite = existing.find((e) => e.domain_key === c.domain_key || e.name_key === c.domain_key);
        if (bySite) conflicts.push({ position: i + 1, field: 'website', taken: bySite.name });
      });
      if (conflicts.length) return { ok: false, conflicts };
      students.push({
        id: nextId++, roll_key: rollKey, roll_no: rollNo, name, created_at: new Date().toISOString(),
        companies: companies.map((c, i) => ({ position: i + 1, ...c })),
      });
      return { ok: true };
    },
    async listAll() {
      return students.map((s) => ({ ...s }));
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
      const { data, error } = await sb
        .from('companies')
        .select('name, name_key, domain_key')
        .or(`name_key.in.(${list}),domain_key.in.(${list})`);
      if (error) fail(error);
      for (const c of data) {
        if (keys.includes(c.name_key) && !map.has(c.name_key)) map.set(c.name_key, c.name);
        if (keys.includes(c.domain_key) && !map.has(c.domain_key)) map.set(c.domain_key, c.name);
      }
      return map;
    },
    async allNames() {
      const { data, error } = await sb.from('companies').select('name, name_key').range(0, 4999);
      if (error) fail(error);
      return data;
    },
    async suggest(q) {
      const { data, error } = await sb.from('companies').select('name, name_key').like('name_key', `%${q}%`).limit(40);
      if (error) fail(error);
      return data.map((c) => ({ name: c.name, prefix: c.name_key.startsWith(q) }));
    },
    async submit({ rollNo, rollKey, name, companies }) {
      const { data, error } = await sb.rpc('submit_entry', {
        p_roll_no: rollNo,
        p_roll_key: rollKey,
        p_name: name,
        p_companies: companies,
      });
      if (error) fail(error);
      return data;
    },
    async listAll() {
      const { data, error } = await sb
        .from('students')
        .select('id, roll_key, roll_no, name, created_at, companies(position, name, name_key, website, domain_key, domain, domain_link, general_link)')
        .order('created_at', { ascending: true })
        .range(0, 4999);
      if (error) fail(error);
      for (const s of data) s.companies.sort((a, b) => a.position - b.position);
      return data;
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
