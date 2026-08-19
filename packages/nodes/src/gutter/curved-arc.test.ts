import { describe, expect, test } from 'bun:test'
import { GutterNode } from '@pascal-app/core'
import * as THREE from 'three'
import { buildGutterGeometry } from './geometry'
import { resolveGutterOutletById } from './outlet-lookup'

// A managed lean-to gutter following a curved eave carries a concentric arc in
// gutter-mesh-local coordinates. The bend rotates each vertex about the stored
// center O = (centerX, centerZ), so its distance from O is preserved — the
// trough hugs the eave circle instead of ballooning off the chord.
describe('curved gutter arc', () => {
  const radius = 5
  const centerX = 0
  // Center sits one radius inward along -Z so the trough floor (Z ≈ 0) lands on
  // the eave circle of radius `radius`.
  const centerZ = -radius

  function curvedGutter(overrides: Record<string, unknown> = {}) {
    return GutterNode.parse({
      id: 'gutter_curved',
      type: 'gutter',
      length: 3,
      size: 0.13,
      profile: 'k-style',
      arc: { centerX, centerZ, radius },
      ...overrides,
    })
  }

  test('bends every trough triangle into a thin concentric band on both wall sides', () => {
    for (const arcCenterZ of [-radius, radius]) {
      const geometry = buildGutterGeometry(
        curvedGutter({
          length: 8,
          arc: { centerX, centerZ: arcCenterZ, radius },
          outlets: [{ id: 'outlet_arc', offset: 0.5, diameter: 0.07 }],
        }),
      )
      const source = geometry.index ? geometry.toNonIndexed() : geometry
      const position = source.getAttribute('position')
      expect(position.count).toBeGreaterThan(0)

      const distanceToEdge = (a: number, b: number) => {
        const ax = position.getX(a) - centerX
        const az = position.getZ(a) - arcCenterZ
        const dx = position.getX(b) - position.getX(a)
        const dz = position.getZ(b) - position.getZ(a)
        const lengthSquared = dx * dx + dz * dz
        const t =
          lengthSquared > 1e-12 ? Math.max(0, Math.min(1, -(ax * dx + az * dz) / lengthSquared)) : 0
        return Math.hypot(ax + dx * t, az + dz * t)
      }
      let minR = Number.POSITIVE_INFINITY
      let maxR = Number.NEGATIVE_INFINITY
      let minimumTriangleEdgeRadius = Number.POSITIVE_INFINITY
      for (let i = 0; i < position.count; i++) {
        const d = Math.hypot(position.getX(i) - centerX, position.getZ(i) - arcCenterZ)
        minR = Math.min(minR, d)
        maxR = Math.max(maxR, d)
      }
      for (let offset = 0; offset + 2 < position.count; offset += 3) {
        minimumTriangleEdgeRadius = Math.min(
          minimumTriangleEdgeRadius,
          distanceToEdge(offset, offset + 1),
          distanceToEdge(offset + 1, offset + 2),
          distanceToEdge(offset + 2, offset),
        )
      }

      expect(minR).toBeGreaterThan(radius - 0.3)
      expect(maxR).toBeLessThan(radius + 0.3)
      expect(minimumTriangleEdgeRadius).toBeGreaterThan(radius - 0.3)

      if (source !== geometry) source.dispose()
      geometry.dispose()
    }
  })

  test('places an outlet on the eave circle', () => {
    const gutter = curvedGutter({
      outlets: [{ id: 'outlet_a', offset: 0.5, diameter: 0.07 }],
    })
    const placement = resolveGutterOutletById(gutter, 'outlet_a')
    expect(placement).not.toBeNull()
    const d = Math.hypot(placement!.x - centerX, placement!.z - centerZ)
    // The drop tube mounts on the bent trough floor — on the eave circle, offset
    // only by the profile's floor midpoint (well under one profile `size`).
    expect(d).toBeGreaterThan(radius - 0.01)
    expect(d).toBeLessThan(radius + gutter.size)
  })

  test('keeps the curved front fascia continuous across a downspout outlet', () => {
    const outerRadius = 7.25
    const outerCenterZ = -9.548
    const offset = 3.94
    const gutter = curvedGutter({
      length: 8.2,
      arc: { centerX, centerZ: outerCenterZ, radius: outerRadius },
      outlets: [{ id: 'outlet_fascia', offset, diameter: 0.07 }],
    })
    const geometry = buildGutterGeometry(gutter)
    const signedRadius = -outerRadius
    const phi = offset / signedRadius
    const radial = new THREE.Vector3(-Math.sin(phi), 0, Math.cos(phi))
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(centerX, -gutter.size * 0.4, outerCenterZ).addScaledVector(
        radial,
        Math.abs(outerCenterZ) + 1,
      ),
      radial.clone().negate(),
      0,
      2,
    )
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    const intersections = raycaster.intersectObject(new THREE.Mesh(geometry, material))

    expect(intersections.length).toBeGreaterThan(0)

    material.dispose()
    geometry.dispose()
  })

  test('leaves a straight gutter (no arc) unbent', () => {
    const gutter = GutterNode.parse({ id: 'gutter_straight', type: 'gutter', length: 3 })
    const geometry = buildGutterGeometry(gutter)
    const position = geometry.getAttribute('position')
    // Without an arc the length axis stays straight: X spans the full run.
    let maxX = Number.NEGATIVE_INFINITY
    for (let i = 0; i < position.count; i++) maxX = Math.max(maxX, Math.abs(position.getX(i)))
    expect(maxX).toBeGreaterThan(1)
    geometry.dispose()
  })
})
