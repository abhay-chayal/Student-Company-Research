const { getDb } = require('../lib/db');
const { send } = require('../lib/http');

// Typeahead: lists already-taken companies that match what the student is typing.
module.exports = async (req, res) => {
  try {
    const q = String((req.query && req.query.q) || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 40);
    if (q.length < 2) return send(res, 200, { taken: [] });
    const rows = await getDb().suggest(q);
    rows.sort((a, b) => Number(b.prefix) - Number(a.prefix) || a.name.localeCompare(b.name));
    send(res, 200, { taken: rows.slice(0, 8).map((r) => r.name) });
  } catch (err) {
    console.error(err);
    send(res, 200, { taken: [] });
  }
};
