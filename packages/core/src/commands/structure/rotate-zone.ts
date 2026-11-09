import { polygonCentroid } from '../../lib/polygon-label'
import { type Point, requireZone, roomFace, type StructureNodes } from './shared'
import { type TransformZoneInput, transformZone } from './transform-zone'

export type RotateZoneInput = Pick<TransformZoneInput, 'zoneId' | 'mintId' | 'force'> & {
  quarterTurns: 1 | -1
  gridStep?: number
}

export function rotateZone(nodes: StructureNodes, input: RotateZoneInput) {
  const gridStep = input.gridStep ?? 0.5
  if (!(Number.isFinite(gridStep) && gridStep > 0) || ![1, -1].includes(input.quarterTurns))
    throw Error('Use quarterTurns 1 or -1 and a positive finite gridStep.')
  const zone = requireZone(nodes, input.zoneId)
  if (zone.floor?.support === 'open')
    return transformZone(nodes, { ...input, rotate: { angle: (input.quarterTurns * Math.PI) / 2 } })
  const face = roomFace(nodes, zone)
  if (!face) return transformZone(nodes, input)
  const pivot = polygonCentroid({ outer: face.referencePolygon, holes: face.holes })
  const first = face.referencePolygon[0]!
  const rotated: Point = [
    pivot[0] + input.quarterTurns * (first[1] - pivot[1]),
    pivot[1] - input.quarterTurns * (first[0] - pivot[0]),
  ]
  const translate: Point = rotated.map(
    (value) => Math.round(value / gridStep) * gridStep - value,
  ) as Point
  return transformZone(nodes, {
    zoneId: input.zoneId,
    mintId: input.mintId,
    force: input.force,
    translate,
    rotate: { angle: (input.quarterTurns * Math.PI) / 2, pivot },
  })
}
