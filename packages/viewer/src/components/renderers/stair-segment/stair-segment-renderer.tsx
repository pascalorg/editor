import {
  type AnyNodeId,
  type StairNode,
  type StairSegmentNode,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import useViewer from '../../../store/use-viewer'
import { getStraightStairSegmentBodyMaterials } from '../../../systems/stair/stair-materials'

export const StairSegmentRenderer = ({ node }: { node: StairSegmentNode }) => {
  const ref = useRef<THREE.Mesh>(null!)
  const nodes = useScene((state) => state.nodes)

  useRegistry(node.id, 'stair-segment', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'stair-segment')
  const parentNode = node.parentId
    ? (nodes[node.parentId as AnyNodeId] as StairNode | undefined)
    : undefined
  const materialPreview = useViewer((state) =>
    state.materialPreview?.target === 'stair' && state.materialPreview.nodeId === parentNode?.id
      ? state.materialPreview
      : null,
  )
  const previewParentNode = !parentNode
    ? undefined
    : materialPreview?.role === 'railing'
      ? {
          ...parentNode,
          railingMaterial: materialPreview.material,
          railingMaterialPreset: materialPreview.materialPreset,
          material: undefined,
          materialPreset: undefined,
        }
      : materialPreview?.role === 'tread'
        ? {
            ...parentNode,
            treadMaterial: materialPreview.material,
            treadMaterialPreset: materialPreview.materialPreset,
            material: undefined,
            materialPreset: undefined,
          }
        : materialPreview?.role === 'side'
          ? {
              ...parentNode,
              sideMaterial: materialPreview.material,
              sideMaterialPreset: materialPreview.materialPreset,
              material: undefined,
              materialPreset: undefined,
            }
          : parentNode

  const material = useMemo(() => {
    return getStraightStairSegmentBodyMaterials(node, previewParentNode)
  }, [node, previewParentNode])

  const placeholderGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
    geometry.addGroup(0, 0, 0)
    geometry.addGroup(0, 0, 1)
    return geometry
  }, [])

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
