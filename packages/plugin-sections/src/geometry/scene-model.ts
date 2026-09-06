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
  getEffectiveRoofSurfaceMaterial,
  getLevelElevations,
  getMaterialPresetByRef,
  getRoofSegmentVisibleTopBounds,
  getScaledDimensions,
  getSegmentSlopeFrame,
  getWallPlanFootprint,
  getWallThickness,
  type ItemNode,
  type LevelNode,
  parseMaterialRef,
  type RoofNode,
  type RoofSegmentNode,
  resolveWallAssembly,
  type SiteNode,
  type SlabNode,
  surfaceHeightAt,
  type WallAssemblyLayer,
  type WallNode,
  type WindowNode,
  wallAssemblyFinishRef,
} from '@pascal-app/core'
import { resolveMarkDetail } from '@pascal-app/editor'
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

/**
 * The cladding an elevation draws for a wall.
 *
 * 1. The ASSEMBLY's declared exterior finish (WS5) — the source of truth when
 *    the wall has one.
 * 2. Otherwise the PAINTED material: a library / user material ref on the
 *    exterior face slots (`wall.slots`, values like `library:siding/lap`) or
 *    the legacy `material.preset` / `materialPreset`, read by name —
 *    "siding", "stucco" / "plaster", "brick", "stone" / "masonry",
 *    "fiber-cement" / "hardie". This is how a wall painted from the Pascal
 *    material library or a user's own library still gets its symbol on paper.
 * 3. Otherwise null — drawn blank and listed as "no cladding specified".
 */
export function exteriorFinishOf(
  wall: Pick<WallNode, 'assembly' | 'slots' | 'material' | 'materialPreset'>,
): WallSolid['exteriorFinish'] {
  const declared = wall.assembly?.exterior?.finish as WallSolid['exteriorFinish'] | undefined
  if (declared) return declared
  const candidates: string[] = []
  const slots = (wall.slots ?? {}) as Record<string, string>
  for (const [slot, ref] of Object.entries(slots)) {
    if (/exterior/i.test(slot) && typeof ref === 'string') candidates.push(ref)
  }
  if (typeof wall.materialPreset === 'string') candidates.push(wall.materialPreset)
  const legacy = wall.material as { preset?: string; texture?: { url?: string } } | undefined
  if (legacy?.preset) candidates.push(legacy.preset)
  if (legacy?.texture?.url) candidates.push(legacy.texture.url)
  for (const name of candidates.map((c) => c.toLowerCase())) {
    if (/fiber|hardie|cement/.test(name)) return 'fiber-cement'
    if (/siding|lap|batten|clapboard|shiplap/.test(name)) return 'siding'
    if (/stucco|plaster/.test(name)) return 'stucco'
    if (/brick/.test(name)) return 'brick'
    if (/stone|masonry|rubble/.test(name)) return 'stone'
  }
  return null
}

// ---------------------------------------------------------------------------
// Solids
// ---------------------------------------------------------------------------

export type DoorSegmentSpec = {
  type: 'panel' | 'glass' | 'empty'
  heightRatio: number
  columnRatios: number[]
}

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
  /** The schedule's mark for this opening (D101 / W101 …), '' when unknown. */
  mark: string
  /** 'opening' = a cased opening without a leaf / sash. */
  openingKind: 'door' | 'window' | 'opening'
  openingShape: string
  construction: 'framed' | 'masonry'
  frameThickness: number
  columnRatios: number[]
  rowRatios: number[]
  // windows
  windowType?: string
  casementStyle?: 'single' | 'french'
  hingesSide?: 'left' | 'right'
  awningDirection?: 'up' | 'down'
  // doors
  doorType?: string
  leafCount?: number
  segments?: DoorSegmentSpec[]
  handle?: boolean
  handleHeight?: number
  handleSide?: 'left' | 'right'
  threshold?: boolean
}

/**
 * A placed item (furniture, fixture, appliance, tree …) as an oriented
 * footprint box: world plan corners plus base / top elevations. Items nested
 * inside other items are skipped (their frame is the parent's mesh).
 */
export type ItemSolid = {
  kind: 'item'
  id: string
  name: string
  assetId: string
  category: string
  polygon: Vec2[]
  baseY: number
  topY: number
  levelId: string | null
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
  /**
   * The colour the cladding renders in 3D — the painted exterior slot's
   * catalog colour, else the assembly finish's catalog colour — or null when
   * neither is known (drawn on white).
   */
  claddingColor: string | null
  baseY: number
  topY: number
  /**
   * What the wall carries below its base (`WallNode.underpinning`): the
   * finish carried down to `rimBottomY` over the floor platform's edge,
   * the concrete stemwall from there down to `stemBottomY`. Null for a wall
   * that stops at its base.
   */
  underpinning: { rimBottomY: number; stemBottomY: number } | null
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
  /** The roof covering's catalog colour when painted, else null (assumed shingle grey). */
  color: string | null
  /** The segment's pitch, degrees — the roof plan's "7:12" comes from the same field. */
  pitchDeg: number
}

