import { refuse } from '../agent-tools/refusal'
import {
  applyHomography,
  type CameraFace,
  type CameraFailure,
  cameraFaceHomography,
  type FaceAxes,
  faceAtWidth,
  faceCoordinates,
  faceThroughCorner,
  type Homography,
  invertHomography,
  lineIntersection,
  multiplyHomography,
  type PhotoCamera,
  pointOnFace,
  solveHomography,
  solvePhotoCamera,
  type Vec3,
  vanishingPoint,
  vanishingResidualPx,
} from '../building/photo-elevation'
import type { AnyNode, AnyNodeId, WallNode } from '../schema'
import { getLevelElevations, type LevelElevation } from '../services/storey'
import type { SceneNodes } from './types'

type Pt = [number, number]
type Segment = [Pt, Pt]

export type PhotoFaceInput = {
  name?: string
  /** The walls of the face on one storey, end to end: their extent is the width. */
  wallIds: string[]
  /**
   * Two points on each vertical edge of the face as seen, as fractions of the image. A face whose
   * far edge leaves the photo gives only the corner it shares with another face of the call.
   */
  edges: { left?: Pt[]; right?: Pt[] }
  /**
   * The same feature on at least two storeys, two points along each, with its storey, and the
   * feature's height above that floor when known (window heads 2.1 m): it sets the camera's height.
   */
  rows: { levelId: string; points: Pt[]; height?: number }[]
  /** More horizontal lines on the face, two points each: they steady its vanishing point. */
  lines?: Pt[][]
  /**
   * Points at known places on the face (window and door corners, eave ends): metres along it from
   * its left end as seen, metres up from a floor (the face's, by default), and where the photo
   * shows them. Each one steadies the pose.
   */
  points?: { along: number; height: number; levelId?: string; point: Pt }[]
}

export type PhotoElevationInput = {
  faces: PhotoFaceInput[]
  /**
   * The camera's focal length on a 36 × 24 mm frame, when known: a frontal photo does not show
   * it. A phone's main camera is about 26 mm.
   */
  focal35mm?: number
  /** More vertical lines anywhere on the building, two points each: they steady the camera's tilt. */
  verticals?: Pt[][]
}

export type PhotoFacePlan = {
  name: string
  widthMeters: number
  /**
   * Metres along the face from its left end at the drawing's left and right sides: 0 and the
   * width, unless the face runs out of the photo.
   */
  leftMeters: number
  rightMeters: number
  /** Metres above the lowest row's feature at the top and bottom of the drawing. */
  topMeters: number
  bottomMeters: number
  pxPerMetre: number
  outWidth: number
  outHeight: number
  /** Drawing pixel to photo pixel. */
  toSource: Homography
  /** Photo pixels per metre up each side of the drawing: few, and panes blur. */
  sourcePxPerMetre: { left: number; right: number }
  /** Root mean square of the picked points against the fit, in photo pixels. */
  residualPx: number
  /** The picked feature on every storey the drawing shows, in drawing pixels. */
  featureLines: { levelId: string; name: string; y: number }[]
  /** Where each row meets each edge in the photo, for a close-up to check. */
  corners: {
    edge: 'left' | 'right'
    levelId: string
    point: Pt
    rowLine: [Pt, Pt]
    edgeLine: [Pt, Pt]
  }[]
  /**
   * Floor to floor between the rows' storeys, as the photo measures it and as the scene has it.
   * Only with the camera: without it, the storeys are the drawing's vertical scale.
   */
  storeyHeight?: { photo: number; scene: number }
  warnings: string[]
}

/** The camera several faces of the photo share. */
export type PhotoCameraSummary = {
  focalPx: number
  /** The focal length on a 36 × 24 mm frame: a phone's main camera is about 24–28 mm. */
  focal35mm: number
  horizontalFovDeg: number
  /**
   * Where the optical axis meets the photo, down from its top, in photo pixels: about half the
   * photo's height for a phone photo as taken, near the horizon for a perspective-corrected one.
   */
  principalPointY: number
  /** The optical axis above the horizon (up is positive), and how far the photo is turned. */
  pitchDeg: number
  rollDeg: number
  /** Camera from world, row-major: world x along the first face, y up, z out of it. */
  rotation: number[]
  /** The camera in the scene, for view_scene; null when the faces leave its side unknown. */
  pose: PhotoPose | null
  assumptions: string
  warnings: string[]
}

/** Where the photo was taken from, in the scene's coordinates (y up), as view_scene takes it. */
export type PhotoPose = {
  projection: 'perspective'
  position: Vec3
  target: Vec3
  /** The camera's up, which carries the photo's roll. */
  up: Vec3
  /** Vertical field of view, degrees. */
  fov: number
  /** The photo's width over its height. */
  aspect: number
  /** How far below the photo's middle its optical axis meets it, as a share of its height. */
  shift: number
  /** What set the camera's height: the rows' feature height, or the edges' foot taken for the ground. */
  anchoredBy: 'row height' | 'edge base'
  /** The focal length was taken (focal35mm, else a phone's), not read from the photo. */
  focalAssumed: boolean
  /** The picked edges against the walls' ends projected through the pose, in photo pixels. */
  edgeResidualPx: number
  /** How far the eye moves, in metres, when the picks move by their own error. */
  spread?: number
}

/** Longest side of a drawing, and the finest scale worth drawing a facade at. */
const MAX_SIDE = 1200
const MAX_PX_PER_METRE = 60
/** Below this, windows of a photo carry too few pixels for panes. */
const FEW_PX_PER_METRE = 25
/** A floor-to-floor height under this is a modelling default, not a building's: it squashes the drawing. */
const LOW_STOREY = 2.6
/** Faces whose walls are this close to square are taken to meet at a right angle. */
const SQUARE = 0.1
/** How far apart, as a share of the photo's longer side, two picks of one corner may be. */
const SAME_CORNER = 0.03
/** Storeys the photo measures this much off the scene's are flagged. */
const STOREY_MISMATCH = 0.1
/** Two faces putting their shared corner this much apart in depth disagree. */
const CORNER_MISMATCH = 0.05

