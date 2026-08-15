import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  type CeilingNode,
  type ColumnNode,
  computeStairSegmentTransforms,
  DEFAULT_WALL_THICKNESS,
  type DoorNode,
  type DuctSegmentNode,
  getActiveRoofHeight,
  getCatalogMaterialById,
  getLevelElevations,
  getRoofModuleFaces,
  getRoofShapeRatios,
  getWallPlaneTop,
  type LevelNode,
  type PipeSegmentNode,
  parseMaterialRef,
  type RoofNode,
  type RoofSegmentNode,
  resolveCeilingHeight,
  resolveStairTotalRise,
  resolveWallEffectiveHeight,
  type SceneGraph,
  type SceneMaterialId,
  type SiteNode,
  type SlabNode,
  type StairNode,
  type StairSegmentNode,
  type WallNode,
  type WindowNode,
  type ZoneNode,
} from '@pascal-app/core'

export type IfcExportScene = Pick<SceneGraph, 'nodes' | 'rootNodeIds' | 'materials'>

export type IfcExportWarningCode =
  | 'approximated-geometry'
  | 'invalid-geometry'
  | 'material-simplified'
  | 'missing-host'
  | 'semantic-only'

export type IfcExportWarning = {
  code: IfcExportWarningCode
  message: string
  nodeId?: string
}

export interface IfcExportOptions {
  applicationName?: string
  applicationVersion?: string
  author?: string
  ceilingThickness?: number
  fileName?: string
  organization?: string
  projectName?: string
  timestamp?: Date | number | string
  onWarning?: (warning: IfcExportWarning) => void
}

type StepId = number
type Vec3 = [number, number, number]
type Point2 = [number, number]

type SpatialRecord<T extends SiteNode | BuildingNode | LevelNode> = {
  key: string
  name: string
  node: T | null
}

type LevelExportRecord = SpatialRecord<LevelNode> & {
  baseY: number
  entityId: StepId
  height: number
  placementId: StepId
}

type ExportedElement = {
  entityId: StepId
  levelKey: string
  placementId: StepId
}

const IFC_GUID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$'
const VALID_IFC_GUID = /^[0-3][0-9A-Za-z_$]{21}$/
const INCH_TO_METRE = 0.0254
const MIN_GEOMETRY_SIZE = 1e-6

class StepBuilder {
  private readonly lines: string[] = []
  private nextId = 1

  add(type: string, args: string[]): StepId {
    const id = this.nextId++
    this.lines.push(`#${id}=${type}(${args.join(',')});`)
    return id
  }

  serialize(header: string): string {
    return `${header}\nDATA;\n${this.lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`
  }
}

function ref(id: StepId | null | undefined): string {
  return id == null ? '$' : `#${id}`
}

function list(values: readonly string[]): string {
  return `(${values.join(',')})`
}

function refs(values: readonly StepId[]): string {
  return list(values.map((value) => ref(value)))
}

function stepNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`IFC export received a non-finite number: ${value}`)
  const normalized = Object.is(value, -0) ? 0 : value
  const text = Number(normalized.toPrecision(15)).toString().replace('e', 'E')
  return /[.E]/.test(text) ? text : `${text}.`
}

function stepString(value: string): string {
  let encoded = ''
  let unicode = ''

  const flushUnicode = () => {
    if (!unicode) return
    encoded += `\\X2\\${unicode}\\X0\\`
    unicode = ''
  }

  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 32 || code > 126) {
      unicode += code.toString(16).toUpperCase().padStart(4, '0')
      continue
    }
    flushUnicode()
    const char = value[index]
    if (char === "'") encoded += "''"
    else if (char === '\\') encoded += '\\\\'
    else encoded += char
  }
  flushUnicode()
  return `'${encoded}'`
}

function enumValue(value: string): string {
  return `.${value}.`
}

function hash32(value: string, seed: number): number {
  let hash = (2166136261 ^ seed) >>> 0
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x7feb352d) >>> 0
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x846ca68b) >>> 0
  return (hash ^ (hash >>> 16)) >>> 0
}

function ifcGuid(key: string): string {
  const bytes = new Uint8Array(16)
  for (let word = 0; word < 4; word++) {
    const hash = hash32(key, 0x9e3779b9 * (word + 1))
    bytes[word * 4] = hash >>> 24
    bytes[word * 4 + 1] = hash >>> 16
    bytes[word * 4 + 2] = hash >>> 8
    bytes[word * 4 + 3] = hash
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  let compressed = ''
  for (let index = 0; index < 22; index++) {
    compressed = IFC_GUID_ALPHABET[Number(value & 63n)] + compressed
    value >>= 6n
  }
  return compressed
}

function metadataRecord(node: AnyNode): Record<string, unknown> {
  return node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
    ? (node.metadata as Record<string, unknown>)
    : {}
}

function nodeGuid(node: AnyNode, role = 'entity'): string {
  const existing = metadataRecord(node).globalId
  if (role === 'entity' && typeof existing === 'string' && VALID_IFC_GUID.test(existing)) {
    return existing
  }
  return ifcGuid(`${role}:${node.id}`)
}

function normalizeDate(value: IfcExportOptions['timestamp']): Date {
  if (value == null) return new Date()
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (Number.isNaN(date.getTime()))
    throw new Error(`Invalid IFC export timestamp: ${String(value)}`)
  return date
}

function header(
  options: Required<Pick<IfcExportOptions, 'applicationName' | 'fileName'>> & IfcExportOptions,
  date: Date,
): string {
  const timestamp = date.toISOString().replace(/\.\d{3}Z$/, 'Z')
  return [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION((${stepString('ViewDefinition [ReferenceView_V1.2]')}),'2;1');`,
    `FILE_NAME(${stepString(options.fileName)},${stepString(timestamp)},(${stepString(options.author ?? 'Pascal User')}),(${stepString(options.organization ?? 'Pascal')}),${stepString(options.applicationName)},${stepString(options.applicationName)},'');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
  ].join('\n')
}

function normalizeVector(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2])
  if (length < MIN_GEOMETRY_SIZE) return [0, 0, 1]
  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function pascalVectorToIfc(vector: Vec3): Vec3 {
  return [vector[0], vector[2], vector[1]]
}

function addPoint(builder: StepBuilder, point: Vec3 | Point2): StepId {
  return builder.add('IFCCARTESIANPOINT', [list(point.map(stepNumber))])
}

function addDirection(builder: StepBuilder, direction: Vec3): StepId {
  return builder.add('IFCDIRECTION', [list(normalizeVector(direction).map(stepNumber))])
}

function addAxisPlacement(
  builder: StepBuilder,
  location: Vec3,
  axis: Vec3 = [0, 0, 1],
  referenceDirection: Vec3 = [1, 0, 0],
): StepId {
  const pointId = addPoint(builder, location)
  const axisId = addDirection(builder, axis)
  const referenceId = addDirection(builder, referenceDirection)
  return builder.add('IFCAXIS2PLACEMENT3D', [ref(pointId), ref(axisId), ref(referenceId)])
}

function addLocalPlacement(
  builder: StepBuilder,
  parentPlacementId: StepId | null,
  location: Vec3 = [0, 0, 0],
  axis: Vec3 = [0, 0, 1],
  referenceDirection: Vec3 = [1, 0, 0],
): StepId {
  const relativePlacementId = addAxisPlacement(builder, location, axis, referenceDirection)
  return builder.add('IFCLOCALPLACEMENT', [ref(parentPlacementId), ref(relativePlacementId)])
}

