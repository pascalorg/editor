import { describe, expect, test } from 'bun:test'
import {
  createDormerDefaultWindow,
  DormerNode,
  LevelNode,
  planDormerCreation,
  RoofNode,
  RoofSegmentNode,
} from '@pascal-app/core'
import { Vector3 } from 'three'
import { generateDormerGeometry } from '../csg-geometry'

// Ported from the roofer precision lab (opt-in built dormer flashing); expected values are the
// hand-derived finished roof plane of the host below, not numbers read from the code.
describe('opt-in built dormer flashing', () => {
  const pitch = Math.PI / 6
  const host = RoofSegmentNode.parse({
    width: 8,
    depth: 6,
    roofType: 'gable',
    pitch: 30,
    wallHeight: 1,
    deckThickness: 0.1,
    shingleThickness: 0.05,
  })
  const steepHost = RoofSegmentNode.parse({ width: 8, depth: 8, roofType: 'gable', pitch: 45 })
  // Explicitly expose the window: offset 1.5 minus half-skirt 1.365 gives
  // centre .135 and sill -.205, above the finished face roof at -.289.
  const base = DormerNode.parse({
    width: 1.6,
    depth: 1.6,
    height: 0.8,
    roofHeight: 0.6,
    windowOffsetY: 1.5,
    position: [0, 1 + 1.5 * Math.tan(pitch), 1.5],
  })

  test('conical keeps a truthful circular-wall limitation and emits no unsupported apron', () => {
    const level = LevelNode.parse({ id: 'level_conical_oracle', children: ['roof_conical_oracle'] })
    const roof = RoofNode.parse({
      id: 'roof_conical_oracle',
      parentId: level.id,
      children: ['rseg_conical_oracle'],
    })
    // A steep deep host, as the shared planner's own fixtures use, keeps its default window exposed.
    const segment = RoofSegmentNode.parse({
      ...steepHost,
      id: 'rseg_conical_oracle',
      parentId: roof.id,
    })
    const nodes = { [level.id]: level, [roof.id]: roof, [segment.id]: segment }
    const planned = planDormerCreation(nodes, segment, [0, 2], { roofType: 'conical' })
    if (!planned.ok) throw Error(`Conical creation refused: ${planned.message}`)
    const { dormer } = planned.value
    expect(dormer.flashing).toBe(false)
    // Even an explicitly requested flag cannot manufacture unsupported curved-wall strips.
    const geometry = generateDormerGeometry({ ...dormer, flashing: true }, segment, [])
    try {
      expect(geometry.groups.some((group) => group.materialIndex === 5)).toBe(false)
    } finally {
      geometry.dispose()
    }
  })

  test('absent/false preserves the original geometry and does not create a flashing slot', () => {
    const legacy = generateDormerGeometry(base, host, [])
    const disabled = generateDormerGeometry({ ...base, flashing: false }, host, [])
    try {
      expect(Array.from(disabled.getAttribute('position').array)).toEqual(
        Array.from(legacy.getAttribute('position').array),
      )
      expect(Array.from(disabled.index!.array)).toEqual(Array.from(legacy.index!.array))
      expect(disabled.groups).toEqual(legacy.groups)
      expect(legacy.groups.some((group) => group.materialIndex === 5)).toBe(false)
    } finally {
      legacy.dispose()
      disabled.dispose()
    }
  })

  test('enabled apron follows the finished slope with finite faces and stays below the front window', () => {
    const dormer = { ...base, flashing: true }
    const window = createDormerDefaultWindow(dormer)
    const geometry = generateDormerGeometry(dormer, host, [window])
    try {
      const groups = geometry.groups.filter((group) => group.materialIndex === 5)
      expect(groups.length).toBeGreaterThan(0)
      const position = geometry.getAttribute('position')
      const index = geometry.index!
      let triangles = 0
      let maximumDistanceToFinishedRoof = -Infinity
      let minimumDistanceToFinishedRoof = Infinity
      for (const group of groups)
        for (let i = group.start; i < group.start + group.count; i += 3) {
          const vertices = [0, 1, 2].map((j) =>
            new Vector3().fromBufferAttribute(position, index.getX(i + j)),
          )
          const [a, b, c] = vertices as [Vector3, Vector3, Vector3]
          expect(b.clone().sub(a).cross(c.clone().sub(a)).lengthSq()).toBeGreaterThan(1e-12)
          for (const point of vertices) {
            expect(point.toArray().every(Number.isFinite)).toBe(true)
            const finished =
              1 +
              (3 - Math.abs(base.position[2] + point.z)) * Math.tan(pitch) +
              0.15 / Math.cos(pitch)
            const clearance = base.position[1] + point.y - finished
            maximumDistanceToFinishedRoof = Math.max(maximumDistanceToFinishedRoof, clearance)
            minimumDistanceToFinishedRoof = Math.min(minimumDistanceToFinishedRoof, clearance)
            if (
              Math.abs(point.z - base.depth / 2) < 0.01 &&
              Math.abs(point.x - window.position[0]) < window.width / 2
            )
              expect(point.y).toBeLessThanOrEqual(window.position[1] - window.height / 2 + 1e-4)
          }
          triangles++
        }
      expect(triangles).toBeGreaterThan(0)
      expect(minimumDistanceToFinishedRoof).toBeGreaterThan(-0.005)
      expect(maximumDistanceToFinishedRoof).toBeLessThan(0.11)
    } finally {
      geometry.dispose()
    }
  })

  test('a new gable dormer is created flashed; a stored dormer stays unflashed', () => {
    const level = LevelNode.parse({ id: 'level_gable_flash', children: ['roof_gable_flash'] })
    const roof = RoofNode.parse({
      id: 'roof_gable_flash',
      parentId: level.id,
      children: ['rseg_gable_flash'],
    })
    // A steep deep host, as the shared planner's own fixtures use, keeps its default window exposed.
    const segment = RoofSegmentNode.parse({
      ...steepHost,
      id: 'rseg_gable_flash',
      parentId: roof.id,
    })
    const nodes = { [level.id]: level, [roof.id]: roof, [segment.id]: segment }
    const planned = planDormerCreation(nodes, segment, [0, 2])
    if (!planned.ok) throw Error(`Gable creation refused: ${planned.message}`)
    const { dormer } = planned.value
    expect(dormer.flashing).toBe(true)
    expect(DormerNode.parse({}).flashing).toBeUndefined()
  })

  test('with its roof known, the apron reads the native finished covering', () => {
    const level = LevelNode.parse({ id: 'level_native_flash', children: ['roof_native_flash'] })
    const roof = RoofNode.parse({
      id: 'roof_native_flash',
      parentId: level.id,
      children: ['rseg_native_flash'],
    })
    const segment = RoofSegmentNode.parse({ ...host, id: 'rseg_native_flash', parentId: roof.id })
    const nodes = { [level.id]: level, [roof.id]: roof, [segment.id]: segment }
    const dormer = { ...base, flashing: true }
    const geometry = generateDormerGeometry(dormer, segment, [], nodes)
    try {
      const groups = geometry.groups.filter((group) => group.materialIndex === 5)
      expect(groups.length).toBeGreaterThan(0)
      const position = geometry.getAttribute('position')
      const index = geometry.index!
      for (const group of groups)
        for (let i = group.start; i < group.start + group.count; i++) {
          const point = new Vector3().fromBufferAttribute(position, index.getX(i))
          // Same hand-derived finished plane as above: wall 1 + run * tan 30° + 0.15 / cos 30°.
          const finished =
            1 +
            (3 - Math.abs(base.position[2] + point.z)) * Math.tan(pitch) +
            0.15 / Math.cos(pitch)
          const clearance = base.position[1] + point.y - finished
          expect(clearance).toBeGreaterThan(-0.005)
          expect(clearance).toBeLessThan(0.11)
        }
    } finally {
      geometry.dispose()
    }
  })
})
