import {
  applyDimensionSemanticsToObjectInput,
  composeObjectPrimitives,
  composePartPrimitives,
  composeRobotArmPrimitives,
  type ObjectComposeInput,
  type PartComposeInput,
  type PrimitiveGeometryBrief,
  type PrimitiveMaterialInput,
  validatePrimitiveSemantics,
  type PrimitiveShapeInput,
  type RobotArmComposeInput,
  resolvePrimitiveWorldTransforms,
  type Vec3,
} from '@pascal-app/core'
import {
  computeGeneratedAssemblyPosition,
  createGeneratedGeometryId,
  formatGeneratedShapeDetails,
  type GeneratedGeometryArtifact,
  inferGeneratedAssemblyName,
  normalizePrimitiveKind,
  type GeneratedGeometryShapeSpec as ShapeSpec,
} from './ai-generated-geometry-core'

export const MAX_GENERATED_GEOMETRY_SHAPES = 80

export type GeometryToolExecutionContext = {
  prompt: string
  revisionOf?: string
  revisionVersion?: number
  replaceNodeIds?: string[]
}

export type GeometryToolExecutionResult = {
  content: string
  artifact?: GeneratedGeometryArtifact
}

export type GeometryToolExecutorOptions = {
  maxShapes?: number
  messages?: {
    unknownTool?: (name: string) => string
    noShapes?: string
    tooComplex?: (actual: number, max: number) => string
  }
}

type RawShape = Omit<PrimitiveShapeInput, 'kind' | 'material'> & {
  kind?: string
  shape?: string
  type?: string
  params?: Record<string, unknown>
  size?: number[]
  color?: number[]
  material?: PrimitiveMaterialInput | Record<string, unknown> | string
  materialColor?: string
}

type SemanticValidationSummary = ReturnType<typeof validatePrimitiveSemantics>

const GEOMETRY_TOOL_NAMES = new Set([
  'compose_primitive',
  'compose_parts',
  'compose_robot_arm',
  'compose_object',
])

const MATERIAL_PRESETS = new Set([
  'white',
  'brick',
  'concrete',
  'wood',
  'glass',
  'metal',
  'plaster',
  'tile',
  'marble',
  'custom',
])