function cleanPolygon(points: readonly Point2[]): Point2[] {
  const result: Point2[] = []
  for (const point of points) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue
    const previous = result[result.length - 1]
    if (previous && Math.hypot(previous[0] - point[0], previous[1] - point[1]) < 1e-9) continue
    result.push([point[0], point[1]])
  }
  if (result.length > 2) {
    const first = result[0]
    const last = result[result.length - 1]
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-9) result.pop()
  }
  return result
}

function addPolyline(builder: StepBuilder, points: readonly Point2[]): StepId {
  const clean = cleanPolygon(points)
  const closed = [...clean, clean[0]]
  const pointIds = closed.map((point) => addPoint(builder, point))
  return builder.add('IFCPOLYLINE', [refs(pointIds)])
}

function addPolygonProfile(
  builder: StepBuilder,
  points: readonly Point2[],
  holes: readonly (readonly Point2[])[] = [],
): StepId | null {
  const outer = cleanPolygon(points)
  if (outer.length < 3) return null
  const outerCurveId = addPolyline(builder, outer)
  const holeCurveIds = holes
    .map((hole) => cleanPolygon(hole))
    .filter((hole) => hole.length >= 3)
    .map((hole) => addPolyline(builder, hole))
  if (holeCurveIds.length === 0) {
    return builder.add('IFCARBITRARYCLOSEDPROFILEDEF', [enumValue('AREA'), '$', ref(outerCurveId)])
  }
  return builder.add('IFCARBITRARYPROFILEDEFWITHVOIDS', [
    enumValue('AREA'),
    '$',
    ref(outerCurveId),
    refs(holeCurveIds),
  ])
}

function addProfilePlacement(builder: StepBuilder): StepId {
  const pointId = addPoint(builder, [0, 0])
  const directionId = builder.add('IFCDIRECTION', [list([stepNumber(1), stepNumber(0)])])
  return builder.add('IFCAXIS2PLACEMENT2D', [ref(pointId), ref(directionId)])
}

function addRectangleProfile(builder: StepBuilder, width: number, depth: number): StepId {
  const placementId = addProfilePlacement(builder)
  return builder.add('IFCRECTANGLEPROFILEDEF', [
    enumValue('AREA'),
    '$',
    ref(placementId),
    stepNumber(width),
    stepNumber(depth),
  ])
}

function addCircleProfile(builder: StepBuilder, radius: number): StepId {
  const placementId = addProfilePlacement(builder)
  return builder.add('IFCCIRCLEPROFILEDEF', [
    enumValue('AREA'),
    '$',
    ref(placementId),
    stepNumber(radius),
  ])
}

function addExtrudedSolid(
  builder: StepBuilder,
  profileId: StepId,
  depth: number,
  location: Vec3 = [0, 0, 0],
  axis: Vec3 = [0, 0, 1],
  referenceDirection: Vec3 = [1, 0, 0],
): StepId {
  const positionId = addAxisPlacement(builder, location, axis, referenceDirection)
  const directionId = addDirection(builder, [0, 0, 1])
  return builder.add('IFCEXTRUDEDAREASOLID', [
    ref(profileId),
    ref(positionId),
    ref(directionId),
    stepNumber(depth),
  ])
}

function addProductShape(
  builder: StepBuilder,
  contextId: StepId,
  itemIds: StepId[],
  representationType = 'SweptSolid',
): StepId | null {
  if (itemIds.length === 0) return null
  const representationId = builder.add('IFCSHAPEREPRESENTATION', [
    ref(contextId),
    stepString('Body'),
    stepString(representationType),
    refs(itemIds),
  ])
  return builder.add('IFCPRODUCTDEFINITIONSHAPE', ['$', '$', refs([representationId])])
}

function addTriangulatedFaceSet(
  builder: StepBuilder,
  faces: readonly (readonly Vec3[])[],
): StepId | null {
  const coordinates: Vec3[] = []
  const coordinateIndices = new Map<string, number>()
  const triangles: [number, number, number][] = []

  const coordinateIndex = (point: Vec3): number => {
    const key = point.map((value) => value.toPrecision(12)).join(':')
    const existing = coordinateIndices.get(key)
    if (existing !== undefined) return existing
    const index = coordinates.length + 1
    coordinates.push(point)
    coordinateIndices.set(key, index)
    return index
  }

  for (const face of faces) {
    if (face.length < 3) continue
    const indices = face.map((point) => coordinateIndex(point))
    const origin = face[0]
    for (let index = 1; index < face.length - 1; index += 1) {
      const second = face[index]
      const third = face[index + 1]
      const normal = cross(
        [second[0] - origin[0], second[1] - origin[1], second[2] - origin[2]],
        [third[0] - origin[0], third[1] - origin[1], third[2] - origin[2]],
      )
      if (Math.hypot(...normal) <= MIN_GEOMETRY_SIZE) continue
      triangles.push([indices[0], indices[index], indices[index + 1]])
    }
  }

  if (coordinates.length < 3 || triangles.length === 0) return null
  const coordinateListId = builder.add('IFCCARTESIANPOINTLIST3D', [
    list(coordinates.map((point) => list(point.map(stepNumber)))),
  ])
  return builder.add('IFCTRIANGULATEDFACESET', [
    ref(coordinateListId),
    '$',
    enumValue('T'),
    list(triangles.map((triangle) => list(triangle.map(String)))),
    '$',
  ])
}

function addPolygonBody(
  builder: StepBuilder,
  contextId: StepId,
  points: readonly Point2[],
  holes: readonly (readonly Point2[])[],
  depth: number,
): StepId | null {
  if (depth <= MIN_GEOMETRY_SIZE) return null
  const profileId = addPolygonProfile(builder, points, holes)
  if (!profileId) return null
  return addProductShape(builder, contextId, [addExtrudedSolid(builder, profileId, depth)])
}

function addRectangleBody(
  builder: StepBuilder,
  contextId: StepId,
  width: number,
  depth: number,
  height: number,
): StepId | null {
  if (Math.min(width, depth, height) <= MIN_GEOMETRY_SIZE) return null
  const profileId = addRectangleProfile(builder, width, depth)
  return addProductShape(builder, contextId, [addExtrudedSolid(builder, profileId, height)])
}

function nodeName(node: AnyNode, fallback: string): string {
  return typeof node.name === 'string' && node.name.trim() ? node.name : fallback
}

function recordChildren(node: AnyNode): string[] {
  const children = (node as unknown as { children?: unknown }).children
  return Array.isArray(children)
    ? children.filter((child): child is string => typeof child === 'string')
    : []
}

function findParentOfType<T extends AnyNode['type']>(
  scene: IfcExportScene,
  node: AnyNode,
  type: T,
): Extract<AnyNode, { type: T }> | null {
  let current: AnyNode | undefined = node
  const visited = new Set<string>()
  for (let guard = 0; guard < 30 && current; guard++) {
    if (current.type === type) return current as Extract<AnyNode, { type: T }>
    if (visited.has(current.id)) break
    visited.add(current.id)
    const parent: AnyNode | undefined = current.parentId
      ? scene.nodes[current.parentId as AnyNodeId]
      : undefined
    if (parent) {
      current = parent
      continue
    }
    current = Object.values(scene.nodes).find((candidate) =>
      recordChildren(candidate).includes(current?.id ?? ''),
    )
  }
  return null
}

