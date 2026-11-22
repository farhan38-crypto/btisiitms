// One-tap starting points for common problems. Category and service names match the
// backend's seeded catalogue (backend/app/services/seed.py); unknown names are ignored.
import { Hammer, KeyRound, Laptop, Mail, Plug, Projector, Wifi, Wrench, type LucideIcon } from 'lucide-react'
import type { LocationType } from '../../api'

export interface Preset { key: string; label: string; hint: string; icon: LucideIcon; category: string; service?: string; prompt: string; where?: LocationType }
export const PRESETS: Preset[] = [
  { key: 'wifi', label: 'Wi-Fi or internet', hint: 'Slow, dropping, no signal', icon: Wifi, category: 'Network', service: 'Office Wi-Fi', prompt: 'The Wi-Fi ', where: 'online' },
  { key: 'login', label: 'Can’t sign in', hint: 'Password, SSO, locked out', icon: KeyRound, category: 'Authentication', service: 'Identity Provider (SSO)', prompt: 'I can’t sign in to ', where: 'online' },
  { key: 'computer', label: 'Computer or lab PC', hint: 'Won’t start, crashes, slow', icon: Laptop, category: 'Hardware', prompt: 'The computer ' },
  { key: 'projector', label: 'Projector or screen', hint: 'No display, no sound', icon: Projector, category: 'Hardware', prompt: 'The projector in ', where: 'academics' },
  { key: 'email', label: 'Email', hint: 'Not sending or receiving', icon: Mail, category: 'Application', service: 'Email Service', prompt: 'My email ', where: 'online' },
  { key: 'electric', label: 'Electrician', hint: 'Socket, light, fan, switch', icon: Plug, category: 'Electrician Needed', service: 'Electrician Support', prompt: 'In my room, the ', where: 'hostel' },
  { key: 'carpenter', label: 'Carpenter', hint: 'Door, bed, cupboard, window', icon: Hammer, category: 'Carpenter Needed', service: 'Carpenter Support', prompt: 'In my room, the ', where: 'hostel' },
  { key: 'technician', label: 'Room technician', hint: 'AC, geyser, water, other repairs', icon: Wrench, category: 'Technician Needed', service: 'Technician Support', prompt: 'In my room, the ', where: 'hostel' },
]
/** Hostel and on-site repairs must use the matching support service (IncidentService.create). */
export const OFFLINE_SERVICE: Record<string, string> = {
  'Carpenter Needed': 'Carpenter Support', 'Electrician Needed': 'Electrician Support', 'Technician Needed': 'Technician Support',
}
