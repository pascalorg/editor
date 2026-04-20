import { type AnyNodeId, type RoofNode, type RoofSegmentNode, useRegistry, useScene } from '@pascal-app/core'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import useViewer from '../../../store/use-viewer'
import { getRoofMaterialArray } from '../../../systems/roof/roof-materials'
import { roofDebugMaterials, roofMaterials } from '../roof/roof-materials'

export const RoofSegmentRenderer = ({ node }: { node: RoofSegmentNode }) => {
  const ref = useRef<THREE.Mesh>(null!)
  const nodes = useScene((state) => state.nodes)

  useRegistry(node.id, 'roof-segment', ref)

  const handlers = useNodeEvents(node, 'roof-segment')
  const debugColors = useViewer((s) => s.debugColors)
  const parentNode =
    node.parentId ? (nodes[node.parentId as AnyNodeId] as RoofNode | undefined) : undefined
  const placeholderGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
    geometry.addGroup(0, 0, 0)
    geometry.addGroup(0, 0, 1)
    geometry.addGroup(0, 0, 2)
    geometry.addGroup(0, 0, 3)
    return geometry
  }, [])

  const customMaterial = useMemo(() => {
    if (node.material !== undefined || typeof node.materialPreset === 'string') {
      return null
    }

    return parentNode ? getRoofMaterialArray(parentNode) : null
  }, [
    node.materialPreset,
    node.material,
    node.material?.preset,
    node.material?.properties,
    node.material?.texture,
    parentNode?.materialPreset,
    parentNode?.material,
    parentNode?.material?.preset,
    parentNode?.material?.properties,
    parentNode?.material?.texture,
    parentNode?.topMaterial,
    parentNode?.topMaterialPreset,
    parentNode?.edgeMaterial,
    parentNode?.edgeMaterialPreset,
    parentNode?.wallMaterial,
    parentNode?.wallMaterialPreset,
  ])

  const material = debugColors ? roofDebugMaterials : customMaterial || roofMaterials

  useEffect(() => {
    return () => {
      placeholderGeometry.dispose()
    }
  }, [placeholderGeometry])

  return (
    <mesh
      geometry={placeholderGeometry}
      material={material}
      position={node.position}
      ref={ref}
      rotation-y={node.rotation}
      visible={node.visible}
      {...handlers}
    />
  )
}
