# CLAUDE.md — gather

Standing context for this project. Read this every session before working. This file is the short, durable version — keep it accurate and update the **Status** section as phases complete.

## What this is

A Gather.town-style virtual office: tile-based movement, proximity video/audio calls, screen share, zone-scoped chat, and an in-browser map editor. pnpm monorepo:

- `packages/shared` — message types (`MSG`), `MapDoc` + `validateMap`, constants, walkability/zone helpers. Imported by both sides.
- `packages/server` — Colyseus 0.16 room (`space`, filtered by `spaceId`) on :2567. Authoritative movement, proximity link diffs (connect ≤3 tiles, drop >5, zones override), WebRTC signaling relay, chat, map persistence in `packages/server/data/maps/<spaceId>.json`. Serves the built client in production.
- `packages/client` — Vite + React + Phaser 3. Phaser renders the world (`game/SpaceScene.ts`); React renders all UI overlays; a zustand store (`src/store.ts`) bridges Colyseus/Phaser/React; `rtc/PeerManager.ts` runs the WebRTC mesh (MDN perfect negotiation, politeness by session-id order).

Commands: `pnpm dev` (server :2567 + Vite :5173, auto-bumps if taken), `pnpm build`, `pnpm start` (prod on :2567), `pnpm typecheck`, `pnpm gen-assets` (regenerates placeholder art + default map). Note: `pnpm-workspace.yaml` stubs the git-hosted `uWebSockets.js` (unused transport pulled in as a colyseus peer dep) via `stubs/uwebsockets-stub`.

## Deploy

Pushed to `github.com/suminnc/gather`. **Live**: client at https://gather-two-jet.vercel.app (Vercel project `gather`, `VITE_SERVER_URL` env set in production), server at https://gather-tguw.onrender.com (Render free). Redeploy client: `npx vercel deploy --prod`. Split deploy because Vercel cannot host the Colyseus server (serverless, no persistent WebSockets). Single-server fallback: the Render service alone serves the built client same-origin when `VITE_SERVER_URL` is unset. WebRTC uses Google STUN + Open Relay free TURN so calls work across NATs. Free-tier limits: Render spins down after ~15 min idle; ephemeral disk (map edits reset on restart). pnpm 11 note: build-script approvals live in `allowBuilds` in pnpm-workspace.yaml.

## Auth (invite-only workspaces)

Env-gated: `GOOGLE_CLIENT_ID` accepts a bare OAuth client id or comma-separated `origin=clientId` pairs (the user created one OAuth client per origin; all are accepted as audiences, /api/config + the client resolve the right one per origin). With it set on the server, sign-in is required and workspaces are invite-only; unset = open guest mode (current prod state until the env is added). The client needs no auth env — it reads `/api/config` at runtime. Flow: Google Identity Services button → ID token verified server-side (jose + Google JWKS, `packages/server/src/auth/google.ts`) → membership registry `data/spaces.json` (`auth/registry.ts`; ephemeral on Render). First authed joiner of a space owns it; Invite button copies `/space/:id?invite=<HMAC token>` (7-day expiry, secret = `INVITE_SECRET` env or generated `data/invite-secret`); a valid invite enrolls the joiner as a member permanently. Guests (“continue as guest” on the gate) enter only with a currently-valid invite link, are never enrolled as members, get no invite token to share, and cannot create spaces (`sign_in_to_create`); the client stashes the invite in sessionStorage per space so guest ?rejoin=1 reloads still work. `AUTH_DEV_FAKE=1` accepts `fake:{json}` tokens for tests — never set in prod. E2E test: `packages/client/scripts/invite-test.mjs` (needs fresh server, see header).

## Status

- **2026-07-05 (evening)** — Editor upgrades: custom tile designer (draw/import 32×32 PNGs; stored as data URLs in `MapDoc.customTiles`, gids ≥1000, baked into a live canvas texture `tiles-live` client-side); chat/editor/designer popups are movable+resizable via `ui/FloatingPanel` (positions persist in localStorage `gather:panel:*`); camera bounds pad symmetrically so a zoomed-out world centers; palette swatches render uncropped in inner spans with scrollable rows. All verified locally end-to-end incl. save/sync/persistence.

- **2026-07-05 (later)** — Google sign-in + invite-only workspaces implemented and e2e-tested (11 checks); enforcement OFF in prod until GOOGLE_CLIENT_ID is set on Render (user must create the OAuth client in Google Cloud Console: JS origins gather-two-jet.vercel.app + gather-tguw.onrender.com + http://localhost:5173).
- **2026-07-05 (later)** — Invite-link fix: backgrounded tabs (freeze/pagehide teardown) now auto-rejoin on return via `?rejoin=1` reload; join screen is deep-link-aware (invited slug always shows "Join", cold-start server shows "waking up" instead of "nobody online"); Invite button has a clipboard fallback. Verified locally with simulated freeze/resume.
- **2026-07-05** — Client built end-to-end (join flow, movement, proximity calls, zone isolation, chat, screen share, map editor). Verified with two clients: movement/collision sync, proximity link/unlink + zone rules, both chat scopes, editor save → live rebuild on other clients + disk persistence, prod serve from :2567. Not yet human-verified: actual camera/mic/screen media flow (automation tabs can't grant `getUserMedia`); the signaling/link layer and no-media degradation are verified. No tests, no STUN/TURN beyond Google STUN, no auth.

## Memory (Memori)
- Before drafting any substantive response, run `recall` via the memori skill — even if the user didn't mention memory or a prior session.
- After every non-trivial turn, run `advanced-augmentation` with the final user/assistant exchange to persist it.
- This applies regardless of whether the memori skill auto-triggers on its own; treat it as a standing project rule, not optional.