import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  clearSceneHistory,
  LawnNode,
  SiteNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { createLawnBrushStroke } from './brush'
import { lawnRenderDefinition } from './definition.render'
import { createLawnMoveSession } from './floorplan-move'
import {
  LAWN_STROKE_REBUILD_MS,
  LAWN_STROKE_REBUILD_SHARE,
  lawnGeometryKey,
  noteLawnBuild,
} from './stroke-rebuild'

const outline: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]
const site = SiteNode.parse({ id: 'site_spaced', children: ['lawn_spaced'] })
const lawn = LawnNode.parse({ id: 'lawn_spaced', parentId: site.id, outline })
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

// The viewer rebuilds a dirty lawn unless its key is the one it last built with (its
// `shouldReuseGeometryBuild`). `rebuilt` is that rule, with the clock in the test's hands.
function viewer() {
  let built: string | undefined
  return {
    rebuilt(now: number): boolean {
      const key = lawnGeometryKey(lawn, now)
      const changed = key !== built
      built = key
      return changed
    },
  }
}

test('the lawn hands the viewer the key that spaces stroke rebuilds', () => {
  expect(lawnRenderDefinition.geometryKey).toBe(lawnGeometryKey)
})

test('pointer samples of a stroke in progress do not each rebuild the whole lawn', () => {
  const view = viewer()
  expect(view.rebuilt(0)).toBe(true)
  const stroke = createLawnBrushStroke(lawn, settings, [1, 1])
  if (!stroke) throw new Error('Expected a stroke')
  try {
    // The first dab shows at once; the samples that follow inside the spacing keep that build.
    expect(view.rebuilt(1000)).toBe(true)
    let rebuilds = 0
    for (let sample = 1; sample <= 20; sample++) {
      expect(stroke.move([1 + sample * 0.1, 1 + (sample % 3) * 0.2])).toBe(true)
      if (view.rebuilt(1000 + sample * 5)) rebuilds++
    }
    expect(rebuilds).toBe(0)
    // Every sample still reached the proposed lawn: only the 3D rebuild is spaced.
    expect(useLiveNodeOverrides.getState().overrides.get(lawn.id)?.strokes).toHaveLength(1)
    // Once the spacing has passed, the next sample rebuilds once, with everything painted so far.
    expect(view.rebuilt(1000 + LAWN_STROKE_REBUILD_MS)).toBe(true)
    expect(view.rebuilt(1000 + LAWN_STROKE_REBUILD_MS + 5)).toBe(false)
  } finally {
    stroke.cancel()
  }
})

test('a lawn that is slow to build spaces its stroke rebuilds further apart', () => {
  const view = viewer()
  const stroke = createLawnBrushStroke(lawn, settings, [1, 1])
  if (!stroke) throw new Error('Expected a stroke')
  try {
    expect(view.rebuilt(0)).toBe(true)
    const cost = LAWN_STROKE_REBUILD_MS
    noteLawnBuild(lawn.id, cost)
    const spacing = cost / LAWN_STROKE_REBUILD_SHARE
    expect(spacing).toBeGreaterThan(LAWN_STROKE_REBUILD_MS)
    expect(view.rebuilt(LAWN_STROKE_REBUILD_MS + 1)).toBe(false)
    expect(view.rebuilt(spacing - 1)).toBe(false)
    expect(view.rebuilt(spacing)).toBe(true)
  } finally {
    stroke.cancel()
  }
})

test('release and cancel rebuild at once, and the saved stroke is the one painted', () => {
  const view = viewer()
  const stroke = createLawnBrushStroke(lawn, settings, [1, 1])
  if (!stroke) throw new Error('Expected a stroke')
  expect(view.rebuilt(0)).toBe(true)
  stroke.move([2, 1])
  stroke.move([3, 2])
  expect(view.rebuilt(1)).toBe(false)
  expect(stroke.commit()).toBe(true)
  expect(view.rebuilt(2)).toBe(true)
  expect(current().strokes).toEqual([
    {
      ...settings,
      points: [
        [1, 1],
        [2, 1],
        [3, 2],
      ],
    },
  ])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)

  const dropped = createLawnBrushStroke(current(), settings, [3, 3])
  if (!dropped) throw new Error('Expected a second stroke')
  expect(view.rebuilt(3)).toBe(true)
  dropped.move([2, 3])
  expect(view.rebuilt(4)).toBe(false)
  dropped.cancel()
  expect(view.rebuilt(5)).toBe(true)
})

test('without a stroke in progress every dirty mark rebuilds, as a change of the Site needs', () => {
  const view = viewer()
  expect(view.rebuilt(0)).toBe(true)
  expect(view.rebuilt(0)).toBe(true)
  expect(view.rebuilt(1)).toBe(true)
})

test('dragging a lawn, which also previews through overrides, is not spaced', () => {
  const painted = LawnNode.parse({ ...lawn, strokes: [{ ...settings, points: [[1, 1]] }] })
  useScene.setState({ nodes: { [site.id]: site, [lawn.id]: painted } })
  const view = viewer()
  const session = createLawnMoveSession({ node: painted, nodes: useScene.getState().nodes })
  const modifiers = { altKey: true, shiftKey: false, ctrlKey: false, metaKey: false }
  session.apply({ planPoint: [2, 2], modifiers })
  expect(view.rebuilt(0)).toBe(true)
  session.apply({ planPoint: [3, 4], modifiers })
  expect(view.rebuilt(1)).toBe(true)
  session.cancel?.()
})

test('a pointer that rests mid-stroke gets its last samples drawn, and nothing fires after the end', async () => {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const stroke = createLawnBrushStroke(lawn, settings, [1, 1])
  if (!stroke) throw new Error('Expected a stroke')
  const built = lawnGeometryKey(lawn)
  stroke.move([2, 1])
  expect(lawnGeometryKey(lawn)).toBe(built)
  useScene.getState().clearDirty(lawn.id)
  await wait(LAWN_STROKE_REBUILD_MS + 60)
  expect(useScene.getState().dirtyNodes.has(lawn.id)).toBe(true)
  expect(lawnGeometryKey(lawn)).not.toBe(built)

  stroke.move([3, 1])
  stroke.cancel()
  useScene.getState().clearDirty(lawn.id)
  await wait(LAWN_STROKE_REBUILD_MS + 60)
  expect(useScene.getState().dirtyNodes.has(lawn.id)).toBe(false)
})
