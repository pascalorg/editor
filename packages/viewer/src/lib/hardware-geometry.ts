import {
  BoxGeometry,
  type BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  LatheGeometry,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
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
  geometry.normalizeNormals()
  const uv = geometry.getAttribute('uv')
  let distance = 0
  for (let j = 0; j < profile.length; j++) {
    const [r, y] = profile[j]!
    if (j > 0) {
      const [previousR, previousY] = profile[j - 1]!
      distance += Math.hypot(r - previousR, y - previousY)
    }
    for (let i = 0; i <= segments; i++) {
      uv.setXY(i * profile.length + j, (i / segments) * 2 * Math.PI * r, distance)
    }
  }
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

function hemisphere(radius: number, radialSegments: number, heightSegments: number) {
  const geometry = new SphereGeometry(
    radius,
    radialSegments,
    heightSegments,
    0,
    2 * Math.PI,
    0,
    Math.PI / 2,
  )
  scaleUVs(geometry, 2 * Math.PI * radius, (Math.PI * radius) / 2)
  return geometry
}

/** Origin is the spindle on the mounting face; the grip points along +X, out along +Z. */
function buildLever(curved: boolean) {
  return cached(curved ? 'lever-curved' : 'lever-straight', [], () => {
    const faceFillet = 0.0005
    const faceRadius = 0.0245 - faceFillet * (Math.SQRT2 - 1)
    const profile: [number, number][] = [
      [0, 0],
      [0.026, 0],
      [0.026, 0.0075],
    ]
    for (const angle of [Math.PI / 4, Math.PI / 3, (5 * Math.PI) / 12, Math.PI / 2]) {
      profile.push([
        faceRadius + faceFillet * Math.cos(angle),
        0.0085 + faceFillet * Math.sin(angle),
      ])
    }
    profile.push([0, 0.009])
    const rose = lathe(profile, 48).rotateX(Math.PI / 2)
    const neck = cylinder(0.01, 0.037, 24)
      .rotateX(Math.PI / 2)
      .translate(0, 0, 0.009 + 0.037 / 2)
    const neckProfile: [number, number][] = []
    for (let i = 0; i <= 4; i++) {
      const angle = (i * Math.PI) / 8
      neckProfile.push([0.009 + 0.001 * Math.cos(angle), 0.046 + 0.001 * Math.sin(angle)])
    }
    neckProfile.push([0, 0.047])
    const fillet = lathe(neckProfile, 24)
    const filletNormals = fillet.getAttribute('normal')
    // Match the cylinder tangent exactly rather than averaging the first fillet chord.
    for (let i = 0; i <= 24; i++) {
      const phi = (i * 2 * Math.PI) / 24
      for (let j = 0; j < neckProfile.length; j++) {
        const angle = (Math.min(j, 4) * Math.PI) / 8
        filletNormals.setXYZ(
          i * neckProfile.length + j,
          Math.cos(angle) * Math.sin(phi),
          Math.sin(angle),
          Math.cos(angle) * Math.cos(phi),
        )
      }
    }
    fillet.rotateX(Math.PI / 2)
    const curve = new CatmullRomCurve3(
      (curved
        ? [
            [0, 0],
            [0.01, 0],
            [0.02, 0],
            [0.035, 0],
            [0.065, -0.004],
            [0.095, -0.011],
            [0.105, -0.012],
            [0.1155, -0.012],
          ]
        : [
            [0, 0],
            [0.1155, 0],
          ]
      ).map(([x, y]) => new Vector3(x, y, 0.047)),
    )
    const grip = new TubeGeometry(curve, 24, 0.0095, 16, false)
    scaleUVs(grip, curve.getLength(), 2 * Math.PI * 0.0095)
    const cap = hemisphere(0.0095, 16, 8)
      .rotateZ(-Math.PI / 2)
      .translate(0.1155, curved ? -0.012 : 0, 0.047)
    // Close the heel where the horizontal grip meets the vertical neck.
    const heel = hemisphere(0.0095, 16, 8)
      .rotateZ(Math.PI / 2)
      .translate(0, 0, 0.047)
    return merge([rose, neck, fillet, grip, cap, heel])
  })
}

export function leverOnRose() {
  return buildLever(false)
}

// Retained for the handle-style presets in the next slice.
export function leverOnRoseCurved() {
  return buildLever(true)
}

/** Origin at the face; a 40 × 120 mm open cup with a 3 mm rim, recessed 12 mm. */
export function flushPull() {
  return cached('flush-pull', [], () => {
    const parts: BufferGeometry[] = []
    const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const geometry = new BoxGeometry(w, h, d)
      boxUVs(geometry, w, h, d)
      parts.push(geometry.translate(x, y, z))
    }
    box(0.04, 0.12, 0.002, 0, 0, -0.011)
    for (const side of [-1, 1]) {
      box(0.002, 0.12, 0.01, side * 0.019, 0, -0.005)
      box(0.036, 0.002, 0.01, 0, side * 0.059, -0.005)
      box(0.003, 0.126, 0.001, side * 0.0215, 0, 0.0005)
      box(0.04, 0.003, 0.001, 0, side * 0.0615, 0.0005)
    }
    return merge(parts)
  })
}

