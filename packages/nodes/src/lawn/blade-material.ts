import type { LawnNode } from '@pascal-app/core'
import { DoubleSide, type Material } from 'three'
import {
  attribute,
  cameraPosition,
  color,
  cos,
  Fn,
  float,
  instanceIndex,
  mix,
  modelWorldMatrix,
  positionGeometry,
  positionPrevious,
  sin,
  smoothstep,
  step,
  texture,
  time,
  transformNormalToView,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { MeshStandardNodeMaterial, type Node } from 'three/webgpu'
import { tuftTexture } from './turf-textures'

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
  const prefix = step(float(instanceIndex), midCount.sub(0.5))
  const nearFade = mix(smoothstep(1.6, 3.5, pixels), 1, prefix)
  return mix(midFade, nearFade, near)
}

export function lawnBladeMaterial(
  node: LawnNode,
  tuftWidthScale: number,
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0, side: DoubleSide })
  material.name = 'lawn-curved-blades'
  const root = attribute('lawnRootHeight', 'vec4')
  const traits = attribute('lawnTraits', 'vec4')
  const detail = detailWeight(root, material)
  const progress = positionGeometry.y
  const plane = positionGeometry.z
  const yaw = traits.x.add(plane.mul(1.83))
  const pick = traits.x.mul(2.37).add(plane.mul(0.47))
  const column = step(0.5, pick.fract())
  const row = step(pick.mul(1.71).fract(), float(node.roughness * node.roughness))
  const uv = varying(vec2(positionGeometry.x.add(0.5).add(column), progress.add(row)).mul(0.5))
  const leaf = texture(tuftTexture(material), uv)
  material.opacityNode = leaf.g
  material.maskShadowNode = leaf.g.greaterThan(0.32)
  material.alphaTest = 0.32
  const gust = sin(root.x.mul(0.19).add(root.z.mul(0.13)).add(time.mul(1.7)))
    .mul(0.65)
    .add(sin(root.x.mul(0.43).sub(root.z.mul(0.27)).add(time.mul(2.3))).mul(0.35))
  const wind = uniform(node.wind)
  const bendX = sin(yaw).mul(traits.y).mul(1.6).add(gust.mul(wind).mul(0.42))
  const bendZ = cos(yaw).mul(traits.y).mul(1.6).add(gust.mul(wind).mul(0.22))
  const bend = progress.mul(progress).mul(root.w).mul(detail)
  const width = positionGeometry.x.mul(traits.w).mul(tuftWidthScale).mul(detail)
  const placed = root.xyz.add(
    vec3(
      cos(yaw).mul(width).add(bendX.mul(bend)),
      progress
        .mul(root.w)
        .mul(detail)
        .mul(float(1).sub(plane.mul(0.11))),
      sin(yaw).negate().mul(width).add(bendZ.mul(bend)),
    ),
  )
  // A pass with a velocity attachment (the viewer's temporal anti-aliasing) reprojects each pixel
  // from `positionPrevious`, which three does not derive from `positionNode`: a blade reported the
  // lawn's origin, not its own place, as where it stood a frame ago. Every blade pixel then read
  // its history from somewhere else on screen and the lawn flickered with the camera still.
  material.positionNode = Fn((builder) => {
    const position = placed.toVar()
    // three's own test for a velocity attachment; @types/three 0.187 does not declare it.
    const temporal = (
      builder as typeof builder & { needsPreviousData(): boolean }
    ).needsPreviousData()
    if (temporal) positionPrevious.assign(position)
    return position
  })()
  // Each plane contains leaves facing both ways. A mostly upward canopy normal
  // avoids lighting the whole silhouette as one vertical sheet.
  material.normalNode = transformNormalToView(
    vec3(sin(yaw).mul(0.26), 1, cos(yaw).mul(0.26)).normalize(),
  )
  const ripe = row.mul(smoothstep(0.36, 1, progress)).mul(smoothstep(0.88, 1.14, traits.z))
  material.colorNode = color(node.color)
    .rgb.mul(mix(vec3(0.64, 0.81, 1.22), vec3(1.12, 0.98, 1.08), ripe))
    .mul(traits.z)
    .mul(leaf.r.mul(1.48).add(0.22))
  return material
}
