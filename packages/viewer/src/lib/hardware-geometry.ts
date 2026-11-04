import {
  type BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  LatheGeometry,
  Vector2,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

const cache = new Map<string, BufferGeometry>()
const mm = (value: number) => Math.round(value * 1000)

function cached(name: string, dimensions: number[], build: (...sizes: number[]) => BufferGeometry) {
  const sizes = dimensions.map(mm)
  const key = `${name}:${sizes.join(':')}`
  let geometry = cache.get(key)
  if (!geometry) {
    geometry = build(...sizes.map((size) => size / 1000))
    geometry.userData.shared = true
    cache.set(key, geometry)
  }
  return geometry
}

function scaleUVs(geometry: BufferGeometry, u: number, v: number) {
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v)
}

function lathe(profile: [number, number][], segments: number) {
  const geometry = new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segments,
  )
  const radius = Math.max(...profile.map(([r]) => r))
  const heights = profile.map(([, y]) => y)
  scaleUVs(geometry, 2 * Math.PI * radius, Math.max(...heights) - Math.min(...heights))
  return geometry
}

function cylinder(radius: number, length: number, segments: number) {
  const geometry = new CylinderGeometry(radius, radius, length, segments)
  const uv = geometry.getAttribute('uv')
  const position = geometry.getAttribute('position')
  const sideVertices = (segments + 1) * 2
  for (let i = 0; i < uv.count; i++) {
    if (i < sideVertices) {
      uv.setXY(i, uv.getX(i) * 2 * Math.PI * radius, uv.getY(i) * length)
    } else {
      uv.setXY(i, position.getX(i), position.getZ(i))
    }
  }
  return geometry
}

function merge(parts: BufferGeometry[]) {
  const geometry = mergeGeometries(parts)!
  for (const part of parts) part.dispose()
  return geometry
}

function rose(radius: number, depth: number, segments: number) {
  return lathe(
    [
      [0, 0],
      [radius, 0],
      [radius, depth - 0.002],
      [radius - 0.002, depth],
      [0, depth],
    ],
    segments,
  ).rotateX(Math.PI / 2)
}

/** Origin is the spindle on the mounting face; the grip points along +X, out along +Z. */
export function leverOnRose() {
  return cached('lever', [], () => {
    const neck = cylinder(0.009, 0.045, 10)
      .rotateX(Math.PI / 2)
      .translate(0, 0, 0.009 + 0.045 / 2)
    const grip = new CapsuleGeometry(0.0095, 0.1155, 1, 8)
    scaleUVs(grip, 2 * Math.PI * 0.0095, 0.1345)
    grip.rotateZ(-Math.PI / 2).translate(0.05775, 0, 0.054)
    return merge([rose(0.026, 0.009, 16), neck, grip])
  })
}

/** A vertical 95 mm capped barrel, centred on the knuckle axis. */
export function hingeBarrel() {
  return cached('hinge', [], () =>
    lathe(
      [
        [0, -0.0475],
        [0.0065, -0.0475],
        [0.0065, 0.0475],
        [0, 0.0475],
      ],
      12,
    ),
  )
}

export function roundedBox(
  w: number,
  h: number,
  d: number,
  r = Math.min(0.004, w / 4, h / 4, d / 4),
) {
  return cached('box', [w, h, d, r], (width, height, depth, radius) => {
    const geometry = new RoundedBoxGeometry(width, height, depth, 1, radius)
    const uv = geometry.getAttribute('uv')
    const faceSizes = [
      [depth, height],
      [depth, height],
      [width, depth],
      [width, depth],
      [width, height],
      [width, height],
    ]
    const verticesPerFace = uv.count / 6
    for (let i = 0; i < uv.count; i++) {
      const [u, v] = faceSizes[Math.floor(i / verticesPerFace)]!
      uv.setXY(i, uv.getX(i) * u!, uv.getY(i) * v!)
    }
    return geometry
  })
}

/** A capped round bar along Y. */
export function tube(radius: number, length: number) {
  return cached('tube', [2 * radius, length], (diameter, l) => cylinder(diameter / 2, l, 12))
}

/** A wheel with its axle along Z. */
export function roller(radius: number, width: number) {
  return cached('roller', [2 * radius, width], (diameter, w) =>
    cylinder(diameter / 2, w, 20).rotateX(Math.PI / 2),
  )
}
