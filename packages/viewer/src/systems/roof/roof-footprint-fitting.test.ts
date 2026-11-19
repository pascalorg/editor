// @ts-expect-error - bun:test is supplied by Bun; viewer has no Bun globals.
import { expect, test } from 'bun:test'
import { BuildingNode, LevelNode, type RoofNode, SlabNode } from '@pascal-app/core'
import { applySceneChanges, createRoof } from '@pascal-app/core/agent-operations'
import * as THREE from 'three'
import { generateRoofSegmentGeometry } from './roof-system'

type Point = [number, number]
const base: Point[] = [
  [1, 0],
  [4, 0],
  [4, 3],
  [0, 3],
  [0, 1],
]
const forms = ['gable', 'hip', 'flat', 'shed', 'gambrel', 'mansard', 'dutch', 'barrel'] as const
const cases = [
  ...forms.map((roofType) => ({ roofType, flipX: false, flipZ: false, angle: 0, reverse: false })),
  ...[
    [true, false],
    [false, true],
    [true, true],
  ].map(([flipX, flipZ]) => ({
    roofType: 'hip' as const,
    flipX: !!flipX,
    flipZ: !!flipZ,
    angle: 0,
    reverse: false,
  })),
  { roofType: 'hip' as const, flipX: false, flipZ: false, angle: Math.PI / 6, reverse: true },
]

// Expected membership: 4x3 rectangle minus x+z<1 (area 11.5m²).
// This test observes real native generated geometry, not a fitter/outline-reader echo.
// Probe clearance is >=0.10m except diagonal witnesses (0.056m), much larger than
// 1mm serialization and the requested 0.02m wall's half-thickness. No area is
// inferred from a bounding box, segment count, or candidate triangle count.
for (const row of cases) {
  test(`trim-aware native ${JSON.stringify(row)} covers the room but not its cut corner`, () => {
    const mirror = ([x, z]: Point): Point => [row.flipX ? 4 - x : x, row.flipZ ? 3 - z : z]
    const transform = (point: Point): Point => {
      const [x, z] = mirror(point)
      return [
        10 + x * Math.cos(row.angle) + z * Math.sin(row.angle),
        -7 - x * Math.sin(row.angle) + z * Math.cos(row.angle),
      ]
    }
    const ring = base.map(transform)
    const polygon = row.reverse ? [...ring.slice(2), ...ring.slice(0, 2)].reverse() : ring
    const slab = SlabNode.parse({ id: 'slab_fit', parentId: 'level_fit', polygon })
    const level = LevelNode.parse({
      id: 'level_fit',
      parentId: 'building_fit',
      level: 0,
      height: 3,
      children: [slab.id],
    })
    const building = BuildingNode.parse({ id: 'building_fit', children: [level.id] })
    const nodes = Object.fromEntries([building, level, slab].map((node) => [node.id, node]))
    const before = structuredClone(nodes)
    const outcome = createRoof(
      nodes,
      { levelId: level.id, roofType: row.roofType, overhang: 0, wallThickness: 0.02 },
      { activeLevelId: level.id },
    )
    const after = applySceneChanges(nodes, outcome.changes ?? {})
    const roof = Object.values(after).find((node): node is RoofNode => node.type === 'roof')
    if (!roof) throw new Error('Expected persisted native roof')
    const segments = Object.values(after).filter(
      (node) => node.type === 'roof-segment' && node.parentId === roof.id,
    )
    expect(segments.length).toBeGreaterThan(0)
    const group = new THREE.Group()
    group.position.fromArray(roof.position)
    group.rotation.y = roof.rotation
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    try {
      for (const segment of segments) {
        if (segment.type !== 'roof-segment') throw new Error('Expected segment')
        expect(segment.roofType).toBe(row.roofType)
        const mesh = new THREE.Mesh(generateRoofSegmentGeometry(segment, after), material)
        mesh.position.fromArray(segment.position)
        mesh.rotation.y = segment.rotation
        group.add(mesh)
      }
      group.updateMatrixWorld(true)
      const covered = (point: Point) => {
        const [x, z] = transform(point)
        return (
          new THREE.Raycaster(
            new THREE.Vector3(x, 1000, z),
            new THREE.Vector3(0, -1, 0),
          ).intersectObject(group, true).length > 0
        )
      }
      for (let x = 0.25; x < 4; x += 0.5) {
        for (let z = 0.25; z < 3; z += 0.5) {
          if (Math.abs(x + z - 1) < 0.1) continue
          expect(covered([x, z]), `physical covering at ${x},${z}`).toBe(x + z > 1)
        }
      }
      // Adjacent witnesses detect displaced/omitted cuts, rather than only an empty far corner.
      expect(covered([0.46, 0.46])).toBe(false)
      expect(covered([0.54, 0.54])).toBe(true)
      for (const outside of [
        [-0.1, 2],
        [4.1, 2],
        [2, -0.1],
        [2, 3.1],
      ] as Point[]) {
        expect(covered(outside), `outside requested footprint ${outside}`).toBe(false)
      }
      expect(nodes).toEqual(before)
    } finally {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose()
      })
      material.dispose()
    }
  })
}
