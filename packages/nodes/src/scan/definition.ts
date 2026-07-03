import { type NodeDefinition, ScanNode as ScanNodeSchema } from '@pascal-app/core'
import { scanParametrics } from './parametrics'
import { ScanNode } from './schema'

/**
 * Scan — Stage A. Mesh imported from the capture pipeline (LiDAR /
 * photogrammetry). `ScanSystem` handles mesh loading + per-frame
 * positioning; renderer mounts the imported geometry.
 */
export const scanDefinition: NodeDefinition<typeof ScanNode> = {
  kind: 'scan',
  // Heavy LiDAR asset: stripped from the bake, re-added live from scene_graph
  // in the viewer (see plans → Part D; glb-reference-nodes.tsx).
  bake: 'strip',
  schemaVersion: 1,
  schema: ScanNode,
  category: 'site',

  defaults: () => {
    const stub = ScanNodeSchema.parse({ id: 'scan_default' as never, type: 'scan' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: false,
    deletable: true,
    // Scans carry user-uploaded imagery — cataloging them as
    // reusable presets is out of scope.
    presettable: false,
  },

  parametrics: scanParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 1,
  },

  presentation: {
    label: 'Scan',
    description: 'A captured mesh (LiDAR / photogrammetry) imported as a scene reference.',
    icon: { kind: 'url', src: '/icons/mesh.webp' },
    paletteSection: 'site',
    paletteOrder: 40,
  },

  mcp: {
    description: 'A captured mesh import.',
  },
}
