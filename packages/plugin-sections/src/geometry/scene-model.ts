import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  calculateLevelMiters,
  DEFAULT_WALL_HEIGHT,
  type DoorNode,
  decodeTerrainField,
  getActiveRoofHeight,
  getDutchRoofMetrics,
  getLevelElevations,
  getRoofSegmentVisibleTopBounds,
  getSegmentSlopeFrame,
  getWallPlanFootprint,
  getWallThickness,
  type LevelNode,
  type RoofNode,
  type RoofSegmentNode,
  resolveWallAssembly,
  type SiteNode,
  type SlabNode,
  surfaceHeightAt,
  type WallAssemblyLayer,
  type WallNode,
  type WindowNode,
} from '@pascal-app/core'
import { rotateY, unrotateY } from './math'
import type { Nodes, Vec2 } from './types'

// ---------------------------------------------------------------------------
// Wall assemblies — WS5's contract, consumed directly.
//
// `resolveWallAssembly` (packages/core/src/systems/wall/wall-assembly.ts) is
// the single source of truth: it returns the layers ordered OUTSIDE -> INSIDE
// summing exactly to `wall.thickness`, plus `exteriorSideResolved` telling us
// which geometric side of the wall faces outdoors. A wall with no `assembly`
// resolves to one `framing` layer, so this builder has one code path.
// ---------------------------------------------------------------------------

export type WallLayer = WallAssemblyLayer

/** Outward-ordered layers (exterior face first). One layer when no assembly. */
export function resolveWallLayers(wall: WallNode): WallLayer[] {
  return resolveWallAssembly(wall).layers
}

// ---------------------------------------------------------------------------
// Solids
// ---------------------------------------------------------------------------

export type Opening = {
  id: string
  nodeType: 'door' | 'window'
  /** Distance along the wall from `wall.start`, at the opening centre. */
  along: number
  width: number
  /** World elevation of the opening head / sill. */
  headY: number
  sillY: number
  /** Windows only — a sill board is drawn in section/elevation. */
  hasSill: boolean
  /** Pane divisions, for the elevation mullion glyph. */
  columns: number
  rows: number
}

export type WallSolid = {
  kind: 'wall'
  id: string
  /** Mitred plan footprint in world [x, z] metres. */
  polygon: Vec2[]
  start: Vec2
  end: Vec2
  /** Unit direction start→end. */
  axis: Vec2
  /** Unit normal, `(-dz, dx)` — the same `nUnit` `getWallPlanFootprint` uses. */
  normal: Vec2
  length: number
  thickness: number
  /** Which normal side is the exterior face: +1 = along `normal`, -1 = against. */
  exteriorSign: 1 | -1
  layers: WallLayer[]
  /**
   * The assembly's declared cladding (`wall.assembly.exterior.finish`), or
   * null for a wall with no assembly / a partition — drives the elevation's
   * material rendition. Never guessed: a wall without an assembly is drawn
   * blank and listed as "no cladding specified" in the finish key.
   */
  exteriorFinish: 'siding' | 'stucco' | 'brick' | 'stone' | 'fiber-cement' | 'none' | null
  baseY: number
  topY: number
  openings: Opening[]
  levelId: string | null
}

export type PrismSolid = {
  kind: 'slab' | 'ceiling'
  id: string
  polygon: Vec2[]
  bottomY: number
  topY: number
  levelId: string | null
}

export type RoofSolid = {
  kind: 'roof'
  id: string
  /** Local footprint rectangle including overhang, from core's own bounds fn. */
  local: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** World plan polygon of that rectangle. */
  polygon: Vec2[]
  /** World Y of the segment's local Y = 0. */
  originY: number
  /** Vertical deck thickness (perpendicular deck thickness / cosθ). */
  deckDrop: number
  toWorld: (lx: number, lz: number) => Vec2
  toLocal: (x: number, z: number) => Vec2
  /** World plan direction of the segment's local +Z (the down-slope axis). */
  axisZ: Vec2
  /** Local Y of the top surface at a local plan point (extended over overhangs). */
  surfaceY: (lx: number, lz: number) => number
  /** World Y of the eave (deck at the un-overhung footprint edge) and the ridge. */
  eaveY: number
  ridgeY: number
  /** Plate line — top of the segment's own wall band. */
  plateY: number
}

export type LevelInfo = {
  id: string
  name: string
  ordinal: number
  baseY: number
  height: number
}

