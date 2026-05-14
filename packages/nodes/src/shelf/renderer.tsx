'use client'

import { useLiveTransforms, useRegistry } from '@pascal-app/core'
import { useEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import { buildShelfGeometry } from './geometry'
import type { ShelfNode } from './schema'

// Note: `useNodeEvents` from @pascal-app/viewer has a hardcoded kind list and
// doesn't yet know about 'shelf'. Phase 4 generalizes it to consume the
// registry — until then, shelf selection works via R3F's default raycast
// (clicks bubble through the scene; the editor's selection manager handles
// them by hit-testing the registered Object3D).

/**
 * Registry-driven shelf renderer.
 *
 * The pure `buildShelfGeometry` function returns a Group of meshes. We mount
 * an empty group, attach event handlers, register with `sceneRegistry`, and
 * imperatively swap in the built geometry whenever the schema-relevant fields
 * change. This pattern keeps the JSX trivial and centralizes parametric work
 * in the pure function — better for AI authoring and easier to swap out.
 */
const ShelfRenderer = ({ node }: { node: ShelfNode }) => {
  const ref = useRef<Group>(null!)
  const liveTransform = useLiveTransforms((state) => state.get(node.id))

  useRegistry(node.id, 'shelf', ref)

  // Build a fresh Group each time the parametric fields change.
  const built = useMemo(
    () => buildShelfGeometry(node),
    [node.width, node.depth, node.thickness, node.height, node.bracketStyle, node.color],
  )

  // Mount the built children under our group ref. Re-runs when `built`
  // changes (parametric edit) or when the parent ref mounts.
  useEffect(() => {
    const root = ref.current
    if (!root) return
    // Clear previous children. We don't dispose the buffer geometries here
    // because they're owned by the previous `built` and were already
    // discarded by React's reconciler when useMemo recomputed.
    while (root.children.length > 0) {
      root.remove(root.children[0]!)
    }
    for (const child of [...built.children]) {
      root.add(child)
    }
  }, [built])

  return (
    <group
      position={liveTransform?.position ?? node.position}
      ref={ref}
      rotation={liveTransform?.rotation ? [0, liveTransform.rotation, 0] : node.rotation}
      visible={node.visible}
    />
  )
}

export default ShelfRenderer
