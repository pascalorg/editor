import { expect, test } from 'bun:test'
import * as THREE from 'three'
import {
  flushPull,
  hingeJambPart,
  hingeLeafPart,
  knobOnRose,
  leverOnPlate,
  leverOnRose,
  leverOnRoseCurved,
  pullBar,
  roller,
  roundedBox,
  sphere,
  tube,
} from './hardware-geometry'

for (const [name, build, measuredTriangles] of [
  ['lever', leverOnRose, 872],
  ['curved lever', leverOnRoseCurved, 1576],
  ['knob', knobOnRose, 1152],
  ['plate lever', leverOnPlate, 660],
  ['door bar pull', () => pullBar(true), 256],
  ['flush pull', flushPull, 108],
  ['hinge leaf', hingeLeafPart, 324],
  ['hinge jamb', hingeJambPart, 140],
  ['window hinge leaf', () => hingeLeafPart(0.01, 0.06), 276],
  ['window hinge jamb', () => hingeJambPart(0.01, 0.06), 140],
  ['window handle plate', () => roundedBox(0.028, 0.12, 0.006, 0.003), 108],
  ['pull', pullBar, 440],
  ['box', () => roundedBox(0.28, 0.055, 0.055), 108],
  ['tube', () => tube(0.0095, 0.125), 48],
  ['sphere', () => sphere(0.009), 168],
  ['roller', () => roller(0.0425, 0.02), 80],
] as const) {
  test(`${name}: cached geometry has finite positions, normals and metre UVs`, () => {
    const geometry = build()
    expect(build()).toBe(geometry)
    expect(geometry.userData.shared).toBe(true)
    for (const attribute of Object.values(geometry.attributes)) {
      expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true)
    }
    const uv = geometry.getAttribute('uv')
    expect(Math.max(...Array.from(uv.array).map(Math.abs))).toBeLessThan(1)
  })

  test(`${name}: geometry stays within its triangle budget`, () => {
    const geometry = build()
    const triangles = (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
    expect(triangles).toBeGreaterThan(0)
    expect(triangles).toBeLessThanOrEqual(Math.ceil(measuredTriangles * 1.1))
  })

  test(`${name}: curved faces interpolate distinct unit normals`, () => {
    const geometry = build()
    const normals = geometry.getAttribute('normal')
    for (let i = 0; i < normals.count; i++) {
      expect(new THREE.Vector3().fromBufferAttribute(normals, i).length()).toBeCloseTo(1, 5)
    }
    const indices = geometry.index
    const count = indices?.count ?? normals.count
    let smoothTriangles = 0
    for (let i = 0; i < count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(normals, indices?.getX(i) ?? i)
      const b = new THREE.Vector3().fromBufferAttribute(normals, indices?.getX(i + 1) ?? i + 1)
      const c = new THREE.Vector3().fromBufferAttribute(normals, indices?.getX(i + 2) ?? i + 2)
      if (a.dot(b) < 0.999 || b.dot(c) < 0.999 || c.dot(a) < 0.999) smoothTriangles++
    }
    // The recessed cup intentionally has only flat walls and rim faces.
    if (build === flushPull) expect(smoothTriangles).toBe(0)
    else expect(smoothTriangles).toBeGreaterThanOrEqual((count / 3) * 0.4)
  })
}

test('rounded box UVs span each face in metres', () => {
  const uv = roundedBox(0.28, 0.055, 0.035).getAttribute('uv')
  const faceSizes = [
    [0.035, 0.055],
    [0.035, 0.055],
    [0.28, 0.035],
    [0.28, 0.035],
    [0.28, 0.055],
    [0.28, 0.055],
  ]
  const verticesPerFace = uv.count / 6
  for (const [face, [width, height]] of faceSizes.entries()) {
    const u = []
    const v = []
    for (let i = face * verticesPerFace; i < (face + 1) * verticesPerFace; i++) {
      u.push(uv.getX(i))
      v.push(uv.getY(i))
    }
    expect(Math.min(...u)).toBeCloseTo(0)
    expect(Math.max(...u)).toBeCloseTo(width!)
    expect(Math.min(...v)).toBeCloseTo(0)
    expect(Math.max(...v)).toBeCloseTo(height!)
  }
})

