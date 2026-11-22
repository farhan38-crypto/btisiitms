// Every built-in theme. To add one, copy an entry, give it a new id and colours, and pick a
// family. Chart colours ("chart") were checked with the dataviz palette validator (lightness
// band, colour-blind separation, contrast); leave them out and the family default is used.
//
// Screen guidance behind the screen-tuned and high-visibility themes:
//  • OLED: pure black switches pixels off (most battery saved) but can smear when scrolling;
//    off-white text avoids halation.          → OLED Black (true black), Graphite (#121212)
//  • LCD/IPS: pure black looks grey and harsh; Material's #121212 shows depth. → Graphite, Paper
//  • Sunlight: glare washes out low contrast → solid surfaces, AAA text, bold weights. → Sunlight
//  • Projectors: dark text on a light background with one strong accent survives
//    wash-out; avoid subtle gradients and red text.  → Projector
//  • Low vision: maximum contrast, thick borders.   → High contrast
//  • Night: warm, low-blue colours.                  → Night
//  • Colour blindness: blue/orange instead of red/green (Okabe–Ito). → Okabe–Ito
import type { ThemeDefinition } from './types'

// Solid light surfaces: white cards on a tinted page (ink colours per theme).
const lightSolid = (ink: string, rgb: string, card = '#FFFFFF', cardHi = '#FAFAFA') => ({
  ink, ink2: `rgb(${rgb} / .7)`, ink3: `rgb(${rgb} / .52)`, glass: card, glassHi: cardHi, glassSolid: card,
  rim: `rgb(${rgb} / .12)`, rimTop: `rgb(${rgb} / .08)`, rimBottom: `rgb(${rgb} / .18)`, shadow: `0 16px 36px -26px rgb(${rgb} / .4)`,
})
const lightGlass = (ink: string, rgb: string) => ({
  ink, ink2: `rgb(${rgb} / .66)`, ink3: `rgb(${rgb} / .47)`,
  glass: 'rgb(255 255 255 / .55)', glassHi: 'rgb(255 255 255 / .75)', glassSolid: 'rgb(255 255 255 / .93)',
  rim: `rgb(${rgb} / .1)`, rimTop: 'rgb(255 255 255 / .9)', rimBottom: `rgb(${rgb} / .13)`, shadow: `0 30px 60px -32px rgb(${rgb} / .35)`,
})

const DARK_GLASS = { ink: '#F4F4F6', ink2: 'rgb(244 244 246 / .64)', ink3: 'rgb(244 244 246 / .42)',
  glass: 'rgb(255 255 255 / .055)', glassHi: 'rgb(255 255 255 / .09)', glassSolid: 'rgb(14 14 18 / .86)',
  rim: 'rgb(255 255 255 / .14)', rimTop: 'rgb(255 255 255 / .26)', rimBottom: 'rgb(255 255 255 / .05)' }

