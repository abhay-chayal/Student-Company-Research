const { getDb } = require('../lib/db');
const { send, readBody, isMentor } = require('../lib/http');
const { rollNumber } = require('../lib/normalize');
const { isComplete } = require('../lib/extras');

// The mentor panel. One shared mentor login (MENTOR_PASSWORD), separate from the admin password.
// A mentor sees roll numbers and company data only: never a student's name or email.
// Actions: list (roll numbers by branch), student (one student's companies), decide, decide_all, log.
const BRANCHES = [['AD', 'AI & DS'], ['CS', 'CS'], ['IT', 'IT'], ['EC', 'Electronics'], ['EE', 'Electrical'], ['ME', 'Mechanical'], ['OT', 'Other']];

function branchOf(roll) {
  const m = /EAR([A-Z]{2})/.exec(String(roll || '').toUpperCase().replace(/[\s\-_/.]/g, ''));
  const code = m ? m[1] : '';
  return BRANCHES.some((b) => b[0] === code && code !== 'OT') ? code : 'OT';
}
const natural = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const MESSAGES = {
  decision: 'Choose approve or not approve.',
  mentor: 'Enter your name first (at least 2 letters).',
  note: 'Write a short reason for the student (at least 3 characters).',
  details: 'The three company details are not filled yet, so this company cannot be approved. Choose not approve and say so.',
  missing: 'That student or company was not found.',
};

module.exports = async (req, res) => {
  if (!isMentor(req)) {
    await wait(400); // slows down anyone guessing the password
    return send(res, 401, { error: 'Wrong password.' });
  }
  const db = getDb();
  const action = (req.query && req.query.action) || 'list';
  try {
    if (action === 'list') {
      const rows = await db.mentorList();
      const students = rows.map((s) => ({
        roll_no: s.roll_no,
        branch: branchOf(s.roll_no),
        count: s.companies.length,
        approved: s.companies.filter((c) => c.mentor_decision === 'approved').length,
        not_approved: s.companies.filter((c) => c.mentor_decision === 'not_approved').length,
        unchecked: s.companies.filter((c) => !c.mentor_decision).length,
      })).sort((a, b) => natural(a.roll_no, b.roll_no));
      return send(res, 200, { branches: BRANCHES.map(([code, label]) => ({ code, label })), students });
    }

    if (action === 'student') {
      const roll = rollNumber(req.query && req.query.roll);
      if (roll.error) return send(res, 400, { error: 'Enter a roll number.' });
      const s = await db.mentorStudent(roll.value);
      if (!s) return send(res, 404, { error: MESSAGES.missing });
      return send(res, 200, { roll_no: s.roll_no, branch: branchOf(s.roll_no), companies: s.companies.map((c) => ({ ...c, details_complete: isComplete(c) })) });
    }

    if (action === 'log') return send(res, 200, { log: (await db.mentorLog()).slice(0, 300) });

    if ((action === 'decide' || action === 'decide_all') && req.method === 'POST') {
      const body = readBody(req);
      const roll = rollNumber(body.roll);
      if (roll.error) return send(res, 400, { ok: false, message: 'Enter a roll number.' });
      const base = { rollKey: roll.value, mentor: body.mentor, note: body.note };

      if (action === 'decide') {
        const out = await db.mentorDecide({ ...base, position: Number(body.position), decision: body.decision });
        if (out.ok) return send(res, 200, { ok: true });
        return send(res, out.code === 'missing' ? 404 : 400, { ok: false, code: out.code, message: MESSAGES[out.code] || 'Could not save.' });
      }

      // approve the companies nobody has decided yet and whose three details are filled;
      // a company a mentor already approved or rejected is left as it is
      const s = await db.mentorStudent(roll.value);
      if (!s) return send(res, 404, { ok: false, message: MESSAGES.missing });
      let approved = 0;
      const skipped = [];
      for (const c of s.companies) {
        if (c.mentor_decision) { skipped.push({ position: c.position, name: c.name, reason: 'already decided' }); continue; }
        const out = await db.mentorDecide({ ...base, position: c.position, decision: 'approved' });
        if (out.ok) approved++;
        else if (out.code === 'mentor') return send(res, 400, { ok: false, code: 'mentor', message: MESSAGES.mentor });
        else skipped.push({ position: c.position, name: c.name, reason: out.code === 'details' ? 'details not filled' : out.code });
      }
      return send(res, 200, { ok: true, approved, skipped });
    }

    return send(res, 400, { error: 'Unknown action.' });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: 'Something went wrong.' });
  }
};
