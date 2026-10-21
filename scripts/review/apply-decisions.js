// Turns hand decisions (index -> code) into link overrides. Codes:
//  J real job page   D dead or closed   C careers or programme page   L list or search of jobs
//  U not a hiring page   H company home page   S search or social page
//  M could not verify (address looks like a job)   X broken or cannot be opened
const fs = require('fs');
const dir = process.argv[2];
const { V } = require('../check-links');
const MAP = { J: V.POSTING_OK, D: V.CLOSED, C: V.CAREERS, L: V.LISTING, U: V.UNCLEAR, H: V.HOME, S: V.SEARCH, M: V.POSTING_LIKELY, X: V.DOWN };
const queue = JSON.parse(fs.readFileSync(dir + '/manual-queue.json', 'utf8'));
const decisions = JSON.parse(fs.readFileSync(dir + '/decisions.json', 'utf8'));
const ov = fs.existsSync(dir + '/overrides.json') ? JSON.parse(fs.readFileSync(dir + '/overrides.json', 'utf8')) : {};
ov.links = ov.links || {};
let n = 0;
for (const [i, d] of Object.entries(decisions)) {
  const [code, note] = Array.isArray(d) ? d : [d, ''];
  if (!MAP[code]) throw new Error('bad code ' + code + ' at ' + i);
  const url = queue[Number(i)];
  if (!url) throw new Error('no link at index ' + i);
  ov.links[url] = { v: MAP[code], why: 'checked by hand' + (note ? ': ' + note : '') };
  n++;
}
fs.writeFileSync(dir + '/overrides.json', JSON.stringify(ov, null, 1));
console.log(`applied ${n} decisions; overrides now cover ${Object.keys(ov.links).length} links`);
