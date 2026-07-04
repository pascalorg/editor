import { describe, expect, test } from 'bun:test'
import { WallNode } from '../schema'
import { detectSpacesForLevel, wallClosesRoom } from './space-detection'

function areaOf(polygon: Array<{ x: number; y: number }>) {
  let area = 0
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    area += a.x * b.y - b.x * a.y
  }
  return Math.abs(area / 2)
}

function squareWalls() {
  return [
    WallNode.parse({ start: [0, 0], end: [4, 0] }),
    WallNode.parse({ start: [4, 0], end: [4, 3] }),
    WallNode.parse({ start: [4, 3], end: [0, 3] }),
    WallNode.parse({ start: [0, 3], end: [0, 0] }),
  ]
}

describe('detectSpacesForLevel', () => {
  test('detects an isolated four-wall room', () => {
    const { roomPolygons } = detectSpacesForLevel('level-1', squareWalls())
    expect(roomPolygons).toHaveLength(1)
  })

  test('detects a room closed against the middle of an existing wall', () => {
    const walls = [
      WallNode.parse({ start: [0, 0], end: [6, 0] }),
      WallNode.parse({ start: [6, 0], end: [6, 5] }),
      WallNode.parse({ start: [6, 5], end: [0, 5] }),
      WallNode.parse({ start: [0, 5], end: [0, 0] }),
      WallNode.parse({ start: [1, 0], end: [1, -2] }),
      WallNode.parse({ start: [1, -2], end: [3, -2] }),
      WallNode.parse({ start: [3, -2], end: [3, 0] }),
    ]

    const { roomPolygons } = detectSpacesForLevel('level-1', walls)
    const areas = roomPolygons.map((poly) => areaOf(poly)).sort((a, b) => a - b)

    expect(roomPolygons).toHaveLength(2)
    expect(areas[0]).toBeCloseTo(4, 1)
    expect(areas[1]).toBeCloseTo(30, 1)
  })
})

describe('wallClosesRoom', () => {
  test('is false while a chain is open, true once it encloses a room', () => {
    const open = [
      WallNode.parse({ start: [0, 0], end: [4, 0] }),
      WallNode.parse({ start: [4, 0], end: [4, 3] }),
      WallNode.parse({ start: [4, 3], end: [0, 3] }),
    ]
    const closing = WallNode.parse({ start: [0, 3], end: [0, 0] })

    expect(wallClosesRoom(open, closing)).toBe(false)
    expect(wallClosesRoom([...open, closing], closing)).toBe(true)
  })

  test('fires when a bay is sealed against the middle of an existing wall', () => {
    const bigRoom = [
      WallNode.parse({ start: [0, 0], end: [6, 0] }),
      WallNode.parse({ start: [6, 0], end: [6, 5] }),
      WallNode.parse({ start: [6, 5], end: [0, 5] }),
      WallNode.parse({ start: [0, 5], end: [0, 0] }),
    ]
    const bayLeft = WallNode.parse({ start: [1, 0], end: [1, -2] })
    const bayBottom = WallNode.parse({ start: [1, -2], end: [3, -2] })
    const bayRight = WallNode.parse({ start: [3, -2], end: [3, 0] })

    expect(wallClosesRoom([...bigRoom, bayLeft, bayBottom], bayBottom)).toBe(false)
    expect(wallClosesRoom([...bigRoom, bayLeft, bayBottom, bayRight], bayRight)).toBe(true)
  })
})
