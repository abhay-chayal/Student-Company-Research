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

module.exports = { domainGroup, GENERAL, OTHER };
