## What does this PR do?

Fixes #733.

Deleting a local scan or guide node only routed `http(s)` URLs to `onDeleteAsset`. Local `asset://` Files — including scans up to ~200 MB — stayed in IndexedDB forever after the referencing node was gone.

This PR schedules a **delayed delete of the specific File** when the last live node that pointed at it is removed:

- Scene-panel delete of a scan/guide schedules the local File for removal after a 120s grace period (undo can still restore the node and load the blob).
- Reference-panel delete and replace paths do the same for guide images.
- `deleteAsset` in `@pascal-app/core` removes the IndexedDB entry and revokes any cached object URL.

It does **not** sweep “all unreferenced assets” on scene load. IndexedDB is origin-global and not scoped by scene, so a single-graph sweep would wipe local assets still used by other scenes.

## How to test

1. Self-host the editor (`bun dev`), open a project, and upload a local guide image.
2. Delete the node from the Scene panel (or the reference panel).
3. Within ~2 minutes, Ctrl+Z the delete — the guide should still resolve.
4. Let the grace period elapse (or wait for the timer) — the IndexedDB entry for that asset should be gone (`Application → IndexedDB` in DevTools).
5. Open another scene that still has local assets — they must remain loadable (no cross-scene wipe).

## Screenshots / screen recording

N/A — storage lifecycle only, no visual change.

## Checklist

- [x] I've tested this locally with `bun dev`
- [x] My code follows the existing code style (run `bun check` to verify)
- [ ] I've updated relevant documentation (if applicable)
- [x] This PR targets the `main` branch

## Validation

- `packages/core`: 1532 tests pass (`bun run test`)
- `packages/editor`: `local-asset-lifecycle.test.ts` 5/5 pass
- `@pascal-app/core` `tsc --build` clean
- `@pascal-app/editor` `check-types` clean
