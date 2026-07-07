import type { FloorPlacementClickTriggerEvent } from '../shared/floor-placement'
import { planToRunLocal } from './run-layout'
import { CABINET_BASE_WIDTH } from './run-ops'

export type CabinetStretchPreview = {
  modules: { x: number; width: number }[]
  length: number
  centerLocalX: number
  direction: 1 | -1
}

export type StretchAnchor = {
  position: [number, number, number]
  yaw: number
  snappedToWall: boolean
  forcedDirection?: 1 | -1
  leadingWidth?: number
}

type PlacementCollisionResult = {
  conflictIds: string[]
  valid: boolean
}

const MIN_END_MODULE_WIDTH = 0.1

export function isForcePlacementEvent(event: FloorPlacementClickTriggerEvent): boolean {
  const native = (event as { nativeEvent?: { altKey?: boolean } }).nativeEvent
  return native?.altKey === true
}

// Fill a span with standard-width modules; the remainder becomes a narrower
// end module (dropped entirely below MIN_END_MODULE_WIDTH).
export function fillCabinetContinuousSpan(length: number): number[] {
  const full = Math.max(1, Math.floor((length + 1e-6) / CABINET_BASE_WIDTH))
  const widths: number[] = new Array(full).fill(CABINET_BASE_WIDTH)
  const remainder = length - full * CABINET_BASE_WIDTH
  if (remainder >= MIN_END_MODULE_WIDTH) widths.push(remainder)
  return widths
}

export function planCabinetContinuousStretch({
  anchor,
  previewWidth,
  rawPlanPosition,
}: {
  anchor: StretchAnchor
  previewWidth: number
  rawPlanPosition: [number, number, number]
}): CabinetStretchPreview {
  const runLike = { position: anchor.position, rotation: anchor.yaw }
  const localX = planToRunLocal(runLike, rawPlanPosition[0], 0, rawPlanPosition[2])[0]
  const dir: 1 | -1 = anchor.forcedDirection ?? (localX >= 0 ? 1 : -1)
  const firstWidth = anchor.leadingWidth ?? previewWidth
  const halfFirst = firstWidth / 2
  const projected = anchor.forcedDirection ? Math.max(0, localX * dir) : Math.abs(localX)
  const length = Math.max(projected + halfFirst, firstWidth)
  const trailingLength = Math.max(0, length - firstWidth)
  const trailingWidths =
    trailingLength <= 1e-6 ? [] : fillCabinetContinuousSpan(Math.max(previewWidth, trailingLength))
  const widths = [firstWidth, ...trailingWidths]
  const total = widths.reduce((sum, width) => sum + width, 0)
  let cum = 0
  const modules = widths.map((width) => {
    const x = dir * (cum + width / 2 - halfFirst)
    cum += width
    return { x, width }
  })
  return {
    modules,
    length: total,
    centerLocalX: dir * (total / 2 - halfFirst),
    direction: dir,
  }
}

export function cabinetStretchExitSide(stretch: CabinetStretchPreview): 'left' | 'right' {
  return stretch.direction === 1 ? 'right' : 'left'
}

export function cabinetStretchEndLocalX(
  stretch: CabinetStretchPreview,
  previewWidth: number,
): number {
  return stretch.direction * (stretch.length - previewWidth / 2)
}

export function resolveCabinetContinuousValidity(
  result: PlacementCollisionResult,
  forcePlace: boolean,
): PlacementCollisionResult {
  return forcePlace ? { conflictIds: [], valid: true } : result
}
