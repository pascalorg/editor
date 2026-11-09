import {
  type AnyNode,
  area,
  getWallCurveFrameAt,
  getWallFaceOffsets,
  intersection,
  isCurvedWall,
  type WallFace,
  type WallNode,
} from '@pascal-app/core'

/** How far in front of the face a floor opening must reach to break the skirting. */
const REACH = 0.05

/**
 * Where a floor opening of the wall's level meets one of its faces, as wall-local x ranges along
 * the chord (as the trim's runs are measured): the skirting breaks there, as it does at a door,
 * rather than running on in mid-air along a double-height void or a stairwell.
 */
export function skirtingFloorOpeningRanges(
  wall: WallNode,
  face: WallFace,
  nodes: Readonly<Record<string, AnyNode>>,
): [number, number][] {
  const openings = Object.values(nodes).filter(
    (node) =>
      node.type === 'floor-opening' &&
      node.parentId === wall.parentId &&
      node.drawnOn === 'floor' &&
      node.cutsPrimary,
  )
  if (!openings.length) return []
  const offset = getWallFaceOffsets(wall)[face]
  const out = offset + (face === 'a' ? REACH : -REACH)
  const samples = isCurvedWall(wall) ? 24 : 1
  const near: [number, number][] = []
  const far: [number, number][] = []
  for (let index = 0; index <= samples; index++) {
    const { point, normal } = getWallCurveFrameAt(wall, index / samples)
    near.push([point.x + normal.x * offset, point.y + normal.y * offset])
    far.push([point.x + normal.x * out, point.y + normal.y * out])
  }
  const band = [...near, ...far.reverse()]
  const [dx, dz] = [wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]]
  const length = Math.hypot(dx, dz) || 1
  const along = ([x, z]: [number, number]) =>
    ((x - wall.start[0]) * dx + (z - wall.start[1]) * dz) / length
  return openings.flatMap((opening) =>
    intersection(band, (opening as Extract<AnyNode, { type: 'floor-opening' }>).polygon)
      .filter((part) => area([part]) > 1e-6)
      .map((part): [number, number] => {
        const xs = part.outer.map(along)
        return [Math.min(...xs), Math.max(...xs)]
      }),
  )
}
