import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type DormerEvent,
  DormerNode,
  type WindowEvent,
  WindowNode,
} from '@pascal-app/core'
import { Object3D } from 'three'
import {
  dormerEventFromHostedWindow,
  getDormerWindowWorldNormal,
  getDormerWindowWorldYaw,
  resolveDormerWindowTarget,
  shouldWriteDormerWindowPreviewHost,
} from './dormer-wall-opening-placement'

function event(
  node: DormerNode,
  localPosition: [number, number, number],
  normal?: [number, number, number],
): DormerEvent {
  return {
    node,
    localPosition,
    normal,
  } as DormerEvent
}

describe('dormerEventFromHostedWindow', () => {
  test('forwards a hosted back-window hit into the dormer coordinate frame', () => {
    const dormer = DormerNode.parse({ id: 'dormer_test' })
    const window = WindowNode.parse({
      dormerFace: 'back',
      dormerId: dormer.id,
      id: 'window_test',
      parentId: dormer.id,
    })
    const object = new Object3D()
    object.position.set(2, 3, 4)
    object.updateMatrixWorld(true)
    const stopPropagation = () => {}
    const windowEvent = {
      faceIndex: 7,
      nativeEvent: { timeStamp: 10 },
      node: window,
      position: [3, 5, 7],
      stopPropagation,
    } as unknown as WindowEvent

    const dormerEvent = dormerEventFromHostedWindow(windowEvent, dormer, object)

    expect(dormerEvent.node).toBe(dormer)
    expect(dormerEvent.localPosition).toEqual([1, 2, 3])
    expect(dormerEvent.normal).toEqual([0, 0, -1])
    expect(dormerEvent.faceIndex).toBe(7)
    expect(dormerEvent.stopPropagation).toBe(stopPropagation)
  })
})

describe('resolveDormerWindowTarget', () => {
  test('clamps a front-face window in dormer-local coordinates', () => {
    const dormer = DormerNode.parse({
      depth: 2,
      height: 1,
      id: 'dormer_test',
      wallSkirtHeight: 2,
      width: 3,
    })

    const target = resolveDormerWindowTarget({
      event: event(dormer, [1.8, 0.8, 1], [0, 0, 1]),
      height: 1,
      nodes: {},
      width: 1,
    })

    expect(target?.face).toBe('front')
    expect(target?.position).toEqual([1, 0.5, 0])
    expect(target?.valid).toBe(true)
  })

  test('rejects overlap with another window on the same face', () => {
    const child = WindowNode.parse({
      dormerFace: 'front',
      dormerId: 'dormer_test',
      height: 1,
      id: 'window_existing',
      parentId: 'dormer_test',
      position: [0, 0, 0],
      width: 1,
    })
    const dormer = DormerNode.parse({
      children: [child.id],
      depth: 2,
      height: 1,
      id: 'dormer_test',
      wallSkirtHeight: 2,
      width: 3,
    })

    const target = resolveDormerWindowTarget({
      event: event(dormer, [0, 0, 1], [0, 0, 1]),
      height: 1,
      nodes: { [child.id]: child } as Record<string, AnyNode>,
      width: 1,
    })

    expect(target?.valid).toBe(false)
  })

  test('falls back to the nearest dormer face when the ray has no normal', () => {
    const dormer = DormerNode.parse({
      depth: 2,
      height: 1,
      id: 'dormer_test',
      wallSkirtHeight: 2,
      width: 3,
    })

    const target = resolveDormerWindowTarget({
      event: event(dormer, [0, 0.2, -1]),
      height: 0.5,
      nodes: {},
      width: 0.5,
    })

    expect(target?.face).toBe('back')
    expect(target?.valid).toBe(true)
  })

  test.each([
    ['front', [0, 0, 1] as const, [0, 0, 1] as const],
    ['back', [0, 0, -1] as const, [0, 0, -1] as const],
    ['right', [1.5, 0, 0] as const, [1, 0, 0] as const],
    ['left', [-1.5, 0, 0] as const, [-1, 0, 0] as const],
  ])('targets the %s dormer face while dragging', (face, localPosition, normal) => {
    const dormer = DormerNode.parse({
      depth: 2,
      height: 1,
      id: 'dormer_test',
      wallSkirtHeight: 2,
      width: 3,
    })

    const target = resolveDormerWindowTarget({
      event: event(dormer, [...localPosition], [...normal]),
      height: 0.5,
      nodes: {},
      width: 0.5,
    })

    expect(target?.face).toBe(face)
    expect(target?.valid).toBe(true)
  })

  test('preserves the rendered horizontal direction on a side face', () => {
    const dormer = DormerNode.parse({
      depth: 2,
      height: 1,
      id: 'dormer_test',
      wallSkirtHeight: 2,
      width: 3,
    })

    const target = resolveDormerWindowTarget({
      event: event(dormer, [1.5, 0, -0.5], [1, 0, 0]),
      height: 0.5,
      nodes: {},
      width: 0.5,
    })

    expect(target?.face).toBe('right')
    expect(target?.position[0]).toBeCloseTo(0.5)
  })

  test('uses the live grid step and keeps raw coordinates when grid snapping is off', () => {
    const dormer = DormerNode.parse({
      depth: 2,
      height: 1,
      id: 'dormer_test',
      wallSkirtHeight: 2,
      width: 3,
    })
    const resolve = (snap: (value: number) => number) =>
      resolveDormerWindowTarget({
        event: event(dormer, [0.36, -0.64, 1], [0, 0, 1]),
        height: 0.5,
        nodes: {},
        snap,
        width: 0.5,
      })

    expect(resolve((value) => Math.round(value / 0.5) * 0.5)?.position).toEqual([0.5, -0.5, 0])
    expect(resolve((value) => Math.round(value / 0.25) * 0.25)?.position).toEqual([0.25, -0.75, 0])
    expect(resolve((value) => value)?.position).toEqual([0.36, -0.64, 0])
  })

  test('clamps a side-face window to the sloped shed wall above the eave', () => {
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

    const target = resolveDormerWindowTarget({
      event: event(dormer, [2, 3, -1], [1, 0, 0]),
      height: 1,
      nodes: {},
      width: 1,
    })

    expect(target?.face).toBe('right')
    expect(target?.position).toEqual([1, 1.75, 0])
  })
})

