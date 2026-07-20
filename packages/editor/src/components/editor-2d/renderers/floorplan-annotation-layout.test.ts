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
})
