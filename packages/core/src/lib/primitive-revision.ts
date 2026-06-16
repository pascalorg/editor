import {
  type PrimitiveEditableDimension,
  type PrimitiveMaterialInput,
  type PrimitiveShapeInput,
  resolvePrimitiveWorldTransforms,
  type Vec3,
} from './primitive-compose'
import {
  buildPrimitiveGeometryFacts,
  getPrimitiveShapeHalfExtents,
  type PrimitiveShapeFact,
} from './primitive-facts'

export type PrimitiveShapeSelector = {
  index?: number
  occurrence?: number
  semanticRole?: string
  semanticGroup?: string
  sourcePartKind?: string
  sourcePartId?: string
  kind?: string
  nameIncludes?: string
}

export type PrimitiveRevisionEdge =
  | 'top'
  | 'bottom'
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'center'

export type PrimitiveRevisionOperation =
  | { op: 'add'; shapes: PrimitiveShapeInput[] }
  | { op: 'remove'; selector: PrimitiveShapeSelector }
  | { op: 'replace'; selector: PrimitiveShapeSelector; shapes: PrimitiveShapeInput[] }
  | {
      op: 'transform'
      selector: PrimitiveShapeSelector
      position?: Vec3
      delta?: Vec3
      rotation?: Vec3
      scale?: Vec3
    }
  | {
      op: 'resize'
      selector: PrimitiveShapeSelector
      length?: number
      width?: number
      height?: number
      depth?: number
      thickness?: number
      radius?: number
      radiusTop?: number
      radiusBottom?: number
      majorRadius?: number
      tubeRadius?: number
    }
  | {
      op: 'scaleSemantic'
      selector: PrimitiveShapeSelector
      dimension?: PrimitiveEditableDimension | string
      factor: number
    }
  | {
      op: 'materialFrom'
      selector: PrimitiveShapeSelector
      from: PrimitiveShapeSelector
    }
  | {
      op: 'setMaterial'
      selector: PrimitiveShapeSelector
      color?: string
      material?: PrimitiveMaterialInput
      materialPreset?: string
    }
  | {
      op: 'align'
      selector: PrimitiveShapeSelector
      to: PrimitiveShapeSelector
      edge: PrimitiveRevisionEdge
      toEdge?: PrimitiveRevisionEdge
      offset?: number
    }

export interface PrimitiveRevisionInput {
  shapes: PrimitiveShapeInput[]
  operations: PrimitiveRevisionOperation[]
}

export interface PrimitiveRevisionResult {
  shapes: PrimitiveShapeInput[]
  issues: string[]
  changedShapeCount: number
}

function cloneShape(shape: PrimitiveShapeInput): PrimitiveShapeInput {
  return {
    ...shape,
    position: shape.position ? [...shape.position] : undefined,
    rotation: shape.rotation ? [...shape.rotation] : undefined,
    scale: shape.scale ? [...shape.scale] : undefined,
    material: shape.material
      ? {
          ...shape.material,
          properties: shape.material.properties ? { ...shape.material.properties } : undefined,
        }
      : undefined,
    editableHints: shape.editableHints
      ? {
          ...shape.editableHints,
          canScale: shape.editableHints.canScale ? [...shape.editableHints.canScale] : undefined,
        }
      : undefined,
    profile: cloneProfile(shape.profile),
    holes: cloneHoles(shape.holes),
    path: clonePath(shape.path),
  }
}

function isFiniteTuple2(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  )
}

function isFiniteTuple3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length >= 3 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1]) &&
    typeof value[2] === 'number' &&
    Number.isFinite(value[2])
  )
}

function cloneProfile(value: unknown): [number, number][] | undefined {
  if (!Array.isArray(value)) return undefined
  const points = value.filter(isFiniteTuple2).map(([x, y]) => [x, y] as [number, number])
  return points.length > 0 ? points : undefined
}

function cloneHoles(value: unknown): [number, number][][] | undefined {
  if (!Array.isArray(value)) return undefined
  const holes = value
    .filter(Array.isArray)
    .map((hole) => cloneProfile(hole))
    .filter((hole): hole is [number, number][] => Array.isArray(hole) && hole.length > 0)
  return holes.length > 0 ? holes : undefined
}

