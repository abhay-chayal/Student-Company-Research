// One workbook for the HOD: for every student, how many of the five companies are already
// correct and which ones must be corrected (and why), with totals by branch.
//   node scripts/review/make-hod-report.js <review-folder>
// Writes <review-folder>/deliverables/FEC-28-student-status-for-HOD.xlsx and a CSV of the student sheet.
// The output holds student names and emails. Keep it out of the repository.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const dir = process.argv[2];
if (!dir) { console.error('Usage: node scripts/review/make-hod-report.js <review-folder>'); process.exit(1); }
const val = (v) => (v && v.text ? v.text : v && v.richText ? v.richText.map((t) => t.text).join('') : v);

// Short reasons a student can read at a glance (the long text stays in the full review).
function shortReason(reason) {
  const r = String(reason || '');
  if (/general careers page/i.test(r)) return 'gave the careers page, needs the link of the specific job';
  if (/home page/i.test(r)) return 'gave the home page, needs the link of the specific job';
  if (/no longer works|closed/i.test(r)) return 'job link is closed or not working';
  if (/list or search of jobs/i.test(r)) return 'gave a list or search of jobs, needs one job link';
  if (/not a clear hiring page/i.test(r)) return 'link is not a hiring page';
  if (/search or social/i.test(r)) return 'gave a search or social page, needs the job link';
  if (/could not be opened/i.test(r)) return 'link does not open';
  if (/website does not belong/i.test(r)) return 'wrong website for this company';
  if (/different company/i.test(r)) return 'the job is at a different company';
  return r.slice(0, 70);
}

// 23EARAD002 -> admission year 23, branch AD. A mistyped roll number falls back to "Not clear".
function branchOf(roll) {
  const m = /^(\d{2,3})EAR([A-Z]{1,3}?)(\d{2,4})$/.exec(roll);
  return m ? m[2] : 'Not clear';
}

