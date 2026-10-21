const { parse } = require('tldts');

// Words that mean nothing when comparing company names. Only removed from the END of a name.
const TRAILING_WORDS = new Set([
  'pvt', 'private', 'ltd', 'limited', 'inc', 'incorporated', 'llp', 'llc', 'corp',
  'corporation', 'co', 'company', 'plc', 'gmbh', 'technologies', 'technology',
  'solutions', 'india', 'group', 'holdings', 'global', 'international', 'enterprises',
]);

// Names/labels that are obviously not real companies.
const PLACEHOLDERS = new Set([
  'test', 'testing', 'abc', 'abcd', 'xyz', 'na', 'none', 'nil', 'null', 'company',
  'asdf', 'asdfgh', 'qwerty', 'demo', 'sample', 'example', 'dummy', 'unknown', 'xxx',
  'aaa', 'bbb', 'ccc', 'random', 'name', 'companyname', 'yourcompany',
]);

// Sites that are NOT a company's own website (many students would share them).
const BLOCKED_DOMAINS = new Set([
  'linkedin.com', 'naukri.com', 'indeed.com', 'glassdoor.com', 'glassdoor.co.in',
  'monster.com', 'foundit.in', 'shine.com', 'instahyre.com', 'wellfound.com',
  'angel.co', 'ambitionbox.com', 'crunchbase.com', 'wikipedia.org', 'youtube.com',
  'instagram.com', 'twitter.com', 'x.com', 't.me', 'whatsapp.com', 'github.io',
  'gitlab.io', 'netlify.app', 'vercel.app', 'herokuapp.com', 'blogspot.com',
  'wordpress.com', 'wixsite.com', 'weebly.com', 'medium.com', 'notion.site',
  'linktr.ee', 'canva.site', 'carrd.co', 'bit.ly', 'tinyurl.com', 'forms.gle',
  'google.co.in', 'bing.com', 'duckduckgo.com', 'quora.com', 'reddit.com',
  'internshala.com', 'unstop.com', 'apna.co', 'timesjobs.com', 'simplyhired.com',
  'ziprecruiter.com', 'careerbuilder.com', 'lever.co', 'greenhouse.io',
  'workday.com', 'myworkdayjobs.com', 'smartrecruiters.com', 'ycombinator.com',
]);
const BLOCKED_HOSTS = new Set([
  'sites.google.com', 'docs.google.com', 'drive.google.com', 'forms.google.com',
  'maps.google.com', 'play.google.com', 'www.google.com',
]);

function cleanText(value) {
  return String(value == null ? '' : value)
    .normalize('NFKC')
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripDiacritics(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '');
}

