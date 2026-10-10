import { z } from 'zod'
import { geometryMetaFields } from '../schema/geometry-metadata'
import { measurement } from './measurement'
import { NodeId } from './node-id'

const DESCRIPTION = `Author parametric Three.js furniture, decor and custom objects to match requested shapes, dimensions or style. A requested look or custom fit can justify authoring even when generic catalog equivalents exist; catalog items remain suitable when they fit. Examples include a low oak table, a slatted bench, a paper lantern, built-ins, custom columns and capitals, mouldings and trim, panels, exposed beams, ceiling bodies, canopies, a porch and railings. Pascal runs the module in a sandbox, stores the result and places it as one object the user can move, paint, and ask you to edit again.

Module shape (import THREE from the three package as usual; the addons below too):
  // also available: three/addons/utils/BufferGeometryUtils.js, three/addons/geometries/{RoundedBoxGeometry,ConvexGeometry,LoftGeometry,ParametricGeometry}.js, three-bvh-csg (Brush, Evaluator, SUBTRACTION, ADDITION, INTERSECTION)
  export const params = { width: { default: 4.8, min: 3, max: 8, step: 0.1, unit: 'm', label: 'Width' } }
  export const mount = 'floor'   // 'floor' | 'wall-side' (on a wall face) | 'wall' (through a wall, like a window) | 'ceiling'
  export default function build({ params, THREE }) { const group = new THREE.Group(); /* … */ return group }

One object is one feature that changes together: a table, a bench, a porch, a railing run, a fireplace surround, a ceiling with its beams. Never a whole house, and never walls, rooms, floors, roofs, stairs, doors or windows: those have their own tools. A new object's reason records its design intent: what the authored shape, dimensions or style contributes to the request. The scene check lists every authored object with its reason; no catalog-exhaustion proof is required. On a floor, a plain box with a wall's size or a floor plate is refused with the tool to use (use_walls, use_slab); a detailed object with a wall's size (a bookcase, a screen), or one named after something Pascal builds, is built with a hint naming the tool.

Conventions (they make the object work in Pascal; follow them):
- Metres, Y up, modelled as it stands. Pascal puts the bottom-centre of the bounds at the placement point; for wall-side the back face sits on the wall and the object faces +Z.
- Paint: name every material slot_<finish> (slot_trim, slot_frame, slot_metal) and reuse one material per finish; a material named "glass" renders as glass.
- Parts: name the few groups a person would point at part:<id> (part:column_left, part:canopy, part:landing), usually 2–24, a group per part, not every mesh. Set userData.type on parts someone would look for: column, beam, slab, roof, railing, panel, trim, step, light.
- Lights: add a THREE.PointLight or SpotLight named light:<id> where the bulb is; it becomes a switchable light.
- Motion: put THREE.AnimationClips on the returned group's .animations, as in any three.js project; tracks target <objectName>.<property> or <object.uuid>.<property> and may use any transform property (position, rotation, rotation[y], quaternion, scale); material and visibility tracks do not animate. A clip named open becomes the object's open/close control (close plays a clip named close, or open reversed); a clip named loop runs continuously; every other clip gets its own play toggle labelled with its name (name it for the person: "Twirl", "Music"). Write as many clips as the object needs.
- Cuts: a mesh named cutout cuts only the mounted host; cut:wall, cut:ceiling and cut:slab require that host kind (floor items cut their support slab). The hidden cutter must reach the host; walls use its real shape, ceilings and slabs its through-hole footprint.
- Sockets: an empty Object3D named anchor:<id> marks where other things attach.
- No textures, network or DOM. At most 300k triangles, 32 materials, 60 m per side.

Edit: pass nodeId with new code and/or params (params alone rebuild the stored script; read it first with get_source to change the code); identity, placement, paint and the params you leave out are kept. The result lists the size, parts, slots, lights, animations and params.`

/** The `params` field every scripted tool shares (add_object, add_window, add_door, add_column). */
export const scriptParams = z
  .record(z.string(), z.union([z.number(), z.boolean(), z.string()]))
  .optional()
  .describe(
    "Values for the params the module declares; on an edit, each one you leave out keeps its current value (clamped to the param's range) and a param new to the code starts at its default.",
  )

export const addObjectTool = {
  name: 'add_object',
  title: 'Build object',
  description: DESCRIPTION,
  input: {
    code: z
      .string()
      .min(1)
      .max(48_000)
      .optional()
      .describe(
        'The three.js module (see the tool description). Required to create; omit to rebuild an object with new params.',
      ),
    params: scriptParams,
    nodeId: NodeId.optional().describe(
      'Edit this existing authored object instead of creating one.',
    ),
    parentId: NodeId.optional().describe(
      'Host for a new object: a level (default: the floor in view), a wall (wall / wall-side mounts), a ceiling, or an item it rests on.',
    ),
    position: z
      .array(z.number())
      .length(3)
      .optional()
      .describe(
        'Placement in the host frame, metres. Level: [x, y, z] (y = 0 on the floor). Wall: [distance along the wall from its start, height of the bottom, 0].',
      ),
    rotation: measurement('angle', 'deg', {
      description: 'Y-axis rotation (default: 0).',
    }).optional(),
    side: z
      .enum(['front', 'back'])
      .optional()
      .describe('Which wall face a wall-side object sits on.'),
    ...geometryMetaFields,
    name: geometryMetaFields.name.describe('What the user would call it ("Low oak table").'),
    category: geometryMetaFields.category.describe(
      'What it is, one word or two ("table", "bench", "porch", "lantern", "trim").',
    ),
    reason: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Design intent: why this authored shape, size or style suits the request ("low oak table for the Japandi seating area"). Required to create; an edit keeps it unless given. No catalog-exhaustion proof is required.',
      ),
  },
}

export const getSourceTool = {
  name: 'get_source',
  title: 'Read object script',
  description:
    'The three.js module an object (or a window, door or column built from code) runs, with its params and their current values. Read it before changing its code, then pass the edited module back with the same nodeId: to add_object for an object, to add_window / add_door / add_column for their respective kinds.',
  input: {
    nodeId: NodeId.describe('An object, window, door or column built from code.'),
  },
}