test('dimension keys quantise to millimetres', () => {
  expect(roundedBox(0.28, 0.055, 0.055)).toBe(roundedBox(0.2801, 0.0551, 0.0551))
  expect(tube(0.01, 0.12)).toBe(tube(0.0101, 0.1201))
  expect(sphere(0.009)).toBe(sphere(0.0091))
  expect(roller(0.0425, 0.02)).toBe(roller(0.0426, 0.0201))
  expect(tube(0.01, 0.12)).not.toBe(tube(0.01, 0.121))
})

test('round bars use circumference and length on the side and planar metres on caps', () => {
  const geometry = tube(0.01, 0.12)
  const uv = geometry.getAttribute('uv')
  expect(uv.getX(12)).toBeCloseTo(2 * Math.PI * 0.01)
  expect(uv.getY(0)).toBeCloseTo(0.12)
  const positions = geometry.getAttribute('position')
  for (let i = 26; i < uv.count; i++) {
    expect(uv.getX(i)).toBeCloseTo(positions.getX(i))
    expect(uv.getY(i)).toBeCloseTo(positions.getZ(i))
  }
})

test('lever dimensions and wheel diameter preserve half-millimetre radii', () => {
  const lever = new THREE.Box3().setFromBufferAttribute(
    leverOnRose().getAttribute('position') as THREE.BufferAttribute,
  )
  expect(lever.max.x).toBeCloseTo(0.125)
  expect(lever.min.y).toBeCloseTo(-0.026)
  expect(lever.max.y).toBeCloseTo(0.026)
  expect(lever.min.z).toBeCloseTo(0)
  const wheel = new THREE.Box3().setFromBufferAttribute(
    roller(0.0425, 0.02).getAttribute('position') as THREE.BufferAttribute,
  )
  expect(wheel.getSize(new THREE.Vector3()).x).toBeCloseTo(0.085)
  expect(wheel.getSize(new THREE.Vector3()).z).toBeCloseTo(0.02)
})

test('curved grip rings and their seams have smooth normals below 25 degrees', () => {
  const geometry = leverOnRoseCurved()
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const uv = geometry.getAttribute('uv')
  // Tube U measures travel along the grip; V wraps its 19 mm circumference.
  const circumference = 2 * Math.PI * 0.0095
  const rings = new Map<number, number[]>()
  for (let i = 0; i < position.count; i++) {
    if (position.getX(i) <= 0.035 || position.getX(i) >= 0.105) continue
    if (uv.getY(i) < -1e-7 || uv.getY(i) > circumference + 1e-7) continue
    const ring = rings.get(uv.getX(i)) ?? []
    ring.push(i)
    rings.set(uv.getX(i), ring)
  }
  const completeRings = [...rings.values()].filter((ring) => ring.length === 17)
  expect(completeRings.length).toBeGreaterThan(8)
  for (const ring of completeRings) {
    for (let j = 1; j < ring.length; j++) {
      const a = new THREE.Vector3().fromBufferAttribute(normal, ring[j - 1]!)
      const b = new THREE.Vector3().fromBufferAttribute(normal, ring[j]!)
      expect(a.angleTo(b)).toBeLessThan(THREE.MathUtils.degToRad(25))
    }
    const first = new THREE.Vector3().fromBufferAttribute(normal, ring[0]!)
    const last = new THREE.Vector3().fromBufferAttribute(normal, ring[16]!)
    expect(first.distanceTo(last)).toBeLessThan(1e-6)
  }
  for (let i = 1; i < completeRings.length; i++) {
    for (let j = 0; j < 17; j++) {
      const a = new THREE.Vector3().fromBufferAttribute(normal, completeRings[i - 1]![j]!)
      const b = new THREE.Vector3().fromBufferAttribute(normal, completeRings[i]![j]!)
      expect(a.angleTo(b)).toBeLessThan(THREE.MathUtils.degToRad(25))
    }
  }
})

