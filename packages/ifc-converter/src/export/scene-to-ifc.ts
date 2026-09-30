import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  type CeilingNode,
  type ColumnNode,
  calculateLevelMiters,
  DEFAULT_WALL_THICKNESS,
  type DoorNode,
  difference,
  getLevelElevations,
  getOpeningWallCut,
  getRenderableSlabPolygon,
  getWallBodyCenterOffset,
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallFaceOffsets,
  getWallPlaneTop,
  getWallPlanFootprint,
  hidesDescendants,
  type ImportedMeshNode,
  intersection,
  isCurvedWall,
  type LevelNode,
  liftedManualSlab,
  prepareSlabPolygonContext,
  resolveCeilingHeight,
  resolveWallTop,
  type SlabNode,
  sampleWallCenterline,
  type UnitNode,
  union,
  type WallNode,
  type WindowNode,
  wallSupportForNodes,
  type ZoneNode,
} from '@pascal-app/core'
import { doorGlazingFraction, doorOperationForIfc } from './door-operation'
import {
  bool,
  cleanRing,
  DERIVED,
  enumValue,
  frameToLocal,
  IDENTITY_FRAME,
  type IfcColor,
  IfcModel,
  identifier,
  int,
  label,
  type PlanFrame,
  ratio,
  relativeFrame,
  type TriangleSet,
  type Vec2,
  type Vec3,
} from './ifc-model'
import type { StepRef, StepValue } from './step'
import { wallBaseCells, wallCellBand } from './wall-base'

/** Triangle geometry for one node, in the rendered scene's world frame (metres, Y-up). */
export interface IfcMeshPart {
  positions: ArrayLike<number>
  indices?: ArrayLike<number>
  /** sRGB components in 0..1. */
  color?: [number, number, number]
  opacity?: number
}

export interface IfcExportInput {
  nodes: Record<string, AnyNode>
  /** Rendered geometry keyed by node id; required for everything that is not a native IFC element. */
  meshes?: ReadonlyMap<string, IfcMeshPart[]>
  projectName?: string
  author?: string
  organization?: string
  /** Header and owner-history time; defaults to now. */
  timestamp?: Date
  /** Skip nodes hidden in the editor (`visible: false` on the node or an ancestor). */
  onlyVisible?: boolean
  /** Node kinds left out entirely, with their descendants. */
  excludedNodeTypes?: readonly string[]
}

export interface IfcExportSkip {
  nodeId: string
  type: string
  reason: 'no-geometry' | 'degenerate' | 'no-level'
}

export interface IfcExportSummary {
  /** Exported building elements and spaces, by IFC class. */
  elements: Record<string, number>
  skipped: IfcExportSkip[]
}

export interface IfcExportResult {
  ifc: string
  summary: IfcExportSummary
}

const NON_PHYSICAL_TYPES = new Set([
  'site',
  'building',
  'level',
  'zone',
  'unit',
  'separator',
  'guide',
  'measurement',
  'construction-dimension',
  'spawn',
  'scan',
  'structural-grid',
  'floor-opening',
])

const NATIVE_TYPES = new Set(['wall', 'slab', 'ceiling', 'column', 'door', 'window'])

const FURNISHING_TYPES = new Set(['item', 'procedural-item', 'cabinet', 'cabinet-module', 'shelf'])

// Planting from the first-party trees plugin. IFC4 has no vegetation enum
// (IFC4.3 adds VEGETATION), so it is a user-defined geographic element.
const VEGETATION_TYPES = new Set(['trees:tree', 'trees:grass', 'trees:flower'])

type ElementClass = {
  entity: string
  /** Required by IFC when PredefinedType is USERDEFINED. */
  objectType?: string
  /** Attribute values after Representation, given the element's Tag. */
  tail: (tag: string, node: AnyNode | undefined) => StepValue[]
}

const withPredefined =
  (entity: string, predefined = 'NOTDEFINED'): ElementClass['tail'] =>
  (tag, node) => {
    const source = node ? (node.metadata as Record<string, unknown> | undefined) : undefined
    const sourceType = source?.predefinedType
    // Keep an imported element's own IFC enum when it round-trips to the same class.
    const value =
      typeof sourceType === 'string' &&
      /^[A-Z_]+$/.test(sourceType) &&
      sourceType !== 'USERDEFINED' &&
      String(source?.ifcType ?? '').startsWith(entity)
        ? sourceType
        : predefined
    return [tag, enumValue(value)]
  }

const PROXY: ElementClass = {
  entity: 'IFCBUILDINGELEMENTPROXY',
  tail: withPredefined('IFCBUILDINGELEMENTPROXY'),
}
const FURNISHING: ElementClass = { entity: 'IFCFURNISHINGELEMENT', tail: (tag) => [tag] }
const VEGETATION: ElementClass = {
  entity: 'IFCGEOGRAPHICELEMENT',
  tail: (tag) => [tag, enumValue('USERDEFINED')],
  objectType: 'Vegetation',
}
const ROOF_SLAB: ElementClass = { entity: 'IFCSLAB', tail: (tag) => [tag, enumValue('ROOF')] }
const STAIR_FLIGHT: ElementClass = {
  entity: 'IFCSTAIRFLIGHT',
  tail: (tag) => [tag, null, null, null, null, enumValue('NOTDEFINED')],
}

/** IFC classes an imported mesh may keep on export; others become proxies. */
const IMPORTED_CLASSES: Record<string, ElementClass> = {
  IFCBEAM: { entity: 'IFCBEAM', tail: withPredefined('IFCBEAM') },
  IFCBEAMSTANDARDCASE: { entity: 'IFCBEAM', tail: withPredefined('IFCBEAM') },
  IFCRAILING: { entity: 'IFCRAILING', tail: withPredefined('IFCRAILING') },
  IFCCOVERING: { entity: 'IFCCOVERING', tail: withPredefined('IFCCOVERING') },
  IFCCURTAINWALL: { entity: 'IFCCURTAINWALL', tail: withPredefined('IFCCURTAINWALL') },
  IFCPLATE: { entity: 'IFCPLATE', tail: withPredefined('IFCPLATE') },
  IFCMEMBER: { entity: 'IFCMEMBER', tail: withPredefined('IFCMEMBER') },
  IFCFOOTING: { entity: 'IFCFOOTING', tail: withPredefined('IFCFOOTING') },
  IFCSTAIRFLIGHT: STAIR_FLIGHT,
  IFCFURNISHINGELEMENT: FURNISHING,
  IFCBUILDINGELEMENTPROXY: PROXY,
  IFCWALL: { entity: 'IFCWALL', tail: withPredefined('IFCWALL') },
  IFCWALLSTANDARDCASE: { entity: 'IFCWALL', tail: withPredefined('IFCWALL') },
  IFCSLAB: { entity: 'IFCSLAB', tail: withPredefined('IFCSLAB') },
}

