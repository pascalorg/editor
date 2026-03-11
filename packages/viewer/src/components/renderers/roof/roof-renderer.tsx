import { useScene, type RoofNode, useRegistry } from '@pascal-app/core'
import { useEffect, useRef } from 'react'
import type * as THREE from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import useViewer from '../../../store/use-viewer'
import { NodeRenderer } from '../node-renderer'
import { roofMaterials } from './roof-materials'

export const RoofRenderer = ({ node }: { node: RoofNode }) => {
  const ref = useRef<THREE.Group>(null!)
  const mergedMeshRef = useRef<THREE.Mesh>(null!)

  useRegistry(node.id, 'roof', ref)

  const handlers = useNodeEvents(node, 'roof')

  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const isSelected = selectedIds.includes(node.id) || node.children?.some((childId) => selectedIds.includes(childId))

  useEffect(() => {
    if (!isSelected || !node.children?.length) return

    // Segment meshes stay mounted behind the merged roof; when we reveal them for editing,
    // force a rebuild so we do not show the initial zero-sized placeholder geometry.
    const { markDirty } = useScene.getState()
    for (const childId of node.children) {
      markDirty(childId)
    }
  }, [isSelected, node.children])

  return (
    <group
      ref={ref}
      position={node.position}
      rotation-y={node.rotation}
      visible={node.visible}
      {...handlers}
    >
      <mesh
        name="merged-roof"
        ref={mergedMeshRef}
        visible={!isSelected}
        material={roofMaterials}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[0, 0, 0]} />
      </mesh>
      <group visible={isSelected}>
        {(node.children ?? []).map((childId) => (
          <NodeRenderer key={childId} nodeId={childId} />
        ))}
      </group>
    </group>
  )
}
