import { z } from 'zod'
import { getBarrelRoofProfile } from './barrel-roof'
import { CurtainGrid, CurtainPanelType, curtainGridPositions } from './curtain-wall'
import {
  getActiveRoofHeight,
  getRoofSegmentVisibleTopBounds,
  getSegmentSlopeFrame,
  normalizeRoofSegmentTrim,
  type RoofSegmentNode,
} from './roof-segment'

export const RoofSystemType = z.enum(['standard', 'glazed'])
export type RoofSystemType = z.infer<typeof RoofSystemType>

export const RoofGlazing = z.object({
  across: CurtainGrid.prefault({}),
  along: CurtainGrid.prefault({}),
  frameWidth: z.number().finite().positive().default(0.05),
  frameDepth: z.number().finite().positive().default(0.08),
  glassThickness: z.number().finite().positive().default(0.008),
  frameColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#303942'),
  glassColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#a9d5df'),
  glassOpacity: z.number().finite().min(0.05).max(1).default(0.3),
  glassRoughness: z.number().finite().min(0).max(1).default(0.12),
  glazedEnds: z.boolean().default(true),
  panelType: CurtainPanelType.default('glass'),
  panels: z
    .array(
      z.object({
        face: z
          .string()
          .regex(/^(front|back|slope|end-left|end-right|barrel-([0-9]|[12][0-9]|3[01]))$/),
        column: z.number().int().min(0).max(31),
        row: z.number().int().min(0).max(31),
        type: CurtainPanelType,
      }),
    )
    .max(5120)
    .default([]),
})
export type RoofGlazing = z.infer<typeof RoofGlazing>
export const DEFAULT_ROOF_GLAZING = RoofGlazing.parse({})

export function supportsRoofGlazing(node: Pick<RoofSegmentNode, 'roofType' | 'arc'>): boolean {
  return (
    node.roofType === 'barrel' ||
    node.roofType === 'gable' ||
    (node.roofType === 'shed' && !node.arc)
  )
}

export function isGlazedRoofSegment(
  node: Pick<RoofSegmentNode, 'roofType' | 'arc' | 'roofSystem'>,
): boolean {
  return node.roofSystem === 'glazed' && supportsRoofGlazing(node)
}

export function getRoofGlazing(node: { glazing?: RoofGlazing }): RoofGlazing {
  return node.glazing ?? DEFAULT_ROOF_GLAZING
}

export type GlazedRoofPoint = readonly [number, number, number]
export type GlazedRoofFace = {
  id: string
  origin: GlazedRoofPoint
  u: GlazedRoofPoint
  v: GlazedRoofPoint
  normal: GlazedRoofPoint
  width: number
  length: number
  polygon: [number, number][]
}
export type GlazedRoofLayout = {
  face: GlazedRoofFace
  across: number[]
  along: number[]
}

/** Covering-top datum, with frame and pane thickness extending inward. */
export function getGlazedRoofFaces(node: RoofSegmentNode): GlazedRoofFace[] {
  if (!isGlazedRoofSegment(node)) return []
  if (node.roofType === 'barrel') return getBarrelRoofFaces(node)
  const { minX, maxX, minZ, maxZ } = getRoofSegmentVisibleTopBounds({
    ...node,
    trim: normalizeRoofSegmentTrim({ width: node.width, depth: node.depth }),
  })
  const { tanTheta, cosTheta, sinTheta } = getSegmentSlopeFrame(node)
  const peak = node.wallHeight + getActiveRoofHeight(node)
  const face = (
    id: string,
    startZ: number,
    endZ: number,
    startY: number,
    direction: number,
  ): GlazedRoofFace => {
    const length = Math.abs(endZ - startZ) / cosTheta
    return {
      id,
      origin: [minX, startY, startZ],
      u: [1, 0, 0],
      v: [0, -sinTheta, direction * cosTheta],
      normal: [0, cosTheta, direction * sinTheta],
      width: maxX - minX,
      length,
      polygon: [
        [0, 0],
        [maxX - minX, 0],
        [maxX - minX, length],
        [0, length],
      ],
    }
  }
  const faces =
    node.roofType === 'gable'
      ? [face('front', 0, maxZ, peak, 1), face('back', 0, minZ, peak, -1)]
      : [face('slope', minZ, maxZ, peak - (minZ + node.depth / 2) * tanTheta, 1)]
  if (!getRoofGlazing(node).glazedEnds) return faces

  // Only infill above the wall top; the existing room walls own the enclosure below.
  const endLength = node.depth
  const rise = getActiveRoofHeight(node)
  if (rise <= 1e-6) return faces
  const profile: [number, number][] =
    node.roofType === 'gable'
      ? [
          [0, 0],
          [endLength, 0],
          [endLength / 2, rise],
        ]
      : [
          [0, 0],
          [endLength, 0],
          [0, rise],
        ]
  for (const side of [-1, 1]) {
    faces.push({
      id: side < 0 ? 'end-left' : 'end-right',
      origin: [(side * node.width) / 2, node.wallHeight, -node.depth / 2],
      u: [0, 0, 1],
      v: [0, 1, 0],
      normal: [side, 0, 0],
      width: endLength,
      length: rise,
      polygon: profile,
    })
  }
  return faces
}

