import { z } from 'zod'
import { NodeId } from './node-id'

// Room transforms and floor construction, as the editor's room and floor commands do them. Points
// are arrays of two, not tuples: a tuple's list-form schema is refused by some clients. The patches
// are what agents may send; the commands validate them again with the node schemas.

const point = z.array(z.number().finite()).length(2)
const finish = z.union([z.string(), z.record(z.string(), z.unknown())])
const paintRegions = z.array(z.object({ id: z.string(), polygon: z.array(point), finish }))

const zoneIntentPatch = z.strictObject({
  name: z.string().nullable().optional(),
  floor: z
    .strictObject({
      footprint: z.string().min(1).nullable().optional(),
      thickness: z.number().min(0.02).nullable().optional(),
      elevation: z.number().nullable().optional(),
      finish: finish.nullable().optional(),
      regions: paintRegions.nullable().optional(),
    })
    .nullable()
    .optional(),
  ceiling: z.strictObject({ regions: paintRegions.nullable().optional() }).nullable().optional(),
  floorStepFinish: z.string().nullable().optional(),
  floorStepOverrides: z
    .array(
      z.object({ key: z.string(), step: z.number().int().min(0).optional(), finish: z.string() }),
    )
    .nullable()
    .optional(),
  floorEdgeFinish: z.string().nullable().optional(),
  wallMaterial: z.string().nullable().optional(),
  hasFloor: z.boolean().nullable().optional(),
  hasCeiling: z.boolean().nullable().optional(),
})

const floorFoundationPatch = z.strictObject({
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
  foundation: z.object({ type: z.enum(['solid', 'none']), material: finish.optional() }).optional(),
  slots: z
    .strictObject({
      edge: z.string().optional(),
      riser: z.string().optional(),
      underside: z.string().optional(),
    })
    .optional(),
})

const roomTransform = {
  zoneId: NodeId,
  translate: point.optional(),
  rotate: z.object({ angle: z.number().finite(), pivot: point.optional() }).optional(),
  force: z.boolean().optional(),
}

export const cutFloorOpeningTool = {
  name: 'cut_floor_opening',
  title: 'Cut floor or ceiling opening',
  description:
    'Create a persistent opening on a room or level from a polygon or rectangle. A floor cut also opens the automatic ceiling directly below; a ceiling cut can also open the floor above. Use cutsAdjacent:false for a one-surface cut. A mezzanine room cuts only its own plate. levelIds repeats the opening as a shaft on several levels.',
  input: {
    levelId: NodeId.optional(),
    zoneId: NodeId.optional(),
    levelIds: z.array(NodeId).min(1).optional(),
    polygon: z.array(point).min(3).optional(),
    rect: z
      .object({
        x: z.number().finite(),
        z: z.number().finite(),
        width: z.number().finite().positive(),
        depth: z.number().finite().positive(),
      })
      .optional(),
    drawnOn: z.enum(['floor', 'ceiling']).optional(),
    cutsPrimary: z.boolean().optional(),
    cutsAdjacent: z.boolean().optional(),
  },
}

export const removeFloorOpeningTool = {
  name: 'remove_floor_opening',
  title: 'Remove floor opening',
  description:
    'Remove an authored floor or ceiling opening and restore the derived surfaces it cut.',
  input: { id: NodeId },
}

export const setFloorFoundationTool = {
  name: 'set_floor_foundation',
  title: 'Set floor and foundation',
  description:
    'Supply slabId or slabIds; grouped plates receive the same floor-top displacement, while edge slots apply only to the first plate. A ground-contact floor has two inputs: thickness (slab, min 0.01 m, grows upward from the foundation) and foundationHeight (0 = on the ground, no foundation; > 0 = raised on a solid foundation; foundation.type "solid" alone raises it 0.3 m, "none" puts it on the ground). The floor top is derived and never floats: grade + foundationHeight + thickness; everything the floor carries (walls, openings, items, rooms, storeys above) moves with the top. Legacy floorHeight (a target top) maps to foundationHeight = top - grade - thickness, never below 0; null = on the ground. On upper plates the underside stays on the walls below: thickness (or floorHeight as a target top) changes the top; only ground-contact plates accept a foundation. Explicit room floors translate with the floor to preserve steps.',
  input: {
    slabId: NodeId.optional(),
    slabIds: z.array(NodeId).min(1).optional(),
    patch: floorFoundationPatch,
  },
}

