import { describe, expect, test } from 'bun:test'
import { evaluateRecipe, parseRecipe, type Recipe } from './recipe'
import { sectionRings } from './section'

type Shape = Recipe['parts'][number]['shapes'][number]
const design = (shape: Record<string, unknown>, version: 1 | 2 = 2): Recipe =>
  ({
    version,
    name: 'Extrude probe',
    description: 'One extruded section.',
    parameters: [
      { id: 'width', label: 'Width', default: 1.2, min: 0.6, max: 2.4, step: 0.01, unit: 'm' },
    ],
    slots: [{ id: 'body', label: 'Body', color: '#888888' }],
    parts: [
      {
        id: 'part',
        label: 'Part',
        count: 1,
        shapes: [{ id: 'e', primitive: 'extrude', slot: 'body', position: [0, 0.5, 0], ...shape }],
      },
    ],
    constraints: [],
  }) as Recipe
const one = (shape: Record<string, unknown>, values: Record<string, number> = {}) =>
  evaluateRecipe(parseRecipe(design(shape)), values)
// A countertop section seen from the front edge: width × 30 mm, with a 0.5 × 0.03 m sink
// slot, extruded 0.6 m deep.
const counter = {
  section: {
    kind: 'polygon',
    outer: [
      [0, 0],
      ['width', 0],
      ['width', 0.03],
      [0, 0.03],
    ],
    holes: [
      [
        [0.3, 0.005],
        [0.8, 0.005],
        [0.8, 0.025],
        [0.3, 0.025],
      ],
    ],
  },
  length: 0.6,
}

describe('extrude (recipe version 2)', () => {
  test('a rectangle section extrudes into exactly a box', () => {
    const e = one({ section: { kind: 'rectangle', width: 0.4, depth: 0.2 }, length: 0.1 })
    expect(e.shapes[0]!.size).toEqual([0.4, 0.2, 0.1])
    expect(e.triangles).toBe(12)
    expect(e.max[1]).toBeCloseTo(0.6)
  })

  test('an off-centre polygon is re-centred in its box; parameters move its vertices', () => {
    const a = one(counter)
    const b = one(counter, { width: 2 })
    expect(a.shapes[0]!.size).toEqual([1.2, 0.03, 0.6])
    expect(b.shapes[0]!.size[0]).toBe(2)
    expect(a.shapes[0]!.position).toEqual([0.6, 0.515, 0])
    const section = a.shapes[0]!.section!
    expect(section.kind).toBe('polygon')
    const rings = sectionRings(section)
    expect(Math.min(...rings.outer.map(([x]) => x))).toBeCloseTo(-0.6)
    // Caps: earcut gives V + 2H - 2 = 8 + 2 - 2 triangles each; sides: 2 per edge.
    expect(a.triangles).toBe(2 * 8 + 2 * 8)
  })

  test('rounded, round and oval sections polygonise deterministically', () => {
    expect(sectionRings({ kind: 'round', radius: 0.05 }).outer).toHaveLength(24)
    const tube = sectionRings({ kind: 'round', radius: 0.05, wall: 0.005 })
    expect(tube.holes).toHaveLength(1)
    expect(Math.hypot(...tube.holes[0]![0]!)).toBeCloseTo(0.045)
    expect(
      sectionRings({ kind: 'rectangle', width: 0.4, depth: 0.2, corner: 0.02 }).outer,
    ).toHaveLength(20)
    // Fully rounded ends share their arc endpoints; the ring keeps each point once.
    expect(
      sectionRings({ kind: 'rectangle', width: 0.4, depth: 0.2, corner: 0.1 }).outer,
    ).toHaveLength(18)
    expect(sectionRings({ kind: 'oval', width: 0.4, depth: 0.2 }).outer).toHaveLength(24)
    expect(
      one({ section: { kind: 'round', radius: 0.05, wall: 0.005 }, length: 1 }).triangles,
    ).toBe(2 * 48 + 2 * 48)
  })

  test('a bevel adds two layers at each end without growing the box', () => {
    const e = one({
      section: { kind: 'rectangle', width: 0.4, depth: 0.2 },
      length: 0.1,
      bevel: 0.01,
    })
    expect(e.shapes[0]!.size).toEqual([0.4, 0.2, 0.1])
    expect(e.triangles).toBe(2 * 2 + 2 * 4 * 5)
  })

  test('extrude is validated and v2-only', () => {
    const rect = { section: { kind: 'rectangle', width: 0.4, depth: 0.2 }, length: 0.1 }
    expect(() => parseRecipe(design(rect, 1))).toThrow('version 2')
    for (const bad of [
      { ...rect, length: undefined },
      { length: 0.1 },
      { ...rect, size: [1, 1, 1] },
      { ...rect, support: true },
      { ...rect, bevel: 0.05 },
      {
        section: {
          kind: 'polygon',
          outer: [
            [0, 0],
            [1, 0],
            [2, 0],
          ],
        },
        length: 1,
      },
      {
        section: {
          kind: 'polygon',
          outer: counter.section.outer,
          holes: [
            [
              [2, 2],
              [3, 2],
              [3, 3],
            ],
          ],
        },
        length: 1,
      },
      { section: { kind: 'round', radius: 0.05, wall: 0.05 }, length: 1 },
      { section: { kind: 'rectangle', width: 0.4, depth: 0.2, corner: 0.2 }, length: 1 },
    ])
      expect(() => parseRecipe(design(bad as Partial<Shape>))).toThrow()
    const box = design({ primitive: 'box', size: [1, 1, 1], section: rect.section })
    expect(() => parseRecipe(box)).toThrow('extrude')
    expect(() => parseRecipe(design({ primitive: 'box' }))).toThrow('size')
  })
})
