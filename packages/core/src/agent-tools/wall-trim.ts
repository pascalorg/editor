import { z } from 'zod'
import { WallTrimProfile } from '../schema/nodes/wall-trim-profile'
import { measurement } from './measurement'
import { NodeId } from './node-id'

const length = (description: string) =>
  measurement('length', 'm', { description, positive: true }).optional()

export const setWallTrimTool = {
  name: 'set_wall_trim',
  title: 'Set wall trim',
  description:
    "Set native skirting, crown moulding or chair rail on walls or room-facing stretches, returning the faces, bounds and sizes written. kind is skirting, crown or chairRail. wallIds and zoneIds (or roomId for one room) form a union: explicit walls cover their selected faces whole; rooms cover only their inward stretches, never the rest of a shared wall. faces selects a, b or both; on rooms it filters inward faces. Existing room stretches are retained. enabled defaults true; false hides the requested trim while keeping its settings. height and depth size the moulding; offsetY is the chair rail's height above the floor and accepts zero. Defaults: skirting height 0.12/depth 0.02 m, crown 0.12/0.055 m, chair rail 0.055/0.026 m at 0.9 m. finish is a library: or scene: ref or #rrggbb, painted as paint paints it; absent keeps the finish. Trims follow their wall and break at openings. Refusals: target_required, target_not_found, no_walls, side_unknown, curtain_wall, railing_wall, curved_wall (bounded room trim), invalid_size, trim_conflict (shared settings or finish would change another stretch).",
  input: {
    kind: z.enum(['skirting', 'crown', 'chairRail']),
    wallIds: z.array(NodeId).optional().describe('Whole walls to trim.'),
    zoneIds: z.array(NodeId).optional().describe('Rooms whose inward stretches to trim.'),
    roomId: NodeId.optional().describe('One room, combined with zoneIds and wallIds.'),
    enabled: z.boolean().optional().describe('False hides trim and preserves its settings.'),
    height: length("The moulding's own height."),
    depth: length('How far the moulding stands proud of the face.'),
    offsetY: measurement('length', 'm', {
      min: 0,
      description: 'Chair rail height above the floor.',
    }).optional(),
    profile: WallTrimProfile.optional(),
    faces: z.enum(['a', 'b', 'both']).optional(),
    finish: z.string().optional().describe('A library: / scene: ref or #rrggbb.'),
  },
} as const