export type LevelInfo = {
  id: string
  name: string
  ordinal: number
  baseY: number
  height: number
}

/** The roof finish the generator recorded on the building (`metadata.finishes.roof`), if any. */
export type RoofFinishRecord = { label: string; hex: string | null }

export type BuildingModel = {
  walls: WallSolid[]
  prisms: PrismSolid[]
  roofs: RoofSolid[]
  items: ItemSolid[]
  levels: LevelInfo[]
  /** World elevation of the ground at a plan point. */
  gradeAt: (x: number, z: number) => number
  warnings: string[]
  /** The recorded roofing finish — null when no building carries the record. */
  roofFinish: RoofFinishRecord | null
}

/**
 * The roofing finish off the first building's `metadata.finishes` as the
 * generator writes it (plugin-generate `Finishes.roof`: label + hex) —
 * duck-typed, so a hand-made building without the record yields null.
 */
export function roofFinishOf(nodes: Nodes): RoofFinishRecord | null {
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'building') continue
    const meta = (node as { metadata?: unknown }).metadata
    const finishes =
      meta && typeof meta === 'object' ? (meta as { finishes?: unknown }).finishes : undefined
    const roof =
      finishes && typeof finishes === 'object' ? (finishes as { roof?: unknown }).roof : undefined
    if (!roof || typeof roof !== 'object') continue
    const label = (roof as { label?: unknown }).label
    if (typeof label !== 'string' || label.length === 0) continue
    const hex = (roof as { hex?: unknown }).hex
    return { label, hex: typeof hex === 'string' && hex.length > 0 ? hex : null }
  }
  return null
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

/** Catalog colour behind a `library:` material ref, else null. */
function libraryColor(ref: string | null | undefined): string | null {
  if (!ref || parseMaterialRef(ref)?.kind !== 'library') return null
  const preset = getMaterialPresetByRef(ref) as {
    previewColor?: string
    mapProperties?: { color?: string }
  } | null
  return preset?.previewColor ?? preset?.mapProperties?.color ?? null
}

/** The 3D exterior face colour: painted exterior slot first, then the assembly cladding. */
export function claddingColorOf(wall: WallNode): string | null {
  const slots = (wall.slots ?? {}) as Record<string, string>
  const painted = slots.exterior ?? slots.middleExterior ?? null
  return libraryColor(painted) ?? libraryColor(wallAssemblyFinishRef(wall))
}

function roofColorOf(roof: RoofNode, segment: RoofSegmentNode): string | null {
  const own =
    (segment as { topMaterialPreset?: string; materialPreset?: string }).topMaterialPreset ??
    (segment as { materialPreset?: string }).materialPreset
  const spec = getEffectiveRoofSurfaceMaterial(roof, 'top')
  return (
    libraryColor(own) ??
    libraryColor(spec.materialPreset) ??
    (spec.material as { properties?: { color?: string } } | undefined)?.properties?.color ??
    null
  )
}

function collectOpenings(
  wall: WallSolid,
  nodes: Nodes,
  warnings: string[],
  marks: ReadonlyMap<string, string>,
): Opening[] {
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
    const isDoor = node.type === 'door'
    const door = hosted as DoorNode
    const win = hosted as WindowNode
    const loose = hosted as unknown as Record<string, unknown>
    const kind = loose.openingKind === 'opening' ? 'opening' : isDoor ? 'door' : 'window'
    openings.push({
      id: hosted.id,
      nodeType: isDoor ? 'door' : 'window',
      along,
      width,
      sillY: wall.baseY + centerY - height / 2,
      headY: wall.baseY + centerY + height / 2,
      hasSill: !isDoor && win.sill !== false,
      columns: !isDoor ? (win.columnRatios?.length ?? 1) : 1,
      rows: !isDoor ? (win.rowRatios?.length ?? 1) : 1,
      mark: marks.get(hosted.id) ?? (typeof loose.mark === 'string' ? loose.mark : ''),
      openingKind: kind,
      openingShape:
        typeof loose.openingShape === 'string' ? (loose.openingShape as string) : 'rectangle',
      construction: loose.constructionType === 'masonry' ? 'masonry' : 'framed',
      frameThickness:
        typeof loose.frameThickness === 'number' ? (loose.frameThickness as number) : 0.05,
      columnRatios: !isDoor ? [...(win.columnRatios ?? [1])] : [1],
      rowRatios: !isDoor ? [...(win.rowRatios ?? [1])] : [1],
      ...(isDoor
        ? {
            doorType: door.doorType,
            leafCount: door.leafCount,
            segments: (door as { segments?: DoorSegmentSpec[] }).segments?.map((s) => ({
              type: s.type,
              heightRatio: s.heightRatio,
              columnRatios: [...(s.columnRatios ?? [1])],
            })),
            handle: door.handle,
            handleHeight: door.handleHeight,
            handleSide: door.handleSide,
            threshold: door.threshold,
          }
        : {
            windowType: win.windowType,
            casementStyle: win.casementStyle,
            hingesSide: win.hingesSide,
            awningDirection: win.awningDirection,
          }),
    })
  }
  return openings.sort((a, b) => a.along - b.along)
}

