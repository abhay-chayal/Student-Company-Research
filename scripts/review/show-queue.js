// Prints uncertain links with what the page shows, so they can be judged by hand.
const fs = require('fs');
const dir = process.argv[2], from = Number(process.argv[3] || 0), n = Number(process.argv[4] || 40);
const { readAddress, decide, V } = require('../check-links');
const f = JSON.parse(fs.readFileSync(dir + '/fetch-cache.json', 'utf8'));
const r = JSON.parse(fs.readFileSync(dir + '/render-cache.json', 'utf8'));
const q = JSON.parse(fs.readFileSync(dir + '/manual-queue.json', 'utf8')).slice(from, from + n);
q.forEach((u, i) => {
  const p = r[u] || f[u] || {};
  const a = readAddress(u);
  const v = decide(a, p);
  const head = [p.h1, p.ogTitle, p.title].filter(Boolean).join(' | ').replace(/\s+/g, ' ').slice(0, 130);
  console.log(`#${from + i} ${u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 105)}`);
  console.log(`   [${a.kind}/${v.v}] http ${p.status || p.error || '?'}${p.hasApply ? ' APPLY' : ''}${p.jobPostingData ? ' JSON-LD' : ''} | ${head}`);
  if (p.lead) console.log(`   > ${p.lead.replace(/\s+/g, ' ').slice(0, 150)}`);
});
