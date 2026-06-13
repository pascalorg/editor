import { type AnyNodeId, type RoofNode, sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

// Empty placeholder geometry used when we reveal segments-wrapper for
// accessory editing. The roof's CSG-merged shell is the only thing
// that should render the roof surface in this mode — the per-segment
// CSG geometry (if any was left over from a prior edit) would visually
// double the cut shape, so we strip each segment mesh back to nothing.
// `RoofSystem` rebuilds CSG on demand if the user later selects a
// segment, so destroying the cached geometry here only costs one
// recomputation per segment when the user actually wants it back.
function makeEmptySegmentGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  // Three zero-vertices (one degenerate, invisible triangle), not an empty
  // attribute: in accessory-reveal mode the segments-wrapper is shown, so these
  // meshes are drawn. An empty position (count 0) leaves WebGPU vertex buffer
  // slot 0 unbound and the draw is rejected, poisoning the command encoder.
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(6), 2))
  g.setAttribute('uv2', new THREE.Float32BufferAttribute(new Float32Array(6), 2))
  // Match the four material slots the roof-segment renderer's material
  // array expects (0=top, 1=side, 2=interior, 3=shingle). Without these
  // groups, mesh.material is a single-material lookup that mismatches
  // the array — same crash mode the BoxGeometry workaround in
  // `roof-system.tsx:144` guards against.
  g.addGroup(0, 0, 0)
  g.addGroup(0, 0, 1)
  g.addGroup(0, 0, 2)
  g.addGroup(0, 0, 3)
  return g
}

/**
 * Imperatively toggles the Three.js visibility of roof objects based on the
 * editor selection — without causing React re-renders in RoofRenderer.
 *
 * Full edit-mode (segment selected):
 *   - merged-roof mesh is hidden
 *   - segments-wrapper group is shown (individual segments visible for editing)
 *   - all children are marked dirty so RoofSystem rebuilds their geometry
 *
 * Accessory-reveal mode (a dormer/chimney/etc. hosted on a segment is selected):
 *   - merged-roof mesh stays visible (we don't want the appearance to jump)
 *   - segments-wrapper group is shown ANYWAY so anything portaled into a
 *     segment's registered mesh (e.g. dormer in-world handle arrows that
 *     don't use `portal: 'grandparent'`) is no longer inheriting the
 *     wrapper's hidden flag
 *   - segment placeholder geometry is empty, so revealing the wrapper has
 *     no visible cost beyond letting the handle arrows render
 *
 * When deselected: merged-roof shown, segments-wrapper hidden.
 */
export const RoofEditSystem = () => {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const prevActiveRoofIds = useRef(new Set<string>())
  const prevRevealRoofIds = useRef(new Set<string>())

  useEffect(() => {
    const nodes = useScene.getState().nodes

    // Roofs where a segment itself is selected -> full edit mode (hide
    // merged, show wrapper).
    const activeRoofIds = new Set<string>()
    // Roofs where an accessory (dormer/chimney/etc.) is selected -> only
    // reveal the wrapper so handle portals into the segment mesh become
    // visible. Merged stays on.
    const revealRoofIds = new Set<string>()

    for (const id of selectedIds) {
      const node = nodes[id as AnyNodeId]
      if (!node) continue
      if (node.type === 'roof-segment' && node.parentId) {
        activeRoofIds.add(node.parentId)
        continue
      }
      // Walk up one level: if the parent is a roof-segment, this is a
      // hosted accessory and we want to reveal its grandparent roof's
      // wrapper. Two-step lookup keeps it scoped to roof children
      // without enumerating all accessory kinds.
      if (!node.parentId) continue
      const parent = nodes[node.parentId as AnyNodeId]
      if (parent?.type === 'roof-segment' && parent.parentId) {
        revealRoofIds.add(parent.parentId)
      }
    }

    // Union of roofs that need ANY state change this tick.
    const roofIdsToUpdate = new Set([
      ...activeRoofIds,
      ...revealRoofIds,
      ...prevActiveRoofIds.current,
      ...prevRevealRoofIds.current,
    ])

    for (const roofId of roofIdsToUpdate) {
      const group = sceneRegistry.nodes.get(roofId)
      if (!group) continue

      const mergedMesh = group.getObjectByName('merged-roof')
      const segmentsWrapper = group.getObjectByName('segments-wrapper')
      const isActive = activeRoofIds.has(roofId)
      const isReveal = revealRoofIds.has(roofId)

      if (mergedMesh) mergedMesh.visible = !isActive
      if (segmentsWrapper) segmentsWrapper.visible = isActive || isReveal

      const roofNode = nodes[roofId as AnyNodeId] as RoofNode | undefined
      if (roofNode?.children?.length) {
        const wasActive = prevActiveRoofIds.current.has(roofId)
        const wasReveal = prevRevealRoofIds.current.has(roofId)
        if (isActive !== wasActive) {
          // Entering / exiting full edit mode: rebuild segment / merged
          // geometries. Accessory-reveal doesn't need this — segments
          // keep their placeholder; only their visibility flips.
          const { markDirty } = useScene.getState()
          for (const childId of roofNode.children) {
            markDirty(childId as AnyNodeId)
          }
        }
        // Entering reveal mode (and NOT also full-edit, which already
        // owns its own rebuild path): strip each segment mesh back to
        // an empty placeholder so the wrapper-now-visible doesn't
        // re-show stale CSG geometry from a previous segment edit.
        // Without this, the host segment's CSG cut renders ON TOP of
        // the merged-roof, doubling the dormer's cut shape and
        // bleeding the host wall material through the dormer body.
        if (isReveal && !isActive && !wasReveal && segmentsWrapper) {
          for (const child of segmentsWrapper.children) {
            const mesh = child as THREE.Mesh
            if (!mesh.isMesh) continue
            mesh.geometry?.dispose()
            mesh.geometry = makeEmptySegmentGeometry()
          }
        }
      }
    }

    prevActiveRoofIds.current = activeRoofIds
    prevRevealRoofIds.current = revealRoofIds
  }, [selectedIds])

  return null
}
