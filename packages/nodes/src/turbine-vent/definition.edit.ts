import type { HandleDescriptor, TurbineVentNode as TurbineVentNodeType } from '@pascal-app/core'
import type { NodeEditContribution } from '../definition-contributions'
import { turbineVentPaint } from './paint'
import { turbineVentParametrics } from './parametrics'
import type { TurbineVentNode } from './schema'

const SIDE_HANDLE_OFFSET = 0.25

const HEIGHT_HANDLE_OFFSET = 0.2

const MIN_DIM = 0.12

const MIN_HEIGHT = 0.12

function getBodyMidY(n: TurbineVentNodeType): number {
  return Math.max(0.001, n.height) / 2
}

// Diameter arrow on the +X side. The turbine is radially symmetric, so a
// single symmetric chevron (anchor 'center') grows the whole head from
// the centre — no left/right asymmetry to preserve.
function turbineVentDiameterHandle(): HandleDescriptor<TurbineVentNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: 'center',
    min: MIN_DIM,
    currentValue: (n) => n.diameter,
    apply: (_n, newValue) => ({ diameter: Math.max(MIN_DIM, newValue) }),
    placement: {
      position: (n) => [n.diameter / 2 + SIDE_HANDLE_OFFSET, getBodyMidY(n), 0],
    },
  }
}

// Height arrow above the top. anchor='min' pins the flange base to the
// slope at vent-local y=0 and the top follows the pointer.
function turbineVentHeightHandle(): HandleDescriptor<TurbineVentNodeType> {
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

// `portal: 'grandparent'` on every handle — see box-vent's note. The vent
// rides the roof→segment→node frame chain, so the handle rig must too, or
// the handles render offset from the vent.
const turbineVentHandles: HandleDescriptor<TurbineVentNodeType>[] = [
  turbineVentDiameterHandle(),
  turbineVentHeightHandle(),
].map((h): HandleDescriptor<TurbineVentNodeType> => ({ ...h, portal: 'grandparent' }))

export const turbineVentEditContribution: NodeEditContribution<typeof TurbineVentNode> = {
  snapProfile: 'item',
  capabilities: {
    paint: turbineVentPaint,
  },
  parametrics: turbineVentParametrics,
  handles: turbineVentHandles,
  preview: () => import('./preview'),
  tool: () => import('./tool'),
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  toolHints: [
    { key: 'Left click', label: 'Place turbine vent on roof' },
    { key: 'Esc', label: 'Cancel' },
  ],
}
