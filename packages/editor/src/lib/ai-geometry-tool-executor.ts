import {
  type AssemblyComposeInput,
  composeAssemblyPrimitives,
  getAssemblyGeometryBrief,
} from '@pascal-app/core/lib/assembly-compose'
import {
  alignPrimaryShapeColorsToConstraints,
  extractUserGeometryConstraints,
  validateAssemblyConstraints,
} from '@pascal-app/core/lib/assembly-constraints'
import {
  applyDeviceProfileToPartInput,
  buildDraftDeviceProfile,
  type DeviceProfileDefinition,
  type DeviceProfileQualityScore,
  type DeviceProfileValidation,
  evaluateDeviceProfileQuality,
  inferDeviceProfileDefinition,
  validateDeviceProfileForExecution,
} from '@pascal-app/core/lib/device-profile-registry'
import { parseDimensionSemantics } from '@pascal-app/core/lib/dimension-semantics'
import {
  executableFamilyForLayoutFamily,
  inferFamilyDefinition,
} from '@pascal-app/core/lib/family-registry'
import {
  composePartPrimitives,
  type PartComposeInput,
  type PartComposePartInput,
  resolveLayout,
} from '@pascal-app/core/lib/part-compose'
import {
  getPartDefinitions,
  normalizeAircraftPartPlan,
  normalizeGenericPartPlan,
  normalizePartPlanForFamily,
  normalizeVehiclePartPlan,
} from '@pascal-app/core/lib/part-registry'
import {
  expandPrimitiveShapeArrays,
  type PrimitiveArrayExpandableShape,
  type PrimitiveGeometryBrief,
  type PrimitiveMaterialInput,
  type PrimitiveShapeInput,
  resolvePrimitiveWorldTransforms,
  type Vec3,
} from '@pascal-app/core/lib/primitive-compose'
import {
  type ComposeRecipeInput,
  composeRecipePrimitives,
  getPrimitiveRecipeGeometryBrief,
} from '@pascal-app/core/lib/primitive-recipes'
import { lowerDerivedPrimitiveShape } from '@pascal-app/core/lib/primitive-registry'
import {
  applyPrimitiveRevision,
  type PrimitiveRevisionOperation,
} from '@pascal-app/core/lib/primitive-revision'
import { validatePrimitiveSemantics } from '@pascal-app/core/lib/primitive-semantic-validation'
import { assessPrimitiveVisualQuality } from '@pascal-app/core/lib/primitive-visual-quality'
import {
  composeRobotArmPrimitives,
  type RobotArmComposeInput,
} from '@pascal-app/core/lib/robot-arm-compose'
import { isOpenAssemblyCapabilityRequest } from './ai-chat-harness/capability-planner'
import { parseGeometryIntent } from './ai-chat-harness/geometry-intent'
import { planGeometryIntent } from './ai-chat-harness/geometry-intent-planner'
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
  revisionTarget?: GeneratedGeometryArtifact | null
  blueprintRequiredRoles?: string[]
  blueprintCategory?: string
  deviceProfiles?: readonly DeviceProfileDefinition[]
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
type VisualQualitySummary = ReturnType<typeof assessPrimitiveVisualQuality>

