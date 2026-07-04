import type { EquipmentParamValue } from '@pascal-app/core'
import { composePartPrimitives, type PartComposeInput } from '@pascal-app/core/lib/part-compose'
import {
  type PrimitiveShapeInput,
  resolvePrimitiveWorldTransforms,
} from '@pascal-app/core/lib/primitive-compose'
import {
  computeGeneratedAssemblyPosition,
  createGeneratedGeometryId,
  formatGeneratedShapeDetails,
  type GeneratedGeometryArtifact,
  inferGeneratedAssemblyName,
} from '../../../../packages/editor/src/lib/ai-generated-geometry-core'
import {
  buildGeneratedGeometryCreatePatches,
  type GeneratedGeometryPatchPlan,
} from '../../../../packages/editor/src/lib/ai-generated-geometry-nodes'
import {
  buildCentrifugalPumpPorts,
  buildCentrifugalPumpProfileParts,
  buildStorageTankPorts,
  buildStorageTankProfileParts,
  CENTRIFUGAL_PUMP_CORE_PART_ROLES,
  CENTRIFUGAL_PUMP_EDITABLE_PARAMS,
  CENTRIFUGAL_PUMP_EDITABLE_PART_ROLES,
  STORAGE_TANK_CORE_PART_ROLES,
  STORAGE_TANK_EDITABLE_PARAMS,
  STORAGE_TANK_EDITABLE_PART_ROLES,
} from '@pascal-app/plugin-factory-equipment'
import type { FactorySceneEditPatch } from './factory-selection-edit'
import type { GeneratedGeometryPlacementSpec } from '../../../../packages/editor/src/lib/ai-generated-geometry-nodes'
import { createSemanticAssemblyPatchPlan as createRecipeSemanticAssemblyPatchPlan } from '../equipment-semantic-assembly-patches'
import type { SemanticEquipmentSpec } from '../equipment-binding-resolver'
import { ensureFactorySemanticRecipesRegistered } from './factory-semantic-recipe-registry'

type FactoryEquipmentNodeKind = 'factory:pump' | 'factory:tank'

export type SingleEquipmentIntent =
  | {
      kind: 'equipment'
      nodeKind: FactoryEquipmentNodeKind
      recipeId: string
      profileId: string
      params: Record<string, EquipmentParamValue>
      confidence: number
    }
  | {
      kind: 'generic-equipment-draft'
      reason: string
    }

export type SingleEquipmentCompileResult =
  | {
      kind: 'create-semantic-assembly'
      intent: Extract<SingleEquipmentIntent, { kind: 'equipment' }>
      patchPlan: GeneratedGeometryPatchPlan
    }
  | {
      kind: 'update-equipment-node'
      nodeId: string
      nodeKind: FactoryEquipmentNodeKind
      patch: Extract<FactorySceneEditPatch, { op: 'update' }>
    }
  | {
      kind: 'generic-equipment-draft'
      reason: string
    }

type SelectionNodeSnapshot = {
  id?: string
  type?: string
  [key: string]: unknown
}

function normalized(input: string) {
  return input.toLowerCase()
}

