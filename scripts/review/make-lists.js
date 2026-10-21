// Builds the lists to share from company-review.xlsx:
//   FEC-28-accepted-companies.xlsx   who is accepted (for the groups)
//   FEC-28-companies-to-fix.xlsx     who must correct what, plus entries waiting for a college decision
// The output holds student names and emails. Keep it out of the repository.
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const dir = process.argv[2];
if (!dir) { console.error('Usage: node scripts/review/make-lists.js <review-folder>'); process.exit(1); }
const val = (v) => (v && v.text ? v.text : v && v.richText ? v.richText.map((t) => t.text).join('') : v);

(async () => {
  const src = new ExcelJS.Workbook();
  await src.xlsx.readFile(path.join(dir, 'company-review.xlsx'));
  const sheet = src.getWorksheet('All companies');
  const rows = [];
  sheet.eachRow((r, i) => {
    if (i === 1) return;
    const g = (n) => val(r.getCell(n).value);
    rows.push({ name: String(g(2) || ''), roll: String(g(3) || ''), email: String(g(4) || ''), company: String(g(5) || ''), domain: String(g(7) || ''), status: String(g(8) || ''), reason: String(g(9) || ''), dl: String(g(10) || ''), fl: String(g(11) || ''), job: String(g(12) || '') });
  });
  const out = path.join(dir, 'deliverables');
  fs.mkdirSync(out, { recursive: true });

  const head = (ws, cols) => {
    ws.columns = cols.map(([header, width]) => ({ header, width }));
    const r = ws.getRow(1); r.height = 26;
    r.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }; c.alignment = { vertical: 'middle', wrapText: true }; });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };
  const link = (cell, v) => { if (/^https?:\/\//i.test(v)) cell.value = { text: v, hyperlink: v.slice(0, 2000) }; };
  const byRoll = (a, b) => a.roll.localeCompare(b.roll) || a.company.localeCompare(b.company);
  const students = new Map();
  for (const r of rows) { if (!students.has(r.roll)) students.set(r.roll, { name: r.name, roll: r.roll, email: r.email, all: [] }); students.get(r.roll).all.push(r); }

  // ---- accepted ----
  const A = rows.filter((r) => r.status === 'Accepted').sort(byRoll);
  const wa = new ExcelJS.Workbook();
  const s1 = wa.addWorksheet('Accepted by student');
  head(s1, [['RTU Roll No', 16], ['Student', 26], ['Accepted', 10], ['Accepted companies', 90]]);
  [...students.values()].sort((a, b) => a.roll.localeCompare(b.roll)).forEach((s) => {
    const acc = s.all.filter((r) => r.status === 'Accepted');
    if (acc.length) s1.addRow([s.roll, s.name, `${acc.length} of ${s.all.length}`, acc.map((r) => r.company).join(', ')]).alignment = { vertical: 'top', wrapText: true };
  });
  const s2 = wa.addWorksheet('Accepted companies');
  head(s2, [['RTU Roll No', 16], ['Student', 26], ['Company', 32], ['Domain', 26], ['Job found', 50], ['Job link', 70]]);
  A.forEach((r) => { const link1 = r.dl && !r.dl.includes('@') && /posting|job/i.test(r.job || '') ? r.dl : (r.dl || r.fl); const row = s2.addRow([r.roll, r.name, r.company, r.domain, r.job, link1]); link(row.getCell(6), link1); });
  s2.autoFilter = { from: 'A1', to: 'F1' };
  await wa.xlsx.writeFile(path.join(out, 'FEC-28-accepted-companies.xlsx'));

  // ---- to fix and pending ----
  const wf = new ExcelJS.Workbook();
  const f1 = wf.addWorksheet('To fix');
  head(f1, [['RTU Roll No', 16], ['Student', 26], ['Email', 30], ['Company', 32], ['Domain', 24], ['What to fix', 80]]);
  rows.filter((r) => r.status === 'To redo').sort(byRoll).forEach((r) => f1.addRow([r.roll, r.name, r.email, r.company, r.domain, r.reason]).alignment = { vertical: 'top', wrapText: true });
  f1.autoFilter = { from: 'A1', to: 'F1' };
  const f2 = wf.addWorksheet('Waiting for a decision');
  head(f2, [['RTU Roll No', 16], ['Student', 26], ['Company', 32], ['Domain', 24], ['Status', 28], ['Link or email given', 70]]);
  rows.filter((r) => r.status.startsWith('Pending')).sort((a, b) => a.status.localeCompare(b.status) || byRoll(a, b)).forEach((r) => { const v = r.dl || r.fl; const row = f2.addRow([r.roll, r.name, r.company, r.domain, r.status, v]); link(row.getCell(6), v); });
  f2.autoFilter = { from: 'A1', to: 'F1' };
  const f3 = wf.addWorksheet('Per student');
  head(f3, [['RTU Roll No', 16], ['Student', 26], ['Email', 30], ['Accepted', 10], ['Waiting', 10], ['To fix', 10], ['Companies to fix', 80]]);
  [...students.values()].sort((a, b) => b.all.filter((r) => r.status === 'To redo').length - a.all.filter((r) => r.status === 'To redo').length || a.roll.localeCompare(b.roll)).forEach((s) => {
    const a = s.all.filter((r) => r.status === 'Accepted').length, d = s.all.filter((r) => r.status === 'To redo');
    f3.addRow([s.roll, s.name, s.email, a, s.all.length - a - d.length, d.length, d.map((r) => r.company).join(', ')]).alignment = { vertical: 'top', wrapText: true };
  });
  await wf.xlsx.writeFile(path.join(out, 'FEC-28-companies-to-fix.xlsx'));

  const count = (s) => rows.filter((r) => r.status === s).length;
  console.log(`accepted ${count('Accepted')} | to fix ${count('To redo')} | waiting ${rows.filter((r) => r.status.startsWith('Pending')).length}`);
  console.log('Wrote', path.join(out, 'FEC-28-accepted-companies.xlsx'));
  console.log('Wrote', path.join(out, 'FEC-28-companies-to-fix.xlsx'));
})();
