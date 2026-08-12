import { describe, expect, test } from 'bun:test'
import { InstanceNode } from '@pascal-app/core'
import { buildInstanceFloorplan } from './floorplan'

describe('instance floorplan', () => {
  test('projects transform scale and selection into a movable plan symbol', () => {
    const node = InstanceNode.parse({
      id: 'instance_floorplan',
      definitionId: 'definition_floorplan',
      position: [4, 0, 7],
      rotation: [0, Math.PI / 2, 0],
      scale: [2, 1, 3],
    })
    const geometry = buildInstanceFloorplan(node, {
      viewState: { selected: true },
    } as never)

    expect(geometry.kind).toBe('group')
    if (geometry.kind !== 'group') return
    const footprint = geometry.children[0]
    expect(footprint?.kind).toBe('group')
    if (footprint?.kind !== 'group') return
    expect(footprint.transform).toEqual({ translate: [4, 7], rotate: -Math.PI / 2 })
    expect(footprint.children[0]).toMatchObject({ kind: 'rect', width: 2, height: 3 })
    expect(geometry.children.at(-1)).toEqual({ kind: 'move-handle', point: [4, 7] })
  })
})
