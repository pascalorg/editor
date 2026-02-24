import { type CeilingNode, useRegistry } from '@pascal-app/core'
import { useRef } from 'react'
import { faceDirection, float, mix, positionWorld, smoothstep, step } from 'three/tsl'
import { DoubleSide, type Mesh, MeshBasicNodeMaterial } from 'three/webgpu'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { NodeRenderer } from '../node-renderer'

// TSL material that renders differently based on face direction:
// - Back face (looking up at ceiling from below): solid
// - Front face (looking down at ceiling from above): 30% opacity
const ceilingMaterial = new MeshBasicNodeMaterial({
  color: 0x999999,
  transparent: true,
  depthWrite: false,
  side: DoubleSide,
  alphaTestNode: float(0.4),
})

// Create grid pattern based on local position
const gridScale = 5 // Grid cells per meter (1 = 1m grid)
const gridX = positionWorld.x.mul(gridScale).fract()
const gridY = positionWorld.z.mul(gridScale).fract()

// Create grid lines - they are at 0 and 1
const lineWidth = 0.05 // Width of grid lines (0-1 range within cell)

// Create visible lines at edges (near 0 and near 1)
const lineX = smoothstep(lineWidth, 0, gridX).add(smoothstep(1.0 - lineWidth, 1.0, gridX))
const lineY = smoothstep(lineWidth, 0, gridY).add(smoothstep(1.0 - lineWidth, 1.0, gridY))

// Combine: if either X or Y is a line, show the line
const gridPattern = lineX.max(lineY)

// Grid lines at 0.5 opacity, spaces at 0 opacity
const gridOpacity = mix(float(0.0), float(0.5), gridPattern)

// faceDirection is 1.0 for front face, -1.0 for back face
// Front face (top, looking down): grid pattern, Back face (bottom, looking up): solid
ceilingMaterial.opacityNode = mix(float(1.0), gridOpacity, step(float(0.0), float(faceDirection)))

export const CeilingRenderer = ({ node }: { node: CeilingNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'ceiling', ref)
  const handlers = useNodeEvents(node, 'ceiling')

  return (
    <mesh ref={ref} material={ceilingMaterial} {...handlers}>
      {/* CeilingSystem will replace this geometry in the next frame */}
      <boxGeometry args={[0, 0, 0]} />
      {node.children.map((childId) => (
        <NodeRenderer key={childId} nodeId={childId} />
      ))}
    </mesh>
  )
}
