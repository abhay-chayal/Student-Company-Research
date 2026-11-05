const ExcelJS = require('exceljs');
const { getDb } = require('../lib/db');
const { send, readBody, isAdmin } = require('../lib/http');
const { previewNext, publishNext } = require('../lib/applybatch');
const { compute, REASONS, RESPONSES } = require('../lib/applystats');
const { todayIST, BRANCH_LABEL } = require('../lib/rollout');

function editDistanceAtMostOne(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

/** Names that look alike. A quick skim for the admin; nothing is blocked. */
function similarPairs(students) {
  const list = students.flatMap((s) => s.companies.map((c) => ({ name: c.name, key: c.name_key })));
  const pairs = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i].key;
      const b = list[j].key;
      if (a === b) continue;
      const short = a.length <= b.length ? a : b;
      const long = a.length <= b.length ? b : a;
      const near =
        (short.length >= 5 && editDistanceAtMostOne(a, b)) ||
        (short.length >= 4 && long.startsWith(short));
      if (near) pairs.push([list[i].name, list[j].name]);
    }
  }
  return pairs.slice(0, 200);
}

// Stop Excel from running a typed value as a formula.
function defuse(value) {
  const text = String(value == null ? '' : value);
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
}

function csvCell(value) {
  return '"' + defuse(value).replace(/"/g, '""') + '"';
}

const HEADER = [
  'S.No', 'Student Name', 'RTU Roll No', 'Email ID', 'Company', 'Website', 'Domain',
  'Domain-specific Link / Email', 'Fresher Hiring Link / Email',
  'Employee Strength', 'Fresher Package (LPA)', 'Revenue', 'Review',
];

const revenueText = (c) => (c.revenue_amount == null || !c.revenue_unit ? '' : `${Number(c.revenue_amount)} ${c.revenue_unit} ${c.revenue_currency || ''}`.trim());

const REVIEW_LABEL = { new: 'Not reviewed', accepted: 'Accepted', to_fix: 'To fix', pending: 'Pending decision', resubmitted: 'Corrected, to re-check' };
const REVIEW_STATUSES = new Set(Object.keys(REVIEW_LABEL));
// Accepts both the database words and the labels used in the review workbook.
function reviewStatus(word) {
  const w = String(word || '').trim().toLowerCase();
  if (REVIEW_STATUSES.has(w)) return w;
  if (w === 'accepted') return 'accepted';
  if (w === 'to redo' || w === 'to fix') return 'to_fix';
  if (w.startsWith('pending')) return 'pending';
  return null;
}

/** One row per company. The student columns repeat on all of a student's rows (no merged cells). */
function companyRows(students) {
  const rows = [];
  students.forEach((s, idx) => {
    s.companies.forEach((c) => {
      rows.push({
        student: idx,
        cells: [idx + 1, s.name, s.roll_no, s.email || '', c.name, c.website, c.domain || '', c.domain_link || '', c.general_link || '',
          c.employee_strength || '', c.package_lpa == null ? '' : Number(c.package_lpa), revenueText(c), REVIEW_LABEL[c.review_status] || REVIEW_LABEL.new],
      });
    });
  });
  return rows;
}

function hyperlinkFor(value) {
  if (!value) return null;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  if (/^[^\s@]+@[^\s@]+$/.test(value)) return 'mailto:' + value;
  return null;
}

module.exports = async (req, res) => {
  if (!isAdmin(req)) return send(res, 401, { error: 'Wrong password.' });
  const db = getDb();
  const action = (req.query && req.query.action) || 'list';

  try {
    if (action === 'list') {
      const students = await db.listAll();
      return send(res, 200, {
        count: students.length,
        companyCount: students.reduce((n, s) => n + s.companies.length, 0),
        reservedCount: await db.reservedCount(),
        students: students.map((s) => ({
          roll_no: s.roll_no,
          email: s.email || '',
          name: s.name,
          created_at: s.created_at,
          companies: s.companies.map((c) => ({
            name: c.name,
            website: c.website,
            domain: c.domain,
            domain_link: c.domain_link,
            general_link: c.general_link,
            employee_strength: c.employee_strength || '',
            package_lpa: c.package_lpa == null ? null : Number(c.package_lpa),
            revenue_amount: c.revenue_amount == null ? null : Number(c.revenue_amount),
            revenue_unit: c.revenue_unit || '',
            revenue_currency: c.revenue_currency || '',
            review_status: c.review_status || 'new',
            review_note: c.review_note || '',
          })),
        })),
        similar: similarPairs(students),
      });
    }

    // Load the review results (accepted / to fix / pending) into the database.
    if (action === 'review' && req.method === 'POST') {
      const { items } = readBody(req);
      if (!Array.isArray(items) || items.length === 0 || items.length > 6000) return send(res, 400, { ok: false, message: 'Send between 1 and 6000 results.' });
      const clean = [];
      for (const it of items) {
        const status = reviewStatus(it.status);
        const roll = String(it.roll || '').toUpperCase().replace(/[\s\-_/.]/g, '');
        const key = String(it.name_key || '');
        if (status && roll && key) clean.push({ roll, name_key: key, status, reason: String(it.reason || '').slice(0, 300) });
      }
      const updated = await db.applyReview(clean);
      return send(res, 200, { ok: true, received: items.length, valid: clean.length, updated });
    }

    // Every earlier version of a company changed on the fix page (newest first), and restoring one.
    if (action === 'history') {
      const roll = String((req.query && req.query.roll) || '').toUpperCase().replace(/[\s\-_/.]/g, '');
      const rows = await db.listHistory(roll || null);
      return send(res, 200, { count: rows.length, history: rows.slice(0, 500) });
    }
    if (action === 'restore' && req.method === 'POST') {
      const { id } = readBody(req);
      if (!Number.isInteger(Number(id)) || Number(id) < 1) return send(res, 400, { ok: false, message: 'Missing history id.' });
      const outcome = await db.restoreCompany(id);
      if (outcome.ok) return send(res, 200, { ok: true });
      if (outcome.code === 'conflict') {
        const why = outcome.conflicts.map((c) => `the ${c.field} belongs to "${c.taken}"`).join(' and ');
        return send(res, 409, { ok: false, message: `Cannot restore: ${why}, which is taken now.` });
      }
      if (outcome.code === 'missing') return send(res, 404, { ok: false, message: 'That student or company no longer exists.' });
      return send(res, 409, { ok: false, message: 'Someone just took that name or website. Try again.' });
    }

    // ---- the daily "apply" page ----
    if (action === 'apply_status') {
      const batches = await db.applyBatches(60);
      const next = await previewNext(db);
      const raw = await db.applyRaw();
      return send(res, 200, {
        today: todayIST(),
        days: batches.map((b) => ({ date: b.batch_date, branch: BRANCH_LABEL[b.branch] || b.branch, companies: b.companies.length, students: [...new Set(b.companies.map((c) => c.roll_no))] })),
        next: next ? { branch: next.label, students: next.rolls } : null,
        totals: compute(raw).totals,
      });
    }
    if (action === 'apply_publish' && req.method === 'POST') {
      const body = readBody(req);
      const date = body.date ? String(body.date) : todayIST();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { ok: false, message: 'Use a date like 2026-11-06.' });
      const out = await publishNext(db, { date, source: 'manual' });
      return send(res, out.ok ? 200 : 400, out.ok ? out : { ok: false, message: out.message || (out.code === 'already' ? 'One of these students was published before.' : 'Nothing to publish.') });
    }
    if (action === 'apply_unpublish' && req.method === 'POST') {
      const date = String(readBody(req).date || '');
      const out = await db.applyUnpublish(date);
      if (out.ok) return send(res, 200, { ok: true });
      return send(res, out.code === 'missing' ? 404 : 409, { ok: false, message: out.code === 'has_responses' ? 'Students have already answered for this day, so it cannot be taken back.' : 'No batch for that date.' });
    }
    if (action === 'apply_stats') return send(res, 200, compute(await db.applyRaw()));
    if (action === 'apply_xlsx') {
      const raw = await db.applyRaw();
      const stats = compute(raw);
      const book = new ExcelJS.Workbook();
      const head = (ws, cols) => {
        ws.columns = cols.map(([header, width]) => ({ header, width }));
        ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }; c.alignment = { vertical: 'middle', wrapText: true }; });
        ws.views = [{ state: 'frozen', ySplit: 1 }];
      };
      const c = book.addWorksheet('By company');
      head(c, [['Company', 32], ['Submitted by (roll)', 18], ['Domain', 26], ['Published on', 14], ['Branch', 10], ['Students who opened', 12], ['Applied', 10], ['Could not apply', 12], ['Not interested', 12], ['Link not working', 12], ['Job closed or expired', 12], ['No relevant opening', 12], ['Other', 9]]);
      stats.companies.forEach((r) => c.addRow([r.company, r.submitted_by, r.domain, r.batch_date, BRANCH_LABEL[r.branch] || r.branch, r.opened, r.applied, r.could_not, r.not_interested, r.link_not_working, r.job_closed, r.no_relevant_opening, r.other]));
      const st = book.addWorksheet('By student');
      head(st, [['RTU roll no', 16], ['Student', 28], ['Branch', 10], ['Companies opened', 12], ['Applied', 10], ['Could not apply', 12], ['Not interested', 12], ['Answered in all', 12]]);
      stats.students.forEach((r) => st.addRow([r.roll_no, r.name, r.branch, r.opened, r.applied, r.could_not, r.not_interested, r.answered]));
      const all = book.addWorksheet('All answers');
      head(all, [['RTU roll no', 16], ['Student', 28], ['Company', 32], ['Answer', 18], ['Reason', 26], ['Note', 40], ['Opened the link at', 20], ['Answered at', 20], ['Times changed', 10]]);
      const nameOf = new Map(raw.students.map((x) => [x.roll_key, x])), compOf = new Map(raw.items.map((x) => [x.company_id, x.company_name]));
      raw.responses.slice().sort((a, b) => String(b.answered_at).localeCompare(String(a.answered_at))).forEach((r) => {
        const who = nameOf.get(r.roll_key) || {};
        all.addRow([who.roll_no || r.roll_key, who.name || '', compOf.get(r.company_id) || '', RESPONSES[r.response] || r.response, REASONS[r.reason] || '', r.note || '', r.first_click_at || '', r.answered_at || '', r.changes || 0]);
      });
      const days = book.addWorksheet('Published days');
      head(days, [['Date', 14], ['Branch', 10], ['Companies', 12]]);
      const byDay = new Map();
      raw.items.forEach((i) => { const k = i.batch_date + '|' + i.branch; byDay.set(k, (byDay.get(k) || 0) + 1); });
      [...byDay.entries()].sort().forEach(([k, n]) => { const [d, b] = k.split('|'); days.addRow([d, BRANCH_LABEL[b] || b, n]); });
      const buffer = await book.xlsx.writeBuffer();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="apply-responses.xlsx"');
      return res.end(Buffer.from(buffer));
    }

    if (action === 'delete' && req.method === 'POST') {
      const { roll } = readBody(req);
      const key = String(roll || '').toUpperCase().replace(/[\s\-_/.]/g, '');
      const removed = await db.deleteByRoll(key);
      return send(res, 200, { ok: removed });
    }

    if (action === 'csv') {
      const rows = companyRows(await db.listAll()).map((r) => r.cells);
      const text = '﻿' + [HEADER, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="company-research.csv"');
      return res.end(text);
    }

    if (action === 'xlsx') {
      const students = await db.listAll();
      const book = new ExcelJS.Workbook();
      const thin = { style: 'thin', color: { argb: 'FFD0D5DD' } };
      const border = { top: thin, left: thin, bottom: thin, right: thin };

      // Sheet 1: one row per company, student columns repeated.
      const sheet = book.addWorksheet('Student Research', { views: [{ state: 'frozen', ySplit: 1 }] });
      sheet.columns = [8, 24, 18, 30, 28, 26, 26, 42, 42, 18, 14, 22, 22].map((width) => ({ width }));
      const head = sheet.addRow(HEADER);
      head.height = 30;
      head.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.border = border;
      });
      companyRows(students).forEach((r) => {
        const row = sheet.addRow(r.cells.map((v) => (typeof v === 'string' ? defuse(v) : v)));
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          cell.border = border;
          cell.alignment = { vertical: 'top', wrapText: true };
          if (r.student % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAF4E6' } };
          if (col === 4 || col === 8 || col === 9) {
            const raw = r.cells[col - 1];
            const link = hyperlinkFor(raw);
            if (link) {
              cell.value = { text: raw, hyperlink: link };
              cell.font = { color: { argb: 'FF1D4ED8' }, underline: true };
            }
          }
        });
      });
      sheet.autoFilter = { from: 'A1', to: 'M1' };

      // Sheet 2: every company A to Z, handy for checking nothing repeats.
      const flat = book.addWorksheet('All companies A-Z', { views: [{ state: 'frozen', ySplit: 1 }] });
      flat.columns = [30, 26, 26, 24, 18].map((width) => ({ width }));
      flat.addRow(['Company', 'Website', 'Domain', 'Student', 'RTU Roll No']).font = { bold: true };
      students
        .flatMap((s) => s.companies.map((c) => [c.name, c.website, c.domain || '', s.name, s.roll_no]))
        .sort((x, y) => x[0].localeCompare(y[0]))
        .forEach((r) => flat.addRow(r.map(defuse)));

      const buffer = await book.xlsx.writeBuffer();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="company-research.xlsx"');
      return res.end(Buffer.from(buffer));
    }

    return send(res, 400, { error: 'Unknown action.' });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: 'Something went wrong.' });
  }
};
