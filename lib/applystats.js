// Turns the raw apply data (published companies, link clicks, responses) into the numbers the admin wants:
// for every company how many students applied, and for every student how many companies they applied to.
const { branchOf, BRANCH_LABEL } = require('./rollout');

const REASONS = { link_not_working: 'Link not working', job_closed: 'Job closed or expired', no_relevant_opening: 'No relevant opening found', other: 'Other' };
const RESPONSES = { applied: 'Applied', could_not: 'Could not apply', not_interested: 'Not interested' };

function compute(raw) {
  const itemById = new Map();
  for (const it of raw.items) if (!itemById.has(it.company_id)) itemById.set(it.company_id, it);
  const studentByKey = new Map(raw.students.map((s) => [s.roll_key, s]));

  // one row per published company
  const companies = new Map();
  for (const it of itemById.values()) {
    companies.set(it.company_id, { company_id: it.company_id, company: it.company_name, domain: it.domain, submitted_by: it.submitted_by, batch_date: it.batch_date, branch: it.branch,
      opened: 0, applied: 0, could_not: 0, not_interested: 0, answered: 0, link_not_working: 0, job_closed: 0, no_relevant_opening: 0, other: 0 });
  }
  const openedBy = new Map(); // company -> Set of students who opened a link
  for (const c of raw.clicks) {
    if (!openedBy.has(c.company_id)) openedBy.set(c.company_id, new Set());
    openedBy.get(c.company_id).add(c.roll_key);
  }
  for (const [id, set] of openedBy) if (companies.has(id)) companies.get(id).opened = set.size;
  for (const r of raw.responses) {
    const c = companies.get(r.company_id);
    if (!c) continue;
    c.answered++;
    c[r.response]++;
    if (r.response === 'could_not' && r.reason in REASONS) c[r.reason]++;
  }

  // one row per student
  const students = new Map();
  for (const s of raw.students) students.set(s.roll_key, { roll_no: s.roll_no, name: s.name, branch: BRANCH_LABEL[branchOf(s.roll_no)] || branchOf(s.roll_no) || '-', opened: 0, applied: 0, could_not: 0, not_interested: 0, answered: 0 });
  const openedByStudent = new Map();
  for (const c of raw.clicks) {
    if (!openedByStudent.has(c.roll_key)) openedByStudent.set(c.roll_key, new Set());
    openedByStudent.get(c.roll_key).add(c.company_id);
  }
  for (const [roll, set] of openedByStudent) if (students.has(roll)) students.get(roll).opened = set.size;
  for (const r of raw.responses) {
    const st = students.get(r.roll_key);
    if (!st) continue;
    st.answered++;
    st[r.response]++;
  }

  const totals = {
    published_companies: companies.size,
    days: new Set(raw.items.map((i) => i.batch_date)).size,
    students_active: [...students.values()].filter((s) => s.opened || s.answered).length,
    applied: raw.responses.filter((r) => r.response === 'applied').length,
    could_not: raw.responses.filter((r) => r.response === 'could_not').length,
    not_interested: raw.responses.filter((r) => r.response === 'not_interested').length,
  };
  return {
    totals,
    companies: [...companies.values()].sort((a, b) => b.applied - a.applied || b.opened - a.opened || (a.batch_date < b.batch_date ? 1 : -1) || a.company.localeCompare(b.company)),
    students: [...students.values()].sort((a, b) => b.applied - a.applied || b.answered - a.answered || a.roll_no.localeCompare(b.roll_no, 'en', { numeric: true })),
  };
}

module.exports = { compute, REASONS, RESPONSES };
