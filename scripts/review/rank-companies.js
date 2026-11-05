// Sorts the companies of a final export with the best-established ones first.
//   node scripts/review/rank-companies.js <export.xlsx> <output.xlsx>
//
// How "established" is decided (the students' own figures are not verified, so they are combined with a list
// of well-known companies):
//   A  Large and well known   a company on the well-known list, or 5,001+ employees
//   B  Established            1,001-5,000 employees, or on the established list, or revenue above 250 million USD
//   C  Mid-size               201-1,000 employees, or revenue above 25 million USD
//   D  Small or startup       200 employees or fewer
//   E  Not enough information the three details were left empty and the company is not on a list
// Inside a tier: more employees first, then higher revenue, then name.
// The output holds roll numbers but no student names or emails.
const fs = require('fs');
const ExcelJS = require('exceljs');

const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error('Usage: node scripts/review/rank-companies.js <export.xlsx> <output.xlsx>'); process.exit(1); }
const val = (v) => (v && v.text ? v.text : v && v.richText ? v.richText.map((t) => t.text).join('') : v);
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');

// ---- well-known lists (normalised names) ----
const LARGE = `google microsoft amazon apple meta netflix nvidia intel amd qualcomm broadcom cisco oracle ibm sap salesforce adobe vmware dell hp hpe lenovo samsung sony huawei tencent alibaba bytedance jdcom uber paypal visa mastercard intuit servicenow workday
deloitte kpmg pwc ey accenture capgemini cognizant infosys tcs tataconsultancyservices wipro hcl hcltech techmahindra ltimindtree larsentoubro lttechnologyservices mphasis genpact wns exlservice concentrix teleperformance hexaware persistent coforge birlasoft cyient kpit nttdata fujitsu hitachi toshiba panasonic philips
siemens bosch honeywell ge gehealthcare gevernova schneiderelectric abb eaton emerson rockwellautomation ptc autodesk synopsys cadencedesignsystems keysight texasinstruments analogdevices nxpsemiconductors stmicroelectronics infineon renesas microchip marvell mediatek micron globalfoundries asml kla teradyne advantest tokyoelectron skyworks qorvo rohm
jpmorgan goldmansachs morganstanley citi hsbc barclays deutschebank wellsfargo americanexpress standardchartered bnpparibas bnymellon natwest nomura blackrock statebankofindia hdfc icici axisbank idfcfirstbank bankofbaroda metlife allianz lseg spglobal morningstar nasdaq dbs
reliance jio tata tatamotors tatasteel tatapower tataelectronics tataprojects tataelxsi mahindra marutisuzuki hyundai kia toyota honda suzuki bajaj tvs ashokleyland royalenfield volvo mercedesbenz bmw jaguarlandrover jlr continental valeo zf marelli forvia schaeffler cummins cumins caterpillar jcb komatsu kawasaki mitsubishi kuka daikin bluestar voltas thermax skf atlascopco danfoss voith
bhel ntpc powergrid nhpc iocl indianoil hpcl bpcl gail coalindia sail ongc isro drdo bharatelectronics hindustanaeronautics hal bharatforge motherson samvardhana endurance tubeinvestments brakesindia
adani jswsteel jindalsteel ultratech dalmia hindustanunilever itc nestle pepsico cocacola godrej asianpaints pidilite titan havells dixon bata amul nirma sunpharma lupin cipla biocon
dhl ups fedex airindia indigo americanairlines unitedairlines britishairways boeing airbus collinsaerospace shell bp chevron saudiaramco adnoc qatarenergy
mckinsey bostonconsultinggroup bcg expedia bookingcom hm rakuten ford walmart disney warnerbros electronicarts ubisoft cargill stryker amgen labcorp ups arm`.split(/\s+/);

