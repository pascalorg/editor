import { type NodeDefinition, ScanNode as ScanNodeSchema } from '@pascal-app/core'
import { scanParametrics } from './parametrics'
import { ScanNode } from './schema'

/**
 * Scan — Stage A. Capture-session reference with an optional renderable
 * mesh. Raw sensor streams stay in the external session manifest.
 */
export const scanDefinition: NodeDefinition<typeof ScanNode> = {
  kind: 'scan',
  // Heavy LiDAR asset: stripped from the bake, re-added live from scene_graph
  // in the viewer (see plans → Part D; glb-reference-nodes.tsx).
  bake: 'strip',
  schemaVersion: 3,
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
    description: 'A captured session with optional mesh, motion, media, and sensor data.',
    icon: { kind: 'url', src: '/icons/mesh.webp' },
    paletteSection: 'site',
    paletteOrder: 40,
  },

  mcp: {
    description: 'A captured session reference with an optional renderable mesh.',
  },
}