function meshClassFor(node: AnyNode): ElementClass {
  if (node.type === 'imported-mesh' || node.type === 'block') {
    const ifcType = (node.metadata as Record<string, unknown> | undefined)?.ifcType
    const known = typeof ifcType === 'string' ? IMPORTED_CLASSES[ifcType] : undefined
    if (known) return known
  }
  if (FURNISHING_TYPES.has(node.type)) return FURNISHING
  if (VEGETATION_TYPES.has(node.type)) return VEGETATION
  switch (node.type as string) {
    case 'fence':
      return { entity: 'IFCRAILING', tail: (tag) => [tag, enumValue('NOTDEFINED')] }
    case 'curtain-wall':
      return { entity: 'IFCCURTAINWALL', tail: (tag) => [tag, enumValue('NOTDEFINED')] }
    case 'skylight':
      return {
        entity: 'IFCWINDOW',
        tail: (tag) => [tag, null, null, enumValue('SKYLIGHT'), enumValue('NOTDEFINED'), null],
      }
    case 'column':
      return { entity: 'IFCCOLUMN', tail: (tag) => [tag, enumValue('COLUMN')] }
    case 'slab':
      return { entity: 'IFCSLAB', tail: (tag) => [tag, enumValue('FLOOR')] }
    case 'door':
      return {
        entity: 'IFCDOOR',
        tail: (tag, node) => {
          const door = node as DoorNode
          const operation = doorOperationForIfc(door)
          return [
            tag,
            door.height,
            door.width,
            enumValue('DOOR'),
            enumValue(operation.operationType),
            operation.userDefined ?? null,
          ]
        },
      }
    case 'window':
      return {
        entity: 'IFCWINDOW',
        tail: (tag, node) => [
          tag,
          (node as WindowNode).height,
          (node as WindowNode).width,
          enumValue('WINDOW'),
          enumValue('NOTDEFINED'),
          null,
        ],
      }
    default:
      return PROXY
  }
}

// Pascal is Y-up with plan axes (x, z); IFC is Z-up. Seen from above, Pascal
// +z is IFC -Y — the exact inverse of the importer's `worldToScene`.
const planToIfc = (x: number, z: number): Vec2 => [x, -z]
const localToIfc = (p: readonly number[]): Vec3 => [p[0]!, -p[2]!, p[1]!]

