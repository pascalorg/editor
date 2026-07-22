import { describe, expect, test } from 'bun:test'
import { floorplanGeometryMetadata } from '../../../lib/floorplan/floorplan-extension'
import {
  collectAnnotationLayoutPreflightIssues,
  floorplanAnnotationObstacleMode,
  observeSvgAnnotationLayoutChanges,
  polylineObstacleRectangles,
  resolveAnnotationLabelRectangles,
} from './floorplan-annotation-layout'

describe('floorplanAnnotationObstacleMode', () => {
  test('treats fixed annotation categories as layout obstacles', () => {
    expect(
      floorplanAnnotationObstacleMode({
        kind: 'text',
        x: 0,
        y: 0,
        text: 'BEDROOM',
        fontSize: 0.18,
        metadata: floorplanGeometryMetadata({ annotationRole: 'room-label' }),
      }),
    ).toBe('bounds')
    expect(
      floorplanAnnotationObstacleMode({
        kind: 'line',
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 0,
        metadata: floorplanGeometryMetadata({ annotationRole: 'column-center' }),
      }),
    ).toBe('bounds')
    expect(
      floorplanAnnotationObstacleMode({
        kind: 'polyline',
        points: [
          [0, 0],
          [1, 0],
        ],
        metadata: floorplanGeometryMetadata({ annotationRole: 'stair-annotation' }),
      }),
    ).toBe('outline')
  })
})

describe('collectAnnotationLayoutPreflightIssues', () => {
  test('reports unresolved collisions, short labels, and plan geometry conflicts separately', () => {
    const issues = collectAnnotationLayoutPreflightIssues(
      [
        {
          id: 'short',
          x: 0,
          y: 0,
          width: 40,
          height: 10,
          priority: 10,
          text: '1"',
          labelPlacement: 'outside-end',
        },
        {
          id: 'blocked',
          x: 100,
          y: 0,
          width: 40,
          height: 10,
          priority: 10,
          text: 'Blocked',
        },
        {
          id: 'overlap-a',
          x: 200,
          y: 0,
          width: 40,
          height: 10,
          priority: 10,
          text: 'A',
        },
        {
          id: 'overlap-b',
          x: 205,
          y: 0,
          width: 40,
          height: 10,
          priority: 10,
          text: 'B',
        },
      ],
      [
        { id: 'short', dx: 0, dy: 0, resolved: true },
        { id: 'blocked', dx: 0, dy: 0, resolved: true },
        { id: 'overlap-a', dx: 0, dy: 0, resolved: false },
        { id: 'overlap-b', dx: 0, dy: 0, resolved: true },
      ],
      [{ x: 96, y: -2, width: 48, height: 14 }],
    )

    expect(issues.map((issue) => issue.kind)).toEqual([
      'short-unreadable-segment',
      'plan-geometry-conflict',
      'unresolved-collision',
    ])
    expect(issues.every((issue) => issue.severity === 'warning')).toBe(true)
  })
})

