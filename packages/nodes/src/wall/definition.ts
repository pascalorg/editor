import type { NodeDefinition } from '@pascal-app/core'
import { wallParametrics } from './parametrics'
import { WallNode } from './schema'

/**
 * Wall — the Phase 3 stress test of the registry-driven node model.
 *
 * What this definition encodes today:
 *  - **Capabilities**: cuttable (doors/windows punch holes), snappable
 *    (other walls, doors, windows snap to wall geometry), surfaces (front
 *    + back faces host items), selectable, duplicable, deletable.
 *  - **Relations**: hosts doors/windows/items; affects spatial slabs +
 *    ceilings + zones when moved; descendants cascade-delete; linked walls
 *    follow corners via endpoint-match (consumed by the affordances in a
 *    later milestone — the relations resolver already understands the
 *    declaration).
 *  - **Parametrics**: thickness / height / curveOffset for the inspector.
 *
 * What this definition does *not* yet encode:
 *  - `geometry` / `renderer` / `system` runtime — the existing
 *    `wall-renderer.tsx` + `wall-system.tsx` keep serving wall until
 *    Milestone B ports them into this folder. Until then, this definition
 *    is metadata-only and *intentionally not registered* in
 *    `builtinPlugin.nodes` — the Phase 0 shims only flip behavior when a
 *    kind is registered, so wall stays on its legacy path.
 *  - `tool` — wall's placement + endpoint drag + curve drag tools port in
 *    a follow-up milestone, expressed via the `DragAction` primitive so
 *    the affordances declared in `relations` get real handles.
 *
 * Migration is gated by `feature-flag.ts` (env: `NEXT_PUBLIC_USE_REGISTRY_FOR_WALL`).
 * See `plans/editor-node-registry.md#phase-3` for the milestone breakdown.
 */
export const wallDefinition: NodeDefinition<typeof WallNode> = {
  kind: 'wall',
  schemaVersion: 1,
  schema: WallNode,
  category: 'structure',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    start: [0, 0],
    end: [3, 0],
    frontSide: 'unknown',
    backSide: 'unknown',
  }),

  capabilities: {
    // Wall move is bespoke today (endpoint drag, linked-wall corner cascade,
    // ALT-detach). `MoveRegistryNodeTool`'s "translate on X/Z plane" shape
    // doesn't apply — wall stays on its own move tool until the affordance
    // port. Leaving `movable` omitted keeps that dispatch.
    selectable: { hitVolume: 'bbox' },
    // Front + back faces host items (paintings, shelves, switches).
    // `height` callback resolves per-instance so taller walls expose taller
    // hosting surface — same shape used by shelf.top.
    surfaces: {
      // Sides config — wall has two faces; concrete face-selection logic
      // stays in the renderer/system for now. Phase 4 will derive snap
      // targets from this.
      sides: { faces: 'all' },
    },
    duplicable: true,
    deletable: true,
  },

  relations: {
    // Doors / windows / items mount on walls. The host-resolver consumes
    // this to validate `parentId` on creation and to re-anchor children
    // when a wall moves (a milestone-B concern; the declaration lives here
    // so the wiring exists ahead of time).
    hosts: ['door', 'window', 'item'],
    // Moving a wall dirties the slabs / ceilings / zones that border it.
    // Today this is *not* wired (the existing `wall-system` doesn't cascade
    // to slab / zone) — the registry resolver gains this behavior for free
    // once wall is registered. This is the "slab reflow on wall move"
    // behavior gain called out in Phase 3 acceptance.
    affectsSpatial: ['slab', 'ceiling', 'zone'],
    // Walls sharing an endpoint move together when a corner is dragged.
    // The endpoint affordance (milestone C) uses this declaration via the
    // shared cascade resolver — no hand-rolled `getLinkedWallSnapshots`.
    linkedBy: 'endpoint-match',
    // Deleting a wall deletes its hosted doors/windows/items (today's
    // implicit behavior, now declarative).
    cascadeDelete: 'descendants',
  },

  parametrics: wallParametrics,

  // No `geometry` / `renderer` / `system` / `tool` fields yet — see file
  // header. Adding them registers wall via `builtinPlugin.nodes` and flips
  // the dispatch shims; do that in milestone B once the runtime port lands.

  presentation: {
    label: 'Wall',
    description: 'A straight or curved wall segment. Hosts doors, windows, and wall-mounted items.',
    icon: { kind: 'iconify', name: 'lucide:wall' },
    paletteSection: 'structure',
    paletteOrder: 10,
  },

  mcp: {
    description: 'A wall segment defined by start + end points, with optional curve sagitta.',
    // Wall has hand-written semantic MCP tooling (`create_wall` builds full
    // rooms from polygons; this entry is for the auto-derived single-wall
    // primitive). Stays auto-derived until Phase 4 says otherwise.
  },
}