const ASSUMPTIONS =
  "Square pixels, no skew, no lens distortion, plumb walls, and faces whose walls meet square meet square in the photo. The principal point is taken at the photo's centre across (a photo cropped sideways breaks it); its height is fitted from the lines, since a perspective-corrected photo keeps its verticals parallel by moving it toward the horizon."

const inside = ([x, y]: Pt) => x >= 0 && x <= 1 && y >= 0 && y <= 1
const mean = (values: readonly number[]) => values.reduce((sum, v) => sum + v, 0) / values.length

function faceWalls(nodes: SceneNodes, wallIds: readonly string[]) {
  const walls = wallIds.map((id) => {
    const wall = nodes[id]
    if (!wall) refuse('wall_not_found', `Wall not found: ${id}.`, { wallId: id })
    if (wall.type !== 'wall')
      refuse('not_a_wall', `Node ${id} is a ${wall.type}, not a wall.`, { wallId: id })
    return wall as WallNode
  })
  const [first] = walls
  if (!first || walls.some((wall) => wall.parentId !== first.parentId))
    refuse('walls_not_one_face', 'Pass the walls of one face on one storey.', { wallIds })
  const length = Math.hypot(first!.end[0] - first!.start[0], first!.end[1] - first!.start[1])
  const axis: Pt = [
    (first!.end[0] - first!.start[0]) / length,
    (first!.end[1] - first!.start[1]) / length,
  ]
  const origin = first!.start as Pt
  const points = walls.flatMap((wall) => [wall.start, wall.end] as Pt[])
  const off = ([x, z]: Pt) => Math.abs(-(x - origin[0]) * axis[1] + (z - origin[1]) * axis[0])
  if (points.some((point) => off(point) > 0.15))
    refuse(
      'walls_not_one_face',
      'These walls are not one straight face: pass the walls along one side only, end to end.',
      { wallIds },
    )
  const along = points.map(([x, z]) => (x - origin[0]) * axis[0] + (z - origin[1]) * axis[1])
  const ends: [Pt, Pt] = [
    points[along.indexOf(Math.min(...along))]!,
    points[along.indexOf(Math.max(...along))]!,
  ]
  return { width: Math.max(...along) - Math.min(...along), axis, ends, levelId: first!.parentId! }
}

/** A face as picked, in photo pixels, its rows lowest storey first. */
type Face = {
  name: string
  width: number
  axis: Pt
  /** The walls' two ends in plan, along `axis` first to last, and their storey. */
  ends: [Pt, Pt]
  levelId: string
  left?: Segment
  right?: Segment
  /** Points at known places on the face: (along, height in the scene) and their pixel. */
  points: { from: Pt; to: Pt }[]
  /** `y`: the row's height in the scene, its floor plus its height when given. */
  rows: { levelId: string; points: Segment; baseY: number; height?: number; y: number }[]
  lines: Segment[]
}

type Elevations = Map<string, LevelElevation>

function readFace(
  nodes: SceneNodes,
  elevations: Elevations,
  face: PhotoFaceInput,
  index: number,
  px: (point: Pt) => Pt,
): Face {
  const name = face.name ?? `Face ${index + 1}`
  const picked = [
    ...(face.edges.left ?? []),
    ...(face.edges.right ?? []),
    ...face.rows.flatMap((r) => r.points),
    ...(face.lines ?? []).flat(),
  ]
  if (picked.some((point) => !inside(point)))
    refuse(
      'point_outside_image',
      `${name}: every point is a fraction of the image, 0 to 1 across and down.`,
      { face: name },
    )
  if (!face.edges.left && !face.edges.right)
    refuse(
      'face_needs_an_edge',
      `${name}: pick at least one of its vertical edges; a face whose far edge leaves the photo gives the corner it shares with another face.`,
      { face: name },
    )
  const { width, axis, ends, levelId } = faceWalls(nodes, face.wallIds)
  const rows = face.rows.map((row) => {
    const level = elevations.get(row.levelId)
    if (!level || nodes[row.levelId]?.type !== 'level')
      refuse('level_not_found', `Level not found: ${row.levelId}.`, { levelId: row.levelId })
    return {
      levelId: row.levelId,
      points: segment(row.points, px),
      baseY: level!.baseY,
      ...(row.height !== undefined ? { height: row.height } : {}),
      y: level!.baseY + (row.height ?? 0),
    }
  })
  // Lowest first, whatever order the rows came in: the close-ups show the extremes.
  rows.sort((a, b) => a.y - b.y)
  if (new Set(rows.map((row) => Math.round(row.y * 1000))).size < 2)
    refuse(
      'rows_one_storey',
      `${name}: pick the same feature on at least two storeys, or two lines at heights you know on one (the floor at 0 and the eaves at the wall's height, say): the drawing needs a height to scale by.`,
      { face: name },
    )
  return {
    name,
    width,
    axis,
    ends,
    levelId,
    ...(face.edges.left ? { left: segment(face.edges.left, px) } : {}),
    ...(face.edges.right ? { right: segment(face.edges.right, px) } : {}),
    rows,
    points: (face.points ?? []).map((point) => {
      if (!inside(point.point))
        refuse(
          'point_outside_image',
          `${name}: every point is a fraction of the image, 0 to 1 across and down.`,
          { face: name },
        )
      const floor = elevations.get(point.levelId ?? levelId)
      if (!floor)
        refuse('level_not_found', `Level not found: ${point.levelId}.`, { levelId: point.levelId })
      return { from: [point.along, floor!.baseY + point.height] as Pt, to: px(point.point) }
    }),
    lines: (face.lines ?? []).map((line) => segment(line, px)),
  }
}

