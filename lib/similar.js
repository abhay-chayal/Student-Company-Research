// "Too similar" rules for company-name keys (see nameKey in normalize.js).
// Two different keys are treated as the same company when:
//   1. they differ by a single typo (one letter changed, added, removed, or two swapped), or
//   2. one is the other plus up to 3 extra letters (wipro -> wipros).
// Short names are exempt from rule 1 so that real, different short names are not blocked.

function withinOneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff = [];
    for (let i = 0; i < a.length && diff.length < 3; i++) if (a[i] !== b[i]) diff.push(i);
    if (diff.length === 1) return true;
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  return short.slice(i) === long.slice(i + 1);
}

function isSimilar(a, b) {
  if (!a || !b || a === b) return false;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (short.length >= 5 && withinOneEdit(a, b)) return true;
  if (short.length >= 4 && long.startsWith(short) && long.length - short.length <= 3) return true;
  return false;
}

module.exports = { isSimilar };