test('curved lever ends in a tangent hemisphere with a 12 mm droop after a straight departure', () => {
  const position = leverOnRoseCurved().getAttribute('position')
  const normal = leverOnRoseCurved().getAttribute('normal')
  let tipVertices = 0
  for (let i = 0; i < position.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(position, i)
    if (point.x >= 0.1155 - 1e-7) {
      const radial = point.clone().sub(new THREE.Vector3(0.1155, -0.012, 0.047))
      expect(radial.length()).toBeCloseTo(0.0095, 6)
      expect(
        radial.normalize().dot(new THREE.Vector3().fromBufferAttribute(normal, i)),
      ).toBeCloseTo(1, 5)
      tipVertices++
    }
    if (point.x > 0.001 && point.x < 0.019 && point.z > 0.047) {
      expect(Math.hypot(point.y, point.z - 0.047)).toBeCloseTo(0.0095, 6)
    }
  }
  expect(tipVertices).toBeGreaterThan(100)
})

test('hinge knuckles alternate every 18 mm and leave four 1 mm grooves', () => {
  for (const [build, parity] of [
    [hingeLeafPart, 0],
    [hingeJambPart, 1],
  ] as const) {
    const position = build().getAttribute('position')
    const normal = build().getAttribute('normal')
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const y = position.getY(i)
      const z = position.getZ(i)
      if (Math.abs(Math.hypot(x, z) - 0.007) > 1e-7) continue
      const knuckle = Math.round((y + 0.036) / 0.018)
      expect(Math.abs(knuckle % 2)).toBe(parity)
      expect(Math.abs(y - (-0.036 + knuckle * 0.018))).toBeLessThanOrEqual(0.0085 + 1e-7)
      if (Math.abs(normal.getY(i)) < 1e-6) {
        expect(normal.getX(i)).toBeCloseTo(x / 0.007, 5)
        expect(normal.getZ(i)).toBeCloseTo(z / 0.007, 5)
      }
    }
    const bounds = new THREE.Box3().setFromBufferAttribute(position as THREE.BufferAttribute)
    expect(bounds.min.z).toBeCloseTo(-0.028, 6)
    expect(bounds.max.z).toBeCloseTo(0.007, 6)
  }
})

test('pulls are 18 by 120 mm capsules on two 20 mm standoffs', () => {
  const geometry = pullBar()
  const positions = geometry.getAttribute('position')
  const bounds = new THREE.Box3().setFromBufferAttribute(positions as THREE.BufferAttribute)
  expect(bounds.getSize(new THREE.Vector3()).x).toBeCloseTo(0.018, 6)
  expect(bounds.getSize(new THREE.Vector3()).y).toBeCloseTo(0.12, 6)
  expect(bounds.min.z).toBeCloseTo(0, 6)
  expect(bounds.max.z).toBeCloseTo(0.031, 6)
  for (const y of [-0.02, 0.02]) {
    expect(
      Array.from({ length: positions.count }, (_, i) => i).some(
        (i) => Math.abs(positions.getY(i) - y) < 1e-7 && Math.abs(positions.getZ(i)) < 1e-7,
      ),
    ).toBe(true)
  }
})

test('default lever has a straight 19 mm grip parallel to the face with a hemispherical 125 mm tip', () => {
  const geometry = leverOnRose()
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  let tipVertices = 0
  let gripVertices = 0
  for (let i = 0; i < position.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(position, i)
    if (point.x > 0.03 && point.x < 0.1155 - 1e-7) {
      expect(Math.hypot(point.y, point.z - 0.047)).toBeCloseTo(0.0095, 6)
      gripVertices++
    }
    if (point.x >= 0.1155 - 1e-7) {
      const radial = point.sub(new THREE.Vector3(0.1155, 0, 0.047))
      expect(radial.length()).toBeCloseTo(0.0095, 6)
      expect(
        radial.normalize().dot(new THREE.Vector3().fromBufferAttribute(normal, i)),
      ).toBeCloseTo(1, 5)
      tipVertices++
    }
  }
  expect(gripVertices).toBeGreaterThan(0)
  expect(tipVertices).toBeGreaterThan(100)
})