const ESTABLISHED = `swiggy zomato meesho flipkart myntra nykaa paytm phonepe razorpay zoho freshworks databricks snowflake datadog mongodb cloudflare twilio atlassian github gitlab figma canva notion zoom stripe palantir openai anthropic tenable fortinet checkpointsoftware paloaltonetworks crowdstrike zscaler redhat nutanix netapp f5 akamai teradata cloudera redis elastic splunk heretechnologies
tejasnetworks mavenir extremenetworks hfcl deltaelectronics kaynes datapatterns luminous vguard inoxwind suzlon waaree jkTyre apollotyres bkt ceat mrf
sonata happiestminds intellect newgen ramco mastech mindteck ibssoftware maqsoftware cybage tigeranalytics fractal mu sigma latentview quantiphi sigmoid searce tavant impetus brillio yashtechnologies virtusa globant endava epam luxoft softtek
zetwerk ola ather rapido groww zerodha cred pinelabs bharatpe angelone policybazaar makemytrip oyo lenskart cars24 udaan upgrad byjus unacademy physicswallah
ansys altair cadence mentor siliconlabs lattice synaptics cirruslogic nordic allegromicrosystems sanmina foxconn jabil syrma amberenterprises
ecolab jll danaher zeiss revvity husky flowserve konecranes landisgyr schindler copeland allegion rehlko`.split(/\s+/);

const LARGE_MORE = `handm motorola halliburton asus jbl harman itron flex generalmills gfk forbes garnier schwarzgroup trafigura vitol tmobile westernunion waymo riotgames visteon lucas lululemon moodys dunandbradstreet arrowelectronics dukeenergy maserati bugatti astonmartin koenigsegg horaciopagani porche porsche tesla mircochip mideagroup kukarobotics fujielectric longi nari qatarengineering kuwaitoil oq lamprell
hindustanzinc gujratmineral rhimagnesita alpla jktyre apollotyres bkttyres amararaja cholamandalam clpindia sonacomstar unominda isgec torrentpower sterlingandwilson waaree suzlon inoxwind kirloskar swaraj sonalika newholland railvikas nmdc nbcc sjvn rec powerfinance indiaoil solarenergycorporation hmt moog marmon landisgyr bdindia tataiq onebcg logitech optiver dover careerpoint
magna ebay cumminsindia tvsmotors voltaslimited jcbindia thermaxlimited metsoaggregates ntpc seg ashokleyland larsen tataprojects`.split(/\s+/);
const ESTABLISHED_MORE = `asana clickup monday mondaycom smartsheet miro dataiku dbtlabs wandb cockroachlabs zapier wiz glean weaviate langchain runway elevenlabs cursor ripple chainalysis tanium arcticwolf c3ai bitwarden appsmith lucidworks minio 3hashicorp checkoutcom constructor sirion zeotap accelya acldigital affle altimetrik apexon bazaarvoice beyondsoft citiustech cloudsoftwaregroup edgeverve fynd kreditbee mobiquity mactores robosoft qburst sahaj tracxn unicommerce uniphore ugam tookitaki torryharris maveric mindfire moontechnolabs cropin qureai tricog sigtuple grayorange addverb ideaforge digantara woodenstreet squadstack fasal easebuzz cleartax webengage pricelabs netic loka securemeters tessolve mistralsolutions pathpartner saankhyalabs centumelectronics datapatterns avalontechnologies moschip hindujatech hasura moveworks navtech zilliz exicom sterlite docker pubmatic cdsl quickheal onmobile subex canonical mixpanel pendo redwood singlestore cloudbees azul kissflow capillary clevertap haptik mindtickle innovaccer redbus ixigo cohere eightfold groq pinecone sysdig mongodb elastic`.split(/\s+/);
// a word that may follow a short name (Tata..., JCB India, TVS Motors)
const PREFIXES = ['tata', 'adani', 'reliance', 'mahindra', 'siemens', 'samsung', 'mitsubishi', 'toyota', 'honda', 'hitachi', 'godrej', 'bajaj', 'jindal'];
function matches(list, name) {
  const key = norm(name);
  if (!key) return false;
  return list.some((e) => {
    const x = norm(e);
    if (!x) return false;
    if (key === x) return true;
    if (PREFIXES.includes(x)) return key.startsWith(x);
    if (x.length <= 4) return new RegExp('^' + x + '(india|inc|ltd|limited|group|technologies|corp|corporation|motors|energy|electronics|semiconductors|engineering|industries|tyres|pvtltd)$').test(key);
    return key.startsWith(x);
  });
}

