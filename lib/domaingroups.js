// Turns the many ways students wrote a role ("Software enginner", "JAVA Developer", "Salesforce developer") into a small
// set of domain tiles for the apply page. The first rule that matches wins. The original text is still shown on each company.
const GENERAL = 'General (not domain specific)';
const OTHER = 'Other roles';

const RULES = [
  [/general/i, GENERAL],
  [/database\s*admin|\bdba\b/i, 'Database Administrator'],
  [/cloud/i, 'Cloud Engineer'],
  [/salesforce|sakesforce/i, 'Salesforce Developer'],
  [/cyber|infosec|security/i, 'Cybersecurity'],
  [/ui\s*\/?\s*ux|designer|\bux\b|\bui\b/i, 'UI/UX Designer'],
  [/data\s*scien/i, 'Data Scientist'],
  [/data\s*engineer/i, 'Data Engineer'],
  [/data\s*analy|analytics|business\s*analy|\banalyst/i, null], // decided below
  [/\bml\b|\bai\b|artificial|machine\s*learn|\bllm\b/i, 'ML / AI Engineer'],
  [/devops|site\s*reliab|\bsre\b/i, 'DevOps Engineer'],
  [/cloud/i, 'Cloud Engineer'],
  [/network|linux|system\s*admin|sysadmin/i, 'Network / Systems / Infrastructure'],
  [/\bqa\b|test/i, 'QA / Test Engineer'],
  [/embedded|robotic/i, 'Embedded Software'],
  [/front\s*-?\s*end/i, 'Frontend Developer'],
  [/back\s*-?\s*end/i, 'Backend Developer'],
  [/full\s*-?\s*stack/i, 'Full Stack Developer'],
  [/mobile|android|\bios\b|flutter|react\s*native|app\s*develop/i, 'Mobile App Developer'],
  [/software|developer|development|\bsde\b|java|python|php|spring|\.net|web|engineer|programm|trainee|application/i, 'Software Engineer / Developer'],
];

function domainGroup(raw) {
  const t = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!t) return GENERAL;
  for (const [re, label] of RULES) {
    if (!re.test(t)) continue;
    if (label !== null) return label;
    return /data\s*analy|analytics/i.test(t) ? 'Data Analyst' : 'Business Analyst';
  }
  return OTHER;
}

/**
 * For the companies of students of other branches (EC, EE, ME and so on): is the role one that a CS, IT or AI & DS student can apply to?
 * Strict on purpose: "Electrical Design Engineer", "Production", "Robotics Engineer" or "VLSI" are not; "Full Stack Developer",
 * "Data Analyst", "Software Developer" or "Embedded Software" are.
 */
function isTechRelevant(raw) {
  const t = String(raw == null ? '' : raw);
  const g = domainGroup(t);
  if (g === OTHER) return false;
  if (g === 'Embedded Software') return /embedded\s*software/i.test(t);
  if (g === 'Software Engineer / Developer') return /software|developer|development|\bsde\b|java|python|php|spring|\.net|\bweb\b|programm/i.test(t);
  if (g === 'QA / Test Engineer') return /\bqa\b|software|automation|quality\s*assurance|test\s*engineer/i.test(t);
  return true;
}

module.exports = { domainGroup, isTechRelevant, GENERAL, OTHER };
