import {
  type AssemblyComposeInput,
  composeAssemblyPrimitives,
  getAssemblyGeometryBrief,
} from '@pascal-app/core/lib/assembly-compose'
import {
  extractUserGeometryConstraints,
  validateAssemblyConstraints,
} from '@pascal-app/core/lib/assembly-constraints'
import {
  applyDimensionSemanticsToObjectInput,
  parseDimensionSemantics,
} from '@pascal-app/core/lib/dimension-semantics'
import {
  composeObjectPrimitives,
  type ObjectComposeInput,
} from '@pascal-app/core/lib/object-compose'
import { composePartPrimitives, type PartComposeInput } from '@pascal-app/core/lib/part-compose'
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
    const hasExplicitParts =
      Array.isArray(dimensionAwarePartArgs.parts) && dimensionAwarePartArgs.parts.length > 0
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
    if (!hasExplicitParts) {
      if (isOpenAssemblyRequest(dimensionAwarePartArgs, prompt)) {
        return composeAssemblyPrimitives(openAssemblyFallbackInput(dimensionAwarePartArgs, prompt))
      }
      if (isRiverIntent(dimensionAwarePartArgs, prompt)) {
        const fallbackShapes = riverPrimitiveFallbackShapes(dimensionAwarePartArgs, prompt)
        args.__fallbackGeometryBrief = riverFallbackGeometryBrief(dimensionAwarePartArgs, prompt)
        args.shapes = fallbackShapes
        return fallbackShapes
      }
      // Try recipe first for parametric requests (gear, valve, etc.) — recipe is more precise
      const recipeShapes = composeRecipePrimitives(
        recipeFallbackInput(dimensionAwarePartArgs, prompt),
      )
      if (recipeShapes.length > 0) return recipeShapes
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
  if (name === 'compose_object') {
    const dimensionAwareObjectArgs = applyDimensionSemanticsToObjectInput(
      args as ObjectComposeInput,
      prompt,
    )
    return composeObjectPrimitives(dimensionAwareObjectArgs)
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
    /(machine|equipment|device|appliance|instrument|console|robot|pump|motor|\u673a\u5668|\u8bbe\u5907|\u88c5\u7f6e|\u4eea\u5668|\u7535\u5668)/i.test(
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
      'generic primitive fallback because no dedicated recipe, assembly family, or reusable part matched',
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
  const fallbackBrief = genericPrimitiveFallbackGeometryBrief(sourceArgs, prompt)
  const fallbackShapes = genericObjectPrimitiveFallbackShapes(sourceArgs, prompt)
  targetArgs.__fallbackGeometryBrief = fallbackBrief
  targetArgs.__genericPrimitiveFallback = true
  targetArgs.shapes = fallbackShapes
  return fallbackShapes
}

function isAircraftIntent(
  args: Record<string, unknown>,
  prompt: string,
  context?: GeometryToolExecutionContext,
): boolean {
  const roleText = (context?.blueprintRequiredRoles ?? []).join(' ')
  const text =
    `${prompt} ${context?.blueprintCategory ?? ''} ${roleText} ${JSON.stringify(args)}`.toLowerCase()
  return /aircraft|airliner|boeing|airplane|plane|fuselage|landing[_\s-]?gear|\u98de\u673a|\u5ba2\u673a|\u6ce2\u97f3/.test(
    text,
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

  return applyPromptDimensionSemanticsToPartInput(
    {
      name: typeof args.name === 'string' ? args.name : 'compact aircraft',
      ...(length ? { length } : {}),
      primaryColor: args.primaryColor ?? args.color,
      secondaryColor: args.secondaryColor,
      darkColor: args.darkColor,
      geometryBrief: {
        ...geometryBrief,
        category: 'aircraft',
        expectedDimensions: {
          ...(isRecord(geometryBrief.expectedDimensions) ? geometryBrief.expectedDimensions : {}),
          ...(length ? { length } : {}),
        },
        requiredRoles,
      },
      parts: [{ kind: 'aircraft_fuselage', id: 'aircraft_fuselage' }],
    },
    prompt,
  )
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
  args.parts = fallbackInput.parts
  if (fallbackInput.length != null) args.length = fallbackInput.length
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

function rawShapeText(shape: RawShape): string {
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
  if (/opening|hollow|rim|cap|torus|frustum/.test(rawShapeText(shape))) return undefined

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
  return {
    ...(withoutExternalRecipeBrief(args) as AssemblyComposeInput),
    ...params,
    name: fallback.name,
    prompt,
  }
}

function isOpenAssemblyRequest(args: Record<string, unknown>, prompt: string): boolean {
  return isOpenAssemblyCapabilityRequest(args, prompt)
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
  [/(红色|紅色|red)/i, '#ef4444'],
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
      return [0, height / 2, 0]
    case 'rounded-panel':
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

export function normalizeGeometryToolShapes(rawShapes: RawShape[]): ShapeSpec[] {
  return (
    expandPrimitiveShapeArrays(rawShapes as PrimitiveArrayExpandableShape[]) as RawShape[]
  ).map((shape) => {
    const shapeRecord = shape as Record<string, unknown>
    const params = isRecord(shapeRecord.params) ? shapeRecord.params : {}
    const read = (key: string) => shapeRecord[key] ?? params[key]
    const size = Array.isArray(read('size')) ? (read('size') as number[]) : undefined
    const color = Array.isArray(read('color')) ? (read('color') as number[]) : undefined
    const material = normalizePrimitiveMaterial(read('material'), read('materialColor'), color)

    const kind = normalizePrimitiveKind(
      read('kind') ?? read('primitive') ?? read('shape') ?? read('type'),
    )
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
    return {
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
      materialPreset: read('materialPreset') as string | undefined,
      attachTo: read('attachTo') as number | string | undefined,
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

  const maxShapes = options.maxShapes ?? MAX_GENERATED_GEOMETRY_SHAPES
  if (rawShapes.length > maxShapes) {
    const aircraftFallbackShapes = compactAircraftFallbackShapes(args, context.prompt, context)
    if (aircraftFallbackShapes && aircraftFallbackShapes.length <= maxShapes) {
      rawShapes = expandPrimitiveShapeArrays(
        aircraftFallbackShapes as PrimitiveArrayExpandableShape[],
      ) as RawShape[]
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

  let shapes = normalizeGeometryToolShapes(rawShapes)
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
  if (name !== 'revise_geometry') {
    const hardConstraints = extractUserGeometryConstraints(
      context.prompt,
      userConstraintArgs(name, args),
    )
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
Names: ${created.join(', ')}`,
  }
}
