// Pure TypeScript — no React, no Three.js, no WASM.
// Generates an IFC4 STEP string from a Pascal scene graph.

import type { AnyNode, AnyNodeId } from '../../schema/types'
import { getScaledDimensions, ItemNode } from '../../schema/nodes/item'
import { SlabNode } from '../../schema/nodes/slab'
import type { WallNode } from '../../schema/nodes/wall'
import { getRenderableSlabPolygon } from '../../lib/slab-polygon'
import { pointInPolygon } from '../../lib/polygon-relations'
import {
  detectSpacesForLevel,
  planAutoSlabsForLevel,
  projectAutoSlabsForPlan,
} from '../../lib/space-detection'
import { DEFAULT_WALL_HEIGHT } from '../../systems/wall/wall-footprint'

const DEFAULT_STOREY_HEIGHT = 3.0
const DEFAULT_WALL_THICKNESS = 0.2
const DEFAULT_FLOOR_THICKNESS = 0.05
const GLOBAL_ID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$'

type Vec2 = [number, number]

interface WallLike {
  id: string
  name?: string
  parentId?: string | null
  start: Vec2
  end: Vec2
  thickness?: number
  height?: number
}

interface SlabLike {
  id: string
  name?: string
  parentId?: string | null
  polygon: Vec2[]
  elevation?: number
  autoFromWalls?: boolean
}

interface DoorLike {
  id: string
  name?: string
  parentId?: string | null
  wallId?: string
  width: number
  height: number
  position: [number, number, number]
}

interface WindowLike {
  id: string
  name?: string
  parentId?: string | null
  wallId?: string
  width: number
  height: number
  position: [number, number, number]
}

interface ZoneLike {
  id: string
  name?: string
  parentId?: string | null
  polygon: Vec2[]
}

interface LevelLike {
  id: string
  name?: string
  level: number
  metadata?: Record<string, unknown>
}

type ItemLike = Pick<ItemNode, 'id' | 'name' | 'parentId' | 'position' | 'rotation' | 'scale' | 'asset' | 'wallId' | 'wallT'>

/** Triangle mesh for an item, in placement-local IFC coordinates (X/Z plan, Y up). */
export type IfcItemMesh = {
  positions: number[]
  indices: number[]
}

export type IfcExportOptions = {
  itemMeshes?: Record<string, IfcItemMesh>
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0.'
  const s = n.toFixed(6).replace(/\.?0+$/, '')
  return s.includes('.') ? s : `${s}.`
}

