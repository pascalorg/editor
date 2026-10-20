import type { z } from 'zod'

/**
 * `verify_scene`'s contract. Other modules extend it with an input and a sentence for the check
 * they register (the photo's: `photo`), so it stays one tool agents know, with one contract on
 * both surfaces, and imports none of them.
 */
const extensions: { input: Record<string, z.ZodType>; description: string }[] = []

/** Adds inputs and a sentence of description to verify_scene, for a check registered with it. */
export function extendVerifyScene(extension: {
  input: Record<string, z.ZodType>
  description: string
}) {
  extensions.push(extension)
}

const DESCRIPTION =
  'Optional whole-scene evidence: per-level content, roles (storey, roof-only, support) and the spaces its walls enclose, then every problem found, each with a type: empty levels, walls with no room or door, a space the walls enclose with no room over it (space_no_room) or with several and no wall between them (space_many_rooms), a room the walls do not close (room_not_enclosed) or with no name (room_unnamed), rooms with no floor or ceiling, storeys with no stair, roof levels misused, walls intersecting a covering slab or ending coplanar with its walking surface (wall_covering_slab_contact, with wallId and slabId), openings off their wall, stairs off their slab or blocked, furniture blocking a door or overlapping, a house past its lot line or in its required yards, every node field its schema rejects (schema_invalid, with its nodeId and path; valid is then false, and the level holding the node lists it as unread and is measured once it is fixed), a node kind no schema here knows, once per kind (schema_unknown_kind, info: a plugin kind), a hidden site (site_hidden). Static authored ceiling objects report transformed bounds extending above their ceiling attachment and bounds overlapping solid covering slab bands, with node IDs and measured metres; stored and derived slab holes are subtracted. Wall-mounted objects report a front oriented toward their host; static authored wall bounds report wall-body overlap and extension through the opposite face. With settled editor meshes, catalog wall bounds and large competing coplanar faces against the host or another item on the same wall are also measured within 1 mm. Hidden back-to-wall contact is not competing face evidence. These are observations, not instructions to change the scene or proof of exact mesh intersection. Bounds are measured in the owning building frame, including stacked level elevations. Unknown catalog raw bounds without meshes, animated models, unsupported attachment frames, unresolved scripted wall cuts, roof collisions, recessed slab shells and foundation volumes are not assessed.'

export const verifySceneTool = {
  name: 'verify_scene',
  title: 'Verify scene',
  get description() {
    return [DESCRIPTION, ...extensions.map((extension) => extension.description)].join(' ')
  },
  get input(): Record<string, z.ZodType> {
    return Object.assign({}, ...extensions.map((extension) => extension.input))
  },
}
