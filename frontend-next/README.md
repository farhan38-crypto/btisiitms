# BITS reports: the app

The BITS reports web app. It talks to the FastAPI backend in `backend/`, works on desktop and
phones, and comes with a theme system that can grow (see `src/themes/README.md`). The original
React app in `frontend/` is kept only as a backup (`./start.sh --classic`, port 3001).

**Run it:** `./start.sh` from the project folder, then open http://localhost:3000. To run only
this one: `cd frontend-next && npm install && npm run dev` (with the backend on port 8000).

## How it is built

| Folder | What lives there |
|---|---|
| `src/api/` | The backend, typed. `endpoints.ts` has one function per route (grouped like `backend/app/routers`), `types.ts` the shapes, `client.ts` auth and error handling, `query.ts` a small cache (`useQuery`, `invalidate`), `live.ts` the Server-Sent Events stream that refreshes screens. |
| `src/shell/` | Top bar (desktop), tab bar (phones), command palette (Ctrl/⌘ K or `/`), live panel, error screen. |
| `src/ui/` | Building blocks: badges (priority, status, SLA), dialogs that become bottom sheets on phones, popovers, form controls, segmented controls. |
| `src/features/` | Screens: `incidents` (list beside a detail pane, board, table, filters), `incident` (detail: lifecycle rail, actions, activity, photos and voice notes, field visit and handover code), `report` (the four-step report form), `home` (student tracker), `inbox`, `account`, `admin` (users, configuration, audit, QR stickers), `docs`. |
| `src/pages/` | Sign-in, staff overview, full campus map. |
| `src/components/` | Backdrop and light, 3D sign-in object, charts, 3D graph, maps, Appearance panel. |
| `src/themes/` | Theme registry, families and catalogue. |
| `src/styles/` | `base` (tokens, glass), `shell`, `app` (components and screens), `phone` (≤ 760 px), plus map, charts, login, appearance. |

Design rules used throughout:

- Glass is for the navigation layer (bars, menus, popovers); content sits on denser surfaces so
  lists and forms stay sharp in every theme.
- Colour never carries meaning alone: priority has signal bars, status a progress ring, SLA a word.
- Every change made on one screen refreshes the others (`invalidate`), and live events from the
  backend do the same for changes made by other people.
- The map is dark by default in every theme; the sun/moon button on the map switches it.

## Adding a backend route

1. Add the function to `src/api/endpoints.ts` (and its types to `src/api/types.ts`).
2. Read it with `useQuery('<key>', () => api.<group>.<fn>())`.
3. After a change, call `invalidate('<key prefix>')` so every screen showing it refreshes.

## Maps

The campus map uses MapLibre with OpenFreeMap street tiles and Esri satellite photos, so it needs
no key. Optional: `VITE_GOOGLE_MAPS_KEY` (and `VITE_GOOGLE_MAP_ID`) in `frontend-next/.env` uses
Google Maps instead.
