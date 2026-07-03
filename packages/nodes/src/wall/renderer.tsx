'use client'

import { useRegistry, useScene, type WallNode } from '@pascal-app/core'
import { NodeRenderer } from '@pascal-app/viewer/node-renderer'
import { useNodeEvents } from '@pascal-app/viewer/node-events'
import { createSafeEmptyGeometry } from '@pascal-app/viewer/safe-geometry'
import useViewer from '@pascal-app/viewer/store'
import { getVisibleWallMaterials } from '@pascal-app/viewer/wall-materials'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { BufferGeometry, Mesh } from 'three'

/**
 * Thin wall renderer.
 *
 * Mounts a placeholder mesh, registers it with `sceneRegistry`, marks the
 * node dirty so `WallSystem` fills the geometry on the next frame, and
 * recursively renders hosted children (doors / windows / wall-mounted
 * items) inside the wall's local frame.
 *
 * Behaviorally identical to the legacy `WallRenderer` in
 * `@pascal-app/viewer/components/renderers/wall/wall-renderer.tsx`.
 * Phase 6 deletes the legacy file; until then both coexist and the Phase 0
 * shims pick which one renders based on `nodeRegistry.has('wall')`.
 *
 * No `geometry` field on the wall definition yet — wall's geometry depends
 * on level-batch miter data (see `WallSystem.calculateLevelMiters`), which
 * doesn't fit the generic `(node, ctx) => Group` shape without `ctx.levelData`.
 * That decision lands in a later milestone; for now the system retains
 * ownership of the rebuild loop.
 */
function createEmptyWallGeometry(): BufferGeometry {
  const geometry = createSafeEmptyGeometry()
  geometry.clearGroups()
  geometry.addGroup(0, 0, 0)
  geometry.addGroup(0, 0, 1)
  geometry.addGroup(0, 0, 2)
  return geometry
}

const WallRenderer = ({ node }: { node: WallNode }) => {
  const ref = useRef<Mesh>(null!)
  const placeholderGeometry = useMemo(createEmptyWallGeometry, [])
  const collisionPlaceholderGeometry = useMemo(createSafeEmptyGeometry, [])

  useRegistry(node.id, 'wall', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  useEffect(() => {
    return () => {
      placeholderGeometry.dispose()
      collisionPlaceholderGeometry.dispose()
    }
  }, [collisionPlaceholderGeometry, placeholderGeometry])

  const handlers = useNodeEvents(node, 'wall')
  const shading = useViewer((state) => state.shading)
  const textures = useViewer((state) => state.textures)
  const colorPreset = useViewer((state) => state.colorPreset)
  const sceneTheme = useViewer((state) => state.sceneTheme)
  const material = getVisibleWallMaterials(node, { shading, textures, colorPreset, sceneTheme })

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
