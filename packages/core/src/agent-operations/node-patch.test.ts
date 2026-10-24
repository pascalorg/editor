import { describe, expect, test } from 'bun:test'
import { AgentRefusal, isAgentRefusal } from '../agent-tools/refusal'
import { getCatalogMaterialById } from '../material-library'
import { ColumnNode, SlabNode, WallNode } from '../schema'
import { honestNodePatch } from './node-patch'

/**
 * An agent's edit of a node does what it says, or says why not. A pier's `material: {color}`
 * reported "applied" and stored `{}`; `materialPreset: null` was refused; a `material`
 * set under a preset never showed. What goes wrong, written first: a field the schema drops
 * reported applied; a value the schema changes (an unknown preset turned "custom") kept quiet; a
 * material the library lacks stored and rendered grey; no way to clear a field; an edit a set
 * field hides; free-form metadata refused.
 */

const pier = () =>
  ColumnNode.parse({
    id: 'column_pier',
    parentId: 'level_p',
    position: [8, 0, 2],
    materialPreset: 'library:concrete-raw',
  })
const refusal = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    if (isAgentRefusal(error)) return error
    throw error
  }
  throw new Error('not refused')
}

describe('honest patches', () => {
  test('a field the schema would drop is refused, naming its path and where a colour goes', () => {
    const error = refusal(() => honestNodePatch(pier(), { material: { color: '#8a8a8a' } }))
    expect(error.code).toBe('unknown_field')
    expect(error.message).toContain('material.color')
    expect(error.message).toContain('material.properties.color')
  })

  test('a value the schema would change is refused, naming it', () => {
    const error = refusal(() =>
      honestNodePatch(pier(), { materialPreset: null, material: { preset: 'granite' } }),
    )
    expect(error.code).toBe('unknown_field')
    expect(error.message).toContain('material.preset')
  })

  test('a material the library lacks is refused, naming the nearest', () => {
    const error = refusal(() => honestNodePatch(pier(), { materialPreset: 'library:grey-render' }))
    expect(error.code).toBe('unknown_material')
    expect(error.message).toContain('library:grey-render')
    expect(error.message).toContain('Nearest')
  })

  test("a patch's unknown material is offered the materials of its node's surface", () => {
    const slab = SlabNode.parse({
      id: 'slab_p',
      parentId: 'level_p',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    })
    const error = refusal(() => honestNodePatch(slab, { slots: { surface: 'library:oak-boards' } }))
    expect(error.code).toBe('unknown_material')
    const nearest = (error.details as { nearest: string[] }).nearest
    expect(nearest.length).toBeGreaterThan(0)
    for (const ref of nearest) {
      const id = ref.replace(/^library:/, '').split(' ')[0]!
      expect(getCatalogMaterialById(id)?.surfaces).toContain('floor')
    }
  })

  test('null clears an optional field; a required one is refused', () => {
    expect(honestNodePatch(pier(), { materialPreset: null })).toEqual({ materialPreset: undefined })
    const wall = WallNode.parse({ id: 'wall_p', parentId: 'level_p', start: [0, 0], end: [4, 0] })
    expect(refusal(() => honestNodePatch(wall, { start: null })).code).toBe('field_required')
  })

  test('a material a set preset would hide is refused, naming the preset to clear', () => {
    const material = { preset: 'custom', properties: { color: '#8a8a8a' } }
    const error = refusal(() => honestNodePatch(pier(), { material }))
    expect(error.code).toBe('shadowed_field')
    expect(error.message).toContain('materialPreset')
    expect(honestNodePatch(pier(), { material, materialPreset: null })).toEqual({
      material,
      materialPreset: undefined,
    })
  })

  test('free-form metadata and a plain edit pass as sent', () => {
    expect(
      honestNodePatch(pier(), { metadata: { note: 'from run 3', any: { depth: 1 } } }),
    ).toEqual({
      metadata: { note: 'from run 3', any: { depth: 1 } },
    })
    expect(honestNodePatch(pier(), { height: 2.4 })).toEqual({ height: 2.4 })
    expect(AgentRefusal).toBeDefined()
  })
})
