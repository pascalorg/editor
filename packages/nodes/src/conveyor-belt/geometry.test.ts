import { describe, expect, test } from 'bun:test'
import { buildConveyorBeltGeometry } from './geometry'
import { ConveyorBeltNode } from './schema'

describe('buildConveyorBeltGeometry', () => {
  test('builds a continuous belt with frame, underside rollers, drums, and supports', () => {
    const node = ConveyorBeltNode.parse({
      name: 'Route belt',
      points: [
        [0, 0, 0],
        [2, 0, 0],
        [2, 0, 2],
      ],
    })

    const group = buildConveyorBeltGeometry(node)

    expect(group.children.length).toBeGreaterThan(4)
    expect(group.children.some((child) => child.name === 'conveyor-belt-surface')).toBe(true)
    expect(group.children.some((child) => child.name === 'conveyor-belt-side-rail')).toBe(true)
    expect(group.children.some((child) => child.name === 'conveyor-belt-end-drum')).toBe(true)
    expect(group.children.some((child) => child.name === 'conveyor-belt-under-roller')).toBe(true)
    expect(group.children.some((child) => child.name === 'conveyor-belt-roller')).toBe(false)
    expect(group.children.some((child) => child.name === 'conveyor-belt-support-leg')).toBe(true)
    expect(group.children.every((child) => child.castShadow)).toBe(true)
  }, 10_000)

  test('omits underside rollers when roller display is disabled', () => {
    const node = ConveyorBeltNode.parse({
      points: [
        [0, 0, 0],
        [3, 0, 0],
      ],
      showRollers: false,
    })

    const group = buildConveyorBeltGeometry(node)

    expect(group.children.some((child) => child.name === 'conveyor-belt-under-roller')).toBe(false)
    expect(group.children.some((child) => child.name === 'conveyor-belt-end-drum')).toBe(true)
  })
})