function commonPsetName(node: AnyNode): string | null {
  const names: Partial<Record<AnyNode['type'], string>> = {
    ceiling: 'Pset_CoveringCommon',
    column: 'Pset_ColumnCommon',
    door: 'Pset_DoorCommon',
    roof: 'Pset_RoofCommon',
    slab: 'Pset_SlabCommon',
    stair: 'Pset_StairCommon',
    wall: 'Pset_WallCommon',
    window: 'Pset_WindowCommon',
    zone: 'Pset_SpaceCommon',
  }
  return names[node.type] ?? null
}

function metadataPsets(node: AnyNode): Record<string, Record<string, string | number | boolean>> {
  const raw = metadataRecord(node).properties
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const psets: Record<string, Record<string, string | number | boolean>> = {}
  for (const [psetName, values] of Object.entries(raw)) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue
    const properties: Record<string, string | number | boolean> = {}
    for (const [name, value] of Object.entries(values)) {
      if (typeof value === 'string' || typeof value === 'boolean') properties[name] = value
      else if (typeof value === 'number' && Number.isFinite(value)) properties[name] = value
    }
    if (Object.keys(properties).length > 0) psets[psetName] = properties
  }
  return psets
}

function addPropertyValue(
  builder: StepBuilder,
  name: string,
  value: string | number | boolean,
): StepId {
  const nominalValue =
    typeof value === 'boolean'
      ? `IFCBOOLEAN(${value ? enumValue('T') : enumValue('F')})`
      : typeof value === 'number'
        ? `IFCREAL(${stepNumber(value)})`
        : `IFCTEXT(${stepString(value)})`
  return builder.add('IFCPROPERTYSINGLEVALUE', [stepString(name), '$', nominalValue, '$'])
}

function addPropertySets(
  builder: StepBuilder,
  ownerHistoryId: StepId,
  node: AnyNode,
  entityId: StepId,
): void {
  const psets = metadataPsets(node)
  const commonName = commonPsetName(node)
  if (commonName) {
    psets[commonName] = { Reference: node.id, ...(psets[commonName] ?? {}) }
    if (node.type === 'wall' && (node.frontSide !== 'unknown' || node.backSide !== 'unknown')) {
      psets[commonName].IsExternal = node.frontSide === 'exterior' || node.backSide === 'exterior'
    }
  }

  for (const [psetName, properties] of Object.entries(psets).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const propertyIds = Object.entries(properties)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => addPropertyValue(builder, name, value))
    if (propertyIds.length === 0) continue
    const propertySetId = builder.add('IFCPROPERTYSET', [
      stepString(ifcGuid(`pset:${node.id}:${psetName}`)),
      ref(ownerHistoryId),
      stepString(psetName),
      '$',
      refs(propertyIds),
    ])
    builder.add('IFCRELDEFINESBYPROPERTIES', [
      stepString(ifcGuid(`pset-rel:${node.id}:${psetName}`)),
      ref(ownerHistoryId),
      '$',
      '$',
      refs([entityId]),
      ref(propertySetId),
    ])
  }
}

function materialRefs(node: AnyNode): string[] {
  const record = node as unknown as Record<string, unknown>
  const values: string[] = []
  const slots = record.slots
  if (slots && typeof slots === 'object' && !Array.isArray(slots)) {
    for (const value of Object.values(slots)) {
      if (typeof value === 'string' && value) values.push(value)
    }
  }
  for (const key of [
    'materialPreset',
    'interiorMaterialPreset',
    'exteriorMaterialPreset',
    'topMaterialPreset',
    'edgeMaterialPreset',
    'wallMaterialPreset',
    'treadMaterialPreset',
    'sideMaterialPreset',
    'railingMaterialPreset',
  ]) {
    const value = record[key]
    if (typeof value === 'string' && value) values.push(value)
  }
  return [...new Set(values)]
}

function materialName(scene: IfcExportScene, node: AnyNode): string | null {
  const refsForNode = materialRefs(node)
  const selected = refsForNode[0]
  if (selected) {
    const parsed = parseMaterialRef(selected)
    if (parsed?.kind === 'library') return getCatalogMaterialById(parsed.id)?.label ?? parsed.id
    if (parsed?.kind === 'scene') {
      return scene.materials?.[parsed.id as SceneMaterialId]?.name ?? parsed.id
    }
    return selected
  }

  const inline = (node as unknown as { material?: unknown }).material
  if (inline && typeof inline === 'object' && !Array.isArray(inline)) {
    const material = inline as Record<string, unknown>
    if (typeof material.id === 'string') return material.id
    if (typeof material.preset === 'string') return material.preset
    const properties = material.properties
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
      const color = (properties as Record<string, unknown>).color
      if (typeof color === 'string') return `Custom ${color}`
    }
    return 'Custom material'
  }

  const importedName = metadataRecord(node).material
  return typeof importedName === 'string' && importedName ? importedName : null
}

function addMaterialAssociation(
  builder: StepBuilder,
  ownerHistoryId: StepId,
  scene: IfcExportScene,
  node: AnyNode,
  entityId: StepId,
  materialIds: Map<string, StepId>,
  warn: (warning: IfcExportWarning) => void,
): void {
  const nodeMaterialRefs = materialRefs(node)
  if (nodeMaterialRefs.length > 1) {
    warn({
      code: 'material-simplified',
      message: 'IFC4 MVP assigns the first Pascal surface material to the whole element.',
      nodeId: node.id,
    })
  }
  const name = materialName(scene, node)
  if (!name) return
  let materialId = materialIds.get(name)
  if (!materialId) {
    materialId = builder.add('IFCMATERIAL', [stepString(name), '$', '$'])
    materialIds.set(name, materialId)
  }
  builder.add('IFCRELASSOCIATESMATERIAL', [
    stepString(ifcGuid(`material-rel:${node.id}:${name}`)),
    ref(ownerHistoryId),
    '$',
    '$',
    refs([entityId]),
    ref(materialId),
  ])
}

function addElementMetadata(
  builder: StepBuilder,
  ownerHistoryId: StepId,
  scene: IfcExportScene,
  node: AnyNode,
  entityId: StepId,
  materialIds: Map<string, StepId>,
  warn: (warning: IfcExportWarning) => void,
): void {
  addPropertySets(builder, ownerHistoryId, node, entityId)
  addMaterialAssociation(builder, ownerHistoryId, scene, node, entityId, materialIds, warn)
}

function elementArgs(
  node: AnyNode,
  ownerHistoryId: StepId,
  placementId: StepId,
  representationId: StepId | null,
  predefinedType: string,
): string[] {
  return [
    stepString(nodeGuid(node)),
    ref(ownerHistoryId),
    stepString(nodeName(node, node.type)),
    '$',
    '$',
    ref(placementId),
    ref(representationId),
    stepString(node.id),
    enumValue(predefinedType),
  ]
}

function levelForNode(
  scene: IfcExportScene,
  node: AnyNode,
  levelRecords: Map<string, LevelExportRecord>,
  fallback: LevelExportRecord,
): LevelExportRecord {
  const level = findParentOfType(scene, node, 'level')
  return (level && levelRecords.get(level.id)) || fallback
}

function wallBaseElevation(scene: IfcExportScene, wall: WallNode): number {
  let base = wall.supportOffset ?? 0
  if (wall.supportSlabId && wall.supportSlabId !== 'ground') {
    const support = scene.nodes[wall.supportSlabId as AnyNodeId]
    if (support?.type === 'slab') base += support.elevation ?? 0.05
  }
  return base
}

