'use client'

import { type RoofNode, useRegistry, useScene } from '@pascal-app/core'
import { NodeRenderer } from '@pascal-app/viewer/node-renderer'
import { useNodeEvents } from '@pascal-app/viewer/node-events'
import { getRoofMaterialArray } from '@pascal-app/viewer/roof-materials'
import { createSafeEmptyGeometry } from '@pascal-app/viewer/safe-geometry'
import useViewer from '@pascal-app/viewer/store'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type * as THREE from 'three'
import { roofDebugMaterials, roofMaterials } from './roof-materials'

export const RoofRenderer = ({ node }: { node: RoofNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'roof', ref)
  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'roof')
  const debugColors = useViewer((s) => s.debugColors)
  const placeholderGeometry = useMemo(() => {
    const geometry = createSafeEmptyGeometry()
    geometry.clearGroups()
    geometry.addGroup(0, 0, 0)
    geometry.addGroup(0, 0, 1)
    geometry.addGroup(0, 0, 2)
    geometry.addGroup(0, 0, 3)
    return geometry
  }, [])

  const customMaterial = useMemo(() => getRoofMaterialArray(node), [node])

  const material = debugColors ? roofDebugMaterials : customMaterial || roofMaterials

  useEffect(() => {
    return () => {
      placeholderGeometry.dispose()
    }
  }, [placeholderGeometry])

  return (
    <group
      position={node.position}
      ref={ref}
      rotation-y={node.rotation}
      visible={node.visible}
      {...handlers}
    >
      <mesh
        castShadow
        geometry={placeholderGeometry}
        material={material}
        name="merged-roof"
        receiveShadow
      />
      <group name="segments-wrapper" visible={false}>
        {(node.children ?? []).map((childId) => (
          <NodeRenderer key={childId} nodeId={childId} />
        ))}
      </group>
    </group>
  )
}

export default RoofRenderer