function clonePath(value: unknown): Vec3[] | undefined {
  if (!Array.isArray(value)) return undefined
  const points = value.filter(isFiniteTuple3).map(([x, y, z]) => [x, y, z] as Vec3)
  return points.length > 0 ? points : undefined
}

function cloneMaterial(
  material: PrimitiveMaterialInput | undefined,
): PrimitiveMaterialInput | undefined {
  if (!material) return undefined
  return {
    ...material,
    properties: material.properties ? { ...material.properties } : undefined,
  }
}

function normalizeText(value: string | undefined) {
  return value?.trim().toLowerCase() ?? ''
}

function selectorLabel(selector: PrimitiveShapeSelector) {
  return JSON.stringify(selector)
}

export function selectPrimitiveShapeIndexes(
  shapes: readonly PrimitiveShapeInput[],
  selector: PrimitiveShapeSelector | undefined,
): number[] {
  if (!selector) return []

  const nameNeedle = normalizeText(selector.nameIncludes)
  const role = normalizeText(selector.semanticRole)
  const group = normalizeText(selector.semanticGroup)
  const sourceKind = normalizeText(selector.sourcePartKind)
  const sourceId = normalizeText(selector.sourcePartId)
  const kind = normalizeText(selector.kind)

  const hasMetadataSelector = Boolean(role || group || sourceKind || sourceId || kind || nameNeedle)
  const matches = shapes.flatMap((shape, index) => {
    if (role && normalizeText(shape.semanticRole) !== role) return []
    if (group && normalizeText(shape.semanticGroup) !== group) return []
    if (sourceKind && normalizeText(shape.sourcePartKind) !== sourceKind) return []
    if (sourceId && normalizeText(shape.sourcePartId) !== sourceId) return []
    if (kind && normalizeText(String(shape.kind)) !== kind) return []
    if (nameNeedle && !normalizeText(shape.name).includes(nameNeedle)) return []
    return [index]
  })

  const ordinal =
    typeof selector.occurrence === 'number' && Number.isInteger(selector.occurrence)
      ? selector.occurrence
      : hasMetadataSelector &&
          typeof selector.index === 'number' &&
          Number.isInteger(selector.index)
        ? selector.index
        : undefined

  if (ordinal != null) {
    const match = matches[ordinal]
    return match != null ? [match] : []
  }
  if (typeof selector.index === 'number' && Number.isInteger(selector.index)) {
    return selector.index >= 0 && selector.index < shapes.length ? [selector.index] : []
  }
  return matches
}

function eulerToMatrix(
  euler: Vec3,
): [number, number, number, number, number, number, number, number, number] {
  const [x, y, z] = euler
  const cx = Math.cos(x)
  const sx = Math.sin(x)
  const cy = Math.cos(y)
  const sy = Math.sin(y)
  const cz = Math.cos(z)
  const sz = Math.sin(z)

  return [
    cy * cz,
    -cy * sz,
    sy,
    cx * sz + sx * sy * cz,
    cx * cz - sx * sy * sz,
    -sx * cy,
    sx * sz - cx * sy * cz,
    sx * cz + cx * sy * sz,
    cx * cy,
  ]
}

function rotatedHalfExtents(half: Vec3, rotation: Vec3): Vec3 {
  const m = eulerToMatrix(rotation)
  return [
    Math.abs(m[0]) * half[0] + Math.abs(m[1]) * half[1] + Math.abs(m[2]) * half[2],
    Math.abs(m[3]) * half[0] + Math.abs(m[4]) * half[1] + Math.abs(m[5]) * half[2],
    Math.abs(m[6]) * half[0] + Math.abs(m[7]) * half[1] + Math.abs(m[8]) * half[2],
  ]
}

function shapeFactFor(
  shapes: readonly PrimitiveShapeInput[],
  index: number,
): PrimitiveShapeFact | undefined {
  const transforms = resolvePrimitiveWorldTransforms(shapes, { positionMode: 'world-center' })
  const baseFact = buildPrimitiveGeometryFacts(shapes, transforms).shapes.find(
    (fact) => fact.index === index,
  )
  const shape = shapes[index]
  if (!baseFact || !shape) return baseFact
  const transform = transforms[index]
  const center = transform?.position ?? shape.position ?? baseFact.center
  const halfExtents = rotatedHalfExtents(
    getPrimitiveShapeHalfExtents(shape),
    transform?.rotation ?? shape.rotation ?? [0, 0, 0],
  )
  return {
    ...baseFact,
    center,
    halfExtents,
    min: [center[0] - halfExtents[0], center[1] - halfExtents[1], center[2] - halfExtents[2]],
    max: [center[0] + halfExtents[0], center[1] + halfExtents[1], center[2] + halfExtents[2]],
  }
}

