// Small global interaction layer: click ripples, a light that follows the pointer over cards,
// 3D tilt on the big cards, the dark-mode reveal, confetti, and drag-and-drop helpers.
// Everything here backs off when the person has "Reduce motion" turned on.
import { useCallback, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import confetti from 'canvas-confetti';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const RIPPLE_TARGETS = '.primary, .secondary, .chip, .icon-btn, .mic-btn, .kanban-card, .student-card';
const SPOT_TARGETS = '.metric, .student-card, .panel, .kanban-card, .row.boxed';
const TILT_TARGETS = '.student-card, .metric';
const MAGNET_TARGETS = '.app .primary, .login-wrap .primary, .cmdk-trigger';

let installed = false;
export function installInteractions() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // Ripple from the exact point you pressed.
  document.addEventListener('pointerdown', e => {
    if (prefersReducedMotion() || e.button !== 0) return;
    const el = e.target.closest?.(RIPPLE_TARGETS);
    if (!el || el.disabled) return;
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2.2;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
    el.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  }, { passive: true });

  // Spotlight + tilt: CSS reads --mx/--my (spotlight) and --rx/--ry (tilt).
  let frame = 0;
  let last = null;
  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    last = e;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const ev = last;
      const spot = ev.target.closest?.(SPOT_TARGETS);
      if (spot) {
        const r = spot.getBoundingClientRect();
        spot.style.setProperty('--mx', `${ev.clientX - r.left}px`);
        spot.style.setProperty('--my', `${ev.clientY - r.top}px`);
      }
      if (prefersReducedMotion()) return;
      // Magnetic buttons: the main buttons lean toward the pointer (max ~6 px) and spring back on leave.
      const mag = ev.target.closest?.(MAGNET_TARGETS);
      if (mag && !mag.disabled) {
        const r = mag.getBoundingClientRect();
        const dx = ev.clientX - (r.left + r.width / 2);
        const dy = ev.clientY - (r.top + r.height / 2);
        mag.style.setProperty('--mgx', `${Math.max(-6, Math.min(6, dx * 0.18)).toFixed(1)}px`);
        mag.style.setProperty('--mgy', `${Math.max(-5, Math.min(5, dy * 0.25)).toFixed(1)}px`);
      }
      const tilt = ev.target.closest?.(TILT_TARGETS);
      if (tilt) {
        const r = tilt.getBoundingClientRect();
        const px = (ev.clientX - r.left) / r.width - 0.5;
        const py = (ev.clientY - r.top) / r.height - 0.5;
        tilt.style.setProperty('--ry', `${(px * 7).toFixed(2)}deg`);
        tilt.style.setProperty('--rx', `${(-py * 7).toFixed(2)}deg`);
      }
    });
  }, { passive: true });
  document.addEventListener('pointerout', e => {
    const mag = e.target.closest?.(MAGNET_TARGETS);
    if (mag && !mag.contains(e.relatedTarget)) {
      mag.style.setProperty('--mgx', '0px');
      mag.style.setProperty('--mgy', '0px');
    }
    const tilt = e.target.closest?.(TILT_TARGETS);
    if (tilt && !tilt.contains(e.relatedTarget)) {
      tilt.style.setProperty('--rx', '0deg');
      tilt.style.setProperty('--ry', '0deg');
    }
  }, { passive: true });
}

// Dark mode "seeps in" as a circle growing out of the toggle button (View Transitions API).
// Browsers without it (or with reduced motion) just switch instantly.
export function switchThemeWithReveal(event, apply, toDark) {
  const btn = event?.currentTarget;
  const rect = btn?.getBoundingClientRect?.();
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth - 60;
  const y = rect ? rect.top + rect.height / 2 : 40;
  if (!document.startViewTransition || prefersReducedMotion()) { apply(); return; }
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  document.documentElement.classList.add('theme-transition');
  const transition = document.startViewTransition(() => { flushSync(apply); });
  transition.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: toDark ? 700 : 550, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' }
    );
  }).catch(() => {});
  transition.finished.finally(() => document.documentElement.classList.remove('theme-transition'));
}

// A short burst of colour for good news (report filed, job resolved, ticket closed).
const PALETTE = ['#5B4BF5', '#8E5CF7', '#E25A9E', '#10A99B', '#C9C2FF'];
export function celebrate(origin) {
  if (prefersReducedMotion()) return;
  const o = origin || { x: 0.5, y: 0.35 };
  confetti({ particleCount: 70, spread: 75, startVelocity: 38, origin: o, colors: PALETTE, scalar: 0.9, ticks: 160,
    disableForReducedMotion: true });
  setTimeout(() => confetti({ particleCount: 40, spread: 110, startVelocity: 28, origin: o, colors: PALETTE, scalar: 0.75,
    ticks: 140, disableForReducedMotion: true }), 160);
}
export const originOf = el => {
  const r = el?.getBoundingClientRect?.();
  return r ? { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight } : undefined;
};

// ---------- drag & drop ----------

export const fileKind = file => {
  const t = (file.type || '').toLowerCase();
  if (t.startsWith('image/')) return 'photo';
  if (t.startsWith('audio/')) return 'voice';
  if (t.startsWith('text/') || /\.(txt|log|md|csv)$/i.test(file.name)) return 'text';
  return null;
};

const readAsDataUrl = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = reject;
  r.readAsDataURL(file);
});

const audioDuration = url => new Promise(resolve => {
  const a = new Audio();
  a.preload = 'metadata';
  a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration : null);
  a.onerror = () => resolve(null);
  a.src = url;
});

// A dropped / pasted audio file becomes a voice-note attachment.
export async function audioFileToAttachment(file) {
  if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} is larger than 8 MB.`);
  const dataUrl = await readAsDataUrl(file);
  const previewUrl = URL.createObjectURL(file);
  const duration = await audioDuration(previewUrl);
  if (duration && duration > 180) throw new Error(`${file.name} is longer than 3 minutes.`);
  return { kind: 'voice', content_type: (file.type || 'audio/mpeg').split(';')[0], data_base64: dataUrl.split(',', 2)[1],
    duration_s: duration ? Math.max(0.5, duration) : undefined, transcript: undefined, previewUrl, name: file.name };
}

export const readTextFile = file => file.text().then(t => t.slice(0, 5000));

// useDropZone(onFiles) → { isOver, bind } ; spread `bind` on any element.
export function useDropZone(onFiles, { disabled } = {}) {
  const [isOver, setIsOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = e => Array.from(e.dataTransfer?.types || []).includes('Files');
  const onDragEnter = useCallback(e => {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    depth.current += 1;
    setIsOver(true);
  }, [disabled]);
  const onDragOver = useCallback(e => {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, [disabled]);
  const onDragLeave = useCallback(e => {
    if (disabled || !hasFiles(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (!depth.current) setIsOver(false);
  }, [disabled]);
  const onDrop = useCallback(e => {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    depth.current = 0;
    setIsOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) onFiles(files, e);
  }, [disabled, onFiles]);
  return { isOver, bind: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}

// Image(s) pasted from the clipboard (Ctrl/Cmd+V a screenshot).
export function filesFromPaste(e) {
  return Array.from(e.clipboardData?.items || [])
    .filter(i => i.kind === 'file')
    .map(i => i.getAsFile())
    .filter(Boolean);
}