/** Reduce a company name to a comparison key. Returns { key } or { error }. */
function nameKey(raw) {
  const text = stripDiacritics(cleanText(raw));
  if (!text) return { error: 'Enter the company name.' };
  if (text.length < 2 || text.length > 80) return { error: 'Company name must be 2 to 80 characters.' };
  if (!/^[A-Za-z0-9 .,&'\-_()/+!@:#]+$/.test(text)) {
    return { error: 'Use English letters and numbers only in the company name.' };
  }

  let tokens = text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  if (tokens[0] === 'the' && tokens.length > 1) tokens.shift();
  while (tokens.length > 1 && TRAILING_WORDS.has(tokens[tokens.length - 1])) tokens.pop();

  const key = tokens.join('');
  if (key.length < 2 || !/[a-z]/.test(key)) return { error: 'Enter a real company name.' };
  if (/^(.)\1+$/.test(key) || PLACEHOLDERS.has(key)) return { error: 'Enter a real company name.' };
  return { key };
}

// Extra descriptive words that do not identify a company ("Daffodil Software" is "Daffodil").
// Used only for the "is this the same company?" comparison, never for the stored key.
const DESCRIPTIVE_WORDS = new Set([
  ...TRAILING_WORDS, 'software', 'softwares', 'systems', 'system', 'infotech', 'infosystems',
  'tech', 'labs', 'lab', 'services', 'service', 'consulting', 'consultancy', 'digital',
  'infra', 'infrastructure', 'networks', 'it',
]);

/** A looser key: like nameKey, but also drops trailing words such as Software, Systems, Services, IT. */
function coreKey(raw) {
  const text = stripDiacritics(cleanText(raw));
  const tokens = text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (tokens[0] === 'the' && tokens.length > 1) tokens.shift();
  while (tokens.length > 1 && DESCRIPTIVE_WORDS.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join('');
}

/** Reduce a website to the company part of its domain. Returns { key, host, domain } or { error }. */
function websiteKey(raw) {
  let text = cleanText(raw).toLowerCase();
  if (!text) return { error: 'Enter the company website.' };
  if (/\s/.test(text)) return { error: 'Enter a valid website, like wipro.com' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(text)) text = 'https://' + text;

  let url;
  try {
    url = new URL(text);
  } catch (err) {
    return { error: 'Enter a valid website, like wipro.com' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'Enter a valid website, like wipro.com' };
  }

  const host = url.hostname.replace(/\.$/, '');
  const parsed = parse(host);
  if (parsed.isIp || !parsed.domain || !parsed.isIcann || !parsed.domainWithoutSuffix) {
    return { error: 'Enter a valid website, like wipro.com' };
  }
  if (BLOCKED_DOMAINS.has(parsed.domain) || BLOCKED_HOSTS.has(host)) {
    return { error: 'Enter the company\'s OWN website, not LinkedIn, job portals or free site builders.' };
  }

  // amazon.com, amazon.in, amazon.co.uk and aws.amazon.com all become "amazon".
  const key = parsed.domainWithoutSuffix.replace(/[^a-z0-9]/g, '');
  if (key.length < 2 || PLACEHOLDERS.has(key)) return { error: 'Enter the real website of the company.' };
  return { key, host, domain: parsed.domain };
}

function personName(raw) {
  const text = stripDiacritics(cleanText(raw));
  if (!text) return { error: 'Enter your name.' };
  if (text.length < 2 || text.length > 60) return { error: 'Name must be 2 to 60 characters.' };
  if (!/^[A-Za-z][A-Za-z .'\-]*$/.test(text)) return { error: 'Use English letters only in your name.' };
  if ((text.match(/[A-Za-z]/g) || []).length < 2 || /^(.)\1+$/.test(text.replace(/[^A-Za-z]/g, '').toLowerCase())) {
    return { error: 'Enter your real name.' };
  }
  return { value: text };
}

function rollNumber(raw) {
  const text = cleanText(raw).toUpperCase().replace(/[\s\-_/.]/g, '');
  if (!text) return { error: 'Enter your roll number.' };
  if (!/^[A-Z0-9]{5,20}$/.test(text) || !/[0-9]/.test(text)) {
    return { error: 'Enter a valid roll number (letters and digits only).' };
  }
  return { value: text };
}

/** A domain the student typed under "Other", e.g. "Site Reliability Engineer". */
function domainText(raw) {
  const text = stripDiacritics(cleanText(raw));
  if (!text) return { error: 'Type your domain.' };
  if (text.length < 2 || text.length > 60) return { error: 'Domain must be 2 to 60 characters.' };
  if (!/^[A-Za-z][A-Za-z0-9 .,&'\-_()/+]*$/.test(text)) return { error: 'Use English letters and numbers only.' };
  const key = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key.length < 2 || /^(.)\1+$/.test(key) || PLACEHOLDERS.has(key)) return { error: 'Enter a real domain.' };
  return { value: text };
}

/**
 * A hiring link (https://company.com/jobs/12345) or an email address (hr@company.com).
 * Returns { empty } when blank, { error }, or { value, kind }.
 */
function hiringLink(raw) {
  let text = cleanText(raw);
  if (!text) return { empty: true };
  const BAD = 'Enter a valid link (like https://company.com/jobs/data-engineer-12345) or an email address.';
  if (text.length > 300) return { error: 'This is too long.' };
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);

  if (text.includes('@') && !hasScheme) {
    text = text.replace(/^mailto:/i, '').toLowerCase();
    if (!/^[a-z0-9._%+\-]+@[a-z0-9\-]+(\.[a-z0-9\-]+)+$/.test(text)) return { error: BAD };
    const parsed = parse(text.split('@')[1]);
    if (!parsed.domain || !parsed.isIcann) return { error: BAD };
    return { value: text, kind: 'email' };
  }

  if (/\s/.test(text)) return { error: BAD };
  if (!hasScheme) text = 'https://' + text;
  let url;
  try {
    url = new URL(text);
  } catch (err) {
    return { error: BAD };
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return { error: BAD };
  const parsed = parse(url.hostname.replace(/\.$/, ''));
  if (parsed.isIp || !parsed.domain || !parsed.isIcann) return { error: BAD };
  return { value: text, kind: 'link' };
}

/** The student's own email address. */
function emailAddress(raw) {
  const text = cleanText(raw).toLowerCase();
  if (!text) return { error: 'Enter your email ID.' };
  const BAD = 'Enter a valid email ID, like name@gmail.com';
  if (text.length > 120 || !/^[a-z0-9._%+\-]+@[a-z0-9\-]+(\.[a-z0-9\-]+)+$/.test(text)) return { error: BAD };
  if (/\.\./.test(text) || text.startsWith('.') || text.split('@')[0].endsWith('.')) return { error: BAD };
  const parsed = parse(text.split('@')[1]);
  if (!parsed.domain || !parsed.isIcann) return { error: BAD };
  return { value: text };
}

module.exports = { cleanText, nameKey, coreKey, websiteKey, personName, rollNumber, emailAddress, domainText, hiringLink };