function clipGlazedRoofHalfPlane(
  polygon: [number, number][],
  signed: (point: [number, number]) => number,
): [number, number][] {
  const result: [number, number][] = []
  for (let i = 0; i < polygon.length; i++) {
    const start = polygon[i]!,
      end = polygon[(i + 1) % polygon.length]!
    const d0 = signed(start),
      d1 = signed(end)
    if (d0 <= 1e-9) result.push(start)
    if (d0 <= 1e-9 !== d1 <= 1e-9) {
      const t = d0 / (d0 - d1)
      result.push([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t])
    }
  }
  return result
}

/** End infill fits below the inward thickness of the arch covering. */
function fitBarrelEndInfill(
  node: RoofSegmentNode,
  polygon: [number, number][],
  coveringDepth: number,
): [number, number][] {
  const profile = getBarrelRoofProfile(
    node.depth,
    getActiveRoofHeight(node),
    node.barrelSegments ?? 12,
  )
  let result = polygon
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1]!,
      b = profile[i]!
    const dy = b[1] - a[1],
      dz = b[0] - a[0]
    const length = Math.hypot(dy, dz)
    const nx = -dy / length,
      ny = dz / length
    const signed = ([u, v]: [number, number]) =>
      nx * (u - node.depth / 2 - a[0]) + ny * (v - a[1]) + coveringDepth
    result = clipGlazedRoofHalfPlane(result, signed)
  }
  return result
}

/** Circular arch, represented by planar glazing bays. The stored span stays at the eaves. */
export function getBarrelRoofFaces(node: RoofSegmentNode): GlazedRoofFace[] {
  const half = Math.max(0.005, node.depth / 2)
  const rise = getActiveRoofHeight(node)
  const count = node.barrelSegments ?? 12
  const extension = Math.max(0, node.overhang) + Math.max(0, node.wallThickness) / 2
  const minX = -node.width / 2 - extension
  const width = node.width + 2 * extension
  const points = getBarrelRoofProfile(node.depth, rise, count).map(([z, y]): [number, number] => [
    z,
    y + node.wallHeight,
  ])
  const faces: GlazedRoofFace[] = []
  for (let i = 0; i < count; i++) {
    const a = points[i]!,
      b = points[i + 1]!
    const dy = b[1] - a[1],
      dz = b[0] - a[0]
    const length = Math.hypot(dy, dz)
    faces.push({
      id: `barrel-${i}`,
      origin: [minX, a[1], a[0]],
      u: [1, 0, 0],
      v: [0, dy / length, dz / length],
      normal: [0, dz / length, -dy / length],
      width,
      length,
      polygon: [
        [0, 0],
        [width, 0],
        [width, length],
        [0, length],
      ],
    })
  }
  if (node.roofSystem !== 'glazed' || getRoofGlazing(node).glazedEnds) {
    const profile: [number, number][] = [
      [0, 0],
      [node.depth, 0],
      ...points
        .slice(1, -1)
        .reverse()
        .map(([z, y]): [number, number] => [z + half, y - node.wallHeight]),
    ]
    for (const side of [-1, 1])
      faces.push({
        id: side < 0 ? 'end-left' : 'end-right',
        origin: [(side * node.width) / 2, node.wallHeight, -half],
        u: [0, 0, 1],
        v: [0, 1, 0],
        normal: [side, 0, 0],
        width: node.depth,
        length: rise,
        polygon: fitBarrelEndInfill(
          node,
          profile,
          Math.max(getRoofGlazing(node).frameDepth, getRoofGlazing(node).glassThickness),
        ),
      })
  }
  return faces
}

