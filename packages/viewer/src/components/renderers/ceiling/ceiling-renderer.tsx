import { type CeilingNode, useRegistry } from '@pascal-app/core'
import { useRef } from 'react'
import { faceDirection, float, mix } from 'three/tsl'
import { DoubleSide, type Mesh, MeshStandardNodeMaterial } from 'three/webgpu'
import { useNodeEvents } from '../../../hooks/use-node-events'

// TSL material that renders differently based on face direction:
// - Back face (looking up at ceiling from below): solid
// - Front face (looking down at ceiling from above): 30% opacity
const ceilingMaterial = new MeshStandardNodeMaterial({
  color: 0xffffff,
  side: DoubleSide,
  transparent: true,
})

// faceDirection is 1.0 for front face, -1.0 for back face
// We want: front face (top, looking down) = 0.3 opacity, back face (bottom, looking up) = 1.0 opacity
ceilingMaterial.opacityNode = mix(float(1.0), float(0.3), faceDirection.greaterThan(0.0))

export const CeilingRenderer = ({ node }: { node: CeilingNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'ceiling', ref)
  const handlers = useNodeEvents(node, 'ceiling')

  return (
    <mesh ref={ref} material={ceilingMaterial} {...handlers}>
      {/* CeilingSystem will replace this geometry in the next frame */}
      <boxGeometry args={[0, 0, 0]} />
    </mesh>
  )
}
