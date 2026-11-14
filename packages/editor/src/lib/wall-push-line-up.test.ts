import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { clearSceneHistory, nodeRegistry, useScene, WallNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useAlignmentGuides from '../store/use-alignment-guides'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import { installImmediateAnimationFrames } from '../test-utils/immediate-animation-frames'
import { seedRoundTripScene } from '../test-utils/live-gesture-round-trip'
import { cancelGestures } from './gesture-lifecycle'
import { runWallPushDrag, wallPushHandles } from './room-handle-drag'
import { nextInStack } from './selection-cycle'

// A side arrow push lines the wall up with a parallel wall before the grid, as
// the wall moves do; Alt pushes it free.

const LEVEL = 'level_push_line_up'
const stubbed: string[] = []
let stop = () => {}
let restoreFrames = () => {}
let registry: { mockRestore: () => void } | null = null

const nodes = () => useScene.getState().nodes
const eastWall = () =>
  Object.values(nodes()).find(
    (n): n is WallNode => n.type === 'wall' && n.start[0] === 6 && n.end[0] === 6,
  )!

function pointer(type: 'pointermove' | 'pointerup', clientX: number, altKey = false) {
  window.dispatchEvent(Object.assign(new Event(type), { clientX, clientY: 0, altKey }))
}

beforeEach(() => {
  restoreFrames = installImmediateAnimationFrames()
  if (!globalThis.document) {
    globalThis.document = { body: { style: { cursor: '' } } } as unknown as Document
    stubbed.push('document')
  }
  if (!globalThis.window) {
    globalThis.window = new EventTarget() as Window & typeof globalThis
    stubbed.push('window')
  }
  // The nodes package that registers walls is not loaded here.
  const get = nodeRegistry.get.bind(nodeRegistry)
  registry = spyOn(nodeRegistry, 'get').mockImplementation(((kind: string) =>
    kind === 'wall' ? { snapProfile: 'structural' } : get(kind)) as typeof nodeRegistry.get)
  cancelGestures('cancel')
  useInteractionScope.getState().end()
  useScene.temporal.getState().resume()
  ;({ stop } = seedRoundTripScene('building_push_line_up', LEVEL))
  // An outside wall standing apart, 0.3 m east of the room's east wall line.
  const apart = WallNode.parse({
    id: 'wall_apart',
    start: [6.3, 6],
    end: [6.3, 9],
    frontSide: 'exterior',
    backSide: 'interior',
  })
  useScene.getState().applyNodeChanges({ create: [{ node: apart, parentId: LEVEL as never }] })
  useViewer.getState().setSelection({
    buildingId: 'building_push_line_up',
    levelId: LEVEL,
    selectedIds: [],
  })
  useEditor.setState({ phase: 'building', mode: 'select', gridSnapStep: 0.5 })
  useEditor.getState().setSnappingMode('polygon', 'grid')
  clearSceneHistory()
})

afterEach(() => {
  cancelGestures('cancel')
  stop()
  registry?.mockRestore()
  registry = null
  restoreFrames()
})

afterAll(async () => {
  // Let the click-swallow timers fire before the stubs go.
  await new Promise((resolve) => setTimeout(resolve, 350))
  for (const key of stubbed.splice(0)) delete (globalThis as Record<string, unknown>)[key]
})

function startPush() {
  const handle = wallPushHandles(eastWall(), nodes()).find((h) => h.outward[0] > 0.5)!
  runWallPushDrag({ handle, levelId: LEVEL, from: 0, along: (clientX) => clientX })
  return eastWall().id
}

describe('wall push line-up', () => {
  test('a push near a parallel outside wall lands on its line, guide shown while it holds', () => {
    expect(eastWall().frontSide === 'exterior' || eastWall().backSide === 'exterior').toBe(true)
    const id = startPush()
    pointer('pointermove', 0.24)
    expect(useAlignmentGuides.getState().draft?.lines).toHaveLength(1)
    pointer('pointerup', 0.24)
    expect(useAlignmentGuides.getState().draft).toBeNull()
    const wall = nodes()[id as never] as WallNode
    expect(wall.start[0]).toBeCloseTo(6.3, 9)
    expect(wall.end[0]).toBeCloseTo(6.3, 9)
  })

  test('away from any line the push still steps on the grid', () => {
    const id = startPush()
    pointer('pointermove', 0.9)
    pointer('pointerup', 0.9)
    expect((nodes()[id as never] as WallNode).start[0]).toBeCloseTo(7, 9)
  })

  test('Alt pushes it free', () => {
    const id = startPush()
    pointer('pointermove', 0.24, true)
    expect(useAlignmentGuides.getState().draft).toBeNull()
    pointer('pointerup', 0.24, true)
    expect((nodes()[id as never] as WallNode).start[0]).toBeCloseTo(6.24, 9)
  })
})

describe('Tab through stacked objects', () => {
  test('steps to the next one under the pointer and wraps round', () => {
    const stack = ['wall_top', 'wall_inside', 'zone_room']
    expect(nextInStack(stack, [], false)).toBe('wall_top')
    expect(nextInStack(stack, ['wall_top'], false)).toBe('wall_inside')
    expect(nextInStack(stack, ['zone_room'], false)).toBe('wall_top')
  })

  test('Shift+Tab steps back; a selection elsewhere starts at the top', () => {
    const stack = ['wall_top', 'wall_inside']
    expect(nextInStack(stack, ['wall_top'], true)).toBe('wall_inside')
    expect(nextInStack(stack, ['wall_other'], true)).toBe('wall_top')
    expect(nextInStack([], ['wall_top'], false)).toBeNull()
  })
})
