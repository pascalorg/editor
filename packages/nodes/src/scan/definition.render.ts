import { ScanNode as ScanNodeSchema } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { ScanNode } from './schema'

export const scanRenderDefinition: NodeRenderDefinition<typeof ScanNode> & { kind: 'scan' } = {
  kind: 'scan',
  // Heavy LiDAR asset: stripped from the bake, re-added live from scene_graph
  // in the viewer (see plans → Part D; glb-reference-nodes.tsx).
  bake: 'strip',
  schemaVersion: 4,
  schema: ScanNode,
  category: 'site',
  defaults: () => {
    const stub = ScanNodeSchema.parse({ id: 'scan_default' as never, type: 'scan' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'y', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [Math.PI / 4] },
    scalable: { axes: ['x', 'y', 'z'], min: 0.01, max: 10 },
    duplicable: false,
    deletable: true,
    // Scans carry user-uploaded imagery — cataloging them as
    // reusable presets is out of scope.
    presettable: false,
  },
  rendersChildren: false,
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 1,
  },
  presentation: {
    label: 'Capture',
    description: 'A captured session with optional mesh, motion, media, and sensor data.',
    icon: { kind: 'url', src: '/icons/mesh.webp' },
    paletteSection: 'site',
    paletteOrder: 40,
  },
  mcp: {
    description: 'A captured session reference with an optional renderable mesh.',
  },
}
