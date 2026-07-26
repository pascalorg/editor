import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * Procedural formwork dressing for a wall — shutter panels, ties, and
 * walers generated from the host wall's `formworkType` / `tieSpacing` /
 * `walerSpacing` fields (see `packages/core/src/schema/nodes/wall.ts`).
 *
 * `parentId` IS the host wall (same convention as door/window) — no
 * separate `hostWallId` field. `packages/nodes/src/formwork-system/geometry.ts`
 * reads the host via `ctx.parent`.
 *
 * Never placed by hand (no `tool`, hidden from the Build palette) —
 * created by `attachFormworkToWall()`, called from the wall panel's
 * "Add formwork geometry" button or the AI chat tool. See
 * `wiki/formwork-system-plan.md`.
 */
export const FormworkSystemNode = BaseNode.extend({
  id: objectId('formwork-system'),
  type: nodeType('formwork-system'),
  children: z.array(z.string()).default([]),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  /** PERI-style shutter module width in meters. */
  panelWidth: z.number().default(0.6),
}).describe(
  dedent`
  Formwork node - procedural shutter panels + ties + walers generated for a wall
  - parentId: the wall this formwork dresses (required host relation)
  - panelWidth: shutter module width in meters, default 0.6
  `,
)
export type FormworkSystemNode = z.infer<typeof FormworkSystemNode>
