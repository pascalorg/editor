
import { describe, expect, it, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  DormerNode,
  type HandleDescriptor,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  type SceneApi,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { resolveWindowHandlePortalTarget, windowDefinition } from './definition'

const windowHandles = windowDefinition.handles as HandleDescriptor<WindowNode>[]

function sceneWith(...nodes: AnyNode[]): SceneApi {
  const byId = Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<
    AnyNodeId,
    AnyNode
  >
  return {
    get: (id: AnyNodeId) => byId[id],
    nodes: () => byId,
  } as SceneApi
}

function handleMax(index: number, window: WindowNode, scene: SceneApi): number {
  const handle = windowHandles[index]
  if (handle?.kind !== 'linear-resize') throw new Error(`Expected linear window handle ${index}`)
  return typeof handle.max === 'function' ? handle.max(window, scene) : (handle.max ?? Infinity)
}

function resizeToMax(index: number, window: WindowNode, scene: SceneApi): Partial<WindowNode> {
  const handle = windowHandles[index]
  if (handle?.kind !== 'linear-resize') throw new Error(`Expected linear window handle ${index}`)
  return handle.apply(window, handleMax(index, window, scene), scene)
}

describe('window handle presentation', () => {
  test('does not register the legacy move arrow', () => {
    const handles = windowDefinition.handles as HandleDescriptor[]

    expect(handles.some((handle) => 'shape' in handle && handle.shape === 'move-cross')).toBe(false)
  })

  test('opts every resize arrow into live grid snapping', () => {
    expect(
      windowHandles.every((handle) => handle.kind !== 'linear-resize' || handle.gridSnap === true),
    ).toBe(true)
  })

  test('portals dormer-window handles outside the roof-segment container', () => {
    const roof = RoofNode.parse({ id: 'roof_test' })
    const segment = RoofSegmentNode.parse({ id: 'rseg_test', parentId: roof.id })
    const dormer = DormerNode.parse({ id: 'dormer_test', parentId: segment.id })
    const window = WindowNode.parse({
      dormerId: dormer.id,
      id: 'window_test',
      parentId: dormer.id,
    })
    const nodes = { [roof.id]: roof, [segment.id]: segment, [dormer.id]: dormer }

    expect(resolveWindowHandlePortalTarget(window, { get: (id) => nodes[id] })).toBe(roof.id)
  })

  test('keeps the level portal for wall-hosted windows', () => {
    const level = LevelNode.parse({ id: 'level_test' })
    const wall = WallNode.parse({
      end: [4, 0],
      id: 'wall_test',
      parentId: level.id,
      start: [0, 0],
    })
    const window = WindowNode.parse({ id: 'window_test', parentId: wall.id, wallId: wall.id })
    const nodes = { [level.id]: level, [wall.id]: wall }

    expect(resolveWindowHandlePortalTarget(window, { get: (id) => nodes[id] })).toBe(level.id)
  })

  test('keeps every resize arrow inside the complete dormer wall', () => {
    const dormer = DormerNode.parse({
      depth: 2,
      height: 1,
      id: 'dormer_test',
      wallSkirtHeight: 2,
      width: 4,
    })
    const window = WindowNode.parse({
      dormerFace: 'front',
      dormerId: dormer.id,
      height: 1,
      id: 'window_test',
      parentId: dormer.id,
      position: [0.5, -0.5, 0],
      width: 1,
    })
    const scene = sceneWith(dormer, window)

    expect(handleMax(0, window, scene)).toBe(3)
    expect(handleMax(1, window, scene)).toBe(2)
    expect(handleMax(2, window, scene)).toBe(2)
    expect(handleMax(3, window, scene)).toBe(2)
    expect(resizeToMax(0, window, scene)).toMatchObject({ position: [-0.5, -0.5, 0], width: 3 })
    expect(resizeToMax(1, window, scene)).toMatchObject({ position: [1, -0.5, 0], width: 2 })
    expect(resizeToMax(2, window, scene)).toMatchObject({ height: 2, position: [0.5, 0, 0] })
    expect(resizeToMax(3, window, scene)).toMatchObject({ height: 2, position: [0.5, -1, 0] })
  })

  test('uses dormer depth as the resize width on a side face', () => {
    const dormer = DormerNode.parse({ depth: 2, id: 'dormer_test', width: 4 })
    const window = WindowNode.parse({
      dormerFace: 'right',
      dormerId: dormer.id,
      id: 'window_test',
      parentId: dormer.id,
      position: [0, -0.5, 0],
      width: 1,
    })

    expect(handleMax(1, window, sceneWith(dormer, window))).toBe(1.5)
  })

  test('reverses the face boundary for a flipped dormer window', () => {
    const dormer = DormerNode.parse({ id: 'dormer_test', width: 4 })
    const window = WindowNode.parse({
      dormerFace: 'front',
      dormerId: dormer.id,
      id: 'window_test',
      parentId: dormer.id,
      position: [0.5, -0.5, 0],
      rotation: [0, Math.PI, 0],
      width: 1,
    })
    const scene = sceneWith(dormer, window)

    expect(handleMax(0, window, scene)).toBe(2)
    expect(handleMax(1, window, scene)).toBe(3)
  })

  test('lets the top arrow use the sloped upper wall of a shed dormer', () => {
    const dormer = DormerNode.parse({
      depth: 4,
      height: 1,
      id: 'dormer_test',
      roofHeight: 2,
      roofType: 'shed',
      shedHighSide: 'back',
      wallSkirtHeight: 2,
      width: 4,
    })
    const window = WindowNode.parse({
      dormerFace: 'right',
      dormerId: dormer.id,
      height: 1,
      id: 'window_test',
      parentId: dormer.id,
      position: [1, -0.5, 0],
      width: 1,
    })

    expect(handleMax(2, window, sceneWith(dormer, window))).toBeCloseTo(3.25)
  })

  test('stops a width arrow at the shed wall slope', () => {
    const dormer = DormerNode.parse({
      depth: 4,
      height: 1,
      id: 'dormer_test',
      roofHeight: 2,
      roofType: 'shed',
      shedHighSide: 'back',
      width: 4,
    })
    const window = WindowNode.parse({
      dormerFace: 'right',
      dormerId: dormer.id,
      height: 1,
      id: 'window_test',
      parentId: dormer.id,
      position: [1, 1.5, 0],
      width: 1,
    })

    expect(handleMax(0, window, sceneWith(dormer, window))).toBeCloseTo(1.5)
  })
})

describe('window resize handles on non-wall hosts', () => {
  it('does not throw when host is not a standard wall node', () => {
    const window = WindowNode.parse({
      id: 'window_on_dormer',
      parentId: 'dormer_123',
      wallId: 'dormer_123',
      width: 1.5,
      height: 1.2,
      position: [1, 1.5, 0],
    })

    const dormerMock = {
      id: 'dormer_123',
      type: 'dormer',
    }

    const scene = {
      get: (id: string) => (id === 'dormer_123' ? dormerMock : undefined),
      nodes: () => ({ [dormerMock.id]: dormerMock as any }),
    }

    const handles =
      typeof windowDefinition.handles === 'function'
        ? windowDefinition.handles(window, scene as any)
        : (windowDefinition.handles ?? [])

    for (const handle of handles as any[]) {
      if (typeof handle.max === 'function') {
        expect(() => handle.max(window, scene as any)).not.toThrow()
      }
    }
  })
})
