// Cleans a college company list and prepares it for the database.
//
//   node scripts/build-reserved.js "C:/path/List of Companies.xlsx"
//
// Reads the first sheet (column A = S.No, column B = company name), cleans the names, merges
// duplicates and spelling variants using the SAME rules the form uses, and writes:
//   data/reserved-companies.json        used by the app when it runs without Supabase
//   supabase/seed_reserved.sql          paste into the Supabase SQL Editor
//   data/ACEIT-companies-cleaned.xlsx   the cleaned list + what was merged + what was fixed
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { cleanText, nameKey, coreKey } = require('../lib/normalize');
const { isSimilar } = require('../lib/similar');

const input = process.argv[2] || 'C:/Users/chaya/Downloads/List of Companies_ACEIT.xlsx';
const root = path.join(__dirname, '..');

// Rows whose text cannot be used as typed.
const REWRITE = { '24[7] .AI': ['24/7.ai'], 'Hexnode | Mitsogo': ['Hexnode', 'Mitsogo'] };
// Other names a company goes by, written in brackets in the sheet.
const ALIASES = {
  'Daffodil Software (Unthinkable)': ['Unthinkable'],
  'Unthinkable Solutions (Daffodil)': ['Daffodil'],
  'Deltecs Infotech (DronaHQ)': ['DronaHQ'],
  'IBM GTS (Kyndryl)': ['Kyndryl'],
  'Swiflearn (Incassable Technologies Pvt Ltd)': ['Incassable Technologies'],
  'Infojini Inc (Rtech Systems)': ['Rtech Systems'],
  'Amara Raja Batteries Limited (ARBL)': ['ARBL'],
  'Bristish Telecom (BT Group)': ['BT Group'],
  'loadsmart (RoadEx solutions LLC)': ['RoadEx'],
  'FirstHire (The First Labs)': ['The First Labs'],
  'Hashedin by Deloitte': ['HashedIn'],
  'Comely Enterprise (Funnearn)': ['Funnearn'],
  // Well-known other names of listed companies.
  'HCL Technologies': ['HCLTech', 'HCL Tech'],
  'LTI': ['LTIMindtree', 'LTI Mindtree'],
  'NIIT Technologies': ['Coforge'],
};
// Names that are the same company even though they look different (keys after cleaning).
const SAME_COMPANY = [
  ['ibm', 'ibmgts', 'ibmgbs', 'ibmconsulting', 'kyndryl'],
  ['tcs', 'tataconsultancyservices'],
  ['daffodilsoftware', 'unthinkable', 'unthinkablesolutions', 'daffodil'],
  ['esafbank', 'esafsmallfinancebank'],
  ['hcl', 'hcltechnologies', 'hcltech'],
  ['lti', 'ltimindtree', 'mindtree', 'ltinfotech'],
];
// Preferred spelling for a few brands (key -> display name).
const DISPLAY = {
  hcl: 'HCL Technologies', byjus: "BYJU'S", eclinicalworks: 'eClinicalWorks', infoobjects: 'InfoObjects',
  ibm: 'IBM', epam: 'EPAM', mitsogo: 'Mitsogo', mitsgo: 'Mitsogo', tcs: 'TCS', daffodilsoftware: 'Daffodil Software',
  mindtree: 'Mindtree', rightpoint: 'Rightpoint India', appperfect: 'AppPerfect',
};

const LEGAL = /\b(pvt|private|ltd|limited|llp|inc|incorporated|corp|corporation|plc|gmbh)\b\.?/gi;
const tidy = (s) => s.replace(LEGAL, ' ').replace(/[\s.,]+$/g, '').replace(/\s+/g, ' ').trim();
// Exams and events that stand for the company that runs them.
const EVENT_WORDS = /\b(code ?vita|nqt|interview|off[- ]?campus( drive)?|grid [0-9.]+)\b/gi;

/** Turn one sheet cell into one or more clean company names (plus a note of what changed). */
function preclean(original) {
  const orig = cleanText(original);
  if (REWRITE[orig]) return { names: REWRITE[orig], note: 'Name had characters the form does not accept' };
  let text = orig.replace(/_/g, ' ');
  const aliases = ALIASES[orig] || [];
  text = text.replace(/\([^)]*\)/g, ' ');                       // notes in brackets
  text = text.replace(EVENT_WORDS, ' ');                          // "TCS Off Campus" -> "TCS"
  text = text.replace(/\s*,\s*$/, '');                            // dangling comma
  text = text.replace(/^(.+?)\s*,\s*[A-Za-z]+$/, '$1');           // ", Jaipur"
  text = text.replace(/\s+/g, ' ').trim();
  let names = [text];
  const slash = text.match(/^(.+?)\s*\/\s+(.+)$/);                // "Vodafone/ Quess"
  if (slash) names = [slash[1].trim(), slash[2].trim()];
  names = [...names, ...aliases].filter(Boolean);
  const note = [];
  if (/\([^)]*\)/.test(orig)) note.push('Removed note in brackets');
  if (EVENT_WORDS.test(orig)) { note.push('Removed event/exam word'); EVENT_WORDS.lastIndex = 0; }
  if (slash) note.push('Two companies in one cell');
  if (aliases.length) note.push('Added other name: ' + aliases.join(', '));
  if (/\s*,\s*[A-Za-z]+$/.test(orig) && !/\)/.test(orig)) note.push('Removed city');
  return { names, note: note.join('; ') };
}

