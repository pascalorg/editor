import type { LawnNode } from '@pascal-app/core'
import { DoubleSide, type Material } from 'three'
import {
  attribute,
  cameraPosition,
  color,
  cos,
  instanceIndex,
  mix,
  modelWorldMatrix,
  positionGeometry,
  sin,
  smoothstep,
  step,
  time,
  transformNormalToView,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'
import { MeshStandardNodeMaterial, type Node } from 'three/webgpu'

type LawnBladeControls = {
  near: { value: number }
  midCount: { value: number }
  projectionScale: { value: number }
  perspective: { value: number }
}
const controls = new WeakMap<Material, LawnBladeControls>()

export function setLawnBladeDraw(material: Material, near: boolean, midCount: number) {
  const values = controls.get(material)
  if (!values) return
  values.near.value = near ? 1 : 0
  values.midCount.value = midCount
}

export function setLawnBladeView(
  material: Material,
  projectionScale: number,
  perspective: boolean,
) {
  const values = controls.get(material)
  if (!values) return
  values.projectionScale.value = projectionScale
  values.perspective.value = perspective ? 1 : 0
}

function detailWeight(root: Node<'vec4'>, material: Material) {
  const near = uniform(1),
    midCount = uniform(0),
    projectionScale = uniform(900),
    perspective = uniform(1)
  controls.set(material, { near, midCount, projectionScale, perspective })
  const worldRoot = modelWorldMatrix.mul(vec4(root.xyz, 1)).xyz
  const distance = worldRoot.sub(cameraPosition).length().max(0.1)
  const pixels = root.w.mul(projectionScale).div(mix(1, distance, perspective))
  const midFade = smoothstep(0.25, 0.8, pixels)
  const prefix = step(instanceIndex, midCount.sub(0.5))
  const nearFade = mix(smoothstep(1.6, 3.5, pixels), 1, prefix)
  return mix(midFade, nearFade, near)
}

export function lawnBladeMaterial(node: LawnNode): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0, side: DoubleSide })
  material.name = 'lawn-curved-blades'
  const root = attribute('lawnRootHeight', 'vec4')
  const traits = attribute('lawnTraits', 'vec4')
  const detail = detailWeight(root, material)
  const progress = positionGeometry.y
  const yaw = traits.x
  const gust = sin(root.x.mul(0.19).add(root.z.mul(0.13)).add(time.mul(1.7)))
    .mul(0.65)
    .add(sin(root.x.mul(0.43).sub(root.z.mul(0.27)).add(time.mul(2.3))).mul(0.35))
  const wind = uniform(node.wind)
  const bendX = sin(yaw).mul(traits.y).mul(1.6).add(gust.mul(wind).mul(0.42))
  const bendZ = cos(yaw).mul(traits.y).mul(1.6).add(gust.mul(wind).mul(0.22))
  const bend = progress.mul(progress).mul(root.w).mul(detail)
  const width = positionGeometry.x.mul(traits.w).mul(detail)
  material.positionNode = root.xyz.add(
    vec3(
      cos(yaw).mul(width).add(bendX.mul(bend)),
      progress.mul(root.w).mul(detail),
      sin(yaw).negate().mul(width).add(bendZ.mul(bend)),
    ),
  )
  const slope = progress.mul(2)
  const normal = vec3(
    sin(yaw),
    bendX
      .mul(sin(yaw))
      .add(bendZ.mul(cos(yaw)))
      .mul(slope)
      .negate(),
    cos(yaw),
  ).normalize()
  // Thin leaves scatter sky light; the upward bias avoids black vertical cards in noon light.
  material.normalNode = transformNormalToView(normal.add(vec3(0, 1.25, 0)).normalize())
  material.colorNode = color(node.color)
    .mul(traits.z)
    .mul(mix(0.86, 1.16, progress))
  return material
}