function exportWall(
  builder: StepBuilder,
  contextId: StepId,
  ownerHistoryId: StepId,
  scene: IfcExportScene,
  wall: WallNode,
  level: LevelExportRecord,
  warn: (warning: IfcExportWarning) => void,
): ExportedElement | null {
  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dy)
  const thickness = wall.thickness ?? DEFAULT_WALL_THICKNESS
  const base = wallBaseElevation(scene, wall)
  const planeTop = wall.parentId ? getWallPlaneTop(wall, level.key, scene.nodes) : level.height
  const height = resolveWallEffectiveHeight(wall, planeTop, base)
  if (Math.min(length, thickness, height) <= MIN_GEOMETRY_SIZE) {
    warn({ code: 'invalid-geometry', message: 'Wall has no exportable solid.', nodeId: wall.id })
    return null
  }
  if (Math.abs(wall.curveOffset ?? 0) > MIN_GEOMETRY_SIZE) {
    warn({
      code: 'approximated-geometry',
      message: 'Curved wall was exported as its straight chord.',
      nodeId: wall.id,
    })
  }

  const placementId = addLocalPlacement(
    builder,
    level.placementId,
    [wall.start[0], wall.start[1], base],
    [0, 0, 1],
    [dx / length, dy / length, 0],
  )
  const representationId = addPolygonBody(
    builder,
    contextId,
    [
      [0, -thickness / 2],
      [length, -thickness / 2],
      [length, thickness / 2],
      [0, thickness / 2],
    ],
    [],
    height,
  )
  const entityId = builder.add(
    'IFCWALL',
    elementArgs(wall, ownerHistoryId, placementId, representationId, 'STANDARD'),
  )
  return { entityId, levelKey: level.key, placementId }
}

function exportSlab(
  builder: StepBuilder,
  contextId: StepId,
  ownerHistoryId: StepId,
  slab: SlabNode,
  level: LevelExportRecord,
  warn: (warning: IfcExportWarning) => void,
): ExportedElement {
  const thickness = slab.thickness ?? 0.05
  const base = (slab.elevation ?? 0.05) - thickness
  const placementId = addLocalPlacement(builder, level.placementId, [0, 0, base])
  let representationId: StepId | null = null
  if (slab.recessed) {
    warn({
      code: 'semantic-only',
      message: 'Recessed slab was exported without solid geometry.',
      nodeId: slab.id,
    })
  } else {
    representationId = addPolygonBody(builder, contextId, slab.polygon, slab.holes ?? [], thickness)
  }
  if (!representationId && !slab.recessed) {
    warn({ code: 'invalid-geometry', message: 'Slab has no exportable solid.', nodeId: slab.id })
  }
  const entityId = builder.add(
    'IFCSLAB',
    elementArgs(slab, ownerHistoryId, placementId, representationId, 'FLOOR'),
  )
  return { entityId, levelKey: level.key, placementId }
}

function exportCeiling(
  builder: StepBuilder,
  contextId: StepId,
  ownerHistoryId: StepId,
  scene: IfcExportScene,
  ceiling: CeilingNode,
  level: LevelExportRecord,
  ceilingThickness: number,
  warn: (warning: IfcExportWarning) => void,
): ExportedElement {
  const height = resolveCeilingHeight(ceiling, scene.nodes)
  const placementId = addLocalPlacement(builder, level.placementId, [
    0,
    0,
    height - ceilingThickness,
  ])
  const representationId = addPolygonBody(
    builder,
    contextId,
    ceiling.polygon,
    ceiling.holes ?? [],
    ceilingThickness,
  )
  if (!representationId) {
    warn({
      code: 'invalid-geometry',
      message: 'Ceiling has no exportable solid.',
      nodeId: ceiling.id,
    })
  }
  const entityId = builder.add(
    'IFCCOVERING',
    elementArgs(ceiling, ownerHistoryId, placementId, representationId, 'CEILING'),
  )
  return { entityId, levelKey: level.key, placementId }
}

function exportColumn(
  builder: StepBuilder,
  contextId: StepId,
  ownerHistoryId: StepId,
  column: ColumnNode,
  level: LevelExportRecord,
  warn: (warning: IfcExportWarning) => void,
): ExportedElement {
  const angle = column.rotation ?? 0
  const placementId = addLocalPlacement(
    builder,
    level.placementId,
    [column.position[0], column.position[2], column.position[1]],
    [0, 0, 1],
    [Math.cos(angle), -Math.sin(angle), 0],
  )
  const profileId =
    column.crossSection === 'round'
      ? addCircleProfile(builder, column.radius)
      : addRectangleProfile(builder, column.width, column.depth)
  const representationId =
    column.height > MIN_GEOMETRY_SIZE
      ? addProductShape(builder, contextId, [addExtrudedSolid(builder, profileId, column.height)])
      : null
  if (!representationId) {
    warn({
      code: 'invalid-geometry',
      message: 'Column has no exportable solid.',
      nodeId: column.id,
    })
  }
  if (!['round', 'square', 'rectangular'].includes(column.crossSection)) {
    warn({
      code: 'approximated-geometry',
      message: 'Faceted column cross-section was exported as a rectangle.',
      nodeId: column.id,
    })
  }
  const entityId = builder.add(
    'IFCCOLUMN',
    elementArgs(column, ownerHistoryId, placementId, representationId, 'COLUMN'),
  )
  return { entityId, levelKey: level.key, placementId }
}

function rotateXZ(x: number, z: number, angle: number): Point2 {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [x * cos + z * sin, -x * sin + z * cos]
}

function roofPredefinedType(segments: readonly RoofSegmentNode[]): string {
  const types = new Set(segments.map((segment) => segment.roofType))
  if (types.size !== 1) return 'NOTDEFINED'
  const type = types.values().next().value
  const mapping: Record<RoofSegmentNode['roofType'], string> = {
    dutch: 'HIPPED_GABLE_ROOF',
    flat: 'FLAT_ROOF',
    gable: 'GABLE_ROOF',
    gambrel: 'GAMBREL_ROOF',
    hip: 'HIP_ROOF',
    mansard: 'MANSARD_ROOF',
    shed: 'SHED_ROOF',
  }
  return type ? mapping[type] : 'NOTDEFINED'
}

