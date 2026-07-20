import { describe, expect, test } from 'bun:test'
import { resolveAnnotationLabelRectangles } from './floorplan-annotation-layout'

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
})
