import { describe, expect, test } from 'bun:test'
import { pickBeamAngleLabel } from './angle-label'

describe('pickBeamAngleLabel', () => {
  test('returns null for a beam with no neighbour at either endpoint', () => {
    expect(
      pickBeamAngleLabel({
        start: [0, 0],
        end: [4, 0],
        segments: [],
      }),
    ).toBeNull()
  })

  test('shows the angle at the junction with a linked beam sharing the endpoint', () => {
    // Dragged beam runs along +X; the branch leaves its end at a right
    // angle. Only the end junction has a neighbour, so the pill lands there.
    const label = pickBeamAngleLabel({
      start: [0, 0],
      end: [4, 0],
      segments: [{ id: 'beam_branch', start: [4, 0], end: [4, 2] }],
    })
    expect(label).not.toBeNull()
    expect(label?.position[0]).toBeCloseTo(4)
    expect(label?.position[2]).toBeCloseTo(0)
    // 90 degrees, formatted like the angle pill formats.
    expect(label?.label).toBe('90°')
  })

  test('shows the angle against a wall sharing the endpoint when no beam does', () => {
    const label = pickBeamAngleLabel({
      start: [0, 0],
      end: [4, 0],
      segments: [{ id: 'wall_x', start: [4, 0], end: [4, 3] }],
    })
    expect(label).not.toBeNull()
    expect(label?.position[0]).toBeCloseTo(4)
    expect(label?.label).toBe('90°')
  })

  test('follows the dragged corner as the linked beam cascades with it', () => {
    // Mid-drag: the dragged beam's end has moved to (5, 0) and the linked
    // branch corner has cascaded to match — the angle still reads at the
    // shared junction.
    const label = pickBeamAngleLabel({
      start: [0, 0],
      end: [5, 0],
      segments: [{ id: 'beam_branch', start: [5, 0], end: [5, 2] }],
    })
    expect(label).not.toBeNull()
    expect(label?.position[0]).toBeCloseTo(5)
    expect(label?.label).toBe('90°')
  })
})
