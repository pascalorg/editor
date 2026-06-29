import { nodeRegistry } from '../../registry/registry'
import {
  type AnyNode,
  type AnyNodeId,
  AnyNode as AnyNodeSchema,
  createDefaultRidgeVentsForSegment,
  getEffectiveWallSurfaceMaterial,
  getWallSurfaceMaterialSignature,
  isAutoRidgeVentEnabled,
  isDefaultRidgeVentNode,
  type RoofSegmentNode,
  type WallNode,
} from '../../schema'
import type { CollectionId } from '../../schema/collections'
import type { SceneState } from '../use-scene'

type AnyContainerNode = AnyNode & { children: string[] }
type NodeCreateOp = { node: AnyNode; parentId?: AnyNodeId }
type NodeUpdateOp = { id: AnyNodeId; data: Partial<AnyNode> }
type NodeDeleteOp = AnyNodeId
type WallAttachmentUpdate = { id: AnyNodeId; data: Partial<AnyNode> }
type WallMergePlan = {
  primaryWallId: AnyNodeId
  secondaryWallId: AnyNodeId
  mergedStart: [number, number]
  mergedEnd: [number, number]
  mergedChildren: WallNode['children']
  attachmentUpdates: WallAttachmentUpdate[]
}

const DEFAULT_RIDGE_VENT_REFRESH_FIELDS = new Set<string>([
  'roofType',
  'width',
  'depth',
  'pitch',
  'overhang',
  'wallThickness',
  'shingleThickness',
  'gambrelLowerWidthRatio',
  'mansardSteepWidthRatio',
  'dutchHipWidthRatio',
  'dutchWaistLengthRatio',
  'dutchGabletRake',
])

type ZodCheckLike = {
  _zod?: {
    def?: {
      check?: string
      value?: unknown
      inclusive?: boolean
      format?: string
    }
  }
}

type ZodSchemaDefLike = {
  type?: string
  innerType?: ZodSchemaLike
  shape?: Record<string, ZodSchemaLike>
  options?: readonly ZodSchemaLike[]
  items?: readonly ZodSchemaLike[]
  rest?: ZodSchemaLike | null
  element?: ZodSchemaLike
  checks?: readonly ZodCheckLike[]
  defaultValue?: unknown
  values?: readonly unknown[]
  entries?: Record<string, unknown>
}

type ZodSchemaLike = {
  _zod?: {
    def?: ZodSchemaDefLike
    bag?: {
      minimum?: number
      maximum?: number
      exclusiveMinimum?: number
      exclusiveMaximum?: number
    }
    values?: Set<unknown>
  }
  def?: ZodSchemaDefLike
  shape?: Record<string, ZodSchemaLike>
  minValue?: number | null
  maxValue?: number | null
}

type NumericLimit = {
  value: number
  inclusive: boolean
}

type NumericConstraints = {
  min?: NumericLimit
  max?: NumericLimit
  integer: boolean
}

type NumericSanitizeIssue = {
  path: PropertyKey[]
  from: number
  to?: number
  action: 'clamped' | 'dropped' | 'rounded'
}

type NumericSanitizeResult = {
  value: unknown
  issues: NumericSanitizeIssue[]
  omit?: boolean
}

const NUMBER_FORMAT_BOUNDS: Record<string, [number, number] | undefined> = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-3.4028234663852886e38, 3.4028234663852886e38],
}

const INTEGER_NUMBER_FORMATS = new Set(['safeint', 'int32', 'uint32'])

function getSchemaDef(schema: ZodSchemaLike | null | undefined): ZodSchemaDefLike | undefined {
  return schema?._zod?.def ?? schema?.def
}

function getSchemaDefault(schema: ZodSchemaLike): unknown {
  const def = getSchemaDef(schema)
  if (!(def?.type === 'default' || def?.type === 'prefault')) return undefined
  return def.defaultValue
}

function unwrapSchema(schema: ZodSchemaLike | null | undefined): ZodSchemaLike | null {
  let current = schema ?? null
  while (current) {
    const def = getSchemaDef(current)
    if (
      !(
        def?.type === 'default' ||
        def?.type === 'prefault' ||
        def?.type === 'optional' ||
        def?.type === 'nullable' ||
        def?.type === 'catch' ||
        def?.type === 'readonly' ||
        def?.type === 'nonoptional'
      )
    ) {
      return current
    }
    current = def.innerType ?? null
  }

  return null
}

function getObjectShape(schema: ZodSchemaLike | null | undefined) {
  const unwrapped = unwrapSchema(schema)
  const def = getSchemaDef(unwrapped)
  if (def?.type !== 'object') return null

  return unwrapped?.shape ?? def.shape ?? null
}

function schemaAllowsValue(schema: ZodSchemaLike | null | undefined, value: unknown): boolean {
  const unwrapped = unwrapSchema(schema)
  if (!unwrapped) return false

  const def = getSchemaDef(unwrapped)
  if (unwrapped._zod?.values?.has(value)) return true
  if (Array.isArray(def?.values) && def.values.includes(value)) return true
  if (def?.entries && Object.values(def.entries).includes(value)) return true

  return false
}