const segment = (points: readonly Pt[], px: (point: Pt) => Pt): Segment => [
  px(points[0]!),
  px(points[1]!),
]

/** Where each row meets each picked edge, lowest row first. */
function cornersOf(face: Face) {
  const corners: PhotoFacePlan['corners'] = []
  for (const row of face.rows)
    for (const [edge, edgeLine] of [
      ['left', face.left],
      ['right', face.right],
    ] as const) {
      if (!edgeLine) continue
      const point = lineIntersection(row.points, edgeLine)
      if (!point)
        refuse('face_degenerate', `${face.name}: a row runs parallel to an edge.`, {
          face: face.name,
        })
      corners.push({ edge, levelId: row.levelId, point: point!, rowLine: row.points, edgeLine })
    }
  return corners
}

/** The scene's storeys in the drawing: the picked feature on each, from the lowest row's. */
function featureLinesOf(
  nodes: SceneNodes,
  elevations: Elevations,
  face: Face,
  extent: { bottom: number; top: number; pxPerMetre: number },
) {
  const lowest = face.rows[0]!.baseY
  const buildingId = elevations.get(face.rows[0]!.levelId)?.buildingId ?? null
  return [...elevations.entries()]
    .filter(([, level]) => level.buildingId === buildingId)
    .map(([levelId, level]) => ({ levelId, y: level.baseY - lowest, level }))
    .filter(({ y }) => y >= extent.bottom && y <= extent.top)
    .sort((a, b) => a.level.ordinal - b.level.ordinal)
    .map(({ levelId, y }) => ({
      levelId,
      name: (nodes[levelId] as { name?: string } | undefined)?.name ?? levelId,
      y: (extent.top - y) * extent.pxPerMetre,
    }))
}

/** The rows' storeys: how many lie between the lowest and the highest, and their mean height. */
function sceneStorey(elevations: Elevations, face: Face) {
  const ordinals = face.rows.map((row) => elevations.get(row.levelId)!.ordinal)
  const storeys = Math.max(...ordinals) - Math.min(...ordinals)
  return storeys > 0
    ? { storeys, height: (face.rows.at(-1)!.baseY - face.rows[0]!.baseY) / storeys }
    : null
}

function commonWarnings(residualPx: number, sourcePxPerMetre: { left: number; right: number }) {
  const fewest = Math.min(sourcePxPerMetre.left, sourcePxPerMetre.right)
  return [
    ...(residualPx > 3
      ? [
          `The picked points disagree by ${residualPx.toFixed(1)} px: check the close-ups and pick again.`,
        ]
      : []),
    ...(fewest < FEW_PX_PER_METRE
      ? [
          `Only ${fewest.toFixed(0)} photo pixels per metre at one edge: panes and thin panels may not be readable there.`,
        ]
      : []),
  ]
}

/**
 * A face from its own picks alone: its homography from the rows × edges correspondences, its
 * heights from the storeys. The way for one face, and for several when no camera fits them.
 */
function planFromOwnPicks(
  nodes: SceneNodes,
  elevations: Elevations,
  face: Face,
): { plan: PhotoFacePlan; toPhoto: Homography; bottom: number; top: number } {
  const { name, width, rows } = face
  const lowest = rows[0]!.y
  const left = face.left!
  const right = face.right!
  const corners = cornersOf(face)
  // Each row against each edge: face metres from the left end and the lowest row, to pixels.
  const pairs = rows.flatMap((row) =>
    (
      [
        [0, left],
        [width, right],
      ] as const
    ).map(([x, edge]) => ({
      from: [x, row.y - lowest] as Pt,
      to: lineIntersection(row.points, edge)!,
    })),
  )
  pairs.push(
    ...face.points.map(({ from, to }) => ({ from: [from[0], from[1] - lowest] as Pt, to })),
  )
  const toPhoto = solveHomography(pairs)
  const fromPhoto = toPhoto && invertHomography(toPhoto)
  if (!toPhoto || !fromPhoto)
    refuse('face_degenerate', `${name}: the edges and rows do not span a face.`, { face: name })

  const residualPx = Math.sqrt(
    pairs.reduce((sum, { from, to }) => {
      const [u, v] = applyHomography(toPhoto!, from)!
      return sum + (u - to[0]) ** 2 + (v - to[1]) ** 2
    }, 0) / pairs.length,
  )
  const heights = [...left, ...right].map((point) => applyHomography(fromPhoto!, point)?.[1] ?? 0)
  const bottom = Math.max(Math.min(...heights), -30)
  const top = Math.min(Math.max(...heights), bottom + 60)
  if (!(width > 0.5) || !(top - bottom > 0.5))
    refuse('face_degenerate', `${name}: the face is too small to draw.`, { face: name })
  const pxPerMetre = Math.min(MAX_PX_PER_METRE, MAX_SIDE / Math.max(width, top - bottom))
  // Drawing pixel (u, v) is the face point (u / s, top − v / s).
  const toFace: Homography = [1 / pxPerMetre, 0, 0, 0, -1 / pxPerMetre, top, 0, 0, 1]

  const density = (edge: 'left' | 'right') => {
    const on = corners.filter((corner) => corner.edge === edge)
    const byHeight = on.map((corner, i) => ({ corner, y: rows[i]!.y })).sort((a, b) => a.y - b.y)
    const [low, high] = [byHeight[0]!, byHeight.at(-1)!]
    const metres = high.y - low.y
    return metres > 0
      ? Math.hypot(
          high.corner.point[0] - low.corner.point[0],
          high.corner.point[1] - low.corner.point[1],
        ) / metres
      : 0
  }
  const sourcePxPerMetre = { left: density('left'), right: density('right') }

  // The rows' storeys are the vertical scale: their mean floor-to-floor height, lowest to highest.
  const storey = sceneStorey(elevations, face)?.height ?? null
  const warnings = [
    ...(storey !== null && storey < LOW_STOREY
      ? [
          `The storeys here average ${storey.toFixed(2)} m floor to floor, and they set this drawing's vertical scale. A residential storey is usually 2.8–3.2 m: if the photo's windows fill most of a storey, raise the storeys first (create_reference_elements walls with height), then straighten again.`,
        ]
      : []),
    ...commonWarnings(residualPx, sourcePxPerMetre),
  ]

  const plan: PhotoFacePlan = {
    name,
    widthMeters: width,
    leftMeters: 0,
    rightMeters: width,
    topMeters: top,
    bottomMeters: bottom,
    pxPerMetre,
    outWidth: Math.round(width * pxPerMetre),
    outHeight: Math.round((top - bottom) * pxPerMetre),
    toSource: multiplyHomography(toPhoto!, toFace),
    sourcePxPerMetre,
    residualPx,
    featureLines: featureLinesOf(nodes, elevations, face, { bottom, top, pxPerMetre }),
    corners,
    warnings,
  }
  return { plan, toPhoto: toPhoto!, bottom, top }
}

