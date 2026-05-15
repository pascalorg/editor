import type { NodeDefinition } from '@pascal-app/core'
import { fenceParametrics } from './parametrics'
import { FenceNode } from './schema'

/**
 * Fence — the first Phase 5 batch-migration kind.
 *
 * What this definition encodes:
 *  - **Capabilities**: snappable (other walls/fences/items snap to it),
 *    surfaces (front + back faces host items), selectable, duplicable,
 *    deletable. No `movable` capability — fence move is bespoke
 *    endpoint-drag, same shape as wall (handled by legacy MoveFenceTool
 *    until the affordance port).
 *  - **Relations**: `linkedBy: 'endpoint-match'` for fence-corner cascade.
 *    No `hosts` field — doors/windows don't mount on fences. `affectsSpatial`
 *    omitted: moving a fence doesn't dirty slabs/zones in the legacy
 *    behavior, so the registry stays parity-equivalent until we
 *    explicitly add the cascade (separate decision).
 *  - **Parametrics**: dimensions, posts, style — see `./parametrics.ts`.
 *  - **toolHints**: placement panel hints for the fence-build tool.
 *  - **Renderer + system**: thin placeholder mesh + re-export of the
 *    legacy `FenceSystem`. Same shape as wall milestone B; future Phase 5+
 *    extracts the pure geometry function and migrates to `def.geometry`.
 *
 * Tool field stays absent: fence has 4 separate tools (build, curve,
 * move, move-endpoint) wired through editor state, not the registry
 * tool dispatch. They keep running unchanged until the affordance port.
 *
 * Migration is gated by `feature-flag.ts`
 * (env: `NEXT_PUBLIC_USE_REGISTRY_FOR_FENCE`). See
 * `plans/editor-node-registry.md#phase-5` for the batch order.
 */
export const fenceDefinition: NodeDefinition<typeof FenceNode> = {
  kind: 'fence',
  schemaVersion: 1,
  schema: FenceNode,
  category: 'structure',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    start: [0, 0],
    end: [3, 0],
    height: 1.8,
    thickness: 0.08,
    baseHeight: 0.22,
    postSpacing: 2,
    postSize: 0.1,
    topRailHeight: 0.04,
    groundClearance: 0,
    edgeInset: 0.015,
    baseStyle: 'grounded',
    showInfill: true,
    color: '#ffffff',
    style: 'slat',
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    surfaces: { sides: { faces: 'all' } },
    duplicable: true,
    deletable: true,
  },

  relations: {
    linkedBy: 'endpoint-match',
    cascadeDelete: 'none',
  },

  parametrics: fenceParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    // Same frame priority as the legacy FenceSystem (4 — runs after door/
    // window animations at 2-3, before zone/level systems at 6+).
    priority: 4,
  },

  toolHints: [
    { key: 'Left click', label: 'Set fence start / end' },
    { key: 'Shift', label: 'Allow non-45° angles' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Fence',
    description: 'A straight or curved fence segment with configurable posts and infill.',
    icon: { kind: 'iconify', name: 'lucide:fence' },
    paletteSection: 'structure',
    paletteOrder: 20,
  },

  mcp: {
    description: 'A fence segment defined by start + end points, with optional curve sagitta.',
  },
}
