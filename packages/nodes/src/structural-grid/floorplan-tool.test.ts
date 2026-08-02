import { describe, expect, test } from 'bun:test'
import { type AnyNode, StructuralGridNode } from '@pascal-app/core'
import {
  alphabeticGridLabel,
  nextStructuralGridLabel,
  shouldConsumeStructuralGridPointerEvent,
  snapStructuralGridAngle,
  structuralGridLabelFamily,
} from './floorplan-tool'

describe('structural-grid drafting helpers', () => {
  test('assigns numbers to vertical axes and letters to horizontal axes', () => {
    expect(structuralGridLabelFamily([2, 0], [2, 8])).toBe('numeric')
    expect(structuralGridLabelFamily([0, 3], [8, 3])).toBe('alphabetic')
  })

  test('continues labels within the active level and direction family', () => {
    const vertical = StructuralGridNode.parse({
      id: 'structural-grid_1',
      parentId: 'level_main',
      start: [1, 0],
      end: [1, 6],
      label: '1',
    })
    const horizontal = StructuralGridNode.parse({
      id: 'structural-grid_a',
      parentId: 'level_main',
      start: [0, 1],
      end: [6, 1],
      label: 'A',
    })
    const nodes = { [vertical.id]: vertical, [horizontal.id]: horizontal } as Record<
      string,
      AnyNode
    >

    expect(nextStructuralGridLabel(nodes, 'level_main', [2, 0], [2, 6])).toBe('2')
    expect(nextStructuralGridLabel(nodes, 'level_main', [0, 2], [6, 2])).toBe('B')
    expect(nextStructuralGridLabel(nodes, 'level_other', [2, 0], [2, 6])).toBe('1')
  })

  test('supports labels beyond Z and snaps angles to 45-degree increments', () => {
    expect(alphabeticGridLabel(25)).toBe('Z')
    expect(alphabeticGridLabel(26)).toBe('AA')
    const snapped = snapStructuralGridAngle([0, 0], [4, 0.4])
    expect(snapped[1]).toBeCloseTo(0)
    expect(Math.hypot(snapped[0], snapped[1])).toBeCloseTo(Math.hypot(4, 0.4))
  })

  test('leaves right-button drag moves available for floor-plan rotation', () => {
    expect(
      shouldConsumeStructuralGridPointerEvent({
        type: 'pointermove',
        button: -1,
        buttons: 2,
      }),
    ).toBe(false)
  })
})
