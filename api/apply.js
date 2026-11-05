const { send, readBody } = require('../lib/http');
const { getDb } = require('../lib/db');
const { rollNumber, emailAddress } = require('../lib/normalize');
const { todayIST } = require('../lib/rollout');

// The daily "apply" page.
//   GET  ?action=batches   the published days and their companies (public; no email, revenue, package or review status)
//   POST action=status     who the student is (roll number + email) and what they already did
//   POST action=click      a student opened a link of a company
//   POST action=respond    applied | could_not (with a reason) | not_interested. A click must come first.
const MESSAGES = {
  identity: 'The roll number and email do not match. Use the email you entered in the form.',
  click_first: 'Open the link of this company first, then tell us what happened.',
  missing: 'This company is not on the list.',
  link: 'Unknown link.',
  response: 'Choose one of the three options.',
  reason: 'Tell us why you could not apply.',
};

module.exports = async (req, res) => {
  const db = getDb();
  const action = (req.query && req.query.action) || 'batches';
  try {
    if (action === 'batches') {
      const batches = await db.applyBatches(60);
      return send(res, 200, {
        today: todayIST(),
        batches: batches.map((b) => ({
          date: b.batch_date,
          companies: b.companies.map(({ roll_key, ...c }) => c), // the roll key is internal
        })),
      });
    }

    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    const body = readBody(req);
    if (body.hp) return send(res, 200, { ok: true });
    const roll = rollNumber(body.roll);
    const email = emailAddress(body.email);
    if (roll.error || email.error) return send(res, 400, { error: 'Enter your roll number and the email you used in the form.' });

    if (action === 'status') {
      const st = await db.applyStatus(roll.value, email.value);
      if (!st) return send(res, 401, { error: MESSAGES.identity });
      const student = await db.getStudentForFix(roll.value, email.value);
      return send(res, 200, { name: student ? student.name : '', ...st });
    }

    const companyId = Number(body.company_id);
    if (!Number.isInteger(companyId)) return send(res, 400, { ok: false, message: MESSAGES.missing });

    if (action === 'click') {
      const out = await db.applyClick({ rollKey: roll.value, email: email.value, companyId, linkKind: String(body.link || '') });
      if (out.ok) return send(res, 200, { ok: true });
      return send(res, out.code === 'identity' ? 401 : 400, { ok: false, message: MESSAGES[out.code] || 'Could not save.' });
    }

    if (action === 'respond') {
      const out = await db.applyRespond({ rollKey: roll.value, email: email.value, companyId, response: String(body.response || ''), reason: String(body.reason || ''), note: String(body.note || '') });
      if (out.ok) return send(res, 200, { ok: true });
      return send(res, out.code === 'identity' ? 401 : 400, { ok: false, code: out.code, message: MESSAGES[out.code] || 'Could not save.' });
    }

    return send(res, 400, { error: 'Unknown action.' });
  } catch (err) {
    console.error(err);
    return send(res, 500, { ok: false, message: 'Could not save right now. Please try again.' });
  }
};