// Plan-space rotation, the floor plan's convention (`nodes/src/item/floorplan.ts`).
function rotateVec(x: number, y: number, angle: number): Vec2 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [x * c + y * s, -x * s + y * c]
}

/**
 * Every placed item as an oriented footprint box. Level-parented items carry
 * level-local `position` / `rotation`; wall-hosted items carry a wall-local
 * `[along, height, offset]` and the wall's own yaw — the same maths the floor
 * plan uses, so an item lands on paper where it lands in plan.
 */
function collectItems(
  nodes: Nodes,
  elevations: Map<string, { baseY: number }>,
  warnings: string[],
): ItemSolid[] {
  const items: ItemSolid[] = []
  let nested = 0
  for (const node of Object.values(nodes)) {
    if (!isType<ItemNode>(node, 'item')) continue
    if (node.visible === false) continue
    const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
    const [w, h, d] = getScaledDimensions(node)
    if (!(w > 1e-4 && d > 1e-4 && h > 1e-4)) continue
    let cx: number
    let cz: number
    let rotation: number
    let baseY: number
    const levelId = findLevelId(node, nodes)
    const levelBase = elevations.get(levelId ?? '')?.baseY ?? 0
    if (parent?.type === 'wall') {
      const wall = parent as WallNode
      const wallRotation = -Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
      const zLocal =
        node.asset.attachTo === 'wall-side'
          ? ((wall.thickness ?? 0.1) / 2) * (node.side === 'front' ? 1 : -1)
          : node.position[2]
      const [ox, oz] = rotateVec(node.position[0], zLocal, wallRotation)
      cx = wall.start[0] + ox
      cz = wall.start[1] + oz
      rotation = wallRotation + (node.rotation[1] ?? 0)
      if (node.asset.attachTo === 'wall-side') {
        const [dx, dz] = rotateVec(0, d / 2, rotation)
        cx += dx
        cz += dz
      }
      baseY = levelBase + (wall.supportOffset ?? 0) + node.position[1]
    } else if (parent?.type === 'item' || parent?.type === 'shelf') {
      nested++
      continue
    } else if (parent?.type === 'roof-segment' || parent?.type === 'block') {
      nested++
      continue
    } else {
      cx = node.position[0]
      cz = node.position[2]
      rotation = node.rotation[1] ?? 0
      baseY = levelBase + node.position[1]
    }
    const corners: Vec2[] = (
      [
        [-w / 2, -d / 2],
        [w / 2, -d / 2],
        [w / 2, d / 2],
        [-w / 2, d / 2],
      ] as Vec2[]
    ).map(([x, z]) => {
      const [rx, rz] = rotateVec(x, z, rotation)
      return [cx + rx, cz + rz] as Vec2
    })
    items.push({
      kind: 'item',
      id: node.id,
      name: node.name ?? node.asset.name ?? 'item',
      assetId: node.asset.id,
      category: node.asset.category,
      polygon: corners,
      baseY,
      topY: baseY + h,
      levelId,
    })
  }
  if (nested > 0) {
    warnings.push(
      `${nested} item(s) hosted on other items / roof faces are not drawn (their frame is the host mesh).`,
    )
  }
  return items
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
      color: roofColorOf(roof, segment),
      pitchDeg: typeof segment.pitch === 'number' ? segment.pitch : 0,
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
    // The schedule's marks, so the tags on paper and the schedule rows agree.
    let marks: ReadonlyMap<string, string> = new Map()
    if (levelId !== '__orphan__') {
      try {
        marks = resolveMarkDetail(nodes as never, levelId as never).marks
      } catch {
        warnings.push(`Opening marks could not be resolved for level ${levelId}.`)
      }
    }
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
        exteriorFinish: exteriorFinishOf(wall),
        claddingColor: claddingColorOf(wall),
        baseY: baseY + (wall.supportOffset ?? 0),
        topY: baseY + (wall.supportOffset ?? 0) + (wall.height ?? DEFAULT_WALL_HEIGHT),
        underpinning: wall.underpinning
          ? {
              rimBottomY: baseY + (wall.supportOffset ?? 0) - wall.underpinning.rim,
              stemBottomY:
                baseY + (wall.supportOffset ?? 0) - wall.underpinning.rim - wall.underpinning.stem,
            }
          : null,
        openings: [],
        levelId: levelId === '__orphan__' ? null : levelId,
      }
      solid.openings = collectOpenings(solid, nodes, warnings, marks)
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

  const items = collectItems(nodes, elevations, warnings)
  return {
    walls,
    prisms,
    roofs,
    items,
    levels,
    gradeAt: terrainSampler(nodes, warnings),
    warnings,
    roofFinish: roofFinishOf(nodes),
  }
}
