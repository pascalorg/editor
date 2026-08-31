import {
  type MeasurementPoint,
  measurementArea,
  measurementCentroid,
  measurementPerimeter,
} from '@pascal-app/core'

type PolygonPoint = readonly [number, number]

export function polygonMeasurementPoints(
  polygon: readonly PolygonPoint[],
  height: number,
): MeasurementPoint[] {
  return polygon.map(([x, z]) => [x, height, z])
}

export function polygonSurfaceArea(
  polygon: readonly PolygonPoint[],
  holes: readonly (readonly PolygonPoint[])[] = [],
): number {
  const outer = measurementArea(polygonMeasurementPoints(polygon, 0))
  const openings = holes.reduce(
    (total, hole) => total + measurementArea(polygonMeasurementPoints(hole, 0)),
    0,
  )
  return Math.max(0, outer - openings)
}

export function polygonBoundaryLength(polygon: readonly PolygonPoint[]): number {
  return measurementPerimeter(polygonMeasurementPoints(polygon, 0))
}

export function polygonReportAnchor(
  polygon: readonly PolygonPoint[],
  height: number,
): MeasurementPoint {
  return measurementCentroid(polygonMeasurementPoints(polygon, height)) ?? [0, height, 0]
}
