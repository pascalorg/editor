import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  buildLawn,
  clearSceneHistory,
  LAWN_LIMITS,
  LawnNode,
  type LawnStroke,
  SiteNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { addSiteSurface, lawnPatchFacts } from '@pascal-app/core/agent-operations'
import { createLawnBrushStroke } from './brush'
import { createLawnOutlineSession } from './definition.edit-session'
import { createLawnMoveSession } from './floorplan-move'

const outline: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]
const site = SiteNode.parse({ id: 'site_brush', children: ['lawn_brush'] })
const lawn = LawnNode.parse({ id: 'lawn_brush', parentId: site.id, outline })
const settings = { radiusM: 0.5, effect: 'bare', strength: 0.75 } as const
let savedScene: ReturnType<typeof useScene.getState>
let savedOverrides: ReturnType<typeof useLiveNodeOverrides.getState>
const current = () => {
  const node = useScene.getState().nodes[lawn.id]
  if (node?.type !== 'lawn') throw new Error('Expected the authored lawn')
  return node
}
beforeEach(() => {
  savedScene = useScene.getState()
  savedOverrides = useLiveNodeOverrides.getState()
  useScene.setState({ nodes: { [site.id]: site, [lawn.id]: lawn }, rootNodeIds: [site.id] })
  useLiveNodeOverrides.getState().clearAll()
  clearSceneHistory()
})
afterEach(() => {
  useScene.setState(savedScene)
  useLiveNodeOverrides.setState(savedOverrides)
  clearSceneHistory()
})

test('one hand stroke previews without scene writes, commits one undo, and replays like agent-authored strokes', () => {
  const before = useScene.getState().nodes
  const hand = createLawnBrushStroke(lawn, settings, [1, 1])
  expect(hand).not.toBeNull()
  if (!hand) return
  hand.move([2, 1])
  hand.move([3, 2])
  expect(useScene.getState().nodes).toBe(before)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  const strokes: LawnStroke[] = [
    {
      ...settings,
      points: [
        [1, 1],
        [2, 1],
        [3, 2],
      ],
    },
  ]
  expect(useLiveNodeOverrides.getState().overrides.get(lawn.id)?.strokes).toEqual(strokes)
  expect(hand.commit()).toBe(true)
  expect(current().strokes).toEqual(strokes)
  expect(useLiveNodeOverrides.getState().overrides.has(lawn.id)).toBe(false)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  const authored = addSiteSurface(
    { [site.id]: { ...site, children: [] } },
    { kind: 'lawn', polygon: outline, siteId: site.id, strokes },
    { activeLevelId: null },
  ).changes?.create?.[0]?.node
  const agent = LawnNode.parse(authored)
  const handBuild = buildLawn(current(), useScene.getState().nodes)
  const agentBuild = buildLawn(agent, { [site.id]: site, [agent.id]: agent })
  const bytes = (array: ArrayBufferView) =>
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
  for (const part of ['base', 'flowers'] as const) {
    for (const attribute of ['positions', 'normals', 'colors', 'indices'] as const)
      expect(bytes(agentBuild[part][attribute])).toEqual(bytes(handBuild[part][attribute]))
  }
  expect(bytes(agentBuild.blades.rootHeight)).toEqual(bytes(handBuild.blades.rootHeight))
  expect(bytes(agentBuild.blades.traits)).toEqual(bytes(handBuild.blades.traits))
  expect(bytes(agentBuild.flowers.headIndexEnds)).toEqual(bytes(handBuild.flowers.headIndexEnds))
  expect(agentBuild.blades.chunks).toEqual(handBuild.blades.chunks)
  expect(agentBuild.facts).toEqual(handBuild.facts)
  useScene.temporal.getState().undo()
  expect(current().strokes).toEqual([])
})