const FAILURES: Record<CameraFailure, { code: string; message: string }> = {
  needs_second_direction: {
    code: 'camera_needs_second_direction',
    message:
      'One face gives the camera one horizontal direction, and it needs a second: the other face of the corner in the same call, or vertical lines that converge in the photo.',
  },
  at_infinity: {
    code: 'vanishing_point_at_infinity',
    message:
      "The picked lines run parallel in the photo, so their vanishing points are at infinity and do not fix the camera's focal length: pick each face's rows on storeys far apart, on faces seen at an angle.",
  },
  unsolved: {
    code: 'camera_unsolved',
    message:
      'These lines fit no camera with square pixels and its principal point centred across the photo: a photo cropped sideways, a corner that is not square, or a line picked off.',
  },
}

/** Mean distance, in photo pixels, of a segment's ends from the line through another. */
function offLine(points: Segment, line: Segment) {
  const [[x1, y1], [x2, y2]] = line
  const length = Math.hypot(x2 - x1, y2 - y1) || 1
  return mean(
    points.map(([x, y]) => Math.abs((x2 - x1) * (y1 - y) - (x1 - x) * (y2 - y1)) / length),
  )
}

function solveCamera(
  faces: Face[],
  verticals: Segment[],
  image: { width: number; height: number },
) {
  const edges = faces.flatMap((face) => [face.left, face.right].filter((edge) => !!edge))
  const vertical = vanishingPoint([...edges, ...verticals], image)
  const vanishing = faces.map((face) => {
    const point = vanishingPoint([...face.rows.map((row) => row.points), ...face.lines], image)
    if (!point)
      refuse('face_degenerate', `${face.name}: its rows lie on one line.`, { face: face.name })
    return point!
  })
  const perpendicular: [number, number][] = []
  for (let i = 0; i < faces.length; i++)
    for (let j = i + 1; j < faces.length; j++) {
      const [a, b] = [faces[i]!.axis, faces[j]!.axis]
      if (Math.abs(a[0] * b[0] + a[1] * b[1]) < SQUARE) perpendicular.push([i, j])
    }
  const solved = solvePhotoCamera({
    photo: image,
    vertical,
    faces: faces.map((face, index) => ({
      vanishing: vanishing[index]!,
      probe: face.rows[0]!.points[0],
    })),
    perpendicular,
  })
  return 'failure' in solved ? FAILURES[solved.failure] : solved
}

function cameraSummary(
  camera: PhotoCamera,
  first: FaceAxes,
  focalSpread: number,
): Omit<PhotoCameraSummary, 'pose'> {
  const degrees = (radians: number) => (radians * 180) / Math.PI
  const columns = [first.along, first.up, first.normal]
  return {
    focalPx: camera.focal,
    focal35mm: (camera.focal * Math.hypot(36, 24)) / Math.hypot(camera.width, camera.height),
    horizontalFovDeg: degrees(2 * Math.atan(camera.width / 2 / camera.focal)),
    principalPointY: camera.centre[1],
    pitchDeg: degrees(Math.asin(camera.up[2])),
    rollDeg: degrees(Math.atan2(camera.up[0], -camera.up[1])),
    rotation: [0, 1, 2].flatMap((row) => columns.map((column) => column[row]!)),
    assumptions: ASSUMPTIONS,
    warnings:
      focalSpread > 1.1
        ? [
            `The picked lines disagree on the camera by ${((focalSpread - 1) * 100).toFixed(0)}%: pick each line longer, far apart from the others, and check the faces meet square.`,
          ]
        : [],
  }
}

/**
 * Each face from the shared camera: its plane from its walls' width between its two edges, or,
 * when its far edge leaves the photo, through the corner it shares with such a face. The drawing
 * is metric both ways, so the rows' storeys are measured rather than assumed.
 */
