import { z } from 'zod'
import { measurement } from './measurement'
import { NodeId } from './node-id'

const DORMER_ROOF_TYPES = [
  'hip',
  'gable',
  'shed',
  'gambrel',
  'dutch',
  'mansard',
  'flat',
  'conical',
] as const

const length = (description: string, nonnegative = false) =>
  measurement('length', 'm', {
    description,
    ...(nonnegative ? { min: 0 } : { positive: true }),
  }).optional()

export const addDormerTool = {
  name: 'add_dormer',
  title: 'Add dormer',
  description:
    "Create a native dormer and its hosted window together on one architectural roof slope. Name segmentId, or roofId with at: a finite [x, z] in metres in the roof level's building-local plan axes, not world or segment-local coordinates. A roof picks the highest physical covering; segmentId without at defaults to segment-local [0, segment.depth / 4]. Both ids must name the same reciprocal host. The shared editor planner seats on the bare structural shell, faces downhill, requires complete footprint support without crossing a ridge, hip or profile break, and refuses overlapping dormers or a default window that cannot fit or clear finished covering. Continuous native curved slopes are not rejected merely for tessellation. Returns the paired ids, host ids and level-plan footprint. On a level marked as an attic, atticRoomId and windowSillAboveAtticFloorM are independent nullable facts at the actual child's position; no floor is invented when none is measured. Own conical preserves the existing circular, depth-driven body, rectangular window frames and legacy cutter; it does not promise independently effective conical width/depth or redesigned curved-wall windows. Refusals include roof_host_required, position_required, invalid_roof_host, dormer_geometry_unmeasured (with reason/nodeIds), not_on_slope, too_wide, overlaps_dormer, window_too_wide and window_not_exposed. No partial pair is created on refusal.",
  input: {
    segmentId: NodeId.optional().describe('The roof segment to sit on.'),
    roofId: NodeId.optional().describe('Owning roof; without segmentId, at selects its segment.'),
    at: z
      .array(z.number().finite())
      .length(2)
      .optional()
      .describe("Centre [x, z] in metres in the roof level's building-local plan axes."),
    width: length('Dormer width along the eave (default 1.21 m).'),
    depth: length('Dormer depth up the slope (default 1.55 m).'),
    roofType: z.enum(DORMER_ROOF_TYPES).optional().describe('Own roof profile; default gable.'),
    roofHeight: length('Own roof height above the wall (default 0.49 m).', true),
    shedHighSide: z.enum(['back', 'front']).optional().describe('Shed high side; default back.'),
    wallHeight: length('Wall height above the native shell seat (default 0 m).', true),
    windowWidth: length('Default hosted window width (default 0.76 m).'),
    windowHeight: length('Default hosted window height (default 0.68 m).'),
    name: z.string().max(120).optional().describe('Dormer name; otherwise the next Dormer N.'),
    materialPreset: z
      .string()
      .optional()
      .describe('Overall finish: library: or scene: material ref.'),
    topMaterialPreset: z
      .string()
      .optional()
      .describe('Roof finish: library: or scene: material ref.'),
    sideMaterialPreset: z
      .string()
      .optional()
      .describe('Cheek finish: library: or scene: material ref.'),
    wallMaterialPreset: z
      .string()
      .optional()
      .describe('Wall finish: library: or scene: material ref.'),
  },
}

export const addDormerOutput = {
  dormerId: z.string(),
  windowId: z.string(),
  roofId: z.string(),
  segmentId: z.string(),
  footprint: z.array(z.array(z.number()).length(2)),
  atticRoomId: z.string().nullable(),
  windowSillAboveAtticFloorM: z.number().nullable(),
  message: z.string(),
}
