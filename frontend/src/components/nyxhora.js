// Components adapted from nyxhora-ui (https://github.com/nyxhora/nyxhora-ui, MIT licence):
// Dynamic Island, Flip Words and Floating Dock. The originals are TypeScript + Tailwind +
// zustand for Next.js; these are plain JavaScript + this app's CSS (index.css → "nyxhora"),
// use the motion library the app already ships, and follow docs/ANIMATION_GUIDELINES.md.
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform
} from 'motion/react';

/* ───────────────────────────── Dynamic Island ─────────────────────────────
   A black pill at the top of the screen that grows into a card when tapped.
   Any part of the app can call  island.push({ title, subtitle, icon, tone, action })
   – live incident events, offline reports being sent, and so on. */

let items = [];
let counter = 0;
const listeners = new Set();
const emit = () => listeners.forEach(l => l());
const timers = new Map();

function schedule(id, ms) {
  clearTimeout(timers.get(id));
  if (ms > 0) timers.set(id, setTimeout(() => island.dismiss(id), ms));
}

export const island = {
  // tone: 'default' | 'info' | 'success' | 'danger' | 'warning'.  duration 0 = stays until dismissed.
  push({ duration = 6000, tone = 'default', ...rest }) {
    const id = `isl-${++counter}`;
    items = [{ id, tone, duration, at: Date.now(), ...rest }, ...items].slice(0, 8);
    schedule(id, duration);
    emit();
    return id;
  },
  dismiss(id) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    items = items.filter(n => n.id !== id);
    emit();
  },
  // Hold the timer while someone is reading it; restart it afterwards.
  hold(id) { clearTimeout(timers.get(id)); },
  release(id, ms = 4000) { if (items.some(n => n.id === id)) schedule(id, ms); }
};

const subscribe = l => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => items;

const SPRING = { type: 'spring', stiffness: 380, damping: 30, mass: 0.8 };

