import {
  CupolaNode as CupolaNodeSchema,
  type CupolaNode as CupolaNodeType,
  type HandleDescriptor,
  type NodeDefinition,
} from '@pascal-app/core'
import { surfacePaintCapability } from '../shared/surface-paint'
import { buildCupolaFloorplan } from './floorplan'
import { cupolaParametrics } from './parametrics'
import { CupolaNode } from './schema'

const SIDE_HANDLE_OFFSET = 0.3
const HEIGHT_HANDLE_OFFSET = 0.25
// Snug to the cupola corner so the rotate icon stays close to the item.
const ROTATE_CORNER_OFFSET = 0.12
const MIN_DIM = 0.3
const MIN_HEIGHT = 0.4

function getBodyMidY(n: CupolaNodeType): number {
  return Math.max(0.001, n.height) / 2
}

// Width / depth grow symmetrically from the centre (cupolas are placed by
// their centre on the ridge), so a single centred chevron per axis.
function cupolaWidthHandle(): HandleDescriptor<CupolaNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: 'center',
    min: MIN_DIM,
    currentValue: (n) => n.width,
    apply: (_n, newValue) => ({ width: Math.max(MIN_DIM, newValue) }),
    placement: {
      position: (n) => [n.width / 2 + SIDE_HANDLE_OFFSET, getBodyMidY(n), 0],
    },
  }
}

function cupolaDepthHandle(): HandleDescriptor<CupolaNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'z',
    anchor: 'center',
    min: MIN_DIM,
    currentValue: (n) => n.depth,
    apply: (_n, newValue) => ({ depth: Math.max(MIN_DIM, newValue) }),
    placement: {
      position: (n) => [0, getBodyMidY(n), n.depth / 2 + SIDE_HANDLE_OFFSET],
    },
  }
}

function cupolaHeightHandle(): HandleDescriptor<CupolaNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_HEIGHT,
    currentValue: (n) => n.height,
    apply: (_n, newValue) => ({ height: Math.max(MIN_HEIGHT, newValue) }),
    placement: {
      position: (n) => [0, Math.max(n.height, MIN_HEIGHT) + HEIGHT_HANDLE_OFFSET, 0],
    },
  }
}

function cupolaRotateHandle(): HandleDescriptor<CupolaNodeType> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    apply: (initial, delta) => ({ rotation: (initial.rotation ?? 0) - delta }),
    placement: {
      position: (n) => [
        n.width / 2 + ROTATE_CORNER_OFFSET,
        getBodyMidY(n),
        n.depth / 2 + ROTATE_CORNER_OFFSET,
      ],
      rotationY: () => -Math.PI / 4,
    },
    // Guide ring centred on the cupola, sized to pass through the corner
    // icon so the icon rides the ring — matches solar-panel / skylight.
    decoration: {
      kind: 'ring',
      radius: (n) =>
        Math.hypot(n.width / 2 + ROTATE_CORNER_OFFSET, n.depth / 2 + ROTATE_CORNER_OFFSET),
      y: (n) => getBodyMidY(n),
    },
  }
}

// `portal: 'grandparent'` on every handle — see box-vent's note. The cupola
// rides the roof→segment→node frame chain, so the handle rig must too, or
// the handles (and rotate arc) render offset from the cupola.
const cupolaHandles: HandleDescriptor<CupolaNodeType>[] = [
  cupolaWidthHandle(),
  cupolaDepthHandle(),
  cupolaHeightHandle(),
  cupolaRotateHandle(),
].map((h): HandleDescriptor<CupolaNodeType> => ({ ...h, portal: 'grandparent' }))

/**
 * Cupola — a louvered roof lantern. Parented to a `roof-segment`; position
 * is segment-local; rotation rotates it around the segment's vertical axis
 * after the slope tilt is applied. Same composition as the box vent (custom
 * renderer, pure geometry builder, no system) — see box-vent's definition
 * for the rationale on why roof accessories need a custom renderer.
 */
export const cupolaDefinition: NodeDefinition<typeof CupolaNode> = {
  kind: 'cupola',
  schemaVersion: 1,
  schema: CupolaNode,
  category: 'structure',
  surfaceRole: 'roof',

  defaults: () => {
    const stub = CupolaNodeSchema.parse({ id: 'cupola_default' as never, type: 'cupola' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Single painted surface — registry-driven paint dispatch (see chimney).
    paint: surfacePaintCapability,
    // Mounts on a roof segment via `roofSegmentId`. Sits ON TOP of the
    // slope — no `buildCut`, just the dirty cascade so the parent roof's
    // merged shell rebuilds when the cupola moves / resizes.
    roofAccessory: {},
  },

  parametrics: cupolaParametrics,
  handles: cupolaHandles,
  floorplan: buildCupolaFloorplan,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  preview: () => import('./preview'),
  tool: () => import('./tool'),
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  toolHints: [
    { key: 'Left click', label: 'Place cupola on roof' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Cupola',
    description: 'Louvered roof lantern with a dome or pyramid cap and optional finial.',
    icon: { kind: 'url', src: '/icons/roof.webp' },
    paletteSection: 'structure',
    paletteOrder: 122,
  },

  mcp: {
    description:
      'A louvered cupola (roof lantern) on a roof segment. Roof style: dome / pyramid, optional finial. Parametric width/depth/height.',
  },
}
