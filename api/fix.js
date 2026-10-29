const { send, readBody } = require('../lib/http');
const { getDb } = require('../lib/db');
const { rollNumber, emailAddress } = require('../lib/normalize');
const { evaluateFix, editableParts, hasErrors } = require('../lib/fix');
const { isComplete, STRENGTH, UNITS, CURRENCIES } = require('../lib/extras');

// "Fix my companies". The student proves who they are with the roll number and the email they
// used in the form. Actions: lookup (list my companies), check (live feedback), save (links, and the three
// details if typed) and details (only the three details: employee strength, fresher package, revenue).
module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  try {
    const body = readBody(req);
    if (body.hp) return send(res, 200, { ok: true });
    if (process.env.FIX_CLOSE_AT && Date.now() > Date.parse(process.env.FIX_CLOSE_AT)) {
      return send(res, 403, { error: 'Corrections are closed.' });
    }

    const roll = rollNumber(body.roll);
    const email = emailAddress(body.email);
    if (roll.error || email.error) return send(res, 400, { error: 'Enter your roll number and the email you used in the form.' });

    const db = getDb();
    const student = await db.getStudentForFix(roll.value, email.value);
    if (!student) return send(res, 401, { error: 'The roll number and email do not match. Use the email you entered in the form.' });

    const action = body.action || 'lookup';
    if (action === 'lookup') {
      return send(res, 200, {
        name: student.name,
        options: { strength: STRENGTH, units: UNITS, currencies: CURRENCIES },
        companies: student.companies.map((c) => ({ ...c, editable: editableParts(c), details_complete: isComplete(c) })),
      });
    }
    if (action !== 'check' && action !== 'save' && action !== 'details') return send(res, 400, { error: 'Unknown action.' });

    const input = { ...(body.company || {}) };
    if (action === 'details') input.detailsOnly = true;
    const result = await evaluateFix(student, input);
    if (result.fatal === 'locked') return send(res, 409, { ok: false, message: 'This company is accepted and cannot be changed.' });
    if (result.fatal) return send(res, 404, { ok: false, message: 'Company not found.' });
    if (action === 'check' || hasErrors(result.errors)) {
      return send(res, action === 'check' ? 200 : 400, { ok: !hasErrors(result.errors), errors: result.errors, warnings: result.warnings });
    }

    if (result.detailsOnly) {
      const saved = await db.saveDetails({ rollKey: roll.value, email: email.value, position: result.company.position, extras: result.extras });
      if (saved.ok) return send(res, 200, { ok: true });
      if (saved.code === 'identity') return send(res, 401, { error: 'The roll number and email do not match.' });
      return send(res, 404, { ok: false, message: 'Company not found.' });
    }

    const outcome = await db.fixCompany({ rollKey: roll.value, email: email.value, position: result.company.position, ...result.clean, extras: result.extras || undefined });
    if (outcome.ok) return send(res, 200, { ok: true });
    if (outcome.code === 'conflict') {
      const errors = { name: null, website: null, domain: null, other: null, dlink: null, glink: null };
      for (const c of outcome.conflicts) errors[c.field] = c.field === 'name' ? `"${c.taken}" is already taken.` : `This website belongs to "${c.taken}", which is already taken.`;
      return send(res, 409, { ok: false, errors });
    }
    if (outcome.code === 'locked') return send(res, 409, { ok: false, message: 'This company is accepted and cannot be changed.' });
    if (outcome.code === 'identity') return send(res, 401, { error: 'The roll number and email do not match.' });
    return send(res, 409, { ok: false, message: 'Someone just took that name or website. Please check and save again.' });
  } catch (err) {
    console.error(err);
    send(res, 500, { ok: false, message: 'Could not save right now. Please try again.' });
  }
};
