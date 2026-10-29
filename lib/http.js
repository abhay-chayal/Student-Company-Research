const crypto = require('crypto');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (err) { return {}; }
  }
  return {};
}

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function isAdmin(req) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return safeEqual(req.headers['x-admin-password'] || '', expected);
}

// The mentors share one login, separate from the admin password (set MENTOR_PASSWORD).
function isMentor(req) {
  const expected = process.env.MENTOR_PASSWORD;
  if (!expected) return false;
  return safeEqual(req.headers['x-mentor-password'] || '', expected);
}

module.exports = { send, readBody, isAdmin, isMentor };
