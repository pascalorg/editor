import {
  type AnyNode,
  type AnyNodeId,
  area,
  BEAM_MATERIAL_LIBRARY_REFS,
  type BuildingNode,
  type DeckFramingPlan,
  type DeckPiece,
  type DeckWall,
  deckBoardRun,
  deckBoardThickness,
  deckSlabBoards,
  type GeometryContext,
  getLevelElevations,
  gradedTerrainFieldOf,
  intersection,
  type LevelNode,
  layoutDeckBoards,
  type MultiPolygon,
  type PlateSurfacePartition,
  type PlateTopCell,
  type Polygon,
  planDeckFraming,
  plateLevelContext,
  SITE_DATUM_Y,
  type SiteNode,
  type SlabNode,
  surfaceHeightAt,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import {
  type ColorPreset,
  createSurfaceRoleMaterial,
  type RenderShading,
  resolveSlotDefaultMaterial,
} from '@pascal-app/viewer'
import {
  BufferGeometry,
  Float32BufferAttribute,
  FrontSide,
  Group,
  type Material,
  Mesh,
  ShapeUtils,
  Vector2,
} from 'three'

/**
 * A deck's floor (`isDeckSlab`: a deck room's floor plate, a generated deck) drawn as a deck is
 * built, never as a solid slab: its boards (`layoutDeckBoards`), the room's finish on them, each
 * painted part of the floor its own boards with its own paint role, over its frame
 * (`planDeckFraming`), the same plan the framing plugin books: ledger, joists, rims, beams and
 * posts in treated wood, a concrete pier under each post at the ground. The boards' top is the
 * slab's top, so items, the room label and clicks find the floor where they did. Each material is
 * one merged mesh, so the deck batches like any slab.
 */

const IN = 0.0254
/** A post's pier: 12 in square, standing 2 in out of the ground, 10 in into it. */
const PIER_SIDE = 12 * IN
const PIER_ABOVE = 2 * IN
const PIER_BELOW = 10 * IN

export type DeckLook = {
  shading: RenderShading
  textures: boolean
  colorPreset: ColorPreset
  sceneTheme?: string
}

export type DeckGeometryOptions = {
  /** The deck's outline: the slab's renderable polygon. */
  polygon: Array<[number, number]>
  /** The plate's top partition: one set of boards per cell. Null for a drawn slab. */
  partition: PlateSurfacePartition | null
  /** A cell's finish as a material; `null` asks for the slab's own surface finish. */
  boardMaterial: (cell: PlateTopCell | null) => Material
  look: DeckLook
}

/** The level-local ground under a plan point: the site's graded terrain, or the datum, wherever the storey stands. */
function groundUnder(ctx: GeometryContext | undefined): (x: number, z: number) => number {
  const level = ctx?.parent
  if (!ctx || level?.type !== 'level' || !level.parentId) return () => 0
  const building = ctx.resolve<BuildingNode>(level.parentId as AnyNodeId)
  if (building?.type !== 'building') return () => 0
  const site = building.parentId ? ctx.resolve<SiteNode>(building.parentId as AnyNodeId) : undefined
  const nodes: Record<string, AnyNode> = { [building.id]: building, [level.id]: level as LevelNode }
  if (site?.type === 'site') nodes[site.id] = site
  for (const childId of building.children) {
    const child = ctx.resolve<AnyNode>(childId as AnyNodeId)
    if (child) nodes[child.id] = child
  }
  const elevation = getLevelElevations(nodes).get(level.id)
  if (!elevation) return () => 0
  const baseWorldY = (building.position?.[1] ?? 0) + elevation.baseY
  const field = site?.type === 'site' ? gradedTerrainFieldOf(useScene.getState().nodes, site) : null
  if (!field) return () => SITE_DATUM_Y - baseWorldY
  const angle = building.rotation?.[1] ?? 0
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const [px, , pz] = building.position ?? [0, 0, 0]
  return (x, z) =>
    surfaceHeightAt(field, cos * x + sin * z + px, -sin * x + cos * z + pz) - baseWorldY
}

/** The house walls a deck edge may hang its ledger on: no railing, no hidden wall. */
function ledgerWalls(ctx: GeometryContext | undefined): DeckWall[] {
  if (!ctx) return []
  return plateLevelContext(ctx.parent, ctx.resolve)
    .walls.filter(
      (wall) => wall.visible !== false && (wall as { wallType?: string }).wallType !== 'railing',
    )
    .map((wall) => ({
      start: wall.start,
      end: wall.end,
      thickness: wall.thickness ?? 0.1,
      curved: Math.abs(wall.curveOffset ?? 0) > 1e-6,
    }))
}

/**
 * Posts already standing on the ground by the deck (a generated porch's, hosted on the ground and
 * passing through the deck): a beam two of them stand on is theirs to carry.
 */
function carriersBy(node: SlabNode, ctx: GeometryContext | undefined): Array<[number, number]> {
  const level = ctx?.parent
  if (!ctx || !level || !('children' in level)) return []
  const out: Array<[number, number]> = []
  for (const id of level.children) {
    const column = ctx.resolve<AnyNode>(id as AnyNodeId)
    if (column?.type !== 'column' || column.visible === false || column.supportSlabId === node.id)
      continue
    const support = column.supportSlabId
      ? ctx.resolve<AnyNode>(column.supportSlabId as AnyNodeId)
      : undefined
    const base = column.position[1] + (support?.type === 'slab' ? support.elevation : 0)
    if (base < node.elevation - 0.3) out.push([column.position[0], column.position[2]])
  }
  return out
}

/** A material's surface: the treated wood of the frame, the piers' concrete. */
function frameMaterial(ref: string, role: 'wall' | 'floor', look: DeckLook): Material {
  return look.textures
    ? resolveSlotDefaultMaterial(ref, look.shading)
    : createSurfaceRoleMaterial(role, look.colorPreset, FrontSide, look.sceneTheme)
}

type Buffers = { positions: number[]; normals: number[]; uvs: number[]; indices: number[] }
const buffers = (): Buffers => ({ positions: [], normals: [], uvs: [], indices: [] })

function toGeometry({ positions, normals, uvs, indices }: Buffers): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}