function edgeValue(fact: PrimitiveShapeFact, edge: PrimitiveRevisionEdge): number {
  switch (edge) {
    case 'top':
      return fact.max[1]
    case 'bottom':
      return fact.min[1]
    case 'front':
      return fact.max[2]
    case 'back':
      return fact.min[2]
    case 'left':
      return fact.min[0]
    case 'right':
      return fact.max[0]
    default:
      return fact.center[1]
  }
}

function edgeAxis(edge: PrimitiveRevisionEdge): 0 | 1 | 2 {
  switch (edge) {
    case 'left':
    case 'right':
      return 0
    case 'front':
    case 'back':
      return 2
    default:
      return 1
  }
}

function ensurePosition(shape: PrimitiveShapeInput): Vec3 {
  return shape.position ? [...shape.position] : [0, 0, 0]
}

function operationShapes(value: PrimitiveShapeInput[] | undefined): PrimitiveShapeInput[] {
  return Array.isArray(value) ? value.map(cloneShape) : []
}

function validScale(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1
}

function averageScale(...values: number[]) {
  return values.reduce((sum, value) => sum + validScale(value), 0) / Math.max(1, values.length)
}

function scaleNumber(value: number | undefined, factor: number) {
  return value != null ? value * validScale(factor) : undefined
}

function scaleVec3(value: Vec3 | undefined, scale: Vec3): Vec3 | undefined {
  if (!value) return undefined
  return [
    value[0] * validScale(scale[0]),
    value[1] * validScale(scale[1]),
    value[2] * validScale(scale[2]),
  ]
}

function scalePositionAroundPivot(position: Vec3, pivot: Vec3, scale: Vec3): Vec3 {
  return [
    pivot[0] + (position[0] - pivot[0]) * validScale(scale[0]),
    pivot[1] + (position[1] - pivot[1]) * validScale(scale[1]),
    pivot[2] + (position[2] - pivot[2]) * validScale(scale[2]),
  ]
}

function selectionBoundsPivot(
  shapes: readonly PrimitiveShapeInput[],
  indexes: readonly number[],
): Vec3 {
  let min: Vec3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  let max: Vec3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  let found = false

  for (const index of indexes) {
    const fact = shapeFactFor(shapes, index)
    if (!fact) continue
    found = true
    min = [
      Math.min(min[0], fact.min[0]),
      Math.min(min[1], fact.min[1]),
      Math.min(min[2], fact.min[2]),
    ]
    max = [
      Math.max(max[0], fact.max[0]),
      Math.max(max[1], fact.max[1]),
      Math.max(max[2], fact.max[2]),
    ]
  }

  if (!found) {
    return indexes
      .reduce<Vec3>(
        (sum, index) => {
          const position = ensurePosition(shapes[index] as PrimitiveShapeInput)
          return [sum[0] + position[0], sum[1] + position[1], sum[2] + position[2]]
        },
        [0, 0, 0],
      )
      .map((value) => value / Math.max(1, indexes.length)) as Vec3
  }

  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
}