function esc(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function newGlobalId(): string {
  const bytes = new Uint8Array(22)
  crypto.getRandomValues(bytes)
  let id = ''
  for (let i = 0; i < 22; i++) {
    id += GLOBAL_ID_CHARS[bytes[i]! % GLOBAL_ID_CHARS.length]!
  }
  return id
}

function findLevelId(node: AnyNode, nodes: Record<AnyNodeId, AnyNode>): string | null {
  let current: AnyNode | undefined = node
  let guard = 0
  while (current && guard < 16) {
    if (current.type === 'level') return current.id
    current = current.parentId ? nodes[current.parentId as AnyNodeId] : undefined
    guard++
  }
  return null
}

function resolveLevelElevation(level: LevelLike, sortedLevels: LevelLike[]): number {
  const metaElevation = level.metadata?.elevation
  if (typeof metaElevation === 'number' && Number.isFinite(metaElevation)) {
    return metaElevation
  }
  const index = sortedLevels.findIndex((entry) => entry.id === level.id)
  return Math.max(0, index) * DEFAULT_STOREY_HEIGHT
}

function pascalToIfcXY(x: number, z: number): [number, number] {
  return [x, z]
}

function pascalToIfcPoint(x: number, y: number, z: number): [number, number, number] {
  return [x, z, y]
}

class IfcStepWriter {
  private nextId = 1
  private readonly lines: string[] = []

  ref(type: string, args: string): number {
    const id = this.nextId++
    this.lines.push(`#${id}=${type}(${args});`)
    return id
  }

  toString(): string {
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    const header = [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION(('ViewDefinition [DesignTransferView]'),'2;1');",
      `FILE_NAME('pascal-export.ifc','${now}',(''),(''),'Pascal Editor','Pascal Editor','');`,
      "FILE_SCHEMA(('IFC4'));",
      'ENDSEC;',
      '',
      'DATA;',
    ].join('\n')
    return `${header}\n${this.lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`
  }

  point2(x: number, y: number): number {
    return this.ref('IFCCARTESIANPOINT', `(${fmt(x)},${fmt(y)})`)
  }

  point3(x: number, y: number, z: number): number {
    return this.ref('IFCCARTESIANPOINT', `(${fmt(x)},${fmt(y)},${fmt(z)})`)
  }

  direction2(x: number, y: number): number {
    const len = Math.hypot(x, y)
    if (len < 1e-9) return this.ref('IFCDIRECTION', '(1.,0.)')
    return this.ref('IFCDIRECTION', `(${fmt(x / len)},${fmt(y / len)})`)
  }

  direction3(x: number, y: number, z: number): number {
    const len = Math.hypot(x, y, z)
    if (len < 1e-9) return this.ref('IFCDIRECTION', '(0.,0.,1.)')
    return this.ref('IFCDIRECTION', `(${fmt(x / len)},${fmt(y / len)},${fmt(z / len)})`)
  }

  axis2Placement3D(
    location: number,
    axis: number | null = null,
    refDirection: number | null = null,
  ): number {
    const axisArg = axis === null ? '$' : `#${axis}`
    const refArg = refDirection === null ? '$' : `#${refDirection}`
    return this.ref('IFCAXIS2PLACEMENT3D', `#${location},${axisArg},${refArg}`)
  }

  axis2Placement2D(location: number, refDirection: number | null = null): number {
    const refArg = refDirection === null ? '$' : `#${refDirection}`
    return this.ref('IFCAXIS2PLACEMENT2D', `#${location},${refArg}`)
  }

  localPlacement(parent: number | null, relative: number): number {
    const parentArg = parent === null ? '$' : `#${parent}`
    return this.ref('IFCLOCALPLACEMENT', `${parentArg},#${relative}`)
  }

  ownerHistory(): number {
    const person = this.ref('IFCPERSON', '$,$,$,$,$,$,$,$')
    const org = this.ref('IFCORGANIZATION', `$,${esc('Pascal Editor')},$,$,$`)
    const personOrg = this.ref('IFCPERSONANDORGANIZATION', `#${person},#${org},$`)
    const app = this.ref('IFCAPPLICATION', `#${org},'1.0','Pascal Editor','PascalEditor'`)
    return this.ref(
      'IFCOWNERHISTORY',
      `#${personOrg},#${app},$,.NOCHANGE.,$,$,$,${Math.floor(Date.now() / 1000)}`,
    )
  }

  unitAssignment(): number {
    const length = this.ref('IFCSIUNIT', '$,.LENGTHUNIT.,$,.METRE.')
    const area = this.ref('IFCSIUNIT', '$,.AREAUNIT.,$,.SQUARE_METRE.')
    const volume = this.ref('IFCSIUNIT', '$,.VOLUMEUNIT.,$,.CUBIC_METRE.')
    const angle = this.ref('IFCSIUNIT', '$,.PLANEANGLEUNIT.,$,.RADIAN.')
    return this.ref('IFCUNITASSIGNMENT', `(#${length},#${area},#${volume},#${angle})`)
  }

  modelContext(): number {
    const origin = this.point3(0, 0, 0)
    const placement = this.axis2Placement3D(origin)
    const trueNorth = this.direction2(0, 1)
    return this.ref(
      'IFCGEOMETRICREPRESENTATIONCONTEXT',
      `$,'Model',3,${fmt(1e-5)},#${placement},#${trueNorth}`,
    )
  }

  bodyContext(modelContext: number): number {
    return this.ref(
      'IFCGEOMETRICREPRESENTATIONSUBCONTEXT',
      `'Body','Model',*,*,*,*,#${modelContext},$,.MODEL_VIEW.,$`,
    )
  }

  extrudedRectangleSolid(
    length: number,
    thickness: number,
    height: number,
    context: number,
  ): { shape: number; placement: number } {
    const profileOrigin = this.point2(length / 2, 0)
    const profilePlacement = this.axis2Placement2D(profileOrigin)
    const profile = this.ref(
      'IFCRECTANGLEPROFILEDEF',
      `.AREA.,$,#${profilePlacement},${fmt(length)},${fmt(thickness)}`,
    )
    const solidOrigin = this.point3(0, 0, 0)
    const solidPlacement = this.axis2Placement3D(solidOrigin)
    const extrudeAxis = this.direction3(0, 0, 1)
    const solid = this.ref(
      'IFCEXTRUDEDAREASOLID',
      `#${profile},#${solidPlacement},#${extrudeAxis},${fmt(height)}`,
    )
    const shape = this.ref(
      'IFCSHAPEREPRESENTATION',
      `#${context},'Body','SweptSolid',(#${solid})`,
    )
    return { shape, placement: solidPlacement }
  }

  /** Box centered on placement origin in plan, extruded upward. */
  extrudedBoxSolid(
    width: number,
    depth: number,
    height: number,
    context: number,
  ): number {
    const profilePlacement = this.axis2Placement2D(this.point2(0, 0))
    const profile = this.ref(
      'IFCRECTANGLEPROFILEDEF',
      `.AREA.,$,#${profilePlacement},${fmt(width)},${fmt(depth)}`,
    )
    const solidPlacement = this.axis2Placement3D(this.point3(0, 0, 0))
    const extrudeAxis = this.direction3(0, 0, 1)
    const solid = this.ref(
      'IFCEXTRUDEDAREASOLID',
      `#${profile},#${solidPlacement},#${extrudeAxis},${fmt(height)}`,
    )
    return this.ref('IFCSHAPEREPRESENTATION', `#${context},'Body','SweptSolid',(#${solid})`)
  }

  productDefinitionShape(shape: number): number {
    return this.ref('IFCPRODUCTDEFINITIONSHAPE', `$,$,(#${shape})`)
  }

  closedPolyline(pointIds: number[]): number {
    if (pointIds.length === 0) return this.ref('IFCPOLYLINE', '()')
    const closed = [...pointIds, pointIds[0]!]
    return this.ref('IFCPOLYLINE', `(${closed.map((id) => `#${id}`).join(',')})`)
  }

  arbitraryClosedProfile(polylineId: number, name = '$'): number {
    const nameArg = name === '$' ? '$' : esc(name)
    return this.ref('IFCARBITRARYCLOSEDPROFILEDEF', `.AREA.,${nameArg},#${polylineId}`)
  }

  triangulatedFaceSetSolid(positions: number[], indices: number[], context: number): number | null {
    const pointCount = Math.floor(positions.length / 3)
    if (pointCount < 3 || indices.length < 3) return null

    const pointTuples: string[] = []
    for (let i = 0; i < pointCount; i++) {
      pointTuples.push(
        `(${fmt(positions[i * 3]!)},${fmt(positions[i * 3 + 1]!)},${fmt(positions[i * 3 + 2]!)})`,
      )
    }

    const coordList = this.ref('IFCCARTESIANPOINTLIST3D', `(${pointTuples.join(',')})`)

    const triangles: string[] = []
    for (let i = 0; i + 2 < indices.length; i += 3) {
      triangles.push(`(${indices[i]! + 1},${indices[i + 1]! + 1},${indices[i + 2]! + 1})`)
    }
    if (triangles.length === 0) return null

    const faceSet = this.ref('IFCTRIANGULATEDFACESET', `#${coordList},$,$,(${triangles.join(',')}),$`)
    return this.ref('IFCSHAPEREPRESENTATION', `#${context},'Body','Tessellation',(#${faceSet})`)
  }
}

function wallLength(wall: WallLike): number {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

function wallAngle(wall: WallLike): number {
  return Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
}

function openingIfcPlacement(
  writer: IfcStepWriter,
  wall: WallLike,
  elevation: number,
  along: number,
  bottom: number,
): number {
  return productIfcPlacement(
    writer,
    wall.start[0] + along * Math.cos(wallAngle(wall)),
    elevation + bottom,
    wall.start[1] + along * Math.sin(wallAngle(wall)),
    wallAngle(wall),
    null,
  )
}

function productIfcPlacement(
  writer: IfcStepWriter,
  px: number,
  py: number,
  pz: number,
  yaw: number,
  parentPlacement: number | null,
): number {
  const [ifcX, ifcY, ifcZ] = pascalToIfcPoint(px, py, pz)
  const location = writer.point3(ifcX, ifcY, ifcZ)
  const axis = writer.direction3(0, 0, 1)
  const ref = writer.direction3(Math.cos(yaw), Math.sin(yaw), 0)
  const placement3d = writer.axis2Placement3D(location, axis, ref)
  return writer.localPlacement(parentPlacement, placement3d)
}

function resolveItemWorldPose(
  item: ItemLike,
  wallById: Map<string, WallLike>,
  levelElevation: number,
): { position: [number, number, number]; yaw: number } | null {
  const attachTo = item.asset.attachTo

  if (attachTo === 'ceiling') return null

  if ((attachTo === 'wall' || attachTo === 'wall-side')) {
    const hostWallId =
      item.wallId ??
      (item.parentId && wallById.has(item.parentId) ? item.parentId : undefined)
    if (!hostWallId) return null
    const wall = wallById.get(hostWallId)
    if (!wall) return null
    const len = wallLength(wall)
    if (len < 1e-6) return null
    const along = item.wallT != null ? item.wallT * len : item.position[0]
    const angle = wallAngle(wall)
    return {
      position: [
        wall.start[0] + along * Math.cos(angle),
        levelElevation + item.position[1],
        wall.start[1] + along * Math.sin(angle),
      ],
      yaw: angle + item.rotation[1],
    }
  }

  if (attachTo === 'wall' || attachTo === 'wall-side') return null

  return {
    position: [item.position[0], levelElevation + item.position[1], item.position[2]],
    yaw: item.rotation[1],
  }
}

function exportFloorSlabProduct(
  writer: IfcStepWriter,
  owner: number,
  bodyContext: number,
  polygon: Vec2[],
  thickness: number,
  name: string,
  parentPlacement: number | null,
): number | null {
  if (polygon.length < 3) return null

  let minX = Infinity
  let minZ = Infinity
  for (const [x, z] of polygon) {
    minX = Math.min(minX, x)
    minZ = Math.min(minZ, z)
  }

  const profilePointIds = polygon.map(([x, z]) => {
    const [ifcX, ifcY] = pascalToIfcXY(x, z)
    return writer.point2(ifcX - minX, ifcY - minZ)
  })
  const polyline = writer.closedPolyline(profilePointIds)
  const profile = writer.arbitraryClosedProfile(polyline, name)
  const solidPlacement = writer.axis2Placement3D(writer.point3(0, 0, 0))
  const extrudeAxis = writer.direction3(0, 0, 1)
  const solid = writer.ref(
    'IFCEXTRUDEDAREASOLID',
    `#${profile},#${solidPlacement},#${extrudeAxis},${fmt(thickness)}`,
  )
  const shape = writer.ref('IFCSHAPEREPRESENTATION', `#${bodyContext},'Body','SweptSolid',(#${solid})`)
  const shapeRep = writer.productDefinitionShape(shape)

  const [ifcX, ifcY] = pascalToIfcXY(minX, minZ)
  const objectPlacement = writer.localPlacement(
    parentPlacement,
    writer.axis2Placement3D(writer.point3(ifcX, ifcY, 0)),
  )

  return writer.ref(
    'IFCSLAB',
    `${esc(newGlobalId())},#${owner},${esc(name)},$,$,#${objectPlacement},#${shapeRep},$,.FLOOR.`,
  )
}

type FloorExportSpec = {
  name: string
  polygon: Vec2[]
  thickness: number
}

function slabToFloorSpec(slab: SlabNode): FloorExportSpec | null {
  const polygon = getRenderableSlabPolygon(slab)
  if (polygon.length < 3) return null
  return {
    name: slab.name || 'Floor',
    polygon,
    thickness: slab.elevation ?? DEFAULT_FLOOR_THICKNESS,
  }
}

function zoneToFloorSpec(zone: ZoneLike): FloorExportSpec | null {
  if (zone.polygon.length < 3) return null
  const polygon = getRenderableSlabPolygon(
    SlabNode.parse({ polygon: zone.polygon, autoFromWalls: false }),
  )
  if (polygon.length < 3) return null
  return {
    name: zone.name || 'Floor',
    polygon,
    thickness: DEFAULT_FLOOR_THICKNESS,
  }
}

function polygonCentroid(polygon: Vec2[]): Vec2 {
  let x = 0
  let z = 0
  for (const [px, pz] of polygon) {
    x += px
    z += pz
  }
  return [x / polygon.length, z / polygon.length]
}

function isZoneCoveredByFloors(zone: ZoneLike, specs: FloorExportSpec[]): boolean {
  if (zone.polygon.length < 3 || specs.length === 0) return false
  const centroid = polygonCentroid(zone.polygon)
  return specs.some((spec) => pointInPolygon(centroid, spec.polygon))
}

function floorsForLevel(
  levelId: string,
  levelWalls: WallLike[],
  levelSlabs: SlabLike[],
  levelZones: ZoneLike[],
): FloorExportSpec[] {
  const parsedSlabs = levelSlabs.map((slab) => SlabNode.parse(slab))
  let exportSlabs = parsedSlabs

  if (levelWalls.length >= 3) {
    const { roomPolygons } = detectSpacesForLevel(levelId, levelWalls as WallNode[])
    const plan = planAutoSlabsForLevel(roomPolygons, parsedSlabs)
    exportSlabs = projectAutoSlabsForPlan(parsedSlabs, plan)
  }

  const specs = exportSlabs
    .map((slab) => slabToFloorSpec(slab))
    .filter((spec): spec is FloorExportSpec => spec !== null)

  const zoneGapSpecs: FloorExportSpec[] = []
  if (levelWalls.length > 0 && levelZones.length > 0) {
    for (const zone of levelZones) {
      if (isZoneCoveredByFloors(zone, specs)) continue
      const zoneSpec = zoneToFloorSpec(zone)
      if (zoneSpec) zoneGapSpecs.push(zoneSpec)
    }
  }

  return [...specs, ...zoneGapSpecs]
}

export function exportSceneToIfc(
  nodes: Record<AnyNodeId, AnyNode>,
  options: IfcExportOptions = {},
): string {
  const itemMeshes = options.itemMeshes ?? {}
  const walls: WallLike[] = []
  const slabs: SlabLike[] = []
  const doors: DoorLike[] = []
  const windows: WindowLike[] = []
  const zones: ZoneLike[] = []
  const levels: LevelLike[] = []
  const items: ItemLike[] = []

  for (const node of Object.values(nodes)) {
    switch (node.type) {
      case 'wall': {
        const wall = node as unknown as WallLike
        if (Array.isArray(wall.start) && Array.isArray(wall.end)) walls.push(wall)
        break
      }
      case 'slab': {
        const slab = node as unknown as SlabLike
        if (Array.isArray(slab.polygon) && slab.polygon.length >= 3) slabs.push(slab)
        break
      }
      case 'door':
        doors.push(node as unknown as DoorLike)
        break
      case 'window':
        windows.push(node as unknown as WindowLike)
        break
      case 'zone': {
        const zone = node as unknown as ZoneLike
        if (Array.isArray(zone.polygon) && zone.polygon.length >= 3) zones.push(zone)
        break
      }
      case 'level':
        levels.push(node as unknown as LevelLike)
        break
      case 'item':
        items.push(node as ItemLike)
        break
      default:
        break
    }
  }

  const sortedLevels = [...levels].sort((a, b) => a.level - b.level)
  const levelElevation = new Map<string, number>()
  for (const level of sortedLevels) {
    levelElevation.set(level.id, resolveLevelElevation(level, sortedLevels))
  }

  const writer = new IfcStepWriter()
  const owner = writer.ownerHistory()
  const units = writer.unitAssignment()
  const modelContext = writer.modelContext()
  const bodyContext = writer.bodyContext(modelContext)

  const projectPlacement = writer.localPlacement(
    null,
    writer.axis2Placement3D(writer.point3(0, 0, 0)),
  )
  const project = writer.ref(
    'IFCPROJECT',
    `${esc(newGlobalId())},#${owner},${esc('Pascal Project')},$,$,$,$,(#${modelContext}),#${units}`,
  )
  const sitePlacement = writer.localPlacement(projectPlacement, writer.axis2Placement3D(writer.point3(0, 0, 0)))
  const site = writer.ref(
    'IFCSITE',
    `${esc(newGlobalId())},#${owner},${esc('Site')},$,$,#${sitePlacement},$,$,.ELEMENT.,$,$,$,$,$`,
  )
  const buildingPlacement = writer.localPlacement(
    sitePlacement,
    writer.axis2Placement3D(writer.point3(0, 0, 0)),
  )
  const building = writer.ref(
    'IFCBUILDING',
    `${esc(newGlobalId())},#${owner},${esc('Building')},$,$,#${buildingPlacement},$,$,.ELEMENT.,$,$,$`,
  )

  const storeyByLevelId = new Map<string, number>()
  const storeyPlacements = new Map<string, number>()
  for (const level of sortedLevels) {
    const elevation = levelElevation.get(level.id) ?? 0
    const [ifcX, ifcY, ifcZ] = pascalToIfcPoint(0, elevation, 0)
    const placement = writer.localPlacement(
      buildingPlacement,
      writer.axis2Placement3D(writer.point3(ifcX, ifcY, ifcZ)),
    )
    storeyPlacements.set(level.id, placement)
    const storey = writer.ref(
      'IFCBUILDINGSTOREY',
      `${esc(newGlobalId())},#${owner},${esc(level.name || `Level ${level.level}`)},$,$,#${placement},$,$,.ELEMENT.,${fmt(elevation)}`,
    )
    storeyByLevelId.set(level.id, storey)
  }

  const defaultStorey =
    sortedLevels.length > 0 ? storeyByLevelId.get(sortedLevels[0]!.id)! : building

  const wallById = new Map(walls.map((wall) => [wall.id, wall]))
  const slabsByLevel = new Map<string, SlabLike[]>()
  const wallsByLevel = new Map<string, WallLike[]>()
  const zonesByLevel = new Map<string, ZoneLike[]>()
  for (const wall of walls) {
    const levelId = findLevelId(wall as AnyNode, nodes)
    if (!levelId) continue
    const list = wallsByLevel.get(levelId) ?? []
    list.push(wall)
    wallsByLevel.set(levelId, list)
  }
  for (const slab of slabs) {
    const levelId = findLevelId(slab as AnyNode, nodes)
    if (!levelId) continue
    const list = slabsByLevel.get(levelId) ?? []
    list.push(slab)
    slabsByLevel.set(levelId, list)
  }
  for (const zone of zones) {
    const levelId = findLevelId(zone as AnyNode, nodes)
    if (!levelId) continue
    const list = zonesByLevel.get(levelId) ?? []
    list.push(zone)
    zonesByLevel.set(levelId, list)
  }
  const exportedProducts: number[] = []
  const storeyChildren = new Map<number, number[]>()

  const addToStorey = (storeyId: number, productId: number) => {
    const list = storeyChildren.get(storeyId) ?? []
    list.push(productId)
    storeyChildren.set(storeyId, list)
    exportedProducts.push(productId)
  }

  const resolveStoreyForNode = (node: { parentId?: string | null }): number => {
    const levelId = findLevelId(node as AnyNode, nodes)
    if (levelId && storeyByLevelId.has(levelId)) return storeyByLevelId.get(levelId)!
    return defaultStorey
  }

  for (const wall of walls) {
    const length = wallLength(wall)
    if (length < 1e-4) continue

    const thickness = wall.thickness ?? DEFAULT_WALL_THICKNESS
    const height = wall.height ?? DEFAULT_WALL_HEIGHT
    const levelId = findLevelId(wall as AnyNode, nodes)
    const elevation = levelId ? (levelElevation.get(levelId) ?? 0) : 0

    const angle = wallAngle(wall)
    const [startX, startY] = pascalToIfcXY(wall.start[0], wall.start[1])
    const location = writer.point3(startX, startY, elevation)
    const axis = writer.direction3(0, 0, 1)
    const ref = writer.direction3(Math.cos(angle), Math.sin(angle), 0)
    const objectPlacement = writer.localPlacement(
      levelId ? (storeyPlacements.get(levelId) ?? null) : buildingPlacement,
      writer.axis2Placement3D(location, axis, ref),
    )

    const { shape } = writer.extrudedRectangleSolid(length, thickness, height, bodyContext)
    const shapeRep = writer.productDefinitionShape(shape)
    const product = writer.ref(
      'IFCWALLSTANDARDCASE',
      `${esc(newGlobalId())},#${owner},${esc(wall.name || 'Wall')},$,$,#${objectPlacement},#${shapeRep},$,$`,
    )
    addToStorey(resolveStoreyForNode(wall), product)
  }

  const exportLevelFloors = (levelId: string | null, storeyTarget: number) => {
    if (!levelId) return
    const parentPlacement = storeyPlacements.get(levelId) ?? buildingPlacement
    const levelWalls = wallsByLevel.get(levelId) ?? []
    const levelSlabs = slabsByLevel.get(levelId) ?? []
    const levelZones = zonesByLevel.get(levelId) ?? []
    const floors = floorsForLevel(levelId, levelWalls, levelSlabs, levelZones)

    for (const floor of floors) {
      const product = exportFloorSlabProduct(
        writer,
        owner,
        bodyContext,
        floor.polygon,
        floor.thickness,
        floor.name,
        parentPlacement,
      )
      if (product) addToStorey(storeyTarget, product)
    }
  }

  const exportedFloorLevels = new Set<string>()
  for (const level of sortedLevels) {
    exportLevelFloors(level.id, storeyByLevelId.get(level.id) ?? defaultStorey)
    exportedFloorLevels.add(level.id)
  }
  for (const levelId of slabsByLevel.keys()) {
    if (exportedFloorLevels.has(levelId)) continue
    exportLevelFloors(levelId, resolveStoreyForNode({ parentId: levelId }))
    exportedFloorLevels.add(levelId)
  }
  for (const levelId of wallsByLevel.keys()) {
    if (exportedFloorLevels.has(levelId)) continue
    exportLevelFloors(levelId, resolveStoreyForNode({ parentId: levelId }))
  }

  for (const door of doors) {
    const wall = door.wallId ? wallById.get(door.wallId) : undefined
    if (!wall) continue
    const bottom = Math.max(0, door.position[1] - door.height / 2)
    const placement = openingIfcPlacement(
      writer,
      wall,
      findLevelId(door as AnyNode, nodes)
        ? (levelElevation.get(findLevelId(door as AnyNode, nodes)!) ?? 0)
        : 0,
      door.position[0],
      bottom,
    )
    const { shape } = writer.extrudedRectangleSolid(door.width, wall.thickness ?? DEFAULT_WALL_THICKNESS, door.height, bodyContext)
    const shapeRep = writer.productDefinitionShape(shape)
    const product = writer.ref(
      'IFCDOOR',
      `${esc(newGlobalId())},#${owner},${esc(door.name || 'Door')},$,$,#${placement},#${shapeRep},$,$,${fmt(door.height)},${fmt(door.width)}`,
    )
    addToStorey(resolveStoreyForNode(door), product)
  }

  for (const window of windows) {
    const wall = window.wallId ? wallById.get(window.wallId) : undefined
    if (!wall) continue
    const bottom = Math.max(0, window.position[1] - window.height / 2)
    const placement = openingIfcPlacement(
      writer,
      wall,
      findLevelId(window as AnyNode, nodes)
        ? (levelElevation.get(findLevelId(window as AnyNode, nodes)!) ?? 0)
        : 0,
      window.position[0],
      bottom,
    )
    const { shape } = writer.extrudedRectangleSolid(
      window.width,
      wall.thickness ?? DEFAULT_WALL_THICKNESS,
      window.height,
      bodyContext,
    )
    const shapeRep = writer.productDefinitionShape(shape)
    const product = writer.ref(
      'IFCWINDOW',
      `${esc(newGlobalId())},#${owner},${esc(window.name || 'Window')},$,$,#${placement},#${shapeRep},$,$,${fmt(window.height)},${fmt(window.width)}`,
    )
    addToStorey(resolveStoreyForNode(window), product)
  }

  for (const zone of zones) {
    const levelId = findLevelId(zone as AnyNode, nodes)
    const floorElevation = levelId ? (levelElevation.get(levelId) ?? 0) : 0
    const parentPlacement = levelId ? (storeyPlacements.get(levelId) ?? null) : buildingPlacement
    const [ifcX, ifcY, ifcZ] = pascalToIfcPoint(0, floorElevation, 0)
    const objectPlacement = writer.localPlacement(
      parentPlacement,
      writer.axis2Placement3D(writer.point3(ifcX, ifcY, ifcZ)),
    )
    const space = writer.ref(
      'IFCSPACE',
      `${esc(newGlobalId())},#${owner},${esc(zone.name || 'Space')},$,$,#${objectPlacement},$,$,$,.ELEMENT.,.INTERNAL.,$`,
    )
    addToStorey(resolveStoreyForNode(zone), space)
  }

  for (const item of items) {
    const parsedItem = ItemNode.parse(item)
    const levelId = findLevelId(parsedItem as AnyNode, nodes)
    const elevation = levelId ? (levelElevation.get(levelId) ?? 0) : 0
    const pose = resolveItemWorldPose(parsedItem, wallById, elevation)
    if (!pose) continue

    const objectPlacement = productIfcPlacement(
      writer,
      pose.position[0],
      pose.position[1],
      pose.position[2],
      pose.yaw,
      levelId ? (storeyPlacements.get(levelId) ?? null) : buildingPlacement,
    )

    const mesh = itemMeshes[parsedItem.id]
    const meshShape =
      mesh && mesh.indices.length >= 3
        ? writer.triangulatedFaceSetSolid(mesh.positions, mesh.indices, bodyContext)
        : null

    let shape = meshShape
    if (shape == null) {
      const [width, height, depth] = getScaledDimensions(parsedItem)
      if (width < 1e-4 || height < 1e-4 || depth < 1e-4) continue
      shape = writer.extrudedBoxSolid(width, depth, height, bodyContext)
    }

    const shapeRep = writer.productDefinitionShape(shape)
    const label = parsedItem.name || parsedItem.asset.name || 'Furniture'
    const product = writer.ref(
      'IFCFURNISHINGELEMENT',
      `${esc(newGlobalId())},#${owner},${esc(label)},$,${esc(parsedItem.asset.category)},#${objectPlacement},#${shapeRep},$,.NOTDEFINED.`,
    )
    addToStorey(resolveStoreyForNode(parsedItem), product)
  }

  writer.ref(
    'IFCRELAGGREGATES',
    `${esc(newGlobalId())},#${owner},$,$,#${project},(#${site})`,
  )
  writer.ref(
    'IFCRELAGGREGATES',
    `${esc(newGlobalId())},#${owner},$,$,#${site},(#${building})`,
  )

  if (sortedLevels.length > 0) {
    writer.ref(
      'IFCRELAGGREGATES',
      `${esc(newGlobalId())},#${owner},$,$,#${building},(${sortedLevels.map((level) => `#${storeyByLevelId.get(level.id)}`).join(',')})`,
    )
  }

  for (const [storeyId, children] of storeyChildren) {
    if (children.length === 0) continue
    writer.ref(
      'IFCRELCONTAINEDINSPATIALSTRUCTURE',
      `${esc(newGlobalId())},#${owner},$,$,(${children.map((id) => `#${id}`).join(',')}),#${storeyId}`,
    )
  }

  if (exportedProducts.length === 0 && sortedLevels.length === 0) {
    // No geometry — still emit a valid empty building hierarchy.
  }

  return writer.toString()
}
