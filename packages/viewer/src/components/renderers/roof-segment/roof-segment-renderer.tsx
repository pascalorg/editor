import { type RoofSegmentNode, useRegistry } from '@pascal-app/core'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'

export const RoofSegmentRenderer = ({ node }: { node: RoofSegmentNode }) => {
  const ref = useRef<THREE.Mesh>(null!)

  useRegistry(node.id, 'roof-segment', ref)

  const handlers = useNodeEvents(node, 'roof-segment')

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
    <mesh
      ref={ref}
      castShadow
      receiveShadow
      position={node.position}
      rotation-y={node.rotation}
      visible={node.visible}
      material={materials}
      {...handlers}
    >
      {/* RoofSystem will replace this geometry in the next frame */}
      <boxGeometry args={[0, 0, 0]} />
    </mesh>
  )
}