function exportRoof(
  builder: StepBuilder,
  contextId: StepId,
  ownerHistoryId: StepId,
  scene: IfcExportScene,
  roof: RoofNode,
  level: LevelExportRecord,
  warn: (warning: IfcExportWarning) => void,
): ExportedElement {
  const position = roof.position
  const angle = roof.rotation ?? 0
  const placementId = addLocalPlacement(
    builder,
    level.placementId,
    [position[0], position[2], position[1]],
    [0, 0, 1],
    [Math.cos(angle), -Math.sin(angle), 0],
  )
  const segments = (roof.children ?? [])
    .map((childId) => scene.nodes[childId as AnyNodeId])
    .filter(
      (node): node is RoofSegmentNode => node?.type === 'roof-segment' && node.visible !== false,
    )
  const faceSetIds: StepId[] = []

  for (const segment of segments) {
    if (
      Math.min(segment.width, segment.depth) <= MIN_GEOMETRY_SIZE ||
      segment.wallHeight + getActiveRoofHeight(segment) <= MIN_GEOMETRY_SIZE
    ) {
      warn({
        code: 'invalid-geometry',
        message: 'Roof segment has no exportable volume.',
        nodeId: segment.id,
      })
      continue
    }
    const activeRoofHeight = getActiveRoofHeight(segment)
    const tanTheta =
      segment.roofType === 'flat' || segment.pitch <= 0
        ? 0
        : Math.tan((segment.pitch * Math.PI) / 180)
    const shapeRatios = getRoofShapeRatios({
      dutchGabletRake: segment.dutchGabletRake,
      dutchHipHeightRatio: segment.dutchHipHeightRatio,
      dutchHipWidthRatio: segment.dutchHipWidthRatio,
      dutchWaistLengthRatio: segment.dutchWaistLengthRatio,
      gambrelLowerWidthRatio: segment.gambrelLowerWidthRatio,
      mansardSteepWidthRatio: segment.mansardSteepWidthRatio,
    })
    const segmentRotation = segment.rotation ?? 0
    const faces = getRoofModuleFaces({
      type: segment.roofType,
      w: segment.width,
      d: segment.depth,
      wh: segment.wallHeight,
      rh: activeRoofHeight,
      baseY: 0,
      insets: {},
      baseW: segment.width,
      baseD: segment.depth,
      tanTheta,
      shapeRatios,
      dutchTopRakeThickness: segment.dutchTopRakeThickness,
    }).map((face) =>
      face.map((point): Vec3 => {
        const [x, z] = rotateXZ(point.x, point.z, segmentRotation)
        return [segment.position[0] + x, segment.position[2] + z, segment.position[1] + point.y]
      }),
    )
    const faceSetId = addTriangulatedFaceSet(builder, faces)
    if (faceSetId) faceSetIds.push(faceSetId)
  }

  const representationId = addProductShape(builder, contextId, faceSetIds, 'Tessellation')
  const entityId = builder.add(
    'IFCROOF',
    elementArgs(roof, ownerHistoryId, placementId, representationId, roofPredefinedType(segments)),
  )
  if (!representationId) {
    warn({
      code: 'semantic-only',
      message: 'Roof hierarchy was exported without geometry because it has no valid segments.',
      nodeId: roof.id,
    })
  } else {
    warn({
      code: 'approximated-geometry',
      message: 'Roof layers, overhangs, trims, and segment unions were simplified to solid shells.',
      nodeId: roof.id,
    })
  }
  return { entityId, levelKey: level.key, placementId }
}

function addStraightStairSolids(
  builder: StepBuilder,
  scene: IfcExportScene,
  stair: StairNode,
): StepId[] {
  const segments = (stair.children ?? [])
    .map((childId) => scene.nodes[childId as AnyNodeId])
    .filter(
      (node): node is StairSegmentNode => node?.type === 'stair-segment' && node.visible !== false,
    )
  const transforms = computeStairSegmentTransforms(segments)
  const solidIds: StepId[] = []

  segments.forEach((segment, segmentIndex) => {
    const transform = transforms[segmentIndex]
    if (!transform || Math.min(segment.width, segment.length) <= MIN_GEOMETRY_SIZE) return
    const segmentAngle = transform.rotation
    const referenceDirection: Vec3 = [Math.cos(segmentAngle), -Math.sin(segmentAngle), 0]

    if (segment.segmentType === 'landing') {
      const top = transform.position[1]
      const thickness = Math.max(segment.thickness ?? 0.25, 0.02)
      const bottom = segment.fillToFloor && top > MIN_GEOMETRY_SIZE ? 0 : top - thickness
      const [offsetX, offsetZ] = rotateXZ(0, segment.length / 2, segmentAngle)
      const profileId = addRectangleProfile(builder, segment.width, segment.length)
      solidIds.push(
        addExtrudedSolid(
          builder,
          profileId,
          top - bottom,
          [transform.position[0] + offsetX, transform.position[2] + offsetZ, bottom],
          [0, 0, 1],
          referenceDirection,
        ),
      )
      return
    }

    const stepCount = Math.max(1, Math.round(segment.stepCount))
    const stepDepth = segment.length / stepCount
    const riserHeight = segment.height / stepCount
    if (Math.min(stepDepth, riserHeight) <= MIN_GEOMETRY_SIZE) return
    const profileId = addRectangleProfile(builder, segment.width, stepDepth)
    const thickness = Math.max(segment.thickness ?? 0.25, 0.02)
    for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
      const top = transform.position[1] + riserHeight * (stepIndex + 1)
      const bottom = segment.fillToFloor ? 0 : Math.max(transform.position[1], top - thickness)
      const [offsetX, offsetZ] = rotateXZ(0, stepDepth * stepIndex + stepDepth / 2, segmentAngle)
      solidIds.push(
        addExtrudedSolid(
          builder,
          profileId,
          top - bottom,
          [transform.position[0] + offsetX, transform.position[2] + offsetZ, bottom],
          [0, 0, 1],
          referenceDirection,
        ),
      )
    }
  })

  return solidIds
}

function annularSectorPoints(
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
): Point2[] {
  const segmentCount = Math.max(2, Math.ceil(Math.abs(endAngle - startAngle) / (Math.PI / 18)))
  const outer: Point2[] = []
  const inner: Point2[] = []
  for (let index = 0; index <= segmentCount; index += 1) {
    const angle = startAngle + ((endAngle - startAngle) * index) / segmentCount
    outer.push([Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius])
  }
  for (let index = segmentCount; index >= 0; index -= 1) {
    const angle = startAngle + ((endAngle - startAngle) * index) / segmentCount
    inner.push([Math.cos(angle) * innerRadius, Math.sin(angle) * innerRadius])
  }
  return [...outer, ...inner]
}

function addArcStairSolids(
  builder: StepBuilder,
  scene: IfcExportScene,
  stair: StairNode,
): StepId[] {
  const isSpiral = stair.stairType === 'spiral'
  const stepCount = Math.max(2, Math.round(stair.stepCount ?? 10))
  const totalRise = Math.max(resolveStairTotalRise(stair, scene.nodes), 0.1)
  const stepHeight = totalRise / stepCount
  const innerRadius = Math.max(isSpiral ? 0.05 : 0.2, stair.innerRadius ?? 0.9)
  const outerRadius = innerRadius + Math.max(stair.width ?? 1, 0.4)
  const sweepAngle = stair.sweepAngle ?? (isSpiral ? Math.PI * 2 : Math.PI / 2)
  const stepSweep = sweepAngle / stepCount
  const thickness = Math.max(stair.thickness ?? 0.25, 0.02)
  const fillToFloor = stair.fillToFloor ?? true
  const solidIds: StepId[] = []

  for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
    const currentHeight = stepHeight * (stepIndex + 1)
    const top = isSpiral ? stepHeight * stepIndex + thickness : currentHeight
    const bottom = isSpiral
      ? stepHeight * stepIndex
      : fillToFloor
        ? 0
        : Math.max(currentHeight - thickness, 0)
    const startAngle = -sweepAngle / 2 + stepSweep * stepIndex
    const endAngle = startAngle + stepSweep
    const profileId = addPolygonProfile(
      builder,
      annularSectorPoints(innerRadius, outerRadius, startAngle, endAngle),
    )
    if (!profileId || top - bottom <= MIN_GEOMETRY_SIZE) continue
    solidIds.push(addExtrudedSolid(builder, profileId, top - bottom, [0, 0, bottom]))
  }

  if (isSpiral && (stair.showCenterColumn ?? true)) {
    const columnRadius = Math.max(0.05, Math.min(innerRadius * 0.72, innerRadius - 0.03))
    const profileId = addCircleProfile(builder, columnRadius)
    solidIds.push(addExtrudedSolid(builder, profileId, totalRise + thickness))
  }

  if (isSpiral && (stair.topLandingMode ?? 'none') === 'integrated') {
    const landingDepth = Math.max(
      0.3,
      stair.topLandingDepth ?? Math.max((stair.width ?? 1) * 0.9, 0.8),
    )
    const landingSweep =
      Math.min(Math.PI * 0.75, landingDepth / Math.max(innerRadius + (stair.width ?? 1) / 2, 0.1)) *
      Math.sign(sweepAngle || 1)
    const lastStepTop = stepHeight * Math.max(stepCount - 1, 0) + thickness
    const landingThickness = Math.max(0.02, totalRise - lastStepTop)
    const profileId = addPolygonProfile(
      builder,
      annularSectorPoints(innerRadius, outerRadius, sweepAngle / 2, sweepAngle / 2 + landingSweep),
    )
    if (profileId) {
      solidIds.push(addExtrudedSolid(builder, profileId, landingThickness, [0, 0, lastStepTop]))
    }
  }

  return solidIds
}

