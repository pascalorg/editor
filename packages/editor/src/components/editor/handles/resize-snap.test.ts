import { describe, expect, it, mock } from 'bun:test'
import { resolveResizeSnapValue } from './resize-snap'

describe('resolveResizeSnapValue', () => {
  it('applies only magnetic snapping in lines mode', () => {
    const magneticSnap = mock(() => 0.6)

    expect(
      resolveResizeSnapValue({
        rawValue: 0.59,
        gridSnapEnabled: true,
        gridSnapActive: false,
        gridSnapStep: 0.1,
        magneticSnapActive: true,
        magneticSnap,
      }),
    ).toBe(0.6)
    expect(magneticSnap).toHaveBeenCalledWith(0.59)
  })

  it('applies only grid snapping in grid mode', () => {
    const magneticSnap = mock(() => 0.6)

    expect(
      resolveResizeSnapValue({
        rawValue: 0.56,
        gridSnapEnabled: true,
        gridSnapActive: true,
        gridSnapStep: 0.1,
        magneticSnapActive: false,
        magneticSnap,
      }),
    ).toBeCloseTo(0.6)
    expect(magneticSnap).not.toHaveBeenCalled()
  })

  it('keeps the raw value in off mode', () => {
    const magneticSnap = mock(() => 0.6)

    expect(
      resolveResizeSnapValue({
        rawValue: 0.56,
        gridSnapEnabled: true,
        gridSnapActive: false,
        gridSnapStep: 0.1,
        magneticSnapActive: false,
        magneticSnap,
      }),
    ).toBe(0.56)
    expect(magneticSnap).not.toHaveBeenCalled()
  })
})
