import type { FloorPlacementClickTriggerEvent } from '../shared/floor-placement'
import { planToRunLocal, runLocalToPlan } from './run-layout'
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
  wallSurfaceNormal?: [number, number, number]
  forcedDirection?: 1 | -1
  leadingWidth?: number
}

export type StretchContinuation = {
  hingePosition: [number, number, number]
  sourceYaw: number
  sourceDirection: 1 | -1
  straightAnchor: StretchAnchor
  turnAnchor: StretchAnchor
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
  const hasLeadingWidth = anchor.leadingWidth != null
  const projected = anchor.forcedDirection ? Math.max(0, localX * dir) : Math.abs(localX)
  const minTotalLength = hasLeadingWidth ? firstWidth + previewWidth : firstWidth
  const length = Math.max(projected + halfFirst, minTotalLength)
  const trailingLength = Math.max(0, length - firstWidth)
  const trailingWidths = trailingLength <= 1e-6 ? [] : fillCabinetContinuousSpan(trailingLength)
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

export function createCabinetContinuousContinuation({
  anchor,
  previewDepth,
  previewWidth,
  stretch,
}: {
  anchor: StretchAnchor
  previewDepth: number
  previewWidth: number
  stretch: CabinetStretchPreview
}): StretchContinuation {
  const endLocalX = cabinetStretchEndLocalX(stretch, previewWidth)
  const hingePosition = runLocalToPlan({ position: anchor.position, rotation: anchor.yaw }, [
    endLocalX,
    0,
    0,
  ])
  const straightAnchor = {
    position: runLocalToPlan({ position: anchor.position, rotation: anchor.yaw }, [
      endLocalX + stretch.direction * (previewWidth / 2),
      0,
      0,
    ]),
    yaw: anchor.yaw,
    snappedToWall: anchor.snappedToWall,
    wallSurfaceNormal: anchor.wallSurfaceNormal,
  } satisfies StretchAnchor

  const exitSide = cabinetStretchExitSide(stretch)
  const sourceAxis: [number, number] = [Math.cos(anchor.yaw), -Math.sin(anchor.yaw)]
  const corner = runLocalToPlan({ position: anchor.position, rotation: anchor.yaw }, [
    endLocalX,
    0,
    -previewDepth / 2,
  ])
  const sign = exitSide === 'right' ? 1 : -1
  const shiftedCorner: [number, number] = [
    corner[0] + sign * previewDepth * sourceAxis[0],
    corner[2] + sign * previewDepth * sourceAxis[1],
  ]
  const yaw = exitSide === 'right' ? anchor.yaw - Math.PI / 2 : anchor.yaw + Math.PI / 2
  const turnAnchor = {
    position: runLocalToPlan(
      {
        position: [shiftedCorner[0], anchor.position[1], shiftedCorner[1]],
        rotation: yaw,
      },
      [previewDepth / 2, 0, previewDepth / 2],
    ),
    yaw,
    snappedToWall: false,
    forcedDirection: 1,
    leadingWidth: previewDepth,
  } satisfies StretchAnchor

  return {
    hingePosition,
    sourceYaw: anchor.yaw,
    sourceDirection: stretch.direction,
    straightAnchor,
    turnAnchor,
  }
}

export function chooseCabinetContinuousAnchor(
  continuation: StretchContinuation,
  rawPlanPosition: [number, number, number],
): StretchAnchor {
  const [localX, , localZ] = planToRunLocal(
    { position: continuation.hingePosition, rotation: continuation.sourceYaw },
    rawPlanPosition[0],
    0,
    rawPlanPosition[2],
  )
  const forward = localX * continuation.sourceDirection
  const lateral = Math.abs(localZ)
  return forward >= lateral ? continuation.straightAnchor : continuation.turnAnchor
}

export function resolveCabinetContinuousValidity(
  result: PlacementCollisionResult,
  forcePlace: boolean,
): PlacementCollisionResult {
  return forcePlace ? { conflictIds: [], valid: true } : result
}

export function isCabinetContinuousFollowUpClick(clickCount: number): boolean {
  return clickCount >= 2
}
