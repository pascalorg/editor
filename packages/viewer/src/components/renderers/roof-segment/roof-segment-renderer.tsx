import { type RoofSegmentNode, useRegistry } from '@pascal-app/core'
import { useRef } from 'react'
import type * as THREE from 'three'
import { useNodeEvents } from '../../../hooks/use-node-events'
import useViewer from '../../../store/use-viewer'
import { roofDebugMaterials, roofMaterials } from '../roof/roof-materials'

export const RoofSegmentRenderer = ({ node }: { node: RoofSegmentNode }) => {
  const ref = useRef<THREE.Mesh>(null!)

  useRegistry(node.id, 'roof-segment', ref)

  const handlers = useNodeEvents(node, 'roof-segment')
  const debugColors = useViewer((s) => s.debugColors)

  return (
    <mesh
      ref={ref}
      position={node.position}
      rotation-y={node.rotation}
      visible={node.visible}
      material={debugColors ? roofDebugMaterials : roofMaterials}
      {...handlers}
    >
      {/* RoofSystem will replace this geometry in the next frame */}
      <boxGeometry args={[0, 0, 0]} />
    </mesh>
  )
}
