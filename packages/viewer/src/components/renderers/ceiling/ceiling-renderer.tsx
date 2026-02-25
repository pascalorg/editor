import { type CeilingNode, useRegistry } from '@pascal-app/core'
import { useRef } from 'react'
import { float, mix, positionWorld, smoothstep } from 'three/tsl'
import { BackSide, FrontSide, type Mesh, MeshBasicNodeMaterial } from 'three/webgpu'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { NodeRenderer } from '../node-renderer'

// TSL material that renders differently based on face direction:
// - Back face (looking up at ceiling from below): solid
// - Front face (looking down at ceiling from above): 30% opacity
const ceilingTopMaterial = new MeshBasicNodeMaterial({
  color: 0xb5a78d,
  transparent: true,
  depthWrite: false,
  side: FrontSide,
  // Disabled as we only show ceiling grid when needed
  // alphaTestNode: float(0.4), // Discard pixels with alpha below 0.4 to create grid lines and not affect depth buffer
})

const ceilingBottomMaterial = new MeshBasicNodeMaterial({
  color: 0x999999,
  transparent: true,
  side: BackSide,
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

// Grid lines at 0.6 opacity, spaces at 0.2 opacity
const gridOpacity = mix(float(0.2), float(0.6), gridPattern)

// faceDirection is 1.0 for front face, -1.0 for back face
// Front face (top, looking down): grid pattern, Back face (bottom, looking up): solid
ceilingTopMaterial.opacityNode = gridOpacity

export const CeilingRenderer = ({ node }: { node: CeilingNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'ceiling', ref)
  const handlers = useNodeEvents(node, 'ceiling')

  return (
    <mesh ref={ref} material={ceilingBottomMaterial}>
      {/* CeilingSystem will replace this geometry in the next frame */}
      <boxGeometry args={[0, 0, 0]} />
      <mesh name="ceiling-grid" material={ceilingTopMaterial} {...handlers} visible={false} scale={0}>
        <boxGeometry args={[0, 0, 0]} />
      </mesh>
      {node.children.map((childId) => (
        <NodeRenderer key={childId} nodeId={childId} />
      ))}
    </mesh>
  )
}
