# Field service, voice & live features

These features were added in November 2026.

## What's new

| Feature | Who uses it | Where |
|---|---|---|
| **Exact location**: "Share my exact location" on the report form (phone GPS, with an accuracy circle on a mini map). Without it, the building's pin is used. | Student | Create Report → Issue type (offline issues) |
| **Navigate with Google Maps**: one tap opens walking directions to the exact spot. No API key is needed. | Technician | Incident → Site visit |
| **"I'm on my way"**: tells the student right away (live toast + notification) and acknowledges the job. | Technician | Incident → Site visit |
| **GPS-verified check-in**: "I've arrived" only counts if the phone is within 150 m of the spot (the radius can be changed in settings). If GPS isn't available, the technician can check in without it, and the visit is marked *not verified*. | Technician | Incident → Site visit |
| **Handover code**: hostel jobs show the student a 4-digit code. The technician must enter it to resolve, which proves the visit happened (like a delivery OTP). After 5 wrong tries the code locks; an admin can resolve without it, and the audit log records that. | Both | Incident page / Resolve dialog |
| **Speak instead**: dictate the complaint. When you stop, AI fills in the rest of the form. Works in Chrome/Edge (en-IN). | Student | Create Report → Description |
| **Voice notes**: record up to 2 minutes ("this is the noise it makes") with a live level meter and an automatic transcript. Plays back on the incident page. | Everyone | Create Report, Incident → Evidence |
| **Before / after photos**: phone camera opens directly, and photos are shrunk in the browser before upload. Once both exist, a drag slider compares them. | Student (before), technician (before/after) | Incident → Evidence |
| **QR stickers**: register equipment or rooms and print stickers. Scanning one opens a report form that is already filled in, even if you have to sign in first. It also warns when the item already has open reports. | Admin prints, anyone scans | QR stickers page |
| **Live updates**: pages update by themselves through Server-Sent Events (incident page, list, dashboard, map), with toasts like "Alice is on the way". | Everyone | Everywhere ("LIVE" pill in the header) |
| **Campus map + outage detection**: open reports shown as pins, busiest buildings, and an automatic "possible outage in Valmiki Bhavan" alert when 3+ reports come from one building within 2 h. Admins can drag building pins to fix them. | Admin / technician | Campus map, Overview |
| **Offline reporting**: if the network is down, the report is saved on the device and sent automatically when you're back online. The production build also caches the app so it opens offline. | Student | Create Report |

## Interactive UI (v2)

| What | Where |
|---|---|
| Colour-coded sidebar with a sliding active pill | every page |
| Dark mode that spreads out from the toggle as a circle | header toggle |
| Gradient buttons that grow on hover, sheen + ripple on click | everywhere |
| Pointer spotlight + 3D tilt on cards | Overview metrics, student quick-report cards |
| **Drag & drop**: drop photos, audio files or a .txt file anywhere on the report form; paste a screenshot into the description; drag attached files to reorder; drop files on the Evidence panel | Create Report, incident page |
| **Board view**: drag incident cards between New / Assigned / Acknowledged / In progress / Waiting / Resolved. Illegal moves bounce back with the reason; dropping on Resolved opens the resolve form | All incidents / Incident queue → Board |
| Confetti when a report is filed and when a job is resolved or closed | — |
| Shimmer skeletons while loading | — |

## Effects from 21st.dev (v3)

| Effect | Source | Where |
|---|---|---|
| **Glowing Effect**: a colourful light runs around a card's border toward the pointer | Ported from 21st.dev "Glowing Effect" (Aceternity UI) to plain JS + CSS, recoloured | Dashboard cards, board cards, report form, incident page panels |
| **Halo Dropzone**: drifting colour blobs, frosted surface, a light trail around the border on hover/drag, a "files added" state with thumbnails | Ported from 21st.dev "Halo Dropzone" (cult-ui) | Report form, Evidence panel |
| **Command palette** (⌘K / Ctrl+K): jump to pages, find incidents by number or title, run actions | Built by us | Everywhere ("Search" in the header) |
| **Magnetic buttons**: main buttons lean toward the pointer | Built by us | Everywhere |
| **Interactive grid**: cells light up under the pointer | Built by us | Sign-in page |
| **Notification stack**: bell opens a pile of cards that fans out | Built by us | Header bell |
| **Tracker runner**: a glowing dot slides to the current step, finished steps get a tick | Built by us | Incident page |
| **Text shimmer** while AI fills in the form | Built by us | Create Report |

