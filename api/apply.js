const { send, readBody } = require('../lib/http');
const { getDb } = require('../lib/db');
const { rollNumber, emailAddress } = require('../lib/normalize');
const { branchOf } = require('../lib/rollout');
const { domainGroup, isTechRelevant, GENERAL, OTHER } = require('../lib/domaingroups');
const { publishAll } = require('../lib/applybatch');

// The "apply" page. Every published company is on it at once, grouped by domain. Only CS, IT and AI & DS students can log in.
//   POST action=companies  all published companies and the domain tiles (needs the roll number and email)
//   POST action=status     who the student is and what they already did
//   POST action=click      a student opened a link of a company
//   POST action=respond    applied | could_not (with a reason) | not_interested. A click must come first.
// No email address is ever sent to a student: only web links are kept, and a company with no link left is left out.
const MESSAGES = {
  identity: 'The roll number and email do not match. Use the email you entered in the form.',
  branch: 'This page is for CS, IT and AI & DS students.',
  click_first: 'Open the link of this company first, then tell us what happened.',
  missing: 'This company is not on the list.',
  link: 'Unknown link.',
  response: 'Choose one of the three options.',
  reason: 'Tell us why you could not apply.',
};

const webLink = (v) => (/^https?:\/\/\S+$/i.test(String(v || '').trim()) ? String(v).trim() : '');

/** The version of a company a student may see: web links only, no roll key. null when no link is left. */
function publicView(c) {
  const { roll_key, ...rest } = c; // the roll key is internal
  // companies of other branches (EC, EE, ME ...) are listed only when the role is one a CS, IT or AI & DS student can apply to
  if (!['CS', 'IT', 'AD'].includes(branchOf(roll_key)) && !isTechRelevant(c.domain)) return null;
  const domain_link = webLink(c.domain_link), general_link = webLink(c.general_link);
  if (!domain_link && !general_link) return null;
  return { ...rest, domain_link, general_link, group: domainGroup(c.domain) };
}

module.exports = async (req, res) => {
  const db = getDb();
  const action = (req.query && req.query.action) || '';
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    const body = readBody(req);
    if (body.hp) return send(res, 200, { ok: true });
    const roll = rollNumber(body.roll);
    const email = emailAddress(body.email);
    if (roll.error || email.error) return send(res, 400, { error: 'Enter your roll number and the email you used in the form.' });
    if (!['CS', 'IT', 'AD'].includes(branchOf(roll.value))) return send(res, 403, { error: MESSAGES.branch, code: 'branch' });

    if (action === 'status') {
      const st = await db.applyStatus(roll.value, email.value);
      if (!st) return send(res, 401, { error: MESSAGES.identity });
      const student = await db.getStudentForFix(roll.value, email.value);
      return send(res, 200, { name: student ? student.name : '', ...st });
    }

    if (action === 'companies') {
      const st = await db.applyStatus(roll.value, email.value);
      if (!st) return send(res, 401, { error: MESSAGES.identity });
      // every company of the CS, IT and AI & DS students is always listed: whatever is not published yet is published now (a no-op when nothing is new)
      try { await publishAll(db, { source: 'auto' }); } catch (e) { console.error('publishAll failed (is apply_publish_all in the database?)', e.message); }
      const seen = new Set(), companies = [];
      for (const b of await db.applyBatches(400)) {
        for (const c of b.companies) {
          if (seen.has(c.company_id)) continue;
          seen.add(c.company_id);
          const v = publicView(c);
          if (v) companies.push(v);
        }
      }
      companies.sort((a, b) => String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase()) || a.company_id - b.company_id);
      const count = new Map();
      for (const c of companies) count.set(c.group, (count.get(c.group) || 0) + 1);
      // General first, "Other roles" last, the rest by size
      const rank = (n) => (n === GENERAL ? 0 : n === OTHER ? 2 : 1);
      const tiles = [...count.entries()].map(([name, n]) => ({ name, count: n }))
        .sort((a, b) => rank(a.name) - rank(b.name) || b.count - a.count || a.name.localeCompare(b.name));
      return send(res, 200, { tiles, total: companies.length, companies });
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