export const setRoomFloorConstructionTool = {
  name: 'set_room_floor_construction',
  title: 'Set room floor construction',
  description:
    'Edit the single floor volume associated with a room, with the same patch as set_floor_foundation. On a ground-contact floor: thickness (slab on the foundation, grows upward, min 0.01 m) and foundationHeight (0 = on the ground; > 0 = raised on a solid foundation); the top is derived as grade + foundationHeight + thickness and carries everything on the floor. A drawn slab takes thickness, finishes and a numeric floorHeight (its top) only. Supply slabId when the room spans multiple construction domains; an absorbed legacy slab is edited through its derived base plate.',
  input: { zoneId: NodeId, slabId: NodeId.optional(), patch: floorFoundationPatch },
}

export const rebaseFloorReferenceTool = {
  name: 'rebase_floor_reference',
  title: 'Rebase floor reference',
  description:
    'Change or clear one or more footprint reference datums in one atomic edit, compensating supported storey offsets so existing world geometry stays in place. Supply slabIds together for a shared storey.',
  input: {
    slabId: NodeId.optional(),
    slabIds: z.array(NodeId).min(1).optional(),
    referenceFloorElevation: z.number().finite().nullable(),
  },
}

export const createMezzanineTool = {
  name: 'create_mezzanine',
  title: 'Create mezzanine',
  description:
    'Add an open-below room inside a host reference polygon, with a separate thin plate and railings on open edges. Minimum area 1 m²; elevation defaults to half the storey snapped to 0.05 m, thickness to 0.2 m. Elevation must exceed thickness and stay at least 0.3 m below the resolved footprint plane; overlapping mezzanines are refused. The host floor and walls stay intact.',
  input: {
    hostZoneId: NodeId,
    polygon: z.array(point).min(3),
    elevation: z.number().finite().optional(),
    thickness: z.number().finite().min(0.02).optional(),
  },
}

export const moveZoneTool = {
  name: 'move_zone',
  title: 'Move or rotate room',
  description:
    'Move room intent and contents. Shared walls and openings stay with neighbours; the room takes plain copies. Rotation is radians about Y, before translation, about the room centroid unless a pivot is supplied. Crossings split walls and overlaps re-derive rooms. Force can reposition obstructing openings when they fit; otherwise the edit is refused.',
  input: roomTransform,
}

export const duplicateZoneTool = {
  name: 'duplicate_zone',
  title: 'Duplicate room',
  description:
    'Copy room intent and contents with fresh IDs; shared walls are copied without openings. Rotation is radians about Y before translation. Collinear destination walls are merged, preserving their IDs and hosted children. Crossings split walls and rooms re-derive; overlap is allowed. Force can reposition obstructing openings only when they fit.',
  input: { ...roomTransform, translate: point },
}

export const rotateZoneTool = {
  name: 'rotate_zone',
  title: 'Rotate room a quarter turn',
  description:
    'Rotate a room by quarterTurns 1 or -1 about its centroid, then align its first reference vertex to gridStep (default 0.5 m). Crossings split walls and collinear overlaps merge. Force can reposition obstructing openings only when they fit.',
  input: {
    zoneId: NodeId,
    quarterTurns: z.number().int().min(-1).max(1).describe('1 or -1.'),
    gridStep: z.number().finite().positive().optional(),
    force: z.boolean().optional(),
  },
}