export type BuildingModel = {
  walls: WallSolid[]
  prisms: PrismSolid[]
  roofs: RoofSolid[]
  levels: LevelInfo[]
  /** World elevation of the ground at a plan point. */
  gradeAt: (x: number, z: number) => number
  warnings: string[]
}

function isType<T extends AnyNode>(node: AnyNode | undefined, type: string): node is T {
  return node?.type === type
}

/** Nearest ancestor level of `node`, walking `parentId`. */
function findLevelId(node: AnyNode, nodes: Nodes): string | null {
  let current: AnyNode | undefined = node
  for (let guard = 0; current && guard < 32; guard++) {
    if (current.type === 'level') return current.id
    const parentId = current.parentId as AnyNodeId | null
    if (!parentId) return null
    current = nodes[parentId]
  }
  return null
}

function collectOpenings(wall: WallSolid, nodes: Nodes, warnings: string[]): Opening[] {
  const openings: Opening[] = []
  for (const node of Object.values(nodes)) {
    if (!node) continue
    if (node.type !== 'door' && node.type !== 'window') continue
    const hosted = node as DoorNode | WindowNode
    if (hosted.wallId !== wall.id) {
      const parentIsWall = hosted.parentId === wall.id
      if (!parentIsWall) continue
    }
    if ((hosted as { roofSegmentId?: string }).roofSegmentId) {
      warnings.push(
        `Opening ${hosted.id} is hosted on a roof segment face, not a wall — not drawn.`,
      )
      continue
    }
    const along = hosted.position[0]
    const centerY = hosted.position[1]
    const width = hosted.width
    const height = hosted.height
    openings.push({
      id: hosted.id,
      nodeType: node.type === 'door' ? 'door' : 'window',
      along,
      width,
      sillY: wall.baseY + centerY - height / 2,
      headY: wall.baseY + centerY + height / 2,
      hasSill: node.type === 'window' && (hosted as WindowNode).sill !== false,
      columns: node.type === 'window' ? ((hosted as WindowNode).columnRatios?.length ?? 1) : 1,
      rows: node.type === 'window' ? ((hosted as WindowNode).rowRatios?.length ?? 1) : 1,
    })
  }
  return openings.sort((a, b) => a.along - b.along)
}

/**
 * Local-Y of a roof segment's top surface, in the segment's own frame.
 *
 * Exact for `flat`, `shed`, `gable` and `hip` — the four shapes whose slope
 * planes are fully determined by `getSegmentSlopeFrame` + the ridge/hip plan
 * linework (`getRoofSegmentPlanLinework`). `gambrel` is modelled as its two
 * documented slope bands. `mansard` and `dutch` fall back to the hip surface
 * and raise a warning: their waist geometry is generated by the CSG brush
 * builder, which is not reachable headlessly.
 */
function segmentSurfaceY(segment: RoofSegmentNode, warnings: string[]) {
  const frame = getSegmentSlopeFrame(segment)
  const hw = segment.width / 2
  const hd = segment.depth / 2
  const wallHeight = segment.wallHeight
  const tan = frame.tanTheta

  const hip = (lx: number, lz: number) =>
    wallHeight + tan * Math.min(hd - Math.abs(lz), hw - Math.abs(lx))

  switch (segment.roofType) {
    case 'flat':
      return () => wallHeight
    case 'shed':
      // The 3D builder slopes from the high eave at lz = -hd down to lz = +hd.
      return (_lx: number, lz: number) => wallHeight + tan * (hd - lz)
    case 'gable':
      return (_lx: number, lz: number) => wallHeight + tan * (hd - Math.abs(lz))
    case 'hip':
      return hip
    case 'gambrel': {
      const kink = hd * segment.gambrelLowerWidthRatio
      const kinkY = frame.activeRh * segment.gambrelLowerHeightRatio
      const upperRun = Math.max(1e-6, kink)
      const upperSlope = (frame.activeRh - kinkY) / upperRun
      return (_lx: number, lz: number) => {
        const d = Math.abs(lz)
        if (d >= kink) return wallHeight + tan * (hd - d)
        return wallHeight + kinkY + upperSlope * (kink - d)
      }
    }
    default: {
      // mansard / dutch
      const metrics = getDutchRoofMetrics(segment)
      warnings.push(
        `Roof segment ${segment.id} is a ${segment.roofType} roof — its waist geometry (inset ${metrics.inset.toFixed(2)} m) comes from the CSG brush builder and is not derivable headlessly. Drawn as an equivalent hip.`,
      )
      return hip
    }
  }
}