function getNodeSchemaForType(type: unknown): ZodSchemaLike | null {
  const schema = AnyNodeSchema as unknown as ZodSchemaLike
  const options = getSchemaDef(schema)?.options
  if (!options) return null

  for (const option of options) {
    const shape = getObjectShape(option)
    if (shape?.type && schemaAllowsValue(shape.type, type)) {
      return option
    }
  }

  return null
}

function applyLowerLimit(current: NumericLimit | undefined, candidate: NumericLimit): NumericLimit {
  if (!current) return candidate
  if (candidate.value > current.value) return candidate
  if (candidate.value === current.value && !candidate.inclusive) return candidate
  return current
}

function applyUpperLimit(current: NumericLimit | undefined, candidate: NumericLimit): NumericLimit {
  if (!current) return candidate
  if (candidate.value < current.value) return candidate
  if (candidate.value === current.value && !candidate.inclusive) return candidate
  return current
}

function getNumberConstraints(schema: ZodSchemaLike): NumericConstraints {
  const unwrapped = unwrapSchema(schema) ?? schema
  const def = getSchemaDef(unwrapped)
  const constraints: NumericConstraints = { integer: false }

  const minValue = unwrapped.minValue
  if (typeof minValue === 'number') {
    constraints.min = applyLowerLimit(constraints.min, { value: minValue, inclusive: true })
  }

  const maxValue = unwrapped.maxValue
  if (typeof maxValue === 'number') {
    constraints.max = applyUpperLimit(constraints.max, { value: maxValue, inclusive: true })
  }

  for (const check of def?.checks ?? []) {
    const checkDef = check._zod?.def
    if (!checkDef) continue

    if (checkDef.check === 'greater_than' && typeof checkDef.value === 'number') {
      constraints.min = applyLowerLimit(constraints.min, {
        value: checkDef.value,
        inclusive: checkDef.inclusive !== false,
      })
    } else if (checkDef.check === 'less_than' && typeof checkDef.value === 'number') {
      constraints.max = applyUpperLimit(constraints.max, {
        value: checkDef.value,
        inclusive: checkDef.inclusive !== false,
      })
    } else if (checkDef.check === 'number_format' && checkDef.format) {
      constraints.integer ||= INTEGER_NUMBER_FORMATS.has(checkDef.format)
      const bounds = NUMBER_FORMAT_BOUNDS[checkDef.format]
      if (bounds) {
        constraints.min = applyLowerLimit(constraints.min, {
          value: bounds[0],
          inclusive: true,
        })
        constraints.max = applyUpperLimit(constraints.max, {
          value: bounds[1],
          inclusive: true,
        })
      }
    }
  }

  const bag = unwrapped._zod?.bag
  if (typeof bag?.minimum === 'number') {
    constraints.min = applyLowerLimit(constraints.min, { value: bag.minimum, inclusive: true })
  }
  if (typeof bag?.exclusiveMinimum === 'number') {
    constraints.min = applyLowerLimit(constraints.min, {
      value: bag.exclusiveMinimum,
      inclusive: false,
    })
  }
  if (typeof bag?.maximum === 'number') {
    constraints.max = applyUpperLimit(constraints.max, { value: bag.maximum, inclusive: true })
  }
  if (typeof bag?.exclusiveMaximum === 'number') {
    constraints.max = applyUpperLimit(constraints.max, {
      value: bag.exclusiveMaximum,
      inclusive: false,
    })
  }

  return constraints
}

function nextAbove(value: number) {
  return value === 0 ? Number.EPSILON : value + Math.abs(value) * Number.EPSILON
}

function nextBelow(value: number) {
  return value === 0 ? -Number.EPSILON : value - Math.abs(value) * Number.EPSILON
}

function clampNumber(value: number, constraints: NumericConstraints) {
  let next = value
  let rounded = false
  let clamped = false

  if (constraints.integer && !Number.isInteger(next)) {
    next = Math.round(next)
    rounded = true
  }

  if (constraints.min) {
    const min = constraints.min.inclusive ? constraints.min.value : nextAbove(constraints.min.value)
    if (next < min) {
      next = min
      clamped = true
    }
  }

  if (constraints.max) {
    const max = constraints.max.inclusive ? constraints.max.value : nextBelow(constraints.max.value)
    if (next > max) {
      next = max
      clamped = true
    }
  }

  return {
    value: next,
    action: clamped ? 'clamped' : rounded ? 'rounded' : undefined,
  } satisfies { value: number; action?: NumericSanitizeIssue['action'] }
}

function getFiniteFallbackNumber(fallback: unknown, constraints: NumericConstraints) {
  if (typeof fallback !== 'number' || !Number.isFinite(fallback)) return undefined
  return clampNumber(fallback, constraints).value
}

