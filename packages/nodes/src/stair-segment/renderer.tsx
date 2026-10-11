'use client'

import {
  type AnyNodeId,
  type StairNode,
  type StairSegmentNode,
  stairSegmentConstructionError,
  stairSegmentDetailError,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { getStairBodyMaterials, useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type * as THREE from 'three'
import { createPlaceholderGeometry } from '../shared/placeholder-geometry'
import { resolveStairBodySlotMaterials, resolveStairSegmentMaterials } from '../stair/materials'

export const StairSegmentRenderer = ({ node }: { node: StairSegmentNode }) => {
  const ref = useRef<THREE.Mesh>(null!)
  const nodes = useScene((state) => state.nodes)

  useRegistry(node.id, 'stair-segment', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'stair-segment')
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset = useViewer((s) => s.colorPreset)
  const parent = node.parentId
    ? (nodes[node.parentId as AnyNodeId] as StairNode | undefined)
    : undefined
  const parentNode = parent?.type === 'stair' ? parent : undefined

  const sceneMaterials = useScene((state) => state.materials)
  const material = useMemo(() => {
    const parentMaterials =
      parentNode?.type === 'stair'
        ? resolveStairBodySlotMaterials(
            parentNode,
            getStairBodyMaterials(parentNode, shading, textures, colorPreset),
            sceneMaterials,
            shading,
            textures,
          )
        : undefined
    return resolveStairSegmentMaterials(
      node,
      parentNode,
      parentMaterials,
      sceneMaterials,
      shading,
      textures,
      colorPreset,
    )
  }, [node, parentNode, sceneMaterials, shading, textures, colorPreset])

  // 2 groups map 1:1 to the stair segment's 2-material array (body + tread).
  const placeholderGeometry = useMemo(() => createPlaceholderGeometry(2), [])

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
      userData={{
        slotIds: ['treads', 'body'],
        segmentIds: [node.id, node.id],
        pascalExportRefusal:
          stairSegmentDetailError(node) ?? stairSegmentConstructionError(node, parentNode),
      }}
      {...handlers}
    />
  )
}

export default StairSegmentRenderer