export const CATALOG: ThemeDefinition[] = [
  // ── Liquid glass ──
  { id: 'aurora', name: 'Aurora', family: 'glass', scheme: 'dark', bestFor: ['oled'],
    description: 'Violet, aqua and pink light drifting under frosted glass.',
    palette: { base: '#000000', a: '#8B7CFF', b: '#3EE6D0', c: '#FF6FB5', ...DARK_GLASS },
    backdrop: { kind: 'mesh', colours: ['#000000', '#1B1240', '#062E2A', '#2A0B22'] },
    chart: { series: ['#7E6EF2', '#19A997'] } },
  { id: 'ember', name: 'Ember', family: 'glass', scheme: 'dark', bestFor: ['oled'],
    description: 'Orange and rose, like coals glowing behind smoked glass.',
    palette: { base: '#000000', a: '#FF9F43', b: '#FF4D7E', ...DARK_GLASS },
    backdrop: { kind: 'mesh', colours: ['#000000', '#2E1405', '#2A0612', '#000000'] },
    chart: { series: ['#D57C11', '#D33068'] } },
  { id: 'glacier', name: 'Glacier', family: 'glass', scheme: 'dark', bestFor: ['oled'],
    description: 'Ice blue and frost white over deep water.',
    palette: { base: '#000000', a: '#7CC8FF', b: '#C6F6FF', ...DARK_GLASS },
    backdrop: { kind: 'mesh', colours: ['#000000', '#06203A', '#0B2B33', '#000000'] },
    chart: { series: ['#3A84CA', '#3AAC83'] } },
  { id: 'volt', name: 'Volt', family: 'glass', scheme: 'dark', bestFor: ['oled'],
    description: 'Electric lime on graphite, loud and sharp.',
    palette: { base: '#000000', a: '#D2FF00', b: '#8A8F7A', onAccent: '#000', ...DARK_GLASS },
    backdrop: { kind: 'mesh', colours: ['#000000', '#1A1F00', '#121410', '#000000'] },
    chart: { series: ['#83A015', '#437EB9'] } },
  { id: 'daylight', name: 'Daylight', family: 'glass', scheme: 'light', bestFor: ['lcd'],
    description: 'Paper-white glass with indigo and coral.',
    palette: { base: '#F2F1EE', a: '#5B4BF5', b: '#FF7A59', ink: '#15141A', ink2: 'rgb(21 20 26 / .64)', ink3: 'rgb(21 20 26 / .45)',
      glass: 'rgb(255 255 255 / .55)', glassHi: 'rgb(255 255 255 / .75)', glassSolid: 'rgb(255 255 255 / .92)',
      rim: 'rgb(20 20 40 / .1)', rimTop: 'rgb(255 255 255 / .9)', rimBottom: 'rgb(20 20 40 / .12)', shadow: '0 30px 60px -32px rgb(40 30 90 / .35)' },
    backdrop: { kind: 'mesh', colours: ['#F2F1EE', '#DCD8FF', '#FFE1D6', '#F7F6F3'] },
    chart: { series: ['#5B4BF4', '#E45937'] } },
  // Light glass. Palettes from well-known open colour schemes (Catppuccin Latte) and two of our own.
  { id: 'latte', name: 'Latte', family: 'glass', scheme: 'light', bestFor: ['lcd'],
    description: 'Catppuccin Latte: soft pastels, mauve and blue, under milky glass.',
    palette: { base: '#EFF1F5', a: '#8839EF', b: '#1E66F5', c: '#EA76CB', ...lightGlass('#4C4F69', '76 79 105') },
    backdrop: { kind: 'mesh', colours: ['#EFF1F5', '#E2D4FB', '#D3E2FD', '#FBDDF1'] },
    status: { P1: '#D20F39', P2: '#DF8E1D', P4: '#179299' },
    chart: { series: ['#7A2FE0', '#1A5CDC'] } },
  { id: 'blossom', name: 'Blossom', family: 'glass', scheme: 'light', bestFor: ['lcd'],
    description: 'Cherry pink and peach drifting under frosted glass, like spring light.',
    palette: { base: '#FBF3F4', a: '#D6336C', b: '#F08C00', c: '#AE3EC9', ...lightGlass('#2B1A22', '43 26 34') },
    backdrop: { kind: 'mesh', colours: ['#FBF3F4', '#FFD6E2', '#FFE5CC', '#F3D9FA'] },
    chart: { series: ['#C2255C', '#C76E00'] } },
  { id: 'lagoon', name: 'Lagoon', family: 'glass', scheme: 'light', bestFor: ['lcd'],
    description: 'Clear aqua and sky blue, like looking through shallow water.',
    palette: { base: '#F0F7F8', a: '#0C8599', b: '#1971C2', c: '#2B8A3E', ...lightGlass('#0F2A30', '15 42 48') },
    backdrop: { kind: 'mesh', colours: ['#F0F7F8', '#C5F6FA', '#D0EBFF', '#D3F9D8'] },
    chart: { series: ['#0B7285', '#1864AB'] } },

  // ── Screen-tuned ──
  { id: 'oled-black', name: 'OLED Black', family: 'screen', scheme: 'dark', bestFor: ['oled', 'battery'],
    description: 'True black: OLED pixels switch off for the biggest battery saving. Off-white text avoids halation.',
    palette: { base: '#000000', a: '#7DA2FF', b: '#5ED3B0', ink: '#E8E8EA', ink2: 'rgb(232 232 234 / .66)', ink3: 'rgb(232 232 234 / .44)',
      glass: '#0B0B0D', glassHi: '#151518', glassSolid: '#0B0B0D', rim: 'rgb(255 255 255 / .11)', rimTop: 'rgb(255 255 255 / .17)', rimBottom: 'rgb(255 255 255 / .05)',
      shadow: 'none' },
    chart: { series: ['#5283E0', '#36A980'] } },
  { id: 'graphite', name: 'Graphite', family: 'screen', scheme: 'dark', bestFor: ['lcd'],
    description: 'Material dark grey (#121212): no black smearing when scrolling, and visible depth on LCD and IPS screens.',
    palette: { base: '#121212', a: '#8AB4F8', b: '#81C995', ink: 'rgb(255 255 255 / .87)', ink2: 'rgb(255 255 255 / .62)', ink3: 'rgb(255 255 255 / .42)',
      glass: '#1E1E1E', glassHi: '#262626', glassSolid: '#1E1E1E', rim: 'rgb(255 255 255 / .09)', rimTop: 'rgb(255 255 255 / .15)', rimBottom: 'rgb(0 0 0 / .4)',
      shadow: '0 18px 40px -24px rgb(0 0 0 / .9)', onAccent: '#0B1A33' },
    chart: { series: ['#4F8BD6', '#57A45B'] } },
  { id: 'paper', name: 'Paper', family: 'screen', scheme: 'light', bestFor: ['lcd'],
    description: 'Clean white surfaces on soft grey, for offices and bright rooms.',
    palette: { base: '#F4F4F1', a: '#3D5AFE', b: '#00897B', ink: '#17161C', ink2: 'rgb(23 22 28 / .68)', ink3: 'rgb(23 22 28 / .5)',
      glass: '#FFFFFF', glassHi: '#FAFAF8', glassSolid: '#FFFFFF', rim: 'rgb(20 20 30 / .11)', rimTop: 'rgb(20 20 30 / .07)', rimBottom: 'rgb(20 20 30 / .16)',
      shadow: '0 16px 36px -26px rgb(20 20 40 / .35)' },
    chart: { series: ['#3959DA', '#169483'] } },
  { id: 'snow', name: 'Snow', family: 'screen', scheme: 'light', bestFor: ['lcd'],
    description: 'Nord’s Snow Storm whites with its frost blues: cool, quiet and easy to scan.',
    palette: { base: '#E5E9F0', a: '#5E81AC', b: '#88C0D0', c: '#B48EAD', ...lightSolid('#2E3440', '46 52 64', '#F4F6F9', '#ECEFF4'), onAccent: '#FFFFFF' },
    status: { P1: '#BF616A', P2: '#D08770', P3: '#5E81AC', P4: '#8FBCBB' },
    chart: { series: ['#4C6F9C', '#3E8FA0'] } },
  { id: 'github-light', name: 'Primer', family: 'screen', scheme: 'light', bestFor: ['lcd', 'projector'],
    description: 'GitHub’s light interface colours: white, crisp grey borders and one bright blue.',
    palette: { base: '#F6F8FA', a: '#0969DA', b: '#1A7F37', c: '#8250DF', ...lightSolid('#1F2328', '31 35 40'), onAccent: '#FFFFFF' },
    status: { P1: '#CF222E', P2: '#BC4C00', P3: '#0969DA', P4: '#1A7F37' },
    chart: { series: ['#0969DA', '#1A7F37'] } },

  // ── High visibility ──
  { id: 'sunlight', name: 'Sunlight', family: 'readability', scheme: 'light', bestFor: ['sunlight', 'low-vision'],
    description: 'Black on white with bold text and solid borders, readable outdoors in glare (AAA contrast).',
    palette: { base: '#FFFFFF', a: '#0038B8', b: '#A34700', ink: '#000000', ink2: '#262626', ink3: '#474747',
      glass: '#FFFFFF', glassHi: '#F0F0F0', glassSolid: '#FFFFFF', rim: '#1A1A1A', rimTop: '#1A1A1A', rimBottom: '#1A1A1A', shadow: 'none', onAccent: '#FFFFFF' },
    status: { P1: '#B00020', P2: '#A34700', P3: '#0038B8', P4: '#00695C' },
    chart: { series: ['#0647C1', '#B85F03'], priority: { P1: '#BB061E', P2: '#C67705', P3: '#0647C1', P4: '#1C8742' } } },
  { id: 'projector', name: 'Projector', family: 'readability', scheme: 'light', bestFor: ['projector'],
    description: 'Navy text on light stone with one teal accent. Survives washed-out projectors; no subtle gradients.',
    palette: { base: '#F3F1EA', a: '#005F73', b: '#B26B00', ink: '#0B1B3A', ink2: '#2E3B57', ink3: '#55617A',
      glass: '#FFFFFF', glassHi: '#FAF8F2', glassSolid: '#FFFFFF', rim: 'rgb(11 27 58 / .28)', rimTop: 'rgb(11 27 58 / .2)', rimBottom: 'rgb(11 27 58 / .34)',
      shadow: 'none', onAccent: '#FFFFFF' },
    typography: { scale: 1.08, weightBoost: 50 },
    status: { P1: '#B42318', P2: '#B26B00', P3: '#005F73', P4: '#3F5F2A' },
    chart: { series: ['#0660A5', '#B87505'], priority: { P1: '#BB061E', P2: '#C67705', P3: '#0647C1', P4: '#1C8742' } } },
  { id: 'high-contrast', name: 'High contrast', family: 'readability', scheme: 'dark', bestFor: ['low-vision', 'oled'],
    description: 'White and yellow on black with thick borders. For low vision and very dim or very bright rooms.',
    palette: { base: '#000000', a: '#FFD60A', b: '#00E5FF', ink: '#FFFFFF', ink2: '#E6E6E6', ink3: '#BDBDBD',
      glass: '#000000', glassHi: '#1C1C1C', glassSolid: '#000000', rim: '#FFFFFF', rimTop: '#FFFFFF', rimBottom: '#FFFFFF', shadow: 'none', onAccent: '#000000' },
    status: { P1: '#FF5C5C', P2: '#FFB020', P3: '#00E5FF', P4: '#9BF59B' },
    chart: { series: ['#C78116', '#12A3BE'], priority: { P1: '#D01C29', P2: '#C58718', P3: '#1A9CB5', P4: '#4F9B3E' } } },

  // ── Comfort ──
  { id: 'night', name: 'Night', family: 'comfort', scheme: 'dark', bestFor: ['night'],
    description: 'Warm amber on dark walnut with very little blue, for late hours in a dark room.',
    palette: { base: '#110C07', a: '#E9A23B', b: '#D2693F', ink: '#F3E2CC', ink2: 'rgb(243 226 204 / .66)', ink3: 'rgb(243 226 204 / .44)',
      glass: '#1B140D', glassHi: '#241A11', glassSolid: '#1B140D', rim: 'rgb(255 214 170 / .11)', rimTop: 'rgb(255 214 170 / .18)', rimBottom: 'rgb(0 0 0 / .4)',
      shadow: '0 18px 40px -24px rgb(0 0 0 / .9)', onAccent: '#1A1006' },
    status: { P1: '#FF6B4A', P2: '#E9A23B', P3: '#D9B38C', P4: '#9DB08A' },
    chart: { series: ['#CB8315', '#14938D'] } },
  { id: 'dawn', name: 'Dawn', family: 'comfort', scheme: 'light', bestFor: ['lcd', 'night'],
    description: 'Rosé Pine Dawn: warm parchment with pine, rose and iris. Gentle on the eyes in daylight.',
    palette: { base: '#FAF4ED', a: '#286983', b: '#D7827E', c: '#907AA9', ...lightSolid('#575279', '87 82 121', '#FFFAF3', '#F2E9E1'), onAccent: '#FFFAF3' },
    status: { P1: '#B4637A', P2: '#EA9D34', P3: '#286983', P4: '#56949F' },
    chart: { series: ['#286983', '#B4637A'] } },
  { id: 'solarized-light', name: 'Solarized', family: 'comfort', scheme: 'light', bestFor: ['lcd', 'sunlight'],
    description: 'Solarized Light: low-glare cream with blue and magenta, tuned for long reading.',
    palette: { base: '#FDF6E3', a: '#268BD2', b: '#D33682', c: '#2AA198', ...lightSolid('#073642', '7 54 66', '#FFFBF0', '#EEE8D5'), onAccent: '#FDF6E3' },
    status: { P1: '#DC322F', P2: '#CB4B16', P3: '#268BD2', P4: '#859900' },
    chart: { series: ['#1F78B8', '#B52C6E'] } },
  { id: 'everforest-light', name: 'Forest', family: 'comfort', scheme: 'light', bestFor: ['lcd'],
    description: 'Everforest Light: soft green and aqua on warm paper, calm for long sessions.',
    palette: { base: '#FDF6E3', a: '#8DA101', b: '#35A77C', c: '#3A94C5', ...lightSolid('#5C6A72', '92 106 114', '#FFFBEF', '#F4F0D9'), onAccent: '#2D353B' },
    status: { P1: '#F85552', P2: '#F57D26', P3: '#3A94C5', P4: '#35A77C' },
    chart: { series: ['#6F8000', '#2A8A66'] } },
  { id: 'okabe-ito-light', name: 'Okabe–Ito light', family: 'comfort', scheme: 'light', bestFor: ['colour-blind'],
    description: 'Blue and orange accents and status colours that stay distinct for every common type of colour blindness.',
    palette: { base: '#F6F7F9', a: '#0072B2', b: '#D55E00', c: '#009E73', ...lightSolid('#14171C', '20 23 28'), onAccent: '#FFFFFF' },
    status: { P1: '#C2460D', P2: '#A86B00', P3: '#0F68A2', P4: '#127A55' },
    chart: { series: ['#0072B2', '#C25200'], priority: { P1: '#BB0A10', P2: '#BF7B0E', P3: '#0C6493', P4: '#308639' } } },
  { id: 'okabe-ito', name: 'Okabe–Ito', family: 'comfort', scheme: 'dark', bestFor: ['colour-blind'],
    description: 'Sky blue and orange accents and colour-blind-safe status colours that stay distinct for every common type of colour blindness.',
    palette: { base: '#0F1115', a: '#56B4E9', b: '#E69F00', c: '#009E73', ink: '#F2F4F7', ink2: 'rgb(242 244 247 / .66)', ink3: 'rgb(242 244 247 / .44)',
      glass: '#181B21', glassHi: '#20242C', glassSolid: '#181B21', rim: 'rgb(255 255 255 / .11)', rimTop: 'rgb(255 255 255 / .17)', rimBottom: 'rgb(0 0 0 / .4)',
      shadow: '0 18px 40px -24px rgb(0 0 0 / .9)', onAccent: '#06121B' },
    status: { P1: '#E8702A', P2: '#F0C24B', P3: '#56B4E9', P4: '#3FBF8F' },
    chart: { series: ['#3C96C5', '#C98002'], priority: { P1: '#CC2A1B', P2: '#C58718', P3: '#299ABE', P4: '#4F9B3E' } } },
]
