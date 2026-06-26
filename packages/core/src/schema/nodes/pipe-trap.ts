import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * DWV trap — the P-trap between a fixture and the waste system. Holds a
 * water seal that blocks sewer gas; every drained fixture has exactly
 * one. Modeled as an explicit fitting (not folded into the fixture) so
 * the trap-arm rule (IPC 909.1 max developed length to the vent) has a
 * node to attach to and the inspector can edit size + arm length.
 *
 * Local-frame convention (before `rotation`): inlet faces +Y (up, to
 * the fixture tailpiece), outlet faces +X (the horizontal trap arm
 * toward the vented waste line).
 */
export const PipeTrapNode = BaseNode.extend({
  id: objectId('pipe-trap'),
  type: nodeType('pipe-trap'),
  // Level-local meters.
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Yaw in radians (the arm direction in plan).
  rotation: z.number().default(0),
  // Trap size in inches — matches the fixture drain it serves.
  diameter: z.number().min(1.25).max(4).default(2),
  pipeMaterial: z.enum(['pvc', 'abs', 'cast-iron']).default('pvc'),
  // Developed length of the trap arm (trap weir → vent) in meters. The
  // draw tool measures it when the arm is drawn; editable in the
  // inspector. Drives the IPC 909.1 max-trap-arm check.
  armLengthM: z.number().min(0).default(0),
}).describe(
  dedent`
  DWV trap (P-trap) - the water-seal fitting between a fixture and the waste line.
  - position: [x, y, z] level-local meters
  - rotation: yaw radians (trap-arm direction in plan)
  - diameter: trap size in inches (matches the fixture drain)
  - pipeMaterial: pvc | abs | cast-iron
  - armLengthM: developed length from trap to vent in meters (IPC 909.1 limited by size)
  `,
)
export type PipeTrapNode = z.infer<typeof PipeTrapNode>
export type PipeTrapNodeId = PipeTrapNode['id']
