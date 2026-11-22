// Kinds of theme. A family gives every theme in it sensible defaults (how panels are drawn,
// what's behind the page, which effects run), so adding a theme is mostly picking colours.
// To add a whole new kind of theme, register a family here and put themes in it.
import type { Scheme, ThemeFamily } from './types'

const families = new Map<string, ThemeFamily>()
export const registerFamily = (f: ThemeFamily) => { families.set(f.id, f) }
export const getFamily = (id: string) => families.get(id) || families.get('glass')!
export const allFamilies = () => [...families.values()].sort((a, b) => a.order - b.order)

registerFamily({
  id: 'glass', name: 'Liquid glass', order: 1,
  description: 'Frosted panels over slowly moving colour, with 3D and glow. Best on good screens.',
  defaults: () => ({
    backdrop: { kind: 'mesh', colours: [], speed: 0.18 },
    surfaces: { translucent: true, blur: 22, radius: 24 },
    effects: { light: true, object3d: true, glow: true },
    typography: {},
  }),
})

registerFamily({
  id: 'screen', name: 'Screen-tuned', order: 2,
  description: 'Calm solid surfaces matched to the display: true black for OLED, dark grey for LCD, clean light for offices.',
  defaults: () => ({
    backdrop: { kind: 'solid' },
    surfaces: { translucent: false, blur: 0, radius: 20 },
    effects: { light: true, object3d: true, glow: false },
    typography: {},
  }),
})

registerFamily({
  id: 'readability', name: 'High visibility', order: 3,
  description: 'Maximum contrast for sunlight, projectors and low vision. Solid, bold, no effects.',
  defaults: (scheme: Scheme) => ({
    backdrop: { kind: 'solid' },
    surfaces: { translucent: false, blur: 0, rimWidth: 1.5, radius: 14 },
    effects: { light: false, object3d: false, glow: false },
    typography: { weightBoost: scheme === 'light' ? 60 : 40 },
  }),
})

registerFamily({
  id: 'comfort', name: 'Comfort', order: 4,
  description: 'Easy on the eyes: warm low-blue colours for night, and colour-blind-safe status colours.',
  defaults: () => ({
    backdrop: { kind: 'solid' },
    surfaces: { translucent: false, blur: 0, radius: 22 },
    effects: { light: true, object3d: true, glow: false },
    typography: {},
  }),
})
