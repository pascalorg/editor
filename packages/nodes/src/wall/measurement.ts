import {
  DEFAULT_WALL_HEIGHT,
  getWallCurveFrameAt,
  getWallThickness,
  type MeasurementFeature,
  type MeasurementFeatureBinding,
  type MeasurementFeatureReference,
  sampleWallCenterline,
  type WallNode,
} from '@pascal-app/core'

const point = (x: number, y: number, z: number) => [x, y, z] as [number, number, number]

export function wallMeasurementFeatures(wall: WallNode): MeasurementFeature[] {
  const height = wall.height ?? DEFAULT_WALL_HEIGHT
  const centerline = sampleWallCenterline(wall).map(({ x, y }) => point(x, 0, y))
  const midpoint = getWallCurveFrameAt(wall, 0.5).point
  const halfThickness = getWallThickness(wall) / 2
  const leftFace = centerline.map((_center, index) => {
    const frame = getWallCurveFrameAt(wall, index / Math.max(1, centerline.length - 1))
    return point(
      frame.point.x + frame.normal.x * halfThickness,
      0,
      frame.point.y + frame.normal.y * halfThickness,
    )
  })
  const rightFace = centerline.map((_center, index) => {
    const frame = getWallCurveFrameAt(wall, index / Math.max(1, centerline.length - 1))
    return point(
      frame.point.x - frame.normal.x * halfThickness,
      0,
      frame.point.y - frame.normal.y * halfThickness,
    )
  })

  return [
    {
      id: 'wall:start',
      label: 'Wall start',
      snapKind: 'endpoint',
      priority: 100,
      geometry: { kind: 'point', point: point(wall.start[0], 0, wall.start[1]) },
    },
    {
      id: 'wall:end',
      label: 'Wall end',
      snapKind: 'endpoint',
      priority: 100,
      geometry: { kind: 'point', point: point(wall.end[0], 0, wall.end[1]) },
    },
    {
      id: 'wall:centerline',
      label: 'Wall centerline',
      snapKind: 'edge',
      priority: 80,
      geometry: { kind: 'path', points: centerline },
    },
    {
      id: 'wall:midpoint',
      label: 'Wall midpoint',
      snapKind: 'midpoint',
      priority: 90,
      geometry: { kind: 'point', point: point(midpoint.x, 0, midpoint.y) },
    },
    {
      id: 'wall:face:left',
      label: 'Wall face',
      snapKind: 'face',
      priority: 95,
      geometry: { kind: 'path', points: leftFace },
    },
    {
      id: 'wall:face:right',
      label: 'Wall face',
      snapKind: 'face',
      priority: 95,
      geometry: { kind: 'path', points: rightFace },
    },
    {
      id: 'wall:height',
      label: 'Wall height',
      snapKind: 'height',
      priority: 85,
      geometry: {
        kind: 'segment',
        start: point(midpoint.x, 0, midpoint.y),
        end: point(midpoint.x, height, midpoint.y),
      },
    },
    {
      id: 'wall:top-centerline',
      label: 'Wall top',
      snapKind: 'edge',
      priority: 75,
      geometry: {
        kind: 'path',
        points: centerline.map(([x, , z]) => point(x, height, z)),
      },
    },
  ]
}

export function matchWallMeasurementFeature(
  wall: WallNode,
  hit: [number, number, number],
  maxDistance: number,
): MeasurementFeatureBinding | null {
  const points = sampleWallCenterline(wall)
  let best: MeasurementFeatureBinding | null = null
  let before = 0
  const lengths = points.slice(1).map((end, index) => {
    const start = points[index]!
    return Math.hypot(end.x - start.x, end.y - start.y)
  })
  const total = lengths.reduce((sum, length) => sum + length, 0)

  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index]!
    const end = points[index + 1]!
    const dx = end.x - start.x
    const dz = end.y - start.y
    const lengthSquared = dx * dx + dz * dz
    const localT =
      lengthSquared <= 1e-12
        ? 0
        : Math.max(
            0,
            Math.min(1, ((hit[0] - start.x) * dx + (hit[2] - start.y) * dz) / lengthSquared),
          )
    const t = total <= 1e-9 ? 0 : (before + localT * lengths[index]!) / total
    const frame = getWallCurveFrameAt(wall, t)
    const side =
      (hit[0] - frame.point.x) * frame.normal.x + (hit[2] - frame.point.y) * frame.normal.y >= 0
        ? 1
        : -1
    const halfThickness = getWallThickness(wall) / 2
    const faceX = frame.point.x + frame.normal.x * halfThickness * side
    const faceZ = frame.point.y + frame.normal.y * halfThickness * side
    const faceDistance = Math.hypot(hit[0] - faceX, hit[2] - faceZ)
    const threshold = Math.max(maxDistance, halfThickness + 0.03)
    if (faceDistance <= threshold && (!best || faceDistance < best.distance)) {
      const height = Math.max(0, Math.min(wall.height ?? DEFAULT_WALL_HEIGHT, hit[1]))
      best = {
        featureId: side > 0 ? 'wall:face:left' : 'wall:face:right',
        point: point(faceX, height, faceZ),
        parameters: { t, height },
        distance: faceDistance,
      }
    }
    before += lengths[index]!
  }
  return best
}

export function resolveWallMeasurementFeature(
  wall: WallNode,
  reference: MeasurementFeatureReference,
): MeasurementFeature | null {
  const feature = wallMeasurementFeatures(wall).find(
    (candidate) => candidate.id === reference.featureId,
  )
  if (!feature) return null
  const heightValue = reference.parameters?.height
  if (typeof heightValue !== 'number' || feature.geometry.kind !== 'path') return feature
  const height = Math.max(0, Math.min(wall.height ?? DEFAULT_WALL_HEIGHT, heightValue))
  return {
    ...feature,
    geometry: {
      ...feature.geometry,
      points: feature.geometry.points.map(([x, , z]) => point(x, height, z)),
    },
  }
}
