// Motion system for BITS reports — one place for every duration and curve.
//
// Rules this file encodes (see docs/ANIMATION_GUIDELINES.md for the research behind them):
//  • UI motion stays at or under ~300 ms; press feedback ~100-150 ms.
//  • Entering things use a strong ease-out (fast start = feels responsive); things moving
//    on screen use ease-in-out; exits are quicker than entrances.
//  • Only transform and opacity are animated (cheap for the browser, no layout jank).
//  • Things never grow from nothing: scale from 0.96, slide ~8 px, not across the page.
//  • Lists stagger by 30 ms and the stagger is capped so long lists don't keep you waiting.
//  • "Reduce motion" in the OS turns movement into plain fades (MotionConfig reducedMotion="user").
import React, { useEffect, useRef, useState } from 'react';
import { MotionConfig, motion, useReducedMotion, animate } from 'motion/react';

export const EASE_OUT = [0.23, 1, 0.32, 1];          // strong ease-out: entrances, feedback
export const EASE_IN_OUT = [0.77, 0, 0.175, 1];      // on-screen movement / morphing
export const EASE_IN = [0.4, 0, 1, 1];               // exits

export const DURATION = { press: 0.12, fast: 0.16, base: 0.2, slow: 0.28 };
export const STAGGER = 0.03;
export const MAX_STAGGERED = 10;                     // items after the 10th appear together

export function MotionProvider({ children }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: DURATION.base, ease: EASE_OUT }}>
      {children}
    </MotionConfig>
  );
}

// Route change: a short fade + 8 px rise in, a quicker fade out.
export const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: EASE_IN } }
};

export function Page({ children }) {
  return (
    <motion.div className="page-motion" variants={pageVariants} initial="initial" animate="animate" exit="exit">
      {children}
    </motion.div>
  );
}

// Something appearing in place (cards, callouts, results).
export function FadeIn({ children, delay = 0, y = 6, className, style, as = 'div', ...rest }) {
  const Tag = motion[as] || motion.div;
  return (
    <Tag className={className} style={style} initial={{ opacity: 0, y }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.base, ease: EASE_OUT, delay }} {...rest}>
      {children}
    </Tag>
  );
}

// Stagger helper for list items: pass the index.
export const itemDelay = i => Math.min(i, MAX_STAGGERED) * STAGGER;

export const listItem = {
  initial: { opacity: 0, y: 6 },
  animate: i => ({ opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE_OUT, delay: itemDelay(i) } }),
  exit: { opacity: 0, transition: { duration: 0.1 } }
};

// Modal / popover entrance: scale from 0.96 (never from 0) + fade.
export const popIn = {
  initial: { opacity: 0, scale: 0.96, y: 6 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: DURATION.base, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.98, transition: { duration: 0.12, ease: EASE_IN } }
};

export const overlayFade = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DURATION.fast } },
  exit: { opacity: 0, transition: { duration: 0.12 } }
};

// Number that counts up to its value (dashboard metrics). Plain value when motion is reduced
// or the value isn't a number (e.g. "92%" is split into number + suffix).
export function AnimatedNumber({ value, duration = 0.6 }) {
  const reduce = useReducedMotion();
  const match = String(value ?? '').match(/^(-?\d+(?:\.\d+)?)(.*)$/);
  const target = match ? parseFloat(match[1]) : null;
  const suffix = match ? match[2] : '';
  const decimals = match && match[1].includes('.') ? match[1].split('.')[1].length : 0;
  const [shown, setShown] = useState(reduce || target === null ? target : 0);
  const from = useRef(0);
  useEffect(() => {
    if (target === null) return undefined;
    if (reduce) { setShown(target); return undefined; }
    const controls = animate(from.current, target, {
      duration, ease: EASE_OUT, onUpdate: v => setShown(v)
    });
    from.current = target;
    return () => controls.stop();
  }, [target, reduce, duration]);
  if (target === null) return <>{value}</>;
  return <>{Number(shown).toFixed(decimals)}{suffix}</>;
}

// A bar that grows to its width once (dashboard breakdowns).
export function GrowBar({ pct, className, delay = 0 }) {
  return (
    <motion.i className={className} style={{ width: `${pct}%`, transformOrigin: 'left center', display: 'block' }}
      initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
      transition={{ duration: DURATION.slow, ease: EASE_OUT, delay }} />
  );
}

export { motion, AnimatePresence, useReducedMotion, LayoutGroup } from 'motion/react';
