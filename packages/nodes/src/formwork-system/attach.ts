import { type FormworkSystemNode, generateId, type WallNode } from '@pascal-app/core/schema'

/**
 * Pure constructor for a formwork-system node hosted on `wall`. No store,
 * no React — safe to call from a client action (`useScene.getState()
 * .createNode(...)`) or directly against a plain `SceneGraph` on the
 * server (AI chat route).
 *
 * Position/rotation stay at identity: `WallRenderer` renders hosted
 * children *inside* the wall's own `<mesh>`, and `WallSystem` already
 * sets that mesh's position to `wall.start` and `rotation.y` to the
 * wall's heading (see `wall-system.tsx`'s `mesh.position.set(...)` /
 * `mesh.rotation.y = -angle`). Re-applying start+angle here would
 * double-transform the formwork — `buildFormworkGeometry` already
 * builds panels in that inherited local space `[0, wallLength]`.
 */
export function buildFormworkNode(wall: WallNode): FormworkSystemNode {
  return {
    object: 'node',
    id: generateId('formwork-system'),
    type: 'formwork-system',
    parentId: wall.id,
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    panelWidth: 0.6,
  }
}