/** A box (centre, [run, height, across], yaw), flat-shaded with metre UVs on every face. */
function pushBox(out: Buffers, piece: Pick<DeckPiece, 'position' | 'dims' | 'yaw'>) {
  const [cx, cy, cz] = piece.position
  const [hx, hy, hz] = piece.dims.map((value) => value / 2) as [number, number, number]
  const cos = Math.cos(piece.yaw)
  const sin = Math.sin(piece.yaw)
  // three.js Y rotation: local +x → (cos, 0, −sin), local +z → (sin, 0, cos)
  const world = (x: number, y: number, z: number): [number, number, number] => [
    cx + x * cos + z * sin,
    cy + y,
    cz - x * sin + z * cos,
  ]
  const turn = (x: number, z: number): [number, number, number] => [
    x * cos + z * sin,
    0,
    -x * sin + z * cos,
  ]
  // each face: its normal (local), and two edge axes (local) with their half lengths
  const faces: Array<{
    n: [number, number, number]
    a: [number, number, number]
    b: [number, number, number]
  }> = [
    { n: [1, 0, 0], a: [0, 0, -1], b: [0, 1, 0] },
    { n: [-1, 0, 0], a: [0, 0, 1], b: [0, 1, 0] },
    { n: [0, 1, 0], a: [1, 0, 0], b: [0, 0, -1] },
    { n: [0, -1, 0], a: [1, 0, 0], b: [0, 0, 1] },
    { n: [0, 0, 1], a: [1, 0, 0], b: [0, 1, 0] },
    { n: [0, 0, -1], a: [-1, 0, 0], b: [0, 1, 0] },
  ]
  const half = [hx, hy, hz]
  for (const { n, a, b } of faces) {
    const base = out.positions.length / 3
    const span = (axis: [number, number, number]) =>
      Math.abs(axis[0]) * half[0]! + Math.abs(axis[1]) * half[1]! + Math.abs(axis[2]) * half[2]!
    const ha = span(a)
    const hb = span(b)
    const normal = n[1] !== 0 ? ([0, n[1], 0] as [number, number, number]) : turn(n[0], n[2])
    for (const [sa, sb] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const x = n[0] * half[0]! + a[0] * ha * sa + b[0] * hb * sb
      const y = n[1] * half[1]! + a[1] * ha * sa + b[1] * hb * sb
      const z = n[2] * half[2]! + a[2] * ha * sa + b[2] * hb * sb
      out.positions.push(...world(x, y, z))
      out.normals.push(...normal)
      out.uvs.push(ha * (sa + 1), hb * (sb + 1))
    }
    out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
}

function signedArea2(ring: ReadonlyArray<readonly [number, number]>): number {
  let twice = 0
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i]!
    const [bx, bz] = ring[(i + 1) % ring.length]!
    twice += ax * bz - bx * az
  }
  return twice
}