function hexToRgb(hex: string): [number, number, number] | undefined {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!match) return undefined
  const value = Number.parseInt(match[1]!, 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

function eulerXYZ(rotation: readonly number[]): (p: Vec3) => Vec3 {
  const [a, b, c] = rotation
  const ca = Math.cos(a ?? 0)
  const sa = Math.sin(a ?? 0)
  const cb = Math.cos(b ?? 0)
  const sb = Math.sin(b ?? 0)
  const cc = Math.cos(c ?? 0)
  const sc = Math.sin(c ?? 0)
  // three.js 'XYZ' order: v' = Rx · Ry · Rz · v
  return ([x, y, z]) => {
    const x1 = x * cc - y * sc
    const y1 = x * sc + y * cc
    const x2 = x1 * cb + z * sb
    const z2 = -x1 * sb + z * cb
    return [x2, y1 * ca - z2 * sa, y1 * sa + z2 * ca]
  }
}

interface SpatialContext {
  /** Stable GUID seed for relationships owned by this structure. */
  seed: string
  ref: StepRef
  placement: StepRef
  /** Rendered world point → this structure's local IFC frame. */
  worldToLocal: (p: Vec3) => Vec3
  contained: StepRef[]
  levelId?: string
}

interface BuildingTransform {
  position: Vec3
  yaw: number
}

function buildingWorldToLocal(transform: BuildingTransform, baseY: number): (p: Vec3) => Vec3 {
  const c = Math.cos(transform.yaw)
  const s = Math.sin(transform.yaw)
  const [bx, by, bz] = transform.position
  return ([x, y, z]) => {
    const qx = x - bx
    const qz = z - bz
    return localToIfc([c * qx - s * qz, y - by - baseY, s * qx + c * qz])
  }
}

/** Serialize a Pascal scene graph as an IFC4 STEP file plus an export report. */
export function buildIfcExport(input: IfcExportInput): IfcExportResult {
  const nodes = input.nodes
  const meshes = input.meshes ?? new Map<string, IfcMeshPart[]>()
  const model = new IfcModel()
  const step = model.step
  const skipped: IfcExportSkip[] = []
  const timestamp = input.timestamp ?? new Date()
  const projectName = input.projectName?.trim() || 'Pascal project'
  const excludedTypes = new Set(input.excludedNodeTypes ?? [])

  const parentOf = (node: AnyNode): AnyNode | undefined =>
    node.parentId ? nodes[node.parentId] : undefined

  // Core's shared rule: a hidden node hides its subtree, except a Site, which
  // only hides its own ground and boundary (`hidesDescendants`).
  const hiddenCache = new Map<string, boolean>()
  const isHidden = (node: AnyNode): boolean => {
    const cached = hiddenCache.get(node.id)
    if (cached !== undefined) return cached
    const parent = parentOf(node)
    const result =
      node.visible === false || (parent && hidesDescendants(parent) ? isHidden(parent) : false)
    hiddenCache.set(node.id, result)
    return result
  }
  const typeExcludedCache = new Map<string, boolean>()
  const isTypeExcluded = (node: AnyNode): boolean => {
    const cached = typeExcludedCache.get(node.id)
    if (cached !== undefined) return cached
    const parent = parentOf(node)
    const result = excludedTypes.has(node.type) || (parent ? isTypeExcluded(parent) : false)
    typeExcludedCache.set(node.id, result)
    return result
  }
  const isExcluded = (node: AnyNode) =>
    isTypeExcluded(node) || (input.onlyVisible === true && isHidden(node))

  const ancestorOfType = <T extends AnyNode>(node: AnyNode, type: T['type']): T | undefined => {
    let current: AnyNode | undefined = node
    for (let guard = 0; current && guard < 64; guard++) {
      if (current.type === type) return current as T
      current = parentOf(current)
    }
    return undefined
  }

  const sortedNodes = Object.values(nodes).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const nodesByType = new Map<string, AnyNode[]>()
  for (const node of sortedNodes) pushTo(nodesByType, node.type, node)
  const ofType = <T extends AnyNode>(type: T['type']) => (nodesByType.get(type) ?? []) as T[]

  // ── Project, units, contexts ──────────────────────────────────────────
  // Sites are spatial containers only (their ground is not exported), so a
  // hidden Site still anchors the buildings on it.
  const sites = ofType('site')
  const buildings = ofType<BuildingNode>('building').filter((building) => !isExcluded(building))
  const levels = ofType<LevelNode>('level').filter((level) => !isExcluded(level))
  const projectSeed = sites[0]?.id ?? buildings[0]?.id ?? levels[0]?.id ?? projectName

  // IfcPerson needs an identification or a name (IdentifiablePerson rule).
  const person = step.add(
    'IFCPERSON',
    'Pascal user',
    input.author?.trim() || null,
    null,
    null,
    null,
    null,
    null,
    null,
  )
  const organization = step.add(
    'IFCORGANIZATION',
    null,
    input.organization?.trim() || 'Pascal',
    null,
    null,
    null,
  )
  const personOrg = step.add('IFCPERSONANDORGANIZATION', person, organization, null)
  const application = step.add(
    'IFCAPPLICATION',
    organization,
    '1.0',
    'Pascal Editor',
    'Pascal Editor',
  )
  model.ownerHistory = step.add(
    'IFCOWNERHISTORY',
    personOrg,
    application,
    null,
    enumValue('NOCHANGE'),
    null,
    null,
    null,
    int(Math.floor(timestamp.getTime() / 1000)),
  )
  const ownerHistory = model.ownerHistory

  const units = step.add('IFCUNITASSIGNMENT', [
    step.add('IFCSIUNIT', DERIVED, enumValue('LENGTHUNIT'), null, enumValue('METRE')),
    step.add('IFCSIUNIT', DERIVED, enumValue('AREAUNIT'), null, enumValue('SQUARE_METRE')),
    step.add('IFCSIUNIT', DERIVED, enumValue('VOLUMEUNIT'), null, enumValue('CUBIC_METRE')),
    step.add('IFCSIUNIT', DERIVED, enumValue('PLANEANGLEUNIT'), null, enumValue('RADIAN')),
  ])
  const modelContext = step.add(
    'IFCGEOMETRICREPRESENTATIONCONTEXT',
    null,
    'Model',
    int(3),
    1e-5,
    model.axis2Placement3D(IDENTITY_FRAME),
    model.direction([0, 1]),
  )
  model.bodyContext = step.add(
    'IFCGEOMETRICREPRESENTATIONSUBCONTEXT',
    'Body',
    'Model',
    DERIVED,
    DERIVED,
    DERIVED,
    DERIVED,
    modelContext,
    null,
    enumValue('MODEL_VIEW'),
    null,
  )
  model.axisContext = step.add(
    'IFCGEOMETRICREPRESENTATIONSUBCONTEXT',
    'Axis',
    'Model',
    DERIVED,
    DERIVED,
    DERIVED,
    DERIVED,
    modelContext,
    null,
    enumValue('GRAPH_VIEW'),
    null,
  )
  const project = step.add(
    'IFCPROJECT',
    model.guid(`project:${projectSeed}`),
    ownerHistory,
    projectName,
    null,
    null,
    null,
    null,
    [modelContext],
    units,
  )

  const pascalIdentity = (node: AnyNode, refs: StepRef[]) =>
    model.propertySet(
      node.id,
      'Pascal',
      [
        ['NodeId', identifier(node.id)],
        ['NodeType', label(node.type)],
      ],
      refs,
    )

  const nodeName = (node: AnyNode, fallback: string) => {
    const name = (node as { name?: unknown }).name
    return typeof name === 'string' && name.trim() ? name : fallback
  }

  const elementCounts: Record<string, number> = {}
  const countElement = (entity: string) => {
    elementCounts[entity] = (elementCounts[entity] ?? 0) + 1
  }

  // ── Spatial structure ────────────────────────────────────────────────
  const siteContexts = new Map<string, SpatialContext>()
  const siteNodes = sites.length > 0 ? sites : [undefined]
  for (const site of siteNodes) {
    const seed = site?.id ?? `site:${projectSeed}`
    const placement = model.localPlacement(null, IDENTITY_FRAME)
    const ref = step.add(
      'IFCSITE',
      model.guid(seed, site?.metadata?.globalId),
      ownerHistory,
      site ? nodeName(site, 'Site') : 'Site',
      null,
      null,
      placement,
      null,
      null,
      enumValue('ELEMENT'),
      null,
      null,
      null,
      null,
      null,
    )
    if (site) pascalIdentity(site, [ref])
    siteContexts.set(seed, {
      seed,
      ref,
      placement,
      worldToLocal: (p) => localToIfc(p),
      contained: [],
    })
  }
  const defaultSite = siteContexts.values().next().value!
  model.rel('IFCRELAGGREGATES', `project-sites:${projectSeed}`, project, [
    ...[...siteContexts.values()].map((context) => context.ref),
  ])

  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const buildingContexts = new Map<string, SpatialContext & { transform: BuildingTransform }>()
  const levelsByBuilding = new Map<string, LevelNode[]>()
  for (const level of levels) {
    const buildingId = elevations.get(level.id)?.buildingId ?? level.parentId
    const key =
      buildingId && buildings.some((building) => building.id === buildingId)
        ? buildingId
        : `building:${projectSeed}`
    pushTo(levelsByBuilding, key, level)
  }
  const buildingEntries: Array<{ key: string; node?: BuildingNode }> = buildings.map(
    (building) => ({ key: building.id, node: building }),
  )
  if (levelsByBuilding.has(`building:${projectSeed}`) || buildingEntries.length === 0) {
    buildingEntries.push({ key: `building:${projectSeed}` })
  }
  const buildingsBySite = new Map<SpatialContext, StepRef[]>()
  for (const { key, node } of buildingEntries) {
    const site =
      (node?.parentId ? siteContexts.get(node.parentId) : undefined) ??
      (node ? siteContexts.get(ancestorOfType(node, 'site')?.id ?? '') : undefined) ??
      defaultSite
    const transform: BuildingTransform = {
      position: node ? [node.position[0], node.position[1], node.position[2]] : [0, 0, 0],
      yaw: node ? (node.rotation[1] ?? 0) : 0,
    }
    const frame: PlanFrame = { origin: localToIfc(transform.position), angle: transform.yaw }
    const placement = model.localPlacement(site.placement, frame)
    const ref = step.add(
      'IFCBUILDING',
      model.guid(key, node?.metadata?.globalId),
      ownerHistory,
      node ? nodeName(node, 'Building') : 'Building',
      null,
      null,
      placement,
      null,
      null,
      enumValue('ELEMENT'),
      null,
      null,
      null,
    )
    if (node) pascalIdentity(node, [ref])
    pushTo(buildingsBySite, site, ref)
    buildingContexts.set(key, {
      seed: key,
      ref,
      placement,
      transform,
      worldToLocal: buildingWorldToLocal(transform, 0),
      contained: [],
    })
  }
  for (const [site, refs] of buildingsBySite) {
    model.rel('IFCRELAGGREGATES', `aggregates:${site.seed}`, site.ref, refs)
  }

  const storeyContexts = new Map<string, SpatialContext>()
  const lowestLevelByBuilding = new Map<string, string>()
  for (const [buildingKey, buildingLevels] of levelsByBuilding) {
    const building = buildingContexts.get(buildingKey)!
    const ordered = [...buildingLevels].sort(
      (a, b) =>
        (elevations.get(a.id)?.baseY ?? 0) - (elevations.get(b.id)?.baseY ?? 0) ||
        a.level - b.level,
    )
    if (ordered[0]) lowestLevelByBuilding.set(buildingKey, ordered[0].id)
    const storeyRefs: StepRef[] = []
    for (const level of ordered) {
      const elevation = elevations.get(level.id)
      const baseY = elevation?.baseY ?? 0
      const placement = model.localPlacement(building.placement, {
        origin: [0, 0, baseY],
        angle: 0,
      })
      const ref = step.add(
        'IFCBUILDINGSTOREY',
        model.guid(level.id, level.metadata?.globalId),
        ownerHistory,
        nodeName(level, `Level ${level.level}`),
        null,
        null,
        placement,
        null,
        null,
        enumValue('ELEMENT'),
        baseY,
      )
      storeyRefs.push(ref)
      pascalIdentity(level, [ref])
      if (elevation) {
        model.lengthQuantities(
          level.id,
          'Qto_BuildingStoreyBaseQuantities',
          [['GrossHeight', elevation.height]],
          [ref],
        )
      }
      storeyContexts.set(level.id, {
        seed: level.id,
        ref,
        placement,
        worldToLocal: buildingWorldToLocal(building.transform, baseY),
        contained: [],
        levelId: level.id,
      })
    }
    if (storeyRefs.length > 0) {
      model.rel('IFCRELAGGREGATES', `aggregates:${buildingKey}`, building.ref, storeyRefs)
    }
  }

  const contextFor = (node: AnyNode): SpatialContext => {
    let current: AnyNode | undefined = parentOf(node)
    for (let guard = 0; current && guard < 64; guard++) {
      if (current.type === 'level') {
        const storey = storeyContexts.get(current.id)
        if (storey) return storey
      }
      if (current.type === 'building') {
        const building = buildingContexts.get(current.id)
        if (building) return building
      }
      if (current.type === 'site') {
        const site = siteContexts.get(current.id)
        if (site) return site
      }
      current = parentOf(current)
    }
    return defaultSite
  }

  // ── Element helpers ──────────────────────────────────────────────────
  const emitElement = (
    cls: ElementClass,
    seed: string,
    node: AnyNode | undefined,
    name: string,
    placement: StepRef,
    representation: StepRef | null,
  ): StepRef => {
    const ref = step.add(
      cls.entity,
      model.guid(seed, node?.metadata?.globalId),
      ownerHistory,
      name,
      null,
      cls.objectType ?? null,
      placement,
      representation,
      ...cls.tail(node?.id ?? seed, node),
    )
    countElement(cls.entity)
    if (node) pascalIdentity(node, [ref])
    return ref
  }

  const colorOf = (part: IfcMeshPart): IfcColor | undefined =>
    part.color ? { rgb: part.color, opacity: part.opacity ?? 1 } : undefined

  /** Mesh parts mapped into `toLocal`'s frame, dropping parts with fewer than three vertices. */
  const localTriangleSets = (
    parts: readonly IfcMeshPart[],
    toLocal: (p: Vec3) => Vec3,
  ): TriangleSet[] =>
    parts.flatMap((part) => {
      const count = Math.floor(part.positions.length / 3)
      if (count < 3) return []
      const positions = new Float64Array(count * 3)
      for (let i = 0; i < count; i++) {
        const local = toLocal([
          part.positions[i * 3]!,
          part.positions[i * 3 + 1]!,
          part.positions[i * 3 + 2]!,
        ])
        positions[i * 3] = local[0]
        positions[i * 3 + 1] = local[1]
        positions[i * 3 + 2] = local[2]
      }
      return [{ positions, indices: part.indices ?? [], color: colorOf(part) }]
    })

  /** Mesh parts for a node: rendered geometry, else an imported mesh's own primitives. */
  const partsFor = (node: AnyNode, context: SpatialContext): TriangleSet[] => {
    const rendered = meshes.get(node.id)
    if (rendered && rendered.length > 0) return localTriangleSets(rendered, context.worldToLocal)
    if (node.type !== 'imported-mesh') return []
    const imported = node as ImportedMeshNode
    const rotate = eulerXYZ(imported.rotation ?? [0, 0, 0])
    const [px, py, pz] = imported.position ?? [0, 0, 0]
    return localTriangleSets(
      imported.primitives.map((primitive) => ({
        positions: primitive.positions,
        indices: primitive.indices,
        color: hexToRgb(primitive.color),
        opacity: primitive.opacity,
      })),
      (p) => {
        const r = rotate(p)
        return localToIfc([r[0] + px, r[1] + py, r[2] + pz])
      },
    )
  }

  /** Re-base triangle sets on their footprint centre so each element's origin sits at its geometry. */
  const recentre = (sets: TriangleSet[]): { frame: PlanFrame; sets: TriangleSet[] } => {
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const set of sets) {
      for (let i = 0; i + 2 < set.positions.length; i += 3) {
        minX = Math.min(minX, set.positions[i]!)
        maxX = Math.max(maxX, set.positions[i]!)
        minY = Math.min(minY, set.positions[i + 1]!)
        maxY = Math.max(maxY, set.positions[i + 1]!)
        minZ = Math.min(minZ, set.positions[i + 2]!)
      }
    }
    const origin: Vec3 = [(minX + maxX) / 2, (minY + maxY) / 2, minZ]
    return {
      frame: { origin, angle: 0 },
      sets: sets.map((set) => {
        const positions = Float64Array.from(set.positions)
        for (let i = 0; i + 2 < positions.length; i += 3) {
          positions[i] = positions[i]! - origin[0]
          positions[i + 1] = positions[i + 1]! - origin[1]
          positions[i + 2] = positions[i + 2]! - origin[2]
        }
        return { ...set, positions }
      }),
    }
  }

  const tessellatedShape = (sets: TriangleSet[]): StepRef | null => {
    const items = sets.flatMap((set) => {
      const item = model.triangulatedFaceSet(set)
      return item ? [item] : []
    })
    return items.length > 0 ? model.shape([model.bodyRepresentation('Tessellation', items)]) : null
  }

  /** Emit a tessellated element placed in `relativeTo`; returns null if it has no triangles. */
  const emitMeshElement = (
    cls: ElementClass,
    node: AnyNode,
    sets: TriangleSet[],
    relativeTo: StepRef,
  ): StepRef | null => {
    if (sets.length === 0) return null
    const { frame, sets: local } = recentre(sets)
    const shape = tessellatedShape(local)
    if (!shape) return null
    return emitElement(
      cls,
      node.id,
      node,
      nodeName(node, cls.entity),
      model.localPlacement(relativeTo, frame),
      shape,
    )
  }

  /**
   * Plan area of `outer` minus its cutouts, as IFC plan regions. Pascal
   * cutouts may cross the boundary or overlap one another; IFC inner curves
   * must be enclosed and disjoint, so the area is normalised with booleans.
   */
  const areaRegions = (
    outer: readonly (readonly [number, number])[],
    holes: readonly (readonly (readonly [number, number])[])[],
  ): Array<{ outer: Vec2[]; holes: Vec2[][] }> => {
    const toIfc = (ring: readonly (readonly [number, number])[]) =>
      cleanRing(ring.map(([x, z]) => planToIfc(x, z)))
    const cutouts = holes.filter((hole) => hole.length >= 3)
    if (cutouts.length === 0) {
      const ring = toIfc(outer)
      return ring.length > 0 ? [{ outer: ring, holes: [] }] : []
    }
    const asRing = (ring: readonly (readonly [number, number])[]) =>
      ring.map(([x, z]) => [x, z] as [number, number])
    return difference(asRing(outer), union(cutouts.map(asRing))).flatMap((region) => {
      const ring = toIfc(region.outer)
      if (ring.length === 0) return []
      return [{ outer: ring, holes: region.holes.map(toIfc).filter((hole) => hole.length > 0) }]
    })
  }

  const regionSolids = (
    regions: Array<{ outer: Vec2[]; holes: Vec2[][] }>,
    bottom: number,
    depth: number,
  ) =>
    regions.map((region) =>
      model.extrusion(model.polygonProfile(region.outer, region.holes), bottom, depth),
    )

  const hostWallIsExternal = (wall: WallNode | undefined) => {
    if (!wall) return undefined
    const sides = [wall.frontSide, wall.backSide]
    if (sides.includes('exterior')) return true
    if (sides.every((side) => side === 'interior')) return false
    return undefined
  }

  const spaceByZoneId = new Map<string, StepRef>()
  const handled = new Set<string>()

  // ── Walls, openings, doors, windows ──────────────────────────────────
  const openingsByWall = new Map<string, Array<DoorNode | WindowNode>>()
  for (const opening of [...ofType<DoorNode>('door'), ...ofType<WindowNode>('window')]) {
    if (isExcluded(opening)) continue
    if (opening.roofSegmentId) continue
    const hostId = opening.wallId ?? opening.parentId
    const host = hostId ? nodes[hostId] : undefined
    if (host?.type !== 'wall' || isExcluded(host)) continue
    pushTo(openingsByWall, host.id, opening)
  }

  const layerUsages = new Map<string, { usage: StepRef; walls: StepRef[] }>()
  const wallMaterial = step.add('IFCMATERIAL', 'Wall', null, null)

  const wallsByLevel = new Map<string, WallNode[]>()
  for (const wall of ofType<WallNode>('wall'))
    if (wall.parentId) pushTo(wallsByLevel, wall.parentId, wall)
  const slabsByLevel = new Map<string, SlabNode[]>()
  for (const slab of ofType<SlabNode>('slab'))
    if (slab.parentId) pushTo(slabsByLevel, slab.parentId, slab)

  for (const [levelId, storey] of storeyContexts) {
    const levelWalls = wallsByLevel.get(levelId) ?? []
    if (levelWalls.length === 0) continue
    const miters = calculateLevelMiters(levelWalls)
    for (const wall of levelWalls) {
      if (isExcluded(wall)) continue
      handled.add(wall.id)
      const startPlan = planToIfc(wall.start[0], wall.start[1])
      const endPlan = planToIfc(wall.end[0], wall.end[1])
      const chord = Math.hypot(endPlan[0] - startPlan[0], endPlan[1] - startPlan[1])
      const support = wallSupportForNodes(wall, nodes)
      const base = support.elevation
      const top = resolveWallTop(
        wall,
        getWallPlaneTop(wall, levelId, nodes as Record<AnyNodeId, AnyNode>),
        base,
      )
      const cells = wallBaseCells(wall, support, top)
      if (chord < 1e-6 || cells.every((cell) => top - cell.bottom <= 1e-4)) {
        skipped.push({ nodeId: wall.id, type: wall.type, reason: 'degenerate' })
        continue
      }
      const frame: PlanFrame = {
        origin: [startPlan[0], startPlan[1], base],
        angle: Math.atan2(endPlan[1] - startPlan[1], endPlan[0] - startPlan[0]),
      }
      const toWallLocal = (x: number, z: number): Vec2 => {
        const [ix, iy] = planToIfc(x, z)
        const local = frameToLocal(frame, [ix, iy, 0])
        return [local[0], local[1]]
      }
      const axisPoints = isCurvedWall(wall)
        ? sampleWallCenterline(wall, 24).map((p) => toWallLocal(p.x, p.y))
        : [[0, 0] as Vec2, [chord, 0] as Vec2]
      const thickness = wall.thickness ?? DEFAULT_WALL_THICKNESS
      const faces = getWallFaceOffsets(wall)
      const planFootprint = getWallPlanFootprint(wall, miters).map((p): [number, number] => [
        p.x,
        p.y,
      ])
      let footprint = cleanRing(planFootprint.map(([x, z]) => toWallLocal(x, z)))
      if (footprint.length === 0) {
        footprint = [
          [0, -faces.a],
          [chord, -faces.a],
          [chord, -faces.b],
          [0, -faces.b],
        ]
      }
      // A stepped base (runs on different supports, or faces on different
      // floors) becomes one prism per run, each clipped from the footprint.
      const solids =
        cells.length === 1
          ? [
              model.extrusion(
                model.polygonProfile(footprint),
                cells[0]!.bottom - base,
                top - cells[0]!.bottom,
              ),
            ]
          : cells.flatMap((cell) =>
              top - cell.bottom <= 1e-4
                ? []
                : intersection(planFootprint, wallCellBand(wall, cell)).flatMap((region) => {
                    const ring = cleanRing(region.outer.map(([x, z]) => toWallLocal(x, z)))
                    return ring.length > 0
                      ? [
                          model.extrusion(
                            model.polygonProfile(ring),
                            cell.bottom - base,
                            top - cell.bottom,
                          ),
                        ]
                      : []
                  }),
            )
      const shape = model.shape([
        model.axisRepresentation(model.polyline2(axisPoints, false)),
        model.bodyRepresentation('SweptSolid', solids),
      ])
      const wallPlacement = model.localPlacement(storey.placement, frame)
      const wallRef = emitElement(
        { entity: 'IFCWALL', tail: (tag) => [tag, enumValue('STANDARD')] },
        wall.id,
        wall,
        nodeName(wall, 'Wall'),
        wallPlacement,
        shape,
      )
      storey.contained.push(wallRef)
      const isExternal = hostWallIsExternal(wall)
      model.propertySet(
        wall.id,
        'Pset_WallCommon',
        [['IsExternal', isExternal === undefined ? null : bool(isExternal)]],
        [wallRef],
      )

      // Pascal's body spans [b, a] along its left normal; that normal is
      // IFC -Y in the wall frame, so the first layer starts at -a.
      const offset = -faces.a
      const usageKey = `${thickness.toFixed(6)}|${offset.toFixed(6)}`
      let usage = layerUsages.get(usageKey)
      if (!usage) {
        const layer = step.add(
          'IFCMATERIALLAYER',
          wallMaterial,
          thickness,
          null,
          'Core',
          null,
          null,
          null,
        )
        const layerSet = step.add(
          'IFCMATERIALLAYERSET',
          [layer],
          `Wall ${Math.round(thickness * 1000)} mm`,
          null,
        )
        usage = {
          usage: step.add(
            'IFCMATERIALLAYERSETUSAGE',
            layerSet,
            enumValue('AXIS2'),
            enumValue('POSITIVE'),
            offset,
            null,
          ),
          walls: [],
        }
        layerUsages.set(usageKey, usage)
      }
      usage.walls.push(wallRef)

      const wallLength = getWallCurveLength(wall)
      const bodyOffset = getWallBodyCenterOffset(wall)
      for (const opening of openingsByWall.get(wall.id) ?? []) {
        handled.add(opening.id)
        let cut: ReturnType<typeof getOpeningWallCut> | null = null
        try {
          cut = getOpeningWallCut(wall, opening, nodes, support)
        } catch {
          cut = null
        }
        const datum = cut?.datum ?? base
        const nominalBottom = datum + opening.position[1] - opening.height / 2
        const t = wallLength > 0 ? Math.max(0, Math.min(1, opening.position[0] / wallLength)) : 0
        const curve = getWallCurveFrameAt(wall, t)
        const center = planToIfc(
          curve.point.x + curve.normal.x * bodyOffset,
          curve.point.y + curve.normal.y * bodyOffset,
        )
        const openingFrame: PlanFrame = {
          origin: [center[0], center[1], nominalBottom],
          angle: Math.atan2(-curve.tangent.y, curve.tangent.x),
        }
        const cutBottom = (cut?.bottom ?? nominalBottom) - nominalBottom
        const cutDepth =
          (cut?.top ?? nominalBottom + opening.height) - (cut?.bottom ?? nominalBottom)
        let openingRef: StepRef | null = null
        let openingPlacement: StepRef | null = null
        if (cutDepth > 1e-4 && opening.width > 1e-4) {
          let profile: StepRef
          const band =
            isCurvedWall(wall) && cut
              ? cleanRing(
                  cut.band.map(([x, z]) => {
                    const [ix, iy] = planToIfc(x, z)
                    const local = frameToLocal(openingFrame, [ix, iy, 0])
                    return [local[0], local[1]] as Vec2
                  }),
                )
              : []
          if (band.length > 0) profile = model.polygonProfile(band)
          else profile = model.rectangleProfile(opening.width, thickness + 0.2)
          openingPlacement = model.localPlacement(wallPlacement, relativeFrame(frame, openingFrame))
          openingRef = step.add(
            'IFCOPENINGELEMENT',
            model.guid(`${opening.id}:opening`),
            ownerHistory,
            `${nodeName(opening, opening.type === 'door' ? 'Door' : 'Window')} opening`,
            null,
            null,
            openingPlacement,
            model.shape([
              model.bodyRepresentation('SweptSolid', [
                model.extrusion(profile, cutBottom, cutDepth),
              ]),
            ]),
            null,
            enumValue('OPENING'),
          )
          model.rel('IFCRELVOIDSELEMENT', `${opening.id}:voids`, wallRef, openingRef)
        }

        const rendered = meshes.get(opening.id)
        const bodySets = rendered?.length
          ? localTriangleSets(rendered, (p) => frameToLocal(openingFrame, storey.worldToLocal(p)))
          : []
        let body = tessellatedShape(bodySets)
        if (!body) {
          const panel = Math.min(0.05, thickness)
          body = model.shape([
            model.bodyRepresentation('SweptSolid', [
              model.extrusion(
                model.rectangleProfile(opening.width, panel),
                0,
                opening.height,
                opening.type === 'window' ? { rgb: [0.62, 0.8, 0.9], opacity: 0.4 } : undefined,
              ),
            ]),
          ])
        }
        const elementPlacement = openingPlacement
          ? model.localPlacement(openingPlacement, IDENTITY_FRAME)
          : model.localPlacement(storey.placement, openingFrame)
        const fill = emitElement(
          meshClassFor(opening),
          opening.id,
          opening,
          nodeName(opening, opening.type === 'door' ? 'Door' : 'Window'),
          elementPlacement,
          body,
        )
        storey.contained.push(fill)
        if (openingRef) {
          model.rel('IFCRELFILLSELEMENT', `${opening.id}:fills`, openingRef, fill)
        }
        const external = isExternal === undefined ? null : bool(isExternal)
        if (opening.type === 'door') {
          const glazing = doorGlazingFraction(opening as DoorNode)
          model.propertySet(
            opening.id,
            'Pset_DoorCommon',
            [
              ['IsExternal', external],
              ['GlazingAreaFraction', glazing > 0 ? ratio(glazing) : null],
            ],
            [fill],
          )
        } else {
          model.propertySet(opening.id, 'Pset_WindowCommon', [['IsExternal', external]], [fill])
        }
      }
    }
  }
  for (const [key, { usage, walls }] of layerUsages) {
    model.rel('IFCRELASSOCIATESMATERIAL', `material:${key}:${projectSeed}`, walls, usage)
  }

  // ── Slabs ────────────────────────────────────────────────────────────
  const polygonContexts = new Map<string, ReturnType<typeof prepareSlabPolygonContext>>()
  const slabPolygonContext = (levelId: string | null | undefined) => {
    const key = levelId ?? ''
    let context = polygonContexts.get(key)
    if (!context) {
      context = prepareSlabPolygonContext({
        walls: levelId ? (wallsByLevel.get(levelId) ?? []) : [],
        siblingSlabs: levelId ? (slabsByLevel.get(levelId) ?? []) : [],
      })
      polygonContexts.set(key, context)
    }
    return context
  }
  for (const slab of ofType<SlabNode>('slab')) {
    if (isExcluded(slab)) continue
    const context = contextFor(slab)
    handled.add(slab.id)
    // Same body the slab renderer builds: construction-lifted manual slabs,
    // wall-face-adopted outline.
    const body = liftedManualSlab(nodes, slab)
    const polygon = getRenderableSlabPolygon(body, slabPolygonContext(slab.parentId))
    const regions = areaRegions(polygon, slab.holes ?? [])
    const thickness = body.thickness ?? 0.05
    const top = body.elevation ?? 0.05
    const rendered = partsFor(slab, context)
    // Pools are open shells, legacy zero-thickness slabs have no valid
    // extrusion, and terrain fill, foundations or platform fill reach below
    // the [top − thickness, top] band: all keep their rendered shape.
    if (
      slab.recessed ||
      thickness <= 1e-4 ||
      regions.length === 0 ||
      !withinBand(rendered, top - thickness, top)
    ) {
      const ref = emitMeshElement(meshClassFor(slab), slab, rendered, context.placement)
      if (ref) context.contained.push(ref)
      else {
        skipped.push({
          nodeId: slab.id,
          type: slab.type,
          reason: slab.recessed ? 'no-geometry' : 'degenerate',
        })
      }
      continue
    }
    const levelId = context.levelId
    const isGround =
      slab.plateRole === 'base' &&
      levelId !== undefined &&
      [...lowestLevelByBuilding.values()].includes(levelId)
    const ref = emitElement(
      { entity: 'IFCSLAB', tail: (tag) => [tag, enumValue(isGround ? 'BASESLAB' : 'FLOOR')] },
      slab.id,
      slab,
      nodeName(slab, 'Slab'),
      model.localPlacement(context.placement, { origin: [0, 0, top], angle: 0 }),
      model.shape([
        model.bodyRepresentation('SweptSolid', regionSolids(regions, -thickness, thickness)),
      ]),
    )
    context.contained.push(ref)
  }

  // ── Spaces (rooms) ───────────────────────────────────────────────────
  const ceilings = ofType<CeilingNode>('ceiling')
  const ceilingByZone = new Map<string, CeilingNode>()
  for (const ceiling of ceilings) {
    if (ceiling.zoneId && !ceilingByZone.has(ceiling.zoneId))
      ceilingByZone.set(ceiling.zoneId, ceiling)
  }
  const plateTopByZone = new Map<string, number>()
  for (const slab of ofType<SlabNode>('slab')) {
    if (slab.recessed) continue
    for (const zoneId of slab.zoneIds ?? []) {
      const top = slab.elevation ?? 0
      plateTopByZone.set(zoneId, Math.max(top, plateTopByZone.get(zoneId) ?? -Infinity))
    }
  }
  const spacesByStorey = new Map<SpatialContext, StepRef[]>()
  for (const zone of ofType<ZoneNode>('zone')) {
    if (isExcluded(zone)) continue
    const context = contextFor(zone)
    if (!context.levelId) {
      skipped.push({ nodeId: zone.id, type: zone.type, reason: 'no-level' })
      continue
    }
    const regions = areaRegions(zone.polygon, zone.holes ?? [])
    if (regions.length === 0) {
      skipped.push({ nodeId: zone.id, type: zone.type, reason: 'degenerate' })
      continue
    }
    const plateTop = plateTopByZone.get(zone.id)
    const floor = zone.floor?.elevation ?? plateTop ?? 0
    const ceiling = ceilingByZone.get(zone.id)
    const clearHeight = ceiling
      ? resolveCeilingHeight(ceiling, nodes as Record<AnyNodeId, AnyNode>) - floor
      : zone.ceilingHeight
    const height = Math.max(0.1, clearHeight)
    const roomNumber = zone.roomNumber?.trim() ?? ''
    const ref = step.add(
      'IFCSPACE',
      model.guid(zone.id, zone.metadata?.globalId),
      ownerHistory,
      roomNumber || zone.name,
      null,
      null,
      model.localPlacement(context.placement, { origin: [0, 0, floor], angle: 0 }),
      model.shape([model.bodyRepresentation('SweptSolid', regionSolids(regions, 0, height))]),
      zone.name,
      enumValue('ELEMENT'),
      enumValue(zone.spaceRole === 'room' ? 'SPACE' : 'NOTDEFINED'),
      null,
    )
    countElement('IFCSPACE')
    pascalIdentity(zone, [ref])
    spaceByZoneId.set(zone.id, ref)
    pushTo(spacesByStorey, context, ref)
  }
  for (const [storey, spaces] of spacesByStorey) {
    model.rel('IFCRELAGGREGATES', `spaces:${storey.seed}`, storey.ref, spaces)
  }

  // ── Ceilings ─────────────────────────────────────────────────────────
  for (const ceiling of ceilings) {
    if (isExcluded(ceiling)) continue
    handled.add(ceiling.id)
    const context = contextFor(ceiling)
    const regions = areaRegions(ceiling.polygon, ceiling.holes ?? [])
    if (regions.length === 0) {
      skipped.push({ nodeId: ceiling.id, type: ceiling.type, reason: 'degenerate' })
      continue
    }
    const height = resolveCeilingHeight(ceiling, nodes as Record<AnyNodeId, AnyNode>)
    const ref = emitElement(
      { entity: 'IFCCOVERING', tail: (tag) => [tag, enumValue('CEILING')] },
      ceiling.id,
      ceiling,
      nodeName(ceiling, 'Ceiling'),
      model.localPlacement(context.placement, { origin: [0, 0, height], angle: 0 }),
      model.shape([
        // The ceiling surface is the underside; the covering bound keeps a
        // 1 cm margin below the next floor, which this thickness fills.
        model.bodyRepresentation('SweptSolid', regionSolids(regions, 0, CEILING_THICKNESS)),
      ]),
    )
    context.contained.push(ref)
    const space = ceiling.zoneId ? spaceByZoneId.get(ceiling.zoneId) : undefined
    if (space) model.rel('IFCRELCOVERSSPACES', `${ceiling.id}:covers`, space, [ref])
  }

  // ── Columns ──────────────────────────────────────────────────────────
  for (const column of ofType<ColumnNode>('column')) {
    if (isExcluded(column)) continue
    handled.add(column.id)
    const context = contextFor(column)
    const sets = partsFor(column, context)
    const cls = meshClassFor(column)
    if (!isPlainColumn(column) && sets.length > 0) {
      const ref = emitMeshElement(cls, column, sets, context.placement)
      if (ref) context.contained.push(ref)
      continue
    }
    let baseZ = column.position[1]
    if (sets.length > 0) {
      baseZ = Infinity
      for (const set of sets) {
        for (let i = 2; i < set.positions.length; i += 3) {
          baseZ = Math.min(baseZ, set.positions[i]!)
        }
      }
    }
    const [x, y] = planToIfc(column.position[0], column.position[2])
    const profile =
      column.crossSection === 'rectangular' || column.crossSection === 'square'
        ? model.rectangleProfile(
            column.width,
            column.crossSection === 'square' ? column.width : column.depth,
          )
        : model.circleProfile(column.radius)
    const ref = emitElement(
      cls,
      column.id,
      column,
      nodeName(column, 'Column'),
      model.localPlacement(context.placement, {
        origin: [x, y, baseZ],
        angle: column.rotation ?? 0,
      }),
      model.shape([
        model.bodyRepresentation('SweptSolid', [model.extrusion(profile, 0, column.height)]),
      ]),
    )
    context.contained.push(ref)
  }

  // ── Everything else: tessellated elements ────────────────────────────
  const hasOwnGeometry = (node: AnyNode) =>
    (meshes.get(node.id)?.length ?? 0) > 0 ||
    (node.type === 'imported-mesh' && (node as ImportedMeshNode).primitives.length > 0)
  const geometryInSubtree = new Set<string>()
  for (const node of sortedNodes) {
    if (!hasOwnGeometry(node)) continue
    let current: AnyNode | undefined = node
    for (let guard = 0; current && guard < 64; guard++) {
      if (geometryInSubtree.has(current.id)) break
      geometryInSubtree.add(current.id)
      current = parentOf(current)
    }
  }

  const partIndex = new Map<string, Map<string, AnyNode[]>>()
  const aggregateParts = (
    container: AnyNode,
    containerClass: ElementClass,
    partType: string,
    partClass: ElementClass,
  ) => {
    const context = contextFor(container)
    let partsByContainer = partIndex.get(partType)
    if (!partsByContainer) {
      partsByContainer = new Map()
      for (const part of ofType(partType as AnyNode['type'])) {
        const owner = ancestorOfType(part, container.type)
        if (owner && !isExcluded(part)) pushTo(partsByContainer, owner.id, part)
      }
      partIndex.set(partType, partsByContainer)
    }
    const members = [container, ...(partsByContainer.get(container.id) ?? [])]
    const parts: StepRef[] = []
    const placement = model.localPlacement(context.placement, IDENTITY_FRAME)
    for (const member of members) {
      if (member !== container) handled.add(member.id)
      const ref = emitMeshElement(partClass, member, partsFor(member, context), placement)
      if (ref) parts.push(ref)
    }
    if (parts.length === 0) {
      skipped.push({ nodeId: container.id, type: container.type, reason: 'no-geometry' })
      return
    }
    const ref = step.add(
      containerClass.entity,
      model.guid(`${container.id}:assembly`, container.metadata?.globalId),
      ownerHistory,
      nodeName(container, containerClass.entity),
      null,
      null,
      placement,
      null,
      ...containerClass.tail(container.id, undefined),
    )
    countElement(containerClass.entity)
    pascalIdentity(container, [ref])
    model.rel('IFCRELAGGREGATES', `${container.id}:parts`, ref, parts)
    context.contained.push(ref)
  }

  for (const roof of ofType('roof')) {
    if (isExcluded(roof)) continue
    handled.add(roof.id)
    aggregateParts(
      roof,
      { entity: 'IFCROOF', tail: (tag) => [tag, enumValue('NOTDEFINED')] },
      'roof-segment',
      ROOF_SLAB,
    )
  }
  for (const stair of ofType('stair')) {
    if (isExcluded(stair)) continue
    handled.add(stair.id)
    aggregateParts(
      stair,
      { entity: 'IFCSTAIR', tail: (tag) => [tag, enumValue('NOTDEFINED')] },
      'stair-segment',
      STAIR_FLIGHT,
    )
  }

  for (const node of sortedNodes) {
    if (handled.has(node.id) || isExcluded(node)) continue
    if (NON_PHYSICAL_TYPES.has(node.type)) continue
    if (NATIVE_TYPES.has(node.type) && node.type !== 'door' && node.type !== 'window') continue
    const context = contextFor(node)
    const ref = emitMeshElement(
      meshClassFor(node),
      node,
      partsFor(node, context),
      context.placement,
    )
    if (ref) {
      context.contained.push(ref)
    } else if (!geometryInSubtree.has(node.id)) {
      skipped.push({ nodeId: node.id, type: node.type, reason: 'no-geometry' })
    }
  }

  // ── Units as IfcZone groups ──────────────────────────────────────────
  for (const unit of ofType<UnitNode>('unit')) {
    if (isExcluded(unit)) continue
    const members = unit.members.flatMap((zoneId) => {
      const space = spaceByZoneId.get(zoneId)
      return space ? [space] : []
    })
    if (members.length === 0) continue
    const zone = step.add(
      'IFCZONE',
      model.guid(unit.id, unit.metadata?.globalId),
      ownerHistory,
      nodeName(unit, 'Unit'),
      null,
      unit.kind,
      null,
    )
    pascalIdentity(unit, [zone])
    step.add(
      'IFCRELASSIGNSTOGROUP',
      model.guid(`${unit.id}:members`),
      ownerHistory,
      null,
      null,
      members,
      null,
      zone,
    )
  }

  // ── Spatial containment ──────────────────────────────────────────────
  const allContexts: SpatialContext[] = [
    ...siteContexts.values(),
    ...buildingContexts.values(),
    ...storeyContexts.values(),
  ]
  for (const context of allContexts) {
    if (context.contained.length === 0) continue
    model.rel(
      'IFCRELCONTAINEDINSPATIALSTRUCTURE',
      `contains:${context.seed}`,
      context.contained,
      context.ref,
    )
  }

  const ifc = step.serialize({
    description: 'ViewDefinition [DesignTransferView_V1.0]',
    fileName: `${projectName}.ifc`,
    timestamp: timestamp.toISOString().replace(/\.\d{3}Z$/, ''),
    author: input.author?.trim() || '',
    organization: input.organization?.trim() || '',
    preprocessor: 'Pascal IFC writer',
    originatingSystem: 'Pascal Editor',
    schema: 'IFC4',
  })

  return { ifc, summary: { elements: elementCounts, skipped } }
}

const CEILING_THICKNESS = 0.01

/** Whether every vertex lies in [bottom, top] (storey-local Z); true without geometry. */
function withinBand(sets: readonly TriangleSet[], bottom: number, top: number): boolean {
  for (const set of sets) {
    for (let i = 2; i < set.positions.length; i += 3) {
      const z = set.positions[i]!
      if (z < bottom - 0.005 || z > top + 0.005) return false
    }
  }
  return true
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/** Columns whose rendered shape is a plain prism; ornate ones export their mesh. */
function isPlainColumn(column: ColumnNode): boolean {
  return (
    column.style === 'plain' &&
    column.shaftProfile === 'straight' &&
    column.baseStyle === 'none' &&
    column.capitalStyle === 'none' &&
    (column.supportStyle ?? 'vertical') === 'vertical' &&
    ['round', 'square', 'rectangular'].includes(column.crossSection)
  )
}

/** Serialize a Pascal scene graph as IFC4 STEP text. */
export function exportSceneToIfc(input: IfcExportInput): string {
  return buildIfcExport(input).ifc
}
