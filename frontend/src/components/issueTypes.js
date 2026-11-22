// Common campus issues offered as one-click shortcuts on the report form.
// mode: 'online' (IT), 'academics' (academic block) or 'hostel' (room repair).
// service: catalogue service name; for repair categories the matching support service is picked automatically.
export const ISSUE_TYPES = [
  { key: 'wifi', label: 'Wi-Fi / internet', mode: 'online', category: 'Network', service: 'Office Wi-Fi',
    title: 'Wi-Fi not working', hint: 'Which hostel/room or block? Since when? Does it fail on all devices or only one?' },
  { key: 'lan', label: 'LAN / Ethernet port', mode: 'online', category: 'Network', service: 'Office Wi-Fi',
    title: 'Ethernet (LAN) port not working', hint: 'Room number, port location, and whether the cable/light shows any activity.' },
  { key: 'login', label: 'Login / password (SSO, ERP, LMS)', mode: 'online', category: 'Authentication', service: 'Identity Provider (SSO)',
    title: 'Unable to log in', hint: 'Which portal (ERP, LMS, email)? The exact error message? Did you recently change your password?' },
  { key: 'email', label: 'Email', mode: 'online', category: 'Software', service: 'Email Service',
    title: 'Email not working', hint: 'Sending or receiving? Web or app? Any error message?' },
  { key: 'vpn', label: 'VPN', mode: 'online', category: 'Network', service: 'Corporate VPN',
    title: 'VPN not connecting', hint: 'Which VPN client, from where (on/off campus), and the error shown.' },
  { key: 'payment', label: 'Fee payment portal', mode: 'online', category: 'Application', service: 'Payment Gateway',
    title: 'Fee payment failing', hint: 'Payment method, time, amount, and whether money was debited. Never share card numbers or OTPs.' },
  { key: 'storage', label: 'Drive / storage quota', mode: 'online', category: 'Storage', service: 'Cloud Storage',
    title: 'Storage quota full / cannot upload', hint: 'Which drive or folder, file size, and the error shown.' },
  { key: 'software', label: 'Software / licence', mode: 'online', category: 'Software',
    title: 'Software installation or licence issue', hint: 'Software name and version (e.g. MATLAB), device, and the error message.' },
  { key: 'phishing', label: 'Suspicious email / phishing', mode: 'online', category: 'Security', service: 'Email Service',
    title: 'Suspicious email received', hint: 'Sender address and subject. Do not click links or reply. Did you enter any password?', impact: 2, urgency: 3 },
  { key: 'lab-pc', label: 'Lab computer', mode: 'academics', category: 'Hardware',
    title: 'Lab computer not working', hint: 'Lab and system number, what happens when you turn it on, any error shown.' },
  { key: 'projector', label: 'Projector / classroom AV', mode: 'academics', category: 'Technician Needed',
    title: 'Projector not working', hint: 'Room, what you see (no signal, no power, flickering), and when your class is.' },
  { key: 'fan-light', label: 'Fan / light / socket', mode: 'hostel', category: 'Electrician Needed',
    title: 'Fan or light not working', hint: 'Which item, since when. If you see sparks, smell burning or see exposed wires, stay away and call the electrical emergency line.' },
  { key: 'furniture', label: 'Bed / door / furniture', mode: 'hostel', category: 'Carpenter Needed',
    title: 'Furniture repair needed', hint: 'Which item is broken (bed, door, lock, cupboard) and how.' },
  { key: 'appliance', label: 'Geyser / cooler / AC / tap', mode: 'hostel', category: 'Technician Needed',
    title: 'Appliance not working', hint: 'Which appliance, location, and what is wrong (not heating, leaking, no cooling).' }
];

export const issueTypeByKey = key => ISSUE_TYPES.find(t => t.key === key);