/**
 * One board: its top at `top`, its bottom `thickness` under, its sides; the top's grain along
 * the board (`along`), shifted by `shift` so neighbouring boards read as boards.
 */
function pushBoard(
  out: Buffers,
  board: Polygon,
  top: number,
  thickness: number,
  along: readonly [number, number],
  shift: number,
) {
  const outer = signedArea2(board.outer) < 0 ? [...board.outer].reverse() : board.outer
  const holes = board.holes.filter((hole) => hole.length >= 3)
  const contour = outer.map(([x, z]) => new Vector2(x, z))
  const holeRings = holes.map((hole) => hole.map(([x, z]) => new Vector2(x, z)))
  const bottom = top - thickness
  const grain = (x: number, z: number): [number, number] => [
    x * along[0] + z * along[1] + shift,
    -x * along[1] + z * along[0],
  ]
  const cap = [...contour, ...holeRings.flat()]
  const topBase = out.positions.length / 3
  for (const p of cap) {
    out.positions.push(p.x, top, p.y)
    out.normals.push(0, 1, 0)
    out.uvs.push(...grain(p.x, p.y))
  }
  const bottomBase = out.positions.length / 3
  for (const p of cap) {
    out.positions.push(p.x, bottom, p.y)
    out.normals.push(0, -1, 0)
    out.uvs.push(...grain(p.x, p.y))
  }
  for (const [a, b, c] of ShapeUtils.triangulateShape(contour, holeRings)) {
    out.indices.push(topBase + a!, topBase + c!, topBase + b!)
    out.indices.push(bottomBase + a!, bottomBase + b!, bottomBase + c!)
  }
  // the board's edges, outward on the outline; a hole's both ways
  const side = (a: Vector2, b: Vector2, flipped: boolean) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length < 1e-9) return
    const nx = (b.y - a.y) / length
    const nz = -(b.x - a.x) / length
    const base = out.positions.length / 3
    for (const [p, y, u, v] of [
      [a, bottom, 0, 0],
      [b, bottom, length, 0],
      [b, top, length, thickness],
      [a, top, 0, thickness],
    ] as const) {
      out.positions.push(p.x, y, p.y)
      out.normals.push(flipped ? -nx : nx, 0, flipped ? -nz : nz)
      out.uvs.push(u, v)
    }
    if (flipped) out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    else out.indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
  }
  for (let i = 0; i < contour.length; i++)
    side(contour[i]!, contour[(i + 1) % contour.length]!, false)
  for (const ring of holeRings)
    for (let i = 0; i < ring.length; i++) {
      side(ring[i]!, ring[(i + 1) % ring.length]!, false)
      side(ring[i]!, ring[(i + 1) % ring.length]!, true)
    }
}

/** A board's own shift along its grain, the same every build. */
const shiftOf = (index: number) => {
  const x = Math.sin(index * 12.9898 + 78.233) * 43758.5453
  return (x - Math.floor(x)) * 3
}

/** The deck's frame as the engine draws it: a joist a side rim stands in for is the rim. */
export function deckFramePieces(plan: DeckFramingPlan): DeckPiece[] {
  return [
    ...(plan.ledger ? [plan.ledger] : []),
    ...plan.rims,
    ...plan.joists.filter((joist) => !joist.atRim),
    ...plan.beams,
    ...plan.posts,
  ]
}