export function getBarrelRoofSolidPieces(node: RoofSegmentNode): GlazedRoofPiece[] {
  const faces = getBarrelRoofFaces(node)
  const pieces: GlazedRoofPiece[] = faces
    .filter((face) => face.normal[1] > 0)
    .map((face) => ({
      face,
      polygon: face.polygon,
      depth: node.deckThickness + node.shingleThickness,
      slot: 3,
    }))
  if (node.wallShell !== 'omit' && node.wallThickness > 0) {
    const rise = getActiveRoofHeight(node)
    const profile = getBarrelRoofProfile(node.depth, rise, node.barrelSegments ?? 12)
    for (const side of [-1, 1]) {
      const face: GlazedRoofFace = {
        id: side < 0 ? 'end-left' : 'end-right',
        origin: [(side * node.width) / 2, 0, -node.depth / 2],
        u: [0, 0, 1],
        v: [0, 1, 0],
        normal: [side, 0, 0],
        width: node.depth,
        length: node.wallHeight + rise,
        polygon: [
          [0, 0],
          [node.depth, 0],
          ...[...profile]
            .reverse()
            .map(([z, y]): [number, number] => [z + node.depth / 2, y + node.wallHeight]),
        ],
      }
      face.polygon = fitBarrelEndInfill(
        node,
        face.polygon.map(([u, v]): [number, number] => [u, v - node.wallHeight]),
        node.deckThickness + node.shingleThickness,
      ).map(([u, v]) => [u, v + node.wallHeight])
      pieces.push({ face, polygon: face.polygon, depth: node.wallThickness, slot: 2 })
    }
    if (node.wallHeight > 0)
      for (const side of [-1, 1]) {
        const face: GlazedRoofFace = {
          id: side < 0 ? 'back' : 'front',
          origin: [-node.width / 2 + node.wallThickness, 0, (side * node.depth) / 2],
          u: [1, 0, 0],
          v: [0, 1, 0],
          normal: [0, 0, side],
          width: Math.max(0, node.width - 2 * node.wallThickness),
          length: node.wallHeight,
          polygon: [
            [0, 0],
            [Math.max(0, node.width - 2 * node.wallThickness), 0],
            [Math.max(0, node.width - 2 * node.wallThickness), node.wallHeight],
            [0, node.wallHeight],
          ],
        }
        pieces.push({ face, polygon: face.polygon, depth: node.wallThickness, slot: 2 })
      }
  }
  return pieces.filter((piece) => piece.depth > 0)
}

export function getGlazedRoofLayout(node: RoofSegmentNode): GlazedRoofLayout[] {
  const config = getRoofGlazing(node)
  return getGlazedRoofFaces(node).map((face) => ({
    face,
    across: curtainGridPositions(face.width, config.across),
    along: curtainGridPositions(face.length, config.along),
  }))
}

export function getGlazedRoofPanelType(
  node: RoofSegmentNode,
  face: string,
  column: number,
  row: number,
) {
  const config = getRoofGlazing(node)
  return (
    config.panels.find(
      (panel) => panel.face === face && panel.column === column && panel.row === row,
    )?.type ?? config.panelType
  )
}

export function glazedRoofFacePoint(face: GlazedRoofFace, u: number, v: number): GlazedRoofPoint {
  return [
    face.origin[0] + face.u[0] * u + face.v[0] * v,
    face.origin[1] + face.u[1] * u + face.v[1] * v,
    face.origin[2] + face.u[2] * u + face.v[2] * v,
  ]
}

function trimConstraints(node: RoofSegmentNode): [number, number, number][] {
  const trim = normalizeRoofSegmentTrim(node)
  const left = -node.width / 2 + trim.left,
    right = node.width / 2 - trim.right
  const front = node.depth / 2 - trim.front,
    back = -node.depth / 2 + trim.back
  const constraints: [number, number, number][] = []
  if (trim.left > 0) constraints.push([1, 0, -left])
  if (trim.right > 0) constraints.push([-1, 0, right])
  if (trim.front > 0) constraints.push([0, -1, front])
  if (trim.back > 0) constraints.push([0, 1, -back])
  for (const [x, z, dx, dz, signX, signZ] of [
    [left, front, trim.frontLeftX, trim.frontLeftZ, 1, -1],
    [right, front, trim.frontRightX, trim.frontRightZ, -1, -1],
    [left, back, trim.backLeftX, trim.backLeftZ, 1, 1],
    [right, back, trim.backRightX, trim.backRightZ, -1, 1],
  ]) {
    if (dx! > 0 && dz! > 0)
      constraints.push([signX! / dx!, signZ! / dz!, -1 - (signX! * x!) / dx! - (signZ! * z!) / dz!])
  }
  return constraints
}

