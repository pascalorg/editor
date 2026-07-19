import {
  DEFAULT_WALL_HEIGHT,
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallThickness,
  type QuickMeasurementReport,
  type WallNode,
} from '@pascal-app/core'

export function wallQuickMeasurement(node: WallNode): QuickMeasurementReport {
  const length = getWallCurveLength(node)
  const height = node.height ?? DEFAULT_WALL_HEIGHT
  const frame = getWallCurveFrameAt(node, 0.5)

  return {
    title: node.name ?? 'Wall',
    kindLabel: 'Wall',
    anchor: [frame.point.x, height * 0.55, frame.point.y],
    metrics: [
      { key: 'length', label: 'Length', abbreviation: 'L', quantity: 'length', value: length },
      { key: 'height', label: 'Height', abbreviation: 'H', quantity: 'length', value: height },
      {
        key: 'surface',
        label: 'Surface',
        abbreviation: 'A',
        quantity: 'area',
        value: length * height,
      },
      {
        key: 'thickness',
        label: 'Thickness',
        abbreviation: 'T',
        quantity: 'length',
        value: getWallThickness(node),
      },
    ],
    note: 'Gross face area before openings.',
  }
}
