// Visual effects.
//  • GlowingEffect — ported from 21st.dev "Glowing Effect" (manuarora700 / Aceternity UI):
//    a colourful border light that slides around a card's edge toward the pointer, like Cursor's website.
//    Converted from TypeScript + Tailwind to plain JS + CSS (see .glow-* in index.css), recoloured to the
//    app palette, and driven by ONE shared pointer listener instead of one per card.
//  • HaloDropzone — ported from 21st.dev "Halo Dropzone" (cult-ui): drop area with drifting colour blobs
//    under the rim, a frosted surface and a light trail that runs around the border while you hover/drag.
//  • InteractiveGrid — our own: grid cells light up under the pointer and fade out behind it (sign-in page).
//  • TextShimmer — our own: a light band sweeping across text while something is working.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { animate, motion, AnimatePresence, useMotionValue, useTransform, useReducedMotion } from 'motion/react';
import { UploadCloud, Check, FileAudio, FileText } from 'lucide-react';

/* ───────────────────────── Glowing Effect ───────────────────────── */

const glowRegistry = new Set();
let lastPointer = null;
let glowListening = false;

function updateGlow(entry, point) {
  const el = entry.ref.current;
  if (!el || !point) return;
  const { left, top, width, height } = el.getBoundingClientRect();
  const { x: mouseX, y: mouseY } = point;
  const cx = left + width * 0.5;
  const cy = top + height * 0.5;
  const inactiveRadius = 0.5 * Math.min(width, height) * entry.opts.inactiveZone;
  if (Math.hypot(mouseX - cx, mouseY - cy) < inactiveRadius) { el.style.setProperty('--active', '0'); return; }
  const p = entry.opts.proximity;
  const isActive = mouseX > left - p && mouseX < left + width + p && mouseY > top - p && mouseY < top + height + p;
  el.style.setProperty('--active', isActive ? '1' : '0');
  if (!isActive) return;
  const current = parseFloat(el.style.getPropertyValue('--start')) || 0;
  const target = (180 * Math.atan2(mouseY - cy, mouseX - cx)) / Math.PI + 90;
  const diff = ((target - current + 180) % 360) - 180;
  entry.anim?.stop();
  entry.anim = animate(current, current + diff, {
    duration: entry.opts.movementDuration, ease: [0.16, 1, 0.3, 1],
    onUpdate: v => el.style.setProperty('--start', String(v))
  });
}

function startGlowListener() {
  if (glowListening) return;
  glowListening = true;
  let frame = 0;
  const run = () => { frame = 0; glowRegistry.forEach(entry => updateGlow(entry, lastPointer)); };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(run); };
  document.body.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    lastPointer = { x: e.clientX, y: e.clientY };
    schedule();
  }, { passive: true });
  window.addEventListener('scroll', schedule, { passive: true });
}

// Drop inside any element with position: relative and a border-radius.
export const GlowingEffect = React.memo(function GlowingEffect({
  spread = 40, proximity = 64, inactiveZone = 0.01, borderWidth = 2, movementDuration = 2, variant = 'brand'
}) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return undefined;
    const entry = { ref, opts: { proximity, inactiveZone, movementDuration }, anim: null };
    glowRegistry.add(entry);
    startGlowListener();
    return () => { entry.anim?.stop(); glowRegistry.delete(entry); };
  }, [reduce, proximity, inactiveZone, movementDuration]);
  if (reduce) return null;
  return (
    <div ref={ref} className={`glow-layer glow-${variant}`} aria-hidden="true"
      style={{ '--spread': spread, '--start': 0, '--active': 0, '--glow-border': `${borderWidth}px` }}>
      <div className="glow-ring" />
    </div>
  );
});

/* ───────────────────────── Halo Dropzone ───────────────────────── */

const TRAIL_LOOP_MS = 5250;

