// Name shown on the pages and in the browser tab. Change it here.
const APP_NAME = 'Company Research Portal';

const GENERAL = 'General (not domain specific)';

// Domains offered in the dropdown, grouped by department.
// Students can also choose "Other" and type their own.
const GROUPS = [
  {
    group: 'CSE / IT / AI & DS',
    items: [
      'Data Engineer', 'Data Analyst', 'Data Scientist', 'ML / AI Engineer',
      'Backend Developer', 'Frontend Developer', 'Full Stack Developer', 'DevOps Engineer',
      'Cloud Engineer', 'Cybersecurity', 'QA / Test Engineer', 'Mobile App Developer',
      'Database Administrator', 'Business Analyst', 'UI/UX Designer', 'Embedded Software',
    ],
  },
];

const ALL_DOMAINS = new Set(GROUPS.flatMap((g) => g.items));

module.exports = { APP_NAME, GENERAL, GROUPS, ALL_DOMAINS };
