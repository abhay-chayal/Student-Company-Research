const { evaluate } = require('../lib/evaluate');
const { send, readBody } = require('../lib/http');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  try {
    const result = await evaluate(readBody(req));
    send(res, 200, { student: result.student, companies: result.companies });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'Could not check right now. Please try again.' });
  }
};