function BorderTrail({ active }) {
  const progress = useMotionValue(0);
  const offsetDistance = useTransform(progress, v => `${((v % 100) + 100) % 100}%`);
  useEffect(() => {
    if (!active) return undefined;
    let raf = 0;
    let last = performance.now();
    const tick = now => {
      const next = progress.get() + ((now - last) / TRAIL_LOOP_MS) * 100;
      last = now;
      progress.set(((next % 100) + 100) % 100);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, progress]);
  return (
    <div className={`halo-trail${active ? ' on' : ''}`} aria-hidden="true">
      <motion.div className="halo-trail-piece ambient" style={{ offsetDistance }}><i /></motion.div>
      <motion.div className="halo-trail-piece core" style={{ offsetDistance }}><i /></motion.div>
    </div>
  );
}

function RimBlobs({ reduce }) {
  const loop = d => ({ duration: reduce ? 0.01 : d, repeat: reduce ? 0 : Infinity, ease: 'easeInOut' });
  return (
    <div className="halo-blobs" aria-hidden="true">
      <motion.i className="b1" animate={{ left: ['-5%', '75%', '-5%'] }} transition={loop(6)} />
      <motion.i className="b2" animate={{ left: ['65%', '10%', '65%'] }} transition={loop(5)} />
      <motion.i className="b3" animate={{ left: ['25%', '55%', '25%'] }} transition={loop(4)} />
    </div>
  );
}

const isImage = f => (f.type || '').startsWith('image/');

// onFiles(files) is called with the File objects; the dropzone shows them briefly as a "received" state.
export function HaloDropzone({ onFiles, accept = 'image/*,audio/*', multiple = true, label, hint, disabled, compact }) {
  const reduce = useReducedMotion();
  const inputRef = useRef(null);
  const depth = useRef(0);
  const timer = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [received, setReceived] = useState([]);
  const thumbs = useMemo(() => received.map(f => ({ f, url: isImage(f) ? URL.createObjectURL(f) : null })), [received]);
  useEffect(() => () => thumbs.forEach(t => t.url && URL.revokeObjectURL(t.url)), [thumbs]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const emit = useCallback(list => {
    const files = Array.from(list || []);
    if (!files.length || disabled) return;
    onFiles?.(files);
    setReceived(files);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setReceived([]), 2600);
  }, [disabled, onFiles]);

  const stop = e => { e.preventDefault(); e.stopPropagation(); };
  const handlers = {
    onDragEnter: e => { stop(e); if (!disabled) { depth.current += 1; setDragging(true); } },
    onDragLeave: e => { stop(e); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); },
    onDragOver: e => { stop(e); if (!disabled) e.dataTransfer.dropEffect = 'copy'; },
    onDrop: e => { stop(e); depth.current = 0; setDragging(false); emit(e.dataTransfer.files); }
  };
  const emphasis = dragging || hovered || focused;
  const showDone = received.length > 0;

  return (
    <label className={`halo${compact ? ' compact' : ''}${emphasis ? ' emphasis' : ''}${dragging ? ' dragging' : ''}${disabled ? ' disabled' : ''}`}
      tabIndex={disabled ? -1 : 0} {...handlers}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); inputRef.current?.click(); } }}
      aria-label={label}>
      <input ref={inputRef} type="file" accept={accept} multiple={multiple} hidden disabled={disabled}
        onChange={e => { emit(e.target.files); e.target.value = ''; }} />
      <div className="halo-frame">
        <RimBlobs reduce={reduce} />
        <div className="halo-surface">
          <AnimatePresence mode="wait" initial={false}>
            {showDone ? (
              <motion.div key="done" className="halo-body" initial={{ opacity: 0, scale: 0.96, y: -2 }}
                animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 2 }} transition={{ duration: 0.2 }}>
                <div className="halo-thumbs">
                  {thumbs.slice(0, 5).map(({ f, url }, n) => (
                    <motion.span key={`${f.name}-${n}`} className="halo-thumb" initial={{ opacity: 0, scale: 0.8, rotate: -6 }}
                      animate={{ opacity: 1, scale: 1, rotate: (n - 1) * 4 }} transition={{ type: 'spring', stiffness: 420, damping: 22, delay: n * 0.05 }}>
                      {url ? <img src={url} alt="" /> : (f.type || '').startsWith('audio/') ? <FileAudio size={22} /> : <FileText size={22} />}
                    </motion.span>
                  ))}
                </div>
                <b className="halo-title"><Check size={16} /> {received.length} file{received.length === 1 ? '' : 's'} added</b>
              </motion.div>
            ) : (
              <motion.div key="idle" className="halo-body" initial={{ opacity: 0, scale: 0.96, y: -2 }}
                animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 2 }} transition={{ duration: 0.2 }}>
                <motion.span className="halo-icon" animate={reduce || disabled ? { y: 0 } : { y: [0, -3, 0] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}>
                  <UploadCloud size={compact ? 22 : 28} />
                </motion.span>
                <b className="halo-title">{dragging ? 'Drop to attach' : label}</b>
                {hint && <small className="halo-hint">{hint}</small>}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <BorderTrail active={!disabled && emphasis && !reduce} />
      </div>
    </label>
  );
}

/* ───────────────────────── Interactive grid (sign-in) ───────────────────────── */

export function InteractiveGrid({ cell = 44 }) {
  const canvasRef = useRef(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const heat = new Map();          // "col,row" -> 0..1
    let w = 0; let h = 0; let raf = 0; let dpr = 1;
    const colors = ['91,75,245', '142,92,247', '226,90,158'];
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(91,75,245,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0.5; x < w; x += cell) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = 0.5; y < h; y += cell) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      heat.forEach((v, key) => {
        const [c, r] = key.split(',').map(Number);
        const rgb = colors[(c + r) % colors.length];
        ctx.fillStyle = `rgba(${rgb},${(v * 0.32).toFixed(3)})`;
        ctx.fillRect(c * cell + 1, r * cell + 1, cell - 1, cell - 1);
        const next = v - 0.025;
        if (next <= 0) heat.delete(key); else heat.set(key, next);
      });
      raf = heat.size ? requestAnimationFrame(draw) : 0;
    };
    const onMove = e => {
      if (reduce) return;
      const rect = canvas.getBoundingClientRect();
      const c = Math.floor((e.clientX - rect.left) / cell);
      const r = Math.floor((e.clientY - rect.top) / cell);
      if (c < 0 || r < 0) return;
      heat.set(`${c},${r}`, 1);
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const onResize = () => { resize(); draw(); };
    resize();
    draw();
    window.addEventListener('resize', onResize);
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onMove);
    };
  }, [cell, reduce]);
  return <canvas ref={canvasRef} className="interactive-grid" aria-hidden="true" />;
}

/* ───────────────────────── Text shimmer ───────────────────────── */

export function TextShimmer({ children, as: Tag = 'span' }) {
  return <Tag className="text-shimmer">{children}</Tag>;
}
