# Animation guidelines for BITS reports

Researched before adding motion to the app. Every animation in `frontend/src/motion.js`
and `frontend/src/index.css` follows these rules.

## What the research says

| Topic | Guideline | Source |
|---|---|---|
| Speed | 100 ms feels instant; around 1 s is the most a person's flow of thought survives. Most UI motion lands at 200–500 ms. | Nielsen Norman Group (response-time limits); Val Head |
| Big changes | A modal sliding in or another large change: 200–300 ms. | NN/g, *Executing UX Animations: Duration and Motion Characteristics* |
| Upper limit | Keep UI animations under 300 ms. A 180 ms dropdown feels quicker than a 400 ms one. | Emil Kowalski, *Great Animations* / animations.dev |
| Easing | Things that **enter**: ease-out (fast start, gentle stop, so it feels responsive). Things that **move on screen**: ease-in-out. Use stronger custom curves than CSS's built-in `ease-out`. | Emil Kowalski; Material Design 3 (emphasized-decelerate for entering) |
| What to animate | Only `transform` and `opacity`. Animating `width`/`height`/`margin` makes the browser redo layout and stutters. | Emil Kowalski |
| Frequency | Skip animations on actions people repeat many times a day. Animate only where motion tells you something (a state change, where a thing came from). | Emil Kowalski; Apple HIG |
| Origin | Nothing appears from nothing: scale from 0.95–0.97, not 0. | Emil Kowalski |
| Exits | Make exits shorter than entrances (Atlassian: modal enters in a "long" token and leaves in a "medium" one). | Atlassian Design System, *Applying motion* |
| Interruptible | An animation must be able to stop half-way when the state changes again. | Emil Kowalski (the Motion library does this) |
| Accessibility | WCAG 2.3.3 asks that motion triggered by interaction can be turned off. Honour `prefers-reduced-motion` and swap movement for simple fades. Vestibular disorders make movement cause dizziness and nausea. | W3C, *Understanding SC 2.3.3* |

## The tokens we use

| Token | Value | Used for |
|---|---|---|
| `press` | 120 ms | button press (`scale(.97)` on `:active`) |
| `fast` | 160 ms | small fades (transcripts, mic hint) |
| `base` | 200 ms | page transitions, cards, modals, list items |
| `slow` | 280 ms | progress bars growing, tracker rail, photo → lightbox |
| `EASE_OUT` | `cubic-bezier(0.23, 1, 0.32, 1)` | anything entering |
| `EASE_IN_OUT` | `cubic-bezier(0.77, 0, 0.175, 1)` | the tracker rail moving along |
| stagger | 30 ms per item, capped after 10 items | incident list, timeline, photos, dashboard bars |

## Where the motion is (and why)

- **Page change**: the old page fades out (120 ms), the new one fades in with an 8 px rise (200 ms). This tells you that the page changed.
- **Lists** (incidents, history, photos, buildings): items fade in one after another, so new rows from live updates are easy to spot.
- **Modals**: the backdrop fades in and the dialog scales up from 0.96.
- **Status badge**: the old status slides out and the new one slides in, so you notice the change even when it arrives live.
- **Live tracker**: the progress rail slides to the new step and the current dot grows slightly. This is the one place motion carries the news ("the technician set off").
- **Photo → lightbox**: the thumbnail grows into the full view (shared layout), so you can see where the big image came from.
- **Dashboard**: numbers count up and bars grow once when the page loads (not on every refresh).
- **Recording / dictation**: a pulsing ring and a live level meter. These show that the microphone is on, so they count as status, not decoration.
- **Not animated, on purpose**: typing, filters, toggles, table sorting. These are high-frequency actions where motion would only slow people down.

## Reduced motion

`MotionConfig reducedMotion="user"` turns every Motion animation into an instant change or a plain fade.
A `@media (prefers-reduced-motion: reduce)` block stops the CSS pulses, the hover zoom and the press scale.
To test it on a Mac, turn on System Settings → Accessibility → Display → Reduce motion. In Chrome you can use
DevTools → Rendering → *Emulate CSS prefers-reduced-motion*.

## Version 2: the colourful, interactive pass

The team asked for a livelier interface, so a few rules were deliberately relaxed:

- **Buttons grow on hover** (to 1.045×, with a springy curve) and shrink on press (0.96×). There's a light sheen across gradient buttons and a ripple from the point you click.
- **Dark mode spreads out from the toggle** as a growing circle (View Transitions API, about 700 ms). It's longer than other UI motion because it's a whole-screen change the user starts on purpose. Browsers without the API, and reduced-motion users, switch instantly.
- **Cards respond to the pointer**: a soft light follows the mouse, and the metric and quick-report cards tilt slightly in 3D.
- **The sidebar's active pill slides** between sections (spring animation), and each section has its own colour.
- **The incident board** animates cards between columns (shared layout) when you drop them.
- **Confetti** plays when a report is filed and when a job is resolved or closed.
- **One ambient motion**: a slow aurora behind the page title.

All of it is still off under `prefers-reduced-motion: reduce`: transforms, the aurora, shimmer, ripples and confetti are disabled, and colour and layout stay the same.