function planWithCamera(
  nodes: SceneNodes,
  elevations: Elevations,
  faces: Face[],
  camera: PhotoCamera,
  axes: FaceAxes[],
  anchors: FaceAnchor[] = [],
): PhotoFacePlan[] {
  const tolerance = SAME_CORNER * Math.max(camera.width, camera.height)
  const planes: (CameraFace | null)[] = faces.map(() => null)
  const cornerWarnings: string[][] = faces.map(() => [])
  for (const [index, face] of faces.entries()) {
    if (!face.left || !face.right) continue
    const plane = faceAtWidth(
      camera,
      axes[index]!,
      { left: face.left, right: face.right },
      face.width,
    )
    if (!plane)
      refuse(
        'face_degenerate',
        `${face.name}: its edges and the camera disagree: is its left edge the photo's left?`,
        { face: face.name },
      )
    planes[index] = plane
    // Two faces sharing a corner should put it at one depth: wrong walls or a stray edge do not.
    for (const [other, otherFace] of faces.entries()) {
      const otherPlane = planes[other]
      if (other === index || !otherPlane) continue
      for (const edge of [face.left, face.right])
        for (const otherEdge of [otherFace.left!, otherFace.right!]) {
          if (offLine(edge, otherEdge) > tolerance) continue
          const ratio = mean(
            edge.map((pixel) => {
              const here = pointOnFace(camera, plane!, pixel)
              const there = pointOnFace(camera, otherPlane, pixel)
              return here && there ? Math.hypot(...here) / Math.hypot(...there) : 1
            }),
          )
          if (Math.abs(ratio - 1) > CORNER_MISMATCH)
            cornerWarnings[index]!.push(
              `Its corner with ${otherFace.name} comes out ${(Math.abs(ratio - 1) * 100).toFixed(0)}% ${ratio > 1 ? 'farther' : 'nearer'} than ${otherFace.name} puts it: the walls of one of the two faces, or one of their edges, is off.`,
            )
        }
    }
  }
  for (const [index, face] of faces.entries()) {
    if (planes[index]) continue
    const corner = (face.left ?? face.right)!
    let partner: { plane: CameraFace; distance: number } | null = null
    for (const [other, otherFace] of faces.entries()) {
      const plane = otherFace.left && otherFace.right ? planes[other] : null
      if (!plane) continue
      for (const edge of [otherFace.left!, otherFace.right!]) {
        const distance = offLine(corner, edge)
        if (distance <= tolerance && (!partner || distance < partner.distance))
          partner = { plane, distance }
      }
    }
    if (!partner)
      refuse(
        'corner_not_shared',
        `${face.name} shows one edge: it is placed from the corner it shares with a face of this call whose two edges show. Pick that corner the same on both faces.`,
        { face: face.name },
      )
    const plane = faceThroughCorner(camera, axes[index]!, partner!.plane, corner)
    if (!plane)
      refuse('face_degenerate', `${face.name}: its corner is behind the camera.`, {
        face: face.name,
      })
    planes[index] = plane
  }

  return faces.map((face, index) => {
    const plane = planes[index]!
    const { name, width, rows } = face
    const at = (pixel: Pt) => {
      const point = faceCoordinates(camera, plane, pixel)
      if (!point)
        refuse('face_degenerate', `${name}: a picked point falls behind the camera.`, {
          face: name,
        })
      return point!
    }
    const rowHeights = rows.map((row) => mean(row.points.map((pixel) => at(pixel)[1])))
    const datum = rowHeights[0]!
    const across = (edge: Segment) => mean(edge.map((pixel) => at(pixel)[0]))
    const origin: Pt = [face.left ? across(face.left) : across(face.right!) - width, datum]
    const toPhoto = cameraFaceHomography(camera, plane, origin)
    anchors[index] = {
      plane,
      origin,
      bottom: Math.min(
        ...[face.left, face.right]
          .filter((edge) => !!edge)
          .flat()
          .map((pixel) => at(pixel)[1] - datum),
      ),
    }

    const edges = [face.left, face.right].filter((edge) => !!edge)
    const heights = edges.flat().map((pixel) => at(pixel)[1] - datum)
    const bottom = Math.max(Math.min(...heights), -30)
    const top = Math.min(Math.max(...heights), bottom + 60)

    // A face with one edge is drawn from that corner to where it leaves the photo.
    let [left, right] = [0, width]
    if (!face.left || !face.right) {
      const seen = (x: number, z: number) => {
        const w = toPhoto[6]! * x + toPhoto[7]! * z + toPhoto[8]!
        if (!(w > 0)) return false
        const u = (toPhoto[0]! * x + toPhoto[1]! * z + toPhoto[2]!) / w
        const v = (toPhoto[3]! * x + toPhoto[4]! * z + toPhoto[5]!) / w
        return u >= 0 && u <= camera.width && v >= 0 && v <= camera.height
      }
      const [cornerX, farX] = face.left ? [0, width] : [width, 0]
      let reach = cornerX
      for (const z of [bottom, top, (bottom + top) / 2, ...rowHeights.map((h) => h - datum)]) {
        if (!seen(cornerX, z)) continue
        let [shown, hidden] = [cornerX, farX]
        if (seen(farX, z)) shown = farX
        else
          for (let step = 0; step < 40; step++) {
            const middle = (shown + hidden) / 2
            if (seen(middle, z)) shown = middle
            else hidden = middle
          }
        if (Math.abs(shown - cornerX) > Math.abs(reach - cornerX)) reach = shown
      }
      ;[left, right] = face.left ? [0, reach] : [reach, width]
    }
    if (!(right - left > 0.5) || !(top - bottom > 0.5))
      refuse('face_degenerate', `${name}: the face is too small to draw.`, { face: name })
    const pxPerMetre = Math.min(MAX_PX_PER_METRE, MAX_SIDE / Math.max(right - left, top - bottom))
    // Drawing pixel (u, v) is the face point (left + u / s, top − v / s).
    const toFace: Homography = [1 / pxPerMetre, 0, left, 0, -1 / pxPerMetre, top, 0, 0, 1]

    const residualPx = Math.sqrt(
      mean([
        ...[...rows.map((row) => row.points), ...face.lines].map(
          (line) => vanishingResidualPx(camera, plane.along, [line]) ** 2,
        ),
        ...edges.map((edge) => vanishingResidualPx(camera, plane.up, [edge]) ** 2),
      ]),
    )
    const highest = rowHeights.at(-1)! - datum
    const density = (x: number) => {
      const low = applyHomography(toPhoto, [x, 0])
      const high = applyHomography(toPhoto, [x, highest])
      return low && high && highest > 0
        ? Math.hypot(high[0] - low[0], high[1] - low[1]) / highest
        : 0
    }
    const sourcePxPerMetre = { left: density(left), right: density(right) }

    const scene = sceneStorey(elevations, face)
    const storeyHeight = scene ? { photo: highest / scene.storeys, scene: scene.height } : undefined
    const warnings = [
      ...(storeyHeight &&
      Math.abs(storeyHeight.photo - storeyHeight.scene) > STOREY_MISMATCH * storeyHeight.photo
        ? [
            `The photo measures ${storeyHeight.photo.toFixed(2)} m floor to floor on this face, the scene's storeys ${storeyHeight.scene.toFixed(2)} m. The photo's figure comes from the picked lines: if a close-up is off or the lines are short, pick again before changing anything. This drawing takes its scale from the camera and the face's walls, not from the storeys: if those are the right walls, set the storeys to the photo's height (create_reference_elements walls with height) before building the facade, or its units will not fit.`,
          ]
        : []),
      ...commonWarnings(residualPx, sourcePxPerMetre),
      ...cornerWarnings[index]!,
    ]

    return {
      name,
      widthMeters: width,
      leftMeters: left,
      rightMeters: right,
      topMeters: top,
      bottomMeters: bottom,
      pxPerMetre,
      outWidth: Math.round((right - left) * pxPerMetre),
      outHeight: Math.round((top - bottom) * pxPerMetre),
      toSource: multiplyHomography(toPhoto, toFace),
      sourcePxPerMetre,
      residualPx,
      featureLines: featureLinesOf(nodes, elevations, face, { bottom, top, pxPerMetre }),
      corners: cornersOf(face),
      ...(storeyHeight ? { storeyHeight } : {}),
      warnings,
    }
  })
}