(async () => {
  const src = new ExcelJS.Workbook();
  await src.xlsx.readFile(path.join(dir, 'company-review.xlsx'));
  const sheet = src.getWorksheet('All companies');
  const rows = [];
  sheet.eachRow((r, i) => {
    if (i === 1) return;
    const g = (n) => String(val(r.getCell(n).value) || '');
    rows.push({ name: g(2), roll: g(3), email: g(4), company: g(5), status: g(8), reason: g(9) });
  });

  const students = new Map();
  for (const r of rows) {
    if (!students.has(r.roll)) students.set(r.roll, { roll: r.roll, name: r.name, email: r.email, branch: branchOf(r.roll), ok: [], email_only: 0, general: 0, check: 0, fix: [] });
    const s = students.get(r.roll);
    if (r.status === 'Accepted') s.ok.push(r.company);
    else if (r.status === 'To redo') s.fix.push(`${r.company}: ${shortReason(r.reason)}`);
    else if (/email only/i.test(r.status)) s.email_only++;
    else if (/general page/i.test(r.status)) s.general++;
    else s.check++;
  }
  const list = [...students.values()].sort((a, b) => a.roll.localeCompare(b.roll));
  for (const s of list) {
    s.total = s.ok.length + s.email_only + s.general + s.check + s.fix.length;
    s.result = s.fix.length === 0 && s.ok.length === s.total ? 'All correct'
      : s.ok.length === 0 && s.email_only + s.general + s.check === 0 ? 'Nothing correct yet'
      : s.ok.length > 0 ? 'Partly correct' : 'Nothing correct yet';
  }

  const out = new ExcelJS.Workbook();
  const head = (ws, cols) => {
    ws.columns = cols.map(([header, width]) => ({ header, width }));
    const r = ws.getRow(1); r.height = 30;
    r.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }; c.alignment = { vertical: 'middle', wrapText: true }; });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };
  const tint = { 'All correct': 'FFE3F1E4', 'Partly correct': 'FFFFF2CC', 'Nothing correct yet': 'FFF8D7D3' };

  // ---- 1. summary ----
  const total = (f) => list.reduce((n, s) => n + f(s), 0);
  const S = out.addWorksheet('Summary');
  S.columns = [{ width: 62 }, { width: 14 }, { width: 12 }];
  const add = (a, b, c, bold) => { const r = S.addRow([a, b, c]); if (bold) r.font = { bold: true }; return r; };
  add('FEC-28 company selection: where every student stands', '', '', true).font = { bold: true, size: 14 };
  add(`Students who submitted: ${list.length}.  Companies: ${rows.length}.`);
  S.addRow([]);
  add('Companies', 'Count', 'Share', true);
  const share = (n) => Math.round((n / rows.length) * 1000) / 10 + '%';
  const ok = total((s) => s.ok.length), em = total((s) => s.email_only), ge = total((s) => s.general), ch = total((s) => s.check), fx = total((s) => s.fix.length);
  add('Correct: a link to one specific, open job', ok, share(ok));
  add('Waiting for the college: only an HR email was given', em, share(em));
  add('Waiting for the college: only a general careers page, for a company with no specific role', ge, share(ge));
  add('Being checked by hand: the site blocks automatic checks', ch, share(ch));
  add('Needs correction: the link must be replaced', fx, share(fx));
  S.addRow([]);
  add('Students', 'Count', 'Share', true);
  const sh = (n) => Math.round((n / list.length) * 1000) / 10 + '%';
  const allOk = list.filter((s) => s.result === 'All correct').length, partly = list.filter((s) => s.result === 'Partly correct').length, none = list.filter((s) => s.result === 'Nothing correct yet').length;
  add('All five companies correct', allOk, sh(allOk));
  add('Some companies correct, some to correct', partly, sh(partly));
  add('No company correct yet', none, sh(none));
  S.addRow([]);
  add('If HR emails are accepted too', 'Count', 'Share', true);
  add('Companies correct', ok + em, share(ok + em));
  add('Students with all five correct', list.filter((s) => s.total === s.ok.length + s.email_only).length, sh(list.filter((s) => s.total === s.ok.length + s.email_only).length));
  S.addRow([]);
  const notes = [
    'How to read this: "Correct" means the link goes to one specific job that is open now. A careers page, a home page, a job list or search, a social page and a closed job are not correct.',
    'Every company is unique and every website was checked. Only the job link needs correcting, so students keep their five companies.',
    'The "Waiting" groups depend on the college deciding what is acceptable. The second block above shows the totals if HR emails are accepted.',
  ];
  notes.forEach((t) => { const r = S.addRow([t]); S.mergeCells(`A${r.number}:C${r.number}`); r.getCell(1).alignment = { wrapText: true, vertical: 'top' }; r.height = 48; });

  // ---- 2. every student ----
  const T = out.addWorksheet('Student status');
  head(T, [['S.No', 7], ['RTU Roll No', 15], ['Student', 26], ['Email', 30], ['Branch', 9], ['Correct (of 5)', 10], ['Only an email', 10], ['General page', 10], ['Being checked', 10], ['Needs correction', 12], ['Result', 18], ['Correct companies', 48], ['Companies to correct, and what is wrong', 90]]);
  list.forEach((s, i) => {
    const row = T.addRow([i + 1, s.roll, s.name, s.email, s.branch, s.ok.length, s.email_only, s.general, s.check, s.fix.length, s.result, s.ok.join(', '), s.fix.join('\n')]);
    row.alignment = { vertical: 'top', wrapText: true };
    row.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint[s.result] } };
  });
  T.autoFilter = { from: 'A1', to: 'M1' };

  // ---- 3. by branch ----
  const B = out.addWorksheet('By branch');
  head(B, [['Branch (from roll number)', 20], ['Students', 10], ['Companies', 11], ['Correct', 10], ['Share correct', 12], ['Students with all five correct', 16], ['Students with none correct', 16], ['Needs correction (companies)', 16]]);
  const byBranch = new Map();
  for (const s of list) { if (!byBranch.has(s.branch)) byBranch.set(s.branch, []); byBranch.get(s.branch).push(s); }
  [...byBranch.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([b, ss]) => {
    const comp = ss.reduce((n, s) => n + s.total, 0), good = ss.reduce((n, s) => n + s.ok.length, 0);
    B.addRow([b, ss.length, comp, good, Math.round((good / comp) * 1000) / 10 + '%', ss.filter((s) => s.result === 'All correct').length, ss.filter((s) => s.result === 'Nothing correct yet').length, ss.reduce((n, s) => n + s.fix.length, 0)]);
  });

  // ---- 4. one row per company to correct ----
  const C = out.addWorksheet('Companies to correct');
  head(C, [['RTU Roll No', 15], ['Student', 26], ['Email', 30], ['Company', 32], ['What is wrong', 70]]);
  rows.filter((r) => r.status === 'To redo').sort((a, b) => a.roll.localeCompare(b.roll) || a.company.localeCompare(b.company))
    .forEach((r) => C.addRow([r.roll, r.name, r.email, r.company, shortReason(r.reason)]));
  C.autoFilter = { from: 'A1', to: 'E1' };

  const folder = path.join(dir, 'deliverables');
  fs.mkdirSync(folder, { recursive: true });
  await out.xlsx.writeFile(path.join(folder, 'FEC-28-student-status-for-HOD.xlsx'));

  // CSV of the student sheet (plain text, opens anywhere)
  const csvCell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/\n/g, ' | ') + '"';
  const csvRows = [['S.No', 'RTU Roll No', 'Student', 'Email', 'Branch', 'Correct (of 5)', 'Only an email', 'General page', 'Being checked', 'Needs correction', 'Result', 'Correct companies', 'Companies to correct, and what is wrong']]
    .concat(list.map((s, i) => [i + 1, s.roll, s.name, s.email, s.branch, s.ok.length, s.email_only, s.general, s.check, s.fix.length, s.result, s.ok.join(', '), s.fix.join(' | ')]));
  fs.writeFileSync(path.join(folder, 'FEC-28-student-status-for-HOD.csv'), '﻿' + csvRows.map((r) => r.map(csvCell).join(',')).join('\r\n'));

  console.log(`students ${list.length} | companies ${rows.length}`);
  console.log(`companies: correct ${ok} | email-only ${em} | general ${ge} | being checked ${ch} | to correct ${fx}  (sum ${ok + em + ge + ch + fx})`);
  console.log(`students: all correct ${allOk} | partly ${partly} | none ${none}  (sum ${allOk + partly + none})`);
  console.log('branches:', [...byBranch.entries()].map(([b, ss]) => `${b}:${ss.length}`).join(' '));
})();