describe('getDormerWindowWorldYaw', () => {
  test('orients the drag preview to side faces and the dormer world rotation', () => {
    const dormer = DormerNode.parse({ id: 'dormer_test' })
    const object = new Object3D()
    object.rotation.y = 0.4
    object.updateMatrixWorld(true)
    const dormerEvent = { ...event(dormer, [0, 0, 0]), object }

    expect(
      getDormerWindowWorldYaw(dormerEvent, {
        dormer,
        face: 'right',
        position: [0, 0, 0],
        valid: true,
      }),
    ).toBeCloseTo(0.4 + Math.PI / 2)
  })
})

describe('getDormerWindowWorldNormal', () => {
  test('returns the world-space normal of a rotated dormer face', () => {
    const dormer = DormerNode.parse({ id: 'dormer_test' })
    const object = new Object3D()
    object.rotation.y = 0.4
    object.updateMatrixWorld(true)
    const dormerEvent = { ...event(dormer, [0, 0, 0]), object }

    const normal = getDormerWindowWorldNormal(dormerEvent, {
      dormer,
      face: 'right',
      position: [0, 0, 0],
      valid: true,
    })

    expect(normal.x).toBeCloseTo(Math.sin(0.4 + Math.PI / 2))
    expect(normal.y).toBeCloseTo(0)
    expect(normal.z).toBeCloseTo(Math.cos(0.4 + Math.PI / 2))
  })
})

describe('shouldWriteDormerWindowPreviewHost', () => {
  test('writes only once across repeated samples on one dormer face', () => {
    const dormer = DormerNode.parse({ id: 'dormer_test' })
    let window = WindowNode.parse({
      dormerFace: 'front',
      dormerId: dormer.id,
      id: 'window_test',
      parentId: dormer.id,
    })
    let writes = 0

    for (let index = 0; index < 100; index += 1) {
      const target = {
        dormer,
        face: 'front' as const,
        position: [index / 100, -0.5, 0] as [number, number, number],
        valid: true,
      }
      if (!shouldWriteDormerWindowPreviewHost(window, target)) continue
      writes += 1
      window = WindowNode.parse({
        ...window,
        dormerFace: target.face,
        dormerId: target.dormer.id,
        parentId: target.dormer.id,
        position: target.position,
        visible: false,
      })
    }

    expect(writes).toBe(1)
  })

  test('writes once when the preview enters a dormer face', () => {
    const dormer = DormerNode.parse({ id: 'dormer_test' })
    const window = WindowNode.parse({
      id: 'window_test',
      parentId: 'wall_test',
      wallId: 'wall_test',
    })
    const target = {
      dormer,
      face: 'front' as const,
      position: [0, -0.5, 0] as [number, number, number],
      valid: true,
    }

    expect(shouldWriteDormerWindowPreviewHost(window, target)).toBe(true)
  })

  test('writes when the preview crosses onto another dormer face', () => {
    const dormer = DormerNode.parse({ id: 'dormer_test' })
    const window = WindowNode.parse({
      dormerFace: 'front',
      dormerId: dormer.id,
      id: 'window_test',
      parentId: dormer.id,
      visible: false,
    })
    const target = {
      dormer,
      face: 'right' as const,
      position: [0, -0.5, 0] as [number, number, number],
      valid: true,
    }

    expect(shouldWriteDormerWindowPreviewHost(window, target)).toBe(true)
  })
})