(async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(input);
  const sheet = book.worksheets[0];
  const val = (v) => (v && v.text ? v.text : v && v.richText ? v.richText.map((t) => t.text).join('') : v);

  // 1. read
  const raw = [];
  sheet.eachRow((row, i) => {
    if (typeof val(row.getCell(1).value) !== 'number') return; // skip titles and header
    const original = String(val(row.getCell(2).value) ?? '').trim();
    if (original) raw.push({ row: i, original });
  });

  // 2. clean each cell
  const notes = [];
  const usable = [];
  for (const r of raw) {
    const { names, note } = preclean(r.original);
    if (note) notes.push([r.row, r.original.replace(/\s+/g, ' '), names.join('  +  '), note]);
    for (const n of names) {
      const k = nameKey(n);
      if (k.error) { notes.push([r.row, r.original, 'Dropped', k.error + ' (' + n + ')']); continue; }
      usable.push({ row: r.row, original: r.original, name: n, key: k.key, core: coreKey(n) });
    }
  }

  // 3. merge: same key, same core key, one-typo variants, or listed as the same company
  const parent = usable.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { parent[find(a)] = find(b); };
  const why = new Map();
  const mark = (i, text) => { const g = find(i); if (!why.has(g)) why.set(g, new Set()); why.get(g).add(text); };
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const a = usable[i], b = usable[j];
      let reason = null;
      if (a.key === b.key) reason = 'same name once spaces, symbols and Pvt/Ltd are ignored';
      else if (a.core.length >= 3 && a.core === b.core) reason = 'same name apart from words like Software/Systems/Services';
      else if (isSimilar(a.key, b.key)) reason = 'spelling variant';
      if (reason) { union(i, j); mark(i, reason); }
    }
  }
  for (const keys of SAME_COMPANY) {
    const idx = keys.map((k) => usable.findIndex((u) => u.key === k)).filter((i) => i >= 0);
    for (let n = 1; n < idx.length; n++) { union(idx[0], idx[n]); mark(idx[0], 'same company under another name'); }
  }
  const groups = new Map();
  usable.forEach((it, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(it); });

  // 4. one clean name per group; every spelling's key is reserved
  const cleaned = [];
  const merged = [];
  const reserved = new Map(); // key -> display name
  for (const [g, members] of groups) {
    const keys = [...new Set(members.map((m) => m.key))];
    const override = keys.map((k) => DISPLAY[k]).find(Boolean);
    const count = new Map();
    members.forEach((m) => { const t = tidy(m.name); const k = t.toLowerCase(); count.set(k, { t, n: (count.get(k)?.n || 0) + 1 }); });
    const options = [...count.values()].filter((o) => o.t).sort((a, b) => b.n - a.n || b.t.length - a.t.length);
    const pick = override || options[0].t;
    cleaned.push({ name: pick, key: nameKey(pick).key });
    keys.forEach((k) => reserved.set(k, pick));
    if (members.length > 1) {
      const variants = [...new Set(members.map((m) => tidy(m.name)))].filter((v) => v && v !== pick);
      if (variants.length) merged.push({ kept: pick, variants, rows: [...new Set(members.map((m) => m.row))], why: [...(why.get(find(usable.indexOf(members[0]))) || [])].join('; ') });
    }
  }
  cleaned.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  // 5. write outputs
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const rows = [...reserved.entries()].map(([key, name]) => ({ name, key })).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.key.localeCompare(b.key));
  fs.writeFileSync(path.join(root, 'data', 'reserved-companies.json'), JSON.stringify(rows, null, 1));

  const q = (s) => "'" + s.replace(/'/g, "''") + "'";
  fs.writeFileSync(path.join(root, 'supabase', 'seed_reserved.sql'), [
    '-- Companies already on the college list. Students see these as "already taken".',
    '-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.',
    '-- Run supabase/schema.sql first (it creates the reserved_companies table).',
    'insert into reserved_companies (name, name_key) values',
    rows.map((c) => `  (${q(c.name)}, ${q(c.key)})`).join(',\n'),
    'on conflict (name_key) do nothing;',
    '',
  ].join('\n'));

  const out = new ExcelJS.Workbook();
  const head = (ws) => { ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }; }); };
  const s1 = out.addWorksheet('Cleaned list', { views: [{ state: 'frozen', ySplit: 1 }] });
  s1.columns = [{ width: 8 }, { width: 52 }];
  s1.addRow(['S.No', 'Company']); head(s1);
  cleaned.forEach((c, i) => s1.addRow([i + 1, c.name]));
  const s2 = out.addWorksheet('Merged duplicates', { views: [{ state: 'frozen', ySplit: 1 }] });
  s2.columns = [{ width: 34 }, { width: 70 }, { width: 18 }, { width: 55 }];
  s2.addRow(['Kept as', 'Other spellings merged into it', 'Original rows', 'Why']); head(s2);
  merged.sort((a, b) => a.kept.localeCompare(b.kept)).forEach((m) => s2.addRow([m.kept, m.variants.join('  |  '), m.rows.join(', '), m.why]));
  const s3 = out.addWorksheet('Fixed or dropped', { views: [{ state: 'frozen', ySplit: 1 }] });
  s3.columns = [{ width: 8 }, { width: 50 }, { width: 40 }, { width: 55 }];
  s3.addRow(['Row', 'Original text', 'Became', 'What was done']); head(s3);
  notes.forEach((n) => s3.addRow(n));
  await out.xlsx.writeFile(path.join(root, 'data', 'ACEIT-companies-cleaned.xlsx'));

  console.log(`rows read: ${raw.length}`);
  console.log(`clean companies: ${cleaned.length}   merged groups: ${merged.length}   spellings reserved: ${rows.length}`);
  console.log(`cells fixed or changed: ${notes.length}`);
  console.log('--- merged groups ---');
  merged.forEach((m) => console.log(`${m.kept.padEnd(34)} <= ${m.variants.join(' | ')}`));
  console.log('--- fixed / dropped ---');
  notes.forEach((n) => console.log(n.join('  ->  ')));
})();
