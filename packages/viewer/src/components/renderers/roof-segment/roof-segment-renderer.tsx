import {
  type AnyNodeId,
  type RoofNode,
  type RoofSegmentNode,
  useRegistry,
  useScene,
} from '@pascal-app/core'
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
  const parentNode = node.parentId
    ? (nodes[node.parentId as AnyNodeId] as RoofNode | undefined)
    : undefined
  const materialPreview = useViewer((state) =>
    state.materialPreview?.target === 'roof' && state.materialPreview.nodeId === parentNode?.id
      ? state.materialPreview
      : null,
  )
  const placeholderGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
    geometry.addGroup(0, 0, 0)
    geometry.addGroup(0, 0, 1)
    geometry.addGroup(0, 0, 2)
    geometry.addGroup(0, 0, 3)
    return geometry
  }, [])

  const previewParentNode = !parentNode
    ? undefined
    : materialPreview?.role === 'top'
      ? {
          ...parentNode,
          topMaterial: materialPreview.material,
          topMaterialPreset: materialPreview.materialPreset,
          material: undefined,
          materialPreset: undefined,
        }
      : materialPreview?.role === 'edge'
        ? {
            ...parentNode,
            edgeMaterial: materialPreview.material,
            edgeMaterialPreset: materialPreview.materialPreset,
            material: undefined,
            materialPreset: undefined,
          }
        : materialPreview?.role === 'wall'
          ? {
              ...parentNode,
              wallMaterial: materialPreview.material,
              wallMaterialPreset: materialPreview.materialPreset,
              material: undefined,
              materialPreset: undefined,
            }
          : parentNode
  const customMaterial = useMemo(() => {
    if (node.material !== undefined || typeof node.materialPreset === 'string') {
      return null
    }

    return previewParentNode ? getRoofMaterialArray(previewParentNode) : null
  }, [node, previewParentNode])

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
