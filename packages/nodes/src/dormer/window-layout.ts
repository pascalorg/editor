export const DORMER_WINDOW_GAP = 0.12
export const DORMER_WINDOW_MARGIN = 0.12
export const DORMER_WINDOW_MIN_WIDTH = 0.3

export type DormerWindowRowItem = {
  id: string
  position: readonly [number, number, number]
  width: number
}

export type DormerWindowRowPlacement = {
  id: string
  position: [number, number, number]
  width: number
}

const roundLayoutValue = (value: number) => {
  const rounded = Math.round(value * 1_000_000) / 1_000_000
  return Object.is(rounded, -0) ? 0 : rounded
}

function fitWindowWidths(preferredWidths: number[], availableWidth: number): number[] | null {
  const minimumTotal = preferredWidths.length * DORMER_WINDOW_MIN_WIDTH
  if (availableWidth + 1e-9 < minimumTotal) return null

  const widths = preferredWidths.map((width) => Math.max(DORMER_WINDOW_MIN_WIDTH, width))
  if (widths.reduce((sum, width) => sum + width, 0) <= availableWidth) return widths

  const fitted = Array.from({ length: widths.length }, () => 0)
  const remainingIndices = new Set(widths.map((_, index) => index))
  let remainingWidth = availableWidth

  while (remainingIndices.size > 0) {
    const preferredTotal = [...remainingIndices].reduce((sum, index) => sum + widths[index]!, 0)
    const scale = remainingWidth / preferredTotal
    const belowMinimum = [...remainingIndices].filter(
      (index) => widths[index]! * scale < DORMER_WINDOW_MIN_WIDTH,
    )

    if (belowMinimum.length === 0) {
      for (const index of remainingIndices) fitted[index] = widths[index]! * scale
      break
    }

    for (const index of belowMinimum) {
      fitted[index] = DORMER_WINDOW_MIN_WIDTH
      remainingWidth -= DORMER_WINDOW_MIN_WIDTH
      remainingIndices.delete(index)
    }
  }

  return fitted
}

export function planDormerWindowRow(
  dormerWidth: number,
  windows: readonly DormerWindowRowItem[],
): DormerWindowRowPlacement[] | null {
  if (windows.length === 0) return []

  const innerWidth = Math.max(0, dormerWidth - DORMER_WINDOW_MARGIN * 2)
  const gapsWidth = DORMER_WINDOW_GAP * Math.max(0, windows.length - 1)
  const widths = fitWindowWidths(
    windows.map((window) => window.width),
    innerWidth - gapsWidth,
  )
  if (!widths) return null

  const rowWidth = widths.reduce((sum, width) => sum + width, 0) + gapsWidth
  let cursor = -rowWidth / 2

  return windows.map((window, index) => {
    const width = widths[index]!
    const x = cursor + width / 2
    cursor += width + DORMER_WINDOW_GAP
    return {
      id: window.id,
      position: [
        roundLayoutValue(x),
        roundLayoutValue(window.position[1]),
        roundLayoutValue(window.position[2]),
      ],
      width: roundLayoutValue(width),
    }
  })
}
