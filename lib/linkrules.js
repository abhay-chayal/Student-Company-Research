// Reads a web address (no network) and says what kind of page it points at:
//   posting   one specific job        careers   a general careers or programme page
//   homepage  the company home page   listing   a list or search of jobs
//   search    social, search, news    invalid   not a usable address     other  unclear
// Shared by the student forms and by the review scripts (scripts/check-links.js).
const LOCALE = /^\/(?:[a-z]{2}(?:[-_][a-z]{2})?|global|intl|us|in|emea|apac)(?=\/)/i;
const CAREERS_WORDS = '(?:careers?|jobs?|join(?:-us)?|join-our-team|work-(?:with|for)-us|opportunit(?:y|ies)|openings?|current-openings|job-openings|open-(?:positions|roles)|vacanc(?:y|ies)|career-opportunities|early-careers?|campus(?:-hiring|-recruitment)?|freshers?|graduates?|students?|internships?|university|life-at-\\w+|hiring|recruitment|talent|search(?:-?jobs)?|job-?search|careers?-?home|find-a-job|apply)';
const GENERIC_PATH = new RegExp(`^(?:/(?:about|company|about-us|who-we-are|people|join|work|careers?|jobs?))?/(?:${CAREERS_WORDS})(?:/(?:${CAREERS_WORDS}))*(?:/index)?(?:\\.(?:html?|php|aspx?|jsp))?$`, 'i');
const POSTING_HINTS = [
  /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, /\/job-listings?-/i,
  /\/job-?view\//i, /\/job-?details?\b/i, /\/jobdescription/i, /\/job\/[^/]+/i, /\/jobs?\/(?:view\/)?[\w-]*\d{4,}/i,
  /\/jobs?\/[0-9a-f]{8}-[0-9a-f]{4}-/i, /\/positions?\/[\w-]*\d{3,}/i, /\/openings?\/[\w-]{4,}/i,
  /\/requisition/i, /\/vacanc(?:y|ies)\/[\w-]{4,}/i, /\/apply\/[\w-]{4,}/i, /[_/-]R-?\d{4,}/, /\bJR\d{5,}/i, /\/(?:SR|REQ|JOB)[-_]?\d{3,}/i,
  /\/careers?\/[\w-]*(?:engineer|developer|analyst|intern|trainee|scientist|associate|programmer|architect|consultant|designer|specialist|executive|manager)[\w-]*/i,
  /\/jobs?\/[\w-]*(?:engineer|developer|analyst|intern|trainee|scientist|associate|programmer|architect|consultant|designer|specialist|executive|manager)[\w-]*/i,
  /\/[\w-]*(?:engineer|developer|analyst|intern|trainee|scientist|associate|programmer|fresher)[\w-]*(?:\.(?:html?|php|aspx?))?\/?$/i,
];
const POSTING_QUERY = /[?&](?:[\w]*(?:jobid|job_id|jobseqno|jobno|jobcode|jobreqid|reqid|req_id|requisition\w*|opening\w*|positionid|gh_jid|jid|vacancyid)|id|job)=[\w-]*\d[\w-]*/i;
const POSTING_HASH = /#!?\/?(?:job-?view|job-?details?|jobs?\/|position\/|openings?\/)/i;
// News and repost sites are not the company's own hiring page.
const NEWS_SITES = /(?:^|\.)(?:freshersdunia\.in|freshersworld\.com|offcampusjobs4u\.com|jobsnet\.in|jobgrid\.in|enggwave\.com|freshershunt\.in|fresherjobsindia\.com|thejobcompany\.co\.in|fresherflow\.in|onlinestudy4u\.in|techprogrammind\.com|fresherjobinfo\.in|hexerhire\.in|job4freshers\.co\.in|tnpofficer\.com|jobsora\.com|cloudsoftsol\.com|prepnplaced\.com|foundthejob\.com|jobhunter\.in)$/i;
const SEARCH_HOSTS = [
  [NEWS_SITES, () => "A job-news or repost website, not the company's own page"],
  [/(^|\.)linkedin\.com$/, (u) => (/^\/(?:posts|feed|pulse)\//.test(u.pathname) || /^\/company\//.test(u.pathname) ||/^\/jobs\/search/.test(u.pathname) || /^\/school\//.test(u.pathname) || /^\/in\//.test(u.pathname) || /^\/jobs\/?$/.test(u.pathname)) ? 'LinkedIn company, profile or search page' : null],
  [/(^|\.)google\.[a-z.]+$/, (u) => (/^\/search/.test(u.pathname) || u.hostname.startsWith('www.')) && !/careers/.test(u.pathname) ? 'Google search page' : null],
  [/(^|\.)(bing|duckduckgo|yahoo)\.com$/, () => 'Search engine page'],
  [/(^|\.)naukri\.com$/, (u) => (/-jobs(-in-|-for-|$|\?)/.test(u.pathname) || /\/jobs-in-/.test(u.pathname)) ? 'Naukri search page' : null],
  [/(^|\.)indeed\.com$/, (u) => (/^\/(q-|jobs|cmp\/)/.test(u.pathname) && !/viewjob/.test(u.pathname)) ? 'Indeed search or company page' : null],
  [/(^|\.)glassdoor\.[a-z.]+$/, (u) => !/job-listing/.test(u.pathname) ? 'Glassdoor company or search page' : null],
  [/(^|\.)(facebook|instagram|twitter|x|youtube)\.com$/, () => 'Social media page'],
  [/(^|\.)(wikipedia|crunchbase|ambitionbox|zaubacorp)\.[a-z.]+$/, () => 'Information site, not a hiring page'],
];

function readAddress(raw) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch (e) { return { kind: 'invalid', reason: 'Not a valid web address' }; }
  for (const [re, f] of SEARCH_HOSTS) if (re.test(u.hostname)) { const why = f(u); if (why) return { kind: 'search', reason: why }; }
  const hash = u.hash || '';
  let p = decodeURIComponent(u.pathname || '/').replace(/\/+$/, '');
  const hasPostingHash = POSTING_HASH.test(hash);
  const hasQuery = u.search && u.search.length > 1;
  if ((p === '' || p === '/') && !hasPostingHash && !POSTING_QUERY.test(u.search || '')) {
    // A careers site's own front page is a careers page, not the company home page.
    if (/^(?:www\.)?(?:careers?|jobs?|work|hiring|talent|join|apply|recruit\w*)[.-]/i.test(u.hostname) || /\.(?:careers|jobs)$/i.test(u.hostname)) {
      return { kind: 'careers', reason: 'General careers page (front page of the careers site)' };
    }
    return { kind: 'homepage', reason: hasQuery || hash.length > 1 ? 'Company home page' : 'Company home page, no job in the address' };
  }
  const stripped = p.replace(LOCALE, '') || '/';
  if (!hasPostingHash && !POSTING_QUERY.test(u.search || '') && GENERIC_PATH.test(stripped)) {
    return { kind: 'careers', reason: 'General careers page, no specific job in the address' };
  }
  // Lists and searches of jobs come before the "looks like a job" rules, which a list address can also match.
  const segs0 = stripped.split('/').filter(Boolean);
  const LIST_PATH = /(?:^|\/)job-?search(?:\/|$)|\/jobs\/search|(?:^|[\/-])jobs?-(?:in|at|for)-[\w-]+\/?$|[\w-]+-jobs(?:-in-[\w-]+)?\/?$/i;
  if (!hasPostingHash && LIST_PATH.test(p) && !/[?&](?:gh_jid|jobid)=/i.test(u.search || '')) return { kind: 'listing', reason: 'Search or list of jobs, not one job' };
  if (/myworkdayjobs\.com$/i.test(u.hostname) && !/\/job\//i.test(p) && segs0.filter((s) => !/^[a-z]{2}-[a-z]{2}$/i.test(s)).length <= 1) return { kind: 'listing', reason: 'A company job list on Workday, not one job' };
  if (/darwinbox\.in$/i.test(u.hostname) && /candidatev2\/main\/?(?:careers\/alljobs)?\/?$/i.test(p)) return { kind: 'listing', reason: 'A company job list, not one job' };
  if (/(?:^|\.)(?:jobs\.lever\.co|boards\.greenhouse\.io|job-boards\.greenhouse\.io|apply\.workable\.com|jobs\.ashbyhq\.com|careers\.smartrecruiters\.com|jobs\.smartrecruiters\.com)$/i.test(u.hostname) && segs0.length <= 1) return { kind: 'listing', reason: 'A company job list, not one job' };
  if (hasPostingHash || POSTING_QUERY.test(u.search || '') || POSTING_HINTS.some((re) => re.test(p + (u.search || '')))) {
    return { kind: 'posting', reason: 'Address points at a specific job' };
  }
  if (/job-?search|search-?results|jobs\/search|\/search\b|\/listing/i.test(p) || /[?&](?:q|query|keyword|keywords|search)=/i.test(u.search || '') && !/[?&](?:gh_jid|jobid)/i.test(u.search || '')) {
    return { kind: 'listing', reason: 'Search or list of jobs, not one job' };
  }
  const segs = stripped.split('/').filter(Boolean);
  if (segs.length <= 1 && /career|job|hiring/i.test(stripped)) return { kind: 'careers', reason: 'General careers page, no specific job in the address' };
  return { kind: 'other', reason: 'Address does not clearly show a job' };
}


// ---------- policy: what the form accepts ----------

// Pages about the company, not about a job.
const NON_HIRING_PATH = /(?:^|\/)(?:contact(?:-us)?|about(?:-us)?|services?|products?|solutions?|blog|news|press|pricing|faq|privacy|terms|support|docs|platform|industries|case-studies|portfolio|team|leadership|investors|partners|login|signin|signup|register)(?:\/|\.|$)/i;

const MESSAGES = {
  homepage: "This is the company's home page. Paste the link of the specific job you are targeting.",
  careers: "This is the company's general careers page. Open the job you want and paste that job's own link.",
  listing: "This is a list or search of jobs. Open the job you want and paste that job's own link.",
  search: "This is a social, search or news page. Paste the job's own link from the company site or a job site.",
  invalid: 'Enter a valid link.',
  notHiring: 'This page does not look like a job. Paste the link of the specific job you are targeting.',
};

/** Remove tracking parameters (utm_source=chatgpt.com and similar) so the saved link is clean. */
function stripTracking(value) {
  let u;
  try { u = new URL(value); } catch (e) { return value; }
  for (const key of [...u.searchParams.keys()]) {
    if (/^(utm_|mc_|trk|gclid$|fbclid$|msclkid$|igshid$|_hs)/i.test(key)) u.searchParams.delete(key);
  }
  return u.toString();
}

/** Catch copy-paste accidents: markdown brackets, two links stuck together. */
function pasteProblem(value) {
  if (/\]\(\s*https?:/i.test(value) || /^\s*\[[^\]]*\]\(/.test(value)) return 'Paste only the link, without brackets or extra text.';
  const count = (value.match(/https?:\/\//gi) || []).length;
  if (count > 1) return 'Two links were pasted together. Paste just one link.';
  return null;
}

/**
 * Is this link acceptable as "where to apply"?
 * allowCareers: a general careers or campus page is fine (companies that hire freshers without a specific role).
 */
function judgeLink(value, { allowCareers = false } = {}) {
  const a = readAddress(value);
  if (a.kind === 'posting') return { ok: true, kind: a.kind };
  if (a.kind === 'careers' && allowCareers) return { ok: true, kind: a.kind };
  if (a.kind === 'other') {
    let path = '';
    try { path = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value).pathname; } catch (e) { /* keep empty */ }
    if (NON_HIRING_PATH.test(path)) return { ok: false, kind: 'notHiring', message: MESSAGES.notHiring };
    return { ok: true, kind: a.kind }; // unclear from the address alone; the live check looks at the page
  }
  return { ok: false, kind: a.kind, message: MESSAGES[a.kind] || MESSAGES.notHiring };
}

module.exports = { readAddress, judgeLink, stripTracking, pasteProblem, MESSAGES };
