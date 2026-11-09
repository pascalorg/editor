import {
  DEFAULT_WALL_THICKNESS,
  getWallBodyCenterOffset,
  getWallCurveFrameAt,
  isCurvedWall,
  resolveWallFaceBottom,
  type WallNode,
  type wallSupportForNodes,
} from '@pascal-app/core'

type WallSupport = ReturnType<typeof wallSupportForNodes>
type Segment = WallSupport['baseSegments'][number]

/** A run of the wall (normalised arc length) on one side, with its bottom elevation. */
export interface WallBaseCell {
  t0: number
  t1: number
  /** Which half of the thickness: both, or the `a` / `b` face half. */
  side: 'both' | 'a' | 'b'
  bottom: number
}

/**
 * The wall renderer's stepped bottom (`generateExtrudedWall`), as additive
 * cells: it extrudes from the lowest exposed support, then cuts away the
 * volume below every higher-supported run — per face when the two faces sit
 * on different floors. Returned cells cover the whole wall.
 */
export function wallBaseCells(wall: WallNode, support: WallSupport, top: number): WallBaseCell[] {
  const slabElevation = support.elevation
  const baseElevation = support.baseElevation ?? slabElevation
  const baseSegments: readonly Segment[] = support.baseSegments?.length
    ? support.baseSegments
    : [{ start: 0, end: 1, elevation: baseElevation }]
  const faceBase = support.faceDatum
    ? {
        a: resolveWallFaceBottom(support.faceDatum.a, baseSegments, slabElevation),
        b: resolveWallFaceBottom(support.faceDatum.b, baseSegments, slabElevation),
      }
    : undefined
  const useFaceBase =
    faceBase !== undefined &&
    ![faceBase.a, faceBase.b].every(
      (segments) => JSON.stringify(segments) === JSON.stringify(baseSegments),
    )
  const lowest = useFaceBase
    ? Math.min(
        ...[...faceBase!.a, ...faceBase!.b].flatMap((segment) => [
          segment.elevation,
          segment.endElevation ?? segment.elevation,
        ]),
        slabElevation,
      )
    : Math.min(baseElevation, slabElevation)

  const profiles = useFaceBase
    ? [
        ...faceBase!.a.map((segment) => ({ segment, face: 'a' as const })),
        ...faceBase!.b.map((segment) => ({ segment, face: 'b' as const })),
      ]
    : baseSegments.map((segment) => ({ segment, face: undefined }))
  const raised = profiles.flatMap(({ segment, face }) => {
    const elevation = face
      ? Math.min(Math.max(segment.elevation, segment.endElevation ?? segment.elevation), top)
      : Math.min(segment.elevation, slabElevation)
    const t0 = Math.max(0, Math.min(1, segment.start))
    const t1 = Math.max(0, Math.min(1, segment.end))
    return elevation - lowest > 1e-6 && t1 - t0 > 1e-7 ? [{ t0, t1, face, elevation }] : []
  })
  if (raised.length === 0) return [{ t0: 0, t1: 1, side: 'both', bottom: lowest }]

  const cuts = [...new Set([0, 1, ...raised.flatMap((run) => [run.t0, run.t1])])].sort(
    (a, b) => a - b,
  )
  const sides = useFaceBase ? (['a', 'b'] as const) : (['both'] as const)
  const cells: WallBaseCell[] = []
  for (const side of sides) {
    for (let i = 1; i < cuts.length; i++) {
      const t0 = cuts[i - 1]!
      const t1 = cuts[i]!
      if (t1 - t0 <= 1e-9) continue
      const mid = (t0 + t1) / 2
      const bottom = Math.max(
        lowest,
        ...raised
          .filter(
            (run) =>
              run.t0 <= mid && run.t1 >= mid && (run.face === undefined || run.face === side),
          )
          .map((run) => run.elevation),
      )
      const previous = cells[cells.length - 1]
      if (previous && previous.side === side && previous.t1 === t0 && previous.bottom === bottom) {
        previous.t1 = t1
      } else {
        cells.push({ t0, t1, side, bottom })
      }
    }
  }
  return cells
}

/**
 * Plan band (Pascal x/z) covering a cell's run and side, generously past the
 * faces and past the wall ends so mitred corners are included — the same
 * band the renderer cuts with.
 */
export function wallCellBand(wall: WallNode, cell: WallBaseCell): [number, number][] {
  const reach = Math.max((wall.thickness ?? DEFAULT_WALL_THICKNESS) * 2, 0.2)
  const center = getWallBodyCenterOffset(wall)
  const left = cell.side === 'b' ? center : reach
  const right = cell.side === 'a' ? center : -reach
  const samples = isCurvedWall(wall) ? Math.max(2, Math.ceil((cell.t1 - cell.t0) * 24)) : 1
  const leftSide: [number, number][] = []
  const rightSide: [number, number][] = []
  for (let index = 0; index <= samples; index++) {
    const t = cell.t0 + ((cell.t1 - cell.t0) * index) / samples
    const frame = getWallCurveFrameAt(wall, t)
    const extension =
      index === 0 && cell.t0 <= 1e-7 ? -reach : index === samples && cell.t1 >= 1 - 1e-7 ? reach : 0
    const x = frame.point.x + frame.tangent.x * extension
    const z = frame.point.y + frame.tangent.y * extension
    leftSide.push([x + frame.normal.x * left, z + frame.normal.y * left])
    rightSide.push([x + frame.normal.x * right, z + frame.normal.y * right])
  }
  return [...leftSide, ...rightSide.reverse()]
}
