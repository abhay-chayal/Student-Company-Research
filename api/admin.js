const ExcelJS = require('exceljs');
const { getDb } = require('../lib/db');
const { send, readBody, isAdmin } = require('../lib/http');

function toIst(iso) {
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
}

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

function studentRows(students) {
  const header = ['S.No', 'Roll No', 'Name'];
  for (let i = 1; i <= 5; i++) header.push('Company ' + i, 'Website ' + i);
  header.push('Submitted (IST)');
  const rows = students.map((s, idx) => {
    const row = [idx + 1, s.roll_no, s.name];
    for (let i = 0; i < 5; i++) {
      const c = s.companies[i];
      row.push(c ? c.name : '', c ? c.website : '');
    }
    row.push(toIst(s.created_at));
    return row;
  });
  return { header, rows };
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
          companies: s.companies.map((c) => ({ name: c.name, website: c.website })),
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
      const { header, rows } = studentRows(await db.listAll());
      const text = '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="company-registry.csv"');
      return res.end(text);
    }

    if (action === 'xlsx') {
      const students = await db.listAll();
      const { header, rows } = studentRows(students);
      const book = new ExcelJS.Workbook();

      const sheet = book.addWorksheet('Students');
      sheet.addRow(header).font = { bold: true };
      rows.forEach((r) => sheet.addRow(r.map((v) => (typeof v === 'string' ? defuse(v) : v))));
      sheet.columns.forEach((col, i) => { col.width = i < 3 ? 18 : 24; });
      sheet.views = [{ state: 'frozen', ySplit: 1 }];

      const flat = book.addWorksheet('All companies');
      flat.addRow(['Company', 'Website', 'Student', 'Roll No']).font = { bold: true };
      students
        .flatMap((s) => s.companies.map((c) => [c.name, c.website, s.name, s.roll_no]))
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach((r) => flat.addRow(r.map(defuse)));
      flat.columns.forEach((col) => { col.width = 28; });
      flat.views = [{ state: 'frozen', ySplit: 1 }];

      const buffer = await book.xlsx.writeBuffer();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="company-registry.xlsx"');
      return res.end(Buffer.from(buffer));
    }

    return send(res, 400, { error: 'Unknown action.' });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: 'Something went wrong.' });
  }
};
