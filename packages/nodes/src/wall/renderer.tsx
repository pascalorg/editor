'use client'

import { useRegistry, useScene, type WallNode } from '@pascal-app/core'
import { getVisibleWallMaterials, NodeRenderer, useNodeEvents } from '@pascal-app/viewer'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { BufferGeometry, Float32BufferAttribute, type Mesh } from 'three'

/**
 * Thin wall renderer.
 *
 * Mounts a placeholder mesh, registers it with `sceneRegistry`, marks the
 * node dirty so `WallSystem` fills the geometry on the next frame, and
 * recursively renders hosted children (doors / windows / wall-mounted
 * items) inside the wall's local frame.
 *
 * Behaviorally identical to the legacy `WallRenderer` in
 * `@pascal-app/viewer/components/renderers/wall/wall-renderer.tsx` — same
 * placeholder geometry, same material lookup, same dirty-mark on mount.
 * Phase 6 deletes the legacy file; until then both coexist and the Phase 0
 * shims pick which one renders based on `nodeRegistry.has('wall')`.
 *
 * No `geometry` field on the wall definition yet — wall's geometry depends
 * on level-batch miter data (see `WallSystem.calculateLevelMiters`), which
 * doesn't fit the generic `(node, ctx) => Group` shape without `ctx.levelData`.
 * That decision lands in a later milestone; for now the system retains
 * ownership of the rebuild loop.
 */
// Phase 3 verification — set once when the first registry-driven wall
// renderer mounts. Stops the log firing per wall (a scene with 200 walls
// would spam the console). Drop alongside the feature flag at Phase 3
// sign-off.
let didLogFirstRegistryWallMount = false

function createEmptyWallGeometry(): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([], 3))
  geometry.addGroup(0, 0, 0)
  geometry.addGroup(0, 0, 1)
  geometry.addGroup(0, 0, 2)
  return geometry
}

const WallRenderer = ({ node }: { node: WallNode }) => {
  const ref = useRef<Mesh>(null!)
  const placeholderGeometry = useMemo(createEmptyWallGeometry, [])
  const collisionPlaceholderGeometry = useMemo(() => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([], 3))
    return geometry
  }, [])

  useRegistry(node.id, 'wall', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  useEffect(() => {
    if (didLogFirstRegistryWallMount) return
    didLogFirstRegistryWallMount = true
    console.info(
      '[wall:registry] first registry-driven WallRenderer mounted — legacy WallRenderer is NOT in use',
    )
  }, [])

  useEffect(() => {
    return () => {
      placeholderGeometry.dispose()
      collisionPlaceholderGeometry.dispose()
    }
  }, [collisionPlaceholderGeometry, placeholderGeometry])

  const handlers = useNodeEvents(node, 'wall')
  const material = getVisibleWallMaterials(node)

  return (
    <mesh
      castShadow
      geometry={placeholderGeometry}
      material={material}
      receiveShadow
      ref={ref}
      visible={node.visible}
    >
      <mesh
        geometry={collisionPlaceholderGeometry}
        name="collision-mesh"
        visible={false}
        {...handlers}
      />

      {node.children.map((childId) => (
        <NodeRenderer key={`${node.id}:${childId}`} nodeId={childId} />
      ))}
    </mesh>
  )
}

export default WallRenderer