/**
 * Plans the straightening of each face of a photo, pixels being the host's. Several faces, or one
 * whose far edge leaves the photo, share the photo's one camera, found from the vanishing points
 * of the picked lines: each face is then K·[along up origin], metric from its walls' width, and
 * the storeys are measured. One face with both edges, or faces no camera fits, are each fitted
 * from their own rows × edges, their heights from the storeys.
 */
export function planPhotoElevation(
  nodes: SceneNodes,
  input: PhotoElevationInput,
  image: { width: number; height: number },
): { faces: PhotoFacePlan[]; camera: PhotoCameraSummary | null } {
  const plan = planOnce(nodes, input, image)
  const pose = plan.camera?.pose
  if (!pose) return plan
  // How far the pose can be trusted: solved again with every pick moved by about the picks' own
  // error, the same draws every time. A minimal set of picks fits exactly and shows no error, so
  // an agent's pick is taken to be off by a few pixels at least.
  const sigma = Math.max(
    PICK_ERROR * Math.max(image.width, image.height),
    mean(plan.faces.map((face) => face.residualPx)),
  )
  let state = 1
  const random = () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
  const move = ([x, y]: Pt): Pt => [
    Math.min(1, Math.max(0, x + ((random() * 2 - 1) * sigma) / image.width)),
    Math.min(1, Math.max(0, y + ((random() * 2 - 1) * sigma) / image.height)),
  ]
  const offsets: number[] = []
  for (let draw = 0; draw < SPREAD_DRAWS; draw++) {
    const moved: PhotoElevationInput = {
      ...input,
      faces: input.faces.map((face) => ({
        ...face,
        edges: {
          ...(face.edges.left ? { left: face.edges.left.map(move) } : {}),
          ...(face.edges.right ? { right: face.edges.right.map(move) } : {}),
        },
        rows: face.rows.map((row) => ({ ...row, points: row.points.map(move) })),
        ...(face.lines ? { lines: face.lines.map((line) => line.map(move)) } : {}),
        ...(face.points
          ? { points: face.points.map((point) => ({ ...point, point: move(point.point) })) }
          : {}),
      })),
      ...(input.verticals ? { verticals: input.verticals.map((line) => line.map(move)) } : {}),
    }
    try {
      const other = planOnce(nodes, moved, image).camera?.pose
      if (other)
        offsets.push(
          Math.hypot(...([0, 1, 2] as const).map((k) => other.position[k] - pose.position[k])),
        )
    } catch {
      // A draw the picks cannot hold gives no pose.
    }
  }
  const spread = Math.round(Math.sqrt(mean(offsets.map((d) => d * d))) * 100) / 100
  const distance = Math.hypot(...([0, 1, 2] as const).map((k) => pose.target[k] - pose.position[k]))
  return {
    ...plan,
    camera: {
      ...plan.camera!,
      pose: { ...pose, spread },
      warnings: [
        ...plan.camera!.warnings,
        ...(input.faces.every((face) => !face.points?.length && !face.lines?.length)
          ? [
              "Only the face's ends and its rows were picked: they fit exactly and say nothing of their own error, so the spread assumes a pick is off by 0.5% of the photo. Place window and door corners (points) to measure it, and to steady the pose.",
            ]
          : []),
        ...(spread > SHAKY * distance
          ? [
              `The pose moves about ${spread} m when the picks move by their own error, ${Math.round((spread / distance) * 100)}% of the camera's distance: a render from it will not line up. Place more points on the face (points: window and door corners, eave ends), and pick them closer.`,
            ]
          : []),
      ],
    },
  }
}

/**
 * How far off an agent's pick is, at least, as a share of the photo's longer side: the measuring
 * session's ±4 px on a 1600 px photo was under 0.2%, and the spread came out a third too small.
 */
const PICK_ERROR = 0.005
/** Draws of the picks the pose's spread is measured on. */
const SPREAD_DRAWS = 24
/** A pose moving more than this share of its distance is too unsure to render from. */
const SHAKY = 0.1

