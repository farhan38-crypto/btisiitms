// The theme model. A theme is data, not code: add a file to src/themes/catalog (or call
// registerTheme) and it shows up in the picker, is saved per account and is applied
// everywhere. Families describe a *kind* of theme (frosted glass, solid screen-tuned,
// high visibility…) and supply defaults, so a new theme only lists what makes it different.

export type Scheme = 'dark' | 'light'

/** Screens or situations a theme is tuned for. Free-form so new tags can be added. */
export type ScreenTag = 'oled' | 'lcd' | 'sunlight' | 'projector' | 'night' | 'colour-blind' | 'low-vision' | 'battery' | (string & {})

export type Priority = 'P1' | 'P2' | 'P3' | 'P4'

/** Every colour the interface reads. Families fill in anything a theme leaves out. */
export interface Palette {
  base: string          // page background
  a: string; b: string; c?: string     // the theme's tones (accent, second, optional third)
  ink: string; ink2: string; ink3: string             // text: primary, secondary, muted
  glass: string; glassHi: string; glassSolid: string  // panel fill, hovered panel, opaque panel (menus, cards over maps)
  rim: string; rimTop: string; rimBottom: string      // panel borders (lit from above)
  shadow: string
  onAccent?: string     // text on an accent-filled button
}

export type Backdrop =
  | { kind: 'mesh'; colours: string[]; speed?: number; intensity?: number }   // moving shader gradient
  | { kind: 'gradient'; css: string }                                         // static CSS gradient
  | { kind: 'solid' }                                                         // just the base colour

export interface Surfaces {
  translucent: boolean  // frosted glass (backdrop blur) or solid panels
  blur: number          // px, when translucent
  rimWidth?: number     // px, thicker borders for high-visibility themes
  radius?: number       // px, panel corner radius
}

export interface Effects {
  light: boolean        // the top light and pointer rim light
  object3d: boolean     // 3D glass object on the sign-in page
  glow: boolean         // neon glows on pins and chips
}

export interface Typography { weightBoost?: number; scale?: number }

export interface ThemeDefinition {
  id: string                    // stable, lower-case, saved with the account (a-z, 0-9, '-')
  name: string
  description: string
  family: string                // id of a registered family
  scheme: Scheme
  bestFor?: ScreenTag[]
  palette: Partial<Palette> & Pick<Palette, 'base' | 'a' | 'b'>
  backdrop?: Backdrop
  surfaces?: Partial<Surfaces>
  effects?: Partial<Effects>
  typography?: Typography
  status?: Partial<Record<Priority, string>>                  // priority colours (P1 urgent … P4 low)
  chart?: { series?: [string, string]; priority?: Partial<Record<Priority, string>> }  // validated chart steps
}

export interface ThemeFamily {
  id: string
  name: string
  description: string
  order: number
  defaults: (scheme: Scheme) => {
    backdrop: Backdrop; surfaces: Surfaces; effects: Effects; typography: Typography
  }
}

/** Preferences that apply on top of any theme. */
export interface DisplayPrefs {
  reduce_transparency: boolean
  reduce_motion: boolean
  colour_safe: boolean
  auto_light?: string
  auto_dark?: string
}

/** A theme with every gap filled in: what components read (theme.a, theme.scheme…). */
export interface ResolvedTheme extends Omit<ThemeDefinition, 'palette' | 'backdrop' | 'surfaces' | 'effects' | 'typography' | 'status' | 'chart'> {
  key: string; label: string                  // aliases of id / name, used across the app
  base: string; a: string; b: string; c?: string; mesh: string[]
  palette: Palette
  backdrop: Backdrop
  surfaces: Surfaces
  effects: Effects
  typography: Required<Typography>
  status: Record<Priority, string>
  chart: { series: [string, string]; priority: Record<Priority, string> }
  prefs: DisplayPrefs
}
