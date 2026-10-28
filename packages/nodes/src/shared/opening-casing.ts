import {
  type AnyNode,
  type DoorNode,
  type FloorplanGeometry,
  type FloorplanPoint,
  getWallBodyCenterOffset,
  type OpeningCasingHost,
  openingCasingBoards,
  roomSideFaces,
  type WallFace,
  type WallNode,
  type WindowNode,
} from '@pascal-app/core'

type CasingPlanStyle = {
  fill: string
  stroke: string
  strokeWidth: number
  /** Screen-pixel strokes in the editor; plan-metre ink on a drafted sheet. */
  vectorEffect?: 'non-scaling-stroke'
}

/**
 * The casing a door's or window's plan shows: the legs beside the cutout on
 * each face of the wall it is cased on, each a short rectangle standing proud
 * of the finished face, as plans draw trim. Null when there is none to draw (a
 * curtain wall, a railing, a script-built unit, both faces turned off).
 * `cornerEnd` is the wall end a corner window runs to, where it has no leg.
 */
export function buildOpeningCasingPlan(
  opening: DoorNode | WindowNode,
  wall: WallNode,
  style: CasingPlanStyle,
  cornerEnd?: OpeningCasingHost['cornerEnd'],
): FloorplanGeometry | null {
  if (opening.source || wall.wallType === 'curtain' || wall.wallType === 'railing') return null
  const [x1, z1] = wall.start
  const dx = wall.end[0] - x1
  const dz = wall.end[1] - z1
  const length = Math.hypot(dx, dz)
  if (length < 1e-9) return null
  const dir = [dx / length, dz / length] as const
  const perp = [-dir[1], dir[0]] as const
  const plan = (along: number, across: number): FloorplanPoint => [
    x1 + dir[0] * along + perp[0] * across,
    z1 + dir[1] * along + perp[1] * across,
  ]
  // Boards are measured from the opening's centre plane, which a justified wall
  // sets off its reference line and a plane offset sets off the wall's body.
  const centreAcross = getWallBodyCenterOffset(wall) + (opening.position[2] ?? 0)
  const host: OpeningCasingHost = {
    thickness: wall.thickness ?? 0.1,
    ...(cornerEnd ? { cornerEnd } : {}),
  }
  const children: FloorplanGeometry[] = openingCasingBoards(opening, host)
    .filter((board) => board.part === 'leg')
    .map(({ center, size }): FloorplanGeometry => {
      const along = opening.position[0] + center[0]
      const across = centreAcross + center[2]
      const [halfAlong, halfAcross] = [size[0] / 2, size[2] / 2]
      return {
        kind: 'polygon',
        points: [
          plan(along - halfAlong, across + halfAcross),
          plan(along + halfAlong, across + halfAcross),
          plan(along + halfAlong, across - halfAcross),
          plan(along - halfAlong, across - halfAcross),
        ],
        ...style,
        strokeLinejoin: 'miter',
      }
    })
  return children.length ? { kind: 'group', children } : null
}

/**
 * What the door and window panels call the faces an opening can be cased on. A
 * wall with rooms on one side only (an outside wall, as the wall panel's paint
 * regions tell it) names them Exterior and Interior, as does a roof face, whose
 * `a` is its outside; any other wall keeps the wall panel's Side A and Side B.
 */
export function openingCasingFaceLabels(
  nodes: Readonly<Record<string, AnyNode>>,
  opening: Pick<DoorNode | WindowNode, 'parentId' | 'roofSegmentId'>,
): Record<WallFace, string> {
  if (opening.roofSegmentId) return { a: 'Exterior', b: 'Interior' }
  const wallId = opening.parentId
  if (wallId && nodes[wallId]?.type === 'wall') {
    try {
      const { inside, outside } = roomSideFaces(
        nodes as Parameters<typeof roomSideFaces>[0],
        wallId,
      )
      if (inside && outside) {
        return { [outside]: 'Exterior', [inside]: 'Interior' } as Record<WallFace, string>
      }
    } catch {
      // Not a wall (any more): fall through to the neutral labels.
    }
  }
  return { a: 'Side A', b: 'Side B' }
}
