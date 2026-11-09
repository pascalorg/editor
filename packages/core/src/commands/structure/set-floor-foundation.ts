import { z } from 'zod'
import {
  floorPlateHoldsUnderside,
  groundFloorConstruction,
  supportDerivedFloorHeight,
  upperFloorHeightControl,
} from '../../lib/floor-foundation-datum'
import { expandFloorIntentChanges, floorIntentConflicts } from '../../lib/floor-intent-changes'
import { roundFloorElevation } from '../../lib/room-floor-feasibility'
import { SlabNode } from '../../schema'
import { MIN_GROUND_FLOOR_THICKNESS, MIN_SLAB_THICKNESS } from '../../schema/nodes/slab'
import type { StructureNodes, StructurePlan } from './shared'

export const FloorFoundationPatch = z.strictObject({
  thickness: z
    .number()
    .finite()
    .min(0)
    .optional()
    .describe(
      'Slab thickness in meters. On the ground it sits on the foundation (or the ground) and grows upward: a thicker slab raises the floor top and everything on it. Never below 0.01 m (smaller values are clamped). Upstairs the underside stays on the walls below.',
    ),
  foundationHeight: z
    .number()
    .finite()
    .min(0)
    .optional()
    .describe(
      'Ground-bearing floors only: height of the foundation under the slab, in meters. 0 = on the ground (no foundation); > 0 = raised on a solid foundation. The floor top is derived: grade + foundationHeight + thickness.',
    ),
  floorHeight: z
    .number()
    .finite()
    .nullable()
    .optional()
    .describe(
      'Legacy: a target floor top in level-local meters. On the ground it is mapped to foundationHeight = top - grade - thickness (never below 0); null = on the ground. Prefer thickness and foundationHeight.',
    ),
  foundation: SlabNode.shape.foundation,
  slots: z
    .strictObject({
      edge: z.string().optional(),
      riser: z.string().optional(),
      underside: z.string().optional(),
    })
    .optional(),
})
export type FloorFoundationPatch = z.infer<typeof FloorFoundationPatch>

/** A new solid foundation's finish: mid grey, apart from the white edge band and the walls. */
export const DEFAULT_FOUNDATION_MATERIAL = 'library:preset-midgrey'

/** A footprint switched to "Raised on a foundation" without a height starts this high. */
export const DEFAULT_FOUNDATION_HEIGHT = 0.3

/** Foundations this low count as on the ground. */
const ON_GROUND = 0.0005

const touchesGroundConstruction = (patch: FloorFoundationPatch) =>
  patch.thickness !== undefined ||
  patch.foundationHeight !== undefined ||
  Object.hasOwn(patch, 'floorHeight') ||
  patch.foundation !== undefined

/**
 * A ground-bearing plate's write, bottom up: the foundation stands on the
 * grade, the slab on the foundation, so the top is always
 * grade + foundationHeight + thickness and nothing floats or sinks. The top is
 * written explicitly, so a plate that followed the automatic top keeps its
 * underside on the foundation when its thickness changes.
 */
function groundPatch(
  nodes: StructureNodes,
  plate: SlabNode,
  patch: FloorFoundationPatch,
): Partial<SlabNode> {
  const { floorHeight, foundationHeight: requestedHeight, ...rest } = patch
  if (!touchesGroundConstruction(patch)) return rest as Partial<SlabNode>
  const current = groundFloorConstruction(nodes, plate)
  const thickness = roundFloorElevation(
    Math.max(MIN_GROUND_FLOOR_THICKNESS, patch.thickness ?? plate.thickness),
  )
  const requested =
    requestedHeight ??
    (Object.hasOwn(patch, 'floorHeight')
      ? floorHeight == null
        ? 0
        : floorHeight - current.grade - thickness
      : patch.foundation?.type === 'none'
        ? 0
        : patch.foundation?.type === 'solid' && current.foundationHeight <= ON_GROUND
          ? DEFAULT_FOUNDATION_HEIGHT
          : current.foundationHeight)
  const foundationHeight = roundFloorElevation(Math.max(0, requested))
  const solid = foundationHeight > ON_GROUND
  const foundation = { ...plate.foundation, ...patch.foundation, type: solid ? 'solid' : 'none' }
  if (solid && !foundation.material) foundation.material = DEFAULT_FOUNDATION_MATERIAL
  return {
    ...rest,
    thickness,
    floorHeight: roundFloorElevation(current.grade + (solid ? foundationHeight : 0) + thickness),
    foundation: foundation as SlabNode['foundation'],
  } as Partial<SlabNode>
}

