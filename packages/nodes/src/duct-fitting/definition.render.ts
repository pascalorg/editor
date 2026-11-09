import { ductBodySlots } from '@pascal-app/core'
import type { NodeRenderDefinition } from '../definition-contributions'
import { buildDuctFittingGeometry } from './geometry'
import { getDuctFittingPorts } from './ports'
import { DuctFittingNode } from './schema'

export const ductFittingRenderDefinition: NodeRenderDefinition<typeof DuctFittingNode> & {
  kind: 'duct-fitting'
} = {
  kind: 'duct-fitting',
  schemaVersion: 3,
  schema: DuctFittingNode,
  category: 'utility',
  distributionRole: 'fitting',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    damperAngle: 0,
    panelWidth: 0.25,
    panelHeight: 0.15,
    fittingType: 'elbow',
    shape: 'rect',
    width: 14,
    height: 8,
    shape2: 'rect',
    width2: 14,
    height2: 8,
    angle: 90,
    branchAngle: 90,
    diameter: 12,
    diameter2: 12,
    ductMaterial: 'sheet-metal',
    system: 'supply',
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    // `cursorAttached`: a fitting is a small connector — an offset-
    // preserving drag reads as the mesh trailing the mouse, so pin its
    // origin to the cursor instead.
    movable: { axes: ['x', 'y', 'z'], gridSnap: true, cursorAttached: true },
    duplicable: true,
    deletable: true,
    slots: () => ductBodySlots(),
  },
  geometry: buildDuctFittingGeometry,
  geometryKey: (n) =>
    JSON.stringify([
      n.fittingType,
      n.damperAngle,
      n.panelWidth,
      n.panelHeight,
      // The mitered elbow + flange profiles swap width/height roles based
      // on where world-up sits in the local frame, so orientation is a
      // geometry input.
      n.rotation,
      n.shape,
      n.inletShape,
      n.outletShape,
      n.width,
      n.height,
      n.shape2,
      n.width2,
      n.height2,
      n.angle,
      n.branchAngle,
      n.diameter,
      n.diameter2,
      n.ductMaterial,
      n.system,
      n.slots,
    ]),
  ports: getDuctFittingPorts,
  presentation: {
    label: 'Duct Fitting',
    description: 'Elbow, tee, reducer, or square-to-round transition connecting duct runs.',
    icon: { kind: 'url', src: '/icons/duct-fitting.webp' },
    paletteSection: 'structure',
    paletteOrder: 91,
  },
  mcp: {
    description:
      'A duct fitting (elbow, tee, reducer, or square-to-round transition) with typed connection ports. Position is level-local meters; rotation is an XYZ euler in radians.',
  },
}
