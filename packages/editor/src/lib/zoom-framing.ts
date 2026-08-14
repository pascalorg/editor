'use client'

import { sceneRegistry } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Box3, type BufferGeometry, type Object3D } from 'three'
import useEditor from '../store/use-editor'

/**
 * Shared framing rules for the "zoom to selection" / "zoom extents" commands
 * (`camera-controls:zoom-selection` / `camera-controls:zoom-extents`).
 *
 * Both views implement the commands themselves — the 3D camera controls frame a
 * `Box3` from the scene registry, the floorplan frames the SVG bounds of the
 * same nodes — because in 2D-only mode the R3F canvas has never been sized and
 * so no camera, and no registry, exists to frame. What has to agree between the
 * two is *which* nodes count as the target, and that lives here.
 */

/**
 * The nodes a zoom-to-selection frames, in priority order: the canvas
 * selection, then a selected reference (guide / scan — those live outside the
 * viewer selection), then the active zone.
 */
export function resolveZoomSelectionIds(): string[] {
  const { selection } = useViewer.getState()
  if (selection.selectedIds.length > 0) return [...selection.selectedIds]

  const referenceId = useEditor.getState().selectedReferenceId
  if (referenceId) return [referenceId]

  if (selection.zoneId) return [selection.zoneId]
  return []
}

// `Object3D.visible` is a local flag, so a wall inside a hidden level is still
// `visible === true`. Zoom extents must frame what is on screen (single-level
// display mode hides the rest of the building), which means walking up.
function isRenderedVisible(object: Object3D) {
  let current: Object3D | null = object
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}

const geometryBox = new Box3()

/**
 * `Box3.expandByObject` with the two exclusions framing needs.
 *
 * Hidden subtrees are skipped, and so is anything a renderer marked
 * `userData.pascalExport = 'strip'` — presentation geometry that stands in for
 * the world rather than being part of the model. The site's 800 m horizon disc
 * is the one that matters: unfiltered it *is* the scene's bounds, and zoom
 * extents lands a kilometre out with the building an invisible speck. Same
 * marker, same reason, as the GLB export's prune (`lib/glb-export.ts`).
 */
function expandByModelGeometry(target: Box3, root: Object3D) {
  root.updateWorldMatrix(true, true)
  const stack: Object3D[] = [root]

  while (stack.length > 0) {
    const object = stack.pop()
    if (!object?.visible || object.userData.pascalExport === 'strip') continue

    const geometry = (object as { geometry?: BufferGeometry }).geometry
    if (geometry) {
      if (geometry.boundingBox === null) geometry.computeBoundingBox()
      if (geometry.boundingBox) {
        target.union(geometryBox.copy(geometry.boundingBox).applyMatrix4(object.matrixWorld))
      }
    }

    for (const child of object.children) stack.push(child)
  }
}

/**
 * Union the registered 3D bounds of `ids` into `target`, which is emptied
 * first. Returns it for chaining; check `isEmpty()` for "nothing to frame".
 *
 * Descendants are walked, so a wall contributes its door and window cutouts and
 * a level contributes everything standing on it.
 */
export function collectNodeBounds(target: Box3, ids: Iterable<string>): Box3 {
  target.makeEmpty()
  for (const id of ids) {
    const object = sceneRegistry.nodes.get(id)
    if (!object || !isRenderedVisible(object)) continue
    expandByModelGeometry(target, object)
  }
  return target
}

/**
 * Union the bounds of every visible registered node — the zoom-extents box.
 *
 * Only subtree roots are expanded. Registered nodes nest (site → building →
 * level → wall) and the walk covers descendants, so expanding every entry
 * would re-traverse the whole graph once per node.
 */
export function collectSceneBounds(target: Box3): Box3 {
  target.makeEmpty()
  const registered = new Set(sceneRegistry.nodes.values())
  for (const object of registered) {
    if (!isRenderedVisible(object) || hasRegisteredAncestor(object, registered)) continue
    expandByModelGeometry(target, object)
  }
  return target
}

function hasRegisteredAncestor(object: Object3D, registered: ReadonlySet<Object3D>) {
  let current = object.parent
  while (current) {
    if (registered.has(current)) return true
    current = current.parent
  }
  return false
}
