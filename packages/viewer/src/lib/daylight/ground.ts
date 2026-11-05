import {
  cameraPosition,
  clamp,
  color,
  exp2,
  floor,
  fract,
  fwidth,
  max,
  mix,
  output,
  positionWorld,
  sin,
  smoothstep,
  vec2,
  vec4,
} from 'three/tsl'
import { MeshLambertNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'

/** Neutral ground of the colored appearance, and the slightly fresher parcel inside the site. */
export const DAYLIGHT_GROUND = '#a1a1a1'
export const DAYLIGHT_PARCEL = '#afaeaa'
/** View-ray slope below the horizon (≈ 2.5°) where the ground starts hazing into the sky. */
const HORIZON_HAZE = 0.045

/**
 * The ground around the parcel: faint squares that stay a few pixels wide at every distance (a
 * mip-like ladder of square sizes, so no shimmer towards the horizon) over long diagonal bands.
 * World-anchored; the horizon blend comes from the atmosphere's fog.
 */
export function daylightGroundColor(base: any = color(DAYLIGHT_GROUND)): any {
  const p = positionWorld.xz
  const texel = max(fwidth(p.x), fwidth(p.y))
  const lod = clamp(texel.mul(1.7).mul(4).max(1e-6).log2(), 0, 8)
  const l0 = lod.floor()
  const squares = (level: any) => {
    const scale = vec2(1.7).div(exp2(level))
    // fract(sin) hash: three's `hash` casts to uint, which collapses every negative cell to one value.
    const cell = floor(p.mul(scale)).add(vec2(level.mul(37), level.mul(11)))
    return fract(sin(cell.dot(vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5)
  }
  const noise = mix(squares(l0), squares(l0.add(1)), lod.sub(l0)).mul(0.06)
  const bands = sin(p.x.mul(0.31).add(p.y.mul(0.17))).mul(0.02)
  return base.mul(noise.add(bands).add(1))
}

/**
 * A matte daylight ground material: Standard (lit by the sky environment) in rendered shading,
 * Lambert in solid shading, where every surface is Lambert and the sky comes as a hemisphere light.
 * With `horizon` (the atmosphere's fog radiance), the ground also hazes into it within a few
 * degrees of the horizon: distance fog alone packs into a hard line when the camera is low.
 */
export function createDaylightGroundMaterial(
  solid: boolean,
  options: { color?: string; horizon?: (direction: any) => any } = {},
): MeshLambertNodeMaterial | MeshStandardNodeMaterial {
  const material = solid
    ? new MeshLambertNodeMaterial()
    : new MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 })
  if (options.color) material.color.set(options.color)
  else material.colorNode = daylightGroundColor()
  if (options.horizon) {
    const direction = positionWorld.sub(cameraPosition).normalize()
    const haze = smoothstep(HORIZON_HAZE, 0.002, direction.y.negate())
    material.outputNode = vec4(mix(output.rgb, options.horizon(direction), haze), output.a)
  }
  return material
}