// ---- the students' own figures ----
const STRENGTH_RANK = { '10,000+': 6, '5,001-10,000': 5, '1,001-5,000': 4, '201-1,000': 3, '51-200': 2, '1-50': 1 };
const UNIT = { Crore: 1e7, Million: 1e6, Billion: 1e9 };
const FX = { INR: 0.012, USD: 1, EUR: 1.08, GBP: 1.27, JPY: 0.0067 };
function revenueMillionsUSD(text) {
  const m = /^([\d.,]+)\s+(Crore|Million|Billion)\s+([A-Z]{3})$/.exec(String(text || '').trim());
  if (!m) return 0;
  const v = Number(m[1].replace(/,/g, '')) * UNIT[m[2]] * (FX[m[3]] || 0) / 1e6;
  return Number.isFinite(v) && v < 5e5 ? v : 0; // a figure above half a trillion dollars is a typing mistake
}

(async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(input);
  const sheet = book.getWorksheet('Student Research') || book.worksheets[0];
  const head = sheet.getRow(1).values.slice(1).map(val).map((h) => String(h).toLowerCase());
  const col = (s) => head.findIndex((h) => h.includes(s));
  const C = { roll: col('roll'), company: col('company'), website: col('website'), domain: col('domain') , dlink: col('domain-specific'), flink: col('fresher hiring'), strength: col('employee'), pkg: col('package'), rev: col('revenue'), review: col('review') };
  const rows = [];
  sheet.eachRow((r, i) => {
    if (i === 1) return;
    const v = r.values.slice(1).map(val);
    const g = (k) => (C[k] >= 0 ? v[C[k]] : '');
    const name = String(g('company') || '').trim();
    if (!name) return;
    const strength = String(g('strength') || '');
    const revenueText = String(g('rev') || '');
    const revM = revenueMillionsUSD(revenueText);
    const large = matches(LARGE.concat(LARGE_MORE), name), est = matches(ESTABLISHED.concat(ESTABLISHED_MORE), name);
    const sr = STRENGTH_RANK[strength] || 0;
    let tier, basis;
    // A big headcount with a tiny revenue does not add up: the student's figures are likely wrong
    const inconsistent = !large && !est && sr >= 4 && revM > 0 && revM < 20;
    if (inconsistent) { tier = 'C'; basis = 'Self-reported employees and revenue do not agree, so rated mid-size'; }
    else if (large) { tier = 'A'; basis = 'Well-known large company'; }
    else if (sr >= 5) { tier = 'A'; basis = `Self-reported: ${strength} employees`; }
    else if (est || sr === 4 || (sr >= 3 && revM >= 250)) { tier = 'B'; basis = est ? 'Well-known established company' : (sr === 4 ? `Self-reported: ${strength} employees` : 'Self-reported: revenue above 250 million USD'); }
    else if (sr === 3 || revM >= 25) { tier = 'C'; basis = sr === 3 ? `Self-reported: ${strength} employees` : 'Self-reported: revenue above 25 million USD'; }
    else if (sr >= 1) { tier = 'D'; basis = `Self-reported: ${strength} employees`; }
    else { tier = 'E'; basis = 'No details given and not a well-known company'; }
    rows.push({ roll: String(g('roll') || ''), name, website: String(g('website') || ''), domain: String(g('domain') || ''), dlink: String(g('dlink') || ''), flink: String(g('flink') || ''),
      strength, pkg: g('pkg') === '' ? '' : g('pkg'), revenueText, revM, review: String(g('review') || ''), tier, basis, sr, known: large ? 2 : est ? 1 : 0 });
  });

  const order = { A: 0, B: 1, C: 2, D: 3, E: 4 };
  rows.sort((a, b) => order[a.tier] - order[b.tier] || b.known - a.known || b.sr - a.sr || b.revM - a.revM || a.name.localeCompare(b.name));

  // a web address (with or without https://) or an email becomes a link; anything else stays plain text
  const clickable = (v) => {
    const t = String(v || '').trim();
    if (!t) return null;
    if (/^https?:\/\//i.test(t)) return t.slice(0, 2000);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return 'mailto:' + t;
    if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(t)) return ('https://' + t).slice(0, 2000);
    return null;
  };
  const LABEL = { A: 'A - Large and well known', B: 'B - Established', C: 'C - Mid-size', D: 'D - Small or startup', E: 'E - Not enough information' };
  const COLOR = { A: 'FFD9EAD3', B: 'FFE6F1DA', C: 'FFFFF2CC', D: 'FFFCE5CD', E: 'FFEDEDED' };
  const out = new ExcelJS.Workbook();
  const ws = out.addWorksheet('Ranked companies');
  ws.columns = [['Rank', 7], ['Tier', 26], ['Company', 34], ['Website', 30], ['Domain', 28], ['Employee strength', 16], ['Fresher package (LPA)', 12], ['Revenue', 20], ['Why it is placed here', 40], ['Domain-specific link / email', 60], ['Fresher hiring link / email', 50], ['Review', 18], ['RTU roll no (student)', 16]]
    .map(([header, width]) => ({ header, width }));
  ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }; c.alignment = { vertical: 'middle', wrapText: true }; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  rows.forEach((r, i) => {
    const row = ws.addRow([i + 1, LABEL[r.tier], r.name, r.website, r.domain, r.strength, r.pkg, r.revenueText, r.basis, r.dlink, r.flink, r.review, r.roll]);
    row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR[r.tier] } };
    // make the website and the links clickable
    for (const [n, text] of [[4, r.website], [10, r.dlink], [11, r.flink]]) {
      const href = clickable(text);
      if (href) { row.getCell(n).value = { text: String(text), hyperlink: href }; row.getCell(n).font = { color: { argb: 'FF1D4ED8' }, underline: true }; }
    }
  });
  ws.autoFilter = { from: 'A1', to: 'M1' };

  const S = out.addWorksheet('How it is ranked');
  S.columns = [{ width: 30 }, { width: 14 }, { width: 90 }];
  S.addRow(['Tier', 'Companies', 'Meaning']).font = { bold: true };
  const meaning = { A: 'On the well-known list of large companies, or reports more than 5,000 employees.', B: 'Reports 1,001 to 5,000 employees, or is a well-known established company, or reports revenue above 250 million USD.', C: 'Reports 201 to 1,000 employees, or revenue above 25 million USD.', D: 'Reports 200 employees or fewer: small companies and startups.', E: 'The three details were left empty and the company is not on a well-known list, so it cannot be rated yet.' };
  for (const t of ['A', 'B', 'C', 'D', 'E']) S.addRow([LABEL[t], rows.filter((r) => r.tier === t).length, meaning[t]]);
  S.addRow([]);
  S.addRow(['Note: employee strength, package and revenue are the students\' own figures and are not verified. The links have not been checked in this sheet.']);
  await out.xlsx.writeFile(output);

  console.log('companies', rows.length);
  for (const t of ['A', 'B', 'C', 'D', 'E']) console.log(LABEL[t].padEnd(30), rows.filter((r) => r.tier === t).length);
  console.log('first 25:', rows.slice(0, 25).map((r) => r.name).join(' | '));
})();
