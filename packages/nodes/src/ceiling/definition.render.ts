import {
  type CeilingNode as CeilingNodeType,
  ceilingSlots,
  resolveCeilingHeight,
  useScene,
} from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { surfaceBatchable } from '../shared/node-batch/batchable'
import { polygonMeasurementFeatures } from '../shared/polygon-measurement'
import { CeilingNode } from './schema'

export const ceilingRenderDefinition: NodeRenderDefinition<typeof CeilingNode> & {
  kind: 'ceiling'
} = {
  kind: 'ceiling',
  schemaVersion: 1,
  schema: CeilingNode,
  category: 'structure',
  surfaceRole: 'ceiling',
  // Height-less on purpose: a new ceiling follows the level top until the
  // user gives it an explicit custom height.
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    polygon: [],
    holes: [],
    holeMetadata: [],
    autoFromWalls: false,
  }),
  capabilities: {
    reveal: { phase: 'roof', style: 'settle', height: 0.08 },
    revealOnEdit: ['polygon', 'holes', 'height'],
    batchable: surfaceBatchable,
    selectable: { hitVolume: 'bbox' },
    surfaces: {
      hosting: false,
      top: {
        height: (n) => resolveCeilingHeight(n as CeilingNodeType, useScene.getState().nodes),
      },
    },
    duplicable: true,
    deletable: true,
    // Unified slot model: one paintable underside surface with a declared
    // default, painted through the registry `capabilities.paint` dispatch.
    slots: () => ceilingSlots(),
  },
  relations: {
    hosts: ['item', 'procedural-item'],
    cascadeDelete: 'descendants',
  },
  measurement: {
    features: (node) =>
      polygonMeasurementFeatures({
        featurePrefix: 'ceiling',
        height: resolveCeilingHeight(node, useScene.getState().nodes),
        label: 'Ceiling',
        polygon: node.polygon,
      }),
  },
  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 4,
  },
  presentation: {
    label: 'Ceiling',
    description: 'A polygon-bounded ceiling surface that hosts ceiling-mounted items.',
    icon: { kind: 'url', src: '/icons/ceiling.webp' },
    paletteSection: 'structure',
    paletteOrder: 40,
  },
  mcp: {
    description: 'A polygon-bounded ceiling with optional cutout holes.',
  },
}
