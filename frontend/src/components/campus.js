// Campus reference data shared by the report form and the incident editor.
export const ACADEMIC_BLOCKS = [
  'Block A',
  'Block B',
  'Block C',
  'Block D',
  'Block F',
  'Block G',
  'NAB (New Academic Block)',
  'LTC (Lecture Theatre Complex)',
  'Library',
  'Workshop',
  'SAC (Student Activity Centre)',
  'Medical Centre'
];

export const HOSTELS = [
  'Vishwakarma Bhavan',
  'Valmiki Bhavan',
  'Gautam Bhavan',
  'Gandhi Bhavan',
  'Ram Bhavan',
  'Vyas Bhavan',
  'Shankar Bhavan',
  'Krishna Bhavan'
];

export const ALL_SKILLS = [
  'Network', 'Hardware', 'Software', 'Database',
  'Cloud', 'Security', 'Authentication', 'Application', 'Storage'
];
export const OFFLINE_CATEGORIES = ['Carpenter Needed', 'Electrician Needed', 'Technician Needed'];
export const OFFLINE_SERVICE_BY_CATEGORY = {
  'Carpenter Needed': 'Carpenter Support',
  'Electrician Needed': 'Electrician Support',
  'Technician Needed': 'Technician Support'
};
export const OFFLINE_SERVICES = Object.values(OFFLINE_SERVICE_BY_CATEGORY);
