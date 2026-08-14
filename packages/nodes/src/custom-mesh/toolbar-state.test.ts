import { describe, expect, test } from 'bun:test'
import {
  customMeshBevelWidthFromDrag,
  customMeshComponentStatus,
  customMeshGizmoDimensions,
  customMeshOperationAvailability,
  customMeshScaleFactorFromDrag,
  customMeshScaleFactors,
  customMeshToolbarOffset,
  formatCustomMeshSelectionStatus,
} from './toolbar-state'

describe('custom mesh toolbar state', () => {
  test('enables face operations only for one selected face', () => {
    expect(customMeshOperationAvailability('face', 1)).toEqual({
      extrude: true,
      inset: true,
      merge: false,
      dissolve: false,
      bevel: false,
    })
    expect(customMeshOperationAvailability('face', 2).extrude).toBe(false)
  })

  test('enables component-specific vertex and edge operations', () => {
    expect(customMeshOperationAvailability('vertex', 2).merge).toBe(true)
    expect(customMeshOperationAvailability('vertex', 1).merge).toBe(false)
    expect(customMeshOperationAvailability('edge', 1)).toMatchObject({
      dissolve: true,
      bevel: true,
    })
    expect(customMeshOperationAvailability('edge', 0).bevel).toBe(true)
  })

  test('formats compact singular and plural selection labels', () => {
    expect(formatCustomMeshSelectionStatus('face', 1)).toBe('1 FACE')
    expect(formatCustomMeshSelectionStatus('edge', 2)).toBe('2 EDGES')
    expect(formatCustomMeshSelectionStatus('vertex', 3)).toBe('3 VERTICES')
  })

  test('does not show a secondary help strip for a selected transform', () => {
    expect(
      customMeshComponentStatus({
        mode: 'face',
        selectedCount: 1,
        tool: 'transform',
        loopCutCount: 1,
        loopCutFactor: 0.5,
        bevelSegments: 6,
      }),
    ).toBeNull()
  })

  test('builds uniform and axis-specific scale factors', () => {
    expect(customMeshScaleFactors('uniform', 1.5)).toEqual([1.5, 1.5, 1.5])
    expect(customMeshScaleFactors('x', 1.5)).toEqual([1.5, 1, 1])
    expect(customMeshScaleFactors('y', 0.5)).toEqual([1, 0.5, 1])
    expect(customMeshScaleFactors('z', 2)).toEqual([1, 1, 2])
  })

  test('converts scale-handle movement into a positive snapped factor', () => {
    expect(customMeshScaleFactorFromDrag(0.5, 1)).toBe(1.5)
    expect(customMeshScaleFactorFromDrag(0.46, 1, 0.1)).toBe(1.5)
    expect(customMeshScaleFactorFromDrag(-5, 1)).toBe(0.01)
  })

  test('maps bevel pointer travel into topology-relative width', () => {
    expect(customMeshBevelWidthFromDrag(60, 80, 2, 1000)).toBeCloseTo(0.2)
    expect(customMeshBevelWidthFromDrag(0, 0, 2, 1000)).toBe(0)
    expect(customMeshBevelWidthFromDrag(10, 0, 2, 0)).toBe(20)
  })

  test('keeps the floating toolbar clear of the vertical transform handle', () => {
    const topologyExtent = 2.4
    const gizmoLength = Math.min(1.15, Math.max(0.42, topologyExtent * 0.29))
    const toolbarOffset = customMeshToolbarOffset(topologyExtent, gizmoLength)
    const scaleHandleReach = gizmoLength * 1.2

    expect(toolbarOffset - scaleHandleReach).toBeGreaterThanOrEqual(0.3)
  })

  test('keeps every transform-gizmo dimension constant while topology moves', () => {
    expect(customMeshGizmoDimensions(3.4)).toEqual(customMeshGizmoDimensions(2.4))
  })
})
