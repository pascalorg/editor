import { z } from 'zod'
import { ROOF_ELEMENT_KINDS } from '../schema/nodes/roof-element-kinds'
import { NodeId } from './node-id'

export const addRoofElementTool = {
  name: 'add_roof_element',
  title: 'Add roof element',
  description:
    "Place one native roof accessory and return its host and achieved position. Supports chimney, skylight, solar-panel, cupola, box-vent, ridge-vent, turbine-vent and eyebrow-vent with the editor's defaults and orientation. point is [x, z] in metres in the roof level's building-local plan axes. A roof id selects the highest physical covering; a roof-segment id queries only that segment, without bypassing cuts or higher covering. Missing covering refuses roof_point_outside_segment; unresolved cuts or covering intersections refuse roof_surface_unmeasured with the cause and node ids, without guessing another seat. Ridge vents snap to a native ridge/break line (a shed's high eave), refuse roof_no_ridge_line where none exists, and recheck the achieved point. They store a zero height offset; their renderer derives the seat. The returned planPoint is the achieved snapped point, not necessarily the requested point. Invalid options or ownership refuse before any mutation.",
  input: {
    kind: z.enum(ROOF_ELEMENT_KINDS),
    id: NodeId.describe('Roof or roof-segment id.'),
    point: z.array(z.number().finite()).length(2).describe('Level-plan [x, z] in metres.'),
    rows: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Solar rows; default 2. Ignored by other kinds.'),
    columns: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Solar columns; default 3. Ignored by other kinds.'),
    name: z.string().min(1).optional().describe('Name; defaults to the native name for this kind.'),
  },
}

export const addRoofElementOutput = {
  ok: z.literal(true),
  id: z.string(),
  kind: z.enum(ROOF_ELEMENT_KINDS),
  roofId: z.string(),
  segmentId: z.string(),
  localPosition: z.array(z.number()).length(3),
  rotation: z.number(),
  planPoint: z.array(z.number()).length(2),
  message: z.string(),
}
