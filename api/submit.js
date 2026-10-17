const { evaluate, hasErrors } = require('../lib/evaluate');
const { getDb } = require('../lib/db');
const { send, readBody } = require('../lib/http');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  try {
    const body = readBody(req);

    // Hidden trap field: real people never fill it, bots do.
    if (body.hp) return send(res, 200, { ok: true });

    if (process.env.CLOSE_AT && Date.now() > Date.parse(process.env.CLOSE_AT)) {
      return send(res, 403, { ok: false, message: 'Submissions are closed.' });
    }

    const result = await evaluate(body, { requireAll: true });
    if (hasErrors(result)) {
      return send(res, 400, { ok: false, student: result.student, companies: result.companies });
    }

    const { rollNo, rollKey, name, email, companies } = result.clean;
    const outcome = await getDb().submit({ rollNo, rollKey, name, email, companies });

    if (outcome.ok) return send(res, 200, { ok: true });
    if (outcome.roll) {
      result.student.roll = 'This roll number has already submitted its companies.';
      return send(res, 409, { ok: false, student: result.student, companies: result.companies });
    }
    if (outcome.conflicts) {
      for (const c of outcome.conflicts) {
        const row = result.companies[c.position - 1];
        if (c.field === 'name') row.name = `"${c.taken}" is already taken.`;
        else row.website = `This website belongs to "${c.taken}", which is already taken.`;
      }
      return send(res, 409, { ok: false, student: result.student, companies: result.companies });
    }
    return send(res, 409, { ok: false, message: 'Someone just took one of these companies. Please check again and resubmit.' });
  } catch (err) {
    console.error(err);
    send(res, 500, { ok: false, message: 'Could not save right now. Please try again.' });
  }
};
