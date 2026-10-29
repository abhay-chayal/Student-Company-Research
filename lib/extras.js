// The three extra details the HOD asked for on every company:
//   employee strength (a range), fresher package (LPA) and revenue (amount + unit + currency).
// All three are compulsory: there is no "not available" choice.
const { cleanText } = require('./normalize');

const STRENGTH = ['1-50', '51-200', '201-1,000', '1,001-5,000', '5,001-10,000', '10,000+'];
const UNITS = ['Crore', 'Million', 'Billion'];
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'JPY'];

const num = (raw) => {
  let text = cleanText(raw).replace(/\s+/g, '');
  // 6,5 is a decimal comma; 1,250 or 1,250.5 use the comma for thousands
  text = /^\d+,\d{1,2}$/.test(text) ? text.replace(',', '.') : text.replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return Number(text);
};

/**
 * row: { strength, packageLpa, revenueAmount, revenueUnit, revenueCurrency } as sent by the browser.
 * requireAll: every field must be filled (saving the details). Without it, fields that are all empty
 * are simply "not given" (the student is only correcting links); a half-filled set is still an error.
 * Returns { errors: { strength, pkg, revenue }, out, any } where out is what would be saved.
 */
function parseExtras(row, { requireAll = false } = {}) {
  const errors = { strength: null, pkg: null, revenue: null };
  const strength = cleanText(row.strength);
  const pkgRaw = cleanText(row.packageLpa);
  const revRaw = cleanText(row.revenueAmount);
  const unit = cleanText(row.revenueUnit);
  const cur = cleanText(row.revenueCurrency);
  const any = Boolean(strength || pkgRaw || revRaw || unit || cur);
  const out = { employee_strength: '', package_lpa: null, revenue_amount: null, revenue_unit: '', revenue_currency: '' };
  if (!any && !requireAll) return { errors, out, any: false };

  if (!strength) errors.strength = 'Choose the employee strength of this company.';
  else if (!STRENGTH.includes(strength)) errors.strength = 'Choose one of the ranges from the list.';
  else out.employee_strength = strength;

  if (!pkgRaw) errors.pkg = 'Enter the fresher package in LPA, for example 6.5.';
  else {
    const n = num(pkgRaw.replace(/lpa$/i, ''));
    if (n === null) errors.pkg = 'Enter the package as a number in LPA, for example 6.5.';
    else if (n < 0.5 || n > 200) errors.pkg = 'The package must be between 0.5 and 200 LPA.';
    else out.package_lpa = n;
  }

  if (!revRaw) errors.revenue = 'Enter the yearly revenue of this company.';
  else {
    const n = num(revRaw);
    if (n === null) errors.revenue = 'Enter the revenue as a number, for example 250.';
    else if (n <= 0 || n > 99999999) errors.revenue = 'Enter a revenue above 0.';
    else if (!UNITS.includes(unit)) errors.revenue = 'Choose the unit (Crore, Million or Billion).';
    else if (!CURRENCIES.includes(cur)) errors.revenue = 'Choose the currency.';
    else { out.revenue_amount = n; out.revenue_unit = unit; out.revenue_currency = cur; }
  }
  return { errors, out, any };
}

const hasExtraErrors = (errors) => Object.values(errors).some(Boolean);
const isComplete = (c) => Boolean(c && c.employee_strength && c.package_lpa != null && c.revenue_amount != null && c.revenue_unit && c.revenue_currency);

module.exports = { STRENGTH, UNITS, CURRENCIES, parseExtras, hasExtraErrors, isComplete };
