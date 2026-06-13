# Node definitions

*The registry-driven composition model for node kinds.*

Applies to: `packages/core/src/registry/`, `packages/nodes/src/<kind>/`, `packages/viewer/src/components/viewer/{registered-systems.tsx,node-renderer.tsx}`.

A *node kind* — shelf, wall, door, item, spawn, zone — is described by a `NodeDefinition` registered with `nodeRegistry`. The definition is plain data + lazy module references. Three optional fields decide how the kind appears in the scene at runtime; pick whichever combination matches the kind's needs.

This page covers those three fields. For the broader registry contract (schemas, capabilities, parametrics, MCP), see [the registry plan](../../../plans/editor-node-registry.md) in the private repo.

## The three-checkbox model

| Field | Purpose | Pick it when |
|---|---|---|
| `geometry?: (node, ctx, shading, textures, colorPreset, sceneTheme) => Object3D` | Pure builder. Returns the meshes for this node. The appearance args (after `ctx`) are optional — take them only if the builder picks its own materials. | The kind has parametric meshes that should rebuild when `updateNode` runs. |
| `renderer?: () => Promise<{ default: ComponentType<{ node }> }>` | Optional custom React component. Owns mesh creation. | The kind needs JSX-only features: `<Html>`, `useGLTF`, drei helpers, instancing, TSL shader materials, R3F portals. |
| `system?: () => Promise<{ default: ComponentType }>` | Optional per-frame component (`useFrame` returning `null`). | The kind needs imperative work per frame: animations, opacity transitions, named-mesh material poking, cross-kind dirty cascades. |

The three fields are **independent**. There is no discriminator tag — presence is participation:

```ts
// shelf — pure geometry, no React, no per-frame work
export const shelfDefinition: NodeDefinition<typeof ShelfNode> = {
  // ...
  geometry: buildShelfGeometry,         // pure function in geometry.ts
}

// zone — built once via React (uses <Html>), animated per-frame via system
export const zoneDefinition: NodeDefinition<typeof ZoneNode> = {
  // ...
  renderer: () => import('./renderer'),  // composes <Html> + TSL materials
  system: { module: () => import('./system') },  // pokes uniforms per frame
}

// door — pure geometry + animation system
export const doorDefinition: NodeDefinition<typeof DoorNode> = {
  // ...
  geometry: buildDoorGeometry,
  system: { module: () => import('./animation') },  // advances operationState
}
```

## Runtime: how the three fields are wired

Two framework components live in `packages/viewer/src/components/viewer/`:

- **`<NodeRenderer>`** chooses what React mounts for a node:
  1. If `def.renderer` is set → mount the custom renderer.
  2. Otherwise → mount `<ParametricNodeRenderer>` — a thin empty `<group>` that registers with `sceneRegistry`, attaches pointer handlers via `useNodeEvents`, reads `useLiveTransforms` for drag overrides, and calls `useScene.getState().markDirty(node.id)` on mount.
- **`<GeometrySystem>`** runs every frame:
  1. Read `dirtyNodes` from `useScene`.
  2. For each dirty node whose kind has `def.geometry`, look up the registered `Group` from `sceneRegistry`, build a `GeometryContext`, call `def.geometry(node, ctx, shading, textures, colorPreset, sceneTheme)`, dispose old children, attach the new ones, call `clearDirty(id)`. It re-runs whenever any of those appearance values change.
  3. After building, if `textures` is off and the kind declares `def.surfaceRole`, `GeometrySystem` overrides the built meshes' materials with the themed role colour (`applyDefaultSurfaceRole`).
  4. Kinds with no `def.geometry` are skipped — their custom `def.renderer` handles geometry on its own.

### `surfaceRole`

A kind may declare `surfaceRole?: SurfaceRole` on its definition. It is a colour token only (`core` stores no material), used to resolve the per-role clay/theme colour for untextured surfaces. See [materials-and-themes](materials-and-themes.md).