function hingePart(leaf: boolean) {
  return cached(leaf ? 'hinge-leaf' : 'hinge-jamb', [], () => {
    const plate = new BoxGeometry(0.0025, 0.089, 0.028)
    boxUVs(plate, 0.0025, 0.089, 0.028)
    plate.translate(leaf ? 0.00125 : -0.00125, 0, -0.014)
    const parts: BufferGeometry[] = [plate]
    for (let i = leaf ? 0 : 1; i < 5; i += 2) {
      parts.push(cylinder(0.007, 0.017, 24).translate(0, -0.036 + i * 0.018, 0))
    }
    if (leaf) {
      parts.push(hemisphere(0.007, 24, 4).translate(0, 0.0445, 0))
      parts.push(hemisphere(0.007, 24, 4).rotateX(Math.PI).translate(0, -0.0445, 0))
    }
    return merge(parts)
  })
}

/** Odd knuckles and plate on the leaf edge (+X), extending into the rebate (-Z). */
export function hingeLeafPart() {
  return hingePart(true)
}

/** Even knuckles and plate on the jamb face (-X), extending into the rebate (-Z). */
export function hingeJambPart() {
  return hingePart(false)
}

/** Origin on the mounting face; bar along Y, projecting along +Z. */
export function pullBar() {
  return cached('pull', [], () => {
    const bar = new CapsuleGeometry(0.009, 0.102, 8, 16)
    scaleUVs(bar, 2 * Math.PI * 0.009, 0.102 + Math.PI * 0.009)
    bar.translate(0, 0, 0.022)
    const parts: BufferGeometry[] = [bar]
    for (const y of [-0.02, 0.02]) {
      parts.push(
        cylinder(0.005, 0.02, 16)
          .rotateX(Math.PI / 2)
          .translate(0, y, 0.01),
      )
    }
    return merge(parts)
  })
}

function boxUVs(geometry: BufferGeometry, width: number, height: number, depth: number) {
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
}

export function roundedBox(
  w: number,
  h: number,
  d: number,
  r = Math.min(0.004, w / 4, h / 4, d / 4),
) {
  return cached('box', [w, h, d, r], (width, height, depth, radius) => {
    const geometry = new RoundedBoxGeometry(width, height, depth, 2, radius)
    boxUVs(geometry, width, height, depth)
    return geometry
  })
}

/** A capped round bar along Y. */
export function tube(radius: number, length: number) {
  return cached('tube', [2 * radius, length], (diameter, l) => cylinder(diameter / 2, l, 12))
}

export function sphere(radius: number) {
  return cached('sphere', [2 * radius], (diameter) => {
    const geometry = new SphereGeometry(diameter / 2, 12, 8)
    scaleUVs(geometry, Math.PI * diameter, (Math.PI * diameter) / 2)
    return geometry
  })
}

/** A wheel with its axle along Z. */
export function roller(radius: number, width: number) {
  return cached('roller', [2 * radius, width], (diameter, w) =>
    cylinder(diameter / 2, w, 20).rotateX(Math.PI / 2),
  )
}
