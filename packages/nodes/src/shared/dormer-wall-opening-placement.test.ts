import { describe, expect, test } from 'bun:test'
import { type AnyNode, type DormerEvent, DormerNode, WindowNode } from '@pascal-app/core'
import {
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
