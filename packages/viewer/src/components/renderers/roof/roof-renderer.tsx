import { type RoofNode, useRegistry } from '@pascal-app/core'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import useViewer from '../../../store/use-viewer'
import { getRoofMaterialArray } from '../../../systems/roof/roof-materials'
import { NodeRenderer } from '../node-renderer'
import { roofDebugMaterials, roofMaterials } from './roof-materials'

export const RoofRenderer = ({ node }: { node: RoofNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'roof', ref)

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
      <group name="segments-wrapper" visible={false}>
        {(node.children ?? []).map((childId) => (
          <NodeRenderer key={childId} nodeId={childId} />
        ))}
      </group>
    </group>
  )
}
