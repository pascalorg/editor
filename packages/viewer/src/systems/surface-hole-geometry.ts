import { type Point2D, unionPolygons } from '../lib/polygon-union'

export function mergeSurfaceHolePolygons(holes: Point2D[][]): Point2D[][] {
  return unionPolygons(holes)
}