## Appearance (ported from MiniMusic), saved per account

The theme logic is a port of the user's own macOS app **MiniMusic** (`MiniMusic.swift`: `AppTheme`, `ThemeColor`, `GradientTheme`, `ThemeStyle`, `AppearanceSettings`, `GradientEditor`).

- **Looks:** the round button in the header opens Appearance. It has seven looks:
  - **Original** (the app's first light theme) and **Indigo** (the purple-indigo dark theme). These are drawn exactly as before, with no glass layer.
  - MiniMusic's **AMOLED**, **Dark**, **Greenboard**, **Light** and **Gradient**.

  New accounts start on Original.
- **Gradient editor:**
  - Choose **one, two or three colours**.
  - Pick a colour, then set it with **Hue**, **Saturation** and **Brightness** sliders, a **hex** field or the **12-colour palette**.
  - Set the **angle** (for two or three colours).
  - **Save** gradients and reuse them later. Hover a saved gradient to delete it.
  - Any edit switches to the Gradient look, as in MiniMusic. Whether text is light or dark is worked out from how light the gradient is (average luminance above 0.6 counts as light).
- **Glass panels:** in MiniMusic's looks, every page uses one background, either the look's base colour or your gradient. Panels sit on it as glass: a translucent shade, frosted when there is a gradient behind it, with a fine rim lit from above (`--edge-top` to `--edge-bottom`). Menus, dialogs and inputs stay solid so they are always readable.
- **Hover effects:** the glass layer only sets the background colour and the border. Hovering a box still does what it does in Original and Indigo: the card tilts toward the pointer, a soft light follows the mouse, the card lifts, and its border and glow take on the card's colour.
- **Code:**
  - `frontend/src/theme.js` is the theme engine, using MiniMusic's names. `themeStyle()` returns the CSS variables that are put on `.app`.
  - `components/ThemeMenu.js` is the popover.
  - The CSS is in the "Themes, MiniMusic style" section of `index.css`.
- **Saved per account:** the look is stored on the user record as `appearance: {theme, gradient, saved_gradients}` and saved with `PUT /api/account/appearance`. Slider drags are batched into one save. The look comes back with every sign-in, so it follows the person to any device.
- **OOP:** `app/domain/appearance.py` has three immutable value objects: `ThemeColor`, `GradientTheme` and `Appearance`. They clamp out-of-range values and fall back to defaults, so a bad document never breaks sign-in. The API schema rejects bad input with 422. Tests are in `tests/test_appearance.py`.

The previous version (six dark palettes plus a separate AMOLED menu) is in `_backups/full-before-minimusic-themes-2026-11-19.tar.gz`.

## Components from nyxhora-ui

Three components were adapted from [nyxhora-ui](https://github.com/nyxhora/nyxhora-ui), which is MIT-licensed (Copyright (c) 2026 Nyxhora). The originals are TypeScript, Tailwind and zustand for Next.js. They were rewritten as plain JavaScript and CSS in `frontend/src/components/nyxhora.js`, with no new packages.

| Component | Where it shows up | What it does |
|---|---|---|
| **Dynamic Island** | Top of every page after sign-in | Live events (technician on the way or arrived, new report, resolved, SLA missed, possible outage) and offline reports that were sent later appear in a black pill. Tap it to expand and get an *Open INC-…* button. Several updates show as dots, and you can page through them with the arrows, the scroll wheel or ← →. It stays on screen while expanded. |
| **Flip Words** | Sign-in headline | The headline reads "Report a …" and the last part rotates through *dead Wi-Fi point*, *flickering projector*, *jammed printer* and so on. With reduce motion turned on, it swaps the word without animating. |
| **Floating Dock** | Phones only, bottom of the screen | Shortcuts to Overview or Docs, Reports, New report, Map and Account. Slide a finger along the dock and the icons grow like the macOS dock. Lift your finger on one to open it. |

The code is `island.push({ title, subtitle, icon, tone, to })`, a small store that any module can call (`live.js` and `offline.js` both use it).

## OOP design (for the report / viva)

| Pattern | Class(es) | File |
|---|---|---|
| Value object (immutable, validates itself) | `GeoPoint`, `HandoverCode` | `app/domain/geo.py`, `app/domain/handover.py` |
| Strategy + Adapter | `NavigationLinkProvider` → `GoogleMapsDirections`, `OpenStreetMapDirections` | `app/domain/geo.py` |
| Business-rule object | `ArrivalPolicy` (radius + GPS accuracy + building-pin allowance) | `app/domain/geo.py` |
| Inheritance + polymorphism + Factory | `Attachment` → `PhotoAttachment`, `VoiceNoteAttachment`; `AttachmentFactory` | `app/domain/attachments.py` |
| Observer | `LiveEventObserver` (pushes events to browsers), new cases in `NotificationObserver` | `app/services/live.py`, `app/services/observers.py` |
| Repository | `AttachmentRepository`, `HandoverRepository`, `AssetRepository`, `BuildingPinRepository` | `app/repositories.py` |
| Encapsulation | `Incident.start_trip()`, `arrive()`, `record_handover()` enforce who/when; the handover code lives in its own collection so it never leaks into incident listings | `app/domain/models.py` |
| Service layer | `FieldVisitService`, `AttachmentService` | `app/services/field_service.py` |

## New API endpoints

```
GET  /api/incidents/{id}/field              where to go, navigation links, visit status, handover (code only for the reporter)
POST /api/incidents/{id}/field/en-route     technician sets off
POST /api/incidents/{id}/field/arrive       {latitude, longitude, accuracy_m} → GPS-verified check-in ({} = without location)
GET  /api/incidents/{id}/attachments        photos & voice notes (metadata)
POST /api/incidents/{id}/attachments        {kind: photo|voice, content_type, data_base64, stage?, duration_s?, transcript?}
GET  /api/attachments/{id}/content          the file itself
GET/POST/PUT/DELETE /api/assets[/{code}]    QR-sticker equipment (admin)
GET  /api/assets/{code}/qr.svg?base=URL     the sticker's QR code
GET  /api/campus/buildings, PUT /api/campus/buildings/{name}   building pins
GET  /api/campus/map                        located reports, hotspots, outages
GET  /api/live/stream?token=...             Server-Sent Events
POST /api/incidents/{id}/transition         now also takes handover_code when resolving
```

Tests: `backend/tests/test_field_features.py` (14 tests).

## Demo script (about 3 minutes)

1. Run `./start.sh` on the laptop and open the **ngrok https link** on your phone. GPS and the microphone only work over https or on localhost.
2. **Admin** → *QR stickers* → tick "Ceiling fan, Room 204" → *Print*. You can also just show the sticker on screen.
3. **Phone**: scan the sticker with the camera → sign in as the student → the form is already filled in. Tap **Speak instead** and describe the noise; the AI fills the form. Tap **Share my exact location**, record a 5-second voice note, and submit. The 4-digit handover code appears.
4. **Laptop**, signed in as the technician (Alice): the new report pops up live. *Claim* → **Navigate with Google Maps** (opens directions) → **I'm on my way**. The phone shows "Alice is on the way" without refreshing.
5. **I've arrived** (GPS-verified, with the distance in metres) → add an *after* photo → **Resolve**. Try a wrong code first ("4 attempts left"), then the code from the phone.
6. **Admin** → *Campus map* / *Overview*: file 3 quick reports from one bhavan to trigger the **possible outage** alert.
7. Turn on airplane mode on the phone and file a report: "saved on this device". Turn airplane mode off and it is sent automatically.

## Notes

- Building pins are **approximate** (spread around the campus centre at 17.5465 N, 78.5725 E). Before the demo, go to *Campus map → Correct building pins* and drag each one onto the real building. Check-in against a building pin allows an extra 120 m.
- Dictation uses the browser's speech service (Chrome/Edge), which needs internet. Voice-note recording works in every modern browser.
- Settings (Configuration page / `PUT /api/admin/settings`): `require_handover_code` (default on) and `arrival_radius_m` (default 150).
