import { type MeasurementPoint, measurementCentroid, measurementNormal } from '@pascal-app/core'
import { ShapeUtils, Vector2, Vector3 } from 'three'

type MeasurementPolygonProjection = {
  contour: Vector2[]
  triangles: number[][]
}

function projectMeasurementPolygon(
  points: readonly MeasurementPoint[],
): MeasurementPolygonProjection | null {
  const normalValue = measurementNormal(points)
  const originValue = points[0]
  if (!(normalValue && originValue)) return null

  const normal = new Vector3(...normalValue)
  const reference = Math.abs(normal.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)
  const tangent = new Vector3().crossVectors(reference, normal).normalize()
  const bitangent = new Vector3().crossVectors(normal, tangent).normalize()
  const origin = new Vector3(...originValue)
  const contour = points.map((point) => {
    const relative = new Vector3(...point).sub(origin)
    return new Vector2(relative.dot(tangent), relative.dot(bitangent))
  })

  return { contour, triangles: ShapeUtils.triangulateShape(contour, []) }
}

export function triangulateMeasurementPolygon(points: readonly MeasurementPoint[]): number[][] {
  return projectMeasurementPolygon(points)?.triangles ?? []
}

export function measurementPolygonLabelAnchor(
  points: readonly MeasurementPoint[],
): MeasurementPoint | null {
  const projection = projectMeasurementPolygon(points)
  if (!projection || projection.triangles.length === 0) return measurementCentroid(points)

  let largestTriangle: number[] | null = null
  let largestArea = Number.NEGATIVE_INFINITY
  for (const triangle of projection.triangles) {
    const [firstIndex, secondIndex, thirdIndex] = triangle
    const first = firstIndex === undefined ? null : projection.contour[firstIndex]
    const second = secondIndex === undefined ? null : projection.contour[secondIndex]
    const third = thirdIndex === undefined ? null : projection.contour[thirdIndex]
    if (!(first && second && third)) continue
    const area = Math.abs(
      (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x),
    )
    if (area > largestArea) {
      largestArea = area
      largestTriangle = triangle
    }
  }

  if (!largestTriangle) return measurementCentroid(points)
  const [firstIndex, secondIndex, thirdIndex] = largestTriangle
  const first = firstIndex === undefined ? null : points[firstIndex]
  const second = secondIndex === undefined ? null : points[secondIndex]
  const third = thirdIndex === undefined ? null : points[thirdIndex]
  if (!(first && second && third)) return measurementCentroid(points)

  return [
    (first[0] + second[0] + third[0]) / 3,
    (first[1] + second[1] + third[1]) / 3,
    (first[2] + second[2] + third[2]) / 3,
  ]
}
