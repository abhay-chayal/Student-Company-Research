// Publishes the next window of five students (used by the daily job and by the admin page's button).
const { nextWindow, todayIST, WINDOW_SIZE, branchOf, BRANCH_LABEL } = require('./rollout');

/** The window that would be published next, without publishing it. */
async function previewNext(db) {
  const rolls = (await db.mentorList()).map((s) => s.roll_key);
  const published = new Set(await db.applyPublishedRolls());
  const w = nextWindow(rolls, published, WINDOW_SIZE);
  if (!w) return null;
  return { branch: w.branch, label: BRANCH_LABEL[w.branch] || w.branch, rolls: w.rolls };
}

/**
 * Publishes today's batch (or the given date). Safe to run twice: if the date already has a batch,
 * nothing changes and { existing: true } comes back.
 */
async function publishNext(db, { date = todayIST(), source = 'auto' } = {}) {
  const existing = (await db.applyBatches(400)).find((b) => b.batch_date === date);
  if (existing) return { ok: true, existing: true, date, branch: existing.branch, companies: existing.companies.length };
  const next = await previewNext(db);
  if (!next) return { ok: false, code: 'done', message: 'Every student of CS, IT and AI & DS has already been published.' };
  const out = await db.applyPublish({ date, branch: next.branch, rollKeys: next.rolls, source });
  return { ...out, date, branch: next.branch, rolls: next.rolls };
}

module.exports = { previewNext, publishNext, branchOf };
