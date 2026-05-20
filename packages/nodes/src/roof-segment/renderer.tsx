'use client'

import {
  type AnyNodeId,
  type RoofNode,
  type RoofSegmentNode,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { getRoofMaterialArray, NodeRenderer, useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
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
  }, [node, parentNode])

  const material = debugColors ? roofDebugMaterials : customMaterial || roofMaterials

  useEffect(() => {
    return () => {
      placeholderGeometry.dispose()
    }
  }, [placeholderGeometry])

  // The mesh holds the segment's transform (registered via useRegistry,
  // consumed by accessory renderers' `sceneRegistry.nodes.get(seg.id)`
  // calls for click-to-local math). Wrapping the mesh in a group at
  // the same transform would also work, but keeping the transform on
  // the mesh preserves the existing world-matrix semantics for every
  // accessory that already does `segObj.worldToLocal(...)`.
  //
  // The recursive children mount sits *outside* the mesh but inside
  // the same JSX subtree — three.js still parents them under the
  // segment's transform via React-fiber → three.js tree mapping. The
  // segment's placeholder geometry is empty (`RoofSystem` only fills
  // the parent roof's `merged-roof` mesh), so it doesn't z-fight with
  // the visible roof above.
  return (
    <>
      <mesh
        geometry={placeholderGeometry}
        material={material}
        position={node.position}
        ref={ref}
        rotation-y={node.rotation}
        visible={node.visible}
        {...handlers}
      />
      <group position={node.position} rotation-y={node.rotation} visible={node.visible}>
        {(node.children ?? []).map((childId) => (
          <NodeRenderer key={childId} nodeId={childId as AnyNodeId} />
        ))}
      </group>
    </>
  )
}

export default RoofSegmentRenderer
