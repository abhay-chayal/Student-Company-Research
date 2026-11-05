// Splits the ranked company list into one sheet per domain group.
//   node scripts/review/split-by-domain.js <ranked.xlsx> <output.xlsx>
// The students typed 500+ different domain names, so a company is placed in the first group whose keywords
// match the domain it was entered under. Inside a sheet the order is the established-first ranking.
const ExcelJS = require('exceljs');

const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error('Usage: node scripts/review/split-by-domain.js <ranked.xlsx> <output.xlsx>'); process.exit(1); }

// First match wins, so the order matters.
const GROUPS = [
  ['General (any stream)', /^general\b/],
  ['Cybersecurity', /cyber|security|infosec|threat|\bsoc analyst/],
  ['Electrical, Power & Energy', /power electronics|power system|power generation|power transformer|power plant|solar power|instrumentation|\bcables?\b/],
  ['Robotics, Automation & Aerospace', /robot|drone|uav|aerospace|\bspace\b|defen[cs]e|avionic|industrial automation|process automation|automation and robotics/],
  ['Electronics, Embedded & Semiconductor', /embedded|firmware|vlsi|semiconductor|\bchip|ic design|rtl|silicon|analog|rfic|design verification|soc verification|soc integration|\buvm\b|asic|pcb|psb|hardware|optical|wireless|\brf\b|electronic|audio/],
  ['AI & Machine Learning', /\bai\b|\bml\b|machine learning|llm|genai|gen ai|generative|computer vision|deep learning|nlp|neural/],
  ['Finance & Quant', /quant|trader|trading|banking|financ|accountant|fintech|risk analytics/],
  ['Sales, Marketing & HR', /\bsales\b|marketing|\bbda\b|business development|buisness development|\bhr\b|human resource|recruit|\bseo\b|social media|content|script|video editor|inside sales|brand/],
  ['UI/UX & Design (software)', /ui\/?ux|\bux\b|product designer|graphic|web design/],
  ['QA & Testing', /\bqa\b|software testing|test engineer|tester|quality assurance|sdet|test automation|salesforce testing/],
  ['Enterprise Software (Salesforce, ERP)', /salesforce|servicenow|\berp\b|netsuite|\bsap\b|oracle/],
  ['Software Development', /software|developer|development|programmer|\bsde\b|\bsda\b|\bweb\b|\bapp\b|java|python|full ?stack|front ?end|back ?end|node|nest|php|react|\.net|spring|wordpress|mobile (app|dev)|application|\bengineer i\b|forward deployed|associate engineer|technical support|implementation|platform/],
  ['Business, Product & Project', /business analyst|business operations|\bbusiness\b|\bmis\b|product manager|product management|product fellowship|\bproduct\b|project|\bpmo\b|consult|operations|\bsolutions architect/],
  ['Data & Analytics', /\bdata\b|analyst|analytics|power bi|database|\bdba\b|research/],
  ['Cloud, DevOps & Networking', /devops|cloud|\bsre\b|site reliability|linux|infrastructure|network|telecom|system admin|systems engineer|system engineer|integration engineer|desktop support/],
  ['Electrical, Power & Energy', /electrical|power|solar|renewable|wind|energy|transformer|\bev\b|oil|gas|steam|boiler|transmission|grid|wire/],
  ['Mechanical, Manufacturing & Production', /mechanic|manufactur|production|automobile|automotive|design|desinger|\bcad\b|hvac|air conditioning|tyre|pump|valve|bearing|gear|forging|cnc|machine|steel|fabricat|railway|transportation|industrial|engine|heavy|precision|plant|maintenance|material|r&d|hydraulic|aerospace|quality|engineering|engineer/],
  ['General (any stream)', /graduate|trainee|trainer|\bget\b|intern|technician/],
];
const OTHER = 'Other / unclear';
function groupOf(domain) {
  const d = String(domain || '').toLowerCase().trim();
  for (const [name, re] of GROUPS) if (re.test(d)) return name;
  return OTHER;
}

(async () => {
  const src = new ExcelJS.Workbook();
  await src.xlsx.readFile(input);
  const ws = src.getWorksheet('Ranked companies');
  const head = ws.getRow(1).values.slice(1);
  const rows = [];
  ws.eachRow((r, i) => {
    if (i === 1) return;
    const cells = r.values.slice(1);
    rows.push({ cells, group: groupOf(cells[4] && cells[4].text ? cells[4].text : cells[4]), tier: String(cells[1] || '')[0] });
  });

  const names = [...new Set(GROUPS.map((g) => g[0])), OTHER];
  const by = new Map(names.map((n) => [n, []]));
  rows.forEach((r) => by.get(r.group).push(r));

  const out = new ExcelJS.Workbook();
  const NAVY = 'FF1E3A5F';
  const style = (sheet) => {
    sheet.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }; c.alignment = { vertical: 'middle', wrapText: true }; });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  };
  const TINT = { A: 'FFD9EAD3', B: 'FFE6F1DA', C: 'FFFFF2CC', D: 'FFFCE5CD', E: 'FFEDEDED' };

  // summary first
  const S = out.addWorksheet('Summary');
  S.columns = [{ header: 'Domain group', width: 42 }, { header: 'Companies', width: 12 }, { header: 'A Large', width: 10 }, { header: 'B Established', width: 14 }, { header: 'C Mid-size', width: 11 }, { header: 'D Small', width: 10 }, { header: 'E No info', width: 11 }, { header: 'A + B (established)', width: 18 }];
  style(S);
  names.filter((n) => by.get(n).length).sort((a, b) => by.get(b).length - by.get(a).length).forEach((n) => {
    const g = by.get(n), c = (t) => g.filter((r) => r.tier === t).length;
    S.addRow([n, g.length, c('A'), c('B'), c('C'), c('D'), c('E'), c('A') + c('B')]);
  });
  S.addRow([]);
  S.addRow(['Total', rows.length]).font = { bold: true };
  S.addRow([]);
  S.addRow(['A company sits in the group that matches the domain its student entered. Inside each sheet the companies are ranked established-first (tier A at the top).']);

  const usedNames = new Set(['Summary']);
  const sheetName = (n) => { let s = n.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31); let k = 2; while (usedNames.has(s)) s = s.slice(0, 28) + ' ' + k++; usedNames.add(s); return s; };
  for (const n of names) {
    const g = by.get(n);
    if (!g.length) continue;
    const sheet = out.addWorksheet(sheetName(n));
    sheet.columns = head.map((h, i) => ({ header: i === 0 ? 'Overall rank' : h, width: [10, 26, 34, 30, 28, 16, 12, 20, 40, 60, 50, 18, 16][i] || 20 }));
    style(sheet);
    g.forEach((r) => {
      const row = sheet.addRow(r.cells);
      row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TINT[r.tier] } };
    });
    sheet.autoFilter = { from: 'A1', to: 'M1' };
  }
  await out.xlsx.writeFile(output);

  console.log('companies', rows.length);
  names.forEach((n) => { if (by.get(n).length) console.log(String(by.get(n).length).padStart(5), n); });
  // a few examples per group to check the rules
  for (const n of names) {
    const g = by.get(n);
    if (!g.length) continue;
    const seen = [...new Set(g.map((r) => String(r.cells[4] && r.cells[4].text ? r.cells[4].text : r.cells[4])))];
    console.log('\n' + n + ' <- ' + seen.slice(0, 14).join(' | '));
  }
})();