function sanitizeNumber(
  schema: ZodSchemaLike | null,
  value: number,
  fallback: unknown,
  path: PropertyKey[],
): NumericSanitizeResult {
  const constraints = schema ? getNumberConstraints(schema) : { integer: false }

  if (!Number.isFinite(value)) {
    const replacement = getFiniteFallbackNumber(fallback, constraints)
    if (replacement === undefined) {
      return {
        value,
        omit: true,
        issues: [{ path, from: value, action: 'dropped' }],
      }
    }

    return {
      value: replacement,
      issues: [{ path, from: value, to: replacement, action: 'dropped' }],
    }
  }

  const clamped = clampNumber(value, constraints)
  if (!Object.is(clamped.value, value)) {
    return {
      value: clamped.value,
      issues: [
        {
          path,
          from: value,
          to: clamped.value,
          action: clamped.action ?? 'clamped',
        },
      ],
    }
  }

  return { value, issues: [] }
}

function sanitizeNumericValue(
  schema: ZodSchemaLike | null,
  value: unknown,
  fallback: unknown,
  path: PropertyKey[],
): NumericSanitizeResult {
  const defaultFallback = schema ? getSchemaDefault(schema) : undefined
  const effectiveFallback = fallback === undefined ? defaultFallback : fallback
  const unwrapped = unwrapSchema(schema)
  const def = getSchemaDef(unwrapped)

  if (def?.type === 'number') {
    if (typeof value !== 'number') return { value, issues: [] }
    return sanitizeNumber(unwrapped, value, effectiveFallback, path)
  }

  if (typeof value === 'number') {
    return sanitizeNumber(null, value, effectiveFallback, path)
  }

  if (def?.type === 'tuple' && Array.isArray(value)) {
    const fallbackItems = Array.isArray(effectiveFallback) ? effectiveFallback : []
    const next = [...value]
    const issues: NumericSanitizeIssue[] = []

    for (let index = 0; index < next.length; index += 1) {
      const itemSchema = def.items?.[index] ?? def.rest ?? null
      const child = sanitizeNumericValue(itemSchema, next[index], fallbackItems[index], [
        ...path,
        index,
      ])
      issues.push(...child.issues)

      if (child.omit) {
        return { value, omit: true, issues }
      }

      next[index] = child.value
    }

    return { value: issues.length > 0 ? next : value, issues }
  }

  if (def?.type === 'array' && Array.isArray(value)) {
    const fallbackItems = Array.isArray(effectiveFallback) ? effectiveFallback : []
    const next: unknown[] = []
    const issues: NumericSanitizeIssue[] = []
    let omitted = false

    for (let index = 0; index < value.length; index += 1) {
      const child = sanitizeNumericValue(def.element ?? null, value[index], fallbackItems[index], [
        ...path,
        index,
      ])
      issues.push(...child.issues)
      if (child.omit) {
        omitted = true
        continue
      }
      next.push(child.value)
    }

    return { value: issues.length > 0 || omitted ? next : value, issues }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const shape = def?.type === 'object' ? (unwrapped?.shape ?? def.shape ?? {}) : {}
    const fallbackObject =
      effectiveFallback &&
      typeof effectiveFallback === 'object' &&
      !Array.isArray(effectiveFallback)
        ? (effectiveFallback as Record<string, unknown>)
        : {}
    const input = value as Record<string, unknown>
    const next: Record<string, unknown> = { ...input }
    const issues: NumericSanitizeIssue[] = []

    for (const key of Object.keys(input)) {
      const child = sanitizeNumericValue(shape[key] ?? null, input[key], fallbackObject[key], [
        ...path,
        key,
      ])
      issues.push(...child.issues)

      if (child.omit) {
        delete next[key]
      } else {
        next[key] = child.value
      }
    }

    return { value: issues.length > 0 ? next : value, issues }
  }

  return { value, issues: [] }
}

function formatNumericValue(value: number) {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Infinity) return 'Infinity'
  if (value === -Infinity) return '-Infinity'
  return String(value)
}

function numericSanitizeIssuesToMessage(issues: NumericSanitizeIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.map(String).join('.') || '<root>'
      const to = issue.to === undefined ? '' : ` -> ${formatNumericValue(issue.to)}`
      return `${path}: ${formatNumericValue(issue.from)} ${issue.action}${to}`
    })
    .join('; ')
}

function warnSanitizedNodeMutation(
  mutation: 'create' | 'update',
  nodeId: AnyNodeId,
  issues: NumericSanitizeIssue[],
) {
  console.warn(
    `[Scene] Sanitized invalid numeric node ${mutation}`,
    nodeId,
    numericSanitizeIssuesToMessage(issues),
  )
}

function parseCreatedNode(node: AnyNode, parentId: AnyNodeId | null): AnyNode {
  const candidate = { ...node, parentId }
  const parsed = AnyNodeSchema.safeParse(candidate)
  if (parsed.success) return parsed.data

  const schema = getNodeSchemaForType(candidate.type)
  const sanitized = sanitizeNumericValue(schema, candidate, undefined, [])

  if (sanitized.issues.length === 0) {
    return candidate as AnyNode
  }

  warnSanitizedNodeMutation('create', node.id, sanitized.issues)

  return sanitized.value as AnyNode
}