function numberBefore(text: string, keywordPattern: string) {
  const match = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*(?:m|meter|meters|\\u7c73)?\\s*(?:${keywordPattern})`,
    'iu',
  ).exec(text)
  const value = match?.[1] ? Number(match[1]) : Number.NaN
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function dimensionsFromPrompt(text: string) {
  const normalizedText = text.replace(/[\u00d7\uff0a]/g, '*')
  const tuple =
    /(\d+(?:\.\d+)?)\s*(?:m|\u7c73)?\s*[*xX]\s*(\d+(?:\.\d+)?)\s*(?:m|\u7c73)?(?:\s*[*xX]\s*(\d+(?:\.\d+)?)\s*(?:m|\u7c73)?)?/u.exec(
      normalizedText,
    )
  if (tuple) {
    return {
      length: Number(tuple[1]),
      width: Number(tuple[2]),
      ...(tuple[3] ? { height: Number(tuple[3]) } : {}),
    }
  }
  return {
    length: numberBefore(normalizedText, '\\u957f|length|long'),
    width: numberBefore(normalizedText, '\\u5bbd|\\u76f4\\u5f84|diameter|width|wide'),
    height: numberBefore(normalizedText, '\\u9ad8|height|tall'),
  }
}

function colorFromPrompt(text: string) {
  const hex = /#[0-9a-f]{6}\b/i.exec(text)?.[0]
  if (hex) return hex.toLowerCase()
  if (/\bred\b|\u7ea2(?:\u8272)?|\u8d64(?:\u8272)?/iu.test(text)) return '#ef4444'
  if (/\bblue\b|\u84dd(?:\u8272)?/iu.test(text)) return '#3b82f6'
  if (/\bgreen\b|\u7eff(?:\u8272)?/iu.test(text)) return '#22c55e'
  if (/\byellow\b|\u9ec4(?:\u8272)?/iu.test(text)) return '#facc15'
  if (/\bgr[ae]y\b|\u7070(?:\u8272)?/iu.test(text)) return '#64748b'
  return undefined
}

function percentageParamFromPrompt(text: string, keywordPattern: string) {
  const normalizedText = text.replace(/％/g, '%')
  const afterKeyword = new RegExp(
    `(?:${keywordPattern})[^\\d]{0,8}(\\d+(?:\\.\\d+)?)\\s*%?`,
    'iu',
  ).exec(normalizedText)
  const beforeKeyword = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*%?[^\\d]{0,8}(?:${keywordPattern})`,
    'iu',
  ).exec(normalizedText)
  const raw = afterKeyword?.[1] ?? beforeKeyword?.[1]
  const value = raw ? Number(raw) : Number.NaN
  if (!Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(1, value > 1 ? value / 100 : value))
}

function opacityFromPrompt(text: string) {
  const explicit = percentageParamFromPrompt(text, '透明度|opacity')
  if (explicit != null) return explicit
  if (/半透明|translucent|transparent/iu.test(text)) return 0.34
  return undefined
}

