# Pascal VTT

This repository is the VTT. It is a fork of
[`pascalorg/editor`](https://github.com/pascalorg/editor) updated for tabletop use, not a
separate table application.

`editor.thilke.com` stays the stock editor. `vtt.thilke.com` is served from this fork.

## What changed direction

The earlier `thilke-table` repository built a 2D Phase 0 table with its own lobby and grid.
That was a multiplayer plumbing spike, not the editor, and it is retired as the VTT UI.
Its authoritative server is still useful and is the multiplayer backend for this fork:
rooms, membership, presence, server-checked token moves, dedupe/sequence, reconnect.

## Shape

- **Base:** upstream `apps/editor` and the published `@pascal-app/*` packages. Keep the
  `upstream` remote and merge it regularly; VTT changes stay additive and reviewable.
- **VTT mode:** a VTT route/mode in the editor host that loads a room scene, joins the
  table, and renders with the real Pascal viewer. The stock editor routes stay intact.
- **Multiplayer:** the `thilke-table` server is the authority for room membership, presence,
  and token moves. The editor client connects over WebSocket; the server commits, broadcasts
  deltas, and persists. No CRDT.
- **Identity:** Pocket ID through the existing thilke gateway (`X-Forwarded-User` /
  `X-Auth-Request-User`); the room allowlist uses the Pocket ID UUID. Groups decide GM/player.
- **Scene:** a published editor scene is a room base. GM prep stays in the stock editor.
  Tokens are a VTT node kind; the first slice may render them as viewer overlays before they
  become scene nodes.
- **Deploy:** `vtt.thilke.com` from this fork's image plus the multiplayer service;
  `editor.thilke.com` is untouched.

## First slice

1. Add a `/vtt` route in `apps/editor`: room link, join, and the real Pascal scene render.
2. Connect to the multiplayer server: presence, own-token moves, GM moves, reload persistence.
3. Real auth and room allowlist; no development identity.
4. Build the fork image and deploy it at `vtt.thilke.com` with the server.

Not in the first slice: chat, dice, combat, fog, multi-GM co-editing.

## Working rules

- One logical commit per change; PRs; no secrets or data stores.
- Upstream parity: do not rewrite upstream files when an additive plugin/route will do.
- The `thilke-table` UI is not a reference for the VTT UI; the editor is.
