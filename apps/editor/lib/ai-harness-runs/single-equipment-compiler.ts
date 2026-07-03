import type { EquipmentParamValue, EquipmentSpec } from '@pascal-app/core'
import { nodeRegistry } from '@pascal-app/core'
import { createEquipmentNodePatch, type EquipmentNodeCreatePatch } from '../equipment-node-patches'
import type { FactorySceneEditPatch } from './factory-selection-edit'
import type { GeneratedGeometryPlacementSpec } from '../../../../packages/editor/src/lib/ai-generated-geometry-nodes'

type FactoryEquipmentNodeKind = 'factory:pump' | 'factory:tank'

export type SingleEquipmentIntent =
  | {
      kind: 'equipment'
      nodeKind: FactoryEquipmentNodeKind
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
      kind: 'create-equipment-node'
      intent: Extract<SingleEquipmentIntent, { kind: 'equipment' }>
      patch: EquipmentNodeCreatePatch
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

function numberParam(params: Record<string, EquipmentParamValue>, key: string, fallback: number) {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function metadataForSingleEquipment(input: {
  intent: Extract<SingleEquipmentIntent, { kind: 'equipment' }>
  prompt: string
  placement: GeneratedGeometryPlacementSpec
}) {
  const length = numberParam(input.intent.params, 'length', 1)
  const width = numberParam(input.intent.params, 'width', 1)
  const height = numberParam(input.intent.params, 'height', 1)
  const position = input.placement.position ?? [0, 0, 0]
  const family = input.intent.nodeKind === 'factory:pump' ? 'pump' : 'tank'
  return {
    generatedBy: 'single-equipment-compiler',
    equipmentIntentConfidence: input.intent.confidence,
    sourcePrompt: input.prompt,
    resolver: 'factory-node',
    resolverReason: 'single equipment prompt compiled to registered factory node',
    factoryNodeKind: input.intent.nodeKind,
    factoryRouteObstacle: {
      stationId: 'single_equipment',
      source: 'factory-node',
      minHeight: position[1],
      maxHeight: position[1] + height,
      box: {
        minX: position[0] - length / 2,
        maxX: position[0] + length / 2,
        minZ: position[2] - width / 2,
        maxZ: position[2] + width / 2,
      },
    },
    equipmentContract: {
      profileId: input.intent.profileId,
      equipmentFamily: family,
      scaleClass: 'single-equipment',
      envelope: { length, width, height, origin: 'prompt' },
      ports: [
        {
          id: 'inlet',
          medium: 'material',
          side: input.intent.nodeKind === 'factory:tank' ? 'top' : 'left',
          height: height * 0.5,
          diameter: numberParam(input.intent.params, 'inletDiameter', 0.1),
        },
        {
          id: 'outlet',
          medium: 'material',
          side: input.intent.nodeKind === 'factory:tank' ? 'front' : 'right',
          height: height * 0.45,
          diameter: numberParam(input.intent.params, 'outletDiameter', 0.1),
        },
      ],
    },
  }
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
    return {
      kind: 'equipment',
      nodeKind: 'factory:tank',
      profileId: vertical ? 'generic.vertical_tank' : 'generic.horizontal_tank',
      confidence: 0.9,
      params: {
        name: /\u50a8\u7f50|\u7f50/u.test(prompt) ? '\u50a8\u7f50' : 'Factory tank',
        orientation: vertical ? 'vertical' : 'horizontal',
        length: dimensions.length ?? (vertical ? 2.4 : 3.6),
        width: dimensions.width ?? (vertical ? 2.4 : 1.4),
        height: dimensions.height ?? (vertical ? 3.2 : 1.4),
        capacity: 10,
        inletDiameter: 0.16,
        outletDiameter: 0.12,
        liquidLevel: 0.5,
        ...(color ? { shellColor: color } : {}),
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

  if (!nodeRegistry.has(intent.nodeKind)) {
    return {
      kind: 'generic-equipment-draft',
      reason: `Factory equipment node "${intent.nodeKind}" is not registered.`,
    }
  }

  const spec: EquipmentSpec = {
    nodeKind: intent.nodeKind,
    profileId: intent.profileId,
    params: intent.params,
    ...(input.placement.position ? { position: input.placement.position } : {}),
    ...(input.placement.rotation ? { rotation: input.placement.rotation } : {}),
    metadata: metadataForSingleEquipment({
      intent,
      prompt: input.prompt,
      placement: input.placement,
    }),
  }
  return {
    kind: 'create-equipment-node',
    intent,
    patch: createEquipmentNodePatch({
      spec,
      parentId: input.placement.parentId,
    }),
  }
}
