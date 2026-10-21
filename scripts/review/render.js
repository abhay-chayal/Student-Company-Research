// Opens pages in a real browser (the Chrome already installed on this computer) so pages that
// build themselves with JavaScript can be read. Returns the same shape as openPage() in
// scripts/check-links.js, plus a few extra fields, so decide() can judge it.
const puppeteer = require('puppeteer-core');
const { CLOSED, UA } = require('../check-links');

const CHROME_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const fs = require('fs');
  const executablePath = CHROME_PATHS.find((p) => fs.existsSync(p));
  if (!executablePath) throw new Error('No Chrome or Edge found');
  return puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--mute-audio'] });
}

async function renderPage(browser, url) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', (r) => (['image', 'media', 'font'].includes(r.resourceType()) ? r.abort() : r.continue()));
    let status = 0;
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      status = resp ? resp.status() : 200;
    } catch (err) {
      if (!/timeout/i.test(err.message)) throw err;
      status = 200; // slow page: read whatever has loaded
    }
    await Promise.race([page.waitForNetworkIdle({ idleTime: 1500, timeout: 14000 }).catch(() => {}), sleep(14000)]);
    await sleep(1200);
    const d = await page.evaluate(() => {
      const text = (document.body && document.body.innerText) || '';
      const meta = (n) => { const m = document.querySelector(`meta[property="${n}"],meta[name="${n}"]`); return m ? m.content : ''; };
      const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent).join(' ');
      const apply = [...document.querySelectorAll('a,button')].some((e) => /^\s*(apply|apply now|apply for this job|apply here|submit application)\b/i.test(e.innerText || e.value || ''));
      const h1 = document.querySelector('h1');
      return {
        finalUrl: location.href, title: document.title || '', ogTitle: meta('og:title'), siteName: meta('og:site_name'),
        h1: h1 ? h1.innerText.trim().slice(0, 160) : '', text: text.replace(/\s+/g, ' ').trim(),
        jobPostingData: /["']@type["']\s*:\s*["']JobPosting["']/i.test(ld), hasApply: apply,
      };
    });
    return {
      rendered: true, status, finalUrl: d.finalUrl, title: d.title.slice(0, 200), ogTitle: d.ogTitle.slice(0, 200), siteName: d.siteName.slice(0, 80),
      h1: d.h1, jobPostingData: d.jobPostingData, hasApply: d.hasApply, textLength: d.text.length,
      lead: d.text.slice(0, 500), closedText: CLOSED.test(d.title + ' ' + d.h1 + ' ' + d.text.slice(0, 2500)),
    };
  } catch (err) {
    return { rendered: true, error: /timeout/i.test(err.message) ? 'timeout' : String(err.message).slice(0, 80) };
  } finally {
    await page.close().catch(() => {});
  }
}

/** Render many URLs with a few pages open at a time. cb(url, result) is called as each finishes. */
async function renderAll(urls, { workers = 5, onDone } = {}) {
  const browser = await launch();
  const out = {};
  let next = 0;
  async function worker() {
    while (next < urls.length) {
      const u = urls[next++];
      out[u] = await renderPage(browser, /^https?:\/\//i.test(u) ? u : 'https://' + u);
      if (onDone) onDone(u, out[u]);
    }
  }
  try { await Promise.all(Array.from({ length: workers }, worker)); } finally { await browser.close().catch(() => {}); }
  return out;
}

module.exports = { renderAll, renderPage, launch };
