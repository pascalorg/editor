import { describe, expect, test } from 'bun:test'
import { resolveFloorplanBackgroundSelection } from './floorplan-background-selection'

const baseArgs = {
  canSelectElementFloorplanGeometry: true,
  canSelectFloorplanZones: false,
  currentSelectedIds: ['wall_1'],
  getFloorplanHitIdAtPoint: () => 'door_1',
  isWallBuildActive: false,
  modifierKeys: { meta: false, ctrl: false, shift: false },
  planPoint: [0, 0] as [number, number],
  structureLayer: 'elements',
  toPoint2D: ([x, y]: [number, number]) => ({ x, y }),
  visibleZonePolygons: [],
}

describe('resolveFloorplanBackgroundSelection', () => {
  test('shift-click on a floorplan node toggles into the current selection', () => {
    const result = resolveFloorplanBackgroundSelection({
      ...baseArgs,
      modifierKeys: { meta: false, ctrl: false, shift: true },
    })

    expect(result).toEqual({
      handled: true,
      kind: 'select-elements',
      selectedIds: ['wall_1', 'door_1'],
    })
  })

  test('shift-click on selected floorplan node toggles it out', () => {
    const result = resolveFloorplanBackgroundSelection({
      ...baseArgs,
      currentSelectedIds: ['wall_1', 'door_1'],
      modifierKeys: { meta: false, ctrl: false, shift: true },
    })

    expect(result).toEqual({
      handled: true,
      kind: 'select-elements',
      selectedIds: ['wall_1'],
    })
  })

  test('shift-click on empty floorplan space preserves selection', () => {
    const result = resolveFloorplanBackgroundSelection({
      ...baseArgs,
      getFloorplanHitIdAtPoint: () => null,
      modifierKeys: { meta: false, ctrl: false, shift: true },
    })

    expect(result).toEqual({
      handled: true,
      kind: 'clear-elements',
      preserveSelection: true,
    })
  })
})
