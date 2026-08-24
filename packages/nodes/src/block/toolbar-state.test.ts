import { describe, expect, test } from 'bun:test'
import {
  blockBevelWidthFromDrag,
  blockComponentStatus,
  blockGizmoDimensions,
  blockGizmoHitDimensions,
  blockOperationAvailability,
  blockScaleFactorFromDrag,
  blockScaleFactors,
  blockToolbarOffset,
  formatBlockSelectionStatus,
} from './toolbar-state'

describe('block toolbar state', () => {
  test('enables face operations for one or more selected faces', () => {
    expect(blockOperationAvailability('face', 1)).toEqual({
      extrude: true,
      inset: true,
      merge: false,
      dissolve: false,
      bevel: false,
    })
    expect(blockOperationAvailability('face', 2)).toMatchObject({ extrude: true, inset: true })
  })

  test('enables component-specific vertex and edge operations', () => {
    expect(blockOperationAvailability('vertex', 2).merge).toBe(true)
    expect(blockOperationAvailability('vertex', 1).merge).toBe(false)
    expect(blockOperationAvailability('edge', 1)).toMatchObject({
      dissolve: true,
      bevel: true,
    })
    expect(blockOperationAvailability('edge', 2).dissolve).toBe(true)
    expect(blockOperationAvailability('face', 2).dissolve).toBe(true)
    expect(blockOperationAvailability('edge', 0).bevel).toBe(true)
  })

  test('formats compact singular and plural selection labels', () => {
    expect(formatBlockSelectionStatus('face', 1)).toBe('1 FACE')
    expect(formatBlockSelectionStatus('edge', 2)).toBe('2 EDGES')
    expect(formatBlockSelectionStatus('vertex', 3)).toBe('3 VERTICES')
  })

  test('does not show a secondary help strip for a selected transform', () => {
    expect(
      blockComponentStatus({
        mode: 'face',
        selectedCount: 1,
        tool: 'transform',
        loopCutCount: 1,
        loopCutFactor: 0.5,
        bevelSegments: 6,
        bevelWidth: 0,
      }),
    ).toBeNull()
  })

  test('shows live bevel width and segment count', () => {
    expect(
      blockComponentStatus({
        mode: 'edge',
        selectedCount: 1,
        tool: 'bevel',
        loopCutCount: 1,
        loopCutFactor: 0.5,
        bevelSegments: 6,
        bevelWidth: 0.2,
      }),
    ).toBe('Bevel · width 0.2 m · 6 segments · drag changes width · wheel changes segments')
  })

  test('builds uniform and axis-specific scale factors', () => {
    expect(blockScaleFactors('uniform', 1.5)).toEqual([1.5, 1.5, 1.5])
    expect(blockScaleFactors('x', 1.5)).toEqual([1.5, 1, 1])
    expect(blockScaleFactors('y', 0.5)).toEqual([1, 0.5, 1])
    expect(blockScaleFactors('z', 2)).toEqual([1, 1, 2])
  })

  test('converts scale-handle movement into a positive snapped factor', () => {
    expect(blockScaleFactorFromDrag(0.5, 1)).toBe(1.5)
    expect(blockScaleFactorFromDrag(0.46, 1, 0.1)).toBe(1.5)
    expect(blockScaleFactorFromDrag(-5, 1)).toBe(0.01)
  })

  test('maps bevel pointer travel into topology-relative width', () => {
    expect(
      blockBevelWidthFromDrag(60, 80, {
        topologyExtent: 2,
        projectedExtentPixels: 1000,
      }),
    ).toBeCloseTo(0.2)
    expect(
      blockBevelWidthFromDrag(0, 0, {
        topologyExtent: 2,
        projectedExtentPixels: 1000,
      }),
    ).toBe(0)
  })

  test('keeps bevel sensitivity consistent as projected size changes', () => {
    expect(
      blockBevelWidthFromDrag(100, 0, {
        topologyExtent: 2,
        projectedExtentPixels: 400,
      }),
    ).toBeCloseTo(0.5)
    expect(
      blockBevelWidthFromDrag(50, 0, {
        topologyExtent: 2,
        projectedExtentPixels: 200,
      }),
    ).toBeCloseTo(0.5)
  })

  test('keeps the floating toolbar clear of the vertical transform handle', () => {
    const topologyExtent = 2.4
    const gizmoLength = Math.min(1.15, Math.max(0.42, topologyExtent * 0.29))
    const toolbarOffset = blockToolbarOffset(topologyExtent, gizmoLength)
    const scaleHandleReach = gizmoLength * 1.2

    expect(toolbarOffset - scaleHandleReach).toBeGreaterThanOrEqual(0.3)
  })

  test('keeps every transform-gizmo dimension constant while topology moves', () => {
    expect(blockGizmoDimensions(3.4)).toEqual(blockGizmoDimensions(2.4))
  })

  test('keeps axis and plane hit targets separate and gives the shaft priority at ring crossings', () => {
    const gizmo = blockGizmoDimensions(2.4)
    const hits = blockGizmoHitDimensions(gizmo.radius, gizmo.planeHandleSize)
    const planeNearEdge = gizmo.planeHandleOffset - hits.planeSize / 2

    expect(hits.axisRadius).toBeLessThan(planeNearEdge)
    expect(hits.rotationTube).toBeLessThan(hits.axisRadius)
    expect(hits.rotationStart).toBeGreaterThan(0)
    expect(hits.rotationStart + hits.rotationArc).toBeLessThan(Math.PI / 2)
  })
})
