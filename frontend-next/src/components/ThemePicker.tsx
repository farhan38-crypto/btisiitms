// Appearance panel. Built from the theme registry, so new themes and new kinds of theme
// (families) appear here without changing this file:
//   • Match this device (auto light/dark, with a theme chosen for each)
//   • Suggested for this screen right now, with the reason
//   • Filter by kind (family) and by what the theme is best for, plus search
//   • Live preview: hovering a card shows the theme; clicking applies it with a reveal
//   • Display options that apply on top of any theme
import { AnimatePresence, motion } from 'motion/react'
import { Palette, Check, Search, X, MonitorSmartphone, Sparkles, Eye, Layers, Wind, PanelTop, PanelLeft, Sun, Moon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../lib/auth'
import { useSchemeToggle } from './SchemeToggle'
import { LAYOUTS, setLayout, setNav, useLayout, useNav, type Layout, type Nav } from '../lib/layout'
import { allFamilies, allThemes, resolveTheme, suggestions, AUTO, type ResolvedTheme, type ThemeDefinition,
  CUSTOM_ID, SWATCHES, fromHex, gradientCss, sameGradient, setGradient, setSavedGradients, toCss, toHex, useGradient, useSavedGradients, type Gradient, type Hsb } from '../themes'

const BEFORE_AUTO = 'bits_theme_before_auto'
const readBeforeAuto = () => { try { const v = localStorage.getItem(BEFORE_AUTO); return v && v !== AUTO && allThemes().some(t => t.id === v) ? v : null } catch { return null } }

const TAG_LABEL: Record<string, string> = { oled: 'OLED', lcd: 'LCD', sunlight: 'Sunlight', projector: 'Projector', night: 'Night',
  'colour-blind': 'Colour-blind safe', 'low-vision': 'Low vision', battery: 'Battery' }
const tagLabel = (t: string) => TAG_LABEL[t] || t.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase())

/** Open the Appearance panel from anywhere (the phone "You" sheet, the command palette). */
export const openAppearance = () => window.dispatchEvent(new Event('bits:appearance'))

/** The panel itself; mounted once by the shell. */
export function AppearanceHost() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const o = () => setOpen(true)
    window.addEventListener('bits:appearance', o)
    return () => window.removeEventListener('bits:appearance', o)
  }, [])
  return createPortal(<AnimatePresence>{open && <Panel onClose={() => setOpen(false)} />}</AnimatePresence>, document.body)
}

export function ThemePicker() {
  return <button className="icon-btn" aria-label="Appearance" title="Appearance" onClick={openAppearance}><Palette size={18} /></button>
}

