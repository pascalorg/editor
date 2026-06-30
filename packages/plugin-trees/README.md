# @pascal-app/plugin-trees

The first-party **example plugin** for the Pascal editor. It contributes a
procedural _trees_ node and a left-rail _presets_ panel, and exists to prove —
and document — the minimal host surface every future plugin reuses.

It is structurally identical to a third-party plugin: it peer-depends on
`@pascal-app/{core,viewer,editor}` (plus `react`/`three`/`zustand`) and imports
nothing private. Copy this folder as the starting point for a new plugin.

## What it demonstrates

The three contribution paths a plugin has:

1. **Left-rail panel** — `panels` in the manifest. `presets-panel.tsx` is a
   plain React component the host mounts behind an error boundary.
2. **Right inspector for free** — `def.parametrics` (`parametrics.ts`). The host
   renders the preset/height/seed controls + the Randomize action with zero
   tree-specific code.
3. **3D render + placement for free** — `def.geometry` (`geometry.ts`, a pure
   `three` builder) and `def.tool`/`def.preview` (`tool.tsx`, `preview.tsx`).

It also shows the communication triangle: `presets-panel` → plugin store
(`store.ts`) → `def.tool` → `SceneApi` → scene → reactive `useScene` read-back
(the "N planted" counter in the panel).

## Manifest

```ts
import { treesPlugin } from '@pascal-app/plugin-trees'
// host:
setPluginDiscovery(async () => [treesPlugin])
```

`treesPlugin` exports one node kind (`trees:tree`) and one panel (`Trees`),
loaded through the same `loadPlugin` path as the built-ins.

## Notes / known gaps

- `createNode` and the `floorPlaced.footprint` callback are typed against the
  host's hand-maintained `AnyNode` union, so the node is cast (`as AnyNode` /
  `as TreeNode`). The registry derives `AnyNode` post-migration.
- The placement tool re-derives level-local conversion from the public
  `sceneRegistry` because the built-in `floor-placement` helpers aren't part of
  the public `@pascal-app/*` surface yet — a candidate for a future
  `@pascal-app/plugin-api` re-export package.

See `wiki/architecture/plugin-authoring.md` for the full contract.
