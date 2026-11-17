const { send, safeEqual } = require('../lib/http');

// Daily publishing is switched off: all companies are published together (see the admin page). The cron entry was removed
// from vercel.json. This address stays only so that an old schedule gets a clear answer and does nothing.
module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const given = String((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '');
  if (!secret || !safeEqual(given, secret)) return send(res, 401, { error: 'Not allowed.' });
  return send(res, 200, { ok: false, off: true, message: 'Daily publishing is switched off.' });
};
