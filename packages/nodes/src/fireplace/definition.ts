import type {
  FireplaceNode as FireplaceNodeType,
  HandleDescriptor,
  NodeDefinition,
} from '@pascal-app/core'
import { buildFireplaceGeometry } from './geometry'
import { fireplaceParametrics } from './parametrics'
import { FireplaceNode } from './schema'

const SIDE_HANDLE_OFFSET = 0.18
const HEIGHT_HANDLE_OFFSET = 0.22
const ROTATE_CORNER_OFFSET = 0.32
const ROTATE_RING_OFFSET = 0.04
const MOVE_FRONT_OFFSET = 0.35

const MIN_FP_WIDTH = 0.6
const MIN_FP_DEPTH = 0.3
const MIN_FP_HEIGHT = 0.8

function fireplaceWidthHandle(): HandleDescriptor<FireplaceNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: 'center',
    min: MIN_FP_WIDTH,
    currentValue: (n) => n.width,
    apply: (_n, newValue) => ({ width: newValue }),
    placement: {
      position: (n) => [n.width / 2 + SIDE_HANDLE_OFFSET, n.height / 2, 0],
    },
  }
}

function fireplaceDepthHandle(): HandleDescriptor<FireplaceNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'z',
    anchor: 'center',
    min: MIN_FP_DEPTH,
    currentValue: (n) => n.depth,
    apply: (_n, newValue) => ({ depth: newValue }),
    placement: {
      position: (n) => [0, n.height / 2, n.depth / 2 + SIDE_HANDLE_OFFSET],
    },
  }
}

function fireplaceHeightHandle(): HandleDescriptor<FireplaceNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    min: MIN_FP_HEIGHT,
    currentValue: (n) => n.height,
    apply: (_n, newValue) => ({ height: newValue }),
    placement: {
      position: (n) => [0, n.height + HEIGHT_HANDLE_OFFSET, 0],
    },
  }
}

function fireplaceRotateHandle(): HandleDescriptor<FireplaceNodeType> {
  return {
    kind: 'arc-resize',
    axis: 'angular',
    shape: 'rotate',
    apply: (initial, delta) => ({
      rotation: (initial.rotation ?? 0) - delta,
    }),
    placement: {
      position: (n) => [n.width / 2, n.height / 2, n.depth / 2 + ROTATE_CORNER_OFFSET],
      rotationY: () => -Math.PI / 4,
    },
    decoration: {
      kind: 'ring',
      radius: (n) => Math.hypot(n.width / 2, n.depth / 2) + ROTATE_RING_OFFSET,
      y: (n) => n.height / 2,
    },
  }
}

function fireplaceMoveHandle(): HandleDescriptor<FireplaceNodeType> {
  return {
    kind: 'translate',
    placement: {
      position: (n) => [0, 0.02, n.depth / 2 + MOVE_FRONT_OFFSET],
    },
    apply: (_n, pos) => ({ position: [pos[0], pos[1], pos[2]] }),
    snapExtents: (n) => [n.width, n.depth],
  }
}

function fireplaceHandles(_node: FireplaceNodeType): HandleDescriptor<FireplaceNodeType>[] {
  return [
    fireplaceWidthHandle(),
    fireplaceDepthHandle(),
    fireplaceHeightHandle(),
    fireplaceRotateHandle(),
    fireplaceMoveHandle(),
  ]
}

export const fireplaceDefinition: NodeDefinition<typeof FireplaceNode> = {
  kind: 'fireplace',
  snapProfile: 'item',
  facingIndicator: true,
  schemaVersion: 1,
  schema: FireplaceNode,
  category: 'furnish',
  surfaceRole: 'furnishing',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    style: 'wall',
    width: 1.5,
    height: 2.2,
    depth: 0.6,
    fireboxWidth: 0.9,
    fireboxHeight: 0.7,
    fireboxDepth: 0.4,
    fireboxSillHeight: 0.3,
    mantelHeight: 0.12,
    mantelOverhang: 0.08,
    mantelThickness: 0.06,
    mantelWidth: 0.1,
    hearthDepth: 0.35,
    hearthHeight: 0.05,
    hearthWidth: 0.15,
    surroundWidth: 0.15,
    lintelHeight: 0.12,
    cornerAngle: 45,
    fire: 'medium',
    fireColor: 'orange',
  }),

  capabilities: {
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: {
      axes: ['y'],
      snapAngles: [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI],
    },
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  handles: fireplaceHandles,
  parametrics: fireplaceParametrics,
  geometry: buildFireplaceGeometry,
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  tool: () => import('./tool'),
  presentation: {
    label: 'Fireplace',
    icon: { kind: 'iconify', name: 'lucide:flame' },
    paletteSection: 'furnish',
  },
}