export function DynamicIsland() {
  const list = useSyncExternalStore(subscribe, snapshot);
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [dir, setDir] = useState(1);
  const box = useRef(null);
  const nav = useNavigate();
  const lastWheel = useRef(0);

  // New arrivals jump to the front.
  const newest = list[0]?.id;
  useEffect(() => { setIndex(0); }, [newest]);
  useEffect(() => { if (index > list.length - 1) setIndex(Math.max(0, list.length - 1)); }, [list.length, index]);
  useEffect(() => { if (!list.length) setExpanded(false); }, [list.length]);

  const active = list[index] || null;

  const go = useCallback(step => {
    setIndex(i => {
      const next = Math.min(Math.max(i + step, 0), list.length - 1);
      if (next !== i) setDir(step);
      return next;
    });
  }, [list.length]);

  // While expanded, the visible item doesn't time out.
  useEffect(() => {
    if (!active || !expanded) return undefined;
    island.hold(active.id);
    return () => island.release(active.id);
  }, [active, expanded]);

  useEffect(() => {
    if (!expanded) return undefined;
    const onDown = e => { if (box.current && !box.current.contains(e.target)) setExpanded(false); };
    const onKey = e => {
      if (e.key === 'Escape') setExpanded(false);
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  });

  const onWheel = e => {
    if (list.length < 2) return;
    const now = Date.now();
    if (now - lastWheel.current < 160) return;
    lastWheel.current = now;
    go(e.deltaY > 0 ? 1 : -1);
  };

  const runAction = () => {
    if (!active) return;
    if (active.to) nav(active.to);
    active.onAction?.();
    island.dismiss(active.id);
    setExpanded(false);
  };

  const slide = {
    enter: d => ({ opacity: 0, x: 14 * d }),
    center: { opacity: 1, x: 0 },
    exit: d => ({ opacity: 0, x: -14 * d })
  };
  const Icon = active?.icon;

  return (
    <div className="island-anchor" aria-live="polite">
      <AnimatePresence>
        {active && (
          <motion.div key="island" ref={box} layout
            className={`island tone-${active.tone}${expanded ? ' expanded' : ''}`}
            initial={{ opacity: 0, y: -24, scale: 0.7 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.75, transition: { duration: 0.18 } }}
            transition={SPRING} style={{ borderRadius: expanded ? 22 : 999 }}
            whileHover={expanded ? undefined : { scale: 1.03 }} whileTap={expanded ? undefined : { scale: 0.98 }}
            onWheel={onWheel}
            onClick={e => { if (!e.target.closest('button, a')) setExpanded(x => !x); }}
            role="status" aria-expanded={expanded} title={expanded ? undefined : 'Tap for details'}>
            <AnimatePresence mode="popLayout" initial={false} custom={dir}>
              {expanded ? (
                <motion.div key={`x-${active.id}`} className="island-body" custom={dir} variants={slide}
                  initial="enter" animate="center" exit="exit" transition={{ duration: 0.18 }}>
                  <div className="island-row">
                    {Icon && <span className="island-icon big"><Icon size={18} /></span>}
                    <div className="island-text">
                      <b>{active.title}</b>
                      {active.subtitle && <span>{active.subtitle}</span>}
                      <small>{timeAgo(active.at)}</small>
                    </div>
                    <button type="button" className="island-x" onClick={() => island.dismiss(active.id)} aria-label="Dismiss">
                      <X size={14} />
                    </button>
                  </div>
                  <div className="island-actions">
                    {list.length > 1 && (
                      <div className="island-pager">
                        <button type="button" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous"><ChevronLeft size={15} /></button>
                        <span>{index + 1} / {list.length}</span>
                        <button type="button" onClick={() => go(1)} disabled={index === list.length - 1} aria-label="Next"><ChevronRight size={15} /></button>
                      </div>
                    )}
                    {(active.to || active.onAction) && (
                      <button type="button" className="island-cta" onClick={runAction}>{active.actionLabel || 'Open'}</button>
                    )}
                  </div>
                </motion.div>
              ) : (
                <motion.div key={`c-${active.id}`} className="island-compact" custom={dir} variants={slide}
                  initial="enter" animate="center" exit="exit" transition={{ duration: 0.16 }}>
                  {Icon && <span className="island-icon"><Icon size={15} /></span>}
                  <span className="island-text">
                    <b>{active.title}</b>
                    {active.subtitle && <span>{active.subtitle}</span>}
                  </span>
                  {list.length > 1 && (
                    <span className="island-dots" aria-label={`${list.length} updates`}>
                      {list.slice(0, 4).map((n, i) => <i key={n.id} className={i === index ? 'on' : undefined} />)}
                      {list.length > 4 && <small>+{list.length - 4}</small>}
                    </span>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s} s ago`;
  return `${Math.round(s / 60)} min ago`;
}

/* ───────────────────────────── Flip Words ─────────────────────────────
   Cycles through words; the old one blurs away, the new one types in letter by letter. */
export function FlipWords({ words, duration = 2600, className = '' }) {
  const [i, setI] = useState(0);
  const [animating, setAnimating] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (animating) return undefined;
    const t = setTimeout(() => { setI(x => (x + 1) % words.length); setAnimating(!reduce); }, duration);
    return () => clearTimeout(t);
  }, [animating, duration, words.length, reduce, i]);

  const word = words[i];
  if (reduce) {
    return <span className={`flip-words ${className}`}><span className="flip-word" key={word}>{word}</span></span>;
  }
  let n = 0;
  return (
    <span className={`flip-words ${className}`}>
      <AnimatePresence onExitComplete={() => setAnimating(false)}>
        <motion.span key={word} className="flip-word"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 120, damping: 12 }}
          exit={{ opacity: 0, y: -28, x: 28, filter: 'blur(8px)', scale: 1.6, position: 'absolute' }}>
          {word.split(' ').map((w, wi) => (
            <span key={w + wi} className="flip-chunk">
              {w.split('').map((ch, ci) => (
                <motion.span key={ci} className="flip-letter"
                  initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ delay: (n++) * 0.03, duration: 0.2 }}>{ch}</motion.span>
              ))}
              {wi < word.split(' ').length - 1 && ' '}
            </span>
          ))}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/* ───────────────────────────── Floating Dock ─────────────────────────────
   Phone navigation along the bottom edge. Slide a finger (or the mouse) along it and the
   icons under it swell like the macOS dock; lift on one to go there. */
export function FloatingDock({ items: dockItems }) {
  const mouseX = useMotionValue(Infinity);
  const { pathname } = useLocation();
  const nav = useNavigate();
  // On a touch screen the finger can slide from one icon to another before lifting, so we
  // go to whichever icon is under the finger when it lifts (a normal tap still just clicks).
  const lift = e => {
    if (e.pointerType === 'mouse') return;
    mouseX.set(Infinity);
    const link = document.elementFromPoint(e.clientX, e.clientY)?.closest('.dock-item');
    const to = link?.getAttribute('href');
    if (to && to !== pathname) nav(to);
  };
  return (
    <div className="dock" role="navigation" aria-label="Quick navigation"
      onPointerMove={e => mouseX.set(e.clientX)}
      onPointerLeave={() => mouseX.set(Infinity)} onPointerCancel={() => mouseX.set(Infinity)}
      onPointerUp={lift}>
      {dockItems.map(item => (
        <DockIcon key={item.to} mouseX={mouseX} {...item} active={pathname === item.to} />
      ))}
    </div>
  );
}

function DockIcon({ mouseX, to, icon: Icon, label, active }) {
  const ref = useRef(null);
  const distance = useTransform(mouseX, x => {
    const b = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return x - b.x - b.width / 2;
  });
  const sizeT = useTransform(distance, [-110, 0, 110], [44, 62, 44]);
  const iconT = useTransform(distance, [-110, 0, 110], [20, 28, 20]);
  const liftT = useTransform(distance, [-110, 0, 110], [0, -8, 0]);
  const spring = { mass: 0.1, stiffness: 170, damping: 13 };
  const size = useSpring(sizeT, spring);
  const iconSize = useSpring(iconT, spring);
  const lift = useSpring(liftT, spring);
  const [hot, setHot] = useState(false);
  useEffect(() => distance.on('change', d => setHot(Math.abs(d) < 26)), [distance]);

  return (
    <Link to={to} className={`dock-item${active ? ' active' : ''}`} aria-label={label} aria-current={active ? 'page' : undefined}>
      <motion.span ref={ref} className="dock-icon" style={{ width: size, height: size, y: lift }}>
        <AnimatePresence>
          {hot && (
            <motion.span className="dock-label" initial={{ opacity: 0, y: 6, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: 2, x: '-50%' }} transition={{ duration: 0.14 }}>{label}</motion.span>
          )}
        </AnimatePresence>
        <motion.span style={{ width: iconSize, height: iconSize, display: 'grid', placeItems: 'center' }}>
          <Icon width="100%" height="100%" strokeWidth={1.9} />
        </motion.span>
        {active && <motion.i layoutId="dock-dot" className="dock-dot" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
      </motion.span>
    </Link>
  );
}
