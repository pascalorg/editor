import type {
  DimensionTerminator,
  DimensionTextPosition,
  FloorplanGeometry,
  FloorplanPoint,
} from '@pascal-app/core'

export type DimensionStringSegment = {
  witnessStart: FloorplanPoint
  witnessEnd: FloorplanPoint
  dimensionStart?: FloorplanPoint
  dimensionEnd?: FloorplanPoint
  text: string
}

export type DimensionStringGeometryInput = {
  segments: readonly DimensionStringSegment[]
  offsetNormal: FloorplanPoint
  offsetDistance?: number
  extensionStartGap?: number
  extensionOvershoot?: number
  terminator?: DimensionTerminator
  textPosition?: DimensionTextPosition
  stroke?: string
}

export function buildDimensionStringGeometry(
  input: DimensionStringGeometryInput,
): FloorplanGeometry {
  return {
    kind: 'dimension-string',
    segments: input.segments.map((segment) => ({
      start: segment.witnessStart,
      end: segment.witnessEnd,
      dimensionStart: segment.dimensionStart,
      dimensionEnd: segment.dimensionEnd,
      text: segment.text,
    })),
    offsetNormal: input.offsetNormal,
    offsetDistance: input.offsetDistance ?? 0,
    extensionStartGap: input.extensionStartGap,
    extensionOvershoot: input.extensionOvershoot ?? 0,
    terminator: input.terminator,
    textPosition: input.textPosition,
    stroke: input.stroke,
  }
}
