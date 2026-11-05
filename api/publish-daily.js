const { send, safeEqual } = require('../lib/http');
const { getDb } = require('../lib/db');
const { publishNext } = require('../lib/applybatch');

// Runs every morning (see "crons" in vercel.json) and publishes the next five students for the day.
// Vercel sends "Authorization: Bearer <CRON_SECRET>" when the CRON_SECRET setting exists. Nobody else can run it.
module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const given = String((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '');
  if (!secret || !safeEqual(given, secret)) return send(res, 401, { error: 'Not allowed.' });
  try {
    const out = await publishNext(getDb(), { source: 'auto' });
    return send(res, 200, out);
  } catch (err) {
    console.error(err);
    return send(res, 500, { ok: false, message: 'Could not publish.' });
  }
};