function collectRoof(
  roof: RoofNode,
  nodes: Nodes,
  levelBaseY: number,
  warnings: string[],
): RoofSolid[] {
  const solids: RoofSolid[] = []
  for (const childId of roof.children) {
    const segment = nodes[childId as AnyNodeId]
    if (!isType<RoofSegmentNode>(segment, 'roof-segment')) continue
    const frame = getSegmentSlopeFrame(segment)
    const bounds = getRoofSegmentVisibleTopBounds(segment)
    const originY = levelBaseY + roof.position[1] + segment.position[1]
    const totalRotation = roof.rotation + segment.rotation
    const segCenter = rotateY(segment.position[0], segment.position[2], roof.rotation)
    const cx = roof.position[0] + segCenter[0]
    const cz = roof.position[2] + segCenter[1]
    const toWorld = (lx: number, lz: number): Vec2 => {
      const r = rotateY(lx, lz, totalRotation)
      return [cx + r[0], cz + r[1]]
    }
    const toLocal = (x: number, z: number): Vec2 => unrotateY(x - cx, z - cz, totalRotation)
    const surfaceLocalY = segmentSurfaceY(segment, warnings)
    const deckDrop = segment.deckThickness / (frame.cosTheta || 1)
    const polygon: Vec2[] = [
      toWorld(bounds.minX, bounds.minZ),
      toWorld(bounds.maxX, bounds.minZ),
      toWorld(bounds.maxX, bounds.maxZ),
      toWorld(bounds.minX, bounds.maxZ),
    ]
    solids.push({
      kind: 'roof',
      id: segment.id,
      local: { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: bounds.maxZ },
      polygon,
      originY,
      deckDrop,
      toWorld,
      toLocal,
      axisZ: rotateY(0, 1, totalRotation),
      surfaceY: surfaceLocalY,
      // Eave = the deck plane carried out to the visible footprint edge,
      // which `getRoofSegmentVisibleTopBounds` puts `overhang * cos(pitch)`
      // horizontally past the wall — so the drop is `overhang * sin(pitch)`.
      //
      // DEFECT (core, not this package): `computeGutterEaveY`
      // (packages/core/src/schema/nodes/gutter.ts:138) instead drops by
      // `overhang * tan(pitch)`, i.e. it reads `overhang` as a HORIZONTAL run
      // while the bounds helper reads it as a SLOPE length. The two disagree
      // by `overhang * sin * (1/cos - 1)` — 23 mm at 300 mm / 30 deg. This
      // builder stays self-consistent with the footprint it draws.
      eaveY: originY + segment.wallHeight - frame.sinTheta * segment.overhang,
      ridgeY: originY + segment.wallHeight + getActiveRoofHeight(segment),
      plateY: originY + segment.wallHeight,
    })
  }
  return solids
}

function terrainSampler(nodes: Nodes, warnings: string[]): (x: number, z: number) => number {
  const site = Object.values(nodes).find((node): node is SiteNode => node?.type === 'site')
  const terrain = site?.terrain
  if (!terrain) return () => 0
  const field = decodeTerrainField(terrain)
  if (!field) {
    warnings.push('Site terrain present but undecodable — grade drawn flat at 0.00 m.')
    return () => 0
  }
  return (x: number, z: number) => surfaceHeightAt(field, x, z)
}

/**
 * Walk the scene once and turn it into the solid set both drawing builders
 * consume. Everything here comes from the kinds' own geometry helpers
 * (`getWallPlanFootprint` + `calculateLevelMiters`, `getLevelElevations`,
 * `getSegmentSlopeFrame`, `decodeTerrainField`) — no re-derivation.
 */
