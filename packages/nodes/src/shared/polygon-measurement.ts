import type { MeasurementFeature, MeasurementPoint } from '@pascal-app/core'

type PolygonPoint = readonly [number, number]

function polygonCenter(polygon: readonly PolygonPoint[], height: number): MeasurementPoint {
  if (polygon.length === 0) return [0, height, 0]
  const [x, z] = polygon.reduce(([sumX, sumZ], point) => [sumX + point[0], sumZ + point[1]], [0, 0])
  return [x / polygon.length, height, z / polygon.length]
}

export function polygonMeasurementFeatures({
  featurePrefix,
  height,
  label,
  polygon,
}: {
  featurePrefix: string
  height: number
  label: string
  polygon: readonly PolygonPoint[]
}): MeasurementFeature[] {
  const points = polygon.map(([x, z]) => [x, height, z] satisfies MeasurementPoint)
  return [
    ...points.map(
      (point, index) =>
        ({
          id: `${featurePrefix}:vertex:${index}`,
          label: `${label} corner`,
          snapKind: 'endpoint',
          priority: 110,
          normal: [0, 1, 0],
          geometry: { kind: 'point', point },
        }) satisfies MeasurementFeature,
    ),
    {
      id: `${featurePrefix}:boundary`,
      label: `${label} boundary`,
      snapKind: 'edge',
      priority: 90,
      normal: [0, 1, 0],
      geometry: { kind: 'polygon', points },
    },
    {
      id: `${featurePrefix}:center`,
      label: `${label} center`,
      snapKind: 'center',
      priority: 70,
      normal: [0, 1, 0],
      geometry: { kind: 'point', point: polygonCenter(polygon, height) },
    },
  ]
}
