// Appearance popover, ported from MiniMusic's ThemeButton / AppearanceSettings / GradientEditor.
//   • Round buttons for the looks: BITS reports' Original (light) and Indigo (dark), then
//     MiniMusic's AMOLED, Dark, Greenboard, Light and Gradient.
//   • A gradient editor: one, two or three colours, each set with hue / saturation / brightness
//     sliders, a hex field or the palette; an angle; and gradients you save to reuse.
//   • Any edit in the gradient editor switches to the Gradient look (as in MiniMusic).
import React, { useEffect, useRef, useState } from 'react';
import { Circle, Moon, Leaf, Sun, Palette, Sunrise, Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion } from '../motion';
import {
  APP_THEMES, PALETTE, toCss, toHex, fromHex, gradientCss, looksTheSame, normaliseAppearance
} from '../theme';

const ICONS = { circle: Circle, moon: Moon, leaf: Leaf, sun: Sun, palette: Palette, sunrise: Sunrise, sparkles: Sparkles };

export function ThemeIcon({ theme, size = 17 }) {
  const Icon = ICONS[APP_THEMES.find(t => t.key === theme)?.icon] || Sun;
  return <Icon size={size} fill={theme === 'amoled' ? 'currentColor' : 'none'} />;
}

export default function ThemeMenu({ appearance, onChange }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = e => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const title = APP_THEMES.find(t => t.key === appearance.theme)?.title;
  return (
    <div className="theme-wrap" ref={box}>
      <button type="button" className="icon-btn circle-icon" onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog" aria-expanded={open} aria-label={`Appearance: ${title}`}
        title="Appearance: Original, Indigo, AMOLED, Dark, Greenboard, Light or your own gradient">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={appearance.theme} style={{ display: 'grid' }}
            initial={{ scale: 0.5, opacity: 0, rotate: -60 }} animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.5, opacity: 0, rotate: 60 }} transition={{ duration: 0.2 }}>
            <ThemeIcon theme={appearance.theme} />
          </motion.span>
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div className="appearance-pop" role="dialog" aria-label="Appearance"
            initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 38 }}>
            <AppearanceSettings appearance={appearance} onChange={onChange} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AppearanceSettings({ appearance, onChange }) {
  return (
    <div className="appearance">
      <div className="look-row" role="radiogroup" aria-label="Look">
        {APP_THEMES.map(t => {
          const on = appearance.theme === t.key;
          return (
            <button key={t.key} type="button" role="radio" aria-checked={on} className={`look${on ? ' on' : ''}`}
              onClick={e => onChange({ ...appearance, theme: t.key }, e)}>
              <span className="look-icon"><ThemeIcon theme={t.key} size={16} /></span>
              <span className="look-title">{t.title}</span>
            </button>
          );
        })}
      </div>
      <hr className="appearance-divider" />
      <GradientEditor appearance={appearance} onChange={onChange} />
    </div>
  );
}