export function buildBuildingModel(nodes: Nodes): BuildingModel {
  const warnings: string[] = []
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const levels: LevelInfo[] = []
  const walls: WallSolid[] = []
  const prisms: PrismSolid[] = []
  const roofs: RoofSolid[] = []

  for (const node of Object.values(nodes)) {
    if (!isType<LevelNode>(node, 'level')) continue
    const elevation = elevations.get(node.id)
    levels.push({
      id: node.id,
      name: node.name ?? `Level ${node.level}`,
      ordinal: node.level,
      baseY: elevation?.baseY ?? 0,
      height: elevation?.height ?? DEFAULT_WALL_HEIGHT,
    })
  }
  levels.sort((a, b) => a.baseY - b.baseY)

  // Mitres are a level-wide computation — do it once per level, exactly the
  // way the floor-plan layer's `computeFloorplanLevelData` does.
  const wallsByLevel = new Map<string, WallNode[]>()
  for (const node of Object.values(nodes)) {
    if (!isType<WallNode>(node, 'wall')) continue
    const levelId = findLevelId(node, nodes) ?? '__orphan__'
    const bucket = wallsByLevel.get(levelId)
    if (bucket) bucket.push(node)
    else wallsByLevel.set(levelId, [node])
  }

  for (const [levelId, levelWalls] of wallsByLevel) {
    const baseY = elevations.get(levelId)?.baseY ?? 0
    const miters = calculateLevelMiters(levelWalls)
    for (const wall of levelWalls) {
      const polygon = getWallPlanFootprint(wall, miters).map(
        (point) => [point.x, point.y] as const,
      ) as Vec2[]
      if (polygon.length < 3) {
        warnings.push(`Wall ${wall.id} has a degenerate footprint — skipped.`)
        continue
      }
      if (wall.curveOffset && Math.abs(wall.curveOffset) > 1e-4) {
        warnings.push(
          `Wall ${wall.id} is curved — sectioned against its true footprint, but its openings are placed on the chord.`,
        )
      }
      const dx = wall.end[0] - wall.start[0]
      const dz = wall.end[1] - wall.start[1]
      const length = Math.hypot(dx, dz)
      if (length < 1e-6) continue
      const assembly = resolveWallAssembly(wall)
      const axis: Vec2 = [dx / length, dz / length]
      const normal: Vec2 = [-axis[1], axis[0]]
      const solid: WallSolid = {
        kind: 'wall',
        id: wall.id,
        polygon,
        start: [wall.start[0], wall.start[1]],
        end: [wall.end[0], wall.end[1]],
        axis,
        normal,
        length,
        thickness: getWallThickness(wall),
        // WS5 owns this call: +1 = exterior on the +normal (front) face,
        // -1 = the -normal (back) face, with the +normal fallback already
        // applied. The cut's layer order flips with it.
        exteriorSign: assembly.exteriorSideResolved,
        layers: assembly.layers,
        exteriorFinish: (wall.assembly?.exterior?.finish as WallSolid['exteriorFinish']) ?? null,
        baseY: baseY + (wall.supportOffset ?? 0),
        topY: baseY + (wall.supportOffset ?? 0) + (wall.height ?? DEFAULT_WALL_HEIGHT),
        openings: [],
        levelId: levelId === '__orphan__' ? null : levelId,
      }
      solid.openings = collectOpenings(solid, nodes, warnings)
      walls.push(solid)
    }
  }

  for (const node of Object.values(nodes)) {
    if (!node) continue
    if (isType<SlabNode>(node, 'slab')) {
      const baseY = elevations.get(findLevelId(node, nodes) ?? '')?.baseY ?? 0
      if (node.polygon.length < 3) continue
      prisms.push({
        kind: 'slab',
        id: node.id,
        polygon: node.polygon.map((p) => [p[0], p[1]] as Vec2),
        // slab.ts: "the solid occupies [elevation - thickness, elevation]".
        bottomY: baseY + node.elevation - node.thickness,
        topY: baseY + node.elevation,
        levelId: findLevelId(node, nodes),
      })
      if (node.holes.length > 0) {
        warnings.push(
          `Slab ${node.id} has ${node.holes.length} hole(s) — holes are not subtracted from the section cut.`,
        )
      }
      continue
    }
    if (isType<CeilingNode>(node, 'ceiling')) {
      const levelId = findLevelId(node, nodes)
      const baseY = elevations.get(levelId ?? '')?.baseY ?? 0
      const height = node.height ?? elevations.get(levelId ?? '')?.height ?? DEFAULT_WALL_HEIGHT
      if (node.polygon.length < 3) continue
      prisms.push({
        kind: 'ceiling',
        id: node.id,
        polygon: node.polygon.map((p) => [p[0], p[1]] as Vec2),
        bottomY: baseY + height - 0.012,
        topY: baseY + height,
        levelId,
      })
      continue
    }
    if (isType<RoofNode>(node, 'roof')) {
      const baseY = elevations.get(findLevelId(node, nodes) ?? '')?.baseY ?? 0
      roofs.push(...collectRoof(node, nodes, baseY, warnings))
    }
  }

  const stairCount = Object.values(nodes).filter((node) => node?.type === 'stair').length
  if (stairCount > 0) {
    warnings.push(
      `${stairCount} stair(s) in the scene are not cut or projected — stair geometry is built by the stair system's tread/stringer meshes, which this builder does not read.`,
    )
  }

  return { walls, prisms, roofs, levels, gradeAt: terrainSampler(nodes, warnings), warnings }
}
