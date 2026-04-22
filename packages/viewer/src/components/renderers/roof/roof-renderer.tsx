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
  const materialPreview = useViewer((state) =>
    state.materialPreview?.target === 'roof' && state.materialPreview.nodeId === node.id
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

  const previewNode =
    materialPreview?.role === 'top'
      ? {
          ...node,
          topMaterial: materialPreview.material,
          topMaterialPreset: materialPreview.materialPreset,
          material: undefined,
          materialPreset: undefined,
        }
      : materialPreview?.role === 'edge'
        ? {
            ...node,
            edgeMaterial: materialPreview.material,
            edgeMaterialPreset: materialPreview.materialPreset,
            material: undefined,
            materialPreset: undefined,
          }
        : materialPreview?.role === 'wall'
          ? {
              ...node,
              wallMaterial: materialPreview.material,
              wallMaterialPreset: materialPreview.materialPreset,
              material: undefined,
              materialPreset: undefined,
            }
          : node
  const customMaterial = useMemo(() => getRoofMaterialArray(previewNode), [previewNode])

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
