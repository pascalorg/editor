import {
  type HandleDescriptor,
  type NodeDefinition,
  TurbineVentNode as TurbineVentNodeSchema,
  type TurbineVentNode as TurbineVentNodeType,
} from '@pascal-app/core'
import { surfacePaintCapability } from '../shared/surface-paint'
import { buildTurbineVentFloorplan } from './floorplan'
import { turbineVentParametrics } from './parametrics'
import { TurbineVentNode } from './schema'

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

/**
 * Turbine vent (whirlybird) — a wind-driven spinning exhaust vent that
 * sits on a roof slope. Parented to a `roof-segment`; position is
 * segment-local; rotation rotates the vent around the segment's vertical
 * axis after the slope tilt is applied.
 *
 * Composition (three-checkbox model):
 *  - **`renderer` (custom)** — like the box vent, the turbine needs the
 *    parent segment's transform + slope to position itself, which the
 *    registry-era roof-segment renderer doesn't auto-nest. The custom
 *    renderer reads the segment from `useScene`, applies the transform
 *    stack, and — uniquely among vents — drives the head's idle spin via
 *    `useFrame`. The spin lives in the renderer (not a `def.system`)
 *    because it's purely cosmetic: no cross-node cascade, no shared
 *    animation state, and it must not perturb the handle frame.
 *  - **no `geometry`** — geometry is created inside the renderer via the
 *    shared pure builders in `./geometry` (split base / head so the head
 *    can spin independently), matching box-vent's mount semantics.
 *  - **no `system`** — see above; the spin is renderer-local.
 */
export const turbineVentDefinition: NodeDefinition<typeof TurbineVentNode> = {
  kind: 'turbine-vent',
  schemaVersion: 1,
  schema: TurbineVentNode,
  category: 'structure',
  surfaceRole: 'roof',

  defaults: () => {
    const stub = TurbineVentNodeSchema.parse({ id: 'tvent_default' as never, type: 'turbine-vent' })
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
    // merged shell rebuilds when the vent moves / resizes.
    roofAccessory: {},
  },

  parametrics: turbineVentParametrics,
  handles: turbineVentHandles,
  floorplan: buildTurbineVentFloorplan,

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
    { key: 'Left click', label: 'Place turbine vent on roof' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Turbine Vent',
    description: 'Wind-driven spinning whirlybird exhaust vent for a roof slope.',
    icon: { kind: 'url', src: '/icons/roof.webp' },
    paletteSection: 'structure',
    paletteOrder: 121,
  },

  mcp: {
    description:
      'A spinning turbine (whirlybird) vent on a roof segment. Style: globe / cylinder. Parametric diameter/height/neckHeight/vaneCount and idle spinSpeed.',
  },
}