function numberParam(params: Record<string, EquipmentParamValue>, key: string, fallback: number) {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function createRecipePatchPlan(input: {
  intent: Extract<SingleEquipmentIntent, { kind: 'equipment' }>
  prompt: string
  placement: GeneratedGeometryPlacementSpec
}): GeneratedGeometryPatchPlan | null {
  ensureFactorySemanticRecipesRegistered()
  const spec: SemanticEquipmentSpec = {
    recipeId: input.intent.recipeId,
    profileId: input.intent.profileId,
    params: input.intent.params,
    ...(input.placement.position ? { position: input.placement.position } : {}),
    ...(input.placement.rotation ? { rotation: input.placement.rotation } : {}),
    metadata: {
      equipmentIntentConfidence: input.intent.confidence,
      sourcePrompt: input.prompt,
      recipeParams: input.intent.params,
      recipeSource: 'single-equipment-recipe',
    },
  }
  return createRecipeSemanticAssemblyPatchPlan({
    spec,
    prompt: input.prompt,
    placement: input.placement,
  })
}

function createSemanticAssemblyPatchPlan(input: {
  intent: Extract<SingleEquipmentIntent, { kind: 'equipment' }>
  prompt: string
  placement: GeneratedGeometryPlacementSpec
}): GeneratedGeometryPatchPlan | null {
  const isPump = input.intent.nodeKind === 'factory:pump'
  const isTank = input.intent.nodeKind === 'factory:tank'
  if (!isPump && !isTank) return null
  const length = numberParam(input.intent.params, 'length', isPump ? 2.6 : 2.4)
  const width = numberParam(input.intent.params, 'width', isPump ? 1.1 : 2.4)
  const height = numberParam(input.intent.params, 'height', isPump ? 1.4 : 3.2)
  const orientation =
    input.intent.params.orientation === 'horizontal' ? 'horizontal' : 'vertical'
  const family = isPump ? 'pump' : 'tank.storage'
  const primarySemanticRole = isPump ? 'pump' : 'vessel_shell'
  const coreRoles = isPump ? CENTRIFUGAL_PUMP_CORE_PART_ROLES : STORAGE_TANK_CORE_PART_ROLES
  const editableRoles = isPump
    ? CENTRIFUGAL_PUMP_EDITABLE_PART_ROLES
    : STORAGE_TANK_EDITABLE_PART_ROLES
  const editableParams = isPump
    ? CENTRIFUGAL_PUMP_EDITABLE_PARAMS
    : STORAGE_TANK_EDITABLE_PARAMS
  const ports = isPump
    ? buildCentrifugalPumpPorts({ height, medium: 'material' })
    : buildStorageTankPorts({ height, medium: 'material' })
  const sourceArgs: PartComposeInput = {
    name:
      typeof input.intent.params.name === 'string'
        ? input.intent.params.name
        : isPump
          ? 'Factory pump'
          : 'Factory tank',
    family,
    category: isPump ? 'industrial pump' : 'industrial storage tank',
    detail: 'high',
    length,
    width,
    depth: width,
    height,
    parts: isPump
      ? buildCentrifugalPumpProfileParts({ params: input.intent.params })
      : buildStorageTankProfileParts({
          length,
          width,
          height,
          orientation,
          params: input.intent.params,
        }),
    autoComplete: false,
    enhanceVisualDetails: false,
    registryPartPlan: true,
    primaryColor:
      typeof input.intent.params.casingColor === 'string'
        ? input.intent.params.casingColor
        : typeof input.intent.params.shellColor === 'string'
          ? input.intent.params.shellColor
          : isPump
            ? '#4f7f93'
            : '#cbd5e1',
    metalColor: '#cbd5e1',
    darkColor: '#1f2937',
    accentColor: '#f59e0b',
  } as PartComposeInput
  const shapes = composePartPrimitives(sourceArgs) as PrimitiveShapeInput[]
  if (!shapes.length) return null
  const artifactShapes: GeneratedGeometryArtifact['shapes'] = shapes.map((shape) => ({
    ...shape,
    position: shape.position ?? [0, 0, 0],
    rotation: shape.rotation ?? [0, 0, 0],
  }))
  const transforms = resolvePrimitiveWorldTransforms(artifactShapes, {
    positionMode: 'world-center',
  })
  const assemblyPosition = computeGeneratedAssemblyPosition(transforms)
  const artifact: GeneratedGeometryArtifact = {
    id: createGeneratedGeometryId(),
    title: sourceArgs.name ?? (isPump ? 'Factory pump' : 'Factory tank'),
    sourceTool: 'semantic_assembly',
    sourceArgs: {
      profileId: input.intent.profileId,
      family,
      length,
      width,
      height,
      primarySemanticRole,
    },
    userPrompt: input.prompt,
    version: 1,
    createdAt: new Date().toISOString(),
    shapes: artifactShapes,
    transforms,
    assemblyName: inferGeneratedAssemblyName(
      'semantic_assembly',
      sourceArgs as Record<string, unknown>,
      artifactShapes,
    ),
    assemblyPosition,
    createdNames: artifactShapes.map((shape) => shape.name ?? shape.kind),
    shapeDetails: formatGeneratedShapeDetails(artifactShapes, transforms),
    geometryBrief: {
      category: family,
      units: 'meters',
      expectedDimensions: { length, width, height },
      requiredRoles: [...coreRoles],
      semanticRoles: [...coreRoles],
    },
  }
  const position = input.placement.position ?? [0, 0, 0]
  return buildGeneratedGeometryCreatePatches(artifact, {
    ...input.placement,
    metadata: {
      generatedBy: 'single-equipment-compiler',
      equipmentIntentConfidence: input.intent.confidence,
      sourcePrompt: input.prompt,
      resolver: 'semantic-assembly',
      resolverReason: 'single equipment prompt compiled to editable semantic assembly',
      factoryRouteObstacle: {
        stationId: 'single_equipment',
        source: 'profile-parts',
        minHeight: position[1],
        maxHeight: position[1] + height,
        box: {
          minX: position[0] - length / 2,
          maxX: position[0] + length / 2,
          minZ: position[2] - width / 2,
          maxZ: position[2] + width / 2,
        },
      },
      equipmentAssembly: {
        kind: 'semantic-assembly',
        profileId: input.intent.profileId,
        equipmentFamily: family,
        primarySemanticRole,
        envelope: { length, width, height, origin: 'prompt' },
        ports,
        editableParams: [...editableParams],
        editablePartRoles: [...editableRoles],
        recipeSource: 'single-equipment-profile-parts',
      },
      equipmentContract: {
        profileId: input.intent.profileId,
        equipmentFamily: family,
        scaleClass: 'single-equipment',
        envelope: { length, width, height, origin: 'prompt' },
        ports,
      },
    },
  })
}

export function classifySingleEquipmentIntent(prompt: string): SingleEquipmentIntent {
  const text = normalized(prompt)
  const dimensions = dimensionsFromPrompt(prompt)
  const color = colorFromPrompt(text)

  if (
    /\u79bb\u5fc3\u6cf5|\u8ba1\u91cf\u6cf5|\u6cf5|centrifugal[_\s-]?pump|metering[_\s-]?pump|\bpump\b/iu.test(
      text,
    )
  ) {
    const metering = /metering|\u8ba1\u91cf/iu.test(text)
    return {
      kind: 'equipment',
      nodeKind: 'factory:pump',
      recipeId: 'factory:centrifugal-pump',
      profileId: metering ? 'generic.metering_pump' : 'generic.centrifugal_pump',
      confidence: 0.92,
      params: {
        name: /\u79bb\u5fc3\u6cf5|\u6cf5/u.test(prompt) ? '\u79bb\u5fc3\u6cf5' : 'Factory pump',
        pumpType: metering ? 'metering' : 'centrifugal',
        length: dimensions.length ?? 2.6,
        width: dimensions.width ?? 1.1,
        height: dimensions.height ?? 1.4,
        flowRate: 120,
        motorPower: 15,
        inletDiameter: 0.18,
        outletDiameter: 0.12,
        skidMounted: true,
        ...(color ? { casingColor: color } : {}),
      },
    }
  }

  if (/\u50a8\u7f50|\u50a8\u69fd|\u7f50|tank|vessel|storage/iu.test(text)) {
    const vertical = !/horizontal|\u5367\u5f0f/iu.test(text)
    const liquidLevel = percentageParamFromPrompt(
      prompt,
      '液位|液面|料位|水位|油位|level|fill|filled',
    )
    const shellOpacity = opacityFromPrompt(prompt)
    const liquidOpacity = percentageParamFromPrompt(prompt, '液体透明度|液相透明度|liquid opacity')
    const profileIdMatch = /\b([a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+)\b/i.exec(prompt)
    const profileId = profileIdMatch?.[1] ?? (vertical ? 'generic.vertical_tank' : 'generic.horizontal_tank')
    return {
      kind: 'equipment',
      nodeKind: 'factory:tank',
      recipeId: 'factory:storage-tank',
      profileId,
      confidence: 0.9,
      params: {
        name: /原油/u.test(prompt)
          ? '原油储罐'
          : /\u50a8\u7f50|\u7f50/u.test(prompt)
            ? '\u50a8\u7f50'
            : 'Factory tank',
        orientation: vertical ? 'vertical' : 'horizontal',
        length: dimensions.length ?? (vertical ? 2.4 : 3.6),
        width: dimensions.width ?? (vertical ? 2.4 : 1.4),
        height: dimensions.height ?? (vertical ? 3.2 : 1.4),
        capacity: 10,
        inletDiameter: 0.16,
        outletDiameter: 0.12,
        liquidLevel: liquidLevel ?? 0.5,
        ...(color ? { shellColor: color } : {}),
        ...(shellOpacity != null ? { shellOpacity } : {}),
        ...(liquidOpacity != null ? { liquidOpacity } : {}),
      },
    }
  }

  return { kind: 'generic-equipment-draft', reason: 'No bounded factory equipment intent matched.' }
}

function selectedFactoryNode(context: unknown): SelectionNodeSnapshot | null {
  const record = typeof context === 'object' && context !== null ? (context as Record<string, unknown>) : {}
  const selection =
    typeof record.selection === 'object' && record.selection !== null
      ? (record.selection as Record<string, unknown>)
      : {}
  const selectedIds = Array.isArray(selection.selectedIds) ? selection.selectedIds : []
  const nodes = Array.isArray(selection.nodes) ? selection.nodes : []
  const selected = nodes.find((node): node is SelectionNodeSnapshot => {
    if (typeof node !== 'object' || node === null) return false
    const snapshot = node as SelectionNodeSnapshot
    return (
      typeof snapshot.id === 'string' &&
      selectedIds.includes(snapshot.id) &&
      (snapshot.type === 'factory:pump' || snapshot.type === 'factory:tank')
    )
  })
  return selected ?? null
}

function updatePatchForSelectedNode(input: {
  prompt: string
  intent: Extract<SingleEquipmentIntent, { kind: 'equipment' }>
  context?: unknown
}): Extract<FactorySceneEditPatch, { op: 'update' }> | null {
  const selected = selectedFactoryNode(input.context)
  if (!selected || selected.type !== input.intent.nodeKind || !selected.id) return null
  const data: Record<string, EquipmentParamValue> = {}
  const dimensions = dimensionsFromPrompt(input.prompt)
  if (dimensions.length) data.length = dimensions.length
  if (dimensions.width) data.width = dimensions.width
  if (dimensions.height) data.height = dimensions.height
  const color = colorFromPrompt(normalized(input.prompt))
  if (color && selected.type === 'factory:pump') data.casingColor = color
  if (color && selected.type === 'factory:tank') data.shellColor = color

  if (selected.type === 'factory:tank') {
    if (/horizontal|\u5367\u5f0f/iu.test(input.prompt)) data.orientation = 'horizontal'
    if (/vertical|\u7acb\u5f0f/iu.test(input.prompt)) data.orientation = 'vertical'
  }
  if (selected.type === 'factory:pump') {
    if (/centrifugal|\u79bb\u5fc3/iu.test(input.prompt)) data.pumpType = 'centrifugal'
    if (/metering|\u8ba1\u91cf/iu.test(input.prompt)) data.pumpType = 'metering'
  }
  if (!Object.keys(data).length) return null
  return { op: 'update', id: selected.id, data }
}

export function compileSingleEquipmentPrompt(input: {
  prompt: string
  placement: GeneratedGeometryPlacementSpec
  context?: unknown
}): SingleEquipmentCompileResult {
  const intent = classifySingleEquipmentIntent(input.prompt)
  if (intent.kind !== 'equipment') {
    return { kind: 'generic-equipment-draft', reason: intent.reason }
  }

  const updatePatch = updatePatchForSelectedNode({
    prompt: input.prompt,
    intent,
    context: input.context,
  })
  if (updatePatch) {
    return {
      kind: 'update-equipment-node',
      nodeId: updatePatch.id,
      nodeKind: intent.nodeKind,
      patch: updatePatch,
    }
  }

  const recipeAssembly = createRecipePatchPlan({
    intent,
    prompt: input.prompt,
    placement: input.placement,
  })
  if (recipeAssembly?.patches.length) {
    return {
      kind: 'create-semantic-assembly',
      intent,
      patchPlan: recipeAssembly,
    }
  }
  const semanticAssembly = createSemanticAssemblyPatchPlan({
    intent,
    prompt: input.prompt,
    placement: input.placement,
  })
  if (semanticAssembly?.patches.length) {
    return {
      kind: 'create-semantic-assembly',
      intent,
      patchPlan: semanticAssembly,
    }
  }
  return { kind: 'generic-equipment-draft', reason: 'No semantic assembly recipe produced patches.' }
}