function stairPredefinedType(stair: StairNode): string {
  if (stair.stairType === 'spiral') return 'SPIRAL_STAIR'
  if (stair.stairType === 'curved') return 'CURVED_RUN_STAIR'
  return 'STRAIGHT_RUN_STAIR'
}

function exportStair(
  builder: StepBuilder,
  contextId: StepId,
  ownerHistoryId: StepId,
  scene: IfcExportScene,
  stair: StairNode,
  level: LevelExportRecord,
  warn: (warning: IfcExportWarning) => void,
): ExportedElement {
  const angle = stair.rotation ?? 0
  const placementId = addLocalPlacement(
    builder,
    level.placementId,
    [stair.position[0], stair.position[2], stair.position[1]],
    [0, 0, 1],
    [Math.cos(angle), -Math.sin(angle), 0],
  )
  const solidIds =
    stair.stairType === 'curved' || stair.stairType === 'spiral'
      ? addArcStairSolids(builder, scene, stair)
      : addStraightStairSolids(builder, scene, stair)
  const representationId = addProductShape(builder, contextId, solidIds)
  const entityId = builder.add(
    'IFCSTAIR',
    elementArgs(stair, ownerHistoryId, placementId, representationId, stairPredefinedType(stair)),
  )
  if (!representationId) {
    warn({
      code: 'semantic-only',
      message: 'Stair hierarchy was exported without geometry because it has no valid body.',
      nodeId: stair.id,
    })
  }
  if ((stair.railingMode ?? 'none') !== 'none') {
    warn({
      code: 'approximated-geometry',
      message: 'Stair railings are not represented in the IFC4 MVP geometry.',
      nodeId: stair.id,
    })
  }
  if (stair.stairType === 'spiral' && (stair.showStepSupports ?? true)) {
    warn({
      code: 'approximated-geometry',
      message: 'Spiral stair step supports are not represented in the IFC4 MVP geometry.',
      nodeId: stair.id,
    })
  }
  return { entityId, levelKey: level.key, placementId }
}

function exportFlowSegment(
  builder: StepBuilder,
  contextId: StepId,
  ownerHistoryId: StepId,
  node: DuctSegmentNode | PipeSegmentNode,
  level: LevelExportRecord,
  warn: (warning: IfcExportWarning) => void,
): ExportedElement {
  const placementId = addLocalPlacement(builder, level.placementId)
  const solidIds: StepId[] = []
  for (let index = 1; index < node.path.length; index++) {
    const start = node.path[index - 1]
    const end = node.path[index]
    const delta: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]]
    const length = Math.hypot(delta[0], delta[1], delta[2])
    if (length <= MIN_GEOMETRY_SIZE) continue
    const axis = normalizeVector(pascalVectorToIfc(delta))
    const helper: Vec3 = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]
    const referenceDirection = normalizeVector(cross(helper, axis))
    let profileId: StepId
    if (node.type === 'pipe-segment' || node.shape === 'round') {
      profileId = addCircleProfile(builder, (node.diameter * INCH_TO_METRE) / 2)
    } else if (node.shape === 'rect') {
      profileId = addRectangleProfile(
        builder,
        node.width * INCH_TO_METRE,
        node.height * INCH_TO_METRE,
      )
    } else {
      profileId = addCircleProfile(builder, (node.height * INCH_TO_METRE) / 2)
      warn({
        code: 'approximated-geometry',
        message: 'Oval duct was exported with a circular profile.',
        nodeId: node.id,
      })
    }
    solidIds.push(
      addExtrudedSolid(
        builder,
        profileId,
        length,
        [start[0], start[2], start[1]],
        axis,
        referenceDirection,
      ),
    )
  }
  if (node.type === 'duct-segment' && Math.abs(node.roll) > MIN_GEOMETRY_SIZE) {
    warn({
      code: 'approximated-geometry',
      message: 'Duct roll is not represented in the IFC4 MVP geometry.',
      nodeId: node.id,
    })
  }
  const representationId = addProductShape(builder, contextId, solidIds)
  if (!representationId) {
    warn({
      code: 'invalid-geometry',
      message: 'Flow segment has no exportable path.',
      nodeId: node.id,
    })
  }
  const entityId = builder.add(
    node.type === 'duct-segment' ? 'IFCDUCTSEGMENT' : 'IFCPIPESEGMENT',
    elementArgs(node, ownerHistoryId, placementId, representationId, 'RIGIDSEGMENT'),
  )
  return { entityId, levelKey: level.key, placementId }
}

function exportOpening(
  builder: StepBuilder,
  contextId: StepId,
  ownerHistoryId: StepId,
  scene: IfcExportScene,
  node: DoorNode | WindowNode,
  level: LevelExportRecord,
  exportedWalls: Map<string, ExportedElement>,
  warn: (warning: IfcExportWarning) => void,
): ExportedElement {
  const hostId = node.wallId ?? node.parentId
  const host = hostId ? scene.nodes[hostId as AnyNodeId] : undefined
  const exportedHost = hostId ? exportedWalls.get(hostId) : undefined
  const hostWall = host?.type === 'wall' ? host : null
  const hostThickness = hostWall?.thickness ?? DEFAULT_WALL_THICKNESS
  const bottom = node.position[1] - node.height / 2
  const location: Vec3 = [node.position[0], node.position[2], bottom]
  const parentPlacementId = exportedHost?.placementId ?? level.placementId
  if (!exportedHost) {
    warn({
      code: 'missing-host',
      message: 'Opening host wall was not exportable; the element was placed on its storey.',
      nodeId: node.id,
    })
  }

  const openingPlacementId = addLocalPlacement(builder, parentPlacementId, location)
  const openingRepresentationId = addRectangleBody(
    builder,
    contextId,
    node.width,
    hostThickness * 1.02,
    node.height,
  )
  const openingId = builder.add('IFCOPENINGELEMENT', [
    stepString(nodeGuid(node, 'opening')),
    ref(ownerHistoryId),
    stepString(`${nodeName(node, node.type)} opening`),
    '$',
    '$',
    ref(openingPlacementId),
    ref(openingRepresentationId),
    '$',
  ])

  const placementId = addLocalPlacement(builder, parentPlacementId, location)
  const representationId = addRectangleBody(
    builder,
    contextId,
    node.width,
    Math.max(hostThickness * 0.25, 0.04),
    node.height,
  )
  const args = [
    stepString(nodeGuid(node)),
    ref(ownerHistoryId),
    stepString(nodeName(node, node.type)),
    '$',
    '$',
    ref(placementId),
    ref(representationId),
    stepString(node.id),
    stepNumber(node.height),
    stepNumber(node.width),
    enumValue(node.type === 'door' ? 'DOOR' : 'WINDOW'),
    enumValue('NOTDEFINED'),
    '$',
  ]
  const entityId = builder.add(node.type === 'door' ? 'IFCDOOR' : 'IFCWINDOW', args)

  if (exportedHost) {
    builder.add('IFCRELVOIDSELEMENT', [
      stepString(ifcGuid(`void:${hostId}:${node.id}`)),
      ref(ownerHistoryId),
      '$',
      '$',
      ref(exportedHost.entityId),
      ref(openingId),
    ])
    builder.add('IFCRELFILLSELEMENT', [
      stepString(ifcGuid(`fill:${hostId}:${node.id}`)),
      ref(ownerHistoryId),
      '$',
      '$',
      ref(openingId),
      ref(entityId),
    ])
  }

  return { entityId, levelKey: level.key, placementId }
}