test('flush pull has an open front, five inner faces, a 12 mm recess and a 1 mm proud rim', () => {
  const geometry = flushPull()
  const bounds = new THREE.Box3().setFromBufferAttribute(
    geometry.getAttribute('position') as THREE.BufferAttribute,
  )
  expect(bounds.min.z).toBeCloseTo(-0.012, 6)
  expect(bounds.max.z).toBeCloseTo(0.001, 6)
  expect(bounds.getSize(new THREE.Vector3()).x).toBeCloseTo(0.046, 6)
  expect(bounds.getSize(new THREE.Vector3()).y).toBeCloseTo(0.126, 6)
  const cup = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
  cup.updateMatrixWorld(true)
  for (const [origin, direction, distance] of [
    [[0, 0, 0.1], [0, 0, -1], 0.11],
    [[0, 0, -0.005], [1, 0, 0], 0.018],
    [[0, 0, -0.005], [-1, 0, 0], 0.018],
    [[0, 0, -0.005], [0, 1, 0], 0.058],
    [[0, 0, -0.005], [0, -1, 0], 0.058],
  ] as const) {
    const hits = new THREE.Raycaster(
      new THREE.Vector3(...origin),
      new THREE.Vector3(...direction),
    ).intersectObject(cup)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.distance).toBeCloseTo(distance, 6)
  }
})

test('door bar is 25 by 400 mm with two 16 mm standoffs 300 mm apart', () => {
  const positions = pullBar(true).getAttribute('position')
  const bounds = new THREE.Box3().setFromBufferAttribute(positions as THREE.BufferAttribute)
  expect(bounds.getSize(new THREE.Vector3()).x).toBeCloseTo(0.025, 6)
  expect(bounds.getSize(new THREE.Vector3()).y).toBeCloseTo(0.4, 6)
  expect(bounds.min.z).toBeCloseTo(0, 6)
  for (const y of [-0.15, 0.15]) {
    expect(
      Array.from({ length: positions.count }, (_, i) => i).some(
        (i) => Math.abs(positions.getY(i) - y) < 1e-7 && Math.abs(positions.getX(i) - 0.008) < 1e-7,
      ),
    ).toBe(true)
  }
})

test('knob and plate have the specified rose, ball and backplate sizes', () => {
  const bounds = (geometry: THREE.BufferGeometry) =>
    new THREE.Box3().setFromBufferAttribute(
      geometry.getAttribute('position') as THREE.BufferAttribute,
    )
  const knob = bounds(knobOnRose())
  expect(knob.getSize(new THREE.Vector3()).x).toBeCloseTo(0.056)
  expect(knob.getSize(new THREE.Vector3()).y).toBeCloseTo(0.056)
  expect(knob.min.z).toBeCloseTo(0)
  expect(knob.max.z).toBeCloseTo(0.08)
  const plate = bounds(leverOnPlate())
  expect(plate.min.y).toBeCloseTo(-0.11)
  expect(plate.max.y).toBeCloseTo(0.11)
  const backplate = leverOnPlate().getAttribute('position')
  const platePoints = Array.from({ length: backplate.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(backplate, i),
  ).filter((p) => p.z < 0.00601)
  expect(new THREE.Box3().setFromPoints(platePoints).getSize(new THREE.Vector3()).x).toBeCloseTo(
    0.04,
  )
})

test('window hinge pairs use cached 10 by 60 mm sections with metre UVs', () => {
  const leaf = hingeLeafPart(0.01, 0.06)
  const jamb = hingeJambPart(0.01, 0.06)
  expect(hingeLeafPart(0.0101, 0.0601)).toBe(leaf)
  for (const geometry of [leaf, jamb]) {
    geometry.computeBoundingBox()
    const size = geometry.boundingBox!.getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(0.01, 6)
    expect(size.y).toBeLessThanOrEqual(0.060001)
    const uv = geometry.getAttribute('uv')
    expect(Math.max(...Array.from(uv.array).map(Math.abs))).toBeLessThanOrEqual(0.060001)
    expect(geometry.userData.shared).toBe(true)
  }
  expect(leaf.boundingBox!.getSize(new THREE.Vector3()).y).toBeCloseTo(0.06, 6)
  expect(hingeLeafPart()).not.toBe(leaf)
})
