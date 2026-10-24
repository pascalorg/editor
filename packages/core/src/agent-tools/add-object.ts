import { z } from 'zod'
import { geometryMetaFields } from '../schema/geometry-metadata'
import { GeometryScriptLanguage } from '../schema/geometry-source'
import { measurement } from './measurement'
import { NodeId } from './node-id'

const DESCRIPTION = `Author parametric Three.js furniture, decor and custom objects of any shape, dimensions or style, whether or not the catalog holds something similar (the catalog is a limited set that varies by server). Examples include a low oak table, a slatted bench, a paper lantern, built-ins, custom columns and capitals, mouldings and trim, panels, exposed beams, ceiling bodies, canopies, a porch and railings. Pascal runs the module in a sandbox, stores the result and places it as one object the user can move, paint, and ask you to edit again.

Module shape (import THREE from the three package as usual; the addons below too):
  // also available: three/addons/utils/BufferGeometryUtils.js, three/addons/geometries/{RoundedBoxGeometry,ConvexGeometry,LoftGeometry,ParametricGeometry}.js, three-bvh-csg (Brush, Evaluator, SUBTRACTION, ADDITION, INTERSECTION)
  export const params = { width: { default: 4.8, min: 3, max: 8, step: 0.1, unit: 'm', label: 'Width' } }
  export const mount = 'floor'   // 'floor' | 'wall-side' (on a wall face) | 'wall' (through a wall, like a window) | 'ceiling'
  export default function build({ params, THREE }) { const group = new THREE.Group(); /* … */ return group }

One object is one feature that changes together: a table, a bench, a porch, a railing run, a fireplace surround, a ceiling with its beams. Never a whole house, and never walls, rooms, floors, roofs, stairs, doors or windows: those have their own tools. A new object's reason records its design intent: what the authored shape, dimensions or style contributes to the request. The scene check lists every authored object with its reason; no catalog-exhaustion proof is required. On a floor, a plain box with a wall's size or a floor plate is refused with the tool to use (use_walls, use_slab); a detailed object with a wall's size (a bookcase, a screen), or one named after something Pascal builds, is built with a hint naming the tool.

Conventions (they make the object work in Pascal; follow them):
- Metres, Y up, modelled in its installed orientation. Floor and wall mounts put the bottom-centre of the visible bounds at the placement point. Ceiling mounts put the top-centre there: visible geometry extends down in negative local Y, with its top at Y = 0. Wall-side mounts put the bottom-centre of the back face there (back at Z = 0, facing +Z). Normalization translates geometry; it does not flip it.
- Paint: name every material slot_<finish> (slot_trim, slot_frame, slot_metal) and reuse one material per finish; a material named "glass" renders as glass.
- Parts: name the few groups a person would point at part:<id> (part:column_left, part:canopy, part:landing), usually 2–24, a group per part, not every mesh. Set userData.type on parts someone would look for: column, beam, slab, roof, railing, panel, trim, step, light.
- Lights: add a THREE.PointLight or SpotLight named light:<id> where the bulb is; it becomes a switchable light.
- Motion: put THREE.AnimationClips on the returned group's .animations, as in any three.js project; tracks target <objectName>.<property> or <object.uuid>.<property> and may use any transform property (position, rotation, rotation[y], quaternion, scale); material and visibility tracks do not animate. A clip named open becomes the object's open/close control (close plays a clip named close, or open reversed); a clip named loop runs continuously; every other clip gets its own play toggle labelled with its name (name it for the person: "Twirl", "Music"). Write as many clips as the object needs.
- Cuts: a mesh named cutout cuts only the mounted host; cut:wall, cut:ceiling and cut:slab require that host kind (floor items cut their support slab). The hidden cutter must reach the host; walls use its real shape, ceilings and slabs its through-hole footprint.
- Sockets: an empty Object3D named anchor:<id> marks where other things attach.
- No textures, network or DOM. At most 300k triangles, 32 materials, 60 m per side.

Blender instead (language 'bpy'): when the shape is easier with Blender's modelling (bevelled or rounded edges, subdivision-smooth and organic forms, booleans, curves and text, solidify, array, screw and other modifiers), write a bpy module:
  import bpy, bmesh
  PARAMS = {"width": {"default": 1.8, "min": 1.2, "max": 2.6, "step": 0.05, "unit": "m", "label": "Width"}}
  MOUNT = "floor"
  def build(params): ...   # add objects to the empty scene; everything in it is exported, modifiers applied
The same conventions in Blender terms: metres, Z up, the front faces -Y (Blender's Front view); part:<id>, light:<id> (a light object; its custom property intensity sets the brightness, default 2), anchor:<id> (an empty), cutout, cut:wall|ceiling|slab and collider are object names; userData is the object's custom properties (obj["type"] = "panel"); slot_<finish> are material names. A clip is one action named open, close, loop or anything else, assigned to every object that moves in it. Use the data API and bmesh, not operators that need a 3D viewport. A Blender build takes a few seconds.

Several objects: they do not depend on each other, so several add_object calls can go in one step, or in one run_batch call (a call per object; each is reported on its own with its receipt, and one that fails does not stop the others).

Edit: pass nodeId with new code and/or params (params alone rebuild the stored script; get_source provides the current code and params when needed); identity, placement, paint and the params you leave out are kept. The result lists the size, parts, slots, lights, animations and params.`

/** The `params` field every scripted tool shares (add_object, add_window, add_door, add_column). */
export const scriptParams = z
  .record(z.string(), z.union([z.number(), z.boolean(), z.string()]))
  .optional()
  .describe(
    "Values for the params the module declares; on an edit, each one you leave out keeps its current value (clamped to the param's range) and a param new to the code starts at its default.",
  )

/** The `language` field every scripted tool shares. */
export const scriptLanguage = GeometryScriptLanguage.optional().describe(
  "The code's language: 'three' (default) for a three.js module, 'bpy' for a Blender module (see add_object). On an edit it defaults to the language the object was built in.",
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
        'The module (see the tool description). Required to create; omit to rebuild an object with new params.',
      ),
    language: scriptLanguage,
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
        'Placement of the mount origin in the host frame, metres. Floor: [x, y, z] locates the bottom-centre (y = 0 on the level floor). Ceiling: [x, y, z] locates the top-centre (y = 0 on the drawn ceiling attachment plane; negative y lowers it). Wall / wall-side: [distance along the wall from its start, height of the bottom, 0]; wall-side also anchors the back face.',
      ),
    rotation: measurement('angle', 'deg', {
      description:
        'Y-axis rotation in the host frame. New wall-side back mounts default to 180° so +Z faces away from the wall; other new objects default to 0°. An edit keeps its saved rotation unless given.',
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
    "The module (three.js or Blender bpy, named by language) an object (or a window, door or column built from code) runs, with its params and their current values; a room's id reads its floor script, the module that builds its floor finish; a wall's id with face reads that face's script (face may be left out when only one face has one). Optional source evidence when the current module is needed. An edited module can be passed back with the same nodeId: to add_object for an object, to add_window / add_door / add_column for their respective kinds.",
  input: {
    nodeId: NodeId.describe(
      'An object, window, door or column built from code, a room with a floor script, or a wall with a face script.',
    ),
    face: z
      .enum(['a', 'b'])
      .optional()
      .describe("A wall's face whose script to read; needed when both faces have one."),
  },
}
