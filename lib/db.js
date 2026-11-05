// Database layer. Uses Supabase when SUPABASE_URL is set; otherwise an in-memory
// store (only for trying the app on your own computer - data is lost on restart).
const fs = require('fs');
const { compareRolls } = require('./rollout');
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
  let nextCompanyId = 1;

  const allCompanies = () => students.flatMap((s) => s.companies);
  const history = []; // values a company had before each change
  const mentorLog = []; // every mentor decision
  // the daily "apply" page
  const applyBatches = []; // { id, batch_date, branch, source, published_at, items: [{ company_id, student_roll_key, position }] }
  const applyClicks = new Map(); // roll|companyId|kind
  const applyResponses = new Map(); // roll|companyId
  const applyLog = [];
  let nextBatchId = 1;
  const whoIs = (rollKey, email) => {
    const st = students.find((x) => x.roll_key === rollKey);
    return st && st.email && st.email.toLowerCase() === String(email).toLowerCase() ? st : null;
  };
  const findCompany = (id) => { for (const st of students) { const c = st.companies.find((x) => x.id === id); if (c) return { st, c }; } return null; };
  // only what students may see: no email, revenue, package or review status
  const publicCompany = (st, c) => ({ company_id: c.id, position: c.position, name: c.name, website: c.website, domain: c.domain || '', domain_link: c.domain_link || '', general_link: c.general_link || '',
    employee_strength: c.employee_strength || '', student_name: st.name, roll_no: st.roll_no, roll_key: st.roll_key });
  let nextHistoryId = 1;
  const snapshot = (s, c, source) => history.push({
    id: nextHistoryId++, changed_at: new Date().toISOString(), roll_key: s.roll_key, student_name: s.name, position: c.position, source,
    name: c.name, name_key: c.name_key, website: c.website, domain_key: c.domain_key, domain: c.domain || '', domain_link: c.domain_link || '',
    general_link: c.general_link || '', review_status: c.review_status || 'new', review_note: c.review_note || '', restored_at: null,
    employee_strength: c.employee_strength || '', package_lpa: c.package_lpa == null ? null : c.package_lpa, revenue_amount: c.revenue_amount == null ? null : c.revenue_amount,
    revenue_unit: c.revenue_unit || '', revenue_currency: c.revenue_currency || '',
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
        companies: companies.map((c, i) => ({ id: nextCompanyId++, position: i + 1, review_status: 'new', review_note: '', ...c })),
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
      return { name: s.name, roll_no: s.roll_no, companies: s.companies.map((c) => ({ position: c.position, name: c.name, name_key: c.name_key, website: c.website, domain_key: c.domain_key, domain: c.domain || '', domain_link: c.domain_link || '', general_link: c.general_link || '', review_status: c.review_status || 'new', review_note: c.review_note || '',
        employee_strength: c.employee_strength || '', package_lpa: c.package_lpa == null ? null : c.package_lpa, revenue_amount: c.revenue_amount == null ? null : c.revenue_amount,
        revenue_unit: c.revenue_unit || '', revenue_currency: c.revenue_currency || '' })) };
    },
    // ---- the daily "apply" page ----
    async applyPublish({ date, branch, rollKeys, source }) {
      const old = applyBatches.find((b) => b.batch_date === date);
      if (old) return { ok: true, existing: true, batch_id: old.id };
      if (!rollKeys || !rollKeys.length) return { ok: false, code: 'empty' };
      const used = new Set(applyBatches.flatMap((b) => b.items.map((i) => i.student_roll_key)));
      if (rollKeys.some((r) => used.has(r))) return { ok: false, code: 'already' };
      const items = [];
      for (const r of rollKeys) { const st = students.find((x) => x.roll_key === r); if (st) st.companies.forEach((c) => items.push({ company_id: c.id, student_roll_key: r, position: c.position })); }
      if (!items.length) return { ok: false, code: 'empty' };
      const batch = { id: nextBatchId++, batch_date: date, branch, source: source || 'manual', published_at: new Date().toISOString(), items };
      applyBatches.push(batch);
      return { ok: true, batch_id: batch.id, companies: items.length };
    },
    async applyPublishedRolls() { return applyBatches.flatMap((b) => b.items.map((i) => i.student_roll_key)); },
    async applyBatches(limit = 60) {
      return [...applyBatches].sort((a, b) => (a.batch_date < b.batch_date ? 1 : -1)).slice(0, limit).map((b) => ({
        id: b.id, batch_date: b.batch_date, branch: b.branch, published_at: b.published_at,
        companies: b.items.map((i) => findCompany(i.company_id)).filter(Boolean).map(({ st, c }) => publicCompany(st, c))
          .sort((x, y) => compareRolls(x.roll_key, y.roll_key) || x.position - y.position),
      }));
    },
    async applyStatus(rollKey, email) {
      if (!whoIs(rollKey, email)) return null;
      return {
        clicks: [...applyClicks.values()].filter((x) => x.roll_key === rollKey).map((x) => ({ ...x })),
        responses: [...applyResponses.values()].filter((x) => x.roll_key === rollKey).map((x) => ({ ...x })),
      };
    },
    async applyClick({ rollKey, email, companyId, linkKind }) {
      if (!whoIs(rollKey, email)) return { ok: false, code: 'identity' };
      if (!['domain', 'fresher'].includes(linkKind)) return { ok: false, code: 'link' };
      if (!applyBatches.some((b) => b.items.some((i) => i.company_id === companyId))) return { ok: false, code: 'missing' };
      const key = rollKey + '|' + companyId + '|' + linkKind, now = new Date().toISOString();
      const old = applyClicks.get(key);
      applyClicks.set(key, old ? { ...old, last_at: now, clicks: old.clicks + 1 } : { roll_key: rollKey, company_id: companyId, link_kind: linkKind, first_at: now, last_at: now, clicks: 1 });
      return { ok: true };
    },
    async applyRespond({ rollKey, email, companyId, response, reason, note }) {
      if (!whoIs(rollKey, email)) return { ok: false, code: 'identity' };
      if (!['applied', 'could_not', 'not_interested'].includes(response)) return { ok: false, code: 'response' };
      let why = reason || '';
      if (response === 'could_not' && !['link_not_working', 'job_closed', 'no_relevant_opening', 'other'].includes(why)) return { ok: false, code: 'reason' };
      if (response !== 'could_not') why = '';
      const batch = applyBatches.find((b) => b.items.some((i) => i.company_id === companyId));
      if (!batch) return { ok: false, code: 'missing' };
      const clicks = [...applyClicks.values()].filter((x) => x.roll_key === rollKey && x.company_id === companyId);
      if (!clicks.length) return { ok: false, code: 'click_first' };
      const key = rollKey + '|' + companyId, old = applyResponses.get(key), text = String(note || '').trim().slice(0, 300), now = new Date().toISOString();
      applyResponses.set(key, old
        ? { ...old, response, reason: why, note: text, answered_at: now, changes: old.changes + (old.response !== response || old.reason !== why ? 1 : 0) }
        : { roll_key: rollKey, company_id: companyId, batch_id: batch.id, response, reason: why, note: text, first_click_at: clicks.map((x) => x.first_at).sort()[0], answered_at: now, changes: 0 });
      applyLog.push({ at: now, roll_key: rollKey, company_id: companyId, response, reason: why, note: text });
      return { ok: true };
    },
    // everything needed for the statistics and the Excel export (the admin page only)
    async applyRaw() {
      const items = [];
      for (const b of applyBatches) for (const i of b.items) { const f = findCompany(i.company_id); if (f) items.push({ batch_id: b.id, batch_date: b.batch_date, branch: b.branch, company_id: i.company_id, company_name: f.c.name, domain: f.c.domain || '', submitted_by: f.st.roll_no, position: f.c.position }); }
      return {
        items,
        clicks: [...applyClicks.values()].map((x) => ({ ...x })),
        responses: [...applyResponses.values()].map((x) => ({ ...x })),
        students: students.map((x) => ({ roll_key: x.roll_key, roll_no: x.roll_no, name: x.name })),
      };
    },
    async applyUnpublish(date) {
      const i = applyBatches.findIndex((b) => b.batch_date === date);
      if (i === -1) return { ok: false, code: 'missing' };
      const ids = new Set(applyBatches[i].items.map((x) => x.company_id));
      if ([...applyResponses.values()].some((r) => ids.has(r.company_id))) return { ok: false, code: 'has_responses' };
      applyBatches.splice(i, 1);
      return { ok: true };
    },

    // ---- mentor panel: roll numbers and company data only, never names or emails ----
    async mentorList() {
      return students.map((s) => ({ roll_no: s.roll_no, roll_key: s.roll_key, companies: s.companies.map((c) => ({ position: c.position, review_status: c.review_status || 'new', mentor_decision: c.mentor_decision || null })) }));
    },
    async mentorStudent(rollKey) {
      const s = students.find((x) => x.roll_key === rollKey);
      if (!s) return null;
      return { roll_no: s.roll_no, roll_key: s.roll_key, companies: s.companies.map((c) => ({ position: c.position, name: c.name, website: c.website, domain: c.domain || '', domain_link: c.domain_link || '', general_link: c.general_link || '',
        employee_strength: c.employee_strength || '', package_lpa: c.package_lpa == null ? null : c.package_lpa, revenue_amount: c.revenue_amount == null ? null : c.revenue_amount,
        revenue_unit: c.revenue_unit || '', revenue_currency: c.revenue_currency || '', review_status: c.review_status || 'new', review_note: c.review_note || '',
        mentor_decision: c.mentor_decision || null, mentor_note: c.mentor_note || '', mentor_name: c.mentor_name || '', mentor_at: c.mentor_at || null })) };
    },
    async mentorDecide(p) {
      const mentor = String(p.mentor || '').trim().slice(0, 40), note = String(p.note || '').trim().slice(0, 300);
      if (!['approved', 'not_approved'].includes(p.decision)) return { ok: false, code: 'decision' };
      if (mentor.length < 2) return { ok: false, code: 'mentor' };
      if (p.decision === 'not_approved' && note.length < 3) return { ok: false, code: 'note' };
      const s = students.find((x) => x.roll_key === p.rollKey);
      const c = s && s.companies.find((x) => x.position === p.position);
      if (!c) return { ok: false, code: 'missing' };
      if (p.decision === 'approved' && !(c.employee_strength && c.package_lpa != null && c.revenue_amount != null && c.revenue_unit && c.revenue_currency)) return { ok: false, code: 'details' };
      mentorLog.push({ id: mentorLog.length + 1, at: new Date().toISOString(), mentor_name: mentor, roll_key: s.roll_key, position: c.position, company_name: c.name, decision: p.decision, note: p.decision === 'approved' ? '' : note, previous_status: c.review_status || 'new' });
      c.mentor_decision = p.decision; c.mentor_note = p.decision === 'approved' ? '' : note; c.mentor_name = mentor; c.mentor_at = new Date().toISOString();
      c.review_status = p.decision === 'approved' ? 'accepted' : 'to_fix';
      c.review_note = c.mentor_note;
      return { ok: true };
    },
    async mentorLog() { return mentorLog.map((x) => ({ ...x })).reverse(); },
    // The three details of one company. Allowed for every company, accepted ones included.
    async saveDetails(p) {
      const s = students.find((x) => x.roll_key === p.rollKey);
      if (!s || !s.email || s.email.toLowerCase() !== String(p.email).toLowerCase()) return { ok: false, code: 'identity' };
      const c = s.companies.find((x) => x.position === p.position);
      if (!c) return { ok: false, code: 'missing' };
      snapshot(s, c, 'details');
      c.mentor_decision = null;
      Object.assign(c, p.extras);
      return { ok: true };
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
      c.mentor_decision = null;
      if (p.extras) Object.assign(c, p.extras);
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
      for (const k of ['name', 'name_key', 'website', 'domain_key', 'domain', 'domain_link', 'general_link', 'review_status', 'review_note',
        'employee_strength', 'package_lpa', 'revenue_amount', 'revenue_unit', 'revenue_currency']) c[k] = h[k];
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

  // read a whole table page by page, newest-agnostic, ordered by a column that exists
  async function pageAll(table, columns, orderCol) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select(columns).order(orderCol, { ascending: true }).range(from, from + 999);
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
        .select('id, roll_key, roll_no, name, email, created_at, companies(position, name, name_key, website, domain_key, domain, domain_link, general_link, review_status, review_note, employee_strength, package_lpa, revenue_amount, revenue_unit, revenue_currency)')
        .order('created_at', { ascending: true })
        .range(0, 999);
      if (error) fail(error);
      for (const s of data) s.companies.sort((a, b) => a.position - b.position);
      return data;
    },
    async getStudentForFix(rollKey, email) {
      const { data, error } = await sb
        .from('students')
        .select('id, roll_no, name, email, companies(position, name, name_key, website, domain_key, domain, domain_link, general_link, review_status, review_note, employee_strength, package_lpa, revenue_amount, revenue_unit, revenue_currency)')
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
        p_extras: p.extras ?? null,
      });
      if (error) fail(error);
      return data;
    },
    // ---- the daily "apply" page ----
    async applyPublish({ date, branch, rollKeys, source }) {
      const { data, error } = await sb.rpc('apply_publish', { p_date: date, p_branch: branch, p_rolls: rollKeys, p_source: source || 'manual' });
      if (error) fail(error);
      return data;
    },
    async applyPublishedRolls() {
      const rows = await pageAll('apply_items', 'student_roll_key', 'id');
      return rows.map((r) => r.student_roll_key);
    },
    async applyBatches(limit = 60) {
      const { data, error } = await sb.from('apply_batches')
        .select('id, batch_date, branch, published_at, apply_items(company_id, position, student_roll_key, companies(name, website, domain, domain_link, general_link, employee_strength, students(name, roll_no)))')
        .order('batch_date', { ascending: false }).limit(limit);
      if (error) fail(error);
      return data.map((b) => ({
        id: b.id, batch_date: b.batch_date, branch: b.branch, published_at: b.published_at,
        companies: b.apply_items.filter((i) => i.companies).map((i) => ({
          company_id: i.company_id, position: i.position, name: i.companies.name, website: i.companies.website, domain: i.companies.domain || '',
          domain_link: i.companies.domain_link || '', general_link: i.companies.general_link || '', employee_strength: i.companies.employee_strength || '',
          student_name: i.companies.students.name, roll_no: i.companies.students.roll_no, roll_key: i.student_roll_key,
        })).sort((x, y) => compareRolls(x.roll_key, y.roll_key) || x.position - y.position),
      }));
    },
    async applyStatus(rollKey, email) {
      const who = await sb.from('students').select('email').eq('roll_key', rollKey).limit(1);
      if (who.error) fail(who.error);
      const st = who.data[0];
      if (!st || !st.email || st.email.toLowerCase() !== String(email).toLowerCase()) return null;
      const [clicks, responses] = await Promise.all([
        sb.from('apply_clicks').select('roll_key, company_id, link_kind, first_at, last_at, clicks').eq('roll_key', rollKey),
        sb.from('apply_responses').select('roll_key, company_id, batch_id, response, reason, note, first_click_at, answered_at, changes').eq('roll_key', rollKey),
      ]);
      if (clicks.error) fail(clicks.error);
      if (responses.error) fail(responses.error);
      return { clicks: clicks.data, responses: responses.data };
    },
    async applyClick({ rollKey, email, companyId, linkKind }) {
      const { data, error } = await sb.rpc('apply_record_click', { p_roll_key: rollKey, p_email: email, p_company_id: companyId, p_link_kind: linkKind });
      if (error) fail(error);
      return data;
    },
    async applyRespond({ rollKey, email, companyId, response, reason, note }) {
      const { data, error } = await sb.rpc('apply_save_response', { p_roll_key: rollKey, p_email: email, p_company_id: companyId, p_response: response, p_reason: reason || '', p_note: note || '' });
      if (error) fail(error);
      return data;
    },
    async applyRaw() {
      const [items, clicks, responses, students] = await Promise.all([
        pageAll('apply_items', 'batch_id, company_id, position, apply_batches(batch_date, branch), companies(name, domain, students(roll_no))', 'id'),
        pageAll('apply_clicks', 'roll_key, company_id, link_kind, first_at, last_at, clicks', 'first_at'),
        pageAll('apply_responses', 'roll_key, company_id, batch_id, response, reason, note, first_click_at, answered_at, changes', 'answered_at'),
        pageAll('students', 'roll_key, roll_no, name', 'id'),
      ]);
      return {
        items: items.filter((i) => i.companies).map((i) => ({ batch_id: i.batch_id, batch_date: i.apply_batches.batch_date, branch: i.apply_batches.branch, company_id: i.company_id, company_name: i.companies.name, domain: i.companies.domain || '', submitted_by: i.companies.students.roll_no, position: i.position })),
        clicks, responses, students,
      };
    },
    async applyUnpublish(date) {
      const b = await sb.from('apply_batches').select('id, apply_items(company_id)').eq('batch_date', date).limit(1);
      if (b.error) fail(b.error);
      if (!b.data[0]) return { ok: false, code: 'missing' };
      const ids = b.data[0].apply_items.map((x) => x.company_id);
      const r = await sb.from('apply_responses').select('company_id', { count: 'exact', head: true }).in('company_id', ids);
      if (r.error) fail(r.error);
      if ((r.count || 0) > 0) return { ok: false, code: 'has_responses' };
      const del = await sb.from('apply_batches').delete().eq('id', b.data[0].id);
      if (del.error) fail(del.error);
      return { ok: true };
    },
    async mentorList() {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('students').select('roll_no, roll_key, companies(position, review_status, mentor_decision)').order('roll_key', { ascending: true }).range(from, from + 999);
        if (error) fail(error);
        rows.push(...data);
        if (data.length < 1000) break;
      }
      return rows.map((s) => ({ ...s, companies: s.companies.map((c) => ({ ...c, review_status: c.review_status || 'new' })) }));
    },
    async mentorStudent(rollKey) {
      const { data, error } = await sb.from('students')
        .select('roll_no, roll_key, companies(position, name, website, domain, domain_link, general_link, employee_strength, package_lpa, revenue_amount, revenue_unit, revenue_currency, review_status, review_note, mentor_decision, mentor_note, mentor_name, mentor_at)')
        .eq('roll_key', rollKey).limit(1);
      if (error) fail(error);
      const s = data[0];
      if (!s) return null;
      s.companies.sort((a, b) => a.position - b.position);
      s.companies = s.companies.map((c) => ({ ...c, package_lpa: c.package_lpa == null ? null : Number(c.package_lpa), revenue_amount: c.revenue_amount == null ? null : Number(c.revenue_amount) }));
      return s;
    },
    async mentorDecide(p) {
      const { data, error } = await sb.rpc('mentor_decide', { p_roll_key: p.rollKey, p_position: p.position, p_decision: p.decision, p_note: p.note || '', p_mentor: p.mentor || '' });
      if (error) fail(error);
      return data;
    },
    async mentorLog() {
      const { data, error } = await sb.from('mentor_log').select('*').order('id', { ascending: false }).limit(500);
      if (error) fail(error);
      return data;
    },
    async saveDetails(p) {
      const { data, error } = await sb.rpc('save_details', { p_roll_key: p.rollKey, p_email: p.email, p_position: p.position, p_extras: p.extras });
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
