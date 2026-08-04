import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * A joint between two pours, or within one element between two lifts.
 *
 * These are first-class nodes because the joint, not the element, owns the
 * work. A stop-end at a construction joint is never a plain plate: starter
 * bars have to pass through it, a shear key adds a draft-tapered rebate, and
 * a PVC waterstop splits it into two halves either side of the centre bulb.
 * All of that belongs to the interface shared by two elements, so hanging it
 * off either one would make the second element's shutter wrong.
 *
 * `kind` also decides whether the pour graph may bridge the joint at all. An
 * expansion joint is a *hard* partition — the two sides are structurally
 * independent and no monolithic pour may cross it. A construction joint is a
 * *soft* partition, chosen to satisfy pour volume, supply rate, or shrinkage
 * control, and so may be moved by the solver. See
 * `wiki/formwork/reference/coverage.md` §1.11.
 */

export const ConstructionJointKind = z.enum([
  'construction',
  'expansion',
  'contraction',
  'isolation',
  'sliding',
])
export type ConstructionJointKind = z.infer<typeof ConstructionJointKind>

/**
 * Joint treatments, from `coverage.md` §1.3. Each carries geometric
 * consequences for the stop-end that forms it, not just a specification note.
 */
export const JointTreatmentKind = z.enum([
  /** Roughen to CSP 5–7, 30–50 % coarse aggregate exposed. */
  'roughening',
  /** Tapered rebate strip nailed to the stop-end; must be draft-tapered to strip. */
  'shear-key',
  /** Starter bars pass through the stop-end — it needs slotted penetrations. */
  'starter-bars',
  /** PVC or hydrophilic; a PVC bulb splits the stop-end in two. */
  'waterstop',
  'bonding-agent',
  'injectable-hose',
  /** Expansion joints only: compressible filler board plus sealant. */
  'filler-board',
  /** Sliding joints only. */
  'slip-membrane',
  /** Contraction joints: an induced crack former rather than a full stop-end. */
  'crack-inducer',
])
export type JointTreatmentKind = z.infer<typeof JointTreatmentKind>

export const WaterstopType = z.enum(['pvc-central', 'pvc-surface', 'hydrophilic'])
export type WaterstopType = z.infer<typeof WaterstopType>

export const JointTreatment = z.object({
  kind: JointTreatmentKind,
  /** Waterstop treatments only. */
  waterstopType: WaterstopType.optional(),
  /** Shear key / filler board depth into the section, in meters. */
  depth: z.number().finite().nonnegative().optional(),
  note: z.string().trim().max(500).optional(),
})
export type JointTreatment = z.infer<typeof JointTreatment>

export const ConstructionJointNode = BaseNode.extend({
  id: objectId('construction-joint'),
  type: nodeType('construction-joint'),
  children: z.array(z.string()).default([]),

  kind: ConstructionJointKind.default('construction'),
  /**
   * The elements this joint separates. One id for a joint inside a single
   * element (a lift joint); two for an interface between elements.
   */
  elementIds: z.array(z.string()).default([]),
  /**
   * Horizontal lift joints only: elevation above the host's base, in meters.
   * Absent for a vertical joint between two elements.
   */
  elevation: z.number().finite().optional(),
  /**
   * Vertical joints inside a single element: distance along the host's
   * centreline from its start, in meters. A pour break needs this because it
   * falls in the middle of a wall rather than at an interface — the position of
   * a joint *between* two elements is already fixed by where they meet.
   */
  along: z.number().finite().nonnegative().optional(),
  treatments: z.array(JointTreatment).default([]),
  /**
   * True when the solver placed this joint and may move it. A joint the user
   * or engineer specified is a fixed constraint the solver must honour.
   */
  solverPlaced: z.boolean().default(false),
}).describe(
  dedent`
  Construction joint - the interface between two pours, or between two lifts of one element
  - kind: construction (soft partition, solver may move it) | expansion (hard partition, never bridged by a monolithic pour) | contraction | isolation | sliding
  - elementIds: the elements this joint separates; one id for a lift joint inside a single element
  - elevation: for a horizontal lift joint, height above the host's base in meters
  - along: for a vertical pour break inside one element, distance along its centreline from the start, in meters
  - treatments: roughening, shear key, starter bars, waterstop, bonding agent, filler board, slip membrane, crack inducer — each changes the stop-end that forms the joint
  - solverPlaced: true when the solver chose this position and may move it; false means a fixed constraint
  `,
)
export type ConstructionJointNode = z.infer<typeof ConstructionJointNode>
export type ConstructionJointId = ConstructionJointNode['id']