const PRIMITIVE_ANCHORS = new Set(['top', 'bottom', 'center', 'front', 'back', 'left', 'right'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function colorArrayToHex(color: number[]): string {
  return `#${color
    .slice(0, 3)
    .map((channel) =>
      Math.round(Math.max(0, Math.min(1, Number(channel))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

function normalizePrimitiveMaterial(
  rawMaterial: unknown,
  materialColor: unknown,
  color: number[] | undefined,
): PrimitiveMaterialInput | undefined {
  if (typeof rawMaterial === 'string') {
    if (/^(#|rgb\(|rgba\(|hsl\(|hsla\()/i.test(rawMaterial))
      return { properties: { color: rawMaterial } }
    if (MATERIAL_PRESETS.has(rawMaterial)) return { preset: rawMaterial }
  }

  if (isRecord(rawMaterial)) {
    const rawProperties = isRecord(rawMaterial.properties) ? rawMaterial.properties : {}
    const rawColor = rawMaterial.color ?? rawProperties.color
    const rawRoughness = rawMaterial.roughness ?? rawProperties.roughness
    const rawMetalness = rawMaterial.metalness ?? rawProperties.metalness
    const rawOpacity = rawMaterial.opacity ?? rawProperties.opacity
    const rawTransparent = rawMaterial.transparent ?? rawProperties.transparent
    const rawSide = rawMaterial.side ?? rawProperties.side
    const properties: NonNullable<PrimitiveMaterialInput['properties']> = {}

    if (typeof rawColor === 'string') properties.color = rawColor
    if (typeof rawRoughness === 'number' && Number.isFinite(rawRoughness)) {
      properties.roughness = Math.max(0, Math.min(1, rawRoughness))
    }
    if (typeof rawMetalness === 'number' && Number.isFinite(rawMetalness)) {
      properties.metalness = Math.max(0, Math.min(1, rawMetalness))
    }
    if (typeof rawOpacity === 'number' && Number.isFinite(rawOpacity)) {
      properties.opacity = Math.max(0, Math.min(1, rawOpacity))
    }
    if (typeof rawTransparent === 'boolean') properties.transparent = rawTransparent
    if (rawSide === 'front' || rawSide === 'back' || rawSide === 'double') properties.side = rawSide

    const material: PrimitiveMaterialInput = {}
    if (typeof rawMaterial.id === 'string') material.id = rawMaterial.id
    if (typeof rawMaterial.preset === 'string' && MATERIAL_PRESETS.has(rawMaterial.preset)) {
      material.preset = rawMaterial.preset
    }
    if (Object.keys(properties).length > 0) material.properties = properties
    if (material.id || material.preset || material.properties) return material
  }

  if (typeof materialColor === 'string') return { properties: { color: materialColor } }
  if (color?.length) {
    return {
      properties: {
        color: colorArrayToHex(color),
        opacity: typeof color[3] === 'number' ? color[3] : 1,
        transparent: typeof color[3] === 'number' ? color[3] < 1 : false,
      },
    }
  }

  return undefined
}

function isPrimitiveAnchor(value: unknown): value is string {
  return typeof value === 'string' && PRIMITIVE_ANCHORS.has(value)
}

function getExpectedAttachmentSide(
  anchor: string,
  childAnchor: string,
): { axis: 0 | 1 | 2; sign: -1 | 1; label: string } | undefined {
  if (anchor === 'top' && childAnchor === 'bottom')
    return { axis: 1, sign: 1, label: 'above the parent' }
  if (anchor === 'bottom' && childAnchor === 'top')
    return { axis: 1, sign: -1, label: 'below the parent' }
  if (anchor === 'right' && childAnchor === 'left')
    return { axis: 0, sign: 1, label: 'right of the parent' }
  if (anchor === 'left' && childAnchor === 'right')
    return { axis: 0, sign: -1, label: 'left of the parent' }
  if (anchor === 'front' && childAnchor === 'back')
    return { axis: 2, sign: 1, label: 'in front of the parent' }
  if (anchor === 'back' && childAnchor === 'front')
    return { axis: 2, sign: -1, label: 'behind the parent' }
  return undefined
}

function getRawShapes(
  name: string,
  args: Record<string, unknown>,
  prompt: string,
): RawShape[] | undefined {
  if (name === 'compose_parts') return composePartPrimitives(args as PartComposeInput)
  if (name === 'compose_robot_arm') return composeRobotArmPrimitives(args as RobotArmComposeInput)
  if (name === 'compose_object') {
    const dimensionAwareObjectArgs = applyDimensionSemanticsToObjectInput(
      args as ObjectComposeInput,
      prompt,
    )
    return composeObjectPrimitives(dimensionAwareObjectArgs)
  }
  return args.shapes as RawShape[] | undefined
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : undefined
}

function normalizeGeometryBrief(value: unknown): PrimitiveGeometryBrief | undefined {
  if (!isRecord(value)) return undefined
  const requiredRoles = stringArray(value.requiredRoles)
  const semanticRoles = stringArray(value.semanticRoles)
  return {
    ...(value as PrimitiveGeometryBrief),
    coordinateConvention:
      typeof value.coordinateConvention === 'string'
        ? value.coordinateConvention
        : typeof value.coordinateSystem === 'string'
          ? value.coordinateSystem
          : undefined,
    requiredRoles: requiredRoles ?? semanticRoles,
    semanticRoles,
  }
}

function readGeometryBrief(args: Record<string, unknown>): PrimitiveGeometryBrief | undefined {
  const direct = normalizeGeometryBrief(args.geometryBrief)
  if (direct) return direct
  const metadata = isRecord(args.metadata) ? args.metadata : undefined
  return normalizeGeometryBrief(metadata?.geometryBrief)
}

function formatSemanticValidationSummary(validation: SemanticValidationSummary): string {
  if (validation.family === 'unknown' && validation.issues.length === 0 && validation.warnings.length === 0) {
    return ''
  }

  const roleSummary = Object.entries(validation.facts.roles)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([role, count]) => `${role}:${count}`)
    .join(', ')

  const parts = [
    `Validation: family=${validation.family}, score=${validation.score.toFixed(2)}`,
  ]
  if (roleSummary) parts.push(`roles=[${roleSummary}]`)
  if (validation.warnings.length > 0) {
    parts.push(`warnings=[${validation.warnings.join('; ')}]`)
  }
  return parts.join(' ')
}

export function normalizeGeometryToolShapes(rawShapes: RawShape[]): ShapeSpec[] {
  return rawShapes.map((shape) => {
    const shapeRecord = shape as Record<string, unknown>
    const params = isRecord(shapeRecord.params) ? shapeRecord.params : {}
    const read = (key: string) => shapeRecord[key] ?? params[key]
    const size = Array.isArray(read('size')) ? (read('size') as number[]) : undefined
    const color = Array.isArray(read('color')) ? (read('color') as number[]) : undefined
    const material = normalizePrimitiveMaterial(read('material'), read('materialColor'), color)

    const kind = normalizePrimitiveKind(read('kind') ?? read('shape') ?? read('type'))
    const isBoxLike =
      kind === 'box' || kind === 'rounded-panel' || kind === 'wedge' || kind === 'trapezoid-prism'
    const isAxisLengthPrimitive =
      kind === 'cylinder' ||
      kind === 'hollow-cylinder' ||
      kind === 'cone' ||
      kind === 'frustum' ||
      kind === 'capsule' ||
      kind === 'half-cylinder' ||
      kind === 'hemisphere'
    const rawLength = read('length')
    const rawWidth = read('width')
    const rawHeight = read('height')
    const rawDepth = read('depth')
    const rawThickness = read('thickness')
    const rawWheelWidth = read('wheelWidth')
    const naturalWidthDepth = isBoxLike && rawLength == null && rawWidth != null && rawDepth != null
    const normalizedLength = rawLength ?? (naturalWidthDepth ? rawWidth : undefined) ?? size?.[0]
    const normalizedWidth =
      (isBoxLike ? rawDepth : undefined) ?? rawWidth ?? (isBoxLike ? size?.[2] : undefined)
    const normalizedHeight = isAxisLengthPrimitive
      ? (rawHeight ?? rawLength ?? rawDepth ?? rawWheelWidth ?? rawWidth ?? size?.[1])
      : (rawHeight ?? size?.[1])
    const normalizedThickness =
      kind === 'rounded-panel' ? (rawThickness ?? rawHeight ?? size?.[1]) : rawThickness
    const normalizedDepth = kind === 'extrude' ? (rawDepth ?? rawWidth ?? size?.[2]) : rawDepth
    return {
      kind,
      position: (read('position') as Vec3) ?? [0, 0, 0],
      rotation: (read('rotation') as Vec3) ?? [0, 0, 0],
      scale: (read('scale') as Vec3) ?? [1, 1, 1],
      name: read('name') as string | undefined,
      semanticRole: read('semanticRole') as string | undefined,
      semanticGroup: read('semanticGroup') as string | undefined,
      sourcePartKind: read('sourcePartKind') as string | undefined,
      sourcePartId: read('sourcePartId') as string | undefined,
      length: normalizedLength as number | undefined,
      width: normalizedWidth as number | undefined,
      height: normalizedHeight as number | undefined,
      depth: normalizedDepth as number | undefined,
      thickness: normalizedThickness as number | undefined,
      cornerRadius: read('cornerRadius') as number | undefined,
      cornerSegments: read('cornerSegments') as number | undefined,
      radius: read('radius') as number | undefined,
      radiusTop: read('radiusTop') as number | undefined,
      radiusBottom: read('radiusBottom') as number | undefined,
      majorRadius: read('majorRadius') as number | undefined,
      tubeRadius: read('tubeRadius') as number | undefined,
      topScale: read('topScale') as [number, number] | undefined,
      topLengthScale: read('topLengthScale') as number | undefined,
      topWidthScale: read('topWidthScale') as number | undefined,
      slopeAxis: read('slopeAxis') as string | undefined,
      slopeDirection: read('slopeDirection') as string | undefined,
      axis: read('axis') as string | undefined,
      capSegments: read('capSegments') as number | undefined,
      radialSegments: read('radialSegments') as number | undefined,
      tubularSegments: read('tubularSegments') as number | undefined,
      widthSegments: read('widthSegments') as number | undefined,
      heightSegments: read('heightSegments') as number | undefined,
      wallThickness: read('wallThickness') as number | undefined,
      profile: read('profile') as [number, number][] | undefined,
      path: read('path') as Vec3[] | undefined,
      segments: read('segments') as number | undefined,
      arc: read('arc') as number | undefined,
      bevelSize: read('bevelSize') as number | undefined,
      bevelThickness: read('bevelThickness') as number | undefined,
      bevelSegments: read('bevelSegments') as number | undefined,
      curveSegments: read('curveSegments') as number | undefined,
      closed: read('closed') as boolean | undefined,
      material,
      materialPreset: read('materialPreset') as string | undefined,
      attachTo: read('attachTo') as number | undefined,
      anchor: read('anchor') as string | undefined,
      childAnchor: read('childAnchor') as string | undefined,
    }
  })
}

export function validateGeometryToolShapes(shapes: ShapeSpec[]): string[] {
  const isPositiveNumber = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0

  return shapes.flatMap((shape, index) => {
    const label = shape.name ?? `${shape.kind} #${index + 1}`
    const issues: string[] = []
    if (
      shape.attachTo != null &&
      (!Number.isInteger(shape.attachTo) || shape.attachTo < 0 || shape.attachTo >= index)
    ) {
      issues.push(
        `${label}: attachTo must reference an earlier shape in the SAME compose_primitive call; got ${shape.attachTo}.`,
      )
    }
    if (
      shape.attachTo != null &&
      (!isPrimitiveAnchor(shape.anchor) || !isPrimitiveAnchor(shape.childAnchor))
    ) {
      issues.push(
        `${label}: attachTo requires explicit anchor and childAnchor. Examples: under desktop uses anchor="bottom", childAnchor="top"; front handle uses anchor="front", childAnchor="back".`,
      )
    }
    if (
      shape.attachTo != null &&
      isPrimitiveAnchor(shape.anchor) &&
      isPrimitiveAnchor(shape.childAnchor)
    ) {
      const parent = shapes[shape.attachTo]
      const expectedSide = getExpectedAttachmentSide(shape.anchor, shape.childAnchor)
      if (parent && expectedSide) {
        const delta = shape.position[expectedSide.axis] - parent.position[expectedSide.axis]
        if (Number.isFinite(delta) && Math.abs(delta) > 0.02 && delta * expectedSide.sign < -0.02) {
          issues.push(
            `${label}: anchor="${shape.anchor}" and childAnchor="${shape.childAnchor}" place the child ${expectedSide.label}, but its world-center position is on the opposite side of "${parent.name ?? parent.kind}". Reverse the anchors or remove attachTo.`,
          )
        }
      }
    }

    switch (shape.kind) {
      case 'box':
        if (!isPositiveNumber(shape.length))
          issues.push(`${label}: box.length is required (X left-right).`)
        if (!isPositiveNumber(shape.width))
          issues.push(`${label}: box.width is required (Z front-back depth).`)
        if (!isPositiveNumber(shape.height))
          issues.push(`${label}: box.height is required (Y vertical).`)
        break
      case 'rounded-panel':
        if (!isPositiveNumber(shape.length))
          issues.push(`${label}: rounded-panel.length is required (X left-right).`)
        if (!isPositiveNumber(shape.width))
          issues.push(`${label}: rounded-panel.width is required (Z front-back depth).`)
        if (!isPositiveNumber(shape.thickness))
          issues.push(`${label}: rounded-panel.thickness is required (Y thickness).`)
        break
      case 'wedge':
      case 'trapezoid-prism':
        if (!isPositiveNumber(shape.length))
          issues.push(`${label}: ${shape.kind}.length is required (X left-right).`)
        if (!isPositiveNumber(shape.width))
          issues.push(`${label}: ${shape.kind}.width is required (Z front-back depth).`)
        if (!isPositiveNumber(shape.height))
          issues.push(`${label}: ${shape.kind}.height is required (Y vertical).`)
        break
      case 'cylinder':
      case 'hollow-cylinder':
      case 'cone':
      case 'capsule':
      case 'half-cylinder':
        if (!isPositiveNumber(shape.radius))
          issues.push(`${label}: ${shape.kind}.radius is required.`)
        if (!isPositiveNumber(shape.height))
          issues.push(`${label}: ${shape.kind}.height is required along axis.`)
        break
      case 'frustum':
        if (!isPositiveNumber(shape.radiusTop))
          issues.push(`${label}: frustum.radiusTop is required.`)
        if (!isPositiveNumber(shape.radiusBottom))
          issues.push(`${label}: frustum.radiusBottom is required.`)
        if (!isPositiveNumber(shape.height))
          issues.push(`${label}: frustum.height is required along axis.`)
        break
      case 'sphere':
        if (!isPositiveNumber(shape.radius)) issues.push(`${label}: sphere.radius is required.`)
        break
      case 'hemisphere':
        if (!isPositiveNumber(shape.radius)) issues.push(`${label}: hemisphere.radius is required.`)
        break
      case 'torus':
        if (!isPositiveNumber(shape.majorRadius ?? shape.radius))
          issues.push(`${label}: torus.majorRadius is required.`)
        if (!isPositiveNumber(shape.tubeRadius))
          issues.push(`${label}: torus.tubeRadius is required.`)
        break
      case 'lathe':
        if (!Array.isArray(shape.profile) || shape.profile.length < 2) {
          issues.push(`${label}: lathe.profile needs at least 2 [radius,height] points.`)
        }
        break
      case 'extrude':
        if (!Array.isArray(shape.profile) || shape.profile.length < 3) {
          issues.push(`${label}: extrude.profile needs at least 3 closed outline points.`)
        }
        if (!isPositiveNumber(shape.depth)) issues.push(`${label}: extrude.depth is required.`)
        break
      case 'sweep':
        if (!Array.isArray(shape.path) || shape.path.length < 2) {
          issues.push(`${label}: sweep.path needs at least 2 [x,y,z] points.`)
        }
        if (!isPositiveNumber(shape.radius)) issues.push(`${label}: sweep.radius is required.`)
        break
      default:
        issues.push(`${label}: unsupported kind "${shape.kind}".`)
    }
    return issues
  })
}

