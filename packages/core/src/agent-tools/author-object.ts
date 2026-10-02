import { z } from 'zod'
import { measurement } from './measurement'
import { NodeId } from './node-id'

const DESCRIPTION = `Build an object by writing a plain three.js module, the way you would in any three.js project. Use it for what the catalog and the structure tools cannot reproduce faithfully: custom columns and capitals, mouldings and trim, panels, lanterns and fixtures, exposed beams, vaulted or tray ceiling bodies, canopies, a porch, railings, built-ins. Pascal runs the module in a sandbox, stores the result and places it as one object the user can move, paint, and ask you to edit again.

Module shape (import THREE from the three package as usual; the addons below too):
  // also available: three/addons/utils/BufferGeometryUtils.js, three/addons/geometries/{RoundedBoxGeometry,ConvexGeometry,LoftGeometry,ParametricGeometry}.js, three-bvh-csg (Brush, Evaluator, SUBTRACTION, ADDITION, INTERSECTION)
  export const params = { width: { default: 4.8, min: 3, max: 8, step: 0.1, unit: 'm', label: 'Width' } }
  export const mount = 'floor'   // 'floor' | 'wall-side' (on a wall face) | 'wall' (through a wall, like a window) | 'ceiling'
  export default function build({ params, THREE }) { const group = new THREE.Group(); /* … */ return group }

One object is one feature that changes together: a porch, a railing run, a fireplace surround, a ceiling with its beams. Never a whole house, and never walls, rooms, floors, roofs, stairs, doors or windows: those have their own tools.

Conventions (they make the object work in Pascal; follow them):
- Metres, Y up, modelled as it stands. Pascal puts the bottom-centre of the bounds at the placement point; for wall-side the back face sits on the wall and the object faces +Z.
- Paint: name every material slot_<finish> (slot_trim, slot_frame, slot_metal) and reuse one material per finish; a material named "glass" renders as glass.
- Parts: name the few groups a person would point at part:<id> (part:column_left, part:canopy, part:landing), usually 2–24, a group per part, not every mesh. Set userData.type on parts someone would look for: column, beam, slab, roof, railing, panel, trim, step, light.
- Lights: add a THREE.PointLight or SpotLight named light:<id> where the bulb is; it becomes a switchable light.
- Motion: put THREE.AnimationClips on the returned group's .animations, as in any three.js project; tracks target <objectName>.<property> or <object.uuid>.<property> and may use any transform property (position, rotation, rotation[y], quaternion, scale); material and visibility tracks do not animate. A clip named open becomes the object's open/close control (close plays a clip named close, or open reversed); a clip named loop runs continuously; every other clip gets its own play toggle labelled with its name (name it for the person: "Twirl", "Music"). Write as many clips as the object needs.
- Wall opening: a mesh named cutout (wall mount), shaped like the hole and as deep as the wall or deeper, is cut out of the host wall in that shape and never renders (a niche, a vent, a pass-through).
- Sockets: an empty Object3D named anchor:<id> marks where other things attach.
- No textures, network or DOM. At most 300k triangles, 32 materials, 60 m per side.

Edit: pass nodeId with new code and/or params; identity, placement and paint are kept. The result lists the size, parts, slots, lights, animations and params.`

export const authorObjectTool = {
  name: 'author_object',
  title: 'Build object',
  description: DESCRIPTION,
  input: {
    code: z.string().min(1).max(48_000).describe('The three.js module (see the tool description).'),
    params: z
      .record(z.string(), z.union([z.number(), z.boolean(), z.string()]))
      .optional()
      .describe('Values for the params the module declares; omitted ones use their defaults.'),
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
    name: z.string().max(120).optional().describe('What the user would call it ("Front porch").'),
    category: z
      .string()
      .max(60)
      .optional()
      .describe('What it is, one word or two ("porch", "lantern", "ceiling", "trim").'),
  },
}