export const lockOutsideFacesTool = {
  name: 'lock_outside_faces',
  title: 'Keep outside dimensions',
  description:
    "Keep the building's outer size: put exterior wall faces on their fixed reference lines, moving wall bodies inward so walls thicken inward and later thickness edits preserve outer dimensions. Supply either levelId or zoneIds.",
  input: { levelId: NodeId.optional(), zoneIds: z.array(NodeId).min(1).optional() },
}

export const setZoneIntentTool = {
  name: 'set_zone_intent',
  title: 'Set room intent',
  description:
    'Update room name, floor finish/elevation/regions, floor.footprint ("new" mints a unique floor key tied to this creator room, an existing key joins that floor on this level, null returns to the shared floor). Touching rooms with the same key share a base plate; disconnected pieces share construction settings. Conversion preserves world geometry in one edit and refuses when infeasible. get_zones exposes floor_choices. A keyed floor uses "<creator room name> floor" while the creator remains on that key; otherwise it uses the largest named room. Existing keys such as "own" without a creator use that fallback. A user-given plate name wins; the shared floor stays "Shared floor". Keyed rooms can have raised or sunken floor.elevation, stored as a level-local walking top. Slab thickness, foundation height and edge finish use set_room_floor_construction, updating every piece of the key. Update ceiling paint regions (ceiling.regions: [x, z] polygons with a finish, later wins), step finishes (floorStepFinish for every step of the room; floorStepOverrides: [{ key, step?, finish }] per doorway, key = the door id the step sits under or the lower room id), wall material and construction opt-outs. Absent fields are unchanged; null clears.',
  input: { zoneId: NodeId, patch: zoneIntentPatch },
}

export const divideZoneTool = {
  name: 'divide_zone',
  title: 'Divide room',
  description:
    "Divide a room with an open path (endpoints snap to its boundary; the seed side keeps its id) or a closed island (outer room keeps its id). The two rooms are parted by a separator (the editor's Separator: a room boundary with no wall), not a wall. Supply path or the legacy two-point cut. Islands need 0.25 m² and 5 cm wall clearance.",
  input: {
    zoneId: NodeId,
    cut: z.array(point).length(2).optional(),
    path: z.array(point).min(2).optional(),
    closed: z.boolean().optional(),
    startBoundaryId: NodeId.optional(),
    endBoundaryId: NodeId.optional(),
  },
}

export const mergeZonesTool = {
  name: 'merge_zones',
  title: 'Merge rooms',
  description:
    "Merge two rooms by removing the separators they share (the editor's Separator: a room boundary with no wall). Walls are preserved; wall-only boundaries return a conflict.",
  input: { zoneIds: z.array(NodeId).length(2) },
}

export const deleteZoneTool = {
  name: 'delete_zone',
  title: 'Delete room',
  description:
    'Delete a room. A room Divide made, which shares a separator (the editor\'s Separator: a room boundary with no wall) with a room on its outline, merges back into that room: the separators go, walls and items stay (mode "merge"). A room whose every boundary is a wall shared with other rooms is refused with a "shared-walls" conflict and nothing changes (mode "blocked"); delete one of its walls instead. Otherwise the room goes with its unshared walls, separators and their openings (mode "delete"), and contents chooses whether its items are kept or deleted. Returns the disposition payload.',
  input: { zoneId: NodeId, contents: z.enum(['delete', 'keep']) },
}

/** Every room and floor-construction tool, in the order the surfaces list them. */
export const ROOM_TOOL_CONTRACTS = [
  cutFloorOpeningTool,
  removeFloorOpeningTool,
  setFloorFoundationTool,
  setRoomFloorConstructionTool,
  rebaseFloorReferenceTool,
  createMezzanineTool,
  moveZoneTool,
  duplicateZoneTool,
  rotateZoneTool,
  lockOutsideFacesTool,
  setZoneIntentTool,
  divideZoneTool,
  mergeZonesTool,
  deleteZoneTool,
] as const
