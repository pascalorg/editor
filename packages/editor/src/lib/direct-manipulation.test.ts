import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  DEFAULT_ANGLE_STEP,
  nodeRegistry,
  registerNode,
} from '@pascal-app/core'
import { z } from 'zod'
import {
  canDirectMoveNode,
  resolveDirectRotationDragDelta,
  snapDirectRotationDelta,
} from './direct-manipulation'

function registerTestDefinition(kind: string, overrides: Partial<AnyNodeDefinition>) {
  if (nodeRegistry.has(kind)) return
  registerNode({
    kind,
    schemaVersion: 1,
    schema: z.object({ type: z.literal(kind) }) as never,
    category: 'structure',
    defaults: () => ({ type: kind }) as never,
    capabilities: {},
    renderer: { kind: 'parametric', module: async () => ({ default: () => null }) },
    ...overrides,
  } as AnyNodeDefinition)
}

describe('snapDirectRotationDelta', () => {
  test('snaps rotation deltas to the default angle increment', () => {
    expect(snapDirectRotationDelta(DEFAULT_ANGLE_STEP * 0.49, false)).toBe(0)
    expect(snapDirectRotationDelta(DEFAULT_ANGLE_STEP * 0.51, false)).toBeCloseTo(
      DEFAULT_ANGLE_STEP,
    )
    expect(snapDirectRotationDelta(DEFAULT_ANGLE_STEP * -1.49, false)).toBeCloseTo(
      -DEFAULT_ANGLE_STEP,
    )
  })

  test('keeps the raw rotation delta while free-rotating', () => {
    const rawDelta = DEFAULT_ANGLE_STEP * 0.42
    expect(snapDirectRotationDelta(rawDelta, true)).toBe(rawDelta)
  })
})

describe('resolveDirectRotationDragDelta', () => {
  test('maps horizontal pointer motion to the direct rotation delta direction', () => {
    const radiansPerPixel = DEFAULT_ANGLE_STEP / 12

    expect(resolveDirectRotationDragDelta(100, 112, radiansPerPixel, false)).toBeCloseTo(
      -DEFAULT_ANGLE_STEP,
    )
    expect(resolveDirectRotationDragDelta(100, 88, radiansPerPixel, false)).toBeCloseTo(
      DEFAULT_ANGLE_STEP,
    )
  })

  test('keeps unsnapped drag deltas while free-rotating', () => {
    expect(resolveDirectRotationDragDelta(100, 103, 0.1, true)).toBeCloseTo(-0.3)
  })
})

describe('canDirectMoveNode', () => {
  // Accepts kinds with a 3D-mountable move tool (`movable` or
  // `affordanceTools.move`); floorplan-only movers (zone) are excluded.
  test('rejects floorplan-only move targets (no 3D tool mounts)', () => {
    const kind = 'direct-move-floorplan-only-test'
    registerTestDefinition(kind, { floorplanMoveTarget: {} as never })

    expect(canDirectMoveNode({ id: 'node_1', type: kind } as unknown as AnyNode)).toBe(false)
  })

  test('rejects MEP kinds that own move through bespoke selection affordances', () => {
    for (const kind of [
      'duct-segment',
      'duct-fitting',
      'pipe-segment',
      'pipe-fitting',
      'lineset',
      'liquid-line',
    ]) {
      expect(canDirectMoveNode({ id: 'node_1', type: kind } as unknown as AnyNode)).toBe(false)
    }
  })

  test('accepts kinds with a bespoke move tool', () => {
    const kind = 'direct-move-bespoke-tool-test'
    registerTestDefinition(kind, {
      affordanceTools: {
        move: async () => ({ default: () => null }),
      } as never,
    })

    expect(canDirectMoveNode({ id: 'node_1', type: kind } as unknown as AnyNode)).toBe(true)
  })

  test('accepts nodes with the generic movable capability', () => {
    const kind = 'direct-move-movable-test'
    registerTestDefinition(kind, {
      capabilities: {
        movable: { axes: ['x', 'z'], gridSnap: true },
      },
    } as Partial<AnyNodeDefinition>)

    expect(canDirectMoveNode({ id: 'node_1', type: kind } as unknown as AnyNode)).toBe(true)
  })

  test('rejects kinds with no registered move path', () => {
    const kind = 'direct-move-none-test'
    registerTestDefinition(kind, {})

    expect(canDirectMoveNode({ id: 'node_1', type: kind } as unknown as AnyNode)).toBe(false)
  })
})
