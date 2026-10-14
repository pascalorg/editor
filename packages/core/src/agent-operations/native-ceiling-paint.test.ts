import { describe, expect, test } from 'bun:test'
import { isAgentRefusal } from '../agent-tools/refusal'
import { type AnyNode, CeilingNode, LevelNode, SlabNode, WallNode } from '../schema'
import { applySceneChanges } from './apply-changes'
import { paint } from './paint'

// Independent oracle: Main's approved native-ceiling finish contract, derived
// before candidate inspection. The existing ceiling renderer consumes
// slots.surface. Erase parity was clarified by Main against the unchanged UI
// slot painter: buildPatch/commit remove only the slot, retaining raw legacy
// material fields (which can become visible again). Load-time migration is a
// different seam, not a reset-to-default guarantee of paint. No renderer, store,
// DB or provider is invoked here: only pure Core operations on an in-memory scene.
const requestedFinish = 'library:concrete-raw'
const previousFinish = 'library:preset-nearblack'
const context = { activeLevelId: 'level_finish' }

function fixture() {
  const ceiling = CeilingNode.parse({
    id: 'ceiling_finish',
    parentId: context.activeLevelId,
    polygon: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
    holes: [
      [
        [1, 1],
        [2, 1],
        [2, 2],
        [1, 2],
      ],
    ],
    height: 2.65,
    regions: [
      {
        id: 'accent',
        polygon: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
        finish: previousFinish,
      },
    ],
    slots: { surface: previousFinish, retained: requestedFinish },
    materialPreset: 'white',
    material: { preset: 'custom', properties: { color: '#123456' } },
    metadata: { authoredBy: 'person' },
  })
  const wall = WallNode.parse({
    id: 'wall_finish',
    parentId: context.activeLevelId,
    start: [0, 0],
    end: [4, 0],
    slots: { a: previousFinish, b: previousFinish },
  })
  const slab = SlabNode.parse({
    id: 'slab_finish',
    parentId: context.activeLevelId,
    polygon: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
    slots: { surface: previousFinish },
  })
  const level = LevelNode.parse({
    id: context.activeLevelId,
    children: [ceiling.id, wall.id, slab.id],
  })
  const nodes: Record<string, AnyNode> = {
    [level.id]: level,
    [ceiling.id]: ceiling,
    [wall.id]: wall,
    [slab.id]: slab,
  }
  return { nodes, ceiling, wall, slab }
}

function withoutFinish(ceiling: CeilingNode) {
  const { slots: _slots, material: _material, materialPreset: _preset, ...rest } = ceiling
  return rest
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value)) freeze(child)
  }
  return value
}

describe('native ceiling paint writes the renderable surface, not metadata or custom geometry', () => {
  test.each([
    undefined,
    'surface',
  ])('default/explicit surface role %s preserves scene identity and other surfaces', (role) => {
    const { nodes, ceiling, wall, slab } = fixture()
    const before = structuredClone(nodes)
    freeze(nodes)
    const result = paint(
      nodes,
      {
        targets: [ceiling.id],
        material: requestedFinish,
        ...(role ? { role } : {}),
      },
      context,
    )
    const after = applySceneChanges(nodes, result.changes)
    const painted = CeilingNode.parse(after[ceiling.id])
    expect(result.result).toMatchObject({
      ok: true,
      painted: [{ id: ceiling.id, roles: ['surface'] }],
    })
    expect(painted.slots).toEqual({ surface: requestedFinish, retained: requestedFinish })
    expect(withoutFinish(painted)).toEqual(withoutFinish(ceiling))
    expect(Object.keys(after)).toEqual(Object.keys(nodes))
    expect(after[wall.id]).toEqual(before[wall.id])
    expect(after[slab.id]).toEqual(before[slab.id])
    expect(after[context.activeLevelId]).toEqual(before[context.activeLevelId])
    expect(nodes).toEqual(before)
  })

  test.each([
    'slot-and-legacy',
    'legacy-only',
  ] as const)('erase %s matches UI slot removal while preserving legacy fields and regions', (mode) => {
    const { nodes, ceiling } = fixture()
    if (mode === 'legacy-only') ceiling.slots = { retained: requestedFinish }
    const before = structuredClone(nodes)
    freeze(nodes)
    const result = paint(nodes, { targets: [ceiling.id], erase: true }, context)
    const after = applySceneChanges(nodes, result.changes)
    const erased = CeilingNode.parse(after[ceiling.id])
    expect(erased.slots?.surface).toBeUndefined()
    expect(erased.slots?.retained).toBe(requestedFinish)
    expect(erased.material).toEqual(ceiling.material)
    expect(erased.materialPreset).toBe(ceiling.materialPreset)
    expect(withoutFinish(erased)).toEqual(withoutFinish(ceiling))
    expect(Object.keys(after)).toEqual(Object.keys(nodes))
    for (const [id, node] of Object.entries(before)) {
      if (id !== ceiling.id) expect(after[id]).toEqual(node)
    }
    expect(nodes).toEqual(before)
  })

  test.each([
    {
      name: 'missing later target',
      targets: ['ceiling_finish', 'wall_retired'],
      code: 'target_not_found',
      target: 'wall_retired',
    },
    {
      name: 'later ceiling lacks a wall-face role',
      targets: ['wall_finish', 'ceiling_finish'],
      role: 'a',
      code: 'unknown_role',
      target: 'ceiling_finish',
    },
  ])('$name refuses atomically, including earlier valid targets', ({
    targets,
    role,
    code,
    target,
  }) => {
    const { nodes } = fixture()
    const before = structuredClone(nodes)
    freeze(nodes)
    let refusal: unknown
    try {
      paint(nodes, { targets, material: requestedFinish, ...(role ? { role } : {}) }, context)
    } catch (error) {
      refusal = error
    }
    expect(isAgentRefusal(refusal)).toBe(true)
    expect(refusal).toMatchObject({ code, details: { target } })
    expect(nodes).toEqual(before)
  })
})
