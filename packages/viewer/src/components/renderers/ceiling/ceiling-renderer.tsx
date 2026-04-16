import {
  type CeilingNode,
  getMaterialPresetByRef,
  resolveMaterial,
  useRegistry,
} from '@pascal-app/core'
import { useMemo, useRef } from 'react'
import { Color } from 'three'
import { attribute, color, float, mix, positionWorld, smoothstep, vec3 } from 'three/tsl'
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

function createCeilingMaterials(baseColor = '#999999') {
  // `MeshBasicNodeMaterial` is TSL-based and doesn't honour the
  // legacy `vertexColors: true` flag the way classic Material does.
  // To actually sample the `color` vertex attribute, the colorNode
  // has to be wired explicitly via TSL: `color(base) * attribute('color')`.
  // The ceiling system fills this attribute white for the flat main
  // and region planes and darker (0.62) for vertical skirt vertices,
  // so tray/soffit regions read as shaded even under this unlit
  // shader — without the multiplication, the skirt sides of a tray
  // ceiling blend into the flat main plane and there's no visual
  // cue that the ceiling has a recessed region.
  // TSL's `color()` returns `ConstNode<"color">` which doesn't expose
  // `.mul()` against a vec3 directly at the type level. Wrap both
  // operands in `vec3()` so the multiply picks the numeric overload
  // and TypeScript is happy — semantically equivalent at runtime
  // because "color" and "vec3" are interchangeable in the shader.
  const baseColorNode = vec3(color(new Color(baseColor)))
  const vertexTint = vec3(attribute('color'))
  const shadedColor = baseColorNode.mul(vertexTint)

  const topMaterial = new MeshBasicNodeMaterial({
    color: baseColor,
    transparent: true,
    depthWrite: false,
    side: FrontSide,
  })
  topMaterial.colorNode = shadedColor
  topMaterial.opacityNode = gridOpacity

  const bottomMaterial = new MeshBasicNodeMaterial({
    color: baseColor,
    transparent: true,
    side: BackSide,
  })
  bottomMaterial.colorNode = shadedColor

  return { topMaterial, bottomMaterial }
}

export const CeilingRenderer = ({ node }: { node: CeilingNode }) => {
  const ref = useRef<Mesh>(null!)

  useRegistry(node.id, 'ceiling', ref)
  const handlers = useNodeEvents(node, 'ceiling')

  const materials = useMemo(() => {
    const preset = getMaterialPresetByRef(node.materialPreset)
    const props = preset?.mapProperties ?? resolveMaterial(node.material)
    const color = props.color || '#999999'
    return createCeilingMaterials(color)
  }, [
    node.materialPreset,
    node.material,
    node.material?.preset,
    node.material?.properties,
    node.material?.texture,
  ])

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