function parseUpdatedNode(currentNode: AnyNode, data: Partial<AnyNode>): AnyNode {
  const candidate = { ...currentNode, ...data }
  const parsed = AnyNodeSchema.safeParse(candidate)
  if (parsed.success) return parsed.data

  const schema = getNodeSchemaForType(candidate.type)
  const sanitized = sanitizeNumericValue(schema, data, currentNode, [])

  if (sanitized.issues.length === 0) {
    return candidate as AnyNode
  }

  warnSanitizedNodeMutation('update', currentNode.id, sanitized.issues)

  return { ...currentNode, ...(sanitized.value as Partial<AnyNode>) } as AnyNode
}

function shouldRefreshDefaultRidgeVents(data: Partial<AnyNode>) {
  return Object.keys(data).some((key) => DEFAULT_RIDGE_VENT_REFRESH_FIELDS.has(key))
}

function refreshDefaultRidgeVentsForSegment(
  nextNodes: Record<AnyNodeId, AnyNode>,
  segment: RoofSegmentNode,
): AnyNodeId[] {
  const childIds = Array.isArray(segment.children) ? (segment.children as AnyNodeId[]) : []
  if (!isAutoRidgeVentEnabled(segment, nextNodes)) return []

  const defaultIds = childIds.filter((childId) =>
    isDefaultRidgeVentNode(nextNodes[childId], segment.id),
  )
  const defaultIdSet = new Set(defaultIds)
  for (const id of defaultIds) {
    delete nextNodes[id]
  }

  const nextVents = createDefaultRidgeVentsForSegment(segment)
  for (const vent of nextVents) {
    nextNodes[vent.id as AnyNodeId] = {
      ...vent,
      parentId: segment.id,
    } as AnyNode
  }

  nextNodes[segment.id as AnyNodeId] = {
    ...segment,
    children: [
      ...childIds.filter((childId) => !defaultIdSet.has(childId)),
      ...nextVents.map((vent) => vent.id as AnyNodeId),
    ],
  } as AnyNode

  return nextVents.map((vent) => vent.id as AnyNodeId)
}

// Track pending RAF for updateNodesAction to prevent multiple queued callbacks
let pendingRafId: number | null = null
let pendingUpdates: Set<AnyNodeId> = new Set()

function pointsEqual(a: [number, number], b: [number, number], tolerance = 1e-6) {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]
  return dx * dx + dz * dz <= tolerance * tolerance
}