/** The deck's frame plan and boards, as drawn for `node`. */
export function planDeck(
  node: SlabNode,
  ctx: GeometryContext | undefined,
  polygon: Array<[number, number]>,
) {
  const boards = deckSlabBoards(node, (id) => {
    const zone = ctx?.resolve<AnyNode>(id as AnyNodeId)
    return zone?.type === 'zone' ? (zone as ZoneNode) : undefined
  })
  const thickness = deckBoardThickness(boards)
  const ground = groundUnder(ctx)
  let cx = 0
  let cz = 0
  for (const [x, z] of polygon) {
    cx += x
    cz += z
  }
  const n = Math.max(polygon.length, 1)
  const plan = planDeckFraming({
    polygon,
    top: node.elevation,
    decking: thickness,
    walls: ledgerWalls(ctx),
    boards,
    gradeY: ground(cx / n, cz / n),
    gradeAt: ground,
    carriers: carriersBy(node, ctx),
  })
  return { boards, thickness, plan }
}

export function buildDeckGeometry(
  node: SlabNode,
  ctx: GeometryContext | undefined,
  options: DeckGeometryOptions,
): Group {
  const group = new Group()
  const { polygon, partition, look } = options
  if (polygon.length < 3) return group
  const { boards, thickness, plan } = planDeck(node, ctx, polygon)
  const addMesh = (geometry: BufferGeometry, material: Material, role?: string) => {
    if (geometry.getAttribute('position').count === 0) {
      geometry.dispose()
      return
    }
    const mesh = new Mesh(geometry, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    if (role) {
      mesh.userData.slotId = role
      mesh.userData.paintRole = role
    }
    group.add(mesh)
  }

  // ---- the boards: a set for each painted part of the floor, cut along it ----
  const axes = plan.axes ?? {
    origin: polygon[0]!,
    u: [1, 0] as [number, number],
    v: [0, 1] as [number, number],
  }
  const joists =
    plan.stationAxis && plan.axes
      ? { origin: plan.axes.origin, axis: plan.stationAxis, stations: plan.stations }
      : undefined
  // One set of rows over the whole deck, so a painted part's boards line up with the rest.
  const top: MultiPolygon = [{ outer: polygon, holes: node.holes ?? [] }]
  const laid = layoutDeckBoards(top, axes, boards, joists)
  const cells: Array<{ cell: PlateTopCell | null; role: string; outline: MultiPolygon }> = partition
    ? partition.cells.map((cell) => ({ cell, role: cell.role, outline: cell.polygons }))
    : [{ cell: null, role: 'surface', outline: top }]
  const whole = area(top)
  const { along } = deckBoardRun(axes, boards.direction)
  for (const { cell, role, outline } of cells) {
    const out = buffers()
    const all = cells.length === 1 && Math.abs(area(outline) - whole) < 1e-4
    laid.forEach((board, index) => {
      for (const part of all ? [board] : intersection(board, outline))
        pushBoard(out, part, node.elevation, thickness, along, shiftOf(index))
    })
    addMesh(toGeometry(out), options.boardMaterial(cell), role)
  }

  // ---- the frame, and a pier under each post ----
  const frame = buffers()
  for (const piece of deckFramePieces(plan)) pushBox(frame, piece)
  addMesh(
    toGeometry(frame),
    frameMaterial(BEAM_MATERIAL_LIBRARY_REFS['pressure-treated'], 'wall', look),
  )
  const piers = buffers()
  for (const post of plan.posts)
    pushBox(piers, {
      position: [post.position[0], post.bottom + (PIER_ABOVE - PIER_BELOW) / 2, post.position[2]],
      dims: [PIER_SIDE, PIER_ABOVE + PIER_BELOW, PIER_SIDE],
      yaw: post.yaw,
    })
  addMesh(toGeometry(piers), frameMaterial('library:concrete-raw', 'floor', look))
  return group
}