function Panel({ onClose }: { onClose: () => void }) {
  const { theme, themeId, setTheme, prefs, setPrefs, preview } = useAuth()
  const [family, setFamily] = useState<string>('all')
  const [tags, setTags] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const families = allFamilies()
  // Only the themes for the current mode: dark themes in dark mode, light ones in light mode
  // (the sun/moon switch changes mode).
  const themes = allThemes().filter(t => t.scheme === theme.scheme)
  const allTags = useMemo(() => [...new Set(themes.flatMap(t => t.bestFor || []))], [themes])
  const sugg = useMemo(() => suggestions().filter(s => themes.some(t => t.id === s.id)), [themes])
  const scheme = useSchemeToggle()
  const hoverTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', esc)
    return () => { removeEventListener('keydown', esc); preview(null) }
  }, [onClose, preview])

  const shown = themes.filter(t => (family === 'all' || t.family === family)
    && [...tags].every(tag => t.bestFor?.includes(tag))
    && (!q.trim() || `${t.name} ${t.description} ${(t.bestFor || []).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase())))
  const groups = families.map(f => ({ f, items: shown.filter(t => t.family === f.id) })).filter(g => g.items.length)

  const peek = (id: string | null) => { window.clearTimeout(hoverTimer.current); hoverTimer.current = window.setTimeout(() => preview(id), id ? 140 : 60) }
  const pick = (id: string, e?: MouseEvent) => { window.clearTimeout(hoverTimer.current); setTheme(id, e ? { x: e.clientX, y: e.clientY } : undefined) }
  const toggleTag = (t: string) => setTags(s => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n })
  const lightThemes = themes.filter(t => t.scheme === 'light'), darkThemes = themes.filter(t => t.scheme === 'dark')

  return (
    <>
      <motion.div className="ap-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.aside className="ap" role="dialog" aria-label="Appearance" aria-modal="true"
        initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }} transition={{ type: 'spring', stiffness: 380, damping: 36 }}>
        <header className="ap-head">
          <div><h2>Appearance</h2><p>Saved to your account, so it follows you to every device.</p></div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>

        <div className="ap-body">
          <LayoutChooser />
          {/* Match this device */}
          <section className={`ap-auto${themeId === AUTO ? ' on' : ''}`}>
            <button type="button" className="ap-auto-main" aria-pressed={themeId === AUTO} onClick={e => {
              // Turning "Match this device" off goes back to the theme chosen before it was turned on.
              if (themeId === AUTO) { pick(readBeforeAuto() || theme.id, e) }
              else { try { localStorage.setItem(BEFORE_AUTO, themeId) } catch { /* ignore */ } pick(AUTO, e) }
            }}>
              <MonitorSmartphone size={20} />
              <span><b>Match this device</b><small>Light theme by day, dark theme when your device is in dark mode.</small></span>
              <i className="ap-switch" aria-hidden />
            </button>
            {themeId === AUTO && (
              <div className="ap-auto-pair">
                <label><span>Light</span><select value={prefs.auto_light} onChange={e => setPrefs({ auto_light: e.target.value })}>{lightThemes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
                <label><span>Dark</span><select value={prefs.auto_dark} onChange={e => setPrefs({ auto_dark: e.target.value })}>{darkThemes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
              </div>
            )}
          </section>
          <GradientMaker />

          {sugg.length > 0 && (
            <section className="ap-sugg">
              <h3><Sparkles size={14} />Suggested for this screen</h3>
              <div>{sugg.map(s => {
                const t = themes.find(x => x.id === s.id)!
                return <button key={s.id} type="button" className="ap-sugg-item" data-on={theme.id === s.id || undefined}
                  onPointerEnter={() => peek(s.id)} onPointerLeave={() => peek(null)} onClick={e => pick(s.id, e)}>
                  <Dots t={t} /><span><b>{t.name}</b><small>{s.why}</small></span></button>
              })}</div>
            </section>
          )}

          <div className="ap-mode">
            <span>Showing <b>{theme.scheme} themes</b> ({themes.length})</span>
            <button type="button" className="btn sm" onClick={e => scheme.toggle(e)}>{scheme.dark ? <><Sun size={14} />Show light themes</> : <><Moon size={14} />Show dark themes</>}</button>
          </div>
          <section className="ap-filters">
            <label className="ap-search"><Search size={15} /><input placeholder="Search themes" value={q} onChange={e => setQ(e.target.value)} /></label>
            <div className="ap-chips" role="group" aria-label="Kind of theme">
              <button type="button" data-on={family === 'all' || undefined} onClick={() => setFamily('all')}>All</button>
              {families.map(f => <button type="button" key={f.id} data-on={family === f.id || undefined} onClick={() => setFamily(f.id)}>{f.name}</button>)}
            </div>
            <div className="ap-chips ap-tags" role="group" aria-label="Best for">
              <span>Best for</span>
              {allTags.map(t => <button type="button" key={t} aria-pressed={tags.has(t)} data-on={tags.has(t) || undefined} onClick={() => toggleTag(t)}>{tagLabel(t)}</button>)}
            </div>
          </section>

          {groups.length === 0 && <p className="ap-empty">No theme matches. <button type="button" className="link" onClick={() => { setQ(''); setTags(new Set()); setFamily('all') }}>Clear filters</button></p>}
          {groups.map(({ f, items }) => (
            <section key={f.id} className="ap-group">
              <h3>{f.name}</h3><p>{f.description}</p>
              <div className="ap-grid" role="radiogroup" aria-label={f.name}>
                {items.map(t => <Card key={t.id} t={t} on={theme.id === t.id && themeId !== AUTO} onPeek={peek} onPick={pick} />)}
              </div>
            </section>
          ))}

          <section className="ap-display">
            <h3>Display</h3>
            <Toggle icon={Layers} label="Solid panels" hint="Turn off the frosted-glass see-through effect. Sharper text, lighter on older laptops."
              on={prefs.reduce_transparency} set={v => setPrefs({ reduce_transparency: v })} />
            <Toggle icon={Wind} label="Calmer motion" hint="Fewer and gentler animations everywhere."
              on={prefs.reduce_motion} set={v => setPrefs({ reduce_motion: v })} />
            <Toggle icon={Eye} label="Colour-blind-safe status colours" hint="Urgent, high, normal and low use colours that stay distinct for every common type of colour blindness."
              on={prefs.colour_safe} set={v => setPrefs({ colour_safe: v })}
              extra={<span className="ap-prio">{(['P1', 'P2', 'P3', 'P4'] as const).map(p => <i key={p} style={{ background: theme.status[p] }} title={p} />)}</span>} />
          </section>
        </div>
      </motion.aside>
    </>
  )
}

const Dots = ({ t }: { t: ThemeDefinition }) => (
  <span className="ap-dots" style={{ background: t.palette.base }}>{[t.palette.a, t.palette.b, t.palette.c].filter(Boolean).map((c, i) => <i key={i} style={{ background: c }} />)}</span>
)

// A small drawing of the app in that theme: page, a panel, a heading, text and the accents.
function Card({ t, on, onPeek, onPick }: { t: ThemeDefinition; on: boolean; onPeek: (id: string | null) => void; onPick: (id: string, e: MouseEvent) => void }) {
  const r: ResolvedTheme = resolveTheme(t.id)
  const p = r.palette
  const bg = r.backdrop.kind === 'mesh' ? `radial-gradient(120% 90% at 20% 10%, ${r.mesh[1] || p.base}, transparent 60%), radial-gradient(100% 90% at 90% 90%, ${r.mesh[2] || p.base}, transparent 60%), ${p.base}` : p.base
  return (
    <button type="button" role="radio" aria-checked={on} className="ap-card" data-on={on || undefined}
      onPointerEnter={() => onPeek(t.id)} onPointerLeave={() => onPeek(null)} onFocus={() => onPeek(t.id)} onBlur={() => onPeek(null)}
      onClick={e => onPick(t.id, e)} style={{ '--k': p.a } as CSSProperties}>
      <span className="ap-mock" style={{ background: bg, borderColor: p.rim }} aria-hidden>
        <span className="ap-mock-bar" style={{ background: p.glass, borderColor: p.rim }}><i style={{ background: p.a }} /><i style={{ background: p.ink3 }} /></span>
        <span className="ap-mock-panel" style={{ background: r.surfaces.translucent ? p.glass : p.glassSolid, borderColor: p.rimTop, borderWidth: r.surfaces.rimWidth || 1 }}>
          <b style={{ background: p.ink }} /><s style={{ background: p.ink3 }} /><s style={{ background: p.ink3, width: '60%' }} />
          <span className="ap-mock-chips"><i style={{ background: p.a }} /><i style={{ background: p.b }} />{p.c && <i style={{ background: p.c }} />}</span>
        </span>
      </span>
      <span className="ap-card-name">{t.name}{on && <Check size={15} />}</span>
      <span className="ap-card-desc">{t.description}</span>
      {t.bestFor && <span className="ap-card-tags">{t.bestFor.map(x => <em key={x}>{tagLabel(x)}</em>)}</span>}
    </button>
  )
}

function Toggle({ icon: Icon, label, hint, on, set, extra }: { icon: typeof Eye; label: string; hint: string; on: boolean; set: (v: boolean) => void; extra?: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="ap-toggle" data-on={on || undefined} onClick={() => set(!on)}>
      <Icon size={18} /><span><b>{label}{extra}</b><small>{hint}</small></span><i className="ap-switch" aria-hidden />
    </button>
  )
}

/** Small sketches of each layout with the chosen navigation, so the choice is visible before it is made. */
function LayoutSketch({ id, nav }: { id: Layout; nav: Nav }) {
  const f = 'currentColor'
  const side = nav === 'side'
  const x0 = side ? 32 : 6, w = 120 - x0 - 6, y0 = side ? 6 : 18
  const glass = id === 'glass'
  const box = (x: number, y: number, bw: number, bh: number, o = .16, k?: string | number) =>
    <rect key={k ?? `${x}-${y}`} x={x} y={y} width={bw} height={bh} rx={glass ? 4 : 2} fill={glass ? 'url(#lay-g)' : f} opacity={glass ? o * 2.2 : o} />
  const col = (n: number, gap = 3) => Array.from({ length: n }, (_, i) => x0 + i * ((w + gap) / n))
  const cw = (n: number, gap = 3) => (w + gap) / n - gap
  return (
    <svg viewBox="0 0 120 72" aria-hidden className="ap-lay-svg">
      <defs><linearGradient id="lay-g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="var(--a)" /><stop offset="1" stopColor="var(--b)" /></linearGradient></defs>
      <rect x="0.5" y="0.5" width="119" height="71" rx="6" fill="none" stroke={f} opacity=".25" />
      {side ? <><rect x="4" y="4" width="24" height="64" rx="3" fill={f} opacity=".14" />
        {[12, 19, 26, 33].map(y => <rect key={y} x="8" y={y} width="15" height="3" rx="1.5" fill={f} opacity={y === 12 ? .7 : .3} />)}</>
        : <><rect x="6" y="5" width="108" height="8" rx="4" fill={f} opacity=".2" />
          {[24, 34, 44, 54, 64].map(x => <rect key={x} x={x} y="8" width="7" height="2" rx="1" fill={f} opacity=".55" />)}</>}
      {id === 'classic' ? <>
        <rect x={x0 + 4} y={y0 + 1} width={w * .5} height="6" rx="2" fill={f} opacity=".45" />
        {col(4).map(x => box(x, y0 + 11, cw(4), 10, .2))}
        {box(x0, y0 + 25, w, 66 - y0 - 25, .14)}
      </> : id === 'focused' ? <>
        {box(x0, y0, w, 6, .15)}
        {box(x0, y0 + 9, w * .55, 18, .2)}{box(x0 + w * .57, y0 + 9, w * .43, 18, .12)}
        {[0, 5, 10, 15].map(d => <rect key={d} x={x0} y={y0 + 31 + d} width={w * .62} height="3" rx="1.5" fill={f} opacity=".3" />)}
        {box(x0 + w * .66, y0 + 31, w * .34, 66 - y0 - 31, .12)}
      </> : <>
        {col(4).map((x, i) => box(x, y0, cw(4), 11, .2, i))}
        {box(x0, y0 + 14, w * .64, 20, .12)}
        {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <rect key={i} x={x0 + 4 + i * (w * .58 / 8)} y={y0 + 30 - (i % 3 + 1) * 4 - (i === 6 ? 4 : 0)} width="2.5"
          height={(i % 3 + 1) * 4 + (i === 6 ? 4 : 0)} rx="1" fill={glass ? 'url(#lay-g)' : f} opacity={i === 6 ? .9 : .35} />)}
        {box(x0 + w * .67, y0 + 14, w * .33, 20, .12)}
        {box(x0, y0 + 37, w, 66 - y0 - 37, .12)}
      </>}
    </svg>
  )
}

function LayoutChooser() {
  const layout = useLayout()
  const nav = useNav()
  return (
    <section className="ap-group ap-layouts">
      <div className="ap-lay-head">
        <div><h3>Layout</h3><p>How the screens are arranged. Works with any theme below.</p></div>
        <div className="seg ap-nav" role="radiogroup" aria-label="Navigation">
          {(['top', 'side'] as const).map(n => <button key={n} type="button" role="radio" aria-checked={nav === n} data-on={nav === n || undefined} onClick={() => setNav(n)}>
            {n === 'top' ? <PanelTop size={15} /> : <PanelLeft size={15} />}{n === 'top' ? 'Top bar' : 'Side bar'}</button>)}
        </div>
      </div>
      <div className="ap-lay" role="radiogroup" aria-label="Layout">
        {LAYOUTS.map(l => (
          <button key={l.id} type="button" role="radio" aria-checked={layout === l.id} className="ap-lay-card" data-on={layout === l.id || undefined} onClick={() => setLayout(l.id)}>
            <LayoutSketch id={l.id} nav={nav} />
            <b>{l.label}{layout === l.id && <Check size={14} />}</b>
            <small>{l.description}</small>
          </button>
        ))}
      </div>
    </section>
  )
}

/** Make your own theme from one, two or three colours. Any edit switches to it. */
function GradientMaker() {
  const { themeId, setTheme } = useAuth()
  const g = useGradient()
  const saved = useSavedGradients()
  const [sel, setSel] = useState(0)
  const idx = Math.min(sel, g.colors.length - 1)
  const stop = g.colors[idx]!
  const [hex, setHex] = useState(toHex(stop))
  useEffect(() => { setHex(toHex(stop)) }, [stop.h, stop.s, stop.b]) // eslint-disable-line react-hooks/exhaustive-deps
  const on = themeId === CUSTOM_ID
  const edit = (next: Gradient) => { setGradient(next); if (!on) setTheme(CUSTOM_ID) }
  const setStop = (c: Hsb) => edit({ ...g, colors: g.colors.map((x, i) => (i === idx ? c : x)) })
  const setCount = (n: number) => {
    const colors = g.colors.slice(0, n)
    while (colors.length < n) { const last = colors[colors.length - 1]!; colors.push({ h: (last.h + 0.14) % 1, s: last.s, b: last.b }) }
    setSel(Math.min(sel, n - 1)); edit({ ...g, colors })
  }
  const isSaved = saved.some(x => sameGradient(x, g))
  return (
    <section className={`ap-grad${on ? ' on' : ''}`}>
      <header>
        <div><h3>Your gradient</h3><p>Make a theme from one, two or three colours. Saved with your account.</p></div>
        {!on && <button type="button" className="btn sm" onClick={e => setTheme(CUSTOM_ID, { x: e.clientX, y: e.clientY })}>Use it</button>}
      </header>
      <div className="ap-grad-preview" style={{ background: gradientCss(g) }}>
        {g.colors.map((c, i) => (
          <button key={i} type="button" className="ap-grad-stop" data-on={i === idx || undefined} style={{ background: toCss(c) }}
            onClick={() => setSel(i)} aria-label={`Colour ${i + 1}, #${toHex(c)}`} />))}
      </div>
      <div className="ap-grad-row">
        <div className="seg" role="radiogroup" aria-label="Number of colours">
          {[1, 2, 3].map(n => <button key={n} type="button" role="radio" aria-checked={g.colors.length === n} data-on={g.colors.length === n || undefined} onClick={() => setCount(n)}>
            {n === 1 ? 'One' : n === 2 ? 'Two' : 'Three'}</button>)}
        </div>
        <label className="ap-grad-hex"><input type="color" value={`#${toHex(stop)}`} onChange={e => { const c = fromHex(e.target.value); if (c) setStop(c) }} aria-label="Pick a colour" />
          <input className="input" value={hex} maxLength={7} spellCheck={false} aria-label="Hex colour" onChange={e => setHex(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') { const c = fromHex(hex); if (c) setStop(c) } }} onBlur={() => { const c = fromHex(hex); if (c) setStop(c); else setHex(toHex(stop)) }} /></label>
      </div>
      <Slider label="Hue" value={stop.h} onChange={v => setStop({ ...stop, h: v })}
        track={[0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1].map(h => toCss({ h: h % 1, s: Math.max(stop.s, 0.5), b: Math.max(stop.b, 0.6) }))} />
      <Slider label="Saturation" value={stop.s} onChange={v => setStop({ ...stop, s: v })} track={[toCss({ ...stop, s: 0 }), toCss({ ...stop, s: 1 })]} />
      <Slider label="Brightness" value={stop.b} onChange={v => setStop({ ...stop, b: v })} track={['#000', toCss({ ...stop, b: 1 })]} />
      {g.colors.length > 1 && <Slider label="Angle" value={g.angle / 360} onChange={v => edit({ ...g, angle: Math.round(v * 360) })} text={`${Math.round(g.angle)}°`} />}
      <div className="ap-grad-swatches" role="group" aria-label="Quick colours">
        {SWATCHES.map((c, i) => <button key={i} type="button" style={{ background: toCss(c) }} onClick={() => setStop(c)} aria-label={`Use #${toHex(c)}`} title={`#${toHex(c)}`} />)}
      </div>
      <div className="ap-grad-saved">
        <button type="button" className="btn sm" disabled={isSaved} onClick={() => setSavedGradients([g, ...saved])}>{isSaved ? <><Check size={14} />Saved</> : 'Save this gradient'}</button>
        {saved.map((x, i) => (
          <span key={i} className="ap-grad-saved-item" data-on={(on && sameGradient(x, g)) || undefined}>
            <button type="button" style={{ background: gradientCss(x) }} onClick={() => edit(x)} aria-label={`Use saved gradient ${i + 1}`} />
            <button type="button" className="ap-grad-del" onClick={() => setSavedGradients(saved.filter(y => y !== x))} aria-label="Delete this gradient"><X size={11} /></button>
          </span>))}
      </div>
    </section>
  )
}

function Slider({ label, value, onChange, track, text }: { label: string; value: number; onChange: (v: number) => void; track?: string[]; text?: string }) {
  return (
    <label className="ap-slider">
      <span>{label}</span>
      <input type="range" min={0} max={1} step={0.001} value={value} onChange={e => onChange(Number(e.target.value))}
        style={track ? { '--track': `linear-gradient(90deg, ${track.join(', ')})` } as CSSProperties : undefined} />
      <em className="tabular">{text ?? `${Math.round(value * 100)}`}</em>
    </label>
  )
}
