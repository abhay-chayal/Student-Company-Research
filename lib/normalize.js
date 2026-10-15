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

module.exports = { cleanText, nameKey, websiteKey, personName, rollNumber };