function scalePrimitiveShapeGeometry(shape: PrimitiveShapeInput, scale: Vec3): PrimitiveShapeInput {
  const sx = validScale(scale[0])
  const sy = validScale(scale[1])
  const sz = validScale(scale[2])
  const uniform = averageScale(sx, sy, sz)
  const xz = averageScale(sx, sz)
  const yz = averageScale(sy, sz)
  const xy = averageScale(sx, sy)

  switch (shape.kind) {
    case 'box':
    case 'wedge':
    case 'trapezoid-prism':
      return {
        ...shape,
        length: scaleNumber(shape.length, sx),
        width: scaleNumber(shape.width, sz),
        height: scaleNumber(shape.height, sy),
        cornerRadius: scaleNumber(shape.cornerRadius, Math.min(sx, sy, sz)),
      }
    case 'rounded-panel':
      return {
        ...shape,
        length: scaleNumber(shape.length, sx),
        width: scaleNumber(shape.width, sz),
        thickness: scaleNumber(shape.thickness ?? shape.height, sy),
        height: scaleNumber(shape.height, sy),
        cornerRadius: scaleNumber(shape.cornerRadius, Math.min(sx, sz)),
      }
    case 'cylinder':
    case 'hollow-cylinder':
    case 'cone':
    case 'capsule':
    case 'half-cylinder': {
      const axis = shape.axis ?? 'y'
      const heightScale = axis === 'x' ? sx : axis === 'z' ? sz : sy
      const radiusScale = axis === 'x' ? yz : axis === 'z' ? xy : xz
      return {
        ...shape,
        height: scaleNumber(shape.height, heightScale),
        radius: scaleNumber(shape.radius, radiusScale),
        wallThickness: scaleNumber(shape.wallThickness, radiusScale),
      }
    }
    case 'frustum': {
      const axis = shape.axis ?? 'y'
      const heightScale = axis === 'x' ? sx : axis === 'z' ? sz : sy
      const radiusScale = axis === 'x' ? yz : axis === 'z' ? xy : xz
      return {
        ...shape,
        height: scaleNumber(shape.height, heightScale),
        radiusTop: scaleNumber(shape.radiusTop, radiusScale),
        radiusBottom: scaleNumber(shape.radiusBottom, radiusScale),
        radius: scaleNumber(shape.radius, radiusScale),
      }
    }
    case 'torus': {
      const axis = shape.axis ?? 'y'
      const radiusScale = axis === 'x' ? yz : axis === 'z' ? xy : xz
      return {
        ...shape,
        majorRadius: scaleNumber(shape.majorRadius, radiusScale),
        tubeRadius: scaleNumber(shape.tubeRadius, radiusScale),
        radius: scaleNumber(shape.radius, radiusScale),
      }
    }
    case 'sphere':
    case 'hemisphere': {
      const existingScale = shape.scale ?? [1, 1, 1]
      return {
        ...shape,
        radius: scaleNumber(shape.radius, uniform),
        scale: [existingScale[0] * sx, existingScale[1] * sy, existingScale[2] * sz],
      }
    }
    case 'lathe':
      return {
        ...shape,
        profile: scaleProfile(shape.profile, xz, sy),
      }
    case 'extrude':
      return {
        ...shape,
        profile: scaleProfile(shape.profile, sx, sy),
        holes: scaleHoles(shape.holes, sx, sy),
        depth: scaleNumber(shape.depth, sz),
        bevelSize: scaleNumber(shape.bevelSize, uniform),
        bevelThickness: scaleNumber(shape.bevelThickness, uniform),
      }
    case 'sweep':
      return {
        ...shape,
        path: clonePath(shape.path)?.map((point) => [point[0] * sx, point[1] * sy, point[2] * sz]),
        radius: scaleNumber(shape.radius, uniform),
      }
    default:
      return { ...shape, scale: scaleVec3(shape.scale ?? [1, 1, 1], scale) }
  }
}

function normalizeEditableDimension(value: unknown): PrimitiveEditableDimension | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value
    .trim()
    .replace(/[\s_-]+/g, '')
    .toLowerCase()
  switch (normalized) {
    case 'primary':
      return 'primary'
    case 'uniform':
    case 'all':
    case 'overall':
      return 'uniform'
    case 'length':
    case 'long':
    case 'longer':
      return 'length'
    case 'width':
    case 'wide':
    case 'wider':
      return 'width'
    case 'height':
    case 'tall':
    case 'taller':
      return 'height'
    case 'depth':
      return 'depth'
    case 'thickness':
    case 'thick':
    case 'thicker':
      return 'thickness'
    case 'radius':
      return 'radius'
    case 'diameter':
      return 'diameter'
    case 'majorradius':
      return 'majorRadius'
    case 'tuberadius':
      return 'tubeRadius'
    case 'axislength':
      return 'axisLength'
    case 'profilex':
      return 'profileX'
    case 'profiley':
      return 'profileY'
    default:
      return undefined
  }
}

function defaultPrimaryDimension(shape: PrimitiveShapeInput): PrimitiveEditableDimension {
  switch (shape.kind) {
    case 'box':
    case 'rounded-panel':
    case 'wedge':
    case 'trapezoid-prism':
      return 'length'
    case 'cylinder':
    case 'hollow-cylinder':
    case 'cone':
    case 'frustum':
    case 'capsule':
    case 'half-cylinder':
      return 'axisLength'
    case 'torus':
      return 'majorRadius'
    case 'sphere':
    case 'hemisphere':
      return 'radius'
    case 'extrude':
      return 'profileX'
    case 'lathe':
      return 'profileY'
    default:
      return 'uniform'
  }
}