// Builds a gradient from one, two or three colours. Any change switches to the Gradient look.
function GradientEditor({ appearance, onChange }) {
  const gradient = appearance.gradient;
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, gradient.colors.length - 1);
  const stop = gradient.colors[index];
  const [hexText, setHexText] = useState(toHex(stop));
  useEffect(() => { setHexText(toHex(stop)); }, [stop.h, stop.s, stop.b]); // eslint-disable-line

  const isGradient = appearance.theme === 'gradient';
  const isSaved = appearance.saved_gradients.some(p => looksTheSame(p, gradient));

  const edit = change => {
    const next = { colors: gradient.colors.map(c => ({ ...c })), angle: gradient.angle };
    change(next);
    onChange({ ...appearance, gradient: next, theme: 'gradient' }, null, { live: true });
  };
  const setStop = color => edit(g => { g.colors[index] = color; });
  const setPart = (part, value) => setStop({ ...stop, [part]: value });

  const setCount = count => {
    edit(g => {
      while (g.colors.length < count) {
        const last = g.colors[g.colors.length - 1];
        g.colors.push({ ...last, h: (last.h + 0.12) % 1 });
      }
      while (g.colors.length > Math.max(count, 1)) g.colors.pop();
    });
    setSelected(s => Math.min(s, count - 1));
  };

  const save = () => {
    if (isSaved) return;
    onChange(normaliseAppearance({ ...appearance, saved_gradients: [gradient, ...appearance.saved_gradients] }));
  };
  const apply = preset => onChange({ ...appearance, gradient: preset, theme: 'gradient' });
  const remove = preset => onChange({ ...appearance, saved_gradients: appearance.saved_gradients.filter(p => p !== preset) });

  return (
    <div className="gradient-editor">
      <div className="ge-head">
        <b>Gradient</b>
        {!isGradient && <button type="button" className="ge-small" onClick={e => onChange({ ...appearance, theme: 'gradient' }, e)}>Use Gradient</button>}
      </div>

      <div className="ge-preview" style={{ background: gradientCss(gradient) }} />

      <div className="ge-seg" role="radiogroup" aria-label="Colours">
        {[[1, 'Single'], [2, 'Two'], [3, 'Three']].map(([n, label]) => (
          <button key={n} type="button" role="radio" aria-checked={gradient.colors.length === n}
            className={gradient.colors.length === n ? 'on' : undefined} onClick={() => setCount(n)}>{label}</button>
        ))}
      </div>

      <div className="ge-stops">
        {gradient.colors.map((c, i) => (
          <button key={i} type="button" className={`ge-stop${i === index ? ' on' : ''}`} onClick={() => setSelected(i)}
            title={`Edit colour ${i + 1}`} aria-label={`Edit colour ${i + 1}`}>
            <i style={{ background: toCss(c) }} />
          </button>
        ))}
        <span className="ge-spacer" />
        <span className="ge-hash">#</span>
        <input className="ge-hex" value={hexText} maxLength={7} aria-label="Hex colour" spellCheck={false}
          onChange={e => setHexText(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          onBlur={() => { const c = fromHex(hexText); if (c) setStop(c); else setHexText(toHex(stop)); }} />
      </div>

      <GradientSlider title="Hue" value={stop.h} onChange={v => setPart('h', v)}
        colors={[0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1].map(h => toCss({ h: h % 1, s: Math.max(stop.s, 0.5), b: Math.max(stop.b, 0.6) }))} />
      <GradientSlider title="Saturation" value={stop.s} onChange={v => setPart('s', v)}
        colors={[toCss({ ...stop, s: 0 }), toCss({ ...stop, s: 1 })]} />
      <GradientSlider title="Brightness" value={stop.b} onChange={v => setPart('b', v)}
        colors={['#000', toCss({ ...stop, b: 1 })]} />

      <div className="ge-palette">
        {PALETTE.map((c, i) => (
          <button key={i} type="button" onClick={() => setStop(c)} aria-label={`Use #${toHex(c)}`} title={`#${toHex(c)}`}>
            <i style={{ background: toCss(c) }} />
          </button>
        ))}
      </div>

      {gradient.colors.length > 1 && (
        <label className="ge-angle">
          <span>Angle</span>
          <input type="range" min="0" max="360" step="1" value={gradient.angle}
            onChange={e => edit(g => { g.angle = Number(e.target.value); })} />
          <span className="ge-num">{Math.round(gradient.angle)}°</span>
        </label>
      )}

      <div className="ge-actions">
        <button type="button" className="ge-small" disabled={isSaved} onClick={save}>{isSaved ? 'Saved' : 'Save Gradient'}</button>
      </div>

      {appearance.saved_gradients.length > 0 && (
        <>
          <div className="ge-sub">Saved gradients</div>
          <div className="ge-saved">
            {appearance.saved_gradients.map((p, i) => (
              <span key={i} className={`ge-swatch${isGradient && looksTheSame(p, gradient) ? ' on' : ''}`}>
                <button type="button" onClick={() => apply(p)} aria-label={`Use saved gradient ${i + 1}`}>
                  <i style={{ background: gradientCss(p) }} />
                </button>
                <button type="button" className="ge-del" onClick={() => remove(p)} title="Delete this gradient" aria-label="Delete this gradient">
                  <X size={8} strokeWidth={3} />
                </button>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function GradientSlider({ title, value, onChange, colors }) {
  return (
    <label className="ge-slider">
      <span>{title}</span>
      <input type="range" min="0" max="1" step="0.001" value={value} style={{ '--track': `linear-gradient(90deg, ${colors.join(', ')})` }}
        onChange={e => onChange(Number(e.target.value))} />
    </label>
  );
}
