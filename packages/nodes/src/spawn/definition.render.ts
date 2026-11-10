import type { NodeRenderDefinition } from '../definition-contributions'
import { SpawnNode } from './schema'

export const spawnRenderDefinition: NodeRenderDefinition<typeof SpawnNode> & { kind: 'spawn' } = {
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
    duplicable: false,
    // singleton per level
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
  rendersChildren: false,
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
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