test('cancelling a stroke drops overrides without a write or undo entry, including a late release', () => {
  const before = useScene.getState().nodes
  const stroke = createLawnBrushStroke(lawn, settings, [1, 1])
  if (!stroke) throw new Error('Valid stroke must start')
  stroke.move([3, 3])
  stroke.cancel()
  expect(stroke.commit()).toBe(false)
  expect(useScene.getState().nodes).toBe(before)
  expect(useLiveNodeOverrides.getState().overrides.has(lawn.id)).toBe(false)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('stroke bounds reject before writing; long in-flight paths keep both endpoints without losing old intent', () => {
  const full = LawnNode.parse({
    ...lawn,
    strokes: Array.from({ length: LAWN_LIMITS.maxStrokePoints }, () => ({
      ...settings,
      points: [[1, 1]],
    })),
  })
  useScene.setState({ nodes: { [site.id]: site, [full.id]: full } })
  clearSceneHistory()
  const before = useScene.getState().nodes
  expect(createLawnBrushStroke(full, settings, [1, 1])).toBeNull()
  expect(createLawnBrushStroke(full, { ...settings, radiusM: Infinity }, [1, 1])).toBeNull()
  expect(useScene.getState().nodes).toBe(before)
  useScene.setState({ nodes: { [site.id]: site, [lawn.id]: lawn } })
  clearSceneHistory()
  const stroke = createLawnBrushStroke(lawn, settings, [0, 0])
  if (!stroke) throw new Error('Valid stroke must start')
  for (let i = 1; i <= 500; i++) stroke.move([i / 100, 1])
  expect(stroke.move([NaN, 0])).toBe(false)
  expect(stroke.move([100001, 0])).toBe(false)
  expect(stroke.commit()).toBe(true)
  const points = current().strokes[0]?.points
  expect(points?.length).toBeLessThanOrEqual(128)
  expect(points?.[0]).toEqual([0, 0])
  expect(points?.at(-1)).toEqual([5, 1])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
})

test('more than 64 hand dabs share a point budget without rewriting earlier strokes', () => {
  const saved = Array.from({ length: 65 }, () => ({ ...settings, points: [[1, 1]] }))
  const painted = LawnNode.parse({ ...lawn, strokes: saved })
  useScene.setState({ nodes: { [site.id]: site, [lawn.id]: painted } })
  clearSceneHistory()
  const stroke = createLawnBrushStroke(painted, settings, [2, 2])
  if (!stroke) throw new Error('A 66th dab must fit the shared point budget')
  expect(stroke.commit()).toBe(true)
  expect(current().strokes).toHaveLength(66)
  expect(current().strokes.slice(0, -1)).toEqual(saved)
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(current().strokes).toEqual(saved)
})

test('long straight strokes stay at two saved points while corners and reversals remain', () => {
  const stroke = createLawnBrushStroke(lawn, settings, [0, 1])
  if (!stroke) throw new Error('A valid stroke must start')
  for (let index = 1; index <= 500; index++) expect(stroke.move([index / 100, 1])).toBe(true)
  expect(useLiveNodeOverrides.getState().overrides.get(lawn.id)?.strokes).toEqual([
    {
      ...settings,
      points: [
        [0, 1],
        [5, 1],
      ],
    },
  ])
  expect(stroke.move([5, 2])).toBe(true)
  expect(stroke.move([5, 1])).toBe(true)
  expect(stroke.move([4, 1])).toBe(true)
  expect(stroke.commit()).toBe(true)
  expect(current().strokes[0]?.points).toEqual([
    [0, 1],
    [5, 1],
    [5, 2],
    [5, 1],
    [4, 1],
  ])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
})

test('small pointer jitter simplifies within brush-scale error rather than consuming a point per event', () => {
  const stroke = createLawnBrushStroke(lawn, settings, [0, 1])
  if (!stroke) throw new Error('A valid stroke must start')
  for (let index = 1; index <= 500; index++)
    expect(stroke.move([index / 100, 1 + (index % 2 ? 0.002 : 0)])).toBe(true)
  expect(stroke.commit()).toBe(true)
  const points = current().strokes[0]?.points
  expect(points?.length).toBeLessThanOrEqual(8)
  expect(points?.[0]).toEqual([0, 1])
  expect(points?.at(-1)).toEqual([5, 1])
})

test('sustained near-stationary jitter finalizes bounded sample windows and keeps painting', () => {
  const before = useScene.getState().nodes
  const refused: string[] = []
  const stroke = createLawnBrushStroke(lawn, settings, [0, 1], (code) => refused.push(code))
  if (!stroke) throw new Error('A valid stroke must start')
  for (let index = 0; index < 1024; index++)
    expect(stroke.move([1, index % 2 ? 1.002 : 1])).toBe(true)
  expect(useScene.getState().nodes).toBe(before)
  expect(stroke.commit()).toBe(true)
  const points = current().strokes[0]?.points
  // Periodic endpoints make progress instead of retaining an unlimited raw pointer history.
  expect(points?.length).toBeGreaterThan(2)
  expect(points?.length).toBeLessThanOrEqual(16)
  expect(points?.[0]).toEqual([0, 1])
  expect(points?.at(-1)).toEqual([1, 1.002])
  expect(refused).toEqual([])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(current().strokes).toEqual([])
})

test('detailed strokes may exceed 128 points without resampling away their corners', () => {
  const small = LawnNode.parse({
    ...lawn,
    outline: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  })
  useScene.setState({ nodes: { [site.id]: site, [lawn.id]: small } })
  clearSceneHistory()
  const first: [number, number] = [0.1, 0.4]
  const stroke = createLawnBrushStroke(small, { ...settings, effect: 'taller' }, first)
  if (!stroke) throw new Error('A valid stroke must start')
  const points: [number, number][] = [first]
  for (let index = 1; index <= 160; index++) {
    const point: [number, number] = [0.1 + index / 200, index % 2 ? 0.6 : 0.4]
    points.push(point)
    expect(stroke.move(point)).toBe(true)
  }
  expect(stroke.commit()).toBe(true)
  expect(current().strokes[0]?.points).toEqual(points)
})

test('point-budget refusal during painting is explicit and drops the whole gesture atomically', () => {
  const saved: LawnStroke[] = [
    {
      ...settings,
      points: Array.from({ length: LAWN_LIMITS.maxStrokePoints - 1 }, () => [100, 100]),
    },
  ]
  const almostFull = LawnNode.parse({
    ...lawn,
    outline: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    strokes: saved,
  })
  useScene.setState({ nodes: { [site.id]: site, [lawn.id]: almostFull } })
  clearSceneHistory()
  const before = useScene.getState().nodes
  const refused: string[] = []
  const counts: number[] = []
  const stroke = createLawnBrushStroke(
    almostFull,
    settings,
    [0.5, 0.5],
    (code) => refused.push(code),
    (count) => counts.push(count),
  )
  if (!stroke) throw new Error('The final point must fit')
  expect(counts).toEqual([LAWN_LIMITS.maxStrokePoints])
  expect(stroke.move([0.75, 0.5])).toBe(false)
  expect(refused).toEqual(['point-budget'])
  expect(stroke.commit()).toBe(false)
  expect(useScene.getState().nodes).toBe(before)
  expect(current().strokes).toEqual(saved)
  expect(useLiveNodeOverrides.getState().overrides.has(lawn.id)).toBe(false)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('an intervening agent edit to the stroke list is not overwritten by an in-flight hand stroke', () => {
  const stroke = createLawnBrushStroke(lawn, settings, [1, 1])
  if (!stroke) throw new Error('Valid stroke must start')
  const agentStroke: LawnStroke = { ...settings, effect: 'grass', points: [[2, 2]] }
  useScene.getState().updateNode(lawn.id, { strokes: [agentStroke] })
  expect(stroke.commit()).toBe(false)
  expect(current().strokes).toEqual([agentStroke])
  expect(useLiveNodeOverrides.getState().overrides.has(lawn.id)).toBe(false)
})

test('more flowers on a default lawn requires an explicit species and commits that choice with the stroke', () => {
  expect(createLawnBrushStroke(lawn, { ...settings, effect: 'more-flowers' }, [1, 1])).toBeNull()
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  const stroke = createLawnBrushStroke(
    lawn,
    {
      ...settings,
      effect: 'more-flowers',
      flowerSpecies: 'clover',
      flowerDensity: 1,
    },
    [1, 1],
  )
  if (!stroke) throw new Error('Explicit flower authorship must start')
  expect(current().flowers).toEqual([])
  expect(useLiveNodeOverrides.getState().overrides.get(lawn.id)?.flowers).toEqual([
    { species: 'clover', share: 1 },
  ])
  expect(stroke.commit()).toBe(true)
  expect(current().flowers).toEqual([{ species: 'clover', share: 1 }])
  expect(current().flowerDensity).toBe(1)
  expect(current().strokes[0]?.effect).toBe('more-flowers')
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(current().flowers).toEqual([])
  expect(current().strokes).toEqual([])
})

test('nonfinite coordinates and invalid settings publish neither a preview nor a scene write', () => {
  const before = useScene.getState().nodes
  for (const point of [
    [NaN, 0],
    [Infinity, 0],
    [100001, 0],
  ] satisfies [number, number][]) {
    expect(createLawnBrushStroke(lawn, settings, point)).toBeNull()
  }
  for (const radiusM of [NaN, Infinity, 0.01, 11]) {
    expect(createLawnBrushStroke(lawn, { ...settings, radiusM }, [1, 1])).toBeNull()
  }
  expect(createLawnBrushStroke(lawn, { ...settings, strength: 2 }, [1, 1])).toBeNull()
  expect(useScene.getState().nodes).toBe(before)
  expect(useLiveNodeOverrides.getState().overrides.size).toBe(0)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('outline handles preview through overrides and refuse invalid boundaries without an undo entry', () => {
  const before = useScene.getState().nodes
  const session = createLawnOutlineSession(lawn)
  session.preview([
    [0, 0],
    [5, 0],
    [5, 4],
    [0, 4],
  ])
  expect(useScene.getState().nodes).toBe(before)
  expect(session.canCommit()).toBe(true)
  session.commit()
  expect(current().outline[1]).toEqual([5, 0])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  const invalid = createLawnOutlineSession(current())
  invalid.preview([
    [0, 0],
    [4, 4],
    [4, 0],
    [0, 4],
  ])
  expect(invalid.canCommit()).toBe(false)
  invalid.commit()
  expect(current().outline).toEqual(outline)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('moving a lawn carries its Site-space strokes and outline together in one undo step', () => {
  const painted = LawnNode.parse({ ...lawn, strokes: [{ ...settings, points: [[1, 1]] }] })
  useScene.setState({ nodes: { [site.id]: site, [lawn.id]: painted } })
  clearSceneHistory()
  const before = useScene.getState().nodes
  const session = createLawnMoveSession({ node: painted, nodes: before })
  session.apply({
    planPoint: [2, 2],
    modifiers: { altKey: true, shiftKey: false, ctrlKey: false, metaKey: false },
  })
  session.apply({
    planPoint: [3, 4],
    modifiers: { altKey: true, shiftKey: false, ctrlKey: false, metaKey: false },
  })
  expect(useScene.getState().nodes).toBe(before)
  expect(session.canCommit()).toBe(true)
  session.commit?.()
  expect(current().outline[0]).toEqual([1, 2])
  expect(current().strokes[0]?.points).toEqual([[2, 3]])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  useScene.temporal.getState().undo()
  expect(current().outline).toEqual(outline)
  expect(current().strokes).toEqual(painted.strokes)
})

test('hand and agent refuse combined stroke work before preview or history writes', () => {
  const largeOutline: [number, number][] = [
    [0, 0],
    [20, 0],
    [20, 30],
    [0, 30],
  ]
  const largeSite = SiteNode.parse({ ...site, polygon: { type: 'polygon', points: largeOutline } })
  const points: [number, number][] = Array.from({ length: 128 }, (_, index) => [1 + index / 128, 1])
  const large = LawnNode.parse({
    ...lawn,
    outline: largeOutline,
    strokes: Array.from({ length: 3 }, () => ({ ...settings, points })),
  })
  useScene.setState({ nodes: { [site.id]: largeSite, [lawn.id]: large } })
  clearSceneHistory()
  const before = useScene.getState().nodes
  const refused: string[] = []
  const stroke = createLawnBrushStroke(large, settings, [2, 2], (code) => refused.push(code))
  if (!stroke) throw new Error('One dab must fit the remaining stroke budget')
  for (let index = 1; index <= 100; index++) stroke.move([2 + index / 100, index % 2 ? 2.2 : 2])
  expect(refused).toContain('lawn_work_budget')
  expect(stroke.commit()).toBe(false)
  const overBudget = [...large.strokes, { ...settings, points }]
  expect(() => lawnPatchFacts(large, { strokes: overBudget }, before)).toThrow(/stroke.*budget/)
  expect(() => lawnPatchFacts(large, { strokes: overBudget }, before)).toThrow(/32,000,000/)
  expect(useScene.getState().nodes).toBe(before)
  expect(useLiveNodeOverrides.getState().overrides.has(lawn.id)).toBe(false)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  const invalidExisting = LawnNode.parse({ ...large, strokes: overBudget })
  useScene.setState({ nodes: { [site.id]: largeSite, [lawn.id]: invalidExisting } })
  clearSceneHistory()
  const invalidBefore = useScene.getState().nodes
  refused.length = 0
  expect(
    createLawnBrushStroke(invalidExisting, settings, [2, 2], (code) => refused.push(code)),
  ).toBeNull()
  expect(refused).toEqual(['lawn_work_budget'])
  expect(useScene.getState().nodes).toBe(invalidBefore)
  expect(useLiveNodeOverrides.getState().overrides.has(lawn.id)).toBe(false)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('stroke release rechecks current ground work before the final write', () => {
  const refused: string[] = []
  const stroke = createLawnBrushStroke(lawn, settings, [1, 1], (code) => refused.push(code))
  if (!stroke) throw new Error('A valid dab must start')
  const movedSite = SiteNode.parse({
    ...site,
    polygon: {
      type: 'polygon',
      points: [
        [10, 10],
        [20, 10],
        [20, 20],
        [10, 20],
      ],
    },
  })
  useScene.setState({ nodes: { ...useScene.getState().nodes, [site.id]: movedSite } })
  clearSceneHistory()
  const before = useScene.getState().nodes
  expect(stroke.commit()).toBe(false)
  expect(refused).toEqual(['lawn_empty'])
  expect(useScene.getState().nodes).toBe(before)
  expect(useLiveNodeOverrides.getState().overrides.has(lawn.id)).toBe(false)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})