function resolveEditableDimension(
  shape: PrimitiveShapeInput,
  requested: unknown,
): PrimitiveEditableDimension {
  const requestedDimension = normalizeEditableDimension(requested)
  if (requestedDimension && requestedDimension !== 'primary') return requestedDimension
  const hinted = normalizeEditableDimension(shape.editableHints?.primaryDimension)
  return hinted && hinted !== 'primary' ? hinted : defaultPrimaryDimension(shape)
}

function clampEditableFactor(shape: PrimitiveShapeInput, factor: number): number {
  const fallbackMin = 0.2
  const fallbackMax = 4
  const min =
    typeof shape.editableHints?.minFactor === 'number' &&
    Number.isFinite(shape.editableHints.minFactor)
      ? shape.editableHints.minFactor
      : fallbackMin
  const max =
    typeof shape.editableHints?.maxFactor === 'number' &&
    Number.isFinite(shape.editableHints.maxFactor)
      ? shape.editableHints.maxFactor
      : fallbackMax
  return Math.max(min, Math.min(max, validScale(factor)))
}

function canScaleDimension(shape: PrimitiveShapeInput, dimension: PrimitiveEditableDimension) {
  const allowed = shape.editableHints?.canScale
    ?.map((entry) => normalizeEditableDimension(entry))
    .filter(Boolean)
  return !allowed?.length || allowed.includes(dimension) || allowed.includes('primary')
}

function scaleProfile(
  profile: [number, number][] | undefined,
  xFactor: number,
  yFactor: number,
): [number, number][] | undefined {
  return cloneProfile(profile)?.map(([x, y]) => [x * xFactor, y * yFactor])
}

function scaleHoles(
  holes: [number, number][][] | undefined,
  xFactor: number,
  yFactor: number,
): [number, number][][] | undefined {
  return cloneHoles(holes)?.map((hole) => hole.map(([x, y]) => [x * xFactor, y * yFactor]))
}

function scalePrimitiveShapeDimension(
  shape: PrimitiveShapeInput,
  requestedDimension: unknown,
  rawFactor: number,
): { shape: PrimitiveShapeInput; issue?: string } {
  const dimension = resolveEditableDimension(shape, requestedDimension)
  if (!canScaleDimension(shape, dimension)) {
    return {
      shape,
      issue: `${shape.name ?? shape.kind}: editableHints do not allow scaling dimension "${dimension}".`,
    }
  }

  const factor = clampEditableFactor(shape, rawFactor)
  switch (dimension) {
    case 'uniform':
      return { shape: scalePrimitiveShapeGeometry(shape, [factor, factor, factor]) }
    case 'length':
      return { shape: { ...shape, length: scaleNumber(shape.length, factor) } }
    case 'width':
      return { shape: { ...shape, width: scaleNumber(shape.width, factor) } }
    case 'height':
      return { shape: { ...shape, height: scaleNumber(shape.height, factor) } }
    case 'depth':
      return { shape: { ...shape, depth: scaleNumber(shape.depth, factor) } }
    case 'thickness':
      return {
        shape: {
          ...shape,
          thickness: scaleNumber(shape.thickness ?? shape.height, factor),
          ...(shape.thickness == null ? { height: scaleNumber(shape.height, factor) } : {}),
        },
      }
    case 'axisLength':
      return { shape: { ...shape, height: scaleNumber(shape.height, factor) } }
    case 'radius':
      return {
        shape: {
          ...shape,
          radius: scaleNumber(shape.radius, factor),
          radiusTop: scaleNumber(shape.radiusTop, factor),
          radiusBottom: scaleNumber(shape.radiusBottom, factor),
        },
      }
    case 'diameter':
      return {
        shape: {
          ...shape,
          radius: scaleNumber(shape.radius, factor),
          radiusTop: scaleNumber(shape.radiusTop, factor),
          radiusBottom: scaleNumber(shape.radiusBottom, factor),
          majorRadius: scaleNumber(shape.majorRadius, factor),
        },
      }
    case 'majorRadius':
      return {
        shape: {
          ...shape,
          majorRadius: scaleNumber(shape.majorRadius ?? shape.radius, factor),
          radius: shape.majorRadius == null ? scaleNumber(shape.radius, factor) : shape.radius,
        },
      }
    case 'tubeRadius':
      return { shape: { ...shape, tubeRadius: scaleNumber(shape.tubeRadius, factor) } }
    case 'profileX':
      return {
        shape: {
          ...shape,
          profile: scaleProfile(shape.profile, factor, 1),
          holes: scaleHoles(shape.holes, factor, 1),
        },
      }
    case 'profileY':
      return {
        shape: {
          ...shape,
          profile: scaleProfile(shape.profile, 1, factor),
          holes: scaleHoles(shape.holes, 1, factor),
        },
      }
    default:
      return { shape: scalePrimitiveShapeGeometry(shape, [factor, factor, factor]) }
  }
}