export function executeGeometryToolCall(
  name: string,
  args: Record<string, unknown>,
  context: GeometryToolExecutionContext,
  options: GeometryToolExecutorOptions = {},
): GeometryToolExecutionResult {
  if (!GEOMETRY_TOOL_NAMES.has(name)) {
    return {
      content: options.messages?.unknownTool?.(name) ?? `Unknown tool: ${name}`,
    }
  }

  const rawShapes = getRawShapes(name, args, context.prompt)
  if (!rawShapes?.length) {
    return { content: options.messages?.noShapes ?? 'No geometry could be created.' }
  }

  const maxShapes = options.maxShapes ?? MAX_GENERATED_GEOMETRY_SHAPES
  if (rawShapes.length > maxShapes) {
    return {
      content:
        options.messages?.tooComplex?.(rawShapes.length, maxShapes) ??
        [
          'Geometry is too complex to create safely. Nothing was created.',
          `Generated ${rawShapes.length} shapes, but the limit is ${maxShapes}.`,
          `Simplify the object to at most ${maxShapes} generated shapes or use fewer repeated details.`,
        ].join('\n'),
    }
  }

  const shapes = normalizeGeometryToolShapes(rawShapes)
  const validationIssues = validateGeometryToolShapes(shapes)

  if (validationIssues.length > 0) {
    return {
      content: [
        'Invalid geometry tool call. Nothing was created.',
        'Fix the arguments and call exactly one geometry tool again.',
        ...validationIssues.map((issue) => `- ${issue}`),
      ].join('\n'),
    }
  }

  const transforms = resolvePrimitiveWorldTransforms(shapes as PrimitiveShapeInput[], {
    positionMode: 'world-center',
  })
  const semanticValidation = validatePrimitiveSemantics(shapes as PrimitiveShapeInput[], transforms, {
    toolName: name,
    prompt: context.prompt,
    sourceArgs: args,
    geometryBrief: readGeometryBrief(args),
  })

  if (!semanticValidation.ok) {
    return {
      content: [
        'Invalid geometry tool call. Nothing was created.',
        'Fix the arguments and call exactly one geometry tool again.',
        ...semanticValidation.issues.map((issue) => `- ${issue}`),
        ...semanticValidation.warnings.map((warning) => `- Warning: ${warning}`),
      ].join('\n'),
    }
  }

  const shouldCreateAssembly = shapes.length > 1
  const assemblyPosition = computeGeneratedAssemblyPosition(transforms)
  const assemblyName = shouldCreateAssembly ? inferGeneratedAssemblyName(name, args, shapes) : null
  const created = shapes.map((shape) => shape.name ?? shape.kind)
  const shapeDetails = formatGeneratedShapeDetails(shapes, transforms)
  const title = assemblyName ?? created[0] ?? 'Generated geometry'
  const artifact: GeneratedGeometryArtifact = {
    id: createGeneratedGeometryId(),
    title,
    sourceTool: name,
    sourceArgs: args,
    userPrompt: context.prompt,
    revisionOf: context.revisionOf,
    version:
      context.revisionVersion != null ? context.revisionVersion + 1 : context.revisionOf ? 2 : 1,
    createdAt: new Date().toISOString(),
    shapes,
    transforms,
    assemblyName,
    assemblyPosition,
    createdNames: created,
    shapeDetails,
    replaceNodeIds: context.replaceNodeIds?.length ? context.replaceNodeIds : undefined,
  }

  const header = assemblyName
    ? `Created draft assembly "${assemblyName}" with ${created.length} shapes at [${assemblyPosition.join(',')}]:`
    : `Created draft with ${created.length} shapes:`
  const semanticSummary = formatSemanticValidationSummary(semanticValidation)

  return {
    artifact,
    content: `${header}
${shapeDetails}
${semanticSummary ? `${semanticSummary}\n` : ''}
Names: ${created.join(', ')}`,
  }
}
