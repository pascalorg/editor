import type { HandleDescriptor, NodeDefinition, SpawnNode as SpawnNodeType } from '@pascal-app/core'
import { buildSpawnFloorplan } from './floorplan'
import { spawnRotateAffordance } from './floorplan-affordances'
import { spawnFloorplanMoveTarget } from './floorplan-move'
import { spawnParametrics } from './parametrics'
import { SpawnNode } from './schema'

const SPAWN_FOOTPRINT = 0.6
const SPAWN_HANDLE_HEIGHT = 0.46
const MOVE_FRONT_OFFSET = 0.35
const ROTATE_CORNER_OFFSET = 0.32
const ROTATE_RING_OFFSET = 0.04

function spawnRotateHandle(): HandleDescriptor<SpawnNodeType> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    apply: (initial, delta) => ({ rotation: (initial.rotation ?? 0) - delta }),
    placement: {
      position: () => [
        SPAWN_FOOTPRINT / 2,
        SPAWN_HANDLE_HEIGHT,
        SPAWN_FOOTPRINT / 2 + ROTATE_CORNER_OFFSET,
      ],
      rotationY: () => -Math.PI / 4,
    },
    decoration: {
      kind: 'ring',
      radius: () => Math.hypot(SPAWN_FOOTPRINT / 2, SPAWN_FOOTPRINT / 2) + ROTATE_RING_OFFSET,
      y: () => SPAWN_HANDLE_HEIGHT,
    },
  }
}

function spawnMoveHandle(): HandleDescriptor<SpawnNodeType> {
  return {
    kind: 'translate',
    placement: {
      // Low to the floor at the front edge (matches the item move grip).
      position: () => [0, 0.02, SPAWN_FOOTPRINT / 2 + MOVE_FRONT_OFFSET],
    },
    apply: (_n, pos) => ({ position: [pos[0], pos[1], pos[2]] }),
    snapExtents: () => [SPAWN_FOOTPRINT, SPAWN_FOOTPRINT],
  }
}

export const spawnDefinition: NodeDefinition<typeof SpawnNode> = {
  kind: 'spawn',
  snapProfile: 'item',
  schemaVersion: 1,
  schema: SpawnNode,
  category: 'site',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
  }),

  capabilities: {
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: {
      axes: ['y'],
      snapAngles: [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI],
    },
    duplicable: false, // singleton per level
    deletable: true,
    selectable: { hitVolume: 'bbox' },
    // Spawn is a singleton anchor — no meaning as a reusable preset.
    presettable: false,
    // Slab elevation lift via the generic `<FloorElevationSystem>`. The
    // spawn marker is a 1.8m-tall figure with a ~0.6m ring footprint.
    floorPlaced: {
      footprint: () => ({ dimensions: [0.6, 1.8, 0.6], rotation: [0, 0, 0] }),
    },
  },

  parametrics: spawnParametrics,
  handles: [spawnRotateHandle(), spawnMoveHandle()],

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  // Stage C migration: floor-plan rendering via def.floorplan.
  // floorplan-panel.tsx's `floorplanSpawnEntries` short-circuits to []
  // when `nodeRegistry.has('spawn')`, so this builder is the single
  // path. FloorplanRegistryLayer renders + handles click-to-select;
  // FloorplanRegistryActionMenu handles move / duplicate (disabled) /
  // delete. Legacy spawn click handlers in FloorplanNodeLayer become
  // dead code once Phase 6 cleanup removes the [] entries path.
  floorplan: buildSpawnFloorplan,
  floorplanMoveTarget: spawnFloorplanMoveTarget,
  floorplanAffordances: {
    'spawn-rotate': spawnRotateAffordance,
  },
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: 'Place spawn point' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Spawn Point',
    description: 'Player or camera origin within a level. One per level.',
    icon: { kind: 'url', src: '/icons/spawn-point.webp' },
    paletteSection: 'structure',
    paletteOrder: 90, // bottom of structure list — matches legacy palette order
  },

  mcp: {
    description: 'A singleton spawn point marker placed inside a level.',
  },
}
