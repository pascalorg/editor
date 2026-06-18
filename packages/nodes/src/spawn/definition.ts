import type { NodeDefinition } from '@pascal-app/core'
import { buildSpawnFloorplan } from './floorplan'
import { spawnParametrics } from './parametrics'
import { SpawnNode } from './schema'

export const spawnDefinition: NodeDefinition<typeof SpawnNode> = {
  kind: 'spawn',
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
    // Slab elevation lift via the generic `<FloorElevationSystem>`. The
    // spawn marker is a 1.8m-tall figure with a ~0.6m ring footprint.
    floorPlaced: {
      footprint: () => ({ dimensions: [0.6, 1.8, 0.6], rotation: [0, 0, 0] }),
    },
  },

  parametrics: spawnParametrics,

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
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Left click', label: '放置出生点' },
    { key: 'Esc', label: '取消' },
  ],

  presentation: {
    label: 'Spawn Point',
    description: 'Player or camera origin within a level. One per level.',
    icon: { kind: 'url', src: '/icons/site.webp' },
    paletteSection: 'structure',
    paletteOrder: 90, // bottom of structure list — matches legacy palette order
  },

  mcp: {
    description: 'A singleton spawn point marker placed inside a level.',
  },
}
