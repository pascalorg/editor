import type { HandleDescriptor, SpawnNode as SpawnNodeType } from '@pascal-app/core'
import type { NodeEditContribution } from '../definition-contributions'
import { buildSpawnFloorplan } from './floorplan'
import { spawnRotateAffordance } from './floorplan-affordances'
import { spawnFloorplanMoveTarget } from './floorplan-move'
import { spawnParametrics } from './parametrics'
import type { SpawnNode } from './schema'

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

export const spawnEditContribution: NodeEditContribution<typeof SpawnNode> = {
  snapProfile: 'item',
  parametrics: spawnParametrics,
  handles: [spawnRotateHandle(), spawnMoveHandle()],
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
    { key: 'R / T', label: 'Rotate spawn point' },
    { key: 'Esc', label: 'Cancel' },
  ],
}