export function getGlazedRoofPlanLines(
  node: RoofSegmentNode,
): [readonly [number, number], readonly [number, number]][] {
  const lines: [readonly [number, number], readonly [number, number]][] = []
  for (const { face, across, along } of getGlazedRoofLayout(node)) {
    if (face.normal[1] <= 0) continue
    const emit = (start: GlazedRoofPoint, end: GlazedRoofPoint) => {
      let lo = 0,
        hi = 1
      for (const [a, b, c] of trimConstraints(node)) {
        const d0 = a * start[0] + b * start[2] + c
        const d1 = a * end[0] + b * end[2] + c
        if (d0 < 0 && d1 < 0) return
        if (d0 < 0) lo = Math.max(lo, d0 / (d0 - d1))
        if (d1 < 0) hi = Math.min(hi, d0 / (d0 - d1))
      }
      if (hi <= lo) return
      const at = (t: number): [number, number] => [
        start[0] + (end[0] - start[0]) * t,
        start[2] + (end[2] - start[2]) * t,
      ]
      lines.push([at(lo), at(hi)])
    }
    for (const u of across)
      emit(glazedRoofFacePoint(face, u, 0), glazedRoofFacePoint(face, u, face.length))
    for (const v of along)
      emit(glazedRoofFacePoint(face, 0, v), glazedRoofFacePoint(face, face.width, v))
  }
  return lines
}

export function glazedRoofSupportsPoint(node: RoofSegmentNode, x: number, z: number): boolean {
  if (!isGlazedRoofSegment(node)) return false
  if (trimConstraints(node).some(([a, b, c]) => a * x + b * z + c < -1e-6)) return false
  const config = getRoofGlazing(node)
  for (const { face, across, along } of getGlazedRoofLayout(node)) {
    if (face.normal[1] <= 0) continue
    const u = x - face.origin[0],
      v = (z - face.origin[2]) / face.v[2]
    if (u < 0 || u > face.width || v < 0 || v > face.length) continue
    const column = across.findIndex((position, index) => index > 0 && position >= u) - 1
    const row = along.findIndex((position, index) => index > 0 && position >= v) - 1
    if (column < 0 || row < 0) continue
    if (getGlazedRoofPanelType(node, face.id, column, row) !== 'empty') return true
    const width = Math.min(config.frameWidth, face.width / 4, face.length / 4)
    if (
      across.some((position) => Math.abs(u - position) <= width / 2) ||
      along.some((position) => Math.abs(v - position) <= width / 2)
    )
      return true
  }
  return false
}

export function clipGlazedRoofPolygon(
  polygon: readonly (readonly [number, number])[],
  bounds: { minU: number; maxU: number; minV: number; maxV: number },
): [number, number][] {
  let result = polygon.map(([u, v]): [number, number] => [u, v])
  for (const [axis, value, sign] of [
    [0, bounds.minU, 1],
    [0, bounds.maxU, -1],
    [1, bounds.minV, 1],
    [1, bounds.maxV, -1],
  ] as const) {
    const input = result
    result = []
    for (let i = 0; i < input.length; i++) {
      const a = input[i]!
      const b = input[(i + 1) % input.length]!
      const aInside = (a[axis] - value) * sign >= -1e-9
      const bInside = (b[axis] - value) * sign >= -1e-9
      if (aInside) result.push(a)
      if (aInside !== bInside) {
        const t = (value - a[axis]) / (b[axis] - a[axis])
        result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
      }
    }
  }
  return result
}

/** Inset a convex pane boundary so diagonal end frames never overlap its glass. */
export function insetGlazedRoofPolygon(
  polygon: [number, number][],
  distance: number,
): [number, number][] {
  let result = polygon
  for (let edge = 0; edge < polygon.length; edge++) {
    const a = polygon[edge]!,
      b = polygon[(edge + 1) % polygon.length]!
    const dx = b[0] - a[0],
      dy = b[1] - a[1]
    const length = Math.hypot(dx, dy)
    if (length < 1e-9) continue
    const signed = (point: [number, number]) =>
      (dx * (point[1] - a[1]) - dy * (point[0] - a[0])) / length - distance
    const input = result
    result = []
    for (let i = 0; i < input.length; i++) {
      const start = input[i]!,
        end = input[(i + 1) % input.length]!
      const d0 = signed(start),
        d1 = signed(end)
      if (d0 >= 0) result.push(start)
      if (d0 >= 0 !== d1 >= 0) {
        const t = d0 / (d0 - d1)
        result.push([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t])
      }
    }
  }
  return result
}

