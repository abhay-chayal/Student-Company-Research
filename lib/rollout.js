// Which five students are published each day.
// Branches go one after the other (CS, then IT, then AI & DS). Inside a branch the students are taken in
// roll-number order, five at a time, and a student is never published twice.
const BRANCH_ORDER = ['CS', 'IT', 'AD'];
const BRANCH_LABEL = { CS: 'CS', IT: 'IT', AD: 'AI & DS' };
const WINDOW_SIZE = 5;

const clean = (roll) => String(roll || '').toUpperCase().replace(/[\s\-_/.]/g, '');

function branchOf(roll) {
  const m = /EAR([A-Z]{2})/.exec(clean(roll));
  return m ? m[1] : '';
}
// 23EARCS005 -> 5, 223EARCS113 -> 113, a typo like 23EARADO50 -> 50
function numberOf(roll) {
  const m = /EAR[A-Z]{2}([A-Z0-9]*)$/.exec(clean(roll));
  const n = m ? parseInt(m[1].replace(/O/g, '0').replace(/[^0-9]/g, ''), 10) : NaN;
  return Number.isFinite(n) ? n : 0;
}
function yearPrefixOf(roll) {
  const m = /^(\d+)EAR/.exec(clean(roll));
  return m ? parseInt(m[1], 10) : 0;
}
function compareRolls(a, b) {
  return numberOf(a) - numberOf(b) || yearPrefixOf(a) - yearPrefixOf(b) || clean(a).localeCompare(clean(b));
}

/**
 * rolls: every submitted student's roll key. published: a Set of roll keys already published.
 * Returns { branch, rolls } for the next window, or null when everyone in the three branches is done.
 */
function nextWindow(rolls, published, size = WINDOW_SIZE, order = BRANCH_ORDER) {
  const done = published instanceof Set ? published : new Set(published || []);
  for (const branch of order) {
    const left = rolls.filter((r) => branchOf(r) === branch && !done.has(r)).sort(compareRolls);
    if (left.length) return { branch, rolls: left.slice(0, size) };
  }
  return null;
}

// Today's date in India (the site's day changes at midnight IST).
function todayIST(now = new Date()) {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

module.exports = { BRANCH_ORDER, BRANCH_LABEL, WINDOW_SIZE, branchOf, numberOf, compareRolls, nextWindow, todayIST };
