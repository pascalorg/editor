import type { EyebrowVentNode as EyebrowVentNodeType, HandleDescriptor } from '@pascal-app/core'
import type { NodeEditContribution } from '../definition-contributions'
import { buildEyebrowVentFloorplan } from './floorplan'
import { eyebrowVentPaint } from './paint'
import { eyebrowVentParametrics } from './parametrics'
import type { EyebrowVentNode } from './schema'

const SIDE_HANDLE_OFFSET = 0.3

const HEIGHT_HANDLE_OFFSET = 0.2

// Snug to the vent corner so the rotate icon stays close to the item.
const ROTATE_CORNER_OFFSET = 0.12

const MIN_WIDTH = 0.4

const MIN_DEPTH = 0.2

const MIN_HEIGHT = 0.08

// Mid-Y of the arch (its tallest point is `height`), used to seat the side /
// rotate chevrons against the body and centre the rotate ring.
function getBodyMidY(n: EyebrowVentNodeType): number {
  return Math.max(0.001, n.height) / 2
}

// Width (span) and depth grow symmetrically from the centre — eyebrow vents
// are placed by their centre — so a single centred chevron per axis.
function eyebrowWidthHandle(): HandleDescriptor<EyebrowVentNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: 'center',
    min: MIN_WIDTH,
    currentValue: (n) => n.width,
    apply: (_n, newValue) => ({ width: Math.max(MIN_WIDTH, newValue) }),
    placement: {
      position: (n) => [n.width / 2 + SIDE_HANDLE_OFFSET, getBodyMidY(n), 0],
    },
  }
}

function eyebrowDepthHandle(): HandleDescriptor<EyebrowVentNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'z',
    anchor: 'center',
    min: MIN_DEPTH,
    currentValue: (n) => n.depth,
    apply: (_n, newValue) => ({ depth: Math.max(MIN_DEPTH, newValue) }),
    placement: {
      position: (n) => [0, getBodyMidY(n), n.depth / 2 + SIDE_HANDLE_OFFSET],
    },
  }
}

function eyebrowHeightHandle(): HandleDescriptor<EyebrowVentNodeType> {
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

function eyebrowRotateHandle(): HandleDescriptor<EyebrowVentNodeType> {
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
    // Guide ring centred on the vent, sized to pass through the corner icon so
    // the icon rides the ring — matches cupola / solar-panel.
    decoration: {
      kind: 'ring',
      radius: (n) =>
        Math.hypot(n.width / 2 + ROTATE_CORNER_OFFSET, n.depth / 2 + ROTATE_CORNER_OFFSET),
      y: (n) => getBodyMidY(n),
    },
  }
}

// `portal: 'grandparent'` on every handle — see box-vent's note. The vent
// rides the roof→segment→node frame chain, so the handle rig must too, or the
// handles (and rotate arc) render offset from the vent.
const eyebrowVentHandles: HandleDescriptor<EyebrowVentNodeType>[] = [
  eyebrowWidthHandle(),
  eyebrowDepthHandle(),
  eyebrowHeightHandle(),
  eyebrowRotateHandle(),
].map((h): HandleDescriptor<EyebrowVentNodeType> => ({ ...h, portal: 'grandparent' }))

export const eyebrowVentEditContribution: NodeEditContribution<typeof EyebrowVentNode> = {
  snapProfile: 'item',
  capabilities: {
    paint: eyebrowVentPaint,
  },
  parametrics: eyebrowVentParametrics,
  handles: eyebrowVentHandles,
  floorplan: buildEyebrowVentFloorplan,
  preview: () => import('./preview'),
  tool: () => import('./tool'),
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  toolHints: [
    { key: 'Left click', label: 'Place eyebrow vent on roof' },
    { key: 'Esc', label: 'Cancel' },
  ],
}
