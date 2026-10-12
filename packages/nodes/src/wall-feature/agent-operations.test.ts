import { expect, test } from 'bun:test'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'
import { type AnyNode, LevelNode, WallNode } from '@pascal-app/core/schema'
import { wallFeatureAgentOperations, wallFeatureAgentTools } from '@pascal-app/nodes'

function fixture() {
  const level = LevelNode.parse({ height: 3 })
  const wall = WallNode.parse({
    parentId: level.id,
    start: [0, 0],
    end: [4, 0],
    thickness: 0.3,
    height: 2.7,
    children: [],
  })
  level.children = [wall.id]
  return { nodes: { [level.id]: level, [wall.id]: wall } as Record<string, AnyNode>, wall }
}

function apply(
  nodes: Record<string, AnyNode>,
  outcome: ReturnType<typeof wallFeatureAgentOperations.pascal_create_wall_feature>,
) {
  const next = { ...nodes }
  for (const create of outcome.changes?.create ?? []) next[create.node.id] = create.node
  for (const update of outcome.changes?.update ?? [])
    if (next[update.id]) next[update.id] = { ...next[update.id]!, ...update.data } as AnyNode
  return next
}

test('wall-feature agent contracts and operations share placement validation and hierarchy writes', () => {
  const { nodes, wall } = fixture()
  const [createContract, updateContract] = wallFeatureAgentTools.tools
  expect(createContract!.input.width.safeParse(0.8).success).toBe(true)
  expect(createContract!.input.width.safeParse(-0.8).success).toBe(false)
  expect(updateContract!.name).toBe('pascal_update_wall_feature')

  const bumpOutcome = wallFeatureAgentOperations.pascal_create_wall_feature(nodes, {
    hostId: wall.id,
    mode: 'bump',
    face: 'b',
    u: 2,
    bottom: 0.4,
    width: 1,
    height: 1.2,
    depth: 0.15,
    finishRef: 'library:preset-white',
  })
  let next = apply(nodes, bumpOutcome)
  const bump = next[bumpOutcome.result.featureId as string]!
  expect(bump).toMatchObject({ type: 'wall-feature', mode: 'bump', face: 'b' })
  expect(next[wall.id]!.children).toContain(bump.id)

  const nicheOutcome = wallFeatureAgentOperations.pascal_create_wall_feature(next, {
    hostId: bump.id,
    mode: 'niche',
    u: 0.5,
    bottom: 0.2,
    width: 0.5,
    height: 0.5,
    depth: 0.2,
  })
  next = apply(next, nicheOutcome)
  const niche = next[nicheOutcome.result.featureId as string]!
  expect(niche.parentId).toBe(bump.id)
  expect(next[bump.id]!.children).toContain(niche.id)

  const update = wallFeatureAgentOperations.pascal_update_wall_feature(next, {
    featureId: niche.id,
    finishRef: 'library:wood-woodplank48',
  })
  expect(update.changes?.update?.[0]?.data).toMatchObject({
    slots: { surface: 'library:wood-woodplank48' },
  })

  try {
    wallFeatureAgentOperations.pascal_update_wall_feature(next, {
      featureId: niche.id,
      width: 2,
    })
    throw new Error('expected out-of-bounds refusal')
  } catch (error) {
    expect(isAgentRefusal(error)).toBe(true)
    expect((error as { code: string }).code).toBe('wall_feature_out_of_bounds')
  }
})
