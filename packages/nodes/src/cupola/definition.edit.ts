import type { CupolaNode as CupolaNodeType, HandleDescriptor } from '@pascal-app/core'
import type { NodeEditContribution } from '../definition-contributions'
import { cupolaPaint } from './paint'
import { cupolaParametrics } from './parametrics'
import type { CupolaNode } from './schema'

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

export const cupolaEditContribution: NodeEditContribution<typeof CupolaNode> = {
  snapProfile: 'item',
  capabilities: {
    paint: cupolaPaint,
  },
  parametrics: cupolaParametrics,
  handles: cupolaHandles,
  preview: () => import('./preview'),
  tool: () => import('./tool'),
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  toolHints: [
    { key: 'Left click', label: 'Place cupola on roof' },
    { key: 'Esc', label: 'Cancel' },
  ],
}