function planOnce(
  nodes: SceneNodes,
  input: PhotoElevationInput,
  image: { width: number; height: number },
): { faces: PhotoFacePlan[]; camera: PhotoCameraSummary | null } {
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const px = ([fx, fy]: Pt): Pt => [fx * image.width, fy * image.height]
  const faces = input.faces.map((face, index) => readFace(nodes, elevations, face, index, px))
  const verticals = input.verticals ?? []
  if (verticals.flat().some((point) => !inside(point)))
    refuse(
      'point_outside_image',
      'Every point of the verticals is a fraction of the image, 0 to 1 across and down.',
    )

  const oneEdge = faces.some((face) => !face.left || !face.right)
  if (faces.length === 1 && !oneEdge) {
    const face = faces[0]!
    const { plan, toPhoto, bottom, top } = planFromOwnPicks(nodes, elevations, face)
    const seen = faceCamera(
      toPhoto,
      image,
      { width: face.width, height: top - bottom },
      input.focal35mm,
    )
    return {
      faces: [plan],
      camera: {
        ...cameraSummary(seen.camera, seen.axes, 1),
        ...(seen.focalAssumed ? { assumptions: `${ASSUMPTIONS} ${FRONTAL_ASSUMPTION}` } : {}),
        pose: photoPose(
          nodes,
          elevations,
          [face],
          seen.camera,
          [{ ...seen.anchor, bottom }],
          seen.focalAssumed,
        ),
      },
    }
  }
  const solved = solveCamera(
    faces,
    verticals.map((line) => segment(line, px)),
    image,
  )
  if ('code' in solved) {
    if (oneEdge) refuse(solved.code, solved.message)
    const warning = `No camera fits this photo (${solved.message}) Each face is straightened from its own picks instead, its heights from the storeys.`
    return {
      faces: faces.map((face) => {
        const { plan } = planFromOwnPicks(nodes, elevations, face)
        return { ...plan, warnings: [warning, ...plan.warnings] }
      }),
      camera: null,
    }
  }
  const anchors: FaceAnchor[] = []
  const plans = planWithCamera(nodes, elevations, faces, solved.camera, solved.faces, anchors)
  return {
    faces: plans,
    camera: {
      ...cameraSummary(solved.camera, solved.faces[0]!, solved.focalSpread),
      pose: photoPose(nodes, elevations, faces, solved.camera, anchors, false),
    },
  }
}

/** A face's depth changing less than this share across it shows no focal length. */
const FRONTAL = 0.05
/** A phone's main camera, on a 36 × 24 mm frame. */
const PHONE_35MM = 26
const FRONTAL_ASSUMPTION =
  "One face seen square on does not show the focal length: it was taken (focal35mm, else a phone camera's 26 mm), and the camera's distance follows from it."

/**
 * The camera that sees a face through `toPhoto` (face metres from its left end and lowest row, to
 * photo pixels), its principal point at the photo's centre: H = K·[r₁ r₂ t]. The focal length
 * comes from r₁ ⟂ r₂ and |r₁| = |r₂| when the face recedes; square on, it is taken.
 */
function faceCamera(
  toPhoto: Homography,
  image: { width: number; height: number },
  extent: { width: number; height: number },
  focal35mm?: number,
): {
  camera: PhotoCamera
  axes: FaceAxes
  anchor: Omit<FaceAnchor, 'bottom'>
  focalAssumed: boolean
} {
  const [cx, cy] = [image.width / 2, image.height / 2]
  const column = (k: number): Vec3 => {
    const z = toPhoto[6 + k]!
    return [toPhoto[k]! - cx * z, toPhoto[3 + k]! - cy * z, z]
  }
  const [a, b, c] = [column(0), column(1), column(2)]
  const recede =
    Math.max(Math.abs(a[2] * extent.width), Math.abs(b[2] * extent.height)) / Math.abs(c[2])
  const longer = Math.max(image.width, image.height)
  // r₁ ⟂ r₂ and |r₁| = |r₂| each give f²; each is only as good as its denominator, which a face
  // turned but not tilted (or tilted but not turned) drives to nought for the first.
  const conditioned = [
    { squared: -(a[0] * b[0] + a[1] * b[1]) / (a[2] * b[2]), weight: Math.abs(a[2] * b[2]) },
    {
      squared: (a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2) / (b[2] ** 2 - a[2] ** 2),
      weight: Math.abs(b[2] ** 2 - a[2] ** 2),
    },
  ]
    .filter(({ squared }) => Number.isFinite(squared) && squared > 0)
    .map(({ squared, weight }) => ({ focal: Math.sqrt(squared), weight }))
    .filter(({ focal }) => focal >= 0.25 * longer && focal <= 10 * longer)
    .sort((p, q) => q.weight - p.weight)
  const read = focal35mm === undefined && recede > FRONTAL ? conditioned[0]?.focal : undefined
  const focalAssumed = read === undefined
  const focal =
    read ?? ((focal35mm ?? PHONE_35MM) * Math.hypot(image.width, image.height)) / Math.hypot(36, 24)
  const ray = (h: Vec3): Vec3 => [h[0] / focal, h[1] / focal, h[2]]
  const [g1, g2, g3] = [ray(a), ray(b), ray(c)]
  const norm = (v: Vec3) => Math.hypot(...v)
  const scale = ((g3[2] > 0 ? 1 : -1) * 2) / (norm(g1) + norm(g2))
  const along = v3.scale(g1, scale / norm(v3.scale(g1, scale)))
  const upRaw = v3.scale(g2, scale)
  const up = v3.scale(
    v3.add(upRaw, v3.scale(along, -v3.dot(upRaw, along))),
    1 / norm(v3.add(upRaw, v3.scale(along, -v3.dot(upRaw, along)))),
  )
  const normal: Vec3 = [
    along[1] * up[2] - along[2] * up[1],
    along[2] * up[0] - along[0] * up[2],
    along[0] * up[1] - along[1] * up[0],
  ]
  const t = v3.scale(g3, scale)
  return {
    camera: { ...image, focal, centre: [cx, cy], up },
    axes: { along, up, normal },
    anchor: {
      plane: { along, up, normal, distance: v3.dot(normal, t) },
      origin: [v3.dot(along, t), v3.dot(up, t)],
    },
    focalAssumed,
  }
}

/** A face placed by the camera: its plane, and where its walls' left end sits on it at the rows' datum. */
type FaceAnchor = { plane: CameraFace; origin: Pt; bottom: number }

const v3 = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
}