export function applyPrimitiveRevision(input: PrimitiveRevisionInput): PrimitiveRevisionResult {
  const issues: string[] = []
  let changedShapeCount = 0
  let shapes = input.shapes.map(cloneShape)

  for (let operationIndex = 0; operationIndex < input.operations.length; operationIndex += 1) {
    const operation = input.operations[operationIndex] as PrimitiveRevisionOperation
    const label = `operation ${operationIndex + 1} (${operation.op})`

    if (operation.op === 'remove') {
      const removeSet = new Set<number>()
      let cursor = operationIndex
      while (cursor < input.operations.length) {
        const removeOperation = input.operations[cursor]
        if (removeOperation?.op !== 'remove') break
        const removeLabel = `operation ${cursor + 1} (${removeOperation.op})`
        const indexes = selectPrimitiveShapeIndexes(shapes, removeOperation.selector)
        if (indexes.length === 0) {
          issues.push(
            `${removeLabel}: selector matched no shapes: ${selectorLabel(removeOperation.selector)}`,
          )
        }
        for (const index of indexes) removeSet.add(index)
        cursor += 1
      }
      if (removeSet.size > 0) {
        shapes = shapes.filter((_, index) => !removeSet.has(index))
        changedShapeCount += removeSet.size
      }
      operationIndex = cursor - 1
      continue
    }

    if (operation.op === 'add') {
      const added = operationShapes(operation.shapes)
      if (added.length === 0) {
        issues.push(`${label}: add requires at least one shape.`)
        continue
      }
      shapes = [...shapes, ...added]
      changedShapeCount += added.length
      continue
    }

    const indexes = selectPrimitiveShapeIndexes(shapes, operation.selector)
    if (indexes.length === 0) {
      issues.push(`${label}: selector matched no shapes: ${selectorLabel(operation.selector)}`)
      continue
    }

    if (operation.op === 'replace') {
      const replacements = operationShapes(operation.shapes)
      if (replacements.length === 0) {
        issues.push(`${label}: replace requires at least one replacement shape.`)
        continue
      }
      const replaceSet = new Set(indexes)
      const firstIndex = Math.min(...indexes)
      const next: PrimitiveShapeInput[] = []
      for (let i = 0; i < shapes.length; i += 1) {
        if (i === firstIndex) next.push(...replacements)
        if (!replaceSet.has(i)) next.push(shapes[i] as PrimitiveShapeInput)
      }
      shapes = next
      changedShapeCount += replaceSet.size + replacements.length
      continue
    }

    if (operation.op === 'transform') {
      const scalePivot = operation.scale ? selectionBoundsPivot(shapes, indexes) : undefined

      for (const index of indexes) {
        const shape = shapes[index]
        if (!shape) continue
        const position = ensurePosition(shape)
        const scaledShape = operation.scale
          ? scalePrimitiveShapeGeometry(shape, operation.scale)
          : shape
        shapes[index] = {
          ...scaledShape,
          position: operation.position
            ? [...operation.position]
            : operation.delta
              ? [
                  position[0] + operation.delta[0],
                  position[1] + operation.delta[1],
                  position[2] + operation.delta[2],
                ]
              : operation.scale && scalePivot
                ? scalePositionAroundPivot(position, scalePivot, operation.scale)
                : shape.position,
          rotation: operation.rotation ? [...operation.rotation] : shape.rotation,
        }
        changedShapeCount += 1
      }
      continue
    }

    if (operation.op === 'resize') {
      for (const index of indexes) {
        const shape = shapes[index]
        if (!shape) continue
        shapes[index] = {
          ...shape,
          ...(operation.length != null ? { length: operation.length } : {}),
          ...(operation.width != null ? { width: operation.width } : {}),
          ...(operation.height != null ? { height: operation.height } : {}),
          ...(operation.depth != null ? { depth: operation.depth } : {}),
          ...(operation.thickness != null ? { thickness: operation.thickness } : {}),
          ...(operation.radius != null ? { radius: operation.radius } : {}),
          ...(operation.radiusTop != null ? { radiusTop: operation.radiusTop } : {}),
          ...(operation.radiusBottom != null ? { radiusBottom: operation.radiusBottom } : {}),
          ...(operation.majorRadius != null ? { majorRadius: operation.majorRadius } : {}),
          ...(operation.tubeRadius != null ? { tubeRadius: operation.tubeRadius } : {}),
        }
        changedShapeCount += 1
      }
      continue
    }

    if (operation.op === 'scaleSemantic') {
      if (typeof operation.factor !== 'number' || !Number.isFinite(operation.factor)) {
        issues.push(`${label}: scaleSemantic requires a finite factor.`)
        continue
      }
      for (const index of indexes) {
        const shape = shapes[index]
        if (!shape) continue
        const scaled = scalePrimitiveShapeDimension(shape, operation.dimension, operation.factor)
        if (scaled.issue) {
          issues.push(`${label}: ${scaled.issue}`)
          continue
        }
        shapes[index] = scaled.shape
        changedShapeCount += 1
      }
      continue
    }

    if (operation.op === 'materialFrom') {
      const sourceIndex = selectPrimitiveShapeIndexes(shapes, operation.from)[0]
      const material =
        sourceIndex != null ? cloneMaterial(shapes[sourceIndex]?.material) : undefined
      const materialPreset = sourceIndex != null ? shapes[sourceIndex]?.materialPreset : undefined
      if (!material && !materialPreset) {
        issues.push(
          `${label}: materialFrom source has no material: ${selectorLabel(operation.from)}`,
        )
        continue
      }
      for (const index of indexes) {
        const shape = shapes[index]
        if (!shape) continue
        shapes[index] = { ...shape, material, materialPreset }
        changedShapeCount += 1
      }
      continue
    }

    if (operation.op === 'setMaterial') {
      const material =
        operation.material != null
          ? cloneMaterial(operation.material)
          : operation.color
            ? { type: 'standard' as const, properties: { color: operation.color } }
            : undefined
      if (!material && !operation.materialPreset) {
        issues.push(`${label}: setMaterial requires color, material, or materialPreset.`)
        continue
      }
      for (const index of indexes) {
        const shape = shapes[index]
        if (!shape) continue
        shapes[index] = {
          ...shape,
          material,
          materialPreset: operation.materialPreset,
        }
        changedShapeCount += 1
      }
      continue
    }

    if (operation.op === 'align') {
      const targetIndex = selectPrimitiveShapeIndexes(shapes, operation.to)[0]
      if (targetIndex == null) {
        issues.push(`${label}: align target matched no shapes: ${selectorLabel(operation.to)}`)
        continue
      }
      const targetFact = shapeFactFor(shapes, targetIndex)
      if (!targetFact) {
        issues.push(`${label}: align target has no geometry facts.`)
        continue
      }
      const axis = edgeAxis(operation.edge)
      const targetValue =
        edgeValue(targetFact, operation.toEdge ?? operation.edge) + (operation.offset ?? 0)
      for (const index of indexes) {
        const fact = shapeFactFor(shapes, index)
        const shape = shapes[index]
        if (!fact || !shape) continue
        const currentValue = edgeValue(fact, operation.edge)
        const delta = targetValue - currentValue
        const position = ensurePosition(shape)
        position[axis] += delta
        shapes[index] = { ...shape, position }
        changedShapeCount += 1
      }
    }
  }

  for (const [index, shape] of shapes.entries()) {
    if (!shape.position) {
      const halfExtents = getPrimitiveShapeHalfExtents(shape)
      shapes[index] = { ...shape, position: [0, halfExtents[1], 0] }
    }
  }

  return { shapes, issues, changedShapeCount }
}
