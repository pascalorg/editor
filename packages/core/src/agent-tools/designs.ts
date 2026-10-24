import { z } from 'zod'
import { measurement } from './measurement'
import { NodeId } from './node-id'

const design = z
  .union([z.string(), z.record(z.string(), z.unknown())])
  .describe(
    'The design (procedural recipe, version 1 or 2) as an object, or as a JSON string for clients that cannot send recursive objects. Schema: pascal://schema/design.',
  )

const parameters = z
  .record(z.string(), z.number())
  .optional()
  .describe('Parameter values to measure at, by parameter id. Defaults otherwise.')

// A list of three, not a tuple: a tuple's list-form schema is refused by some clients.
const point3 = z.array(z.number()).length(3)

export const validateDesignTool = {
  name: 'validate_design',
  title: 'Validate design',
  description:
    'Check a design (procedural item recipe) without changing the scene. Returns `valid`, coded `diagnostics` with paths (errors block placement, warnings flag floating or unbalanced parts), the parameter `sweep`, and `measurements` at the given parameters: bounds, per-part bounds and instances, true triangle counts, draw groups per slot, datum contact and connected components. It is the authority: some rules are not expressible in pascal://schema/design. Repair and re-validate until `valid` is true. Version 2 designs validate fully but carry a design_version_not_enabled warning: placement accepts version 1 only until the next release.',
  input: { design, parameters },
  annotations: { readOnlyHint: true },
}

export const placeDesignTool = {
  name: 'place_design',
  title: 'Place design',
  description:
    'Create one instance of a design (procedural item recipe, object or JSON string) in the scene. The design must pass validate_design. Its mounting picks the host: floor designs go on a level (or a slab or zone of it) or on a named surface of a placed design; wall-side designs on a straight wall face; ceiling designs under a ceiling. Only creates: refusals carry a code (invalid_design with diagnostics, design_version_not_enabled for version 2 designs until the next release, design_too_large above 24 KiB, invalid_placement, node_exists, host_not_found, wrong_host, unknown_surface, does_not_fit) and change nothing.',
  input: {
    design,
    hostId: NodeId.describe(
      'Floor designs: a level, or a slab or zone on it, or a placed design with surfaceId. Wall-side designs: a straight wall. Ceiling designs: a ceiling.',
    ),
    position: point3.describe(
      'Metres. Floor: level-local [x, y, z], y above the floor. Wall-side: [along, height, offset] of the mounting reference from the wall start. Ceiling: plan [x, 0, z] of the reference. Surface: [x, 0, z] in the surface frame.',
    ),
    rotation: measurement('angle', 'rad', {
      description: 'Yaw. Not for wall-side designs; use side to face the other way.',
    }).optional(),
    side: z
      .enum(['front', 'back'])
      .optional()
      .describe(
        "Wall face for wall-side designs: front is the +normal side, normal (−Δz, Δx) of start→end. The wall's frontSide and backSide say which face is exterior (a facade light goes on that one).",
      ),
    surfaceId: z
      .string()
      .optional()
      .describe(
        'Named surface of the host design to rest on (see validate_design measurements.surfaces).',
      ),
    parameters,
    slots: z
      .record(z.string(), z.string())
      .optional()
      .describe('Slot id to "#rrggbb" or a scene:/library: material reference.'),
    name: z.string().optional(),
    id: z
      .string()
      .optional()
      .describe(
        'Optional new id ("procedural-item_…"). Refused if it exists: this tool only creates.',
      ),
  },
}
