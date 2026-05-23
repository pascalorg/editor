# Plugin authoring

*Public contract for external node packs that extend the Pascal editor.*

Applies to: anything that ships a `Plugin` for the editor to load.

This page documents the **contract**, not a loader implementation. The host call site (`discoverPlugins()`) is in place; turning it into a real network loader is a separate plan.

## Plugin shape

A plugin is a JS object exporting one symbol — the manifest:

```ts
import type { Plugin } from '@pascal-app/core'

export const myPlugin: Plugin = {
  id: 'acme:furniture-pack',
  apiVersion: 1,
  nodes: [
    couchDefinition,
    armchairDefinition,
    // ...
  ],
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Globally unique. Use `vendor:pack-name` to avoid collisions. The host treats it as opaque. |
| `apiVersion` | yes | Currently `1`. The host throws on mismatch — bumping breaks plugins, intentionally. |
| `nodes` | optional | Array of `AnyNodeDefinition`. May be empty for a pure-resource plugin (future). |

The same shape powers the built-in `pascal:core` plugin in `@pascal-app/nodes` — there's no "internal" plugin format. Whatever works for built-ins works for third parties.

## What a `NodeDefinition` can contribute

A plugin's `nodes` array is the only meaningful contribution point in v1. Each entry is a `NodeDefinition<S extends ZodObject>` that the registry stamps with `kind`, `schemaVersion`, `schema`, and any combination of:

- `defaults` — initial field values for new instances.
- `capabilities` — `selectable` / `duplicable` / `deletable` / `surfaces` / `relations` flags consumed by the framework.
- `parametrics` — auto-derived inspector UI shape (`fields` + optional `customPanel` escape hatch).
- `renderer` — custom 3D React component (GLB, drei, TSL — opt-out of `def.geometry`).
- `system` — per-frame work (animation, dirty-cascade, runtime state).
- `geometry` — pure `(node, ctx) => Object3D` for the generic `<GeometrySystem>`.
- `floorplan` — pure `(node, ctx) => FloorplanGeometry` for the 2D layer.
- `floorplanAffordances` / `floorplanMoveTarget` — 2D drag handlers.
- `tool` / `affordanceTools` — 3D placement + move tools (lazy components).
- `presentation` — palette / sidebar metadata (`label`, `icon`, `paletteSection`, etc.).
- `mcp` — MCP tool descriptions for AI consumers.
- `relations` / `computeLevelData` — sibling lookups + level-batch precompute.

See [`node-definitions.md`](node-definitions.md) for the three-checkbox composition model that ties these together.

## Importing host packages

A plugin imports from the published `@pascal-app/*` packages — same surface the built-ins use, peer-dependency-style:

```ts
// Schemas, types, registry types
import {
  type AnyNode,
  type NodeDefinition,
  type Plugin,
  z, // re-exported from zod for schema authoring
} from '@pascal-app/core'

// Viewer-side primitives (lazy: only inside renderers / systems)
import { useNodeEvents, NodeRenderer } from '@pascal-app/viewer'

// Editor-side primitives (lazy: only inside `tool` / `affordanceTools`)
import { useDragAction, EDITOR_LAYER } from '@pascal-app/editor'
```

The packages are **peer dependencies**, not normal dependencies — the host app owns the version. A plugin that pins its own copy of `@pascal-app/core` would create two registries and silently fail. (npm peer-dep resolution catches this at install time.)

## Lifecycle

```mermaid
graph TD
  Boot[App boot] --> LoadBuiltin[loadPlugin(builtinPlugin)]
  LoadBuiltin --> Discover[await discoverPlugins()]
  Discover --> LoadEach[for each: await loadPlugin(p)]
  LoadEach --> Ready[Registry frozen for the session]
```

`loadPlugin` is **add-only** for v1. Hot-removing a kind would require tearing down every mounted instance in the scene — out of scope. Plugins are loaded once at boot.

`registerNode` throws on duplicate `kind`, so two plugins shipping a `kind: 'couch'` is a startup-time error, not a silent overwrite.

## Discovery: `setPluginDiscovery`

The host calls `discoverPlugins()` after the built-in plugin loads. The default implementation returns `[]`. Apps that ship external plugins replace it before the bootstrap module evaluates:

```ts
// In app boot, BEFORE `import './pascal-bootstrap'`
import { setPluginDiscovery } from '@pascal-app/core'
import { myPlugin } from '@acme/furniture-pack'

setPluginDiscovery(async () => {
  // Static import: bundled into the app.
  return [myPlugin]

  // Or fetch a manifest, dynamic-import each entry, etc.
  // const manifest = await fetch('/plugins.json').then(r => r.json())
  // return Promise.all(manifest.map(m => import(m.url).then(mod => mod.default)))
})
```

`setPluginDiscovery` is global. Calling it twice silently overwrites — order with the bootstrap import matters.

## Versioning

`apiVersion: 1` covers the surface above. The host bumps the major when it removes or changes the shape of an existing field. New optional fields don't bump. The plan is to keep additions backwards-compatible as long as possible — the bump is the escape hatch, not the default.

A plugin's own data versioning is `schemaVersion` on each `NodeDefinition`. The host doesn't migrate; the plugin's `migrate(node, fromVersion)` (future) handles its own legacy persisted nodes.

## What's *not* a plugin contribution (yet)

- **Materials** — there's no `plugin.materials` slot. Use `createMaterial` from `@pascal-app/viewer` inside your `def.renderer` / `def.system`.
- **Floor-plan primitives** — the `FloorplanGeometry` union is host-owned. To draw something the union can't express, fall back to `def.renderer` and render through a different 2D mount (or open an issue).
- **Stores** — plugins create their own Zustand stores; they don't extend `useScene`, `useEditor`, or `useViewer`. Host stores are not part of the v1 plugin surface.
- **Routes / pages** — plugins are visualisation + interaction code, not full app surfaces. Hosting a settings page belongs to the app.

The boundary stays narrow on purpose so the contract is shippable. Each "not yet" item is a plan, not a "never."

## Testing your plugin

`@pascal-app/nodes` is the reference implementation — every built-in kind is structurally a plugin. To test locally:

1. Build your plugin as a normal npm package with `@pascal-app/*` as peerDependencies.
2. In a host app that consumes your built-ins (`apps/editor` is the easiest target), wire `setPluginDiscovery` to return your plugin.
3. The dev-mode `[pascal:registry]` console log shows the loaded plugin id + node count — that's the verification anchor.

The host's own parity test (`packages/nodes/src/index.test.ts`) asserts every `AnyNode` discriminator has a registered kind. Plugin-contributed kinds don't participate in that test (they're not in `AnyNode`); add an equivalent test on your own side if you maintain a hand-typed union elsewhere.
