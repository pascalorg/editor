import { expect, test } from 'bun:test'
import { RoadNode } from './road'

test('road node defaults to road surface kind', () => {
  const node = RoadNode.parse({ start: [0, 0], end: [5, 0] })
  expect(node.surfaceKind).toBe('road')
})

test('road node accepts ground strip surface kinds', () => {
  for (const surfaceKind of ['road', 'river', 'walkway', 'greenbelt'] as const) {
    const node = RoadNode.parse({ start: [0, 0], end: [5, 0], surfaceKind })
    expect(node.surfaceKind).toBe(surfaceKind)
  }
})
