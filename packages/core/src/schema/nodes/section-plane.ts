import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

const FiniteCoordinate = z.number().finite()

export const SectionPlaneNode = BaseNode.extend({
  id: objectId('section-plane'),
  type: nodeType('section-plane'),
  /** A point on the cutting plane, in the parent frame. */
  position: z.tuple([FiniteCoordinate, FiniteCoordinate, FiniteCoordinate]).default([0, 1.2, 0]),
  /**
   * XYZ euler applied to the plane's rest orientation. At rest the cut normal
   * is local -Y, so an unrotated plane keeps everything *below* it — the
   * horizontal floor-plan cut. Rotating 90° about X or Z yields a vertical
   * section.
   */
  rotation: z.tuple([FiniteCoordinate, FiniteCoordinate, FiniteCoordinate]).default([0, 0, 0]),
  /** Swaps which half-space survives without having to rotate by 180°. */
  flipped: z.boolean().default(false),
  /** Only the active plane cuts the scene; the rest stay as inert markers. */
  active: z.boolean().default(true),
  /** Edge length of the square widget drawn for the plane. Display only. */
  size: z.number().finite().min(0.5).max(500).default(12),
}).describe(
  dedent`
  Section plane node - an arbitrary cutting plane used to see inside the model
  - position: a point on the plane, in the parent frame (level-local metres)
  - rotation: XYZ euler over the rest orientation, whose cut normal is local -Y
    (unrotated = horizontal cut keeping everything below)
  - flipped: keep the opposite half-space
  - active: only the active plane cuts; others remain inert markers
  - size: edge length of the drawn widget, display only
  `,
)

export type SectionPlaneNode = z.infer<typeof SectionPlaneNode>
export type SectionPlaneNodeId = SectionPlaneNode['id']
