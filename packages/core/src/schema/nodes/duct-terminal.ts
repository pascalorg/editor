import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

/**
 * Duct terminal — where the air loop meets the room: supply registers,
 * ceiling diffusers, return grilles.
 *
 * Phase 3 of the HVAC node system. Each terminal exposes a single typed
 * port at its collar (behind/above/below the face depending on mount),
 * so duct runs end onto it like any other port.
 *
 * `position` is the center of the visible face in level-local meters —
 * floor registers at y≈0, ceiling diffusers at ceiling height, wall
 * registers at their height on the wall. `rotation` is yaw radians.
 */
export const DuctTerminalNode = BaseNode.extend({
  id: objectId('duct-terminal'),
  type: nodeType('duct-terminal'),
  // Level-local meters — center of the face.
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  // Yaw in radians.
  rotation: z.number().default(0),
  terminalType: z.enum(['supply-register', 'diffuser', 'return-grille']).default('supply-register'),
  // Which surface the terminal mounts on. Drives face orientation and
  // which way the collar (and its port) points.
  mount: z.enum(['floor', 'ceiling', 'wall']).default('floor'),
  // Face dimensions in meters. Typical floor register ~0.30 × 0.15;
  // ceiling diffusers are square (0.6 × 0.6); return grilles run large.
  width: z.number().min(0.1).max(1.5).default(0.3),
  depth: z.number().min(0.05).max(1.5).default(0.15),
  // Collar cross-section on the duct side. Round is the default; rect and
  // oval (flat-oval) match the duct shapes a run might end with.
  collarShape: z.enum(['round', 'rect', 'oval']).default('round'),
  // Round collar diameter in inches on the duct side.
  collarDiameter: z.number().min(4).max(20).default(6),
  // Rect / oval collar cross-section in inches: width is the horizontal
  // face, height the vertical. For oval, height is also the end-cap
  // semicircle diameter (width ≥ height).
  collarWidth: z.number().min(4).max(20).default(10),
  collarHeight: z.number().min(3).max(20).default(6),
}).describe(
  dedent`
  Duct terminal - supply register, ceiling diffuser, or return grille.
  - position: [x, y, z] level-local meters, center of the face
  - rotation: yaw radians
  - terminalType: supply-register | diffuser | return-grille (grille = return side)
  - mount: floor | ceiling | wall - face orientation + collar direction
  - width / depth: face size in meters
  - collarShape: round | rect | oval - duct-side collar cross-section
  - collarDiameter: round collar diameter in inches
  - collarWidth / collarHeight: rect / oval collar cross-section in inches
  `,
)
export type DuctTerminalNode = z.infer<typeof DuctTerminalNode>
export type DuctTerminalNodeId = DuctTerminalNode['id']