describe('resolveAnnotationLabelRectangles', () => {
  test('keeps the higher-priority label and moves the conflicting label', () => {
    const shifts = resolveAnnotationLabelRectangles([
      { id: 'overall', x: 0, y: 0, width: 80, height: 12, priority: 100 },
      { id: 'opening', x: 20, y: 0, width: 50, height: 12, priority: 50 },
    ])

    expect(shifts.find((entry) => entry.id === 'overall')).toMatchObject({ dx: 0, dy: 0 })
    expect(shifts.find((entry) => entry.id === 'opening')).not.toMatchObject({ dx: 0, dy: 0 })
    expect(shifts.every((entry) => entry.resolved)).toBe(true)
  })

  test('keeps pinned labels at their drawing-view override and routes other labels around them', () => {
    const shifts = resolveAnnotationLabelRectangles([
      {
        id: 'pinned',
        x: 0,
        y: 0,
        width: 80,
        height: 12,
        priority: 1,
        pinnedShift: { dx: 30, dy: 0 },
      },
      { id: 'automatic', x: 30, y: 0, width: 80, height: 12, priority: 100 },
    ])

    expect(shifts.find((entry) => entry.id === 'pinned')).toEqual({
      id: 'pinned',
      dx: 30,
      dy: 0,
      resolved: true,
    })
    expect(shifts.find((entry) => entry.id === 'automatic')).not.toMatchObject({
      dx: 0,
      dy: 0,
    })
  })

  test('does not move labels that are already clear', () => {
    expect(
      resolveAnnotationLabelRectangles([
        { id: 'left', x: 0, y: 0, width: 40, height: 12, priority: 10 },
        { id: 'right', x: 100, y: 0, width: 40, height: 12, priority: 10 },
      ]),
    ).toEqual([
      { id: 'left', dx: 0, dy: 0, resolved: true },
      { id: 'right', dx: 0, dy: 0, resolved: true },
    ])
  })

  test('preserves drawing order for labels on the same dimension string', () => {
    const shifts = resolveAnnotationLabelRectangles([
      { id: 'first', x: 0, y: 0, width: 20, height: 12, priority: 10 },
      { id: 'second', x: 0, y: 0, width: 80, height: 12, priority: 10 },
    ])

    expect(shifts.find((entry) => entry.id === 'first')).toMatchObject({ dx: 0, dy: 0 })
    expect(shifts.find((entry) => entry.id === 'second')).not.toMatchObject({ dx: 0, dy: 0 })
  })

  test('slides a colliding label along its dimension string before crossing tiers', () => {
    const shifts = resolveAnnotationLabelRectangles([
      { id: 'datum', x: 0, y: 0, width: 40, height: 12, priority: 20 },
      {
        id: 'adjacent',
        x: 0,
        y: 0,
        width: 40,
        height: 12,
        priority: 10,
        tangentX: 1,
        tangentY: 0,
      },
    ])

    expect(shifts.find((entry) => entry.id === 'adjacent')).toMatchObject({ dy: 0, resolved: true })
    expect(shifts.find((entry) => entry.id === 'adjacent')?.dx).not.toBe(0)
  })

  test('tries a short dimension alternative before generic relocation', () => {
    const shifts = resolveAnnotationLabelRectangles(
      [
        {
          id: 'short-dimension',
          x: 0,
          y: 0,
          width: 40,
          height: 12,
          priority: 10,
          preferredShifts: [{ dx: 100, dy: 0 }],
        },
      ],
      [{ x: 0, y: 0, width: 40, height: 12 }],
    )

    expect(shifts).toEqual([{ id: 'short-dimension', dx: 100, dy: 0, resolved: true }])
  })

  test('falls back to a third position when both short-dimension sides are blocked', () => {
    const shifts = resolveAnnotationLabelRectangles(
      [
        {
          id: 'short-dimension',
          x: 0,
          y: 0,
          width: 40,
          height: 12,
          priority: 10,
          preferredShifts: [{ dx: 100, dy: 0 }],
        },
      ],
      [
        { x: 0, y: 0, width: 40, height: 12 },
        { x: 100, y: 0, width: 40, height: 12 },
      ],
    )

    expect(shifts[0]).toMatchObject({ id: 'short-dimension', resolved: true })
    expect(shifts[0]).not.toMatchObject({ dx: 0, dy: 0 })
    expect(shifts[0]).not.toMatchObject({ dx: 100, dy: 0 })
  })

  test('approximates diagonal outlines without blocking their full bounding box', () => {
    expect(
      polylineObstacleRectangles([
        { x: 0, y: 0 },
        { x: 4, y: 4 },
        { x: 8, y: 8 },
      ]),
    ).toEqual([
      { x: -1, y: -1, width: 6, height: 6 },
      { x: 3, y: 3, width: 6, height: 6 },
    ])
  })

  test('moves a dimension value clear of a fixed door-mark pill', () => {
    const shifts = resolveAnnotationLabelRectangles(
      [{ id: 'door-width', x: 94, y: 88, width: 42, height: 16, priority: 100 }],
      [{ x: 100, y: 82, width: 48, height: 32 }],
    )

    expect(shifts).toEqual([expect.objectContaining({ id: 'door-width', resolved: true })])
    const shift = shifts[0]
    expect(shift).not.toMatchObject({ dx: 0, dy: 0 })
    expect(
      94 + (shift?.dx ?? 0) + 42 + 6 <= 100 ||
        148 + 6 <= 94 + (shift?.dx ?? 0) ||
        88 + (shift?.dy ?? 0) + 16 + 6 <= 82 ||
        114 + 6 <= 88 + (shift?.dy ?? 0),
    ).toBe(true)
  })

  test('finds separate nearby positions for a dense label cluster', () => {
    const shifts = resolveAnnotationLabelRectangles(
      Array.from({ length: 4 }, (_, index) => ({
        id: `label-${index}`,
        x: 0,
        y: 0,
        width: 40,
        height: 12,
        priority: 10 - index,
      })),
    )

    expect(new Set(shifts.map(({ dx, dy }) => `${dx},${dy}`))).toHaveLength(4)
    expect(shifts.every((entry) => entry.resolved)).toBe(true)
  })

  test('keeps a large dense label cluster readable', () => {
    const rectangles = Array.from({ length: 12 }, (_, index) => ({
      id: `label-${index}`,
      x: 100 + (index % 3) * 4,
      y: 100 + (index % 2) * 3,
      width: 48 + (index % 4) * 8,
      height: 14,
      priority: 20 - index,
    }))
    const shifts = resolveAnnotationLabelRectangles(rectangles)
    const placed = rectangles.map((rectangle) => {
      const shift = shifts.find(({ id }) => id === rectangle.id)
      return {
        ...rectangle,
        x: rectangle.x + (shift?.dx ?? 0),
        y: rectangle.y + (shift?.dy ?? 0),
      }
    })

    expect(shifts.every((entry) => entry.resolved)).toBe(true)
    for (let index = 0; index < placed.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < placed.length; otherIndex += 1) {
        const left = placed[index]
        const right = placed[otherIndex]
        if (!left || !right) continue
        const overlaps = !(
          left.x + left.width + 6 <= right.x ||
          right.x + right.width + 6 <= left.x ||
          left.y + left.height + 6 <= right.y ||
          right.y + right.height + 6 <= left.y
        )
        expect(overlaps).toBe(false)
      }
    }
  })

  test('resolves a construction-plan label set without blocking the view transition', () => {
    const labels = Array.from({ length: 25 }, (_, index) => ({
      id: `label-${index}`,
      x: index % 5,
      y: index % 7,
      width: 80,
      height: 20,
      priority: 25 - index,
    }))
    const obstacles = Array.from({ length: 100 }, (_, index) => ({
      x: (index % 10) * 2,
      y: (index % 13) * 2,
      width: 100,
      height: 40,
    }))

    const startedAt = performance.now()
    const shifts = resolveAnnotationLabelRectangles(labels, obstacles)
    const elapsedMs = performance.now() - startedAt

    expect(shifts).toHaveLength(labels.length)
    expect(shifts.every((entry) => entry.resolved)).toBe(true)
    expect(elapsedMs).toBeLessThan(500)
  })
})

