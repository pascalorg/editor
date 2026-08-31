import { describe, expect, test } from 'bun:test'
import { resolveFloorplanBackgroundSelection } from './floorplan-background-selection'

const baseArgs = {
  canSelectElementFloorplanGeometry: true,
  canSelectFloorplanZones: false,
  currentSelectedIds: ['wall_1'],
  getFloorplanHitIdAtPoint: () => 'door_1',
  isWallBuildActive: false,
  modifierKeys: { meta: false, ctrl: false, shift: false, alt: false },
  planPoint: [0, 0] as [number, number],
  structureLayer: 'elements',
}

describe('resolveFloorplanBackgroundSelection', () => {
  test('shift-click on a floorplan node toggles into the current selection', () => {
    const result = resolveFloorplanBackgroundSelection({
      ...baseArgs,
      modifierKeys: { meta: false, ctrl: false, shift: true, alt: false },
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
      modifierKeys: { meta: false, ctrl: false, shift: true, alt: false },
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
      modifierKeys: { meta: false, ctrl: false, shift: true, alt: false },
    })

    expect(result).toEqual({
      handled: true,
      kind: 'clear-elements',
      preserveSelection: true,
    })
  })

  test('plain click expands a session group', () => {
    const result = resolveFloorplanBackgroundSelection({
      ...baseArgs,
      expandIdsForNode: (nodeId) => (nodeId === 'door_1' ? ['door_1', 'wall_2'] : null),
    })

    expect(result).toEqual({
      handled: true,
      kind: 'select-elements',
      selectedIds: ['door_1', 'wall_2'],
    })
  })

  test('alt-click selects one member without expanding', () => {
    const result = resolveFloorplanBackgroundSelection({
      ...baseArgs,
      expandIdsForNode: () => ['door_1', 'wall_2'],
      modifierKeys: { meta: false, ctrl: false, shift: false, alt: true },
    })

    expect(result).toEqual({
      handled: true,
      kind: 'select-elements',
      selectedIds: ['door_1'],
    })
  })

  test('uses the registry hit result for zone selection', () => {
    const result = resolveFloorplanBackgroundSelection({
      ...baseArgs,
      canSelectElementFloorplanGeometry: false,
      canSelectFloorplanZones: true,
      getFloorplanHitIdAtPoint: () => 'zone_1',
      structureLayer: 'zones',
    })

    expect(result).toEqual({
      handled: true,
      kind: 'select-zone',
      zoneId: 'zone_1',
    })
  })
})
