import { describe, expect, test } from 'bun:test'
import {
  cabinetStretchEndLocalX,
  cabinetStretchExitSide,
  chooseCabinetContinuousAnchor,
  createCabinetContinuousContinuation,
  fillCabinetContinuousSpan,
  isCabinetContinuousFollowUpClick,
  planCabinetContinuousStretch,
  resolveCabinetContinuousValidity,
  type StretchAnchor,
} from '../continuous-placement'

const ANCHOR: StretchAnchor = {
  position: [0, 0, 0],
  yaw: 0,
  snappedToWall: false,
}

describe('cabinet continuous placement', () => {
  test('fills a stretch with full modules plus a partial end module when needed', () => {
    const widths = fillCabinetContinuousSpan(1.35)
    expect(widths).toHaveLength(3)
    expect(widths[0]).toBeCloseTo(0.6)
    expect(widths[1]).toBeCloseTo(0.6)
    expect(widths[2]).toBeCloseTo(0.15)
  })

  test('drops a tiny remainder below the minimum end-module width', () => {
    expect(fillCabinetContinuousSpan(1.27)).toEqual([0.6, 0.6])
  })

  test('plans module offsets to the right of the anchored cabinet', () => {
    const stretch = planCabinetContinuousStretch({
      anchor: ANCHOR,
      previewWidth: 0.6,
      rawPlanPosition: [1.35, 0, 0],
    })

    expect(stretch.modules).toHaveLength(3)
    expect(stretch.modules[0]?.x).toBeCloseTo(0)
    expect(stretch.modules[0]?.width).toBeCloseTo(0.6)
    expect(stretch.modules[1]?.x).toBeCloseTo(0.6)
    expect(stretch.modules[1]?.width).toBeCloseTo(0.6)
    expect(stretch.modules[2]?.x).toBeCloseTo(1.125)
    expect(stretch.modules[2]?.width).toBeCloseTo(0.45)
    expect(stretch.length).toBeCloseTo(1.65)
    expect(stretch.centerLocalX).toBeCloseTo(0.525)
    expect(stretch.direction).toBe(1)
    expect(cabinetStretchExitSide(stretch)).toBe('right')
    expect(cabinetStretchEndLocalX(stretch, 0.6)).toBeCloseTo(1.35)
  })

  test('mirrors module offsets when the stretch grows left of the anchor', () => {
    const stretch = planCabinetContinuousStretch({
      anchor: ANCHOR,
      previewWidth: 0.6,
      rawPlanPosition: [-1.35, 0, 0],
    })

    expect(stretch.modules).toHaveLength(3)
    expect(stretch.modules[0]?.x).toBeCloseTo(0)
    expect(stretch.modules[0]?.width).toBeCloseTo(0.6)
    expect(stretch.modules[1]?.x).toBeCloseTo(-0.6)
    expect(stretch.modules[1]?.width).toBeCloseTo(0.6)
    expect(stretch.modules[2]?.x).toBeCloseTo(-1.125)
    expect(stretch.modules[2]?.width).toBeCloseTo(0.45)
    expect(stretch.centerLocalX).toBeCloseTo(-0.525)
    expect(stretch.direction).toBe(-1)
    expect(cabinetStretchExitSide(stretch)).toBe('left')
    expect(cabinetStretchEndLocalX(stretch, 0.6)).toBeCloseTo(-1.35)
  })

  test('forced-direction anchors keep orthogonal follow-on legs growing outward', () => {
    const stretch = planCabinetContinuousStretch({
      anchor: { ...ANCHOR, forcedDirection: 1 },
      previewWidth: 0.6,
      rawPlanPosition: [-1.0, 0, 0],
    })

    expect(stretch.direction).toBe(1)
    expect(stretch.length).toBeCloseTo(0.6)
  })

  test('leading-width anchors reserve the corner filler before adding cabinet modules', () => {
    const stretch = planCabinetContinuousStretch({
      anchor: { ...ANCHOR, forcedDirection: 1, leadingWidth: 0.58 },
      previewWidth: 0.6,
      rawPlanPosition: [1.2, 0, 0],
    })

    expect(stretch.modules[0]?.width).toBeCloseTo(0.58)
    expect(stretch.modules[0]?.x).toBeCloseTo(0)
    expect(stretch.modules[1]?.width).toBeCloseTo(0.6)
    expect(stretch.modules[1]?.x).toBeGreaterThan(0.58 / 2)
  })

  test('leading-width anchors always preview the first connected cabinet after the corner filler', () => {
    const stretch = planCabinetContinuousStretch({
      anchor: { ...ANCHOR, forcedDirection: 1, leadingWidth: 0.58 },
      previewWidth: 0.6,
      rawPlanPosition: [0.05, 0, 0],
    })

    expect(stretch.modules.map((module) => module.width)).toEqual([0.58, 0.6])
    expect(stretch.length).toBeCloseTo(1.18)
  })

  test('prefers continuing straight when the cursor moves forward from the committed end', () => {
    const stretch = planCabinetContinuousStretch({
      anchor: ANCHOR,
      previewWidth: 0.6,
      rawPlanPosition: [1.2, 0, 0],
    })
    const continuation = createCabinetContinuousContinuation({
      anchor: ANCHOR,
      previewDepth: 0.58,
      previewWidth: 0.6,
      stretch,
    })

    expect(chooseCabinetContinuousAnchor(continuation, [1.9, 0, 0.1])).toEqual(
      continuation.straightAnchor,
    )
  })

  test('prefers the L turn when the cursor moves more laterally than forward', () => {
    const stretch = planCabinetContinuousStretch({
      anchor: ANCHOR,
      previewWidth: 0.6,
      rawPlanPosition: [1.2, 0, 0],
    })
    const continuation = createCabinetContinuousContinuation({
      anchor: ANCHOR,
      previewDepth: 0.58,
      previewWidth: 0.6,
      stretch,
    })

    expect(chooseCabinetContinuousAnchor(continuation, [1.35, 0, -0.9])).toEqual(
      continuation.turnAnchor,
    )
  })

  test('treats Alt force-place as valid while keeping normal collisions blocked', () => {
    const blocked = { conflictIds: ['cabinet_a', 'cabinet_b'], valid: false }

    expect(resolveCabinetContinuousValidity(blocked, false)).toEqual(blocked)
    expect(resolveCabinetContinuousValidity(blocked, true)).toEqual({
      conflictIds: [],
      valid: true,
    })
  })

  test('treats the second click in a double-click as a follow-up click to ignore', () => {
    expect(isCabinetContinuousFollowUpClick(2)).toBe(true)
  })

  test('treats a normal click as a segment commit click', () => {
    expect(isCabinetContinuousFollowUpClick(1)).toBe(false)
  })
})
