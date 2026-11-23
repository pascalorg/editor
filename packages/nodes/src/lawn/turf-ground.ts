import type { LawnNode } from '@pascal-app/core'
import { DoubleSide } from 'three'
import { attribute, Fn, float, If, mix, positionLocal, texture, uniform, vec2 } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { swardTexture } from './turf-textures'

export function lawnGroundMaterial(node: LawnNode, painted: boolean) {
  const material = new MeshStandardNodeMaterial({
    vertexColors: true,
    roughness: 0.98,
    side: DoubleSide,
  })
  material.name = 'lawn-sward'
  const detailed = uniform(1)
  const map = swardTexture(material)
  const p = positionLocal.xz
  const phase = (node.seed % 113) / 113
  material.colorNode = Fn(() => {
    const shade = float(1).toVar()
    If(detailed.greaterThan(0), () => {
      const close = texture(map, p.mul(1.28).add(phase)).r
      const crossing = texture(map, vec2(p.y, p.x.negate()).mul(0.72).sub(phase)).r
      const grain = close.mul(1.75).add(crossing.mul(0.55)).add(0.04)
      shade.assign(painted ? mix(1, grain, attribute('lawnCover', 'float')) : grain)
    })
    return shade
  })()
  return { material, detailed }
}
