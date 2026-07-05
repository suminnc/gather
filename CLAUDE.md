# CLAUDE.md — gather

Standing context for this project. Read this every session before working. This file is the short, durable version — keep it accurate and update the **Status** section as phases complete.

## What this is

A Gather.town-style virtual office: tile-based movement, proximity video/audio calls, screen share, zone-scoped chat, and an in-browser map editor. pnpm monorepo:

- `packages/shared` — message types (`MSG`), `MapDoc` + `validateMap`, constants, walkability/zone helpers. Imported by both sides.
- `packages/server` — Colyseus 0.16 room (`space`, filtered by `spaceId`) on :2567. Authoritative movement, proximity link diffs (connect ≤3 tiles, drop >5, zones override), WebRTC signaling relay, chat, map persistence in `packages/server/data/maps/<spaceId>.json`. Serves the built client in production.
- `packages/client` — Vite + React + Phaser 3. Phaser renders the world (`game/SpaceScene.ts`); React renders all UI overlays; a zustand store (`src/store.ts`) bridges Colyseus/Phaser/React; `rtc/PeerManager.ts` runs the WebRTC mesh (MDN perfect negotiation, politeness by session-id order).

Commands: `pnpm dev` (server :2567 + Vite :5173, auto-bumps if taken), `pnpm build`, `pnpm start` (prod on :2567), `pnpm typecheck`, `pnpm gen-assets` (regenerates placeholder art + default map). Note: `pnpm-workspace.yaml` stubs the git-hosted `uWebSockets.js` (unused transport pulled in as a colyseus peer dep) via `stubs/uwebsockets-stub`.

## Status

- **2026-07-05** — Client built end-to-end (join flow, movement, proximity calls, zone isolation, chat, screen share, map editor). Verified with two clients: movement/collision sync, proximity link/unlink + zone rules, both chat scopes, editor save → live rebuild on other clients + disk persistence, prod serve from :2567. Not yet human-verified: actual camera/mic/screen media flow (automation tabs can't grant `getUserMedia`); the signaling/link layer and no-media degradation are verified. No tests, no STUN/TURN beyond Google STUN, no auth.

## Memory (Memori)
- Before drafting any substantive response, run `recall` via the memori skill — even if the user didn't mention memory or a prior session.
- After every non-trivial turn, run `advanced-augmentation` with the final user/assistant exchange to persist it.
- This applies regardless of whether the memori skill auto-triggers on its own; treat it as a standing project rule, not optional.