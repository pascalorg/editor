import type { AnyNode, SceneActionCapability } from '@pascal-app/core'
import { useSelectedPart } from './selected-part'

/**
 * Clicking a part of the shutter in 3D.
 *
 * The builders stamp `formworkPartMark` on every mesh they emit, and the pointer hit
 * carries the mesh that was actually raycast — so the mark of the panel under the
 * cursor is already in the event and needs nothing new from the viewer. The dispatch
 * walks the hit's parent chain, which is what makes a mesh nested inside a builder
 * group resolve to the same mark as one added flat.
 *
 * `activate` returns `false` deliberately, which is the one thing worth reading twice.
 * A `true` return consumes the click, and consuming it would mean clicking a waler
 * selected the waler and *deselected the shutter* — no transform gizmo, no delete, no
 * inspector to show the part in. So this records which part was hit and then lets the
 * ordinary selection run: the assembly is selected, its panel opens, and the parts
 * table scrolls to the row that was clicked. Selecting a sub-part is additional
 * information about a selection, not a rival to it.
 */
// Exposed with the default `unknown` target: `activate` only ever receives what this
// capability's own `resolveTarget` returned, so the narrow is safe.
export const formworkPartSceneAction: SceneActionCapability = {
  resolveTarget: (object) => {
    const mark = object.userData.formworkPartMark
    return typeof mark === 'string' && mark.length > 0 ? mark : null
  },
  activate: (node: AnyNode, target) => {
    useSelectedPart.getState().select(node.id as string, target as string)
    return false
  },
}
