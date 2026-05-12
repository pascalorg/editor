import {
  type CeilingNode,
  getMaterialPresetByRef,
  resolveMaterial,
  useRegistry,
} from '@pascal-app/core'
import { useEffect, useMemo, useRef } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { float, mix, positionWorld, smoothstep } from 'three/tsl'
import { BackSide, FrontSide, type Mesh, MeshBasicNodeMaterial } from 'three/webgpu'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { NodeRenderer } from '../node-renderer'

function createEmptyGeometry() {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([], 3))
  return geometry
}

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

const ceilingMaterialCache = new Map<string, ReturnType<typeof createCeilingMaterials>>()

function getCeilingMaterials(color = '#999999') {
  const cacheKey = color
  const cached = ceilingMaterialCache.get(cacheKey)
  if (cached) return cached

  const materials = createCeilingMaterials(color)
  ceilingMaterialCache.set(cacheKey, materials)
  return materials
}

export const CeilingRenderer = ({ node }: { node: CeilingNode }) => {
  const ref = useRef<Mesh>(null!)
  const placeholderGeometry = useMemo(createEmptyGeometry, [])
  const gridPlaceholderGeometry = useMemo(createEmptyGeometry, [])

  useRegistry(node.id, 'ceiling', ref)
  const handlers = useNodeEvents(node, 'ceiling')

  useEffect(
    () => () => {
      placeholderGeometry.dispose()
      gridPlaceholderGeometry.dispose()
    },
    [gridPlaceholderGeometry, placeholderGeometry],
  )

  const materials = useMemo(() => {
    const preset = getMaterialPresetByRef(node.materialPreset)
    const props = preset?.mapProperties ?? resolveMaterial(node.material)
    const color = props.color || '#999999'
    return getCeilingMaterials(color)
  }, [
    node.materialPreset,
    node.material,
    node.material?.preset,
    node.material?.properties,
    node.material?.texture,
  ])

  return (
    <mesh geometry={placeholderGeometry} material={materials.bottomMaterial} ref={ref}>
      <mesh
        geometry={gridPlaceholderGeometry}
        material={materials.topMaterial}
        name="ceiling-grid"
        {...handlers}
        scale={0}
        visible={false}
      />
      {node.children.map((childId) => (
        <NodeRenderer key={childId} nodeId={childId} />
      ))}
    </mesh>
  )
}
