// One workbook per branch (EARAD = AI&DS, EARCS = CS, EARIT = IT) for the HOD, from final-results.json.
//   node scripts/review/make-branch-lists.js <review-folder>
// The output holds student names. Keep it out of the repository.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const dir = process.argv[2];
if (!dir) { console.error('Usage: node scripts/review/make-branch-lists.js <review-folder>'); process.exit(1); }

const BRANCHES = [
  { code: 'AD', file: 'EARAD-AI&DS', title: 'AI & DS (EARAD)' },
  { code: 'CS', file: 'EARCS-CS', title: 'CS (EARCS)' },
  { code: 'IT', file: 'EARIT-IT', title: 'IT (EARIT)' },
];
const branchOf = (roll) => { const m = /EAR(AD|CS|IT)/.exec(roll); return m ? m[1] : null; };

(async () => {
  const results = JSON.parse(fs.readFileSync(path.join(dir, 'final-results.json'), 'utf8'));
  const folder = path.join(dir, 'deliverables', 'for-HOD');
  fs.mkdirSync(folder, { recursive: true });

  const unplaced = results.filter((r) => !branchOf(r.roll));
  if (unplaced.length) throw new Error('Roll numbers with no branch: ' + [...new Set(unplaced.map((r) => r.roll))].join(', '));

  let total = 0;
  for (const b of BRANCHES) {
    const rows = results.filter((r) => branchOf(r.roll) === b.code)
      .sort((x, y) => x.roll.localeCompare(y.roll) || x.company.localeCompare(y.company));
    const approved = rows.filter((r) => r.status === 'Accepted').length;
    const students = new Set(rows.map((r) => r.roll)).size;

    const book = new ExcelJS.Workbook();
    const ws = book.addWorksheet('Final list');
    ws.columns = [{ header: 'S.No', width: 7 }, { header: 'RTU Roll No', width: 16 }, { header: 'Student Name', width: 28 }, { header: 'Company', width: 36 }, { header: 'Approved / Not approved', width: 24 }];
    ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }; });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    let n = 0, last = null;
    for (const r of rows) {
      const first = r.roll !== last;
      if (first) n++;
      last = r.roll;
      const row = ws.addRow([first ? n : '', first ? r.roll : '', first ? r.name : '', r.company, r.status === 'Accepted' ? 'Approved' : 'Not approved']);
      row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: r.status === 'Accepted' ? 'FFE3F1E4' : 'FFF8D7D3' } };
      if (first) row.eachCell((c) => { c.border = { top: { style: 'thin', color: { argb: 'FF9AA5B1' } } }; });
    }

    const out = path.join(folder, `FEC-28-${b.file}.xlsx`);
    await book.xlsx.writeFile(out);
    total += rows.length;
    console.log(`${b.title}: ${students} students, ${rows.length} companies, ${approved} approved, ${rows.length - approved} not approved -> ${out}`);
  }
  console.log(`total companies ${total} of ${results.length}`);
})();