/**
 * The camera in world coordinates. Each face's axes are known in the camera (along, up, out) and
 * in the world (its walls' direction, up, out), and so is one of its points: the walls' left end
 * at the rows' datum. The side the camera stands on is the one every face agrees on; one face
 * alone leaves it open. The datum's height is the rows' feature height above their floor, or else
 * the edges' foot is taken for the ground.
 */
function photoPose(
  nodes: SceneNodes,
  elevations: Elevations,
  faces: Face[],
  camera: PhotoCamera,
  anchors: FaceAnchor[],
  focalAssumed: boolean,
): PhotoPose | null {
  if (!faces.length) return null
  const ground = Math.min(...[...elevations.values()].map((level) => level.baseY))
  const rowHeight = faces[0]!.rows[0]!.height
  const anchoredBy = rowHeight !== undefined ? 'row height' : 'edge base'
  // Each face's camera and world axes for one side of it (sign ±1 along its walls).
  const place = (index: number, sign: number) => {
    const face = faces[index]!
    const { plane, origin, bottom } = anchors[index]!
    const along: Vec3 = [sign * face.axis[0], 0, sign * face.axis[1]]
    const up: Vec3 = [0, 1, 0]
    const normal: Vec3 = [-along[2], 0, along[0]]
    const left = sign > 0 ? face.ends[0] : face.ends[1]
    const row = face.rows[0]!
    const datumY = row.height !== undefined ? row.baseY + row.height : ground - bottom
    const world: Vec3 = [left[0], datumY, left[1]]
    const position = v3.add(
      world,
      v3.add(
        v3.add(v3.scale(along, -origin[0]), v3.scale(up, -origin[1])),
        v3.scale(normal, -plane.distance),
      ),
    )
    // Camera axes (x right, y down, z forward) in the world.
    const axis = (k: 0 | 1 | 2): Vec3 =>
      v3.add(
        v3.add(v3.scale(along, plane.along[k]), v3.scale(up, plane.up[k])),
        v3.scale(normal, plane.normal[k]),
      )
    return { position, right: axis(0), down: axis(1), forward: axis(2) }
  }
  let best: { spread: number; places: ReturnType<typeof place>[] } | null = null
  if (faces.length === 1) {
    // One face: the camera stands outside the building, away from its walls' middle.
    const walls = Object.values(nodes).filter(
      (node): node is WallNode => node.type === 'wall' && node.parentId === faces[0]!.levelId,
    )
    const middle = walls.flatMap((wall) => [wall.start, wall.end])
    const cx = mean(middle.map((p) => p[0]))
    const cz = mean(middle.map((p) => p[1]))
    const away = (p: ReturnType<typeof place>) => Math.hypot(p.position[0] - cx, p.position[2] - cz)
    const [a, b] = [place(0, 1), place(0, -1)]
    best = { spread: 0, places: [away(a) >= away(b) ? a : b] }
  } else
    for (const first of [1, -1]) {
      const head = place(0, first)
      const rest = faces.slice(1).map((_, i) => {
        const [a, b] = [place(i + 1, 1), place(i + 1, -1)]
        const gap = (p: ReturnType<typeof place>) =>
          Math.hypot(...([0, 1, 2] as const).map((k) => p.position[k] - head.position[k]))
        return gap(a) <= gap(b) ? a : b
      })
      const places = [head, ...rest]
      const spread = Math.max(
        ...rest.map((p) =>
          Math.hypot(...([0, 1, 2] as const).map((k) => p.position[k] - head.position[k])),
        ),
      )
      if (!best || spread < best.spread) best = { spread, places }
    }
  const chosen = best!.places[0]!
  const depth = v3.dot(
    v3.add(
      v3.add(
        v3.scale(anchors[0]!.plane.along, anchors[0]!.origin[0]),
        v3.scale(anchors[0]!.plane.up, anchors[0]!.origin[1]),
      ),
      v3.scale(anchors[0]!.plane.normal, anchors[0]!.plane.distance),
    ),
    [0, 0, 1],
  )
  const project = (point: Vec3): Pt => {
    const d: Vec3 = [
      point[0] - chosen.position[0],
      point[1] - chosen.position[1],
      point[2] - chosen.position[2],
    ]
    const z = v3.dot(d, chosen.forward)
    return [
      (camera.focal * v3.dot(d, chosen.right)) / z + camera.centre[0],
      (camera.focal * v3.dot(d, chosen.down)) / z + camera.centre[1],
    ]
  }
  // Each picked edge against the vertical through its walls' end, projected.
  const residuals = faces.flatMap((face, index) => {
    const sign = best!.places[index]!.right
    const leftFirst = v3.dot(sign, [face.axis[0], 0, face.axis[1]]) > 0
    const [leftEnd, rightEnd] = leftFirst ? face.ends : [face.ends[1], face.ends[0]]
    return (
      [
        [face.left, leftEnd],
        [face.right, rightEnd],
      ] as const
    ).flatMap(([edge, end]) => {
      if (!edge) return []
      const line: Segment = [
        project([end[0], ground, end[1]]),
        project([end[0], ground + 10, end[1]]),
      ]
      return [offLine(edge, line)]
    })
  })
  const round = (value: number) => Math.round(value * 1000) / 1000
  const r3 = (v: Vec3): Vec3 => [round(v[0]), round(v[1]), round(v[2])]
  return {
    projection: 'perspective',
    position: r3(chosen.position),
    target: r3(v3.add(chosen.position, v3.scale(chosen.forward, depth))),
    up: r3(v3.scale(chosen.down, -1)),
    fov: round((2 * Math.atan(camera.height / 2 / camera.focal) * 180) / Math.PI),
    aspect: round(camera.width / camera.height),
    shift: round((camera.centre[1] - camera.height / 2) / camera.height),
    anchoredBy,
    focalAssumed,
    edgeResidualPx: round(Math.sqrt(mean(residuals.map((r) => r * r)))),
  }
}
