import { type RoofNode, useRegistry } from '@pascal-app/core'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import useViewer from '../../../store/use-viewer'
import { NodeRenderer } from '../node-renderer'

export const RoofRenderer = ({ node }: { node: RoofNode }) => {
  const ref = useRef<THREE.Group>(null!)
  const mergedMeshRef = useRef<THREE.Mesh>(null!)

  useRegistry(node.id, 'roof', ref)

  const handlers = useNodeEvents(node, 'roof')

  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const isSelected = selectedIds.includes(node.id) || node.children.some((childId) => selectedIds.includes(childId))

  const materials = useMemo(
    () => [
      new THREE.MeshStandardMaterial({ color: '#eaeaea', roughness: 0.8, side: THREE.DoubleSide }), // 0: Wall
      new THREE.MeshStandardMaterial({ color: '#000000', roughness: 0.9, side: THREE.FrontSide }), // 1: Deck
      new THREE.MeshStandardMaterial({ color: '#dddddd', roughness: 0.9, side: THREE.DoubleSide }), // 2: Interior
      new THREE.MeshStandardMaterial({ color: '#4ade80', roughness: 0.9, side: THREE.FrontSide }), // 3: Shingle
    ],
    [],
  )

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
        material={materials}
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