function exportZone(
  builder: StepBuilder,
  contextId: StepId,
  ownerHistoryId: StepId,
  zone: ZoneNode,
  level: LevelExportRecord,
  warn: (warning: IfcExportWarning) => void,
): ExportedElement {
  const placementId = addLocalPlacement(builder, level.placementId)
  const representationId = addPolygonBody(builder, contextId, zone.polygon, [], zone.ceilingHeight)
  if (!representationId) {
    warn({ code: 'invalid-geometry', message: 'Zone has no exportable solid.', nodeId: zone.id })
  }
  const entityId = builder.add('IFCSPACE', [
    stepString(nodeGuid(zone)),
    ref(ownerHistoryId),
    stepString(nodeName(zone, 'Space')),
    '$',
    '$',
    ref(placementId),
    ref(representationId),
    zone.roomNumber ? stepString(zone.roomNumber) : '$',
    enumValue('ELEMENT'),
    enumValue(zone.spaceRole === 'room' ? 'INTERNAL' : 'NOTDEFINED'),
    stepNumber(0),
  ])
  return { entityId, levelKey: level.key, placementId }
}

export function convertPascalToIfcText(
  scene: IfcExportScene,
  options: IfcExportOptions = {},
): string {
  const resolvedOptions = {
    ...options,
    applicationName: options.applicationName ?? 'Pascal IFC Exporter',
    applicationVersion: options.applicationVersion ?? '1.0',
    ceilingThickness: options.ceilingThickness ?? 0.02,
    fileName: options.fileName ?? 'pascal-export.ifc',
    organization: options.organization ?? 'Pascal',
    projectName: options.projectName ?? 'Pascal Project',
  }
  if (resolvedOptions.ceilingThickness <= MIN_GEOMETRY_SIZE) {
    throw new Error('IFC export ceilingThickness must be greater than zero.')
  }
  const date = normalizeDate(options.timestamp)
  const warn = (warning: IfcExportWarning) => resolvedOptions.onWarning?.(warning)
  const builder = new StepBuilder()

  const personId = builder.add('IFCPERSON', [
    '$',
    '$',
    stepString(options.author ?? 'Pascal User'),
    '$',
    '$',
    '$',
    '$',
    '$',
  ])
  const organizationId = builder.add('IFCORGANIZATION', [
    '$',
    stepString(resolvedOptions.organization),
    '$',
    '$',
    '$',
  ])
  const personOrganizationId = builder.add('IFCPERSONANDORGANIZATION', [
    ref(personId),
    ref(organizationId),
    '$',
  ])
  const applicationId = builder.add('IFCAPPLICATION', [
    ref(organizationId),
    stepString(resolvedOptions.applicationVersion),
    stepString(resolvedOptions.applicationName),
    stepString('PASCAL'),
  ])
  const ownerHistoryId = builder.add('IFCOWNERHISTORY', [
    ref(personOrganizationId),
    ref(applicationId),
    '$',
    enumValue('ADDED'),
    '$',
    '$',
    '$',
    String(Math.floor(date.getTime() / 1000)),
  ])

  const lengthUnitId = builder.add('IFCSIUNIT', [
    '*',
    enumValue('LENGTHUNIT'),
    '$',
    enumValue('METRE'),
  ])
  const areaUnitId = builder.add('IFCSIUNIT', [
    '*',
    enumValue('AREAUNIT'),
    '$',
    enumValue('SQUARE_METRE'),
  ])
  const volumeUnitId = builder.add('IFCSIUNIT', [
    '*',
    enumValue('VOLUMEUNIT'),
    '$',
    enumValue('CUBIC_METRE'),
  ])
  const angleUnitId = builder.add('IFCSIUNIT', [
    '*',
    enumValue('PLANEANGLEUNIT'),
    '$',
    enumValue('RADIAN'),
  ])
  const unitsId = builder.add('IFCUNITASSIGNMENT', [
    refs([lengthUnitId, areaUnitId, volumeUnitId, angleUnitId]),
  ])
  const contextPlacementId = addAxisPlacement(builder, [0, 0, 0])
  const contextId = builder.add('IFCGEOMETRICREPRESENTATIONCONTEXT', [
    '$',
    stepString('Model'),
    '3',
    '1.E-05',
    ref(contextPlacementId),
    '$',
  ])
  const projectId = builder.add('IFCPROJECT', [
    stepString(ifcGuid(`project:${resolvedOptions.projectName}`)),
    ref(ownerHistoryId),
    stepString(resolvedOptions.projectName),
    '$',
    '$',
    '$',
    '$',
    refs([contextId]),
    ref(unitsId),
  ])

  const allNodes = Object.values(scene.nodes).sort((left, right) => left.id.localeCompare(right.id))
  const siteNodes = allNodes.filter((node): node is SiteNode => node.type === 'site')
  const buildingNodes = allNodes.filter((node): node is BuildingNode => node.type === 'building')
  const levelNodes = allNodes.filter((node): node is LevelNode => node.type === 'level')
  const sites: SpatialRecord<SiteNode>[] =
    siteNodes.length > 0
      ? siteNodes.map((node) => ({ key: node.id, name: nodeName(node, 'Site'), node }))
      : [{ key: '__ifc_site__', name: 'Site', node: null }]
  const buildings: SpatialRecord<BuildingNode>[] =
    buildingNodes.length > 0
      ? buildingNodes.map((node) => ({ key: node.id, name: nodeName(node, 'Building'), node }))
      : [{ key: '__ifc_building__', name: 'Building', node: null }]
  const levels: SpatialRecord<LevelNode>[] =
    levelNodes.length > 0
      ? levelNodes.map((node) => ({ key: node.id, name: nodeName(node, 'Storey'), node }))
      : [{ key: '__ifc_level__', name: 'Ground Floor', node: null }]

  const siteEntityIds = new Map<string, StepId>()
  const sitePlacementIds = new Map<string, StepId>()
  for (const site of sites) {
    const placementId = addLocalPlacement(builder, null)
    const entityId = builder.add('IFCSITE', [
      stepString(site.node ? nodeGuid(site.node) : ifcGuid(site.key)),
      ref(ownerHistoryId),
      stepString(site.name),
      '$',
      '$',
      ref(placementId),
      '$',
      '$',
      enumValue('ELEMENT'),
      '$',
      '$',
      '$',
      '$',
      '$',
    ])
    siteEntityIds.set(site.key, entityId)
    sitePlacementIds.set(site.key, placementId)
  }

  const buildingEntityIds = new Map<string, StepId>()
  const buildingPlacementIds = new Map<string, StepId>()
  const buildingSiteKeys = new Map<string, string>()
  for (const building of buildings) {
    const parentSite = building.node ? findParentOfType(scene, building.node, 'site') : null
    const siteKey = parentSite?.id ?? sites[0].key
    const position = building.node?.position ?? [0, 0, 0]
    const rotation = building.node?.rotation?.[1] ?? 0
    const placementId = addLocalPlacement(
      builder,
      sitePlacementIds.get(siteKey) ?? null,
      [position[0], position[2], position[1]],
      [0, 0, 1],
      [Math.cos(rotation), -Math.sin(rotation), 0],
    )
    const entityId = builder.add('IFCBUILDING', [
      stepString(building.node ? nodeGuid(building.node) : ifcGuid(building.key)),
      ref(ownerHistoryId),
      stepString(building.name),
      '$',
      '$',
      ref(placementId),
      '$',
      '$',
      enumValue('ELEMENT'),
      '$',
      '$',
      '$',
    ])
    buildingEntityIds.set(building.key, entityId)
    buildingPlacementIds.set(building.key, placementId)
    buildingSiteKeys.set(building.key, siteKey)
  }

  const levelElevations = getLevelElevations(scene.nodes)
  const levelRecords = new Map<string, LevelExportRecord>()
  const levelBuildingKeys = new Map<string, string>()
  for (const level of levels) {
    const parentBuilding = level.node ? findParentOfType(scene, level.node, 'building') : null
    const buildingKey = parentBuilding?.id ?? buildings[0].key
    const elevation = level.node ? levelElevations.get(level.node.id) : null
    const baseY = elevation?.baseY ?? 0
    const height = elevation?.height ?? 2.5
    const placementId = addLocalPlacement(builder, buildingPlacementIds.get(buildingKey) ?? null, [
      0,
      0,
      baseY,
    ])
    const entityId = builder.add('IFCBUILDINGSTOREY', [
      stepString(level.node ? nodeGuid(level.node) : ifcGuid(level.key)),
      ref(ownerHistoryId),
      stepString(level.name),
      '$',
      '$',
      ref(placementId),
      '$',
      '$',
      enumValue('ELEMENT'),
      stepNumber(baseY),
    ])
    levelRecords.set(level.key, { ...level, baseY, entityId, height, placementId })
    levelBuildingKeys.set(level.key, buildingKey)
  }

  builder.add('IFCRELAGGREGATES', [
    stepString(ifcGuid('aggregate:project:sites')),
    ref(ownerHistoryId),
    '$',
    '$',
    ref(projectId),
    refs([...siteEntityIds.values()]),
  ])
  for (const site of sites) {
    const related = buildings
      .filter((building) => buildingSiteKeys.get(building.key) === site.key)
      .map((building) => buildingEntityIds.get(building.key)!)
    if (related.length === 0) continue
    builder.add('IFCRELAGGREGATES', [
      stepString(ifcGuid(`aggregate:site:${site.key}`)),
      ref(ownerHistoryId),
      '$',
      '$',
      ref(siteEntityIds.get(site.key)),
      refs(related),
    ])
  }
  for (const building of buildings) {
    const related = levels
      .filter((level) => levelBuildingKeys.get(level.key) === building.key)
      .map((level) => levelRecords.get(level.key)!.entityId)
    if (related.length === 0) continue
    builder.add('IFCRELAGGREGATES', [
      stepString(ifcGuid(`aggregate:building:${building.key}`)),
      ref(ownerHistoryId),
      '$',
      '$',
      ref(buildingEntityIds.get(building.key)),
      refs(related),
    ])
  }

  const fallbackLevel = levelRecords.values().next().value as LevelExportRecord
  const exportedElements = new Map<string, ExportedElement>()
  const exportedWalls = new Map<string, ExportedElement>()
  const spacesByLevel = new Map<string, StepId[]>()
  const elementsByLevel = new Map<string, StepId[]>()
  const materialIds = new Map<string, StepId>()

  const addExportedElement = (node: AnyNode, exported: ExportedElement, spatialElement = false) => {
    exportedElements.set(node.id, exported)
    const target = spatialElement ? spacesByLevel : elementsByLevel
    const ids = target.get(exported.levelKey) ?? []
    ids.push(exported.entityId)
    target.set(exported.levelKey, ids)
    addElementMetadata(builder, ownerHistoryId, scene, node, exported.entityId, materialIds, warn)
  }

  for (const node of allNodes) {
    if (node.type !== 'wall') continue
    const level = levelForNode(scene, node, levelRecords, fallbackLevel)
    const exported = exportWall(builder, contextId, ownerHistoryId, scene, node, level, warn)
    if (!exported) continue
    exportedWalls.set(node.id, exported)
    addExportedElement(node, exported)
  }

  for (const node of allNodes) {
    const level = levelForNode(scene, node, levelRecords, fallbackLevel)
    let exported: ExportedElement | null = null
    if (node.type === 'slab') {
      exported = exportSlab(builder, contextId, ownerHistoryId, node, level, warn)
    } else if (node.type === 'ceiling') {
      exported = exportCeiling(
        builder,
        contextId,
        ownerHistoryId,
        scene,
        node,
        level,
        resolvedOptions.ceilingThickness,
        warn,
      )
    } else if (node.type === 'column') {
      exported = exportColumn(builder, contextId, ownerHistoryId, node, level, warn)
    } else if (node.type === 'roof') {
      exported = exportRoof(builder, contextId, ownerHistoryId, scene, node, level, warn)
    } else if (node.type === 'stair') {
      exported = exportStair(builder, contextId, ownerHistoryId, scene, node, level, warn)
    } else if (node.type === 'duct-segment' || node.type === 'pipe-segment') {
      exported = exportFlowSegment(builder, contextId, ownerHistoryId, node, level, warn)
    } else if (node.type === 'zone') {
      exported = exportZone(builder, contextId, ownerHistoryId, node, level, warn)
      addExportedElement(node, exported, true)
      continue
    } else if (node.type === 'door' || node.type === 'window') {
      exported = exportOpening(
        builder,
        contextId,
        ownerHistoryId,
        scene,
        node,
        level,
        exportedWalls,
        warn,
      )
    }
    if (exported) addExportedElement(node, exported)
  }

  for (const level of levelRecords.values()) {
    const spaces = spacesByLevel.get(level.key) ?? []
    if (spaces.length > 0) {
      builder.add('IFCRELAGGREGATES', [
        stepString(ifcGuid(`aggregate:level:${level.key}:spaces`)),
        ref(ownerHistoryId),
        '$',
        '$',
        ref(level.entityId),
        refs(spaces),
      ])
    }
    const elements = elementsByLevel.get(level.key) ?? []
    if (elements.length > 0) {
      builder.add('IFCRELCONTAINEDINSPATIALSTRUCTURE', [
        stepString(ifcGuid(`containment:level:${level.key}`)),
        ref(ownerHistoryId),
        '$',
        '$',
        refs(elements),
        ref(level.entityId),
      ])
    }
  }

  return builder.serialize(header(resolvedOptions, date))
}

export function convertPascalToIfc(
  scene: IfcExportScene,
  options: IfcExportOptions = {},
): Uint8Array {
  return new TextEncoder().encode(convertPascalToIfcText(scene, options))
}