export function setFloorFoundation(
  nodes: StructureNodes,
  input: {
    slabId?: string
    slabIds?: string[]
    patch: FloorFoundationPatch
    sameConstruction?: boolean
  },
): StructurePlan {
  if (!!input.slabId === !!input.slabIds?.length)
    throw new Error('Supply slabId or a non-empty slabIds array.')
  const plates = [...new Set(input.slabIds ?? [input.slabId!])].map((id) => {
    const plate = nodes[id]
    if (plate?.type !== 'slab' || plate.plateRole !== 'base')
      throw new Error(`Base plate not found: ${id}`)
    return plate
  })
  const requested = FloorFoundationPatch.parse(input.patch)
  const primary = plates[0]!
  const topOf = (plate: SlabNode) => plate.floorHeight ?? plate.elevation
  const primarySupported = floorPlateHoldsUnderside(nodes, primary)
  if (primarySupported && (requested.foundationHeight ?? 0) > ON_GROUND)
    return {
      changes: [],
      conflicts: [
        {
          code: 'floor-foundation-level',
          nodeIds: [primary.id],
          message: 'Only a plate at ground contact can have a solid foundation.',
        },
      ],
    }
  // How far the primary plate's top moves: every other plate of a group moves by as much.
  const delta = primarySupported
    ? Object.hasOwn(requested, 'floorHeight')
      ? (requested.floorHeight ?? supportDerivedFloorHeight(nodes, primary)) - topOf(primary)
      : requested.thickness === undefined
        ? undefined
        : requested.thickness - primary.thickness
    : touchesGroundConstruction(requested)
      ? groundPatch(nodes, primary, requested).floorHeight! - topOf(primary)
      : undefined
  const thin = plates.find(
    (plate) =>
      floorPlateHoldsUnderside(nodes, plate) &&
      delta !== undefined &&
      plate.thickness + delta < MIN_SLAB_THICKNESS - 1e-6,
  )
  if (thin)
    return {
      changes: [],
      conflicts: [
        {
          code: 'floor-plate-thickness',
          nodeIds: [thin.id],
          message: `The floor plate ${thin.id} cannot move that far: its thickness must remain at least ${MIN_SLAB_THICKNESS} m.`,
        },
      ],
    }
  const { floorHeight: _top, foundationHeight: _foundation, ...upperRequested } = requested
  const changes = plates.map((plate, index) => {
    const supported = floorPlateHoldsUnderside(nodes, plate)
    const own = index === 0 || input.sameConstruction
    let data: Partial<SlabNode>
    if (supported) {
      const patch: FloorFoundationPatch = own ? { ...upperRequested } : {}
      if (delta !== undefined)
        patch.thickness = upperFloorHeightControl(
          nodes,
          plate,
          roundFloorElevation(topOf(plate) + delta),
        )!.write.thickness
      data = patch as Partial<SlabNode>
    } else
      data = own
        ? groundPatch(nodes, plate, requested)
        : delta === undefined
          ? {}
          : groundPatch(nodes, plate, {
              foundationHeight: Math.max(
                0,
                groundFloorConstruction(nodes, plate).foundationHeight + delta,
              ),
            })
    return {
      id: plate.id,
      data: {
        ...data,
        ...(data.foundation ? { foundation: { ...plate.foundation, ...data.foundation } } : {}),
        ...(data.slots ? { slots: { ...plate.slots, ...data.slots } } : {}),
      } as Partial<SlabNode>,
    }
  })
  const updates = expandFloorIntentChanges(nodes, changes)
  const conflicts = floorIntentConflicts(nodes, updates)
  return {
    changes: conflicts.length ? [] : updates.map((update) => ({ op: 'update', ...update })),
    conflicts,
  }
}