Per-kind `def.system` components mount alongside via `<RegisteredSystems>`. They run their own `useFrame` and can mark nodes dirty, address meshes by `getObjectByName`, advance animation state, etc. They run **in addition** to `GeometrySystem`, not instead of it.

### `dirtyTracking`

`dirtyNodes` is the per-frame rebuild queue consumed by `<GeometrySystem>` (`def.geometry`), `<FloorElevationSystem>` (`capabilities.floorPlaced`), and the legacy per-kind viewer systems. Kinds none of those consume — structural/organizational kinds like site, building, level, zone, guide — declare `dirtyTracking: false` so `markDirty` skips them. Without it their marks are never cleared: they accumulate for the whole session, defeat every consumer's empty-set early exit each frame, and pollute the perf overlay's DIRTY readout. If such a kind later gains `def.geometry` (or any other dirty consumer), delete the flag.

## `GeometryContext`

The second arg to `geometry()` is scene read access for builders that reference other nodes by ID. Most kinds ignore it.

```ts
type GeometryContext = {
  resolve: <N = AnyNode>(id: AnyNodeId) => N | undefined
  children: AnyNode[]    // resolved children of this node
  siblings: AnyNode[]    // same kind, same parent (drives wall mitering)
  parent: AnyNode | null
}
```

- **Shelf, spawn, item, column, fence segment** — builder reads only `node`. `ctx` argument unused.
- **Wall** — `ctx.siblings` for corner mitering with adjacent walls. `ctx.children` for cutout footprints (doors / windows hosted on the wall).
- **Door / window** — `ctx.parent` for parent-wall thickness, so the frame depth lines up with the wall it's cut into.

`GeometryContext` exists so builders stay pure (no `useScene` import, no store mutation) and trivially unit-testable. The generic `<GeometrySystem>` builds `ctx` from the current scene snapshot once per dirty node; the cost is a few `Map.get` calls.

For level-scoped batch data (wall mitering across an entire level), `ctx` can be extended with `ctx.levelData?.miters` in a future revision — decided alongside the wall migration (Phase 3 of the registry plan).

## Choosing the right combination

### `geometry` only

Use this when the kind's meshes are a pure function of its node data. **Shelf, spawn, item, column, fence segment, wall, door (geometry side), window (geometry side).**

```ts
// packages/nodes/src/shelf/geometry.ts
export function buildShelfGeometry(node: ShelfNode): Group {
  const group = new Group()
  group.add(buildTopBoard(node))
  group.add(buildBracket(node, -1))
  group.add(buildBracket(node, +1))
  return group
}

// packages/nodes/src/shelf/definition.ts
export const shelfDefinition: NodeDefinition<typeof ShelfNode> = {
  // ...
  geometry: buildShelfGeometry,
}
```

No renderer.tsx, no system.tsx. The generic renderer mounts an empty group, the generic system fills it.

### `renderer` only (no `geometry`, no `system`)

Use this when the kind composes its scene via JSX-only features and never needs imperative per-frame work. **GLB-backed items, kinds that mount drei helpers.**

```tsx
// packages/nodes/src/<kind>/renderer.tsx
import { useGLTF } from '@react-three/drei'
import { useRegistry } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'

const FurnitureRenderer = ({ node }: { node: FurnitureNode }) => {
  const ref = useRef<Group>(null!)
  const { scene } = useGLTF(node.asset.url)
  const handlers = useNodeEvents(node, 'furniture')
  useRegistry(node.id, 'furniture', ref)
  return <primitive object={scene.clone()} ref={ref} {...handlers} />
}
```

No `def.geometry` — geometry is the GLB. No `def.system` — there's nothing to animate.

### `renderer` + `system` (no `geometry`)

Use this when the kind's tree contains React-only primitives (e.g. `<Html>`) and needs per-frame imperative work that doesn't rebuild geometry. **Zone.**

The renderer composes the tree once. The system pokes uniforms / opacity / transforms by name:

```tsx
// renderer.tsx
<group ref={ref} {...handlers}>
  <Html name="label" position={centroid}>{node.name}</Html>
  <mesh name="floor" geometry={floorGeometry} material={floorMaterial} />
  <mesh name="walls" geometry={wallGeometry} material={wallMaterial} />
</group>

// system.tsx
useFrame(() => {
  sceneRegistry.byType.zone.forEach((id) => {
    const group = sceneRegistry.nodes.get(id) as Group
    const walls = group.getObjectByName('walls') as Mesh
    const material = walls.material as MeshBasicNodeMaterial
    material.userData.uOpacity.value = lerp(currentOpacity, targetOpacity, lerpSpeed)
  })
})
```

### `geometry` + `system`

Use this when the kind has parametric geometry **and** extra responsibilities. **Door, window.**

- `geometry` builds the visible meshes (frame, panels, hardware) as a pure function of node state + parent wall.
- `system` advances animation (`operationState`), then calls `markDirty(node.id)` so the geometry system rebuilds on the next frame.

This split keeps animation state outside the node schema (it's ephemeral — lives in `useInteractive`) while still re-using the generic rebuild path.

## Named meshes work in either pattern

Setting `mesh.name = 'walls'` is just a three.js property. A system targeting `getObjectByName('walls')` doesn't care whether the mesh was created in JSX (`<mesh name="walls" />`) or imperatively in a pure builder (`mesh.name = 'walls'; group.add(mesh)`). Use whichever fits the kind.

## Migrating from custom renderer+system files to `def.geometry`

If your kind's current system *only* rebuilds geometry on dirty (no animations, no cascades, no material poking), it can collapse to a single `def.geometry` function:

1. Extract the imperative `updateXMesh(node, group)` from the system into a pure `buildXGeometry(node): Group` in `packages/nodes/src/<kind>/geometry.ts`.
2. Replace `def.renderer` with nothing — the framework's `<ParametricNodeRenderer>` covers it.
3. Replace `def.system` with `def.geometry: buildXGeometry`.
4. Delete `renderer.tsx` and `system.tsx`.

If the system also handles cascades, animations, or material updates, keep `def.system` and *also* set `def.geometry` — they run side by side.

## Rules

- **Builders must be pure.** No `useScene` import inside a `def.geometry` function. Read scene state via `ctx`. Mutating the store from a builder breaks idempotence.
- **Builders emit local-space children.** The registered `<group>` is positioned/rotated by `<ParametricNodeRenderer>` via JSX (`position={liveTransform?.position ?? node.position}`). Builders return geometry as if the parent were at the origin — never bake the node's world position into vertex coords.
- **One mesh registered per node ID.** The generic renderer registers a single `<group>` per node. If a custom renderer mounts multiple meshes, register the parent group (or whichever object the system needs to address).
- **Custom systems run in addition to the generic system, not instead of it.** A kind with `def.geometry` + `def.system` will see the generic system rebuild children on dirty AND the per-kind system run its `useFrame`. Plan priorities accordingly: door-animation runs at priority 2, geometry rebuild at priority 3.
- **Dispose on rebuild.** The generic system disposes the previous children's geometry + material before swapping. Custom systems that imperatively add children must dispose what they replace, or accept the GPU-memory cost.
- **`def.renderer` overrides the generic renderer.** Once you set it, you own the mount — `<ParametricNodeRenderer>` is not invoked. The generic geometry system still runs for the kind if `def.geometry` is set, so a custom renderer can register an empty group and let the system fill it.

## `toolHints`

`toolHints?: ToolHint[]` is the registry-owned source for the floating helper shown while
a registered placement or draw tool is active.

```ts
type ToolHint = {
  key: string
  label: string
}
```

Keep labels short and action-oriented. Prefer the default guided-building language:
snapping, angle increments, guides, and validation are active unless the user holds Shift
during the gesture. A `Shift` hint should describe the bypass in user terms, such as
`Free angle`, `Free place`, or `Bypass guided constraints`.

`HelperManager` renders `def.toolHints` through `RegisteredToolHelper`, and active Shift
state can update the row to show that guided constraints are currently bypassed. Select
mode is not owned by a node definition, so its helper is derived separately from
selection state, selected-node move/rotate capabilities, and held modifiers.

## Pitfalls

### `<GeometrySystem>` must not mutate `group.position` / `group.rotation`

`ParametricNodeRenderer` binds `<group position={liveTransform?.position ?? node.position}>` and the matching rotation via JSX. React only re-applies the prop when its underlying value changes. If the geometry system imperatively zeroes `group.position` after a rebuild — as legacy per-kind systems used to — R3F has no reason to re-render on the next tick and the group stays at the origin. Symptom: the node visually snaps to `(0, 0, 0)` whenever its geometry rebuilds (move commit, dimension change, paint).

The contract is the other way around now: builders produce local-space children; the renderer owns the transform; the system only swaps children.

### Tag geometry-built children with `userData.__fromGeometry`

A registered `<group>` can host **two** kinds of children: meshes the geometry builder created (boards, posts, dividers) and React-rendered hosted nodes (items reparented onto a shelf surface). When the system rebuilds, it must dispose only the previous geometry pass — disposing React-mounted children would tear out their meshes mid-mount, leaving the hosted node in scene state but invisible. Symptom: dragging an item onto a shelf makes the item disappear and never come back.

`<GeometrySystem>` tags every child returned by the builder with `userData.__fromGeometry = true` and `disposeChildren` only removes/disposes children carrying the marker. Custom systems that imperatively add children to a registered group must follow the same convention if hosted children are possible.

### Previews must clone materials before mutating them

`def.preview` typically calls the kind's geometry builder, then walks the resulting meshes and sets `material.transparent = true; material.opacity = 0.5` for a ghosted look. If the builder caches materials at module scope — and shelf, item, and most cache-friendly kinds do, keyed on `material` / `materialPreset` — every committed instance of the kind in the scene shares one material instance. Mutating it in the preview leaks the translucency into every real node that uses the default material; placed shelves render see-through, placed items lose their opacity, etc.

The fix is to clone in the preview, mutate the clone, and reassign `mesh.material` to the clone. On unmount, dispose only the clones — **never** the original returned by the builder, which other nodes still reference. `nodes/src/shelf/preview.tsx` is the reference implementation.

### Host kinds need a `children` field on the schema

If your kind declares `relations.hosts: [...]`, add `children: z.array(...).default([])` to the schema. `useScene.createNode(child, parentId)` writes `child.parentId = parentId` **and** appends `child.id` to `parent.children`. Without the field, the parent-side write is a no-op — `<ParametricNodeRenderer>`'s `n.children.map(...)` then has nothing to mount and the host renderer never sees the new child. Symptom: hosted node lives in `useScene.nodes` but no React mount fires, so the host's tree-node sidebar entry is empty and the 3D scene shows nothing where the host should pick it up.

Migrations matter: if your kind shipped before hosting was added, patch existing nodes in `migrateNodes` so `Array.isArray(node.children)` holds for every loaded scene before the renderer reads it.

## Capability reference

### `capabilities.roofAccessory`

Marks a kind as a roof-segment-mounted accessory (chimney, dormer, skylight, solar-panel, ridge-vent, box-vent). Presence tells the viewer's roof-merge loop two things:

1. **Dirty cascade.** When the accessory is dirtied (move / resize / reparent), the host segment's parent roof queues a re-merge so its merged shell re-CSGs with the updated cut. The merge loop clears the accessory's dirty bit and queues the parent roof.
2. **Optional CSG cut.** When `buildCut` is set, the merge loop subtracts the returned geometry from the host segment's shin / deck / wall brushes. Returned geometry must be **segment-local**; the viewer handles vertex welding, material group attachment, and `three-bvh-csg` brush wrapping so core stays free of three-bvh-csg deps.

```ts
type RoofAccessoryConfig = {
  buildCut?: (node: AnyNode, hostSegment: AnyNode) => BufferGeometry | null
}
```

Set `buildCut` for kinds that cut **through** the roof (skylight, dormer). Kinds that sit **on top** (vents, solar panels) declare the capability without `buildCut` — the cascade still fires but no CSG cut runs.

```ts
// skylight — cuts through the roof
capabilities: {
  roofAccessory: {
    buildCut: (node, hostSegment) => buildSkylightRoofCut(node, hostSegment),
  },
},

// box-vent — sits on top, no cut needed
capabilities: {
  roofAccessory: {},
},
```

---

### `capabilities.paint`

Per-kind paint dispatch. Lets the editor's `selection-manager` route paint hover / click / preview through a generic dispatcher instead of adding an `if (node.type === '<kind>')` arm for every paintable kind.

The capability owns four decisions:

1. **`resolveRole`** — which logical surface the pointer clicked. Returns `null` when the face shouldn't be painted (interior slot, oblique normal, etc.).
2. **`buildPatch`** — the node-update partial to commit on click.
3. **`applyPreview`** — applies a preview material to the mesh subtree and returns a cleanup callback. Returns `null` when the mesh isn't mounted yet; the editor falls back to the not-allowed cursor.
4. **`getEffectiveMaterial`** *(optional)* — reads the currently-effective material for a role, walking any parent-fallback chain. Drives the color picker's current-value indicator.

```ts
type PaintCapability = {
  resolveRole: (args: PaintResolveArgs) => string | null
  buildPatch: (args: PaintPatchArgs) => Partial<AnyNode>
  applyPreview: (args: PaintPreviewArgs) => (() => void) | null
  getEffectiveMaterial?: (args: PaintEffectiveMaterialArgs) => {
    material: MaterialSchema | undefined
    materialPreset: string | undefined
  } | null
}
```

Implement the capability in a `paint.ts` file next to `definition.ts`. Keep it pure — no `useScene`, no store mutation. Reference implementations: `packages/nodes/src/chimney/paint.ts` (body/top split), `packages/nodes/src/wall/paint.ts` (interior/exterior + normal-based disambiguation).

```ts
capabilities: {
  paint: chimneyPaint,  // imported from ./paint.ts
},
```

---

### `keyboardActions`

Registry-driven R / T key handlers. A kind that wants to override the R (`rotate clockwise`) or T (`rotate counter-clockwise`) keystroke sets this field on its `NodeDefinition` instead of extending the hand-written `if/else` chain in `use-keyboard.ts`.

```ts
type KeyboardActions = {
  r?: KeyboardAction  // R / Shift+R primary action
  t?: KeyboardAction  // T / Shift+T secondary action
}

type KeyboardAction = {
  /**
   * Return false to fall through to the editor's default rotation
   * behaviour. Use this to short-circuit the action for non-operable
   * type variants (e.g. a fixed skylight should rotate, not toggle).
   */
  appliesTo: (node: AnyNode) => boolean
  /**
   * Execute the action. The editor handles preventDefault and the
   * shared sfx; only touch scene / interactive state here.
   */
  run: (node: AnyNode) => void
}
```

```ts
// skylight — R toggles open/closed on operable types; T forces close
keyboardActions: {
  r: {
    appliesTo: (node) => node.type === 'skylight' && isOperableSkylightNode(node),
    run: (node) => toggleSkylightOpenState(node.id),
  },
  t: {
    appliesTo: (node) => node.type === 'skylight' && isOperableSkylightNode(node),
    run: (node) => closeSkylightOpenState(node.id),
  },
},
```

Door and window still use legacy direct calls in `use-keyboard.ts`; migrating them under this capability is a follow-up.

---

## See also

- [renderers.md](renderers.md) — the legacy renderer pattern (still authoritative for kinds with custom `def.renderer`).
- [systems.md](systems.md) — per-kind systems, frame-priority ordering, and core/viewer split.
- [scene-registry.md](scene-registry.md) — how `sceneRegistry` indexes nodes by ID and type.
- [Node registry plan](../../../plans/editor-node-registry.md) *(in private-editor)* — the multi-phase migration that produced this model.
