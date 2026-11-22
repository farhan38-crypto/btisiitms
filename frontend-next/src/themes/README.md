# Themes

A theme is data. Add one and it appears in the Appearance panel, is saved per account, and is
applied everywhere: glass screens, ported classic screens (through `styles/classic-bridge.css`),
charts, map pins and the 3D sign-in object.

## Add a theme

1. Open `catalog.ts`, copy an entry from the family you want, and change:
   - `id`: lower-case letters, digits and `-`. It is saved with accounts, so never reuse an id.
   - `name`, `description`, `scheme` (`'dark'` or `'light'`), `bestFor` tags
     (`oled`, `lcd`, `sunlight`, `projector`, `night`, `colour-blind`, `low-vision`, `battery`, or a new tag).
   - `palette`: at least `base`, `a`, `b`. Anything left out comes from the scheme defaults.
2. Optional: `status` (P1–P4 colours), `typography` (`weightBoost`, `scale`), `surfaces`, `effects`, `backdrop`.
3. Optional but recommended: `chart.series` (two colours) and `chart.priority`. Check them with the
   dataviz validator so they stay readable for colour-blind people:
   `node <dataviz skill>/scripts/validate_palette.js "#hex,#hex" --mode dark --surface "#0E0E12"`.

No server change is needed: the backend stores any well-formed id.

## Add a whole new kind of theme

Register a family in `families.ts` with `registerFamily({ id, name, description, order, defaults })`.
`defaults(scheme)` decides how its themes are drawn: frosted or solid panels and the blur, what's behind
the page (`mesh` shader, static CSS `gradient`, or `solid`), effects (top light, 3D object, glow), and
type tweaks. The Appearance panel shows the new family as a filter and a section automatically.

For a look that needs new CSS, key it off the attributes `applyTheme` puts on `<html>`:
`data-theme`, `data-family`, `data-scheme`, `data-solid`, `data-glow`, `data-motion`.

## How it fits together

| File | Job |
| --- | --- |
| `types.ts` | The model: `ThemeDefinition`, `ThemeFamily`, `DisplayPrefs`, `ResolvedTheme` |
| `families.ts` | Kinds of theme and their defaults |
| `catalog.ts` | The built-in themes |
| `registry.ts` | Look-up, filling gaps from the family, display preferences, `auto`, suggestions |
| `apply.ts` | Writes CSS variables and data attributes on `<html>`; the circular reveal on switch |
| `../components/ThemePicker.tsx` | The Appearance panel, built from the registry |
| `../lib/auth.tsx` | Holds the choice, previews, saves it to the account |

Display preferences (`Solid panels`, `Calmer motion`, `Colour-blind-safe status colours`, and the
light/dark pair for "Match this device") apply on top of any theme and are saved with the account too.
