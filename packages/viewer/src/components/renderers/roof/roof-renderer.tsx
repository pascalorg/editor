import { type RoofNode, useRegistry } from '@pascal-app/core'
import { useRef } from 'react'
import type * as THREE from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import useViewer from '../../../store/use-viewer'
import { NodeRenderer } from '../node-renderer'
import { roofDebugMaterials, roofMaterials } from './roof-materials'

export const RoofRenderer = ({ node }: { node: RoofNode }) => {
  const ref = useRef<THREE.Group>(null!)

  useRegistry(node.id, 'roof', ref)

  const handlers = useNodeEvents(node, 'roof')
  const debugColors = useViewer((s) => s.debugColors)

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
        material={debugColors ? roofDebugMaterials : roofMaterials}
        name="merged-roof"
        receiveShadow
      >
        <boxGeometry args={[0, 0, 0]} />
      </mesh>
      <group name="segments-wrapper" visible={false}>
        {(node.children ?? []).map((childId) => (
          <NodeRenderer key={childId} nodeId={childId} />
        ))}
      </group>
    </group>
  )
}
