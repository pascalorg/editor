'use client'

import { type RoofNode, useRegistry, useScene } from '@pascal-app/core'
import { getRoofMaterialArray, NodeRenderer, useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
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
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
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
      {/* Segments hold per-segment data + mount any hosted accessories
          (chimney, dormer, skylight, box-vent, ridge-vent, solar-panel)
          via the roof-segment renderer's recursive `NodeRenderer`. The
          segment placeholder meshes themselves stay empty (`RoofSystem`
          only fills the `merged-roof` mesh above) so they don't z-fight
          with the merged visual — no `visible={false}` wrapper needed,
          and the accessory grandchildren render correctly. */}
      {(node.children ?? []).map((childId) => (
        <NodeRenderer key={childId} nodeId={childId} />
      ))}
    </group>
  )
}

export default RoofRenderer