const GEOMETRY_TOOL_NAMES = new Set([
  'compose_primitive',
  'compose_parts',
  'compose_recipe',
  'compose_assembly',
  'revise_geometry',
  'compose_robot_arm',
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

function readGeometryIntentArgument(args: Record<string, unknown>) {
  return (
    parseGeometryIntent(args.geometryIntent) ??
    parseGeometryIntent(args.revisionIntent) ??
    parseGeometryIntent(args.createIntent) ??
    parseGeometryIntent(args.intent)
  )
}

function applyDeterministicGeometryIntentPlan(
  name: string,
  args: Record<string, unknown>,
  context: GeometryToolExecutionContext,
) {
  const intent = readGeometryIntentArgument(args)
  if (!intent) return

  const plan = planGeometryIntent(intent, { revisionTarget: context.revisionTarget })
  if (plan.action === 'create') {
    if (name !== plan.tool) {
      args.__intentPlanningIssues = [
        `create_intent_tool_mismatch: planned ${plan.tool}, received ${name}`,
      ]
      return
    }
    for (const [key, value] of Object.entries(plan.args)) {
      args[key] = value
    }
    if (plan.issues.length > 0) args.__intentPlanningIssues = plan.issues
    return
  }

  if (name !== 'revise_geometry') {
    args.__intentPlanningIssues = ['revision_intent_requires_revise_geometry']
    return
  }
  if (plan.issues.length > 0) {
    args.__intentPlanningIssues = plan.issues
    return
  }
  args.operations = plan.operations
  args.targetArtifactId = args.targetArtifactId ?? plan.args.targetArtifactId
  args.userVisiblePlan =
    typeof args.userVisiblePlan === 'string' ? args.userVisiblePlan : plan.args.userVisiblePlan
  if (typeof args.intent !== 'string') args.intent = plan.args.intent
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNestedNumber(source: Record<string, unknown>, key: string): number | undefined {
  const direct = source[key]
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct
  for (const containerKey of ['params', 'dimensions']) {
    const container = source[containerKey]
    if (!isRecord(container)) continue
    const nested = container[key]
    if (typeof nested === 'number' && Number.isFinite(nested)) return nested
  }
  return undefined
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

function containsGlassText(value: unknown): boolean {
  return typeof value === 'string' && /glass|glazing|window|玻璃|透明/i.test(value)
}

function shouldApplyGlassMaterial(
  shape: RawShape,
  kind: string,
  material: PrimitiveMaterialInput | undefined,
  materialPreset: unknown,
  prompt: string | undefined,
  expandedShapeCount: number,
): boolean {
  if (material?.preset === 'glass') return true
  if (materialPreset === 'preset-glass' || materialPreset === 'glass') return true

  const shapeText = [
    shape.name,
    shape.semanticRole,
    shape.semanticGroup,
    shape.sourcePartKind,
    shape.sourcePartId,
  ]
    .filter(Boolean)
    .join(' ')
  if (containsGlassText(shapeText)) return true

  const promptRequestsGlass = containsGlassText(prompt)
  if (!promptRequestsGlass) return false
  if (expandedShapeCount === 1) return true
  return kind === 'rounded-panel' || kind === 'ellipse-panel' || kind === 'semi-ellipse-panel'
}

function withGlassMaterial(material: PrimitiveMaterialInput | undefined): PrimitiveMaterialInput {
  return {
    ...material,
    preset: 'glass',
    properties: {
      ...material?.properties,
      transparent: material?.properties?.transparent ?? true,
      opacity: material?.properties?.opacity ?? 0.35,
      roughness: material?.properties?.roughness ?? 0.08,
      metalness: material?.properties?.metalness ?? 0.05,
      side: material?.properties?.side ?? 'double',
    },
  }
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

const PART_DIMENSION_KEYS = [
  'length',
  'width',
  'depth',
  'height',
  'diameter',
  'radius',
  'thickness',
] as const

function applyPromptDimensionSemanticsToPartInput(
  args: Record<string, unknown>,
  prompt: string,
): Record<string, unknown> {
  const dimensions = parseDimensionSemantics(prompt)
  if (Object.keys(dimensions).length === 0) return args

  const geometryBrief = isRecord(args.geometryBrief) ? { ...args.geometryBrief } : {}
  const expectedDimensions = isRecord(geometryBrief.expectedDimensions)
    ? { ...geometryBrief.expectedDimensions }
    : {}
  let changed = false

  const next: Record<string, unknown> = { ...args }
  for (const key of PART_DIMENSION_KEYS) {
    const value = dimensions[key]
    if (typeof value !== 'number') continue
    if (expectedDimensions[key] == null) {
      expectedDimensions[key] = value
      changed = true
    }
    if (next[key] == null) {
      next[key] = value
      changed = true
    }
  }

  if (!changed) return args
  return {
    ...next,
    geometryBrief: {
      ...geometryBrief,
      expectedDimensions,
    },
  }
}

function simpleBoxPrimitiveFallbackShapes(
  targetArgs: Record<string, unknown>,
  sourceArgs: Record<string, unknown>,
  prompt: string,
): RawShape[] | undefined {
  if (!Array.isArray(sourceArgs.parts) || sourceArgs.parts.length !== 1) return undefined
  const part = sourceArgs.parts[0]
  if (!isRecord(part)) return undefined
  const kind = String(part.kind ?? part.partType ?? part.type ?? '').toLowerCase()
  if (kind !== 'generic_body') return undefined

  const text = genericFallbackText(sourceArgs, prompt).toLowerCase()
  const semanticRole = String(part.semanticRole ?? '').toLowerCase()
  const readsAsPlainBox =
    /cuboid|cube|rectangular prism|rectangular block|plain box|simple box|\bbox\b|10\s*[*x×]\s*10/.test(
      text,
    ) ||
    semanticRole === 'enclosure' ||
    semanticRole === 'main_body' ||
    semanticRole === 'body'
  if (!readsAsPlainBox) return undefined

  const length = readNestedNumber(part, 'length') ?? readNestedNumber(sourceArgs, 'length')
  const width =
    readNestedNumber(part, 'width') ??
    readNestedNumber(part, 'depth') ??
    readNestedNumber(sourceArgs, 'width') ??
    readNestedNumber(sourceArgs, 'depth')
  const height = readNestedNumber(part, 'height') ?? readNestedNumber(sourceArgs, 'height')
  if (
    typeof length !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    length <= 0 ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined
  }

  targetArgs.length = length
  targetArgs.width = width
  targetArgs.height = height
  targetArgs.geometryBrief =
    typeof targetArgs.geometryBrief === 'string'
      ? targetArgs.geometryBrief
      : `simple rectangular cuboid ${length}x${width}x${height}m`
  targetArgs.shapes = [
    {
      id: String(part.id ?? 'cuboid_body'),
      kind: 'box',
      semanticRole: semanticRole || 'cuboid_body',
      length,
      width,
      height,
      material: isRecord(part.material) ? (part.material as PrimitiveMaterialInput) : undefined,
    },
  ]
  return targetArgs.shapes as RawShape[]
}

function precisionIndustrialPartRoutingText(
  sourceArgs: Record<string, unknown>,
  prompt: string,
  context?: GeometryToolExecutionContext,
): string {
  return [
    prompt,
    context?.blueprintCategory,
    context?.blueprintRequiredRoles?.join(' '),
    sourceArgs.name,
    sourceArgs.object,
    sourceArgs.category,
    sourceArgs.geometryBrief,
    JSON.stringify(sourceArgs.parts ?? []),
  ]
    .map(textOf)
    .join(' ')
    .toLowerCase()
}

function precisionIndustrialPartFallbackShapes(
  targetArgs: Record<string, unknown>,
  sourceArgs: Record<string, unknown>,
  prompt: string,
  context?: GeometryToolExecutionContext,
): RawShape[] | undefined {
  const text = precisionIndustrialPartRoutingText(sourceArgs, prompt, context)
  const sourceFamily =
    typeof sourceArgs.family === 'string' ? sourceArgs.family.trim().toLowerCase() : ''
  const expectedDimensions = isRecord(readGeometryBrief(sourceArgs)?.expectedDimensions)
    ? readGeometryBrief(sourceArgs)?.expectedDimensions
    : {}
  const length = firstNumber(sourceArgs.length, expectedDimensions?.length)
  const width = firstNumber(sourceArgs.width, sourceArgs.depth, expectedDimensions?.width)
  const height = firstNumber(sourceArgs.height, expectedDimensions?.height)
  const explicitRadius = firstNumber(sourceArgs.radius)
  const explicitDiameter = firstNumber(sourceArgs.diameter, expectedDimensions?.diameter)
  const hasConcreteProfileRoute = sourceArgs.deviceProfile != null
  const hasProfileRoute =
    sourceArgs.deviceProfile != null ||
    sourceArgs.deviceProfileDraft != null ||
    sourceArgs.__deviceProfileDefinition != null

  if (
    !hasConcreteProfileRoute &&
    /(\u5367\u5f0f|\u50a8\u7f50|\u538b\u529b\u7f50|\u538b\u529b\u5bb9\u5668|storage[_\s-]?tank|pressure[_\s-]?(tank|vessel)|horizontal[_\s-]?(tank|vessel))/i.test(
      text,
    ) &&
    sourceFamily !== 'tank' &&
    !/(\u53cd\u5e94\u91dc|\u53cd\u5e94\u5668|reactor|agitator|stirred)/i.test(text)
  ) {
    const tankRadius = explicitRadius ?? (explicitDiameter != null ? explicitDiameter / 2 : 0.34)
    const parts: PartComposePartInput[] = [
      {
        kind: 'cylindrical_tank',
        semanticRole: 'vessel_shell',
        axis: 'x',
        length: length ?? 2.2,
        radius: tankRadius,
      },
    ]
    const shapes = composePartPrimitives({
      ...(sourceArgs as PartComposeInput),
      name: typeof sourceArgs.name === 'string' ? sourceArgs.name : 'horizontal pressure tank',
      detail: typeof sourceArgs.detail === 'string' ? sourceArgs.detail : 'medium',
      parts,
    }) as RawShape[]
    if (shapes.length === 0) return undefined
    targetArgs.__precisionPartRoute = 'cylindrical_tank'
    targetArgs.family = 'tank'
    targetArgs.parts = parts
    return shapes
  }

  if (
    !hasConcreteProfileRoute &&
    !/(\u673a\u5668\u81c2|\u673a\u68b0\u81c2|\u516d\u8f74|\u4e03\u8f74|\u56db\u8f74|robot[_\s-]?arm|industrial[_\s-]?robot|six[_\s-]?axis|6[_\s-]?axis|seven[_\s-]?axis|7[_\s-]?axis|four[_\s-]?axis|4[_\s-]?axis|fanuc|kuka|abb)/i.test(
      text,
    ) &&
    /(\u68c0\u4fee\u5e73\u53f0|\u5de5\u4e1a\u5e73\u53f0|\u722c\u68af|access[_\s-]?platform|inspection[_\s-]?platform|platform[_\s-]?ladder)/i.test(
      text,
    ) &&
    !/(tank|reactor|pump|compressor|heat_exchanger|machine_tool|conveyor|outdoor_ac|fan|electrical|valve)/.test(
      sourceFamily,
    ) &&
    !/(\u50a8\u7f50|\u538b\u529b\u7f50|\u538b\u529b\u5bb9\u5668|\u53cd\u5e94\u91dc|\u53cd\u5e94\u5668|storage[_\s-]?tank|pressure[_\s-]?(tank|vessel)|reactor|agitator|stirred)/i.test(
      text,
    )
  ) {
    const parts: PartComposePartInput[] = [
      {
        kind: 'platform_ladder',
        semanticRole: 'access_platform',
        length: length ?? 1,
        width: width ?? 0.6,
        height: height ?? 1.4,
        count: firstNumber(sourceArgs.count) ?? 7,
      },
    ]
    const shapes = composePartPrimitives({
      ...(sourceArgs as PartComposeInput),
      name: typeof sourceArgs.name === 'string' ? sourceArgs.name : 'industrial access platform',
      detail: typeof sourceArgs.detail === 'string' ? sourceArgs.detail : 'medium',
      parts,
    }) as RawShape[]
    if (shapes.length === 0) return undefined
    targetArgs.__precisionPartRoute = 'platform_ladder'
    targetArgs.family = 'generic'
    targetArgs.parts = parts
    return shapes
  }

  if (hasProfileRoute) return undefined

  if (
    /(\u5706\u89d2|\u7bb1\u4f53|\u673a\u67dc|\u5916\u58f3|rounded[_\s-]?(box|enclosure)|machine[_\s-]?enclosure|cabinet[_\s-]?enclosure)/i.test(
      text,
    ) &&
    !/(machine_tool|electrical|kiosk|outdoor_ac)/.test(sourceFamily)
  ) {
    const shapes = composeRecipePrimitives({
      recipeId: 'enclosure.roundedBox',
      params: {
        length: length ?? 1.2,
        width: width ?? 0.52,
        height: height ?? 0.9,
        color: typeof sourceArgs.primaryColor === 'string' ? sourceArgs.primaryColor : undefined,
        accentColor:
          typeof sourceArgs.accentColor === 'string' ? sourceArgs.accentColor : undefined,
      },
    }) as RawShape[]
    if (shapes.length === 0) return undefined
    targetArgs.__precisionPartRoute = 'enclosure.roundedBox'
    targetArgs.family = 'generic'
    return shapes
  }

  return undefined
}

function getRawShapes(
  name: string,
  args: Record<string, unknown>,
  prompt: string,
  context?: GeometryToolExecutionContext,
): RawShape[] | undefined {
  if (name === 'compose_assembly') {
    const assemblyShapes = composeAssemblyPrimitives({ ...(args as AssemblyComposeInput), prompt })
    if (assemblyShapes.length > 0) return assemblyShapes
    if (isChimneyIntent(args, prompt)) {
      const fallback = chimneyPartFallbackInput(args, prompt)
      args.__fallbackGeometryBrief = fallback.geometryBrief
      const shapes = chimneyPrimitiveFallbackShapes(fallback)
      args.shapes = shapes
      args.height = args.height ?? fallback.height
      args.radius = args.radius ?? fallback.radius
      return shapes
    }
    return applyGenericPrimitiveFallback(args, args, prompt)
  }
  if (name === 'compose_parts') {
    const dimensionAwarePartArgs = applyPromptDimensionSemanticsToPartInput(args, prompt)
    const simpleBoxShapes = simpleBoxPrimitiveFallbackShapes(args, dimensionAwarePartArgs, prompt)
    if (simpleBoxShapes?.length) return simpleBoxShapes
    const robotShapes = robotArmWorkstationFallbackShapes(
      args,
      dimensionAwarePartArgs,
      prompt,
      context,
    )
    if (robotShapes?.length) return robotShapes
    const hasExplicitParts =
      Array.isArray(dimensionAwarePartArgs.parts) && dimensionAwarePartArgs.parts.length > 0
    const precisionShapes = precisionIndustrialPartFallbackShapes(
      args,
      dimensionAwarePartArgs,
      prompt,
      context,
    )
    if (precisionShapes?.length) return precisionShapes
    if (
      hasExplicitParts &&
      shouldUseCompactAircraftFallback(dimensionAwarePartArgs, prompt, context)
    ) {
      const fallbackShapes = compactAircraftFallbackShapes(dimensionAwarePartArgs, prompt, context)
      if (fallbackShapes?.length) {
        for (const [key, value] of Object.entries(dimensionAwarePartArgs)) args[key] = value
        return fallbackShapes
      }
    }
    if (
      hasExplicitParts &&
      shouldUseCoherentVehicleFallback(dimensionAwarePartArgs, prompt, context)
    ) {
      const fallbackShapes = coherentVehicleFallbackShapes(dimensionAwarePartArgs, prompt)
      if (fallbackShapes?.length) {
        for (const [key, value] of Object.entries(dimensionAwarePartArgs)) args[key] = value
        return fallbackShapes
      }
    }
    if (hasExplicitParts) {
      const registryShapes = registryPartFallbackShapes(
        args,
        dimensionAwarePartArgs,
        prompt,
        context,
      )
      if (registryShapes?.length) return registryShapes
    }
    if (!hasExplicitParts) {
      if (isRiverIntent(dimensionAwarePartArgs, prompt)) {
        const fallbackShapes = riverPrimitiveFallbackShapes(dimensionAwarePartArgs, prompt)
        args.__fallbackGeometryBrief = riverFallbackGeometryBrief(dimensionAwarePartArgs, prompt)
        args.shapes = fallbackShapes
        return fallbackShapes
      }
      // Try recipe first for parametric requests (gear, valve, etc.) — recipe is more precise
      const registryShapes = registryPartFallbackShapes(
        args,
        dimensionAwarePartArgs,
        prompt,
        context,
      )
      if (registryShapes?.length) return registryShapes
      const recipeShapes = composeRecipePrimitives(
        recipeFallbackInput(dimensionAwarePartArgs, prompt),
      )
      if (recipeShapes.length > 0) return recipeShapes
      if (isOutdoorAcPartFallbackRequest(dimensionAwarePartArgs, prompt)) {
        return composeAssemblyPrimitives(openAssemblyFallbackInput(dimensionAwarePartArgs, prompt))
      }
      if (isOpenAssemblyRequest(dimensionAwarePartArgs, prompt)) {
        return composeAssemblyPrimitives(openAssemblyFallbackInput(dimensionAwarePartArgs, prompt))
      }
      // Fall back to assembly only when an explicit family is recognized
      const assemblyShapes = composeAssemblyPrimitives({
        ...(dimensionAwarePartArgs as AssemblyComposeInput),
        prompt,
      })
      if (assemblyShapes.length > 0) return assemblyShapes
    }
    const shapes = composePartPrimitives(dimensionAwarePartArgs as PartComposeInput)
    if (shapes.length > 0) return shapes
    if (hasExplicitParts) {
      const primitiveLikeShapes = readPrimitiveLikeShapes(dimensionAwarePartArgs)
      if (primitiveLikeShapes) return primitiveLikeShapes
      if (shouldUseGenericPrimitiveFallback(dimensionAwarePartArgs, prompt)) {
        return applyGenericPrimitiveFallback(args, dimensionAwarePartArgs, prompt)
      }
    }
    if (!hasExplicitParts) {
      const fallbackRecipeShapes = composeRecipePrimitives(
        recipeFallbackInput(dimensionAwarePartArgs, prompt),
      )
      if (fallbackRecipeShapes.length > 0) return fallbackRecipeShapes
      return applyGenericPrimitiveFallback(args, dimensionAwarePartArgs, prompt)
    }
    return shapes
  }
  if (name === 'compose_recipe') {
    if (isOpenAssemblyRequest(args, prompt)) {
      const semanticArgs = applyPromptSemanticsToRecipeInput(
        withoutExternalRecipeBrief(args),
        prompt,
      )
      const assemblyShapes = composeAssemblyPrimitives(
        openAssemblyFallbackInput(semanticArgs, prompt),
      )
      if (assemblyShapes.length > 0) return assemblyShapes
      return applyGenericPrimitiveFallback(args, semanticArgs, prompt)
    }
    const recipeShapes = composeRecipePrimitives(
      applyPromptSemanticsToRecipeInput(
        withoutExternalRecipeBrief(args),
        prompt,
      ) as ComposeRecipeInput,
    )
    if (recipeShapes.length > 0) return recipeShapes
    return applyGenericPrimitiveFallback(args, args, prompt)
  }
  if (name === 'revise_geometry') {
    const target = context?.revisionTarget
    if (!target) return undefined
    if (isCurvyRiverRevisionRequest(args, prompt, target)) {
      const fallbackInput = { ...target.sourceArgs, ...args }
      const fallbackPrompt = `${target.userPrompt ?? ''} ${prompt}`
      const fallbackShapes = riverPrimitiveFallbackShapes(fallbackInput, fallbackPrompt)
      args.__fallbackGeometryBrief = riverFallbackGeometryBrief(fallbackInput, fallbackPrompt)
      args.__changedShapeCount = target.shapes.length + fallbackShapes.length
      return fallbackShapes
    }
    const operations = Array.isArray(args.operations)
      ? (args.operations as PrimitiveRevisionOperation[])
      : []
    if (operations.length === 0) {
      const inferredRevision = inferIndustrialRevisionFallback(args, prompt, target)
      if (inferredRevision?.shapes) return inferredRevision.shapes
      if (inferredRevision?.operations.length) {
        args.operations = inferredRevision.operations
        operations.push(...inferredRevision.operations)
      }
    }
    const revision = applyPrimitiveRevision({
      shapes: target.shapes as PrimitiveShapeInput[],
      operations,
    })
    if (revision.issues.length > 0) {
      ;(args as Record<string, unknown>).__revisionIssues = revision.issues
      return []
    }
    ;(args as Record<string, unknown>).__changedShapeCount = revision.changedShapeCount
    return revision.shapes as RawShape[]
  }
  if (name === 'compose_robot_arm') return composeRobotArmPrimitives(args as RobotArmComposeInput)
  if (
    name === 'compose_primitive' &&
    isVehicleIntent(args, prompt, context) &&
    !isVehicleComponentIntent(args, prompt, context) &&
    !isAircraftIntent(args, prompt, context)
  ) {
    const fallbackShapes = coherentVehicleFallbackShapes(args, prompt)
    if (fallbackShapes?.length) return fallbackShapes
  }
  const explicitPrimitiveShapes = readExplicitPrimitiveShapes(args)
  if (explicitPrimitiveShapes) {
    const chimneyShapes = upgradeSimpleChimneyPrimitiveShapes(args, prompt, explicitPrimitiveShapes)
    if (chimneyShapes) return chimneyShapes
    if (shouldUseRiverPrimitiveFallback(args, prompt, explicitPrimitiveShapes)) {
      const fallbackShapes = riverPrimitiveFallbackShapes(args, prompt)
      args.__fallbackGeometryBrief = riverFallbackGeometryBrief(args, prompt)
      args.shapes = fallbackShapes
      return fallbackShapes
    }
    return explicitPrimitiveShapes
  }
  if (name === 'compose_primitive') {
    const hasExplicitShapes = Array.isArray(args.shapes) && args.shapes.length > 0
    if (!hasExplicitShapes && isOpenAssemblyRequest(args, prompt)) {
      return composeAssemblyPrimitives(openAssemblyFallbackInput(args, prompt))
    }
    const recipeShapes = composeRecipePrimitives(recipeFallbackInput(args, prompt))
    if (recipeShapes.length > 0) return recipeShapes
    const assemblyShapes = composeAssemblyPrimitives({ ...(args as AssemblyComposeInput), prompt })
    if (assemblyShapes.length > 0) return assemblyShapes
    if (isRiverIntent(args, prompt)) {
      const fallbackShapes = riverPrimitiveFallbackShapes(args, prompt)
      args.__fallbackGeometryBrief = riverFallbackGeometryBrief(args, prompt)
      args.shapes = fallbackShapes
      return fallbackShapes
    }
    return applyGenericPrimitiveFallback(args, args, prompt)
  }
  return args.shapes as RawShape[] | undefined
}

const INDUSTRIAL_PART_FAMILIES = new Set([
  'pump',
  'fan',
  'conveyor',
  'electrical',
  'pipe_system',
  'tank',
  'reactor',
  'compressor',
  'heat_exchanger',
  'machine_tool',
])

function revisionRequestText(args: Record<string, unknown>, prompt: string): string {
  return [
    prompt,
    typeof args.feedback === 'string' ? args.feedback : undefined,
    typeof args.intent === 'string' ? args.intent : undefined,
    typeof args.userVisiblePlan === 'string' ? args.userVisiblePlan : undefined,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase()
}

function integerNear(text: string, words: RegExp): number | undefined {
  const before = text.match(
    new RegExp(`(\\d{1,2})\\s*(?:个|条|根|组|x|pcs?|pieces?)?\\s*${words.source}`, 'i'),
  )
  if (before) return Number(before[1])
  const after = text.match(
    new RegExp(`${words.source}\\s*(?:数量|count|qty)?\\s*(?:到|为|=|:)?\\s*(\\d{1,2})`, 'i'),
  )
  if (after) return Number(after[1])
  if (/(double|two|2|双|两|二)/i.test(text) && words.test(text)) return 2
  if (/(triple|three|3|三)/i.test(text) && words.test(text)) return 3
  return undefined
}

function radiusFromDimensions(
  dimensions: ReturnType<typeof parseDimensionSemantics>,
): number | undefined {
  if (typeof dimensions.radius === 'number') return dimensions.radius
  if (typeof dimensions.diameter === 'number') return dimensions.diameter / 2
  if (typeof dimensions.width === 'number') return dimensions.width / 2
  return undefined
}

function industrialFamilyFromArtifact(target: GeneratedGeometryArtifact): string | undefined {
  const family = typeof target.sourceArgs.family === 'string' ? target.sourceArgs.family : undefined
  if (family && INDUSTRIAL_PART_FAMILIES.has(family)) return family
  const inferred = inferFamilyDefinition({
    ...target.sourceArgs,
    prompt: target.userPrompt ?? '',
  })?.id
  return inferred && INDUSTRIAL_PART_FAMILIES.has(inferred) ? inferred : undefined
}

function recomposeIndustrialRevision(
  args: Record<string, unknown>,
  prompt: string,
  target: GeneratedGeometryArtifact,
  updates: Record<string, unknown>,
): RawShape[] | undefined {
  const family = industrialFamilyFromArtifact(target)
  if (!family) return undefined
  const sourceArgs: Record<string, unknown> = {
    ...target.sourceArgs,
    ...updates,
    family,
    parts: applyIndustrialUpdatesToSourceParts(target.sourceArgs.parts, family, updates),
  }
  const normalizedPlan = normalizePartPlanForFamily(family, { ...sourceArgs, prompt })
  if (!normalizedPlan?.parts.length) return undefined

  const partInput: PartComposeInput = {
    ...(sourceArgs as PartComposeInput),
    name:
      typeof sourceArgs.name === 'string'
        ? sourceArgs.name
        : typeof sourceArgs.object === 'string'
          ? sourceArgs.object
          : target.title,
    family,
    registryPartPlan: true,
    autoComplete: false,
    enhanceVisualDetails: false,
    parts: normalizedPlan.parts,
  }
  const shapes = composePartPrimitives(partInput) as RawShape[]
  if (shapes.length === 0) return undefined

  args.family = family
  for (const [key, value] of Object.entries(updates)) args[key] = value
  args.parts = normalizedPlan.parts
  args.__recomposedIndustrialParts = true
  args.__changedShapeCount = target.shapes.length + shapes.length
  if (normalizedPlan.warnings.length > 0) args.partWarnings = normalizedPlan.warnings
  return shapes
}

function applyIndustrialUpdatesToSourceParts(
  value: unknown,
  family: string,
  updates: Record<string, unknown>,
) {
  const sourceParts = Array.isArray(value) ? value : []
  const numberUpdate = (...keys: string[]) => {
    for (const key of keys) {
      const value = updates[key]
      if (typeof value === 'number' && Number.isFinite(value)) return value
    }
    return undefined
  }
  const radiusUpdate = (...keys: string[]) => {
    const radius = numberUpdate(...keys.filter((key) => key.toLowerCase().includes('radius')))
    if (radius != null) return radius
    const diameter = numberUpdate(...keys.filter((key) => key.toLowerCase().includes('diameter')))
    return diameter != null ? diameter / 2 : undefined
  }
  const stringUpdate = (...keys: string[]) => {
    for (const key of keys) {
      const value = updates[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return undefined
  }
  const sidePosition = (
    side: string | undefined,
    fallback: [number, number, number],
  ): [number, number, number] | undefined => {
    if (!side) return undefined
    switch (side) {
      case 'left':
        return [-Math.abs(fallback[0]), fallback[1], fallback[2]]
      case 'right':
        return [Math.abs(fallback[0]), fallback[1], fallback[2]]
      case 'front':
        return [fallback[0], fallback[1], Math.abs(fallback[2])]
      case 'back':
        return [fallback[0], fallback[1], -Math.abs(fallback[2])]
      default:
        return undefined
    }
  }
  const partKind = (part: unknown) =>
    part && typeof part === 'object' && typeof (part as Record<string, unknown>).kind === 'string'
      ? String((part as Record<string, unknown>).kind)
      : ''
  const hasKind = (parts: unknown[], kind: string) => parts.some((part) => partKind(part) === kind)
  const withOptionalPart = (parts: unknown[], kind: string) =>
    hasKind(parts, kind) ? parts : [...parts, { kind }]

  let nextParts = sourceParts
  if ((family === 'tank' || family === 'reactor') && updates.addPlatformLadder === true) {
    nextParts = withOptionalPart(nextParts, 'platform_ladder')
  }
  if ((family === 'tank' || family === 'heat_exchanger') && updates.addSupportBase === true) {
    nextParts = withOptionalPart(nextParts, 'skid_base')
  }
  if (family === 'compressor' && updates.addControlBox === true) {
    nextParts = withOptionalPart(nextParts, 'control_box')
  }

  return nextParts.map((part) => {
    if (!part || typeof part !== 'object') return part
    const current = part as Record<string, unknown>
    const kind = typeof current.kind === 'string' ? current.kind : ''
    if (family === 'conveyor' && kind === 'roller_array' && updates.rollerCount != null) {
      return { ...current, count: updates.rollerCount }
    }
    if (family === 'conveyor' && kind === 'conveyor_frame' && updates.legCount != null) {
      return { ...current, legCount: updates.legCount }
    }
    if (family === 'electrical' && kind === 'electrical_cabinet') {
      return {
        ...current,
        ...(updates.doorCount != null ? { doorCount: updates.doorCount } : {}),
        ...(updates.ventRows != null ? { slatCount: updates.ventRows } : {}),
      }
    }
    if (family === 'pump' && kind === 'flange_ring' && updates.flangeBoltCount != null) {
      return { ...current, boltCount: updates.flangeBoltCount }
    }
    if (family === 'pump' && kind === 'ribbed_motor_body' && updates.ribCount != null) {
      return { ...current, slatCount: updates.ribCount }
    }
    if (family === 'pipe_system' && kind === 'flange_ring' && updates.flangeBoltCount != null) {
      return { ...current, boltCount: updates.flangeBoltCount }
    }
    if (family === 'pipe_system' && kind === 'valve_body' && updates.valveStyle != null) {
      return { ...current, valveStyle: updates.valveStyle }
    }
    if (family === 'tank') {
      if (kind === 'cylindrical_tank') {
        return {
          ...current,
          ...(numberUpdate('tankHeight', 'height') != null
            ? { length: numberUpdate('tankHeight', 'height') }
            : {}),
          ...(radiusUpdate('tankRadius', 'radius', 'tankDiameter', 'diameter') != null
            ? { radius: radiusUpdate('tankRadius', 'radius', 'tankDiameter', 'diameter') }
            : {}),
        }
      }
      if (kind === 'inlet_port' || kind === 'outlet_port') {
        const portRadius = radiusUpdate(
          'portRadius',
          'nozzleRadius',
          'portDiameter',
          'nozzleDiameter',
        )
        return portRadius != null ? { ...current, radius: portRadius } : current
      }
      if (kind === 'platform_ladder' && numberUpdate('platformHeight') != null) {
        return {
          ...current,
          height: numberUpdate('platformHeight'),
          ...(sidePosition(stringUpdate('platformSide'), [0.8, 1.4, 0.5])
            ? { position: sidePosition(stringUpdate('platformSide'), [0.8, 1.4, 0.5]) }
            : {}),
        }
      }
      if (kind === 'skid_base' && numberUpdate('supportHeight') != null) {
        return { ...current, height: numberUpdate('supportHeight') }
      }
    }
    if (family === 'reactor') {
      if (kind === 'agitator_tank') {
        return {
          ...current,
          ...(numberUpdate('vesselHeight', 'tankHeight', 'height') != null
            ? { height: numberUpdate('vesselHeight', 'tankHeight', 'height') }
            : {}),
          ...(radiusUpdate('vesselRadius', 'tankRadius', 'radius', 'vesselDiameter', 'diameter') !=
          null
            ? {
                radius: radiusUpdate(
                  'vesselRadius',
                  'tankRadius',
                  'radius',
                  'vesselDiameter',
                  'diameter',
                ),
              }
            : {}),
        }
      }
      if (kind === 'inlet_port' || kind === 'outlet_port') {
        const nozzleRadius = radiusUpdate(
          'nozzleRadius',
          'portRadius',
          'nozzleDiameter',
          'portDiameter',
        )
        return nozzleRadius != null ? { ...current, radius: nozzleRadius } : current
      }
      if (kind === 'platform_ladder') {
        return {
          ...current,
          ...(numberUpdate('platformHeight') != null
            ? { height: numberUpdate('platformHeight') }
            : {}),
          ...(sidePosition(stringUpdate('platformSide'), [0.72, 0.9, 0.48])
            ? { position: sidePosition(stringUpdate('platformSide'), [0.72, 0.9, 0.48]) }
            : {}),
        }
      }
    }
    if (family === 'compressor') {
      if (kind === 'ribbed_motor_body') {
        return {
          ...current,
          ...(numberUpdate('motorLength') != null ? { length: numberUpdate('motorLength') } : {}),
          ...(numberUpdate('motorRadius') != null ? { radius: numberUpdate('motorRadius') } : {}),
        }
      }
      if (kind === 'rounded_machine_body') {
        const casingRadius = numberUpdate('casingRadius')
        return {
          ...current,
          ...(numberUpdate('casingLength') != null ? { length: numberUpdate('casingLength') } : {}),
          ...(casingRadius != null
            ? { width: casingRadius * 1.8, height: casingRadius * 1.8 }
            : {}),
        }
      }
      if (kind === 'inlet_port' || kind === 'outlet_port') {
        const portRadius = radiusUpdate('portRadius', 'portDiameter')
        return portRadius != null ? { ...current, radius: portRadius } : current
      }
      if (kind === 'control_box') {
        return {
          ...current,
          ...(sidePosition(stringUpdate('controlPanelSide'), [0.75, 0.3, 0.45])
            ? { position: sidePosition(stringUpdate('controlPanelSide'), [0.75, 0.3, 0.45]) }
            : {}),
        }
      }
    }
    if (family === 'heat_exchanger') {
      if (kind === 'heat_exchanger') {
        return {
          ...current,
          ...(numberUpdate('length') != null ? { length: numberUpdate('length') } : {}),
          ...(radiusUpdate('shellRadius', 'radius', 'shellDiameter', 'diameter') != null
            ? { radius: radiusUpdate('shellRadius', 'radius', 'shellDiameter', 'diameter') }
            : {}),
        }
      }
      if (kind === 'skid_base' && numberUpdate('supportHeight') != null) {
        return { ...current, height: numberUpdate('supportHeight') }
      }
    }
    if (family === 'machine_tool') {
      if (kind === 'generic_base') {
        return {
          ...current,
          ...(numberUpdate('length') != null ? { length: numberUpdate('length') } : {}),
          ...(numberUpdate('width') != null ? { width: numberUpdate('width') } : {}),
        }
      }
      if (kind === 'generic_body') {
        return {
          ...current,
          ...(numberUpdate('length') != null ? { length: numberUpdate('length') } : {}),
          ...(numberUpdate('width') != null ? { width: numberUpdate('width') } : {}),
          ...(numberUpdate('height') != null ? { height: numberUpdate('height') } : {}),
        }
      }
      if (kind === 'generic_panel') {
        return {
          ...current,
          ...(numberUpdate('spindleHeadLength') != null
            ? { length: numberUpdate('spindleHeadLength') }
            : {}),
          ...(numberUpdate('spindleHeadHeight') != null
            ? { height: numberUpdate('spindleHeadHeight') }
            : {}),
        }
      }
      if (kind === 'control_box') {
        return {
          ...current,
          ...(numberUpdate('controlPanelLength') != null
            ? { length: numberUpdate('controlPanelLength') }
            : {}),
          ...(numberUpdate('controlPanelHeight') != null
            ? { height: numberUpdate('controlPanelHeight') }
            : {}),
          ...(sidePosition(stringUpdate('controlPanelSide'), [1.05, 1, 0.6])
            ? { position: sidePosition(stringUpdate('controlPanelSide'), [1.05, 1, 0.6]) }
            : {}),
        }
      }
    }
    return part
  })
}

function inferIndustrialRecomposeUpdates(
  text: string,
  family: string,
): Record<string, unknown> | undefined {
  const updates: Record<string, unknown> = {}
  const dimensions = parseDimensionSemantics(text)
  const radius = radiusFromDimensions(dimensions)
  const hasAnyDimension =
    dimensions.length != null ||
    dimensions.width != null ||
    dimensions.height != null ||
    dimensions.diameter != null ||
    dimensions.radius != null
  const mentionsTankShell =
    /(tank|vessel|shell|罐|容器|筒体|壳体|body|overall|whole|整体|主体)/i.test(text)
  const mentionsPort =
    /(port|nozzle|inlet|outlet|feed|discharge|接口|喷嘴|管口|入口|出口|进料|出料)/i.test(text)
  const mentionsSupport =
    /(support|base|skid|saddle|platform|ladder|支撑|底座|鞍座|平台|爬梯)/i.test(text)
  const mentionsMotor = /(motor|drive|电机|马达)/i.test(text)
  const mentionsCasing = /(casing|compressor body|housing|shell|壳体|机壳|压缩机)/i.test(text)
  const mentionsControlPanel =
    /(control panel|control box|operator panel|控制面板|控制箱|操作面板)/i.test(text)
  const mentionsSpindle = /(spindle|tool head|spindle head|主轴|主轴头|刀头)/i.test(text)

  const hasAddIntent = /(add|with|install|include|\bhas\b|加|增加|添加|装|帶|带)/i.test(text)
  const side = (() => {
    if (/(left|左)/i.test(text)) return 'left'
    if (/(right|右)/i.test(text)) return 'right'
    if (/(front|前)/i.test(text)) return 'front'
    if (/(back|rear|后|後)/i.test(text)) return 'back'
    return undefined
  })()
  const mentionsPlatform = /(platform|ladder|access|平台|爬梯|檢修|检修)/i.test(text)
  const mentionsSupportBase = /(support|base|skid|saddle|支撑|支座|底座|鞍座)/i.test(text)

  if (family === 'electrical') {
    const doorCount = integerNear(text, /(doors?|door panels?|cabinet doors?|柜门|门|双开门)/i)
    if (doorCount != null) updates.doorCount = doorCount
    const ventRows = integerNear(text, /(vents?|vent rows?|slats?|louvers?|散热|百叶|通风)/i)
    if (ventRows != null) updates.ventRows = ventRows
  }

  if (family === 'conveyor') {
    const rollerCount = integerNear(text, /(rollers?|idlers?|滚筒|托辊)/i)
    if (rollerCount != null) updates.rollerCount = rollerCount
    const legCount = integerNear(text, /(legs?|supports?|支腿|支架)/i)
    if (legCount != null) updates.legCount = legCount
  }

  if (family === 'pump') {
    const boltCount = integerNear(text, /(bolts?|bolt holes?|螺栓|螺孔)/i)
    if (boltCount != null && /flange|法兰|bolt|螺栓|螺孔/i.test(text)) {
      updates.flangeBoltCount = boltCount
    }
    const ribCount = integerNear(text, /(ribs?|fins?|散热片|筋|肋)/i)
    if (ribCount != null) updates.ribCount = ribCount
  }

  if (family === 'pipe_system') {
    if (/ball valve|球阀/i.test(text)) updates.valveStyle = 'ball'
    if (/gate valve|闸阀/i.test(text)) updates.valveStyle = 'gate'
    const boltCount = integerNear(text, /(bolts?|bolt holes?|螺栓|螺孔)/i)
    if (boltCount != null && /flange|法兰|bolt|螺栓|螺孔/i.test(text)) {
      updates.flangeBoltCount = boltCount
    }
  }

  if (family === 'tank') {
    if (hasAddIntent && mentionsPlatform) updates.addPlatformLadder = true
    if (hasAddIntent && mentionsSupportBase) updates.addSupportBase = true
    if (side && mentionsPlatform) updates.platformSide = side
    if (mentionsPort && radius != null) updates.portDiameter = radius * 2
    if ((mentionsTankShell || !mentionsPort) && dimensions.height != null) {
      updates.tankHeight = dimensions.height
      updates.height = dimensions.height
    }
    if ((mentionsTankShell || !mentionsPort) && dimensions.diameter != null) {
      updates.diameter = dimensions.diameter
      updates.tankDiameter = dimensions.diameter
    }
    if ((mentionsTankShell || !mentionsPort) && dimensions.radius != null) {
      updates.radius = dimensions.radius
      updates.tankRadius = dimensions.radius
    }
    if (mentionsSupport && dimensions.height != null) updates.supportHeight = dimensions.height
    if (/platform|ladder|平台|爬梯/i.test(text) && dimensions.height != null) {
      updates.platformHeight = dimensions.height
    }
  }

  if (family === 'reactor') {
    if (hasAddIntent && mentionsPlatform) updates.addPlatformLadder = true
    if (side && mentionsPlatform) updates.platformSide = side
    if (mentionsPort && radius != null) updates.nozzleDiameter = radius * 2
    if ((mentionsTankShell || !mentionsPort) && dimensions.height != null) {
      updates.vesselHeight = dimensions.height
      updates.height = dimensions.height
    }
    if ((mentionsTankShell || !mentionsPort) && dimensions.diameter != null) {
      updates.diameter = dimensions.diameter
      updates.vesselDiameter = dimensions.diameter
    }
    if ((mentionsTankShell || !mentionsPort) && dimensions.radius != null) {
      updates.radius = dimensions.radius
      updates.vesselRadius = dimensions.radius
    }
  }

  if (family === 'compressor') {
    if (hasAddIntent && mentionsControlPanel) updates.addControlBox = true
    if (side && mentionsControlPanel) updates.controlPanelSide = side
    if (mentionsPort && radius != null) updates.portDiameter = radius * 2
    if (mentionsMotor) {
      if (dimensions.length != null) updates.motorLength = dimensions.length
      if (radius != null) updates.motorRadius = radius
    } else if (mentionsCasing) {
      if (dimensions.length != null) updates.casingLength = dimensions.length
      if (radius != null) updates.casingRadius = radius
    } else if (hasAnyDimension) {
      if (dimensions.length != null) updates.length = dimensions.length
      if (dimensions.width != null) updates.width = dimensions.width
      if (dimensions.height != null) updates.height = dimensions.height
    }
  }

  if (family === 'heat_exchanger') {
    if (hasAddIntent && mentionsSupportBase) updates.addSupportBase = true
    if (dimensions.length != null) updates.length = dimensions.length
    if (dimensions.diameter != null) {
      updates.diameter = dimensions.diameter
      updates.shellDiameter = dimensions.diameter
    }
    if (dimensions.radius != null) {
      updates.radius = dimensions.radius
      updates.shellRadius = dimensions.radius
    }
    if (mentionsSupport && dimensions.height != null) updates.supportHeight = dimensions.height
  }

  if (family === 'machine_tool') {
    if (mentionsControlPanel) {
      if (side) updates.controlPanelSide = side
      if (dimensions.length != null) updates.controlPanelLength = dimensions.length
      if (dimensions.height != null) updates.controlPanelHeight = dimensions.height
    } else if (mentionsSpindle) {
      if (dimensions.length != null) updates.spindleHeadLength = dimensions.length
      if (dimensions.height != null) updates.spindleHeadHeight = dimensions.height
    } else if (hasAnyDimension) {
      if (dimensions.length != null) updates.length = dimensions.length
      if (dimensions.width != null) updates.width = dimensions.width
      if (dimensions.height != null) updates.height = dimensions.height
    }
  }

  return Object.keys(updates).length > 0 ? updates : undefined
}

function inferIndustrialResizeOperations(
  text: string,
  family: string,
): PrimitiveRevisionOperation[] {
  const dimensions = parseDimensionSemantics(text)
  const radius = radiusFromDimensions(dimensions)
  const hasWiderIntent = /wider|wide|width|broaden|加宽|更宽|宽一点|宽些/.test(text)
  const hasBiggerIntent = /larger|bigger|increase|加大|变大|更大|大一点|放大/.test(text)
  const operations: PrimitiveRevisionOperation[] = []

  if (family === 'conveyor' && /(belt|belt_surface|输送带|皮带)/i.test(text)) {
    operations.push(
      dimensions.width
        ? { op: 'resize', selector: { sourcePartKind: 'belt_surface' }, width: dimensions.width }
        : {
            op: 'scaleSemantic',
            selector: { sourcePartKind: 'belt_surface' },
            dimension: hasWiderIntent ? 'width' : 'primary',
            factor: 1.2,
          },
    )
  }

  if (family === 'pump' && /(inlet|suction|入口|进口|吸入口)/i.test(text)) {
    operations.push(
      radius
        ? { op: 'resize', selector: { sourcePartKind: 'inlet_port' }, radius }
        : {
            op: 'scaleSemantic',
            selector: { sourcePartKind: 'inlet_port' },
            dimension: 'radius',
            factor: hasBiggerIntent ? 1.25 : 1.15,
          },
    )
  }

  if (family === 'pump' && /(outlet|discharge|出口|排出口)/i.test(text)) {
    operations.push(
      radius
        ? { op: 'resize', selector: { sourcePartKind: 'outlet_port' }, radius }
        : {
            op: 'scaleSemantic',
            selector: { sourcePartKind: 'outlet_port' },
            dimension: 'radius',
            factor: hasBiggerIntent ? 1.25 : 1.15,
          },
    )
  }

  if (family === 'pipe_system' && /(pipe|pipeline|管道|管路|管线)/i.test(text)) {
    for (const sourcePartKind of ['pipe_run', 'pipe_elbow', 'valve_body'] as const) {
      operations.push(
        radius
          ? { op: 'resize', selector: { sourcePartKind }, radius }
          : {
              op: 'scaleSemantic',
              selector: { sourcePartKind },
              dimension: 'radius',
              factor: hasBiggerIntent ? 1.2 : 1.12,
            },
      )
    }
  }

  return operations
}

function inferIndustrialRevisionFallback(
  args: Record<string, unknown>,
  prompt: string,
  target: GeneratedGeometryArtifact,
):
  | { operations: PrimitiveRevisionOperation[]; shapes?: undefined }
  | { operations: []; shapes: RawShape[] }
  | undefined {
  const family = industrialFamilyFromArtifact(target)
  if (!family) return undefined
  const text = revisionRequestText(args, prompt)
  if (!text) return undefined

  const recomposeUpdates = inferIndustrialRecomposeUpdates(text, family)
  if (recomposeUpdates) {
    const shapes = recomposeIndustrialRevision(args, prompt, target, recomposeUpdates)
    if (shapes) return { operations: [], shapes }
  }

  const operations = inferIndustrialResizeOperations(text, family)
  return operations.length > 0 ? { operations } : undefined
}

function isChimneyIntent(args: Record<string, unknown>, prompt: string): boolean {
  const text = `${prompt} ${JSON.stringify(args)}`.toLowerCase()
  return /chimney|smoke[_\s-]?stack|\u70df\u56f1/.test(text)
}

function isRiverIntent(args: Record<string, unknown>, prompt: string): boolean {
  const text = `${prompt} ${JSON.stringify(args)}`.toLowerCase()
  return /\briver\b|\bstream\b|\bcreek\b|\bbrook\b|\u5c0f\u6cb3|\u6cb3\u6d41|\u6cb3\u9053|\u6eaa\u6d41|\u6eaa/.test(
    text,
  )
}

function isCurvyRiverRevisionRequest(
  args: Record<string, unknown>,
  prompt: string,
  target: GeneratedGeometryArtifact,
): boolean {
  const revisionText = `${prompt} ${JSON.stringify(args)}`.toLowerCase()
  if (!/(curve|curvy|winding|meander|sinuous|\u66f2\u7ebf|\u5f2f|\u626d)/i.test(revisionText)) {
    return false
  }
  const targetText =
    `${target.title} ${target.userPrompt} ${JSON.stringify(target.geometryBrief)} ${target.shapes
      .map(
        (shape) => `${shape.semanticRole ?? ''} ${shape.name ?? ''} ${shape.sourcePartKind ?? ''}`,
      )
      .join(' ')}`.toLowerCase()
  return (
    isRiverIntent({}, targetText) ||
    /water_surface|riverbed|riverbanks|river_water/.test(targetText)
  )
}

type GenericPrimitiveFallbackCategory =
  | 'landscape_rockery'
  | 'landscape_natural'
  | 'equipment'
  | 'building'
  | 'furniture'
  | 'generic_object'

function genericFallbackText(args: Record<string, unknown>, prompt: string): string {
  return `${prompt} ${args.name ?? ''} ${args.object ?? ''} ${args.category ?? ''} ${args.geometryBrief ?? ''}`.toLowerCase()
}

function classifyGenericPrimitiveFallback(
  args: Record<string, unknown>,
  prompt: string,
): GenericPrimitiveFallbackCategory {
  const text = genericFallbackText(args, prompt)
  if (
    /(rockery|rock.?garden|artificial.?hill|fake.?mountain|\u5047\u5c71|\u5c71\u77f3|\u77f3\u5c71|\u5ca9\u77f3)/i.test(
      text,
    )
  ) {
    return 'landscape_rockery'
  }
  if (
    /(landscape|garden|terrain|hill|mountain|pond|waterfall|grass|tree|\u666f\u89c2|\u82b1\u56ed|\u5ead\u9662|\u5c71|\u6c60|\u7011\u5e03|\u8349|\u6811)/i.test(
      text,
    )
  ) {
    return 'landscape_natural'
  }
  if (
    /(machine|equipment|device|appliance|instrument|console|robot|pump|motor|coffee|espresso|\u5496\u5561\u673a|\u673a\u5668|\u8bbe\u5907|\u88c5\u7f6e|\u4eea\u5668|\u7535\u5668)/i.test(
      text,
    )
  ) {
    return 'equipment'
  }
  if (
    /(building|house|tower|pavilion|booth|kiosk|shed|\u5efa\u7b51|\u623f\u5b50|\u623f\u5c4b|\u4ead|\u68da|\u5c0f\u5c4b)/i.test(
      text,
    )
  ) {
    return 'building'
  }
  if (
    /(furniture|chair|table|desk|cabinet|shelf|sofa|bed|\u5bb6\u5177|\u6905|\u684c|\u67dc|\u67b6|\u6c99\u53d1|\u5e8a)/i.test(
      text,
    )
  ) {
    return 'furniture'
  }
  return 'generic_object'
}

function shouldUseGenericPrimitiveFallback(args: Record<string, unknown>, prompt: string): boolean {
  const text = genericFallbackText(args, prompt).trim()
  if (text.length < 2) return false
  if (/^\s*(edit|revise|change|delete|remove|undo|redo)\b/i.test(prompt)) return false
  return true
}

function isOutdoorAcPartFallbackRequest(args: Record<string, unknown>, prompt: string): boolean {
  return /outdoor.?ac|air.?condition(?:er|ing)?|ac\s+unit|\u7a7a\u8c03\u5916\u673a|\u7a7a\u8c03|\u5916\u673a/i.test(
    genericFallbackText(args, prompt),
  )
}

function explicitDraftProfileFromArgs(
  args: Record<string, unknown>,
  prompt: string,
): DeviceProfileDefinition | undefined {
  if (!isRecord(args.deviceProfileDraft)) return undefined
  return buildDraftDeviceProfile(prompt, {
    ...args,
    deviceProfileDraft: args.deviceProfileDraft,
  }).profile
}

function attachExplicitDeviceProfileDraft(args: Record<string, unknown>, prompt: string) {
  const profile = explicitDraftProfileFromArgs(args, prompt)
  if (!profile) return
  args.deviceProfileDraft = profile
  args.__deviceProfileDefinition = args.__deviceProfileDefinition ?? profile
  args.deviceProfile = args.deviceProfile ?? profile.id
  args.archetypeFamily = args.archetypeFamily ?? profile.archetypeFamily
  args.layoutFamily = args.layoutFamily ?? profile.layoutFamily
  args.profileSource = args.profileSource ?? profile.source
  args.primarySemanticRole = args.primarySemanticRole ?? profile.primarySemanticRole
  args.family = args.family ?? profile.family
}

function hasPartDefinitions(family: unknown): family is string {
  return typeof family === 'string' && getPartDefinitions(family).length > 0
}

function executableFamilyForProfile(
  profile: DeviceProfileDefinition | undefined,
  inferredFamily: string | undefined,
): string | undefined {
  if (profile) {
    if (hasPartDefinitions(profile.family)) return profile.family
    const layoutExecutable = executableFamilyForLayoutFamily(
      profile.layoutFamily,
      hasPartDefinitions(inferredFamily) ? inferredFamily : undefined,
    )
    if (hasPartDefinitions(layoutExecutable)) return layoutExecutable
    if (hasPartDefinitions(inferredFamily)) return inferredFamily
    if (hasPartDefinitions('generic')) return 'generic'
    return undefined
  }
  return hasPartDefinitions(inferredFamily) ? inferredFamily : undefined
}

function explicitProfileParts(parts: unknown): PartComposePartInput[] {
  if (!Array.isArray(parts)) return []
  const seen = new Set<string>()
  const output: PartComposePartInput[] = []
  for (const part of parts) {
    if (!isRecord(part)) continue
    const kind = String(part.kind ?? part.partType ?? part.type ?? '').trim()
    if (!kind) continue
    const semanticRole = String(part.semanticRole ?? '').trim()
    const explicitId = String(part.id ?? '').trim()
    const key = explicitId
      ? `id::${explicitId.toLowerCase()}`
      : `${kind.toLowerCase()}::${semanticRole.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push({
      ...(part as PartComposePartInput),
      kind,
      ...(semanticRole ? { semanticRole } : {}),
    })
  }
  return output
}

function stringRecordValue(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value).flatMap(([key, raw]) =>
    typeof raw === 'string' && raw.trim() ? [[key, raw.trim()] as const] : [],
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function objectRecordValue(value: unknown): Record<string, Record<string, unknown>> | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value).flatMap(([key, raw]) =>
    isRecord(raw) ? [[key, raw] as const] : [],
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function vec3Value(value: unknown): [number, number, number] | undefined {
  return Array.isArray(value) &&
    value.length >= 3 &&
    value.slice(0, 3).every((item) => typeof item === 'number' && Number.isFinite(item))
    ? ([value[0], value[1], value[2]] as [number, number, number])
    : undefined
}

function positiveNumberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function calculatedPresetParameters(
  parameters: unknown,
  dimensions: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRecord(parameters)) return {}
  const output: Record<string, unknown> = {}
  for (const [targetKey, rule] of Object.entries(parameters)) {
    if (!isRecord(rule)) continue
    const sourceKey = typeof rule.from === 'string' ? rule.from : undefined
    const sourceValue = sourceKey ? positiveNumberValue(dimensions[sourceKey]) : undefined
    if (sourceValue == null) continue
    const scale = typeof rule.scale === 'number' && Number.isFinite(rule.scale) ? rule.scale : 1
    const offset = typeof rule.offset === 'number' && Number.isFinite(rule.offset) ? rule.offset : 0
    const min = typeof rule.min === 'number' && Number.isFinite(rule.min) ? rule.min : undefined
    const max = typeof rule.max === 'number' && Number.isFinite(rule.max) ? rule.max : undefined
    output[targetKey] = Math.max(
      min ?? Number.NEGATIVE_INFINITY,
      Math.min(max ?? Number.POSITIVE_INFINITY, sourceValue * scale + offset),
    )
  }
  return output
}

function firstDefinedPartValue(part: PartComposePartInput, key: string): unknown {
  return (part as Record<string, unknown>)[key]
}

function mergePartDefaults(
  part: PartComposePartInput,
  defaults: Record<string, unknown>,
): PartComposePartInput {
  const next = { ...part } as Record<string, unknown>
  for (const [key, value] of Object.entries(defaults)) {
    if (next[key] == null) next[key] = value
  }
  return next as PartComposePartInput
}

function placementForPart(
  layoutTemplate: Record<string, unknown> | undefined,
  part: PartComposePartInput,
): Record<string, unknown> | undefined {
  const placements = Array.isArray(layoutTemplate?.placements) ? layoutTemplate.placements : []
  const role = String(part.semanticRole ?? '').toLowerCase()
  const kind = String(part.kind ?? part.partType ?? part.type ?? '').toLowerCase()
  return placements.filter(isRecord).find((placement) => {
    const placementRole = String(placement.role ?? placement.semanticRole ?? '').toLowerCase()
    const placementKind = String(placement.kind ?? '').toLowerCase()
    return (
      (placementRole.length > 0 && placementRole === role) ||
      (placementKind.length > 0 && placementKind === kind)
    )
  })
}

function applyResourcePackPartKnowledge(
  sourceArgs: Record<string, unknown>,
  parts: readonly PartComposePartInput[],
): PartComposePartInput[] {
  const layoutHints = isRecord(sourceArgs.layoutHints) ? sourceArgs.layoutHints : undefined
  const layoutTemplate = isRecord(layoutHints?.layoutTemplate)
    ? (layoutHints.layoutTemplate as Record<string, unknown>)
    : undefined
  const partPresetRefs = stringRecordValue(sourceArgs.partPresets)
  const partPresetDefinitions = objectRecordValue(sourceArgs.resolvedPartPresets)
  if (!layoutTemplate && !partPresetRefs && !partPresetDefinitions) return [...parts]

  const dimensions = {
    length: sourceArgs.length,
    width: sourceArgs.width,
    height: sourceArgs.height,
    diameter: sourceArgs.diameter,
    radius: sourceArgs.radius,
  }

  return parts.map((part) => {
    const role = String(part.semanticRole ?? '').trim()
    const kind = String(part.kind ?? part.partType ?? part.type ?? '').trim()
    const presetId =
      (typeof part.preset === 'string' && part.preset.trim() ? part.preset.trim() : undefined) ??
      partPresetRefs?.[role] ??
      partPresetRefs?.[kind]
    const preset = presetId ? partPresetDefinitions?.[presetId] : undefined
    const defaults = isRecord(preset?.defaults) ? preset.defaults : undefined
    const computed = calculatedPresetParameters(preset?.parameters, dimensions)
    const placement = placementForPart(layoutTemplate, part)
    const placementDimensions = isRecord(placement?.dimensions) ? placement.dimensions : undefined
    const placementParams = isRecord(placement?.params) ? placement.params : undefined
    let next = mergePartDefaults(part, {
      ...(defaults ?? {}),
      ...computed,
      ...(placementDimensions ?? {}),
      ...(placementParams ?? {}),
    })
    const position = vec3Value(placement?.position)
    if (position && firstDefinedPartValue(next, 'position') == null) next = { ...next, position }
    const rotation = vec3Value(placement?.rotation)
    if (rotation && firstDefinedPartValue(next, 'rotation') == null) next = { ...next, rotation }
    if (typeof placement?.anchor === 'string' && firstDefinedPartValue(next, 'anchor') == null) {
      next = { ...next, anchor: placement.anchor }
    }
    return next
  })
}

function shouldBuildRuntimeDraftProfile(args: Record<string, unknown>, prompt: string): boolean {
  const text = genericFallbackText(args, prompt).toLowerCase()
  return /industrial|factory|equipment|machine|apparatus|plant|process|press|filter|dryer|lyophili[sz]er|centrifuge|separator|conveyor|screw|auger|\u5de5\u5382|\u5de5\u4e1a|\u8bbe\u5907|\u8a2d\u5099|\u88c5\u7f6e|\u88dd\u7f6e|\u538b\u6ee4|\u58d3\u6ffe|\u51bb\u5e72|\u51cd\u4e7e|\u5206\u79bb|\u8f93\u9001|\u8f38\u9001|\u87ba\u65cb/.test(
    text,
  )
}

function registryPartFallbackShapes(
  targetArgs: Record<string, unknown>,
  sourceArgs: Record<string, unknown>,
  prompt: string,
  context?: GeometryToolExecutionContext,
): RawShape[] | undefined {
  const availableProfiles = context?.deviceProfiles ?? undefined
  const explicitDraftProfile = explicitDraftProfileFromArgs(sourceArgs, prompt)
  const inferredFamilyDefinition = inferFamilyDefinition({ ...sourceArgs, prompt })
  const inferredProfile = inferDeviceProfileDefinition({ ...sourceArgs, prompt }, availableProfiles)
  const draftFallbackAllowed =
    explicitDraftProfile != null ||
    (inferredProfile == null && shouldBuildRuntimeDraftProfile(sourceArgs, prompt))
  const fallbackDraft =
    draftFallbackAllowed && explicitDraftProfile == null
      ? buildDraftDeviceProfile(prompt, {
          ...sourceArgs,
          deviceProfileDraft: sourceArgs.deviceProfileDraft,
        }).profile
      : undefined
  const shouldUseFallbackDraft =
    fallbackDraft != null &&
    fallbackDraft.description !== 'Generic industrial fallback draft profile.'
  const explicitDraftValidation = explicitDraftProfile
    ? validateDeviceProfileForExecution(explicitDraftProfile)
    : undefined
  const draftProfile =
    (explicitDraftValidation?.ok ? explicitDraftProfile : undefined) ??
    (shouldUseFallbackDraft ? fallbackDraft : undefined)
  const profile = inferredProfile ?? draftProfile
  if (explicitDraftValidation && !explicitDraftValidation.ok && inferredProfile == null) {
    targetArgs.deviceProfileValidation = explicitDraftValidation
    targetArgs.profileFallbackReason = 'profile_validation_failed'
    targetArgs.family = 'generic'
    targetArgs.deviceProfile = undefined
    targetArgs.__deviceProfileDefinition = undefined
    return undefined
  }
  const profileValidation = profile ? validateDeviceProfileForExecution(profile) : undefined
  if (profileValidation && !profileValidation.ok) {
    targetArgs.deviceProfileValidation = profileValidation
    targetArgs.profileFallbackReason = 'profile_validation_failed'
    targetArgs.family = 'generic'
    targetArgs.deviceProfile = undefined
    targetArgs.__deviceProfileDefinition = undefined
    return undefined
  }
  const profiledSourceArgs = profile
    ? applyDeviceProfileToPartInput(profile, { ...sourceArgs, prompt })
    : sourceArgs
  const inferredFamily =
    (profile ? inferFamilyDefinition({ ...profiledSourceArgs, prompt }) : inferredFamilyDefinition)
      ?.id ?? inferFamilyDefinition({ ...profiledSourceArgs, prompt })?.id
  const family = executableFamilyForProfile(profile, inferredFamily)
  if (!family || family === 'vehicle') return undefined
  const explicitParts =
    profile && profile.source !== 'builtin' ? explicitProfileParts(profiledSourceArgs.parts) : []
  const normalizedPlan =
    explicitParts.length > 0
      ? { family, parts: explicitParts, warnings: [] }
      : normalizePartPlanForFamily(family, { ...profiledSourceArgs, prompt })
  if (!normalizedPlan?.parts.length) return undefined
  const roleAwareParts = profile
    ? applyProfilePartRoles(profile, normalizedPlan.parts)
    : normalizedPlan.parts
  const normalizedParts = profile
    ? applyResourcePackPartKnowledge(profiledSourceArgs, roleAwareParts)
    : roleAwareParts
  const layoutPlan = resolveLayout(
    {
      family: profile?.family ?? normalizedPlan.family,
      layoutFamily: profile?.layoutFamily,
      primarySemanticRole: profile?.primarySemanticRole,
    },
    normalizedParts,
    {
      length: typeof profiledSourceArgs.length === 'number' ? profiledSourceArgs.length : undefined,
      width: typeof profiledSourceArgs.width === 'number' ? profiledSourceArgs.width : undefined,
      height: typeof profiledSourceArgs.height === 'number' ? profiledSourceArgs.height : undefined,
      diameter:
        typeof profiledSourceArgs.diameter === 'number' ? profiledSourceArgs.diameter : undefined,
    },
  )
  const layoutParts = layoutPlan.parts

  const partInput: PartComposeInput = {
    ...(profiledSourceArgs as PartComposeInput),
    name:
      typeof profiledSourceArgs.name === 'string'
        ? profiledSourceArgs.name
        : typeof profiledSourceArgs.object === 'string'
          ? profiledSourceArgs.object
          : normalizedPlan.family.replace(/_/g, ' '),
    family: normalizedPlan.family,
    registryPartPlan: true,
    autoComplete: false,
    enhanceVisualDetails: false,
    parts: layoutParts,
  }
  const shapes = profile
    ? applyProfileShapeRoles(profile, composePartPrimitives(partInput) as RawShape[])
    : (composePartPrimitives(partInput) as RawShape[])
  if (shapes.length === 0) return undefined

  const executionValidation = profile
    ? profileExecutionSmokeValidation(profile, shapes, layoutParts)
    : undefined
  const fullProfileValidation =
    profile && profileValidation
      ? validateDeviceProfileForExecution(profile, executionValidation)
      : undefined
  if (fullProfileValidation && !fullProfileValidation.ok) {
    targetArgs.deviceProfileValidation = fullProfileValidation
    targetArgs.profileFallbackReason = 'profile_execution_validation_failed'
    return undefined
  }

  targetArgs.family = normalizedPlan.family
  targetArgs.parts = layoutParts
  targetArgs.__registryPartPlan = true
  targetArgs.layoutPlan = layoutPlan
  if (profile) {
    targetArgs.deviceProfile = profile.id
    targetArgs.archetypeFamily = profile.archetypeFamily
    targetArgs.layoutFamily = profile.layoutFamily
    targetArgs.layoutTemplate = profile.layoutTemplate
    targetArgs.profileSourcePack = profile.sourcePack
    targetArgs.profilePackId = profile.sourcePack?.id
    targetArgs.profilePackVersion = profile.sourcePack?.version
    targetArgs.partPresets = profile.partPresets
    targetArgs.resolvedPartPresets = profile.resolvedPartPresets
    targetArgs.qualityRules = profile.qualityRules
    targetArgs.profileSource = profile.source
    targetArgs.primarySemanticRole = profile.primarySemanticRole
    targetArgs.deviceProfileValidation = fullProfileValidation ?? profileValidation
    targetArgs.__deviceProfileDefinition = profile
    if (profile.status === 'runtime_draft') {
      targetArgs.deviceProfileDraft = profile
    }
  }
  for (const key of ['length', 'width', 'height', 'diameter']) {
    if (targetArgs[key] == null && profiledSourceArgs[key] != null) {
      targetArgs[key] = profiledSourceArgs[key]
    }
  }
  if (normalizedPlan.warnings.length > 0) targetArgs.partWarnings = normalizedPlan.warnings
  return shapes
}

function applyProfilePartRoles(
  profile: DeviceProfileDefinition,
  normalizedParts: readonly PartComposePartInput[],
): PartComposePartInput[] {
  const remainingProfileParts = [...profile.parts]
  return normalizedParts.map((part) => {
    const partId = String(part.id ?? '').toLowerCase()
    const partKind = String(part.kind).toLowerCase()
    const partRole = String(part.semanticRole).toLowerCase()
    const findBy = (
      predicate: (profilePart: DeviceProfileDefinition['parts'][number]) => boolean,
    ) => remainingProfileParts.findIndex(predicate)
    const index =
      (partId
        ? findBy((profilePart) => String(profilePart.id ?? '').toLowerCase() === partId)
        : -1) ?? -1
    const fallbackIndex =
      index >= 0
        ? index
        : findBy(
            (profilePart) =>
              String(profilePart.kind).toLowerCase() === partKind &&
              String(profilePart.semanticRole).toLowerCase() === partRole,
          )
    const roleIndex =
      fallbackIndex >= 0
        ? fallbackIndex
        : findBy((profilePart) => String(profilePart.semanticRole).toLowerCase() === partRole)
    const kindIndex =
      roleIndex >= 0
        ? roleIndex
        : findBy((profilePart) => String(profilePart.kind).toLowerCase() === partKind)
    const indexToUse = kindIndex
    if (indexToUse < 0) return part
    const [profilePart] = remainingProfileParts.splice(indexToUse, 1)
    if (!profilePart?.semanticRole) return part
    if (String(profilePart.kind).toLowerCase() === 'heat_exchanger') return part
    return {
      ...part,
      semanticRole: profilePart.semanticRole,
      ...(profilePart.required ? { required: true } : {}),
    }
  })
}

function applyProfileShapeRoles(
  profile: DeviceProfileDefinition,
  shapes: readonly RawShape[],
): RawShape[] {
  const rolesByKind = new Map<string, string[]>()
  for (const part of profile.parts) {
    const kind = String(part.kind).toLowerCase()
    const roles = rolesByKind.get(kind) ?? []
    if (!roles.includes(part.semanticRole)) roles.push(part.semanticRole)
    rolesByKind.set(kind, roles)
  }
  return shapes.map((shape) => {
    const sourceKind = String(shape.sourcePartKind ?? shape.kind ?? '').toLowerCase()
    const roles = rolesByKind.get(sourceKind)
    if (!roles || roles.length !== 1) return shape
    const role = roles[0]
    if (!role) return shape
    const currentRole = String(shape.semanticRole ?? '').toLowerCase()
    const replaceableShellRole =
      (sourceKind === 'cylindrical_tank' || sourceKind === 'agitator_tank') &&
      (currentRole === 'vessel_shell' ||
        currentRole === 'reactor_vessel_shell' ||
        currentRole === 'cylindrical_shell')
    if (currentRole && !replaceableShellRole) return shape
    return { ...shape, semanticRole: role }
  })
}

function profileExecutionSmokeValidation(
  profile: DeviceProfileDefinition,
  shapes: RawShape[],
  parts: readonly PartComposePartInput[] = [],
): DeviceProfileValidation {
  const issues: string[] = []
  const warnings: string[] = []
  const shapeLimit =
    profileShapeLimit({ qualityRules: profile.qualityRules }) ?? MAX_GENERATED_GEOMETRY_SHAPES
  if (shapes.length === 0) issues.push(`Profile ${profile.id} produced no shapes.`)
  if (shapes.length > shapeLimit) {
    issues.push(
      `Profile ${profile.id} produced ${shapes.length} shapes, above limit ${shapeLimit}.`,
    )
  }

  const roleText = textOf([
    shapes.map((shape) => [shape.semanticRole, shape.sourcePartKind, shape.name]),
    parts.map((part) => [part?.semanticRole, part?.kind, part?.name]),
  ]).toLowerCase()
  if (!roleText.includes(profile.primarySemanticRole.toLowerCase())) {
    issues.push(
      `Profile ${profile.id} primarySemanticRole "${profile.primarySemanticRole}" was not produced.`,
    )
  }

  const requiredRoles = profile.parts
    .filter((part) => part.required)
    .map((part) => part.semanticRole)
  const missingRequiredRoles = requiredRoles.filter(
    (role) => !roleText.includes(role.toLowerCase()),
  )
  if (missingRequiredRoles.length > 0) {
    issues.push(`Profile ${profile.id} missing required roles: ${missingRequiredRoles.join(', ')}.`)
  }

  const hasFiniteShape = shapes.some((shape) => {
    const values = [
      shape.length,
      shape.width,
      shape.height,
      shape.radius,
      shape.radiusTop,
      shape.radiusBottom,
      shape.majorRadius,
      shape.tubeRadius,
      shape.depth,
      shape.thickness,
    ]
    return values.some((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
  })
  if (!hasFiniteShape) issues.push(`Profile ${profile.id} produced no finite positive dimensions.`)
  if (shapes.length < Math.max(2, profile.parts.filter((part) => part.required).length)) {
    warnings.push(`Profile ${profile.id} produced a sparse geometry draft.`)
  }

  const requiredCount = Math.max(requiredRoles.length, 1)
  const coveredRequiredCount = requiredRoles.length - missingRequiredRoles.length
  const roleScore = requiredRoles.length === 0 ? 1 : coveredRequiredCount / requiredCount
  const shapeScore = shapes.length > 0 && shapes.length <= MAX_GENERATED_GEOMETRY_SHAPES ? 1 : 0
  const primaryScore = roleText.includes(profile.primarySemanticRole.toLowerCase()) ? 1 : 0
  const dimensionScore = hasFiniteShape ? 1 : 0
  const score = (roleScore + shapeScore + primaryScore + dimensionScore) / 4
  return { ok: issues.length === 0, issues, warnings, score }
}

function isRobotArmRequest(args: Record<string, unknown>, prompt: string): boolean {
  const text = [
    args.family,
    args.category,
    args.object,
    args.name,
    args.style,
    prompt,
    Array.isArray(args.parts)
      ? args.parts
          .filter(isRecord)
          .map((part) => [part.kind, part.semanticRole, part.name, part.id].join(' '))
          .join(' ')
      : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (/palletiz(?:er|ing)|ma\s+duo/.test(text)) return true
  return /robot[_\s-]?arm|industrial[_\s-]?robot|six[_\s-]?axis|cobot|manipulator|welding[_\s-]?cell|焊接机器人|机器人/.test(
    text,
  )
}

function robotArmAxisCount(args: Record<string, unknown>, prompt: string): number {
  const layoutHints = isRecord(args.layoutHints) ? args.layoutHints : undefined
  const robotDefaults = isRecord(layoutHints?.robotArmDefaults)
    ? layoutHints.robotArmDefaults
    : undefined
  const explicit = firstNumber(
    args.axisCount,
    args.axes,
    args.joints,
    robotDefaults?.axisCount,
    robotDefaults?.axes,
  )
  if (explicit != null) return Math.max(3, Math.min(7, Math.round(explicit)))
  const text = [prompt, args.name, args.object, args.style, args.category, args.geometryBrief]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (/seven[_\s-]?axis|7[_\s-]?axis|七轴|七軸/.test(text)) return 7
  if (/six[_\s-]?axis|6[_\s-]?axis|六轴|六軸|fanuc|kuka|abb/.test(text)) return 6
  if (/five[_\s-]?axis|5[_\s-]?axis|五轴|五軸/.test(text)) return 5
  if (/four[_\s-]?axis|4[_\s-]?axis|四轴|四軸|scara/.test(text)) return 4
  if (/three[_\s-]?axis|3[_\s-]?axis|三轴|三軸/.test(text)) return 3
  return 6
}

function isRobotArmWorkcellRequest(args: Record<string, unknown>, prompt: string): boolean {
  if (args.includeWorkcell === false || args.workcell === false || args.scope === 'arm_only') {
    return false
  }
  const layoutHints = isRecord(args.layoutHints) ? args.layoutHints : undefined
  const robotDefaults = isRecord(layoutHints?.robotArmDefaults)
    ? layoutHints.robotArmDefaults
    : undefined
  if (
    robotDefaults?.includeWorkcell === false ||
    robotDefaults?.workcell === false ||
    robotDefaults?.scope === 'arm_only'
  ) {
    return false
  }
  const text = [
    prompt,
    args.name,
    args.object,
    args.style,
    args.category,
    args.geometryBrief,
    Array.isArray(args.parts)
      ? args.parts
          .filter(isRecord)
          .map((part) => [part.kind, part.semanticRole, part.name, part.id].join(' '))
          .join(' ')
      : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const hasExplicitWorkcell =
    /workcell|work[_\s-]?station|welding[_\s-]?cell|fixture|\u710a\u63a5\u5de5\u4f5c\u7ad9|\u5de5\u4f5c\u7ad9/.test(
      text,
    )
  const hasNegatedAccessory =
    /(no|without|exclude|\u4e0d\u8981|\u4e0d\u9700\u8981|\u65e0\u9700|\u7121\u9700|\u65e0)\s*(work[_\s-]?table|control[_\s-]?cabinet|safety[_\s-]?barrier|guard[_\s-]?rail|\u5de5\u4f5c\u53f0|\u63a7\u5236\u67dc|\u62a4\u680f|\u8b77\u6b04)/.test(
      text,
    ) ||
    /(work[_\s-]?table|control[_\s-]?cabinet|safety[_\s-]?barrier|guard[_\s-]?rail|\u5de5\u4f5c\u53f0|\u63a7\u5236\u67dc|\u62a4\u680f|\u8b77\u6b04)\s*(not needed|excluded|\u4e0d\u8981|\u4e0d\u9700\u8981)/.test(
      text,
    )
  if (hasNegatedAccessory && !hasExplicitWorkcell) return false
  return /workcell|work[_\s-]?station|welding[_\s-]?cell|fixture|control[_\s-]?cabinet|safety[_\s-]?barrier|guard[_\s-]?rail|焊接工作站|工作站|控制柜|护栏|護欄/.test(
    text,
  )
}

function robotArmWorkstationFallbackShapes(
  targetArgs: Record<string, unknown>,
  sourceArgs: Record<string, unknown>,
  prompt: string,
  context?: GeometryToolExecutionContext,
): RawShape[] | undefined {
  if (!isRobotArmRequest(sourceArgs, prompt)) return undefined

  const profile = inferDeviceProfileDefinition(
    { ...sourceArgs, prompt },
    context?.deviceProfiles ?? undefined,
  )
  const profiledSourceArgs = profile
    ? applyDeviceProfileToPartInput(profile, { ...sourceArgs, prompt })
    : sourceArgs
  const layoutHints = isRecord(profiledSourceArgs.layoutHints)
    ? profiledSourceArgs.layoutHints
    : undefined
  const robotDefaults = isRecord(layoutHints?.robotArmDefaults)
    ? layoutHints.robotArmDefaults
    : undefined
  const dimensions = parseDimensionSemantics(prompt)
  const height =
    firstNumber(profiledSourceArgs.height, dimensions.height, robotDefaults?.height) ?? 1.8
  const length =
    firstNumber(profiledSourceArgs.length, dimensions.length, robotDefaults?.length) ?? 2.2
  const width =
    firstNumber(
      profiledSourceArgs.width,
      profiledSourceArgs.depth,
      dimensions.width,
      robotDefaults?.width,
    ) ?? 1.6
  const reach = Math.max(
    0.8,
    Math.min(2.4, firstNumber(profiledSourceArgs.reach, robotDefaults?.reach) ?? height * 0.72),
  )
  const axisCount = robotArmAxisCount(profiledSourceArgs, prompt)
  const includeWorkcell = isRobotArmWorkcellRequest(profiledSourceArgs, prompt)
  const endEffector =
    typeof profiledSourceArgs.endEffector === 'string'
      ? profiledSourceArgs.endEffector
      : typeof robotDefaults?.endEffector === 'string'
        ? robotDefaults.endEffector
        : 'tool-flange'
  const includeCableHarness =
    typeof profiledSourceArgs.includeCableHarness === 'boolean'
      ? profiledSourceArgs.includeCableHarness
      : typeof robotDefaults?.includeCableHarness === 'boolean'
        ? robotDefaults.includeCableHarness
        : true
  const robotName =
    typeof profiledSourceArgs.name === 'string' && profiledSourceArgs.name.trim()
      ? profiledSourceArgs.name.trim()
      : includeWorkcell
        ? 'industrial robot welding cell'
        : `${axisCount}-axis industrial robot arm`
  const robotShapes = composeRobotArmPrimitives({
    name: robotName,
    axisCount,
    pose: 'work-ready',
    endEffector,
    reach,
    includeCableHarness,
    primaryColor:
      typeof profiledSourceArgs.primaryColor === 'string'
        ? profiledSourceArgs.primaryColor
        : typeof robotDefaults?.primaryColor === 'string'
          ? robotDefaults.primaryColor
          : '#facc15',
    secondaryColor:
      typeof profiledSourceArgs.secondaryColor === 'string'
        ? profiledSourceArgs.secondaryColor
        : typeof robotDefaults?.secondaryColor === 'string'
          ? robotDefaults.secondaryColor
          : '#111827',
    metalColor:
      typeof profiledSourceArgs.metalColor === 'string'
        ? profiledSourceArgs.metalColor
        : typeof robotDefaults?.metalColor === 'string'
          ? robotDefaults.metalColor
          : '#cbd5e1',
  }) as RawShape[]

  const workTableLength = Math.max(0.55, length * 0.32)
  const workTableWidth = Math.max(0.38, width * 0.36)
  const workTableHeight = Math.max(0.18, height * 0.24)
  const tableX = Math.max(0.55, length * 0.28)
  const controlX = -Math.max(0.5, length * 0.34)
  const controlZ = Math.max(0.45, width * 0.36)
  const extras: RawShape[] = [
    {
      kind: 'box',
      name: `${robotName} fixture table top`,
      position: [tableX, workTableHeight, 0],
      length: workTableLength,
      width: workTableWidth,
      height: Math.max(0.04, height * 0.035),
      material: materialColor({ color: '#475569' }, '#475569'),
      semanticRole: 'work_table',
      sourcePartKind: 'work_table',
    },
    {
      kind: 'box',
      name: `${robotName} fixture table base`,
      position: [tableX, workTableHeight * 0.5, 0],
      length: workTableLength * 0.78,
      width: workTableWidth * 0.72,
      height: workTableHeight,
      material: materialColor({ color: '#1f2937' }, '#1f2937'),
      semanticRole: 'work_table',
      sourcePartKind: 'work_table',
    },
    {
      kind: 'box',
      name: `${robotName} control cabinet`,
      position: [controlX, height * 0.38, controlZ],
      length: Math.max(0.22, width * 0.16),
      width: Math.max(0.18, width * 0.12),
      height: Math.max(0.7, height * 0.62),
      material: materialColor({ color: '#e5e7eb' }, '#e5e7eb'),
      semanticRole: 'control_panel',
      sourcePartKind: 'control_box',
    },
    {
      kind: 'box',
      name: `${robotName} control screen`,
      position: [controlX, height * 0.52, controlZ + Math.max(0.095, width * 0.065)],
      length: Math.max(0.12, width * 0.09),
      width: 0.012,
      height: Math.max(0.08, height * 0.07),
      material: materialColor({ color: '#0f172a' }, '#0f172a'),
      semanticRole: 'control_panel',
      sourcePartKind: 'display_screen',
    },
    {
      kind: 'cylinder',
      name: `${robotName} welding torch`,
      position: [tableX * 0.45, height * 0.78, 0],
      axis: 'z',
      radius: Math.max(0.012, reach * 0.012),
      height: Math.max(0.16, reach * 0.16),
      material: materialColor({ color: '#94a3b8' }, '#94a3b8'),
      semanticRole: 'end_effector',
      sourcePartKind: 'welding_torch',
    },
    {
      kind: 'box',
      name: `${robotName} safety barrier rail`,
      position: [0, height * 0.32, -width * 0.48],
      length: length,
      width: 0.035,
      height: 0.045,
      material: materialColor({ color: '#facc15' }, '#facc15'),
      semanticRole: 'safety_barrier',
      sourcePartKind: 'safety_barrier',
    },
    {
      kind: 'box',
      name: `${robotName} warning label`,
      position: [controlX, height * 0.25, controlZ + Math.max(0.1, width * 0.07)],
      length: Math.max(0.1, width * 0.07),
      width: 0.01,
      height: Math.max(0.06, height * 0.045),
      material: materialColor({ color: '#f97316' }, '#f97316'),
      semanticRole: 'warning_label',
      sourcePartKind: 'warning_label',
    },
  ]

  targetArgs.family = 'robot_arm'
  targetArgs.name = robotName
  if (profile) {
    targetArgs.deviceProfile = profile.id
    targetArgs.archetypeFamily = profile.archetypeFamily
    targetArgs.layoutFamily = profile.layoutFamily
    targetArgs.layoutTemplate = profile.layoutTemplate
    targetArgs.profileSourcePack = profile.sourcePack
    targetArgs.profilePackId = profile.sourcePack?.id
    targetArgs.profilePackVersion = profile.sourcePack?.version
    targetArgs.partPresets = profile.partPresets
    targetArgs.resolvedPartPresets = profile.resolvedPartPresets
    targetArgs.qualityRules = profile.qualityRules
    targetArgs.layoutHints = profile.layoutHints
    targetArgs.profileSource = profile.source
    targetArgs.primarySemanticRole = profile.primarySemanticRole
    targetArgs.__deviceProfileDefinition = profile
    if (profile.status === 'runtime_draft') {
      targetArgs.deviceProfileDraft = profile
    }
  }
  targetArgs.__fallbackGeometryBrief = {
    category: 'robot_arm',
    units: 'm',
    coordinateConvention: '+X work direction, +Y up, +Z cell width; y=0 is floor',
    expectedDimensions: { length, width, height },
    requiredRoles: [
      'robot_base',
      'base_joint',
      'shoulder_joint',
      'upper_arm',
      'elbow_joint',
      'forearm',
      'wrist_joint',
      'end_effector',
      ...(includeWorkcell
        ? ['work_table', 'control_panel', 'safety_barrier', 'warning_label']
        : []),
    ],
  }
  targetArgs.axisCount = axisCount
  targetArgs.sourceStrategy = includeWorkcell
    ? 'robot_arm_workstation_fallback'
    : 'robot_arm_only_fallback'
  return includeWorkcell ? [...robotShapes, ...extras] : robotShapes
}

function genericPrimitiveFallbackGeometryBrief(
  args: Record<string, unknown>,
  prompt: string,
): PrimitiveGeometryBrief {
  if (isRiverIntent(args, prompt)) return riverFallbackGeometryBrief(args, prompt)
  const constraints = nestedRecord(args, 'constraints')
  const dimensions = nestedRecord(args, 'dimensions')
  const directBrief = nestedRecord(args, 'geometryBrief')
  const expectedDimensions = isRecord(directBrief.expectedDimensions)
    ? directBrief.expectedDimensions
    : {}
  const promptDimensions = parseDimensionSemantics(prompt)
  const category = classifyGenericPrimitiveFallback(args, prompt)
  const length =
    firstNumber(
      args.length,
      constraints.length,
      dimensions.length,
      expectedDimensions.length,
      promptDimensions.length,
    ) ?? (category === 'building' ? 2.4 : category === 'landscape_rockery' ? 2.2 : 1.4)
  const width =
    firstNumber(
      args.width,
      args.diameter,
      constraints.width,
      constraints.diameter,
      dimensions.width,
      dimensions.diameter,
      expectedDimensions.width,
      promptDimensions.width,
    ) ?? (category === 'building' ? 1.8 : category === 'landscape_rockery' ? 1.4 : 0.9)
  const height =
    firstNumber(
      args.height,
      constraints.height,
      dimensions.height,
      expectedDimensions.height,
      promptDimensions.height,
    ) ?? (category === 'building' ? 1.8 : category === 'landscape_rockery' ? 1.3 : 1.0)

  const requiredRoles =
    category === 'landscape_rockery'
      ? ['rock_mass', 'rock_layer', 'support_base']
      : category === 'landscape_natural'
        ? ['terrain_base', 'natural_mass', 'detail_accent']
        : category === 'equipment'
          ? ['main_body', 'support_base', 'control_detail']
          : category === 'building'
            ? ['building_body', 'roof', 'opening']
            : category === 'furniture'
              ? ['furniture_body', 'support_leg', 'detail_accent']
              : ['main_body', 'support_base', 'detail_accent']

  return {
    category,
    units: 'm',
    coordinateConvention: '+X length, +Y up, +Z width; y=0 is ground/base',
    expectedDimensions: { length, width, height },
    requiredRoles,
    assumptions: [
      'freeform assembly fallback because no dedicated recipe, assembly family, or reusable part matched',
      'low-detail editable draft intended for follow-up refinement',
    ],
  }
}

function materialColor(args: Record<string, unknown>, fallback: string): PrimitiveMaterialInput {
  const constraints = nestedRecord(args, 'constraints')
  const color =
    typeof args.primaryColor === 'string'
      ? args.primaryColor
      : typeof args.color === 'string'
        ? args.color
        : typeof constraints.primaryColor === 'string'
          ? constraints.primaryColor
          : fallback
  return { properties: { color, roughness: 0.72, metalness: 0 } }
}

function genericRockeryPrimitiveFallbackShapes(
  args: Record<string, unknown>,
  brief: PrimitiveGeometryBrief,
): RawShape[] {
  const length = brief.expectedDimensions?.length ?? 2.2
  const width = brief.expectedDimensions?.width ?? 1.4
  const height = brief.expectedDimensions?.height ?? 1.3
  const stone = materialColor(args, '#6b7280')
  const darkStone: PrimitiveMaterialInput = {
    properties: { color: '#4b5563', roughness: 0.86, metalness: 0 },
  }
  return [
    {
      kind: 'rounded-panel',
      name: 'generic rockery ground base',
      semanticRole: 'support_base',
      semanticGroup: 'generic_fallback',
      sourcePartKind: 'generic.landscape_base',
      position: [0, 0.04, 0],
      length,
      width,
      thickness: 0.08,
      cornerRadius: Math.min(length, width) * 0.16,
      material: { properties: { color: '#5f6f4e', roughness: 0.9, metalness: 0 } },
    },
    {
      kind: 'sphere',
      name: 'large irregular rock mass',
      semanticRole: 'rock_mass',
      semanticGroup: 'generic_fallback',
      sourcePartKind: 'generic.rock_mass',
      position: [-length * 0.18, height * 0.34, 0],
      radius: 0.55,
      scale: [length * 0.55, height * 0.7, width * 0.55],
      material: stone,
    },
    {
      kind: 'sphere',
      name: 'tall side rock mass',
      semanticRole: 'rock_mass',
      semanticGroup: 'generic_fallback',
      sourcePartKind: 'generic.rock_mass',
      position: [length * 0.18, height * 0.42, -width * 0.14],
      radius: 0.48,
      scale: [length * 0.38, height * 0.86, width * 0.42],
      material: darkStone,
    },
    {
      kind: 'cone',
      name: 'jagged upper peak',
      semanticRole: 'rock_mass',
      semanticGroup: 'generic_fallback',
      sourcePartKind: 'generic.rock_peak',
      position: [length * 0.08, height * 0.82, width * 0.05],
      axis: 'y',
      radius: Math.min(length, width) * 0.22,
      height: height * 0.5,
      material: stone,
    },
    ...[-0.32, 0.05, 0.34].map(
      (x, index): RawShape => ({
        kind: 'box',
        name: `layered rock ledge ${index + 1}`,
        semanticRole: 'rock_layer',
        semanticGroup: 'generic_fallback',
        sourcePartKind: 'generic.rock_layer',
        position: [length * x, height * (0.24 + index * 0.13), width * (index - 1) * 0.16],
        rotation: [0, index % 2 === 0 ? 0.24 : -0.18, 0],
        length: length * 0.34,
        width: width * 0.32,
        height: height * 0.09,
        material: index % 2 === 0 ? darkStone : stone,
      }),
    ),
  ]
}

function genericObjectPrimitiveFallbackShapes(
  args: Record<string, unknown>,
  prompt: string,
): RawShape[] {
  if (isRiverIntent(args, prompt)) return riverPrimitiveFallbackShapes(args, prompt)
  const brief = genericPrimitiveFallbackGeometryBrief(args, prompt)
  const category = classifyGenericPrimitiveFallback(args, prompt)
  if (category === 'landscape_rockery') return genericRockeryPrimitiveFallbackShapes(args, brief)

  const length = brief.expectedDimensions?.length ?? 1.4
  const width = brief.expectedDimensions?.width ?? 0.9
  const height = brief.expectedDimensions?.height ?? 1
  const bodyMaterial = materialColor(
    args,
    category === 'landscape_natural'
      ? '#6b8f47'
      : category === 'building'
        ? '#d1d5db'
        : category === 'equipment'
          ? '#64748b'
          : '#9ca3af',
  )
  const darkMaterial: PrimitiveMaterialInput = {
    properties: { color: '#111827', roughness: 0.65, metalness: 0.05 },
  }
  const accentMaterial: PrimitiveMaterialInput = {
    properties: { color: '#38bdf8', roughness: 0.35, metalness: 0 },
  }

  if (category === 'building') {
    return [
      {
        kind: 'box',
        name: 'generic building body',
        semanticRole: 'building_body',
        semanticGroup: 'generic_fallback',
        sourcePartKind: 'generic.building_body',
        position: [0, height * 0.42, 0],
        length,
        width,
        height: height * 0.84,
        material: bodyMaterial,
      },
      {
        kind: 'wedge',
        name: 'generic pitched roof',
        semanticRole: 'roof',
        semanticGroup: 'generic_fallback',
        sourcePartKind: 'generic.roof',
        position: [0, height * 0.92, 0],
        length: length * 1.08,
        width: width * 1.08,
        height: height * 0.28,
        material: { properties: { color: '#7f1d1d', roughness: 0.78, metalness: 0 } },
      },
      {
        kind: 'rounded-panel',
        name: 'front opening panel',
        semanticRole: 'opening',
        semanticGroup: 'generic_fallback',
        sourcePartKind: 'generic.opening',
        position: [0, height * 0.36, width * 0.51],
        length: length * 0.22,
        width: height * 0.34,
        thickness: 0.03,
        material: darkMaterial,
      },
    ]
  }

  if (category === 'equipment') {
    const isCoffeeMachine = /coffee|espresso|\u5496\u5561\u673a/i.test(
      genericFallbackText(args, prompt),
    )
    return [
      {
        kind: 'box',
        name: 'generic equipment main housing',
        semanticRole: 'main_body',
        semanticGroup: 'generic_fallback',
        sourcePartKind: 'generic.equipment_body',
        position: [0, height * 0.5, 0],
        length,
        width,
        height: height * 0.78,
        cornerRadius: Math.min(length, width, height) * 0.06,
        material: bodyMaterial,
      },
      {
        kind: 'rounded-panel',
        name: 'generic equipment base skid',
        semanticRole: 'support_base',
        semanticGroup: 'generic_fallback',
        sourcePartKind: 'generic.support_base',
        position: [0, height * 0.08, 0],
        length: length * 1.08,
        width: width * 1.08,
        thickness: height * 0.12,
        material: darkMaterial,
      },
      {
        kind: 'rounded-panel',
        name: 'generic control detail',
        semanticRole: 'control_detail',
        semanticGroup: 'generic_fallback',
        sourcePartKind: 'generic.control_detail',
        position: [length * 0.18, height * 0.62, width * 0.51],
        length: length * 0.3,
        width: height * 0.28,
        thickness: 0.03,
        material: accentMaterial,
      },
      ...(isCoffeeMachine
        ? ([
            {
              kind: 'cylinder',
              name: 'freeform coffee spout',
              semanticRole: 'spout',
              semanticGroup: 'generic_fallback',
              sourcePartKind: 'generic.spout',
              position: [0, height * 0.52, width * 0.58],
              axis: 'z',
              radius: Math.min(length, width) * 0.035,
              height: width * 0.22,
              material: darkMaterial,
            },
            {
              kind: 'rounded-panel',
              name: 'freeform cup platform',
              semanticRole: 'cup_platform',
              semanticGroup: 'generic_fallback',
              sourcePartKind: 'generic.platform',
              position: [0, height * 0.18, width * 0.56],
              length: length * 0.44,
              width: width * 0.28,
              thickness: height * 0.055,
              cornerRadius: Math.min(length, width) * 0.04,
              material: darkMaterial,
            },
          ] satisfies RawShape[])
        : []),
    ]
  }

  const rolePrefix =
    category === 'furniture' ? 'furniture' : category === 'landscape_natural' ? 'natural' : 'main'
  return [
    {
      kind: 'rounded-panel',
      name: 'generic fallback support base',
      semanticRole:
        category === 'landscape_natural'
          ? 'terrain_base'
          : category === 'furniture'
            ? 'support_leg'
            : 'support_base',
      semanticGroup: 'generic_fallback',
      sourcePartKind: 'generic.support_base',
      position: [0, height * 0.08, 0],
      length,
      width,
      thickness: height * 0.12,
      material: darkMaterial,
    },
    {
      kind: category === 'landscape_natural' ? 'sphere' : 'box',
      name: `generic ${rolePrefix} body`,
      semanticRole:
        category === 'landscape_natural'
          ? 'natural_mass'
          : category === 'furniture'
            ? 'furniture_body'
            : 'main_body',
      semanticGroup: 'generic_fallback',
      sourcePartKind: 'generic.main_body',
      position: [0, height * 0.5, 0],
      length: category === 'landscape_natural' ? undefined : length * 0.82,
      width: category === 'landscape_natural' ? undefined : width * 0.82,
      height: category === 'landscape_natural' ? undefined : height * 0.74,
      radius: category === 'landscape_natural' ? Math.min(length, width, height) * 0.42 : undefined,
      scale: category === 'landscape_natural' ? [1.6, 0.75, 1.1] : undefined,
      cornerRadius:
        category === 'landscape_natural' ? undefined : Math.min(length, width, height) * 0.06,
      material: bodyMaterial,
    },
    {
      kind: 'rounded-panel',
      name: 'generic fallback detail accent',
      semanticRole: 'detail_accent',
      semanticGroup: 'generic_fallback',
      sourcePartKind: 'generic.detail_accent',
      position: [length * 0.18, height * 0.68, width * 0.43],
      length: length * 0.24,
      width: height * 0.16,
      thickness: 0.025,
      material: accentMaterial,
    },
  ]
}

function applyGenericPrimitiveFallback(
  targetArgs: Record<string, unknown>,
  sourceArgs: Record<string, unknown>,
  prompt: string,
): RawShape[] {
  if (
    !isRiverIntent(sourceArgs, prompt) &&
    classifyGenericPrimitiveFallback(sourceArgs, prompt) !== 'landscape_rockery'
  ) {
    const genericPartShapes = genericPartFallbackShapes(targetArgs, sourceArgs, prompt)
    if (genericPartShapes?.length) return genericPartShapes
  }
  const fallbackBrief = genericPrimitiveFallbackGeometryBrief(sourceArgs, prompt)
  const fallbackShapes = genericObjectPrimitiveFallbackShapes(sourceArgs, prompt)
  targetArgs.__fallbackGeometryBrief = fallbackBrief
  targetArgs.__genericPrimitiveFallback = true
  targetArgs.__freeformAssemblyFallback = true
  targetArgs.shapes = fallbackShapes
  return fallbackShapes
}

function genericPartFallbackShapes(
  targetArgs: Record<string, unknown>,
  sourceArgs: Record<string, unknown>,
  prompt: string,
): RawShape[] | undefined {
  const fallbackBrief = genericPrimitiveFallbackGeometryBrief(sourceArgs, prompt)
  const expectedDimensions = fallbackBrief.expectedDimensions ?? {}
  const partInput: PartComposeInput = {
    ...(sourceArgs as PartComposeInput),
    name:
      typeof sourceArgs.name === 'string'
        ? sourceArgs.name
        : typeof sourceArgs.object === 'string'
          ? sourceArgs.object
          : prompt,
    length: firstNumber(sourceArgs.length, expectedDimensions.length),
    width: firstNumber(sourceArgs.width, sourceArgs.depth, expectedDimensions.width),
    height: firstNumber(sourceArgs.height, expectedDimensions.height),
    primaryColor:
      typeof sourceArgs.primaryColor === 'string'
        ? sourceArgs.primaryColor
        : typeof sourceArgs.color === 'string'
          ? sourceArgs.color
          : undefined,
    autoComplete: true,
    enhanceVisualDetails: false,
    geometryBrief: fallbackBrief,
  }
  const normalizedPlan = normalizeGenericPartPlan({ ...partInput, prompt })
  const shapes = composePartPrimitives({
    ...partInput,
    parts: normalizedPlan.parts,
  }) as RawShape[]
  if (shapes.length === 0) return undefined

  targetArgs.__fallbackGeometryBrief = fallbackBrief
  targetArgs.__genericPartFallback = true
  targetArgs.__freeformAssemblyFallback = true
  targetArgs.family = 'generic'
  targetArgs.parts = normalizedPlan.parts
  if (partInput.length != null) targetArgs.length = partInput.length
  if (partInput.width != null) targetArgs.width = partInput.width
  if (partInput.height != null) targetArgs.height = partInput.height
  if (partInput.primaryColor) targetArgs.primaryColor = partInput.primaryColor
  if (normalizedPlan.warnings.length > 0) targetArgs.partWarnings = normalizedPlan.warnings
  return shapes
}

function isAircraftIntent(
  args: Record<string, unknown>,
  prompt: string,
  context?: GeometryToolExecutionContext,
): boolean {
  const explicitFamily =
    typeof args.family === 'string' ? inferFamilyDefinition({ family: args.family })?.id : undefined
  if (explicitFamily && explicitFamily !== 'aircraft') return false
  const roleText = (context?.blueprintRequiredRoles ?? []).join(' ')
  const text =
    `${prompt} ${context?.blueprintCategory ?? ''} ${roleText} ${JSON.stringify(args)}`.toLowerCase()
  return /aircraft|airliner|boeing|airplane|plane|fuselage|landing[_\s-]?gear|\u98de\u673a|\u5ba2\u673a|\u6ce2\u97f3/.test(
    text,
  )
}

function isVehicleIntent(
  args: Record<string, unknown>,
  prompt: string,
  context?: GeometryToolExecutionContext,
): boolean {
  const roleText = (context?.blueprintRequiredRoles ?? []).join(' ')
  const text =
    `${prompt} ${context?.blueprintCategory ?? ''} ${roleText} ${JSON.stringify(args)}`.toLowerCase()
  return /vehicle|sedan|suv|truck|van|automobile|(?:^|[\s_-])(?:car|auto)(?:$|[\s_-])|\u6c7d\u8f66|\u8f7f\u8f66/.test(
    text,
  )
}

function isVehicleComponentIntent(
  args: Record<string, unknown>,
  prompt: string,
  context?: GeometryToolExecutionContext,
): boolean {
  const parts = Array.isArray(args.parts) ? args.parts.filter(isRecord) : []
  const hasVehicleBodyPart = parts.some((part) =>
    /vehicle_body|body_shell|car_body/.test(
      String(part.kind ?? part.partType ?? part.type ?? part.semanticRole ?? '').toLowerCase(),
    ),
  )
  if (hasVehicleBodyPart) return false

  const text =
    `${prompt} ${context?.blueprintCategory ?? ''} ${(context?.blueprintRequiredRoles ?? []).join(' ')} ${JSON.stringify(args)}`.toLowerCase()
  if (
    /steering[_\s-]?wheel|tire|tyre|wheel\b|rim|hub|\u8f6e\u80ce|\u8f66\u8f6e|\u65b9\u5411\u76d8/.test(
      text,
    )
  ) {
    return true
  }
  const geometryBrief = nestedRecord(args, 'geometryBrief')
  const category = String(geometryBrief.category ?? context?.blueprintCategory ?? '').toLowerCase()
  return /component|part|single/.test(category)
}

function coherentVehicleFallbackInput(
  args: Record<string, unknown>,
  prompt: string,
): AssemblyComposeInput {
  const constraints = nestedRecord(args, 'constraints')
  const dimensions = nestedRecord(args, 'dimensions')
  const geometryBrief = nestedRecord(args, 'geometryBrief')
  const expectedDimensions = isRecord(geometryBrief.expectedDimensions)
    ? geometryBrief.expectedDimensions
    : {}
  return {
    family: 'vehicle',
    object:
      typeof args.object === 'string'
        ? args.object
        : typeof args.name === 'string'
          ? args.name
          : undefined,
    style: typeof args.style === 'string' ? args.style : undefined,
    prompt,
    length: firstNumber(
      args.length,
      constraints.length,
      dimensions.length,
      expectedDimensions.length,
    ),
    width: firstNumber(
      args.width,
      args.depth,
      constraints.width,
      constraints.depth,
      dimensions.width,
      dimensions.depth,
      expectedDimensions.width,
      expectedDimensions.depth,
    ),
    height: firstNumber(
      args.height,
      constraints.height,
      dimensions.height,
      expectedDimensions.height,
    ),
    primaryColor:
      typeof args.primaryColor === 'string'
        ? args.primaryColor
        : typeof args.color === 'string'
          ? args.color
          : typeof constraints.primaryColor === 'string'
            ? constraints.primaryColor
            : undefined,
  }
}

function coherentVehicleFallbackShapes(
  args: Record<string, unknown>,
  prompt: string,
): RawShape[] | undefined {
  const fallbackInput = coherentVehicleFallbackInput(args, prompt)
  const shapes = composeAssemblyPrimitives(fallbackInput) as RawShape[]
  if (shapes.length === 0) return undefined
  args.__fallbackGeometryBrief = getAssemblyGeometryBrief(fallbackInput)
  args.family = 'vehicle'
  const normalizedPlan = normalizeVehiclePartPlan(args)
  args.parts = normalizedPlan.parts
  if (normalizedPlan.warnings.length > 0) args.partWarnings = normalizedPlan.warnings
  if (fallbackInput.length != null) args.length = fallbackInput.length
  if (fallbackInput.width != null) args.width = fallbackInput.width
  if (fallbackInput.height != null) args.height = fallbackInput.height
  if (fallbackInput.primaryColor) args.primaryColor = fallbackInput.primaryColor
  return shapes
}

function shouldUseCoherentVehicleFallback(
  args: Record<string, unknown>,
  prompt: string,
  context?: GeometryToolExecutionContext,
): boolean {
  if (!isVehicleIntent(args, prompt, context)) return false
  if (isVehicleComponentIntent(args, prompt, context)) return false
  if (isAircraftIntent(args, prompt, context)) return false
  const parts = Array.isArray(args.parts) ? args.parts.filter(isRecord) : []
  if (parts.length === 0) return false
  return parts.some((part) =>
    /vehicle|car|sedan|suv|truck|body_shell|body|wheel_set|window_strip|headlight|bumper/.test(
      String(
        [part.kind, part.partType, part.type, part.semanticRole, part.name, part.id].join(' '),
      ).toLowerCase(),
    ),
  )
}

function compactAircraftFallbackInput(
  args: Record<string, unknown>,
  prompt: string,
  context?: GeometryToolExecutionContext,
): Record<string, unknown> {
  const constraints = nestedRecord(args, 'constraints')
  const dimensions = nestedRecord(args, 'dimensions')
  const geometryBrief = nestedRecord(args, 'geometryBrief')
  const expectedDimensions = isRecord(geometryBrief.expectedDimensions)
    ? geometryBrief.expectedDimensions
    : {}
  const length = firstNumber(
    args.length,
    constraints.length,
    dimensions.length,
    expectedDimensions.length,
    firstAircraftPartNumber(args, 'length'),
  )
  const requiredRoles = [
    'aircraft_fuselage',
    'aircraft_wing',
    'aircraft_horizontal_stabilizer',
    'aircraft_vertical_stabilizer',
    'aircraft_landing_gear_main',
    'aircraft_landing_gear_nose',
    'aircraft_window',
    'aircraft_engine_nacelle',
  ]

  const sourceParts =
    Array.isArray(args.parts) && args.parts.some(isRecord)
      ? args.parts
      : [{ kind: 'aircraft_fuselage', id: 'aircraft_fuselage' }]
  const baseInput = applyPromptDimensionSemanticsToPartInput(
    {
      name: typeof args.name === 'string' ? args.name : 'compact aircraft',
      family: 'aircraft',
      ...(length ? { length } : {}),
      primaryColor: args.primaryColor ?? args.color,
      secondaryColor: args.secondaryColor,
      darkColor: args.darkColor,
      accentColor: args.accentColor,
      geometryBrief: {
        ...geometryBrief,
        category: 'aircraft',
        expectedDimensions: {
          ...(isRecord(geometryBrief.expectedDimensions) ? geometryBrief.expectedDimensions : {}),
          ...(length ? { length } : {}),
        },
        requiredRoles,
      },
      parts: sourceParts,
    },
    prompt,
  )
  const normalizedPlan = normalizeAircraftPartPlan({ ...baseInput, prompt })

  return {
    ...baseInput,
    parts: normalizedPlan.parts,
    ...(normalizedPlan.warnings.length > 0 ? { partWarnings: normalizedPlan.warnings } : {}),
  }
}

function compactAircraftFallbackShapes(
  args: Record<string, unknown>,
  prompt: string,
  context?: GeometryToolExecutionContext,
): RawShape[] | undefined {
  if (!isAircraftIntent(args, prompt, context)) return undefined
  const fallbackInput = compactAircraftFallbackInput(args, prompt, context)
  const shapes = composePartPrimitives(fallbackInput as PartComposeInput) as RawShape[]
  if (shapes.length === 0) return undefined
  args.__fallbackGeometryBrief = fallbackInput.geometryBrief
  args.family = 'aircraft'
  args.parts = fallbackInput.parts
  if (Array.isArray(fallbackInput.partWarnings)) args.partWarnings = fallbackInput.partWarnings
  if (fallbackInput.length != null) args.length = fallbackInput.length
  if (fallbackInput.primaryColor) args.primaryColor = fallbackInput.primaryColor
  if (fallbackInput.secondaryColor) args.secondaryColor = fallbackInput.secondaryColor
  if (fallbackInput.darkColor) args.darkColor = fallbackInput.darkColor
  if (fallbackInput.accentColor) args.accentColor = fallbackInput.accentColor
  return shapes
}

function shouldUseCompactAircraftFallback(
  args: Record<string, unknown>,
  prompt: string,
  context?: GeometryToolExecutionContext,
): boolean {
  if (!isAircraftIntent(args, prompt, context)) return false
  const parts = Array.isArray(args.parts) ? args.parts.filter(isRecord) : []
  if (parts.length === 0) return true
  return !parts.some((part) =>
    /aircraft_(fuselage|wing|engine|vertical_stabilizer|horizontal_stabilizer|landing_gear)/.test(
      String(part.kind ?? part.partType ?? part.type ?? '').toLowerCase(),
    ),
  )
}

function firstAircraftPartNumber(args: Record<string, unknown>, key: string): number | undefined {
  const parts = Array.isArray(args.parts) ? args.parts.filter(isRecord) : []
  for (const part of parts) {
    const kind = String(part.kind ?? part.partType ?? part.type ?? '').toLowerCase()
    const role = String(part.semanticRole ?? '').toLowerCase()
    if (!/(aircraft_)?fuselage|streamlined_body|fuselage_body/.test(`${kind} ${role}`)) continue
    const direct = part[key]
    if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) return direct
    const dimensions = isRecord(part.dimensions) ? part.dimensions : {}
    const dimensionValue = dimensions[key]
    if (
      typeof dimensionValue === 'number' &&
      Number.isFinite(dimensionValue) &&
      dimensionValue > 0
    ) {
      return dimensionValue
    }
  }
  return undefined
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  return undefined
}

function nestedRecord(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = args[key]
  return isRecord(value) ? value : {}
}

function chimneyPartFallbackInput(args: Record<string, unknown>, prompt: string): PartComposeInput {
  const constraints = nestedRecord(args, 'constraints')
  const dimensions = nestedRecord(args, 'dimensions')
  const geometryBrief = nestedRecord(args, 'geometryBrief')
  const expectedDimensions = isRecord(geometryBrief.expectedDimensions)
    ? geometryBrief.expectedDimensions
    : {}
  const promptDimensions = parseDimensionSemantics(prompt)
  const height =
    firstNumber(
      args.height,
      constraints.height,
      dimensions.height,
      expectedDimensions.height,
      promptDimensions.height,
    ) ?? 10
  const diameter = firstNumber(
    args.diameter,
    constraints.diameter,
    dimensions.diameter,
    expectedDimensions.diameter,
    args.width,
    constraints.width,
    dimensions.width,
    expectedDimensions.width,
  )
  const radius =
    firstNumber(args.radius, constraints.radius, dimensions.radius, expectedDimensions.radius) ??
    (diameter != null ? diameter / 2 : Math.max(0.35, Math.min(0.8, height * 0.05)))
  const color =
    typeof args.primaryColor === 'string'
      ? args.primaryColor
      : typeof constraints.primaryColor === 'string'
        ? constraints.primaryColor
        : '#5C5C5C'

  return {
    name: 'industrial chimney',
    height,
    radius,
    primaryColor: color,
    geometryBrief: {
      category: 'industrial chimney',
      requiredRoles: ['chimney_body', 'chimney_shaft', 'chimney_cap', 'chimney_opening'],
      expectedDimensions: { height, radius },
    },
    parts: [],
  }
}

function chimneyPrimitiveFallbackShapes(input: PartComposeInput): RawShape[] {
  const height = firstNumber(input.height) ?? 10
  const midRadius = firstNumber(input.radius) ?? 0.5
  const topOuterRadius = midRadius * 0.72
  const bottomOuterRadius = midRadius * 1.18
  const openingRadius = topOuterRadius * 0.58
  const ringOuterRadius = topOuterRadius * 1.08
  const ringTubeRadius = Math.max(0.035, (ringOuterRadius - openingRadius) / 2)
  const ringMajorRadius = openingRadius + ringTubeRadius
  const color = input.primaryColor ?? '#5C5C5C'
  const bodyBottomY = 0
  const bodyTopY = height

  return [
    {
      kind: 'frustum',
      name: 'industrial chimney tapered hollow stack body',
      position: [0, height / 2, 0],
      axis: 'y',
      radiusBottom: bottomOuterRadius,
      radiusTop: topOuterRadius,
      height,
      radialSegments: 48,
      wallThickness: Math.max(0.08, topOuterRadius - openingRadius),
      material: { properties: { color, roughness: 0.68, metalness: 0.16 } },
      semanticRole: 'chimney_body',
      semanticGroup: 'chimney_shaft',
      sourcePartKind: 'chimney_shaft',
      sourcePartId: 'chimney_shaft',
    },
    {
      kind: 'torus',
      name: 'industrial chimney raised circular top rim around opening',
      position: [0, bodyTopY + ringTubeRadius * 0.3, 0],
      axis: 'y',
      majorRadius: ringMajorRadius,
      tubeRadius: ringTubeRadius,
      radialSegments: 48,
      tubularSegments: 12,
      material: { properties: { color, roughness: 0.62, metalness: 0.18 } },
      semanticRole: 'chimney_cap',
      semanticGroup: 'chimney_cap',
      sourcePartKind: 'chimney_cap',
      sourcePartId: 'chimney_cap',
    },
    {
      kind: 'cylinder',
      name: 'industrial chimney visible dark central opening',
      position: [0, bodyTopY + 0.012, 0],
      axis: 'y',
      radius: openingRadius,
      height: 0.04,
      radialSegments: 40,
      material: { properties: { color: '#050505', roughness: 0.9, metalness: 0 } },
      semanticRole: 'chimney_opening',
      semanticGroup: 'chimney_cap',
      sourcePartKind: 'chimney_opening',
      sourcePartId: 'chimney_opening',
    },
  ]
}

function riverFallbackGeometryBrief(
  args: Record<string, unknown>,
  prompt: string,
): PrimitiveGeometryBrief {
  const constraints = nestedRecord(args, 'constraints')
  const dimensions = nestedRecord(args, 'dimensions')
  const directBrief = nestedRecord(args, 'geometryBrief')
  const expectedDimensions = isRecord(directBrief.expectedDimensions)
    ? directBrief.expectedDimensions
    : {}
  const promptDimensions = parseDimensionSemantics(prompt)
  const length =
    firstNumber(
      args.length,
      constraints.length,
      dimensions.length,
      expectedDimensions.length,
      promptDimensions.length,
    ) ?? 12
  const width =
    firstNumber(
      args.width,
      args.diameter,
      constraints.width,
      constraints.diameter,
      dimensions.width,
      dimensions.diameter,
      expectedDimensions.width,
      promptDimensions.width,
    ) ?? 1.8
  const height =
    firstNumber(
      args.depth,
      args.height,
      constraints.depth,
      constraints.height,
      dimensions.depth,
      dimensions.height,
      expectedDimensions.depth,
      expectedDimensions.height,
      promptDimensions.height,
    ) ?? 0.12

  return {
    category: 'natural_environment',
    units: 'm',
    coordinateConvention: '+X river length, +Y up, +Z width; y=0 is terrain',
    expectedDimensions: { length, width, height },
    requiredRoles: ['riverbed', 'water_surface', 'riverbanks', 'water_ripple'],
    validationTargets: ['curved river path', 'cyan water surface', 'visible ripple strokes'],
  }
}

function riverPrimitiveFallbackShapes(args: Record<string, unknown>, prompt: string): RawShape[] {
  const brief = riverFallbackGeometryBrief(args, prompt)
  const length = brief.expectedDimensions?.length ?? 12
  const width = brief.expectedDimensions?.width ?? 1.8
  const waterThickness = Math.max(
    0.02,
    Math.min(0.06, (brief.expectedDimensions?.height ?? 0.12) / 3),
  )
  const waterColor =
    typeof args.primaryColor === 'string'
      ? args.primaryColor
      : typeof args.color === 'string'
        ? args.color
        : '#00CED1'
  const segmentCount = 6
  const step = length / segmentCount
  const amplitude = Math.max(width * 0.42, length * 0.08)
  const curvePoints: Vec3[] = Array.from({ length: segmentCount + 1 }, (_, index) => {
    const x = -length / 2 + step * index
    const t = index / segmentCount
    const z = Math.sin(t * Math.PI * 2 - Math.PI / 5) * amplitude
    return [x, waterThickness / 2, z]
  })
  const segmentShapes = curvePoints.slice(0, -1).flatMap((start, index): RawShape[] => {
    const end = curvePoints[index + 1] ?? start
    const dx = end[0] - start[0]
    const dz = end[2] - start[2]
    const center: Vec3 = [(start[0] + end[0]) / 2, waterThickness / 2, (start[2] + end[2]) / 2]
    const segmentLength = Math.sqrt(dx * dx + dz * dz) * 1.06
    const yaw = Math.atan2(dz, dx)
    return [
      {
        kind: 'rounded-panel',
        name: `curved riverbed segment ${index + 1}`,
        semanticRole: 'riverbed',
        semanticGroup: 'river_channel',
        sourcePartKind: 'natural.riverbed',
        position: [center[0], 0.006, center[2]],
        rotation: [0, yaw, 0],
        length: segmentLength,
        width: width * 1.32,
        thickness: 0.012,
        cornerRadius: width * 0.22,
        material: { properties: { color: '#7A5A3A', roughness: 0.9, metalness: 0 } },
      },
      {
        kind: 'rounded-panel',
        name: `cyan river water segment ${index + 1}`,
        semanticRole: 'water_surface',
        semanticGroup: 'river_water',
        sourcePartKind: 'natural.river_water',
        position: center,
        rotation: [0, yaw, 0],
        length: segmentLength,
        width,
        thickness: waterThickness,
        cornerRadius: width * 0.2,
        material: {
          properties: {
            color: waterColor,
            roughness: 0.22,
            metalness: 0,
            opacity: 0.72,
            transparent: true,
          },
        },
      },
    ]
  })

  const bankOffset = width * 0.72
  const bankPath = (side: -1 | 1): Vec3[] =>
    curvePoints.map(([x, y, z]) => [x, y + 0.035, z + bankOffset * side])

  const rippleShapes: RawShape[] = [-0.27, 0.02, 0.31].map((offset, index) => ({
    kind: 'sweep',
    name: `bright curved water ripple ${index + 1}`,
    semanticRole: 'water_ripple',
    semanticGroup: 'river_water',
    sourcePartKind: 'natural.water_ripple',
    path: curvePoints
      .slice(1, -1)
      .map(
        ([x, y, z], pointIndex): Vec3 => [
          x,
          y + waterThickness * 0.8,
          z + offset * width + Math.sin(pointIndex * 1.7 + index) * width * 0.04,
        ],
      ),
    radius: 0.018,
    material: {
      properties: {
        color: '#E0FFFF',
        roughness: 0.18,
        metalness: 0,
        opacity: 0.75,
        transparent: true,
      },
    },
  }))

  return [
    ...segmentShapes,
    {
      kind: 'sweep',
      name: 'left raised grassy riverbank',
      semanticRole: 'riverbanks',
      semanticGroup: 'river_bank',
      sourcePartKind: 'natural.riverbank',
      path: bankPath(-1),
      radius: 0.075,
      material: { properties: { color: '#567D46', roughness: 0.82, metalness: 0 } },
    },
    {
      kind: 'sweep',
      name: 'right raised grassy riverbank',
      semanticRole: 'riverbanks',
      semanticGroup: 'river_bank',
      sourcePartKind: 'natural.riverbank',
      path: bankPath(1),
      radius: 0.075,
      material: { properties: { color: '#567D46', roughness: 0.82, metalness: 0 } },
    },
    ...rippleShapes,
  ]
}

function rawShapeValue(shape: RawShape, key: string): unknown {
  const record = shape as Record<string, unknown>
  const params = isRecord(record.params) ? record.params : {}
  return record[key] ?? params[key]
}

function rawShapeNumber(shape: RawShape, key: string): number | undefined {
  const value = rawShapeValue(shape, key)
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function rawShapeKind(shape: RawShape): string {
  return String(
    rawShapeValue(shape, 'kind') ??
      rawShapeValue(shape, 'shape') ??
      rawShapeValue(shape, 'type') ??
      '',
  )
    .trim()
    .toLowerCase()
}

function rawShapeNaturalText(shape: RawShape): string {
  return [
    rawShapeValue(shape, 'name'),
    rawShapeValue(shape, 'semanticRole'),
    rawShapeValue(shape, 'sourcePartKind'),
    rawShapeKind(shape),
  ]
    .map(textOf)
    .join(' ')
}

function hasRequiredRiverRoles(args: Record<string, unknown>, shapes: RawShape[]): boolean {
  const brief = nestedRecord(args, 'geometryBrief')
  const requiredRoles = Array.isArray(brief.requiredRoles)
    ? brief.requiredRoles.map((role) => String(role).toLowerCase())
    : []
  if (!requiredRoles.some((role) => role.includes('river'))) return true
  const presentRoles = new Set(
    shapes
      .map((shape) => String(rawShapeValue(shape, 'semanticRole') ?? '').toLowerCase())
      .filter(Boolean),
  )
  return ['riverbed', 'water_surface', 'riverbanks'].every((role) => presentRoles.has(role))
}

function hasInvalidRiverPrimitive(shape: RawShape): boolean {
  const kind = rawShapeKind(shape).replace(/_/g, '-')
  if (kind === 'lofted-shell' || kind === 'lofted-panel') return true
  if (kind === 'extrude') {
    const profile = rawShapeValue(shape, 'profile')
    const depth = rawShapeNumber(shape, 'depth')
    return !Array.isArray(profile) || profile.length < 3 || depth == null
  }
  if (kind === 'sweep') {
    const path = rawShapeValue(shape, 'path')
    const radius = rawShapeNumber(shape, 'radius')
    return !Array.isArray(path) || path.length < 2 || radius == null
  }
  return false
}

function shouldUseRiverPrimitiveFallback(
  args: Record<string, unknown>,
  prompt: string,
  shapes: RawShape[],
): boolean {
  if (!isRiverIntent(args, prompt)) return false
  return shapes.some(hasInvalidRiverPrimitive) || !hasRequiredRiverRoles(args, shapes)
}

function upgradeSimpleChimneyPrimitiveShapes(
  args: Record<string, unknown>,
  prompt: string,
  shapes: RawShape[],
): RawShape[] | undefined {
  if (!isChimneyIntent(args, prompt) || shapes.length !== 1) return undefined
  const [shape] = shapes
  if (!shape) return undefined
  const kind = rawShapeKind(shape)
  if (kind !== 'cylinder') return undefined
  if (/opening|hollow|rim|cap|torus|frustum/.test(rawShapeNaturalText(shape))) return undefined

  const height = rawShapeNumber(shape, 'height') ?? rawShapeNumber(shape, 'length')
  const radius = rawShapeNumber(shape, 'radius')
  const fallback = chimneyPartFallbackInput(
    {
      ...args,
      height: height ?? args.height,
      radius: radius ?? args.radius,
      primaryColor:
        args.primaryColor ??
        (isRecord(shape.material) && isRecord(shape.material.properties)
          ? shape.material.properties.color
          : undefined),
    },
    prompt,
  )
  args.__fallbackGeometryBrief = fallback.geometryBrief
  args.shapes = chimneyPrimitiveFallbackShapes(fallback)
  args.height = args.height ?? fallback.height
  args.radius = args.radius ?? fallback.radius
  return args.shapes as RawShape[]
}

function readExplicitPrimitiveShapes(args: Record<string, unknown>): RawShape[] | undefined {
  const params = isRecord(args.params) ? args.params : undefined
  const candidate =
    (Array.isArray(args.shapes) && args.shapes.length > 0 ? args.shapes : undefined) ??
    (Array.isArray(args.primitives) && args.primitives.length > 0 ? args.primitives : undefined) ??
    (Array.isArray(args.parts) && args.parts.length > 0 ? args.parts : undefined) ??
    (params && Array.isArray(params.shapes) && params.shapes.length > 0
      ? params.shapes
      : undefined) ??
    (params && Array.isArray(params.primitives) && params.primitives.length > 0
      ? params.primitives
      : undefined) ??
    (params && Array.isArray(params.parts) && params.parts.length > 0 ? params.parts : undefined)
  return candidate as RawShape[] | undefined
}

const PRIMITIVE_SHAPE_KINDS = new Set([
  'box',
  'cylinder',
  'hollow-cylinder',
  'cone',
  'frustum',
  'sphere',
  'hemisphere',
  'torus',
  'wedge',
  'trapezoid-prism',
  'lathe',
  'capsule',
  'half-cylinder',
  'rounded-panel',
  'conformal-strip',
  'extrude',
  'sweep',
])

function isPrimitiveShapeLike(value: unknown): value is RawShape {
  if (!isRecord(value)) return false
  const params = isRecord(value.params) ? value.params : {}
  const rawKind =
    value.kind ?? value.primitive ?? value.shape ?? value.type ?? params.kind ?? params.primitive
  return PRIMITIVE_SHAPE_KINDS.has(normalizePrimitiveKind(rawKind))
}

function readPrimitiveLikeShapes(args: Record<string, unknown>): RawShape[] | undefined {
  const candidate = readExplicitPrimitiveShapes(args)
  if (!candidate?.length) return undefined
  return candidate.every(isPrimitiveShapeLike) ? candidate : undefined
}

function recipeFallbackInput(args: Record<string, unknown>, prompt: string): ComposeRecipeInput {
  const candidateRecipe = args.recipeId ?? args.recipe ?? args.id ?? args.objectType ?? undefined
  const params = isRecord(args.params) ? args.params : {}
  const fallbackText = [prompt, args.geometryBrief, args.name, args.partName, args.category]
    .map(textOf)
    .join(' ')
  const rawDimensions = isRecord(args.dimensions)
    ? { ...args.dimensions, units: args.dimensions.units ?? args.units }
    : args.dimensions
  const dimensions = normalizeRecipeFallbackDimensions(rawDimensions, fallbackText)
  return {
    ...(candidateRecipe ? { recipeId: String(candidateRecipe) } : {}),
    name: fallbackText,
    geometryBrief: readGeometryBrief(args),
    params: {
      ...params,
      ...dimensions,
    },
  }
}

function openAssemblyFallbackInput(
  args: Record<string, unknown>,
  prompt: string,
): AssemblyComposeInput {
  const fallback = recipeFallbackInput(args, prompt)
  const params = isRecord(fallback.params) ? fallback.params : {}
  const family = inferOpenAssemblyFamily(args, prompt)
  return {
    ...(withoutExternalRecipeBrief(args) as AssemblyComposeInput),
    ...params,
    ...(family ? { family } : {}),
    name: fallback.name,
    prompt,
  }
}

const REGISTRY_OPEN_ASSEMBLY_FAMILIES = new Set([
  'vehicle',
  'fan',
  'pump',
  'conveyor',
  'machine_tool',
  'outdoor_ac',
  'tank',
  'distillation_tower',
  'reactor',
  'compressor',
  'grate_cooler',
  'electrical',
  'robot_arm',
])

function inferOpenAssemblyFamily(
  args: Record<string, unknown>,
  prompt: string,
): string | undefined {
  const profile = inferDeviceProfileDefinition({ ...args, prompt })
  if (profile && REGISTRY_OPEN_ASSEMBLY_FAMILIES.has(profile.family)) return profile.family
  const candidate = args.family ?? args.recipeId ?? args.recipe ?? args.id ?? args.objectType
  const family = inferFamilyDefinition({
    ...args,
    family: args.family,
    object: candidate,
    name: candidate,
    prompt,
  })?.id
  if (!family || !REGISTRY_OPEN_ASSEMBLY_FAMILIES.has(family)) return undefined
  if (family === 'vehicle' && isVehicleComponentIntent(args, prompt)) return undefined
  return family
}

function isOpenAssemblyRequest(args: Record<string, unknown>, prompt: string): boolean {
  return (
    isOpenAssemblyCapabilityRequest(args, prompt) || inferOpenAssemblyFamily(args, prompt) != null
  )
}

function numberFromRecord(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function dimensionUnitScale(unit: unknown): number {
  if (typeof unit !== 'string') return 1
  switch (unit.trim().toLowerCase()) {
    case 'mm':
    case '毫米':
    case 'millimeter':
    case 'millimeters':
      return 0.001
    case 'cm':
    case '厘米':
    case 'centimeter':
    case 'centimeters':
      return 0.01
    case 'm':
    case '米':
    case 'meter':
    case 'meters':
      return 1
    default:
      return 1
  }
}

function scaledDimension(value: number | undefined, scale: number): number | undefined {
  return value == null ? undefined : Number((value * scale).toFixed(4))
}

function normalizeRecipeFallbackDimensions(
  rawDimensions: unknown,
  fallbackText: string,
): Record<string, number> {
  const textDimensions = parseFallbackTextDimensions(fallbackText)
  const dimensions = isRecord(rawDimensions) ? rawDimensions : {}
  const scale = dimensionUnitScale(dimensions.units)
  const length =
    scaledDimension(numberFromRecord(dimensions, 'length'), scale) ?? textDimensions.length
  const width =
    scaledDimension(numberFromRecord(dimensions, 'width'), scale) ?? textDimensions.width
  const depth =
    scaledDimension(numberFromRecord(dimensions, 'depth'), scale) ?? textDimensions.depth
  const height =
    scaledDimension(numberFromRecord(dimensions, 'height'), scale) ?? textDimensions.height

  if (/(air.?condition|outdoor.?ac|condenser|空调|外机)/i.test(fallbackText)) {
    const thickness = scaledDimension(numberFromRecord(dimensions, 'thickness'), scale)
    return {
      ...((length ?? width) ? { length: length ?? width } : {}),
      ...((depth ?? thickness) ? { width: depth ?? thickness } : {}),
      ...(height ? { height } : {}),
    }
  }

  return {
    ...(length ? { length } : {}),
    ...(width ? { width } : {}),
    ...(depth ? { depth } : {}),
    ...(height ? { height } : {}),
  }
}

function parseFallbackTextDimensions(text: string): Record<string, number> {
  const dimensions: Record<string, number> = {}
  const patterns: Array<[string, RegExp]> = [
    ['length', /(?:length|long|长)\s*[:=：]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?/i],
    ['width', /(?:width|wide|宽)\s*[:=：]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?/i],
    ['depth', /(?:depth|deep|深)\s*[:=：]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?/i],
    ['height', /(?:height|tall|高)\s*[:=：]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?/i],
  ]

  for (const [key, pattern] of patterns) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    dimensions[key] = Number((Number(match[1]) * dimensionUnitScale(match[2])).toFixed(4))
  }

  return dimensions
}

function withoutExternalRecipeBrief(args: Record<string, unknown>): Record<string, unknown> {
  const { geometryBrief: _ignoredGeometryBrief, metadata, ...rest } = args
  if (!isRecord(metadata)) return rest
  const { geometryBrief: _ignoredMetadataBrief, ...metadataRest } = metadata
  return Object.keys(metadataRest).length > 0 ? { ...rest, metadata: metadataRest } : rest
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value.toLowerCase()
  if (Array.isArray(value)) return value.map(textOf).join(' ')
  if (typeof value === 'object' && value !== null) return Object.values(value).map(textOf).join(' ')
  return ''
}

function normalizedRecipeId(value: unknown): string {
  return typeof value === 'string'
    ? value
        .trim()
        .replace(/[\s_-]+/g, '.')
        .toLowerCase()
    : ''
}

function isMixerImpellerRecipe(args: Record<string, unknown>): boolean {
  const recipeId = normalizedRecipeId(args.recipeId ?? args.recipe ?? args.id)
  if (recipeId === 'mixer.impeller') return true
  return /mixer|agitator|impeller|mud|slurry|\u6ce5\u6d46|\u6405\u62cc|\u6868\u53f6|\u53f6\u8f6e/.test(
    textOf([args.name, args.partName, args.title]),
  )
}

function wantsHorizontalMixerBlades(prompt: string): boolean {
  const text = textOf(prompt)
  const chineseCues = [
    '\u540c\u4e00\u6c34\u5e73',
    '\u540c\u4e00\u9ad8\u5ea6',
    '\u540c\u4e00\u5e73\u9762',
    '\u6c34\u5e73\u6868\u53f6',
    '\u6c34\u5e73\u53f6\u7247',
    '\u4e0d\u8981\u503e\u659c',
    '\u4e0d\u503e\u659c',
    '\u65e0\u503e\u89d2',
  ]
  return (
    chineseCues.some((cue) => text.includes(cue)) ||
    /same\s+(horizontal\s+)?level|same\s+height|same\s+plane|horizontal\s+blades?|flat\s+blades?|no\s+pitch|zero\s+pitch/.test(
      text,
    )
  )
}

function applyPromptSemanticsToRecipeInput(
  args: Record<string, unknown>,
  prompt: string,
): Record<string, unknown> {
  const params = isRecord(args.params) ? args.params : {}
  let nextArgs = args
  let nextParams = params
  const promptSemantics = readPromptRecipeSemantics(args, prompt)

  for (const [key, value] of Object.entries(promptSemantics)) {
    if (key === 'primaryColor' && hasRecipeColorValue(args, params)) continue
    if (hasRecipeValue(args, params, key)) continue
    if (nextArgs === args) nextArgs = { ...args }
    if (nextParams === params) nextParams = { ...params }
    nextArgs[key] = value
    nextParams[key] = value
  }

  if (nextParams !== params) nextArgs.params = nextParams
  if (!isMixerImpellerRecipe(nextArgs) || !wantsHorizontalMixerBlades(prompt)) return nextArgs
  return {
    ...nextArgs,
    bladeTilt: 0,
    bladePitch: 0,
    params: {
      ...nextParams,
      bladeTilt: nextParams.bladeTilt ?? 0,
      bladePitch: nextParams.bladePitch ?? 0,
    },
  }
}

function hasRecipeValue(
  args: Record<string, unknown>,
  params: Record<string, unknown>,
  key: string,
): boolean {
  return args[key] != null || params[key] != null
}

function hasRecipeColorValue(
  args: Record<string, unknown>,
  params: Record<string, unknown>,
): boolean {
  return hasRecipeValue(args, params, 'primaryColor') || hasRecipeValue(args, params, 'color')
}

function readPromptRecipeSemantics(
  args: Record<string, unknown>,
  prompt: string,
): Record<string, string | number> {
  const semantics: Record<string, string | number> = {}
  const color = parsePromptColor(prompt)
  if (color) semantics.primaryColor = color

  const dimensions = parsePromptDimensions(prompt, isVehicleRecipeRequest(args, prompt))
  return { ...semantics, ...dimensions }
}

const PROMPT_COLOR_HEX: Array<[RegExp, string]> = [
  [/(绿色|綠色|green)/i, '#22c55e'],
  [/(红色|紅色|\bred\b)/i, '#ef4444'],
  [/(蓝色|藍色|blue)/i, '#2563eb'],
  [/(黄色|黃色|yellow)/i, '#facc15'],
  [/(黑色|black)/i, '#111827'],
  [/(白色|white)/i, '#f8fafc'],
  [/(灰色|grey|gray)/i, '#64748b'],
  [/(紫色|purple)/i, '#8b5cf6'],
  [/(橙色|orange)/i, '#f97316'],
  [/(粉色|pink)/i, '#ec4899'],
]

function parsePromptColor(prompt: string): string | undefined {
  return PROMPT_COLOR_HEX.find(([pattern]) => pattern.test(prompt))?.[1]
}

function isVehicleRecipeRequest(args: Record<string, unknown>, prompt: string): boolean {
  const recipeId = normalizedRecipeId(args.recipeId ?? args.recipe ?? args.id ?? args.objectType)
  return (
    recipeId.startsWith('vehicle.') ||
    /(?:car|sedan|suv|truck|vehicle|汽车|汽車|小汽车|小汽車|轿车|轎車)/i.test(prompt)
  )
}

function parsePromptDimensions(
  prompt: string,
  allowGenericLength: boolean,
): Record<string, number> {
  const dimensions: Record<string, number> = {}
  const dimensionPatterns: Array<[string, RegExp]> = [
    [
      'length',
      /(?:长度|長度|车长|車長|长|長|length|long)\s*(?:为|是|约|約|:|：)?\s*([0-9]+(?:\.[0-9]+)?|[一二两兩三四五六七八九十]+)\s*(mm|毫米|cm|厘米|m|米)/i,
    ],
    [
      'width',
      /(?:宽度|寬度|宽|寬|width|wide)\s*(?:为|是|约|約|:|：)?\s*([0-9]+(?:\.[0-9]+)?|[一二两兩三四五六七八九十]+)\s*(mm|毫米|cm|厘米|m|米)/i,
    ],
    [
      'height',
      /(?:高度|高|height|tall)\s*(?:为|是|约|約|:|：)?\s*([0-9]+(?:\.[0-9]+)?|[一二两兩三四五六七八九十]+)\s*(mm|毫米|cm|厘米|m|米)/i,
    ],
    [
      'depth',
      /(?:深度|深|depth|deep)\s*(?:为|是|约|約|:|：)?\s*([0-9]+(?:\.[0-9]+)?|[一二两兩三四五六七八九十]+)\s*(mm|毫米|cm|厘米|m|米)/i,
    ],
  ]

  for (const [key, pattern] of dimensionPatterns) {
    const dimension = parsePromptDimensionMatch(prompt.match(pattern))
    if (dimension != null) dimensions[key] = dimension
  }

  if (allowGenericLength && dimensions.length == null) {
    const dimension = parsePromptDimensionMatch(
      prompt.match(/([0-9]+(?:\.[0-9]+)?|[一二两兩三四五六七八九十]+)\s*(mm|毫米|cm|厘米|m|米)/i),
    )
    if (dimension != null) dimensions.length = dimension
  }

  return dimensions
}

function parsePromptDimensionMatch(match: RegExpMatchArray | null): number | undefined {
  if (!match?.[1]) return undefined
  const value = parsePromptNumber(match[1])
  if (value == null) return undefined
  return Number((value * dimensionUnitScale(match[2])).toFixed(4))
}

function parsePromptNumber(value: string): number | undefined {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric
  const normalized = value.replaceAll('兩', '两')
  const digitMap: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  if (normalized === '十') return 10
  if (normalized.includes('十')) {
    const [tensRaw, onesRaw] = normalized.split('十')
    const tens = tensRaw ? digitMap[tensRaw] : 1
    const ones = onesRaw ? digitMap[onesRaw] : 0
    return tens != null && ones != null ? tens * 10 + ones : undefined
  }
  return digitMap[normalized]
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : undefined
}

function normalizeRequiredRoleToken(role: string) {
  return role
    .trim()
    .toLowerCase()
    .replace(/[:=]\s*\d+$/, '')
    .replace(/[\s-]+/g, '_')
}

function normalizeGeometryBrief(value: unknown): PrimitiveGeometryBrief | undefined {
  if (!isRecord(value)) return undefined
  const requiredRoles = stringArray(value.requiredRoles)?.map(normalizeRequiredRoleToken)
  const semanticRoles = stringArray(value.semanticRoles)?.map(normalizeRequiredRoleToken)
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

function readExecutionGeometryBrief(
  name: string,
  args: Record<string, unknown>,
  context?: GeometryToolExecutionContext,
): PrimitiveGeometryBrief | undefined {
  const prompt = context?.prompt ?? ''
  const hasExplicitShapes = Array.isArray(args.shapes) && args.shapes.length > 0
  const hasExplicitParts = Array.isArray(args.parts) && args.parts.length > 0
  const fallbackBrief = normalizeGeometryBrief(args.__fallbackGeometryBrief)
  if (fallbackBrief) return mergeBlueprintGeometryBrief(fallbackBrief, context)

  const registryBrief = registryPartGeometryBrief(args)
  if (registryBrief) return registryBrief

  if (
    name === 'compose_assembly' ||
    (name === 'compose_recipe' && isOpenAssemblyRequest(args, prompt)) ||
    (name === 'compose_parts' && !hasExplicitParts && isOpenAssemblyRequest(args, prompt)) ||
    (name === 'compose_primitive' && !hasExplicitShapes && isOpenAssemblyRequest(args, prompt))
  ) {
    // compose_assembly has its own authoritative requiredRoles from assemblyRequiredRoles().
    // Do not merge blueprint roles here — they are LLM-generated approximations that conflict
    // with the precise sourcePartKind names that assembly validation actually checks.
    return getAssemblyGeometryBrief({ ...(args as AssemblyComposeInput), prompt: context?.prompt })
  }

  if (name === 'compose_recipe') {
    const recipeArgs = applyPromptSemanticsToRecipeInput(
      withoutExternalRecipeBrief(args),
      context?.prompt ?? '',
    )
    return mergeBlueprintGeometryBrief(
      getPrimitiveRecipeGeometryBrief(recipeArgs as ComposeRecipeInput) ?? readGeometryBrief(args),
      context,
    )
  }

  const intent = readGeometryIntentArgument(args)
  if (intent?.action === 'create') {
    return readGeometryBrief(args)
  }

  return mergeBlueprintGeometryBrief(
    readGeometryBrief(args) ??
      (name === 'revise_geometry' ? context?.revisionTarget?.geometryBrief : undefined),
    context,
  )
}

function registryPartGeometryBrief(
  args: Record<string, unknown>,
): PrimitiveGeometryBrief | undefined {
  if (args.__registryPartPlan !== true) return undefined
  const family =
    typeof args.family === 'string' && args.family.trim() ? args.family.trim() : undefined
  const parts = Array.isArray(args.parts) ? args.parts.filter(isRecord) : []
  if (!family || parts.length === 0) return undefined

  const requiredRoles = Array.from(
    new Set(
      parts
        .map((part) =>
          normalizeRequiredRoleToken(String(part.semanticRole ?? part.kind ?? '').trim()),
        )
        .filter((role) => role.length > 0),
    ),
  )
  return {
    ...normalizeGeometryBrief(args.geometryBrief),
    category: family,
    requiredRoles,
  }
}

function mergeBlueprintGeometryBrief(
  brief: PrimitiveGeometryBrief | undefined,
  context?: GeometryToolExecutionContext,
): PrimitiveGeometryBrief | undefined {
  const blueprintRoles = context?.blueprintRequiredRoles
    ?.filter((role) => typeof role === 'string' && role.trim().length > 0)
    .map(normalizeRequiredRoleToken)
  const blueprintCategory =
    typeof context?.blueprintCategory === 'string' && context.blueprintCategory.trim().length > 0
      ? context.blueprintCategory
      : undefined
  if (!blueprintRoles?.length && !blueprintCategory) return brief

  const requiredRoles = Array.from(
    new Set([...(brief?.requiredRoles ?? []), ...(blueprintRoles ?? [])]),
  )
  return {
    ...(brief ?? {}),
    category: brief?.category ?? blueprintCategory,
    requiredRoles,
  }
}

function publicSourceArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([key]) => !key.startsWith('__')))
}

function userConstraintArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name === 'revise_geometry') return {}
  const {
    shapes: _shapes,
    parts: _parts,
    operations: _operations,
    geometryBrief: _geometryBrief,
    metadata: _metadata,
    ...rest
  } = args
  return rest
}

function formatSemanticValidationSummary(validation: SemanticValidationSummary): string {
  if (
    validation.family === 'unknown' &&
    validation.issues.length === 0 &&
    validation.warnings.length === 0
  ) {
    return ''
  }

  const roleSummary = Object.entries(validation.facts.roles)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([role, count]) => `${role}:${count}`)
    .join(', ')

  const parts = [`Validation: family=${validation.family}, score=${validation.score.toFixed(2)}`]
  if (roleSummary) parts.push(`roles=[${roleSummary}]`)
  if (validation.warnings.length > 0) {
    parts.push(`warnings=[${validation.warnings.join('; ')}]`)
  }
  return parts.join(' ')
}

function formatVisualQualitySummary(quality: VisualQualitySummary): string {
  if (
    quality.family === 'unknown' &&
    quality.issues.length === 0 &&
    quality.warnings.length === 0
  ) {
    return ''
  }

  const parts = [`Visual quality: family=${quality.family}, score=${quality.score.toFixed(2)}`]
  if (quality.warnings.length > 0) {
    parts.push(`warnings=[${quality.warnings.join('; ')}]`)
  }
  return parts.join(' ')
}

function formatProfileQualitySummary(quality: DeviceProfileQualityScore | undefined): string {
  if (!quality) return ''
  const parts = [
    `Profile quality: overall=${quality.overallScore.toFixed(2)}`,
    `semantic=${quality.semanticScore.toFixed(2)}`,
    `geometry=${quality.geometryScore.toFixed(2)}`,
    `editability=${quality.editabilityScore.toFixed(2)}`,
    `visual=${quality.visualCompletenessScore.toFixed(2)}`,
  ]
  if (quality.warnings.length > 0) parts.push(`warnings=[${quality.warnings.join('; ')}]`)
  return parts.join(' ')
}

function normalizeVec3Object(value: unknown): Vec3 | undefined {
  if (Array.isArray(value) && value.length >= 3) {
    const [x, y, z] = value
    if (
      typeof x === 'number' &&
      Number.isFinite(x) &&
      typeof y === 'number' &&
      Number.isFinite(y) &&
      typeof z === 'number' &&
      Number.isFinite(z)
    ) {
      return [x, y, z]
    }
  }
  if (isRecord(value)) {
    const { x, y, z } = value
    if (
      typeof x === 'number' &&
      Number.isFinite(x) &&
      typeof y === 'number' &&
      Number.isFinite(y) &&
      typeof z === 'number' &&
      Number.isFinite(z)
    ) {
      return [x, y, z]
    }
  }
  return undefined
}

function normalizePoint2Array(value: unknown): [number, number][] | undefined {
  if (!Array.isArray(value)) return undefined
  const points = value
    .filter(
      (point): point is [number, number] =>
        Array.isArray(point) &&
        point.length >= 2 &&
        typeof point[0] === 'number' &&
        Number.isFinite(point[0]) &&
        typeof point[1] === 'number' &&
        Number.isFinite(point[1]),
    )
    .map(([x, y]) => [x, y] as [number, number])
  return points.length > 0 ? points : undefined
}

function normalizePoint2Holes(value: unknown): [number, number][][] | undefined {
  if (!Array.isArray(value)) return undefined
  const holes = value
    .map((hole) => normalizePoint2Array(hole))
    .filter((hole): hole is [number, number][] => Array.isArray(hole) && hole.length > 0)
  return holes.length > 0 ? holes : undefined
}

function normalizeVec3Array(value: unknown): Vec3[] | undefined {
  if (!Array.isArray(value)) return undefined
  const points = value
    .map(normalizeVec3Object)
    .filter((point): point is Vec3 => Array.isArray(point))
  return points.length > 0 ? points : undefined
}

function defaultGroundedPosition(
  kind: string,
  values: {
    height?: unknown
    radius?: unknown
    radiusTop?: unknown
    radiusBottom?: unknown
    majorRadius?: unknown
    tubeRadius?: unknown
    thickness?: unknown
    axis?: unknown
  },
): Vec3 {
  const positive = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
  const axis = values.axis === 'x' || values.axis === 'z' ? values.axis : 'y'
  const radius = positive(values.radius, 0.5)
  const height = positive(values.height, 1)

  switch (kind) {
    case 'box':
    case 'wedge':
    case 'trapezoid-prism':
    case 'pyramid':
      return [0, height / 2, 0]
    case 'rounded-panel':
    case 'ellipse-panel':
    case 'semi-ellipse-panel':
      return [0, positive(values.thickness ?? values.height, 0.04) / 2, 0]
    case 'conformal-strip':
      return [0, 0, 0]
    case 'cylinder':
    case 'hollow-cylinder':
    case 'cone':
    case 'capsule':
    case 'half-cylinder':
      return [0, axis === 'y' ? height / 2 : radius, 0]
    case 'frustum':
      return [
        0,
        axis === 'y'
          ? height / 2
          : Math.max(positive(values.radiusTop, 0.25), positive(values.radiusBottom, 0.5)),
        0,
      ]
    case 'sphere':
    case 'ellipsoid':
    case 'hemisphere':
      return [0, radius, 0]
    case 'torus':
      return [
        0,
        positive(values.majorRadius ?? values.radius, 0.5) + positive(values.tubeRadius, 0.08),
        0,
      ]
    default:
      return [0, 0, 0]
  }
}

export function normalizeGeometryToolShapes(
  rawShapes: RawShape[],
  options: { prompt?: string } = {},
): ShapeSpec[] {
  const expandedShapes = expandPrimitiveShapeArrays(
    rawShapes as PrimitiveArrayExpandableShape[],
  ) as RawShape[]
  return expandedShapes.map((shape) => {
    const shapeRecord = shape as Record<string, unknown>
    const params = isRecord(shapeRecord.params) ? shapeRecord.params : {}
    const read = (key: string) => shapeRecord[key] ?? params[key]
    const size = Array.isArray(read('size')) ? (read('size') as number[]) : undefined
    const color = Array.isArray(read('color')) ? (read('color') as number[]) : undefined
    const kind = normalizePrimitiveKind(
      read('kind') ?? read('primitive') ?? read('shape') ?? read('type'),
    )
    const materialPreset = read('materialPreset')
    const normalizedMaterial = normalizePrimitiveMaterial(
      read('material'),
      read('materialColor'),
      color,
    )
    const material = shouldApplyGlassMaterial(
      shape,
      kind,
      normalizedMaterial,
      materialPreset,
      options.prompt,
      expandedShapes.length,
    )
      ? withGlassMaterial(normalizedMaterial)
      : normalizedMaterial
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
    const radius = read('radius') as number | undefined
    const radiusTop = read('radiusTop') as number | undefined
    const radiusBottom = read('radiusBottom') as number | undefined
    const majorRadius = read('majorRadius') as number | undefined
    const tubeRadius = read('tubeRadius') as number | undefined
    const axis = read('axis') as string | undefined
    const position =
      normalizeVec3Object(read('position')) ??
      defaultGroundedPosition(kind, {
        height: normalizedHeight,
        radius,
        radiusTop,
        radiusBottom,
        majorRadius,
        tubeRadius,
        thickness: normalizedThickness,
        axis,
      })
    const normalizedShape: ShapeSpec = {
      kind,
      position,
      rotation: normalizeVec3Object(read('rotation')) ?? [0, 0, 0],
      scale: normalizeVec3Object(read('scale')) ?? [1, 1, 1],
      name: read('name') as string | undefined,
      semanticRole: read('semanticRole') as string | undefined,
      semanticGroup: read('semanticGroup') as string | undefined,
      sourcePartKind: read('sourcePartKind') as string | undefined,
      sourcePartId: read('sourcePartId') as string | undefined,
      editableHints: isRecord(read('editableHints'))
        ? (read('editableHints') as ShapeSpec['editableHints'])
        : undefined,
      length: normalizedLength as number | undefined,
      width: normalizedWidth as number | undefined,
      height: normalizedHeight as number | undefined,
      depth: normalizedDepth as number | undefined,
      thickness: normalizedThickness as number | undefined,
      cornerRadius: read('cornerRadius') as number | undefined,
      cornerSegments: read('cornerSegments') as number | undefined,
      radius,
      radiusTop,
      radiusBottom,
      majorRadius,
      tubeRadius,
      topScale: read('topScale') as [number, number] | undefined,
      topLengthScale: read('topLengthScale') as number | undefined,
      topWidthScale: read('topWidthScale') as number | undefined,
      slopeAxis: read('slopeAxis') as string | undefined,
      slopeDirection: read('slopeDirection') as string | undefined,
      axis,
      capSegments: read('capSegments') as number | undefined,
      radialSegments: read('radialSegments') as number | undefined,
      tubularSegments: read('tubularSegments') as number | undefined,
      widthSegments: read('widthSegments') as number | undefined,
      heightSegments: read('heightSegments') as number | undefined,
      wallThickness: read('wallThickness') as number | undefined,
      surface: read('surface') as string | undefined,
      side: read('side') as string | undefined,
      xStart: read('xStart') as number | undefined,
      xEnd: read('xEnd') as number | undefined,
      verticalOffset: read('verticalOffset') as number | undefined,
      surfaceRadiusY: read('surfaceRadiusY') as number | undefined,
      surfaceRadiusZ: read('surfaceRadiusZ') as number | undefined,
      surfaceLength: read('surfaceLength') as number | undefined,
      endTaper: read('endTaper') as number | undefined,
      profile: normalizePoint2Array(read('profile')),
      holes: normalizePoint2Holes(read('holes')),
      path: normalizeVec3Array(read('path')),
      segments: read('segments') as number | undefined,
      arc: read('arc') as number | undefined,
      bevelSize: read('bevelSize') as number | undefined,
      bevelThickness: read('bevelThickness') as number | undefined,
      bevelSegments: read('bevelSegments') as number | undefined,
      curveSegments: read('curveSegments') as number | undefined,
      closed: read('closed') as boolean | undefined,
      material,
      materialPreset: materialPreset as string | undefined,
      attachTo: read('attachTo') as number | string | undefined,
      anchor: read('anchor') as string | undefined,
      childAnchor: read('childAnchor') as string | undefined,
    }
    return lowerDerivedPrimitiveShape(normalizedShape as PrimitiveShapeInput) as ShapeSpec
  })
}

export function validateGeometryToolShapes(shapes: ShapeSpec[]): string[] {
  const isPositiveNumber = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0

  return shapes.flatMap((shape, index) => {
    const label = shape.name ?? `${shape.kind} #${index + 1}`
    const issues: string[] = []
    const numericAttachTo = typeof shape.attachTo === 'number' ? shape.attachTo : undefined
    if (shape.attachTo != null && numericAttachTo == null && shape.kind !== 'conformal-strip') {
      issues.push(
        `${label}: attachTo must reference an earlier shape in the SAME compose_primitive call; got ${shape.attachTo}.`,
      )
    }
    if (
      numericAttachTo != null &&
      (!Number.isInteger(numericAttachTo) || numericAttachTo < 0 || numericAttachTo >= index)
    ) {
      issues.push(
        `${label}: attachTo must reference an earlier shape in the SAME compose_primitive call; got ${shape.attachTo}.`,
      )
    }
    if (
      numericAttachTo != null &&
      (!isPrimitiveAnchor(shape.anchor) || !isPrimitiveAnchor(shape.childAnchor))
    ) {
      issues.push(
        `${label}: attachTo requires explicit anchor and childAnchor. Examples: under desktop uses anchor="bottom", childAnchor="top"; front handle uses anchor="front", childAnchor="back".`,
      )
    }
    if (
      numericAttachTo != null &&
      isPrimitiveAnchor(shape.anchor) &&
      isPrimitiveAnchor(shape.childAnchor)
    ) {
      const parent = shapes[numericAttachTo]
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
      case 'conformal-strip':
        if (!isPositiveNumber(shape.width))
          issues.push(`${label}: conformal-strip.width is required (vertical strip width).`)
        if (!isPositiveNumber(shape.thickness))
          issues.push(`${label}: conformal-strip.thickness is required.`)
        if (!isPositiveNumber(shape.surfaceRadiusY))
          issues.push(`${label}: conformal-strip.surfaceRadiusY is required.`)
        if (!isPositiveNumber(shape.surfaceRadiusZ))
          issues.push(`${label}: conformal-strip.surfaceRadiusZ is required.`)
        if (
          !(
            typeof shape.xStart === 'number' &&
            typeof shape.xEnd === 'number' &&
            shape.xStart !== shape.xEnd
          )
        )
          issues.push(`${label}: conformal-strip.xStart and xEnd must define a nonzero X span.`)
        if (shape.side !== 'left' && shape.side !== 'right')
          issues.push(`${label}: conformal-strip.side must be "left" or "right".`)
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
        if (Array.isArray(shape.holes)) {
          for (const [holeIndex, hole] of shape.holes.entries()) {
            if (!Array.isArray(hole) || hole.length < 3) {
              issues.push(`${label}: extrude.holes[${holeIndex}] needs at least 3 outline points.`)
            }
          }
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

function compactRoleKey(value: unknown): string {
  return typeof value === 'string'
    ? value
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
    : ''
}

function rawShapeText(shape: RawShape): string {
  return [
    shape.name,
    shape.semanticRole,
    shape.sourcePartKind,
    shape.semanticGroup,
    shape.kind,
    shape.shape,
    shape.type,
  ]
    .map(compactRoleKey)
    .filter(Boolean)
    .join(' ')
}

function explicitRequiredRoleSet(args: Record<string, unknown>): Set<string> {
  const roles = new Set<string>()
  const brief = isRecord(args.geometryBrief) ? args.geometryBrief : undefined
  for (const value of [
    ...(Array.isArray(brief?.requiredRoles) ? brief.requiredRoles : []),
    ...(Array.isArray(brief?.semanticRoles) ? brief.semanticRoles : []),
  ]) {
    const role = compactRoleKey(value).replace(/[:=]\d+$/, '')
    if (role) roles.add(role)
  }
  const primary = compactRoleKey(args.primarySemanticRole)
  if (primary) roles.add(primary)
  return roles
}

function shapeBudgetPriority(shape: RawShape, args: Record<string, unknown>): number {
  const text = rawShapeText(shape)
  const requiredRoles = explicitRequiredRoleSet(args)
  let priority = 50

  if ([...requiredRoles].some((role) => role && text.includes(role))) priority += 80
  if (
    /main|body|housing|shell|casing|bed|frame|base|skid|grate|filter|plate_stack|volute|turbine|hopper/.test(
      text,
    )
  ) {
    priority += 45
  }
  if (/inlet|outlet|duct|port|nozzle|chute|motor|gearbox|bearing|shaft|control/.test(text)) {
    priority += 35
  }
  if (/support|leg|foot|platform|ladder|access|door|panel|guard/.test(text)) priority += 18
  if (/bolt|rivet|screw|washer|nameplate|label|warning|seam|stripe|fin|rib|slat/.test(text)) {
    priority -= 45
  }
  if (/detail|accent|decorative/.test(text)) priority -= 35
  if (typeof shape.attachTo === 'number' || typeof shape.attachTo === 'string') priority += 6

  return priority
}

function compactRawShapesToBudget(
  rawShapes: RawShape[],
  maxShapes: number,
  args: Record<string, unknown>,
): RawShape[] {
  if (rawShapes.length <= maxShapes) return rawShapes
  const keep = new Set<number>()
  const ranked = rawShapes
    .map((shape, index) => ({ index, priority: shapeBudgetPriority(shape, args) }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index)

  for (const item of ranked.slice(0, maxShapes)) keep.add(item.index)
  for (let index = 0; index < rawShapes.length; index += 1) {
    const attachTo = rawShapes[index]?.attachTo
    if (typeof attachTo === 'number' && keep.has(index)) keep.add(attachTo)
  }

  if (keep.size > maxShapes) {
    const required = [...keep]
      .map((index) => ({ index, priority: shapeBudgetPriority(rawShapes[index]!, args) }))
      .sort((left, right) => right.priority - left.priority || left.index - right.index)
      .slice(0, maxShapes)
    keep.clear()
    for (const item of required) keep.add(item.index)
  }

  const oldToNew = new Map<number, number>()
  const compacted = rawShapes.flatMap((shape, oldIndex) => {
    if (!keep.has(oldIndex)) return []
    oldToNew.set(oldIndex, oldToNew.size)
    return [{ shape: { ...shape }, oldIndex }]
  })

  return compacted.map(({ shape, oldIndex }) => {
    if (typeof shape.attachTo !== 'number') return shape
    const nextAttachTo = oldToNew.get(shape.attachTo)
    const newIndex = oldToNew.get(oldIndex) ?? 0
    if (nextAttachTo == null || nextAttachTo >= newIndex) {
      const next = { ...shape }
      delete next.attachTo
      delete next.anchor
      delete next.childAnchor
      return next
    }
    return { ...shape, attachTo: nextAttachTo }
  })
}

function shouldAutoCompactShapeBudget(name: string, args: Record<string, unknown>): boolean {
  return (
    name === 'compose_parts' &&
    (args.__registryPartPlan === true ||
      typeof args.deviceProfile === 'string' ||
      isRecord(args.deviceProfileDraft) ||
      isRecord(args.__deviceProfileDefinition))
  )
}

function shouldEnforceHardAssemblyConstraints(args: Record<string, unknown>): boolean {
  return !(typeof args.deviceProfile === 'string' || isRecord(args.deviceProfileDraft))
}

function profileShapeLimit(args: Record<string, unknown>): number | undefined {
  const candidates: number[] = []
  const detailBudget = args.detailBudget
  if (isRecord(detailBudget)) {
    const maxShapes = detailBudget.maxShapes
    if (typeof maxShapes === 'number' && Number.isFinite(maxShapes) && maxShapes > 0) {
      candidates.push(Math.floor(maxShapes))
    }
  }

  const rules = args.qualityRules
  if (isRecord(rules)) {
    const shapeCount = rules.shapeCount
    if (isRecord(shapeCount)) {
      const max = shapeCount.max
      if (typeof max === 'number' && Number.isFinite(max) && max > MAX_GENERATED_GEOMETRY_SHAPES) {
        candidates.push(Math.floor(max))
      }
    }
  }

  if (candidates.length === 0) return undefined
  return Math.max(1, Math.min(...candidates))
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

  applyDeterministicGeometryIntentPlan(name, args, context)
  attachExplicitDeviceProfileDraft(args, context.prompt)
  const intentPlanningIssues = Array.isArray(args.__intentPlanningIssues)
    ? (args.__intentPlanningIssues as string[])
    : []
  if (intentPlanningIssues.length > 0) {
    return {
      content: [
        'Geometry intent could not be planned deterministically. Nothing was created.',
        ...intentPlanningIssues.map((issue) => `- ${issue}`),
      ].join('\n'),
    }
  }

  if (name === 'revise_geometry') {
    const target = context.revisionTarget
    const targetArtifactId =
      typeof args.targetArtifactId === 'string' ? args.targetArtifactId : undefined
    if (!target) {
      return {
        content: [
          'Revision could not run. No previous geometry artifact is available.',
          'Tell the user what happened and generate a fresh object or ask them to select/create one first.',
        ].join('\n'),
      }
    }
    if (targetArtifactId && targetArtifactId !== target.id) {
      return {
        content: [
          'Revision could not run. The requested targetArtifactId does not match the current artifact.',
          `- requested: ${targetArtifactId}`,
          `- current: ${target.id}`,
          'Use the current artifact id or generate a fresh replacement.',
        ].join('\n'),
      }
    }
  }

  let rawShapes = expandPrimitiveShapeArrays(
    (getRawShapes(name, args, context.prompt, context) ?? []) as PrimitiveArrayExpandableShape[],
  ) as RawShape[]
  const revisionIssues = Array.isArray(args.__revisionIssues)
    ? (args.__revisionIssues as string[])
    : []
  if (revisionIssues.length > 0) {
    return {
      content: [
        'Revision could not be applied. Nothing was created.',
        'Explain this to the user and call revise_geometry again with corrected selectors/operations.',
        ...revisionIssues.map((issue) => `- ${issue}`),
      ].join('\n'),
    }
  }
  if (!rawShapes.length) {
    return { content: options.messages?.noShapes ?? 'No geometry could be created.' }
  }

  const maxShapes = options.maxShapes ?? profileShapeLimit(args) ?? MAX_GENERATED_GEOMETRY_SHAPES
  if (rawShapes.length > maxShapes) {
    const aircraftFallbackShapes = compactAircraftFallbackShapes(args, context.prompt, context)
    if (aircraftFallbackShapes && aircraftFallbackShapes.length <= maxShapes) {
      rawShapes = expandPrimitiveShapeArrays(
        aircraftFallbackShapes as PrimitiveArrayExpandableShape[],
      ) as RawShape[]
    }
  }
  if (rawShapes.length > maxShapes && shouldAutoCompactShapeBudget(name, args)) {
    const beforeShapeCount = rawShapes.length
    const compactedShapes = compactRawShapesToBudget(rawShapes, maxShapes, args)
    if (compactedShapes.length <= maxShapes) {
      rawShapes = compactedShapes
      args.detailBudgetApplied = true
      args.detailBudgetCompaction = {
        beforeShapeCount,
        afterShapeCount: compactedShapes.length,
        maxShapes,
      }
    }
  }
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

  let shapes = normalizeGeometryToolShapes(rawShapes, { prompt: context.prompt })
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

  let transforms = resolvePrimitiveWorldTransforms(shapes as PrimitiveShapeInput[], {
    positionMode: 'world-center',
  })
  let geometryBrief = readExecutionGeometryBrief(name, args, context)
  let semanticValidation = validatePrimitiveSemantics(shapes as PrimitiveShapeInput[], transforms, {
    toolName: name,
    prompt: context.prompt,
    sourceArgs: args,
    geometryBrief,
  })
  const profileDefinition = isRecord(args.__deviceProfileDefinition)
    ? (args.__deviceProfileDefinition as unknown as DeviceProfileDefinition)
    : undefined

  if (!semanticValidation.ok && profileDefinition) {
    const profileSemanticQuality = evaluateDeviceProfileQuality(profileDefinition, shapes, {
      maxShapes,
    })
    if (profileSemanticQuality.issues.length === 0 && profileSemanticQuality.overallScore >= 0.65) {
      semanticValidation = {
        ...semanticValidation,
        ok: true,
        warnings: [
          ...semanticValidation.warnings,
          ...semanticValidation.issues.map(
            (issue) => `Profile quality accepted despite generic semantic issue: ${issue}`,
          ),
        ],
        issues: [],
      }
    }
  }

  if (!semanticValidation.ok && isAircraftIntent(args, context.prompt, context)) {
    const aircraftFallbackShapes = compactAircraftFallbackShapes(args, context.prompt, context)
    if (aircraftFallbackShapes && aircraftFallbackShapes.length <= maxShapes) {
      const fallbackShapes = normalizeGeometryToolShapes(aircraftFallbackShapes)
      const fallbackValidationIssues = validateGeometryToolShapes(fallbackShapes)
      if (fallbackValidationIssues.length === 0) {
        const fallbackTransforms = resolvePrimitiveWorldTransforms(
          fallbackShapes as PrimitiveShapeInput[],
          { positionMode: 'world-center' },
        )
        const fallbackGeometryBrief = readExecutionGeometryBrief(name, args, context)
        const fallbackSemanticValidation = validatePrimitiveSemantics(
          fallbackShapes as PrimitiveShapeInput[],
          fallbackTransforms,
          {
            toolName: name,
            prompt: context.prompt,
            sourceArgs: args,
            geometryBrief: fallbackGeometryBrief,
          },
        )
        if (fallbackSemanticValidation.ok) {
          rawShapes = aircraftFallbackShapes
          shapes = fallbackShapes
          transforms = fallbackTransforms
          geometryBrief = fallbackGeometryBrief
          semanticValidation = fallbackSemanticValidation
        }
      }
    }
  }

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
  const visualQuality = assessPrimitiveVisualQuality(shapes as PrimitiveShapeInput[], transforms, {
    prompt: context.prompt,
    geometryBrief,
  })
  const profileQuality = profileDefinition
    ? evaluateDeviceProfileQuality(profileDefinition, shapes, {
        visualScore: visualQuality.score,
        maxShapes,
      })
    : undefined
  if (profileQuality && profileQuality.overallScore < 0.45) {
    return {
      content: [
        'Invalid geometry tool call. Nothing was created.',
        'Fix the arguments and call exactly one geometry tool again.',
        `- profile quality score is too low (${profileQuality.overallScore.toFixed(2)}).`,
        ...profileQuality.issues.map((issue) => `- ${issue}`),
        ...profileQuality.warnings.map((warning) => `- Warning: ${warning}`),
      ].join('\n'),
    }
  }
  if (
    (visualQuality.family === 'vehicle' ||
      visualQuality.family === 'robot_arm' ||
      visualQuality.family === 'fan' ||
      visualQuality.family === 'industrial_equipment') &&
    visualQuality.score < 0.65
  ) {
    return {
      content: [
        'Invalid geometry tool call. Nothing was created.',
        'Fix the arguments and call exactly one geometry tool again.',
        `- ${visualQuality.family} visual quality score is too low (${visualQuality.score.toFixed(2)}).`,
        ...visualQuality.issues.map((issue) => `- ${issue}`),
        ...visualQuality.warnings.map((warning) => `- Warning: ${warning}`),
        ...visualQuality.recommendations.map(
          (recommendation) => `- Recommendation: ${recommendation}`,
        ),
      ].join('\n'),
    }
  }
  if (name !== 'revise_geometry' && shouldEnforceHardAssemblyConstraints(args)) {
    const hardConstraints = extractUserGeometryConstraints(
      context.prompt,
      userConstraintArgs(name, args),
    )
    const colorAlignment = alignPrimaryShapeColorsToConstraints(
      shapes as PrimitiveShapeInput[],
      hardConstraints,
    )
    if (colorAlignment.changedCount > 0) {
      shapes = colorAlignment.shapes as ShapeSpec[]
      args.constraintWarnings = [
        ...(Array.isArray(args.constraintWarnings) ? args.constraintWarnings : []),
        ...colorAlignment.warnings,
      ]
    }
    const constraintValidation = validateAssemblyConstraints(
      shapes as PrimitiveShapeInput[],
      hardConstraints,
    )
    if (!constraintValidation.ok) {
      return {
        content: [
          'Invalid geometry tool call. Nothing was created.',
          'Hard user constraints were not preserved. Fix the arguments and call exactly one geometry tool again.',
          ...constraintValidation.issues.map((issue) => `- ${issue}`),
          ...constraintValidation.warnings.map((warning) => `- Warning: ${warning}`),
          ...colorAlignment.warnings.map((warning) => `- Warning: ${warning}`),
        ].join('\n'),
      }
    }
  }

  const shouldCreateAssembly = shapes.length > 1
  const assemblyPosition = computeGeneratedAssemblyPosition(transforms)
  const assemblyName = shouldCreateAssembly ? inferGeneratedAssemblyName(name, args, shapes) : null
  const created = shapes.map((shape) => shape.name ?? shape.kind)
  const shapeDetails = formatGeneratedShapeDetails(shapes, transforms)
  const title = assemblyName ?? created[0] ?? 'Generated geometry'
  const semanticSummary = formatSemanticValidationSummary(semanticValidation)
  const visualQualitySummary = formatVisualQualitySummary(visualQuality)
  const profileQualitySummary = formatProfileQualitySummary(profileQuality)
  const artifact: GeneratedGeometryArtifact = {
    id: createGeneratedGeometryId(),
    title,
    sourceTool: name,
    sourceArgs: publicSourceArgs(args),
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
    geometryBrief,
    semanticSummary,
    visualQualitySummary,
    profileQuality,
    editHistory:
      name === 'revise_geometry'
        ? [
            ...(context.revisionTarget?.editHistory ?? []),
            {
              at: new Date().toISOString(),
              tool: name,
              feedback: typeof args.feedback === 'string' ? args.feedback : context.prompt,
              intent: typeof args.intent === 'string' ? args.intent : undefined,
              summary: typeof args.userVisiblePlan === 'string' ? args.userVisiblePlan : undefined,
              operations: Array.isArray(args.operations)
                ? (args.operations as PrimitiveRevisionOperation[])
                : undefined,
            },
          ]
        : context.revisionTarget?.editHistory,
    replaceNodeIds: context.replaceNodeIds?.length ? context.replaceNodeIds : undefined,
  }

  const header = assemblyName
    ? `Created draft assembly "${assemblyName}" with ${created.length} shapes at [${assemblyPosition.join(',')}]:`
    : `Created draft with ${created.length} shapes:`

  return {
    artifact,
    content: `${header}
${shapeDetails}
${semanticSummary ? `${semanticSummary}\n` : ''}
${visualQualitySummary ? `${visualQualitySummary}\n` : ''}
${profileQualitySummary ? `${profileQualitySummary}\n` : ''}
Names: ${created.join(', ')}`,
  }
}
