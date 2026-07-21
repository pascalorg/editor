import type { FloorplanGeometry, FloorplanPoint } from '@pascal-app/core'

export type DimensionStringSegment = {
  witnessStart: FloorplanPoint
  witnessEnd: FloorplanPoint
  dimensionStart: FloorplanPoint
  dimensionEnd: FloorplanPoint
  text: string
}

export type DimensionStringGeometryInput = {
  segments: readonly DimensionStringSegment[]
  offsetNormal: FloorplanPoint
  offsetDistance?: number
  extensionOvershoot?: number
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
    extensionOvershoot: input.extensionOvershoot ?? 0,
    stroke: input.stroke,
  }
}
