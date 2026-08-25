import { type PolygonBooleanPoint2D as Point2D, unionPolygons } from '@pascal-app/core'

export function mergeSurfaceHolePolygons(holes: Point2D[][]): Point2D[][] {
  return unionPolygons(holes)
}
