// Run the app on your own computer: npm run dev  ->  http://localhost:3000
// Without Supabase keys it uses temporary in-memory storage (lost on restart).
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon' };

const routes = {
  '/api/check': require('../api/check'),
  '/api/suggest': require('../api/suggest'),
  '/api/config': require('../api/config'),
  '/api/submit': require('../api/submit'),
  '/api/fix': require('../api/fix'),
  '/api/admin': require('../api/admin'),
  '/api/mentor': require('../api/mentor'),
};

http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const handler = routes[parsed.pathname];
  if (handler) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      req.query = parsed.query;
      const raw = Buffer.concat(chunks).toString();
      try { req.body = raw ? JSON.parse(raw) : {}; } catch (e) { req.body = {}; }
      handler(req, res);
    });
    return;
  }
  let file = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  if (file === '/admin') file = '/admin.html';
  if (file === '/fix') file = '/fix.html';
  if (file === '/mentor') file = '/mentor.html';
  const full = path.join(ROOT, 'public', path.normalize(file));
  if (!full.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  res.setHeader('Content-Type', TYPES[path.extname(full)] || 'application/octet-stream');
  fs.createReadStream(full).pipe(res);
}).listen(PORT, () => {
  console.log('Running at http://localhost:' + PORT + '  (admin: /admin)');
  if (process.env.DEV_SEED) require('./dev-seed').seed().catch((e) => console.error(e.message));
});
