import { type AnyNodeId, type RoofNode, type RoofSegmentNode, useRegistry, useScene } from '@pascal-app/core'
import { useMemo, useRef } from 'react'
import type * as THREE from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { createMaterial, createMaterialFromPresetRef } from '../../../lib/materials'
import useViewer from '../../../store/use-viewer'
import { roofDebugMaterials, roofMaterials } from '../roof/roof-materials'

export const RoofSegmentRenderer = ({ node }: { node: RoofSegmentNode }) => {
  const ref = useRef<THREE.Mesh>(null!)
  const nodes = useScene((state) => state.nodes)

  useRegistry(node.id, 'roof-segment', ref)

  const handlers = useNodeEvents(node, 'roof-segment')
  const debugColors = useViewer((s) => s.debugColors)
  const parentNode =
    node.parentId ? (nodes[node.parentId as AnyNodeId] as RoofNode | undefined) : undefined

  const customMaterial = useMemo(() => {
    const effectiveMaterialPreset = node.materialPreset ?? parentNode?.materialPreset
    const effectiveMaterial = node.material ?? parentNode?.material

    const presetMaterial = createMaterialFromPresetRef(effectiveMaterialPreset)
    if (presetMaterial) return presetMaterial
    const mat = effectiveMaterial
    if (!mat) return null
    return createMaterial(mat)
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
  ])

  const material = debugColors ? roofDebugMaterials : customMaterial || roofMaterials

  return (
    <mesh
      material={material}
      position={node.position}
      ref={ref}
      rotation-y={node.rotation}
      visible={node.visible}
      {...handlers}
    >
      {/* RoofSystem will replace this geometry in the next frame */}
      <boxGeometry args={[0, 0, 0]} />
    </mesh>
  )
}
