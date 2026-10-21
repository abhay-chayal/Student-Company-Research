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
  const history = []; // values a company had before each change
  let nextHistoryId = 1;
  const snapshot = (s, c, source) => history.push({
    id: nextHistoryId++, changed_at: new Date().toISOString(), roll_key: s.roll_key, student_name: s.name, position: c.position, source,
    name: c.name, name_key: c.name_key, website: c.website, domain_key: c.domain_key, domain: c.domain || '', domain_link: c.domain_link || '',
    general_link: c.general_link || '', review_status: c.review_status || 'new', review_note: c.review_note || '', restored_at: null,
  });

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
        companies: companies.map((c, i) => ({ position: i + 1, review_status: 'new', review_note: '', ...c })),
      });
      return { ok: true };
    },
    async listAll() {
      return students.map((s) => ({ ...s }));
    },
    async reservedCount() {
      return reserved.length;
    },
    // The student's companies, but only if the roll number and the email match.
    async getStudentForFix(rollKey, email) {
      const s = students.find((x) => x.roll_key === rollKey);
      if (!s || !s.email || s.email.toLowerCase() !== String(email).toLowerCase()) return null;
      return { name: s.name, roll_no: s.roll_no, companies: s.companies.map((c) => ({ position: c.position, name: c.name, name_key: c.name_key, website: c.website, domain_key: c.domain_key, domain: c.domain || '', domain_link: c.domain_link || '', general_link: c.general_link || '', review_status: c.review_status || 'new', review_note: c.review_note || '' })) };
    },
    async fixCompany(p) {
      const s = students.find((x) => x.roll_key === p.rollKey);
      if (!s || !s.email || s.email.toLowerCase() !== String(p.email).toLowerCase()) return { ok: false, code: 'identity' };
      const c = s.companies.find((x) => x.position === p.position);
      if (!c) return { ok: false, code: 'missing' };
      if (c.review_status === 'accepted') return { ok: false, code: 'locked' };
      const others = allCompanies().filter((x) => x !== c);
      const conflicts = [];
      if (p.name_key && p.name_key !== c.name_key) {
        const hit = others.find((x) => x.name_key === p.name_key || x.domain_key === p.name_key) || reserved.find((r) => r.key === p.name_key);
        if (hit) conflicts.push({ field: 'name', taken: hit.name });
      }
      if (p.domain_key && p.domain_key !== c.domain_key) {
        const hit = others.find((x) => x.domain_key === p.domain_key || x.name_key === p.domain_key) || reserved.find((r) => r.key === p.domain_key);
        if (hit) conflicts.push({ field: 'website', taken: hit.name });
      }
      if (conflicts.length) return { ok: false, code: 'conflict', conflicts };
      snapshot(s, c, 'fix');
      if (p.domain != null) c.domain = p.domain;
      if (p.domain_link != null) c.domain_link = p.domain_link;
      if (p.general_link != null) c.general_link = p.general_link;
      if (p.name != null) c.name = p.name;
      if (p.name_key != null) c.name_key = p.name_key;
      if (p.website != null) c.website = p.website;
      if (p.domain_key != null) c.domain_key = p.domain_key;
      c.review_status = 'resubmitted';
      c.fixed_at = new Date().toISOString();
      return { ok: true };
    },
    // Every earlier version of a company, newest first. roll (optional) limits it to one student.
    async listHistory(rollKey) {
      return history.filter((h) => !rollKey || h.roll_key === rollKey).map((h) => ({ ...h })).sort((a, b) => b.id - a.id);
    },
    async restoreCompany(id) {
      const h = history.find((x) => x.id === Number(id));
      const s = h && students.find((x) => x.roll_key === h.roll_key);
      const c = s && s.companies.find((x) => x.position === h.position);
      if (!c) return { ok: false, code: 'missing' };
      const others = allCompanies().filter((x) => x !== c);
      const conflicts = [];
      if (h.name_key !== c.name_key) {
        const hit = others.find((x) => x.name_key === h.name_key || x.domain_key === h.name_key) || reserved.find((r) => r.key === h.name_key);
        if (hit) conflicts.push({ field: 'name', taken: hit.name });
      }
      if (h.domain_key !== c.domain_key) {
        const hit = others.find((x) => x.domain_key === h.domain_key || x.name_key === h.domain_key) || reserved.find((r) => r.key === h.domain_key);
        if (hit) conflicts.push({ field: 'website', taken: hit.name });
      }
      if (conflicts.length) return { ok: false, code: 'conflict', conflicts };
      snapshot(s, c, 'restore');
      for (const k of ['name', 'name_key', 'website', 'domain_key', 'domain', 'domain_link', 'general_link', 'review_status', 'review_note']) c[k] = h[k];
      h.restored_at = new Date().toISOString();
      return { ok: true };
    },
    async applyReview(items) {
      let n = 0;
      for (const it of items) {
        const s = students.find((x) => x.roll_key === it.roll);
        const c = s && s.companies.find((x) => x.name_key === it.name_key);
        if (c) { c.review_status = it.status; c.review_note = it.reason || ''; n++; }
      }
      return n;
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
        .select('id, roll_key, roll_no, name, email, created_at, companies(position, name, name_key, website, domain_key, domain, domain_link, general_link, review_status, review_note)')
        .order('created_at', { ascending: true })
        .range(0, 999);
      if (error) fail(error);
      for (const s of data) s.companies.sort((a, b) => a.position - b.position);
      return data;
    },
    async getStudentForFix(rollKey, email) {
      const { data, error } = await sb
        .from('students')
        .select('id, roll_no, name, email, companies(position, name, name_key, website, domain_key, domain, domain_link, general_link, review_status, review_note)')
        .eq('roll_key', rollKey)
        .limit(1);
      if (error) fail(error);
      const s = data[0];
      if (!s || !s.email || s.email.toLowerCase() !== String(email).toLowerCase()) return null;
      s.companies.sort((a, b) => a.position - b.position);
      return { name: s.name, roll_no: s.roll_no, companies: s.companies };
    },
    async fixCompany(p) {
      const { data, error } = await sb.rpc('fix_company', {
        p_roll_key: p.rollKey, p_email: p.email, p_position: p.position,
        p_domain: p.domain ?? null, p_domain_link: p.domain_link ?? null, p_general_link: p.general_link ?? null,
        p_name: p.name ?? null, p_name_key: p.name_key ?? null, p_website: p.website ?? null, p_domain_key: p.domain_key ?? null,
      });
      if (error) fail(error);
      return data;
    },
    async listHistory(rollKey) {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        let q = sb.from('company_history').select('*').order('id', { ascending: false }).range(from, from + 999);
        if (rollKey) q = q.eq('roll_key', rollKey);
        const { data, error } = await q;
        if (error) fail(error);
        rows.push(...data);
        if (data.length < 1000) return rows;
      }
    },
    async restoreCompany(id) {
      const { data, error } = await sb.rpc('restore_company', { p_history_id: Number(id) });
      if (error) fail(error);
      return data;
    },
    async applyReview(items) {
      let total = 0;
      for (let i = 0; i < items.length; i += 500) { // chunks keep each request small
        const { data, error } = await sb.rpc('apply_review', { p_items: items.slice(i, i + 500) });
        if (error) fail(error);
        total += data || 0;
      }
      return total;
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
