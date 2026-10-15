const ExcelJS = require('exceljs');
const { getDb } = require('../lib/db');
const { send, readBody, isAdmin } = require('../lib/http');

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
  'S.No', 'Student Name', 'RTU Roll No', 'Company', 'Website', 'Domain',
  'Domain-specific Link / Email', 'General Fresher Hiring Link / Email',
];

/** One row per company. The student columns repeat on all of a student's rows (no merged cells). */
function companyRows(students) {
  const rows = [];
  students.forEach((s, idx) => {
    s.companies.forEach((c) => {
      rows.push({
        student: idx,
        cells: [idx + 1, s.name, s.roll_no, c.name, c.website, c.domain || '', c.domain_link || '', c.general_link || ''],
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
        students: students.map((s) => ({
          roll_no: s.roll_no,
          name: s.name,
          created_at: s.created_at,
          companies: s.companies.map((c) => ({
            name: c.name,
            website: c.website,
            domain: c.domain,
            domain_link: c.domain_link,
            general_link: c.general_link,
          })),
        })),
        similar: similarPairs(students),
      });
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
      sheet.columns = [8, 24, 18, 28, 26, 26, 42, 42].map((width) => ({ width }));
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
          if (col === 7 || col === 8) {
            const raw = r.cells[col - 1];
            const link = hyperlinkFor(raw);
            if (link) {
              cell.value = { text: raw, hyperlink: link };
              cell.font = { color: { argb: 'FF1D4ED8' }, underline: true };
            }
          }
        });
      });
      sheet.autoFilter = { from: 'A1', to: 'H1' };

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