export type GlazedRoofPiece = {
  face: GlazedRoofFace
  polygon: [number, number][]
  depth: number
  slot: number
}

export function getGlazedRoofPieces(node: RoofSegmentNode): GlazedRoofPiece[] {
  const config = getRoofGlazing(node)
  const pieces: GlazedRoofPiece[] = []
  const add = (face: GlazedRoofFace, polygon: [number, number][], depth: number, slot: number) => {
    const clean = polygon.filter((point, index) => {
      const previous = polygon[(index + polygon.length - 1) % polygon.length]!
      return Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-8
    })
    let area = 0
    for (let i = 0; i < clean.length; i++) {
      const a = clean[i]!,
        b = clean[(i + 1) % clean.length]!
      area += a[0] * b[1] - b[0] * a[1]
    }
    if (clean.length >= 3 && Math.abs(area) > 1e-8)
      pieces.push({ face, polygon: clean, depth, slot })
  }
  for (const { face, across, along } of getGlazedRoofLayout(node)) {
    const width = Math.min(config.frameWidth, face.width / 4, face.length / 4)
    for (let column = 0; column < across.length - 1; column++) {
      for (let row = 0; row < along.length - 1; row++) {
        const type = getGlazedRoofPanelType(node, face.id, column, row)
        if (type === 'empty') continue
        const minU = across[column]!,
          maxU = across[column + 1]!
        const minV = along[row]!,
          maxV = along[row + 1]!
        const inset = Math.min(width / 2, (maxU - minU) / 4, (maxV - minV) / 4)
        const pane = clipGlazedRoofPolygon(insetGlazedRoofPolygon(face.polygon, width), {
          minU: minU + inset,
          maxU: maxU - inset,
          minV: minV + inset,
          maxV: maxV - inset,
        })
        add(face, pane, config.glassThickness, type === 'glass' ? 1 : 2)
      }
    }
    for (const u of across.slice(1, -1)) {
      add(
        face,
        clipGlazedRoofPolygon(insetGlazedRoofPolygon(face.polygon, width), {
          minU: u - width / 2,
          maxU: u + width / 2,
          minV: 0,
          maxV: face.length,
        }),
        config.frameDepth,
        0,
      )
    }
    for (const v of along.slice(1, -1)) {
      add(
        face,
        clipGlazedRoofPolygon(insetGlazedRoofPolygon(face.polygon, width), {
          minU: 0,
          maxU: face.width,
          minV: v - width / 2,
          maxV: v + width / 2,
        }),
        config.frameDepth,
        0,
      )
    }
    // Nearest-edge partitions form miter joints without overlapping border faces.
    const edgeDistances = face.polygon.map((a, i) => {
      const b = face.polygon[(i + 1) % face.polygon.length]!
      const dx = b[0] - a[0],
        dy = b[1] - a[1]
      const length = Math.hypot(dx, dy)
      return (point: [number, number]) =>
        length < 1e-9
          ? Number.POSITIVE_INFINITY
          : (dx * (point[1] - a[1]) - dy * (point[0] - a[0])) / length
    })
    for (const distance of edgeDistances) {
      let border = clipGlazedRoofHalfPlane(face.polygon, (point) => distance(point) - width)
      for (const other of edgeDistances)
        if (other !== distance)
          border = clipGlazedRoofHalfPlane(border, (point) => distance(point) - other(point))
      add(face, border, config.frameDepth, 0)
    }
  }
  return pieces
}

export function getGlazedRoofPieceFaces(
  piece: GlazedRoofPiece,
): { x: number; y: number; z: number }[][] {
  const { face, depth } = piece
  let top = piece.polygon.map(([u, v]) => {
    const [x, y, z] = glazedRoofFacePoint(face, u, v)
    return { x, y, z }
  })
  const cross = [
    face.u[1] * face.v[2] - face.u[2] * face.v[1],
    face.u[2] * face.v[0] - face.u[0] * face.v[2],
    face.u[0] * face.v[1] - face.u[1] * face.v[0],
  ]
  if (cross[0]! * face.normal[0] + cross[1]! * face.normal[1] + cross[2]! * face.normal[2] < 0)
    top = top.reverse()
  const bottom = top.map(({ x, y, z }) => ({
    x: x - face.normal[0] * depth,
    y: y - face.normal[1] * depth,
    z: z - face.normal[2] * depth,
  }))
  const faces = [top, [...bottom].reverse()]
  for (let i = 0; i < top.length; i++) {
    const next = (i + 1) % top.length
    faces.push([top[i]!, bottom[i]!, bottom[next]!, top[next]!])
  }
  return faces
}
