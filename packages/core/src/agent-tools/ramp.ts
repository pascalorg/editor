import { z } from 'zod'
import { measurement } from './measurement'
import { NodeId } from './node-id'

const point = z.array(measurement('length', 'm')).length(2)

export const addRampTool = {
  name: 'add_ramp',
  title: 'Add ramp',
  description:
    'Add a Site-owned vehicle or pedestrian ramp with a continuous centreline of lines and signed circular arcs, absolute Site-local endpoint heights and softer entry/exit grade transitions. Width follows the centreline; thickness extends downward. French residential vehicle ramps commonly use 15–18% maximum grades with softer transitions to avoid grounding vehicles; this is design context, not accessibility or code certification. Returns measured length, rise, maximum grade, transitions, target matches and warnings. A declared door or level target is only reached when its modeled position, footprint and height match the endpoint; naming a target does not create a connection. cut-fill (default) reshapes persisted terrain beneath the corridor; none leaves it unchanged. Refuses invalid/degenerate centreline geometry, arcs whose inner radius does not exceed half the width, and intersecting or stacked corridors rather than overwriting them.',
  input: {
    siteId: NodeId.optional().describe('Owning Site id; omit when the scene has one Site.'),
    name: z.string().min(1).max(120).optional(),
    start: point.describe('Centreline start [x, z] in Site-local metres.'),
    segments: z
      .array(
        z.discriminatedUnion('type', [
          z.object({
            type: z.literal('line'),
            end: point.describe('Line endpoint [x, z] in Site-local metres.'),
          }),
          z.object({
            type: z.literal('arc'),
            center: point.describe('Circle centre [x, z] in Site-local metres.'),
            sweep: measurement('angle', 'rad', {
              description: 'Signed arc sweep in radians, from the preceding endpoint.',
            }),
          }),
        ]),
      )
      .min(1)
      .max(128),
    width: measurement('length', 'm', { positive: true }).optional(),
    startHeight: measurement('length', 'm', {
      description: 'Absolute Site-local Y at the centreline start, default 0 m.',
    }).optional(),
    endHeight: measurement('length', 'm', {
      description:
        'Absolute Site-local Y at the final endpoint; omit to resolve endTargetId from its modeled door or level height. With neither height nor target, refuses ramp_end_required.',
    }).optional(),
    thickness: measurement('length', 'm', { positive: true }).optional(),
    startTransition: measurement('length', 'm', {
      min: 0,
      description:
        'Entry transition length: grade increases linearly from zero. Default is the smaller of 1.5 m and one quarter of the centreline length; explicit zero removes the transition.',
    }).optional(),
    endTransition: measurement('length', 'm', {
      min: 0,
      description:
        'Exit transition length: grade decreases linearly to zero. Default is the smaller of 1.5 m and one quarter of the centreline length; explicit zero removes the transition.',
    }).optional(),
    maxSlopePercent: z
      .number()
      .positive()
      .optional()
      .describe('Stated maximum grade, default 18%.'),
    use: z.enum(['vehicle', 'pedestrian']).optional(),
    startTargetId: NodeId.optional().describe('Optional modeled door or level at the start.'),
    endTargetId: NodeId.optional().describe('Optional modeled door or level at the end.'),
    terrainMode: z.enum(['cut-fill', 'none']).optional(),
    retainingHeight: measurement('length', 'm', {
      min: 0,
      description: 'Retaining side height; zero means no retaining walls.',
    }).optional(),
  },
}