describe('observeSvgAnnotationLayoutChanges', () => {
  test('requests a fresh collision pass when floor-plan geometry changes after mount', () => {
    const OriginalMutationObserver = globalThis.MutationObserver
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
    let notify: MutationCallback | undefined
    let animationFrames: FrameRequestCallback[] = []
    let disconnected = false
    let observedOptions: MutationObserverInit | undefined

    class FakeMutationObserver {
      constructor(callback: MutationCallback) {
        notify = callback
      }

      observe(_target: Node, options?: MutationObserverInit): void {
        observedOptions = options
      }

      disconnect(): void {
        disconnected = true
      }

      takeRecords(): MutationRecord[] {
        return []
      }
    }

    globalThis.MutationObserver = FakeMutationObserver as typeof MutationObserver
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      animationFrames.push(callback)
      return animationFrames.length
    }) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame
    try {
      const flushAnimationFrame = () => {
        const callbacks = animationFrames
        animationFrames = []
        for (const callback of callbacks) callback(0)
      }
      let layoutPasses = 0
      const stop = observeSvgAnnotationLayoutChanges({} as SVGSVGElement, () => {
        layoutPasses += 1
      })

      notify?.([{ type: 'childList' } as MutationRecord], {} as MutationObserver)

      expect(layoutPasses).toBe(0)
      flushAnimationFrame()
      expect(layoutPasses).toBe(0)
      flushAnimationFrame()
      expect(layoutPasses).toBe(1)
      expect(observedOptions).toMatchObject({
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: expect.any(Array),
      })

      notify?.(
        [
          {
            attributeName: 'style',
            target: { closest: () => ({}) },
            type: 'attributes',
          } as unknown as MutationRecord,
        ],
        {} as MutationObserver,
      )
      expect(layoutPasses).toBe(1)

      stop()
      expect(disconnected).toBe(true)
    } finally {
      globalThis.MutationObserver = OriginalMutationObserver
      globalThis.requestAnimationFrame = originalRequestAnimationFrame
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame
    }
  })

  test('waits for a quiet frame instead of resolving on every mutation frame', () => {
    const OriginalMutationObserver = globalThis.MutationObserver
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
    let notify: MutationCallback | undefined
    let animationFrames: FrameRequestCallback[] = []

    class FakeMutationObserver {
      constructor(callback: MutationCallback) {
        notify = callback
      }

      observe(): void {}
      disconnect(): void {}
      takeRecords(): MutationRecord[] {
        return []
      }
    }

    globalThis.MutationObserver = FakeMutationObserver as typeof MutationObserver
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      animationFrames.push(callback)
      return animationFrames.length
    }) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame
    try {
      const flushAnimationFrame = () => {
        const callbacks = animationFrames
        animationFrames = []
        for (const callback of callbacks) callback(0)
      }
      let layoutPasses = 0
      const stop = observeSvgAnnotationLayoutChanges({} as SVGSVGElement, () => {
        layoutPasses += 1
      })

      for (let frame = 0; frame < 30; frame += 1) {
        notify?.([{ type: 'childList' } as MutationRecord], {} as MutationObserver)
        flushAnimationFrame()
      }

      expect(layoutPasses).toBe(0)
      flushAnimationFrame()
      expect(layoutPasses).toBe(1)
      stop()
    } finally {
      globalThis.MutationObserver = OriginalMutationObserver
      globalThis.requestAnimationFrame = originalRequestAnimationFrame
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame
    }
  })
})
