import {
  type AnyNodeId,
  DownspoutNode as DownspoutNodeSchema,
  type DownspoutNode as DownspoutNodeType,
  type GutterNode,
  type GutterOutlet,
  type HandleDescriptor,
  type NodeDefinition,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { downspoutParametrics } from './parametrics'
import {
  computeDownspoutPath,
  downspoutPipeDims,
  effectiveWallJog,
  resolveDownspoutRouting,
} from './routing'
import { DownspoutNode } from './schema'

// Mirrors the parametric `min`s so handle drags can't shrink the pipe
// past what the inspector would accept.
const MIN_LENGTH = 0.1
// The length cube + dashed leader ride the straight WALL RUN, offset
// outward (+Z, over the eave) past the pipe surface so they float clear
// of the pipe instead of touching it.
const LENGTH_HANDLE_PAD = 0.12
// Lift the length cube a little up the run from the very bottom so it
// reads as a height grip rather than sitting at the pipe's end. Clamped
// to the run top so it never climbs above the straight section.
const CUBE_LIFT = 0.18
// Side-move arrows: how far ±X (along the eave) they sit from the pipe,
// and how far below the gutter floor — near the top so they read as
// "grab and slide along the eave".
const SIDE_MOVE_OFFSET = 0.22
const SIDE_MOVE_Y = -0.12

/**
 * Length tracker — a dashed vertical leader from the outlet (Y = 0,
 * the gutter floor) down to a small cube near the bottom of the
 * straight wall run, `anchor: 'max'` + `axis: 'y'` so dragging the
 * cube down extends the pipe 1:1.
 *
 * Both the cube and the leader sit on the wall-run line but offset
 * outward (away from the pipe) by `radius + LENGTH_HANDLE_PAD`, so the
 * whole dimension floats clear of the pipe — it reads as "change the
 * height" rather than a box jammed onto the kicked-out mouth. The cube
 * rides the run BOTTOM (above the kickout), not the mouth, so the
 * dimension stays on the straight part.
 */
function downspoutLengthHandle(): HandleDescriptor<DownspoutNodeType> {
  return {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'max',
    shape: 'tracker',
    min: MIN_LENGTH,
    currentValue: (n) => n.length,
    apply: (_n, newValue) => ({ length: Math.max(MIN_LENGTH, newValue) }),
    placement: {
      position: (n, scene) => {
        const routing = resolveDownspoutRouting(n, scene)
        const path = computeDownspoutPath(
          n.length,
          effectiveWallJog(n, routing),
          (n.terminal ?? 'splash') !== 'straight',
        )
        const halfZ = downspoutPipeDims(n, routing).halfZ
        const y = Math.min(path.wallRunTopY, path.wallRunBottomY + CUBE_LIFT)
        return [0, y, path.wallRunZ + halfZ + LENGTH_HANDLE_PAD]
      },
    },
    // Leader starts at Y = 0 (outlet / gutter floor) and runs DOWN past
    // the cube — same tracker the wall / chimney height fields use.
    trackerBaseY: () => 0,
  }
}

// Usable half-span — keep the outlet a hair inside each end so the
// collar never lands on a cap (the geometry clamps too; this bounds the
// drag). Reads the host gutter's length.
function moveBound(n: DownspoutNodeType, gutter: GutterNode | undefined): number {
  return Math.max(0.05, Math.max(0.05, gutter?.length ?? 2) / 2 - 0.1)
}

// Effective outlet offset for `currentValue` — reads the gutter's live
// override first (so the dragged value tracks) then the store.
function readOutletOffset(n: DownspoutNodeType): number {
  if (!n.gutterId) return 0
  const id = n.gutterId as AnyNodeId
  const override = useLiveNodeOverrides.getState().get(id) as Partial<GutterNode> | undefined
  const gutter = useScene.getState().nodes[id] as GutterNode | undefined
  const outlets = (override?.outlets as GutterOutlet[] | undefined) ?? gutter?.outlets ?? []
  return outlets.find((o) => o.id === n.outletId)?.offset ?? 0
}

/**
 * Side-move arrow — one of a ±X pair that slides the downspout along the
 * eave. The position lives on the host gutter's outlet
 * (`gutter.outlets[].offset`), not on the downspout, so `overrideTarget`
 * redirects the drag's live override + commit to the gutter and `apply`
 * returns the gutter's patch. The arrows sit near the top of the pipe
 * and ride its group, which moves with the outlet — so they track the
 * cursor 1:1 (`anchor: 'min'` → factor +1).
 */
function downspoutMoveHandle(side: 'left' | 'right'): HandleDescriptor<DownspoutNodeType> {
  const sign = side === 'right' ? 1 : -1
  return {
    kind: 'linear-resize',
    axis: 'x',
    anchor: 'min',
    cursor: 'ew-resize',
    overrideTarget: (n) => (n.gutterId ? (n.gutterId as AnyNodeId) : undefined),
    currentValue: (n) => readOutletOffset(n),
    apply: (n, newOffset, scene) => {
      const gutter = n.gutterId ? scene.get<GutterNode>(n.gutterId as AnyNodeId) : undefined
      if (!gutter) return {}
      const outlets = (gutter.outlets ?? []).map((o) =>
        o.id === n.outletId ? { ...o, offset: newOffset } : o,
      )
      // Patch targets the GUTTER (overrideTarget), not the downspout.
      return { outlets } as unknown as Partial<DownspoutNodeType>
    },
    min: (n, scene) =>
      -moveBound(n, n.gutterId ? scene.get<GutterNode>(n.gutterId as AnyNodeId) : undefined),
    max: (n, scene) =>
      moveBound(n, n.gutterId ? scene.get<GutterNode>(n.gutterId as AnyNodeId) : undefined),
    placement: {
      // Static ±X beside the top of the pipe; the group it rides moves
      // with the outlet, so the arrow stays under the cursor as it slides.
      position: () => [sign * SIDE_MOVE_OFFSET, SIDE_MOVE_Y, 0],
      rotationY: () => (side === 'right' ? 0 : Math.PI),
    },
  }
}

const downspoutHandles: HandleDescriptor<DownspoutNodeType>[] = [
  downspoutLengthHandle(),
  downspoutMoveHandle('left'),
  downspoutMoveHandle('right'),
]

/**
 * Downspout — vertical drop pipe taking water from a gutter outlet to
 * the ground. Scene-graph parent is the same roof-segment the host
 * gutter sits on (so it renders under `roof-elements` like every
 * other accessory); the logical link to the gutter is via the
 * `gutterId` field, which the renderer uses to look up the outlet
 * position.
 *
 * No `handles` yet — the downspout's geometry is anchored to the
 * gutter's outlet. Length (tracker cube at the routed mouth) and
 * diameter (chevron on the wall run) are draggable arrows; the wall
 * standoff lives in the inspector.
 */
export const downspoutDefinition: NodeDefinition<typeof DownspoutNode> = {
  kind: 'downspout',
  schemaVersion: 1,
  schema: DownspoutNode,
  category: 'structure',
  surfaceRole: 'roof',

  defaults: () => {
    const stub = DownspoutNodeSchema.parse({
      id: 'downspout_default' as never,
      type: 'downspout',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    // Logically a roof accessory — registers under the segment, has
    // no buildCut, just the standard dirty cascade.
    roofAccessory: {},
  },

  parametrics: downspoutParametrics,
  handles: downspoutHandles,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },

  preview: () => import('./preview'),
  tool: () => import('./tool'),
  toolHints: [
    { key: 'Hover gutter', label: 'Highlight outlet' },
    { key: 'Left click', label: 'Drop downspout from outlet' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Downspout',
    description: 'Vertical drop pipe from a gutter outlet to the ground.',
    icon: { kind: 'url', src: '/icons/roof.webp' },
    paletteSection: 'structure',
    paletteOrder: 123,
  },

  mcp: {
    description:
      'A downspout — drop pipe from a gutter outlet that elbows back to the wall, runs down the wall face, and kicks out at the bottom. length / diameter / standoff parametric.',
  },
}
