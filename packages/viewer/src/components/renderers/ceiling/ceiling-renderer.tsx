import { type CeilingNode, resolveMaterial, useRegistry } from '@pascal-app/core'
import { useMemo, useRef } from 'react'
import { float, mix, positionWorld, smoothstep } from 'three/tsl'
import { BackSide, FrontSide, type Mesh, MeshBasicNodeMaterial } from 'three/webgpu'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { NodeRenderer } from '../node-renderer'

const gridScale = 5
const gridX = positionWorld.x.mul(gridScale).fract()
const gridY = positionWorld.z.mul(gridScale).fract()
const lineWidth = 0.05
const lineX = smoothstep(lineWidth, 0, gridX).add(smoothstep(1.0 - lineWidth, 1.0, gridX))
const lineY = smoothstep(lineWidth, 0, gridY).add(smoothstep(1.0 - lineWidth, 1.0, gridY))
const gridPattern = lineX.max(lineY)
const gridOpacity = mix(float(0.2), float(0.6), gridPattern)

function createCeilingMaterials(color = '#999999') {
  const topMaterial = new MeshBasicNodeMaterial({
    color,
    transparent: true,
    depthWrite: false,
    side: FrontSide,
  })
  topMaterial.opacityNode = gridOpacity

  const bottomMaterial = new MeshBasicNodeMaterial({
    color,
    transparent: true,
    side: BackSide,
  })

  return { topMaterial, bottomMaterial }
}

export const CeilingRenderer = ({ node }: { node: CeilingNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'ceiling', ref)
  const handlers = useNodeEvents(node, 'ceiling')

  const materials = useMemo(() => {
    const props = resolveMaterial(node.material)
    const color = props.color || '#999999'
    return createCeilingMaterials(color)
  }, [node.material, node.material?.preset, node.material?.properties, node.material?.texture])

  return (
    <mesh material={materials.bottomMaterial} ref={ref}>
      <boxGeometry args={[0, 0, 0]} />
      <mesh
        material={materials.topMaterial}
        name="ceiling-grid"
        {...handlers}
        scale={0}
        visible={false}
      >
        <boxGeometry args={[0, 0, 0]} />
      </mesh>
      {node.children.map((childId) => (
        <NodeRenderer key={childId} nodeId={childId} />
      ))}
    </mesh>
  )
}