function wallLength(wall: Pick<WallNode, 'start' | 'end'>) {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

function getWallEndpointAtPoint(
  wall: Pick<WallNode, 'start' | 'end'>,
  point: [number, number],
): 'start' | 'end' | null {
  if (pointsEqual(wall.start, point)) return 'start'
  if (pointsEqual(wall.end, point)) return 'end'
  return null
}

function getWallFreeEndpoint(wall: Pick<WallNode, 'start' | 'end'>, sharedPoint: [number, number]) {
  return pointsEqual(wall.start, sharedPoint) ? wall.end : wall.start
}

function areWallStylesCompatible(a: WallNode, b: WallNode) {
  const aInterior = getWallSurfaceMaterialSignature(getEffectiveWallSurfaceMaterial(a, 'interior'))
  const bInterior = getWallSurfaceMaterialSignature(getEffectiveWallSurfaceMaterial(b, 'interior'))
  const aExterior = getWallSurfaceMaterialSignature(getEffectiveWallSurfaceMaterial(a, 'exterior'))
  const bExterior = getWallSurfaceMaterialSignature(getEffectiveWallSurfaceMaterial(b, 'exterior'))

  return (
    (a.parentId ?? null) === (b.parentId ?? null) &&
    Math.abs((a.curveOffset ?? 0) - (b.curveOffset ?? 0)) <= 1e-6 &&
    Math.abs((a.thickness ?? 0.2) - (b.thickness ?? 0.2)) <= 1e-6 &&
    Math.abs((a.height ?? 2.5) - (b.height ?? 2.5)) <= 1e-6 &&
    aInterior === bInterior &&
    aExterior === bExterior &&
    a.frontSide === b.frontSide &&
    a.backSide === b.backSide &&
    a.visible === b.visible
  )
}

function areWallsCollinearAcrossPoint(a: WallNode, b: WallNode, sharedPoint: [number, number]) {
  const freeA = getWallFreeEndpoint(a, sharedPoint)
  const freeB = getWallFreeEndpoint(b, sharedPoint)
  const ax = freeA[0] - sharedPoint[0]
  const az = freeA[1] - sharedPoint[1]
  const bx = freeB[0] - sharedPoint[0]
  const bz = freeB[1] - sharedPoint[1]
  const lenA = Math.hypot(ax, az)
  const lenB = Math.hypot(bx, bz)

  if (lenA < 1e-6 || lenB < 1e-6) return false

  const cross = (ax * bz - az * bx) / (lenA * lenB)
  const dot = (ax * bx + az * bz) / (lenA * lenB)
  return Math.abs(cross) <= 1e-4 && dot < -0.999
}

function resolveMergedWallEndpoints(
  primary: WallNode,
  secondary: WallNode,
  sharedPoint: [number, number],
): { start: [number, number]; end: [number, number] } {
  const primaryEndpoint = getWallEndpointAtPoint(primary, sharedPoint)
  const secondaryEndpoint = getWallEndpointAtPoint(secondary, sharedPoint)

  if (primaryEndpoint === 'end' && secondaryEndpoint === 'start') {
    return { start: primary.start, end: secondary.end }
  }
  if (primaryEndpoint === 'start' && secondaryEndpoint === 'end') {
    return { start: secondary.start, end: primary.end }
  }
  if (primaryEndpoint === 'start' && secondaryEndpoint === 'start') {
    return { start: primary.end, end: secondary.end }
  }

  return { start: primary.start, end: secondary.start }
}

function buildMergedWallAttachmentUpdates(
  primary: WallNode,
  secondary: WallNode,
  mergedWallId: AnyNodeId,
  mergedStart: [number, number],
  mergedEnd: [number, number],
  nodes: Record<AnyNodeId, AnyNode>,
): WallAttachmentUpdate[] {
  const mergedLength = Math.max(
    Math.hypot(mergedEnd[0] - mergedStart[0], mergedEnd[1] - mergedStart[1]),
    1e-6,
  )
  const tangentX = (mergedEnd[0] - mergedStart[0]) / mergedLength
  const tangentZ = (mergedEnd[1] - mergedStart[1]) / mergedLength
  const updates: WallAttachmentUpdate[] = []

  const wallChildren = [...(primary.children ?? []), ...(secondary.children ?? [])] as AnyNodeId[]
  for (const childId of wallChildren) {
    const child = nodes[childId]
    if (!(child && 'position' in child && Array.isArray(child.position))) {
      continue
    }

    const sourceWall = child.parentId === secondary.id ? secondary : primary
    const sourceLength = Math.max(wallLength(sourceWall), 1e-6)
    const localX = typeof child.position[0] === 'number' ? child.position[0] : 0
    const worldX =
      sourceWall.start[0] + ((sourceWall.end[0] - sourceWall.start[0]) * localX) / sourceLength
    const worldZ =
      sourceWall.start[1] + ((sourceWall.end[1] - sourceWall.start[1]) * localX) / sourceLength
    const nextLocalX = Math.max(
      0,
      Math.min(
        mergedLength,
        (worldX - mergedStart[0]) * tangentX + (worldZ - mergedStart[1]) * tangentZ,
      ),
    )

    updates.push({
      id: childId,
      data: {
        parentId: mergedWallId,
        wallId: mergedWallId,
        position: [nextLocalX, child.position[1], child.position[2]] as typeof child.position,
        ...('wallT' in child ? { wallT: nextLocalX / mergedLength } : {}),
      } as Partial<AnyNode>,
    })
  }

  return updates
}

function buildWallMergePlans(
  nodes: Record<AnyNodeId, AnyNode>,
  idsToDelete: AnyNodeId[],
): WallMergePlan[] {
  const deletedWalls = idsToDelete
    .map((id) => nodes[id])
    .filter((node): node is WallNode => node?.type === 'wall')
  const skippedWallIds = new Set(idsToDelete)
  const usedWallIds = new Set<AnyNodeId>()
  const mergePlans: WallMergePlan[] = []

  for (const deletedWall of deletedWalls) {
    const junctions: Array<[number, number]> = [deletedWall.start, deletedWall.end]

    for (const junction of junctions) {
      const candidates = Object.values(nodes).filter((node): node is WallNode => {
        if (node?.type !== 'wall') return false
        if (skippedWallIds.has(node.id) || usedWallIds.has(node.id)) return false
        if ((node.parentId ?? null) !== (deletedWall.parentId ?? null)) return false
        return pointsEqual(node.start, junction) || pointsEqual(node.end, junction)
      })

      if (candidates.length !== 2) {
        continue
      }

      const sortedCandidates = [...candidates].sort((a, b) => {
        const attachmentDiff = (b.children?.length ?? 0) - (a.children?.length ?? 0)
        if (attachmentDiff !== 0) {
          return attachmentDiff
        }
        return a.id.localeCompare(b.id)
      })
      const [primary, secondary] = sortedCandidates
      if (
        !(
          primary &&
          secondary &&
          areWallStylesCompatible(primary, secondary) &&
          areWallsCollinearAcrossPoint(primary, secondary, junction)
        )
      ) {
        continue
      }

      const { start, end } = resolveMergedWallEndpoints(primary, secondary, junction)
      const mergedChildren = Array.from(
        new Set([...(primary.children ?? []), ...(secondary.children ?? [])]),
      ) as WallNode['children']
      const attachmentUpdates = buildMergedWallAttachmentUpdates(
        primary,
        secondary,
        primary.id,
        start,
        end,
        nodes,
      )

      mergePlans.push({
        primaryWallId: primary.id,
        secondaryWallId: secondary.id,
        mergedStart: start,
        mergedEnd: end,
        mergedChildren,
        attachmentUpdates,
      })
      usedWallIds.add(primary.id)
      usedWallIds.add(secondary.id)
    }
  }

  return mergePlans
}

export const createNodesAction = (
  set: (fn: (state: SceneState) => Partial<SceneState>) => void,
  get: () => SceneState,
  ops: NodeCreateOp[],
) => {
  if (get().readOnly) return
  set((state) => {
    const nextNodes = { ...state.nodes }
    const nextRootIds = [...state.rootNodeIds]

    for (const { node, parentId } of ops) {
      const effectiveParentId = parentId ?? (node.parentId as AnyNodeId | null) ?? null

      const newNode = parseCreatedNode(node, effectiveParentId)

      nextNodes[newNode.id] = newNode

      // 2. Update the Parent's children list. We append to ANY container
      // parent (kind has `children` in its schema) — if the field is
      // present but undefined (e.g. an old saved scene from before the
      // kind gained children), we initialise to `[]` first so the
      // reparenting goes through. Without this, hosting items on an
      // old shelf (v1, before `children` was added) silently no-ops:
      // the item is reparented to the shelf but the shelf's children
      // array is never updated, so `ParametricNodeRenderer` doesn't
      // mount it and the item "disappears".
      if (effectiveParentId && nextNodes[effectiveParentId]) {
        const parent = nextNodes[effectiveParentId]
        if ('children' in parent) {
          const existing = (parent as { children?: unknown }).children
          const children = Array.isArray(existing) ? (existing as AnyNodeId[]) : []
          nextNodes[effectiveParentId] = {
            ...parent,
            children: Array.from(new Set([...children, newNode.id])) as any,
          }
        }
      } else if (!effectiveParentId) {
        // 3. Handle Root nodes
        if (!nextRootIds.includes(newNode.id)) {
          nextRootIds.push(newNode.id)
        }
      }
    }

    return { nodes: nextNodes, rootNodeIds: nextRootIds }
  })

  // 4. System Sync
  ops.forEach(({ node, parentId }) => {
    get().markDirty(node.id)
    if (parentId) get().markDirty(parentId)
    else if (node.parentId) get().markDirty(node.parentId as AnyNodeId)
  })
}

export const applyNodeChangesAction = (
  set: (fn: (state: SceneState) => Partial<SceneState>) => void,
  get: () => SceneState,
  changes: { create?: NodeCreateOp[]; update?: NodeUpdateOp[]; delete?: NodeDeleteOp[] },
) => {
  if (get().readOnly) return

  const createOps = changes.create ?? []
  const updateOps = changes.update ?? []
  const deleteOps = changes.delete ?? []
  const nodesToMarkDirty = new Set<AnyNodeId>()
  const parentsToMarkDirty = new Set<AnyNodeId>()

  set((state) => {
    const nextNodes = { ...state.nodes }
    const nextCollections = { ...state.collections }
    const nextRootIds = [...state.rootNodeIds]
    let resolvedRootIds = nextRootIds

    for (const { id, data } of updateOps) {
      const currentNode = nextNodes[id]
      if (!currentNode) continue
      const updatedNode = parseUpdatedNode(currentNode, data)

      if (data.parentId !== undefined && data.parentId !== currentNode.parentId) {
        const oldParentId = currentNode.parentId as AnyNodeId | null
        if (oldParentId && nextNodes[oldParentId]) {
          const oldParent = nextNodes[oldParentId] as AnyContainerNode
          nextNodes[oldParent.id] = {
            ...oldParent,
            children: oldParent.children.filter((childId) => childId !== id),
          } as AnyNode
          parentsToMarkDirty.add(oldParent.id)
        }

        const newParentId = data.parentId as AnyNodeId | null
        if (newParentId && nextNodes[newParentId]) {
          const newParent = nextNodes[newParentId] as AnyContainerNode
          nextNodes[newParent.id] = {
            ...newParent,
            children: Array.from(new Set([...newParent.children, id])),
          } as AnyNode
          parentsToMarkDirty.add(newParent.id)
        }
      }

      nextNodes[id] = updatedNode
      if (updatedNode.type === 'roof-segment' && shouldRefreshDefaultRidgeVents(data)) {
        for (const ventId of refreshDefaultRidgeVentsForSegment(nextNodes, updatedNode)) {
          nodesToMarkDirty.add(ventId)
        }
      }
      nodesToMarkDirty.add(id)
    }

    for (const { node, parentId } of createOps) {
      const effectiveParentId = parentId ?? (node.parentId as AnyNodeId | null) ?? null
      const newNode = parseCreatedNode(node, effectiveParentId)

      nextNodes[newNode.id as AnyNodeId] = newNode
      nodesToMarkDirty.add(newNode.id as AnyNodeId)

      if (effectiveParentId && nextNodes[effectiveParentId]) {
        const parent = nextNodes[effectiveParentId]
        if ('children' in parent && Array.isArray(parent.children)) {
          nextNodes[effectiveParentId] = {
            ...parent,
            children: Array.from(new Set([...parent.children, newNode.id])) as any,
          }
          parentsToMarkDirty.add(effectiveParentId)
        }
      } else if (!effectiveParentId && !nextRootIds.includes(newNode.id as AnyNodeId)) {
        nextRootIds.push(newNode.id as AnyNodeId)
      }
    }

    const allIdsToDelete = new Set<AnyNodeId>()
    const collectDelete = (id: AnyNodeId) => {
      if (allIdsToDelete.has(id)) return
      allIdsToDelete.add(id)
      const node = nextNodes[id]
      if (node && 'children' in node && Array.isArray(node.children)) {
        for (const childId of node.children) {
          collectDelete(childId as AnyNodeId)
        }
      }
    }

    for (const id of deleteOps) {
      collectDelete(id)
    }

    for (const id of allIdsToDelete) {
      const node = nextNodes[id]
      if (!node) continue

      const parentId = node.parentId as AnyNodeId | null
      if (parentId && nextNodes[parentId] && !allIdsToDelete.has(parentId)) {
        const parent = nextNodes[parentId] as AnyContainerNode
        if (parent.children) {
          nextNodes[parent.id] = {
            ...parent,
            children: parent.children.filter((childId) => childId !== id),
          } as AnyNode
          parentsToMarkDirty.add(parent.id)
        }
      }

      resolvedRootIds = resolvedRootIds.filter((rootId) => rootId !== id)

      if ('collectionIds' in node && node.collectionIds) {
        for (const collectionId of node.collectionIds as CollectionId[]) {
          const collection = nextCollections[collectionId]
          if (collection) {
            nextCollections[collectionId] = {
              ...collection,
              nodeIds: collection.nodeIds.filter((nodeId) => nodeId !== id),
            }
          }
        }
      }

      delete nextNodes[id]
    }

    return { nodes: nextNodes, rootNodeIds: resolvedRootIds, collections: nextCollections }
  })

  for (const id of nodesToMarkDirty) {
    get().markDirty(id)
  }
  for (const id of parentsToMarkDirty) {
    get().markDirty(id)
    const parent = get().nodes[id]
    if (parent && 'children' in parent && Array.isArray(parent.children)) {
      for (const childId of parent.children) {
        get().markDirty(childId as AnyNodeId)
      }
    }
  }
}

export const updateNodesAction = (
  set: (fn: (state: SceneState) => Partial<SceneState>) => void,
  get: () => SceneState,
  updates: { id: AnyNodeId; data: Partial<AnyNode> }[],
) => {
  if (get().readOnly) return
  const parentsToUpdate = new Set<AnyNodeId>()
  const extraNodesToUpdate = new Set<AnyNodeId>()

  set((state) => {
    const nextNodes = { ...state.nodes }

    for (const { id, data } of updates) {
      const currentNode = nextNodes[id]
      if (!currentNode) continue
      const updatedNode = parseUpdatedNode(currentNode, data)

      // Handle Reparenting Logic
      if (data.parentId !== undefined && data.parentId !== currentNode.parentId) {
        // 1. Remove from old parent
        const oldParentId = currentNode.parentId as AnyNodeId | null
        if (oldParentId && nextNodes[oldParentId]) {
          const oldParent = nextNodes[oldParentId] as AnyContainerNode
          const oldChildren = Array.isArray((oldParent as { children?: unknown }).children)
            ? (oldParent as { children: AnyNodeId[] }).children
            : []
          nextNodes[oldParent.id] = {
            ...oldParent,
            children: oldChildren.filter((childId) => childId !== id),
          } as AnyNode
          parentsToUpdate.add(oldParent.id)
        }

        // 2. Add to new parent. Defensive against parents that don't yet
        // carry a `children` array — older saved scenes can predate the
        // schema field on a particular kind (shelf v1 → v2 added one),
        // and a spread of `undefined` here throws and aborts the entire
        // `set` callback. Initialising to `[]` matches what the schema's
        // default would have produced.
        const newParentId = data.parentId as AnyNodeId | null
        if (newParentId && nextNodes[newParentId]) {
          const newParent = nextNodes[newParentId] as AnyContainerNode
          const newChildren = Array.isArray((newParent as { children?: unknown }).children)
            ? (newParent as { children: AnyNodeId[] }).children
            : []
          nextNodes[newParent.id] = {
            ...newParent,
            children: Array.from(new Set([...newChildren, id])),
          } as AnyNode
          parentsToUpdate.add(newParent.id)
        }
      }

      // Apply the update
      nextNodes[id] = updatedNode
      if (updatedNode.type === 'roof-segment' && shouldRefreshDefaultRidgeVents(data)) {
        for (const ventId of refreshDefaultRidgeVentsForSegment(nextNodes, updatedNode)) {
          extraNodesToUpdate.add(ventId)
        }
      }
    }

    return { nodes: nextNodes }
  })

  // Batch dirty-marking into a single RAF to avoid redundant callbacks during rapid updates
  for (const u of updates) {
    pendingUpdates.add(u.id)
  }
  for (const pId of parentsToUpdate) {
    pendingUpdates.add(pId)
  }
  for (const id of extraNodesToUpdate) {
    pendingUpdates.add(id)
  }

  if (pendingRafId !== null) {
    cancelAnimationFrame(pendingRafId)
  }

  pendingRafId = requestAnimationFrame(() => {
    pendingUpdates.forEach((id) => {
      get().markDirty(id)
    })
    pendingUpdates.clear()
    pendingRafId = null
  })
}

export const deleteNodesAction = (
  set: (fn: (state: SceneState) => Partial<SceneState>) => void,
  get: () => SceneState,
  ids: AnyNodeId[],
) => {
  if (get().readOnly) return
  const parentsToMarkDirty = new Set<AnyNodeId>()
  const nodesToMarkDirty = new Set<AnyNodeId>()
  const deletedIds = new Set<AnyNodeId>()
  const mergePlans = buildWallMergePlans(get().nodes, ids)

  set((state) => {
    const nextNodes = { ...state.nodes }
    const nextCollections = { ...state.collections }
    let nextRootIds = [...state.rootNodeIds]

    // Collect all ids to delete (the requested ids + all their descendants) before
    // mutating anything, so the recursive walk reads consistent state.
    const allIds = new Set<AnyNodeId>()
    const collect = (id: AnyNodeId) => {
      if (allIds.has(id)) return
      allIds.add(id)
      const node = nextNodes[id]
      if (node && 'children' in node) {
        for (const cid of node.children as AnyNodeId[]) collect(cid)
      }
    }
    for (const id of ids) collect(id)
    for (const plan of mergePlans) {
      allIds.add(plan.secondaryWallId)
    }
    for (const id of allIds) deletedIds.add(id)

    // Let each deleted kind undo what it imposed on its neighbours (e.g. an
    // auto-inserted elbow re-extends the duct runs it trimmed back onto the
    // corner it replaced). Read against pre-deletion `nextNodes`; skip
    // patches that target a node also being deleted.
    for (const id of allIds) {
      const node = nextNodes[id]
      if (!node) continue
      const onDelete = nodeRegistry.get(node.type)?.parametrics?.onDelete
      if (!onDelete) continue
      for (const { id: targetId, data } of onDelete(node, nextNodes)) {
        if (allIds.has(targetId)) continue
        const target = nextNodes[targetId]
        if (!target) continue
        nextNodes[targetId] = { ...target, ...data } as AnyNode
        nodesToMarkDirty.add(targetId)
      }
    }

    for (const plan of mergePlans) {
      const primaryWall = nextNodes[plan.primaryWallId]
      if (!(primaryWall && primaryWall.type === 'wall') || allIds.has(plan.primaryWallId)) {
        continue
      }

      nextNodes[plan.primaryWallId] = {
        ...primaryWall,
        start: plan.mergedStart,
        end: plan.mergedEnd,
        children: plan.mergedChildren,
      }
      nodesToMarkDirty.add(plan.primaryWallId)

      for (const update of plan.attachmentUpdates) {
        if (allIds.has(update.id)) continue
        const child = nextNodes[update.id]
        if (!child) continue
        nextNodes[update.id] = { ...child, ...update.data } as AnyNode
        nodesToMarkDirty.add(update.id)
      }
    }

    for (const id of allIds) {
      const node = nextNodes[id]
      if (!node) continue

      // 1. Remove reference from parent — only if the parent itself is NOT also being deleted
      const parentId = node.parentId as AnyNodeId | null
      if (parentId && nextNodes[parentId] && !allIds.has(parentId)) {
        const parent = nextNodes[parentId] as AnyContainerNode
        if (parent.children) {
          nextNodes[parent.id] = {
            ...parent,
            children: parent.children.filter((cid) => cid !== id),
          } as AnyNode
          parentsToMarkDirty.add(parent.id)
        }
      }

      // 2. Remove from root list
      nextRootIds = nextRootIds.filter((rid) => rid !== id)

      // 3. Remove from any collections it belongs to
      if ('collectionIds' in node && node.collectionIds) {
        for (const cid of node.collectionIds as CollectionId[]) {
          const col = nextCollections[cid]
          if (col) {
            nextCollections[cid] = { ...col, nodeIds: col.nodeIds.filter((nid) => nid !== id) }
          }
        }
      }

      // 4. Delete the node itself
      delete nextNodes[id]
    }

    return { nodes: nextNodes, rootNodeIds: nextRootIds, collections: nextCollections }
  })

  // Deleted ids must leave the dirty set: every consumer skips missing
  // nodes without clearing them, so a mark on a deleted node would sit in
  // the set (and defeat the consumers' empty-set early exit) forever.
  for (const id of deletedIds) get().clearDirty(id)

  // Mark affected nodes dirty: parents of deleted nodes and their remaining children
  // (e.g. deleting a slab affects sibling walls via level elevation changes)
  parentsToMarkDirty.forEach((parentId) => {
    get().markDirty(parentId)
    const parent = get().nodes[parentId]
    if (parent && 'children' in parent && Array.isArray(parent.children)) {
      for (const childId of parent.children) {
        get().markDirty(childId as AnyNodeId)
      }
    }
  })
  nodesToMarkDirty.forEach((id) => {
    get().markDirty(id)
  })
}
