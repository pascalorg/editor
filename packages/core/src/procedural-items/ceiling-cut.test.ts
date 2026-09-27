import { describe, expect, test } from 'bun:test'
import { CeilingNode } from '../schema/nodes/ceiling'
import { LevelNode } from '../schema/nodes/level'
import pendantJson from './__fixtures__/pendant_lamp.json'
import downlightJson from './__fixtures__/recessed_downlight.json'
import { radiatorRecipe, shelfRecipe } from './fixtures'
import { ProceduralItemNode } from './node'
import { proceduralCeilingHole, validateProceduralRelations } from './query'
import { evaluateRecipe, parseRecipe, type Recipe } from './recipe'

const downlight = () => structuredClone(downlightJson) as Recipe

describe('recipe ceiling cuts (version 2)', () => {
  test('a recessed design evaluates its cut ring around the mounting reference', () => {
    const evaluation = evaluateRecipe(parseRecipe(downlight()), { size: 0.16 })
    expect(evaluation.cuts).toHaveLength(1)
    const ring = evaluation.cuts[0]!.ring
    expect(ring).toHaveLength(4)
    for (const [x, z] of ring) {
      expect(Math.abs(x)).toBeCloseTo(0.08)
      expect(Math.abs(z)).toBeCloseTo(0.08)
    }
    // The can rises into the plenum above the reference; the trim stays below it.
    expect(evaluation.max[1]).toBeGreaterThan(0.01 + 0.1)
  })

  test('a circle cut is a closed 32-gon, offset and turned with the reference', () => {
    const recipe = downlight()
    recipe.cuts = [
      { shape: 'circle', diameter: { op: 'mul', args: ['size', 1.6] }, center: [0.01, 0] },
    ]
    recipe.surfaces![0]!.rotation = [0, Math.PI / 2, 0]
    const ring = evaluateRecipe(parseRecipe(recipe), { size: 0.2 }).cuts[0]!.ring
    expect(ring).toHaveLength(32)
    const center = ring.reduce((sum, [x, z]) => [sum[0] + x / 32, sum[1] + z / 32], [0, 0])
    // The reference's local +x runs along design -z after a quarter turn about Y.
    expect(center[0]).toBeCloseTo(0)
    expect(center[1]).toBeCloseTo(-0.01)
    for (const [x, z] of ring) expect(Math.hypot(x - center[0], z - center[1])).toBeCloseTo(0.16)
  })

  test('only the part inside a cut may rise above the ceiling reference', () => {
    const recipe = downlight()
    recipe.cuts = [{ shape: 'rect', size: [{ op: 'sub', args: ['size', 0.02] }, 'size'] }]
    expect(() => parseRecipe(recipe)).toThrow('outside its cut')
    const flush = structuredClone(pendantJson) as Recipe
    flush.version = 2
    flush.surfaces![0]!.position[1] = 0.1
    expect(() => parseRecipe(flush)).toThrow('top of the design')
  })

  test('cuts are v2-only and need a ceiling mount', () => {
    expect(() => parseRecipe({ ...downlight(), version: 1 })).toThrow('version 2')
    const cuts = downlight().cuts
    expect(() => parseRecipe({ ...shelfRecipe, version: 2, cuts })).toThrow('ceiling')
    expect(() => parseRecipe({ ...radiatorRecipe, version: 2, cuts })).toThrow('ceiling')
  })

  test('v1 designs evaluate no cuts', () => {
    expect(evaluateRecipe(shelfRecipe).cuts).toEqual([])
    expect(evaluateRecipe(parseRecipe(structuredClone(pendantJson))).cuts).toEqual([])
  })

  test('a recessed design may sit in the plenum up to the level height', () => {
    const level = LevelNode.parse({ id: 'level_cut', height: 3 })
    const ceiling = CeilingNode.parse({
      id: 'ceiling_cut',
      parentId: level.id,
      height: 2.7,
      polygon: [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
      ],
    })
    const node = ProceduralItemNode.parse({
      id: 'procedural-item_cut',
      recipe: downlight(),
      parentId: ceiling.id,
    })
    const nodes = { [level.id]: level, [ceiling.id]: ceiling, [node.id]: node }
    expect(() => validateProceduralRelations(node, nodes)).not.toThrow()
    const shallow = { ...nodes, [ceiling.id]: { ...ceiling, height: 2.95 } }
    expect(() => validateProceduralRelations(node, shallow)).toThrow('level height')
  })

  test('the hole follows the node onto its ceiling, turned with its yaw', () => {
    const recipe = downlight()
    recipe.cuts = [{ shape: 'rect', size: [{ op: 'mul', args: ['size', 1.5] }, 'size'] }]
    const node = ProceduralItemNode.parse({
      recipe,
      parentId: 'ceiling_hole',
      position: [1, 0, 2],
      rotation: [0, Math.PI / 2, 0],
    })
    const ring = proceduralCeilingHole(node)!
    expect(ring).toHaveLength(4)
    const xs = ring.map(([x]) => x),
      zs = ring.map(([, z]) => z)
    expect(Math.min(...xs)).toBeCloseTo(0.94)
    expect(Math.max(...xs)).toBeCloseTo(1.06)
    expect(Math.min(...zs)).toBeCloseTo(1.91)
    expect(Math.max(...zs)).toBeCloseTo(2.09)
    expect(
      proceduralCeilingHole({ ...node, recipe: parseRecipe(structuredClone(pendantJson)) }),
    ).toBe(null)
  })
})
