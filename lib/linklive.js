// Opens a link the student pasted and says whether it leads to a live job page.
// It only rejects on clear evidence (page not found, "no longer accepting", redirected to a
// general page). Anything unclear (a blocked site, a timeout, a server error) is let through,
// because many real career sites block automated visits.
const { readAddress, MESSAGES } = require('./linkrules');

const cache = new Map(); // url -> { result, at }
const TTL_MS = 10 * 60 * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CLOSED = /(no longer accepting|no longer available|not accepting applications|position (?:has been )?(?:filled|closed)|this (?:job|position|role|posting) (?:has )?(?:expired|been filled|been closed|closed)|applications? (?:are |is )?closed|job (?:posting )?(?:is )?(?:closed|expired)|job not found|hiring for this position has been put on hold)/i;
const HIRING_WORDS = /career|job|apply|hiring|opening|position|vacanc|intern|recruit|join|engineer|developer|analyst|trainee|scientist|associate|manager|executive|consultant|designer|architect|programmer|specialist/i;

function strip(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;|&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
}

async function look(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'text/html,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' } });
    const type = res.headers.get('content-type') || '';
    const body = /html|text/i.test(type) ? (await res.text()).slice(0, 250000) : '';
    const title = ((body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
    const h1 = strip((body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
    return { status: res.status, finalUrl: res.url, title, h1, text: strip(body).slice(0, 2500) };
  } catch (err) {
    return { error: err.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

async function judge(url) {
  const addr = readAddress(url);
  const page = await look(url);
  if (page.error) return { ok: true, unchecked: true };
  if (page.status === 404 || page.status === 410) return { ok: false, message: 'This link does not open (page not found). Paste a link to a job that is open now.' };
  if (page.status >= 400) return { ok: true, unchecked: true }; // blocked or erroring: cannot tell
  const finalKind = readAddress(page.finalUrl).kind;
  if (addr.kind === 'posting' && (finalKind === 'homepage' || finalKind === 'careers')) {
    return { ok: false, message: 'This job link redirects to a general page, so the job is probably closed. Paste a link to a job that is open now.' };
  }
  if (addr.kind === 'posting' && CLOSED.test(`${page.title} ${page.h1} ${page.text}`)) {
    return { ok: false, message: 'This job looks closed. Paste a link to a job that is open now.' };
  }
  if (addr.kind === 'other' && page.text.length > 200 && !HIRING_WORDS.test(`${page.title} ${page.h1}`)) {
    return { ok: false, message: MESSAGES.notHiring };
  }
  return { ok: true };
}

/** Cached, fail-open check of one link. Set SKIP_LINK_LIVE=1 to turn it off (tests, offline work). */
async function liveCheck(url) {
  if (process.env.SKIP_LINK_LIVE === '1') return { ok: true, unchecked: true };
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.result;
  let result;
  try { result = await judge(url); } catch (e) { result = { ok: true, unchecked: true }; }
  cache.set(url, { result, at: Date.now() });
  return result;
}

module.exports = { liveCheck };
