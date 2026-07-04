import type {
  AnyNode,
  AnyNodeId,
  EquipmentParamValue,
  MaterialSchema,
  SemanticRecipeEditableParam,
  SemanticRecipeEditableParamEffect,
} from '@pascal-app/core'

type DynamicLevelGeometry = {
  kind?: string
  height?: number
  length?: number
  position?: [number, number, number]
}

type MaterialPropertyPatch = Partial<NonNullable<MaterialSchema['properties']>>

export type SemanticEquipmentEditableParamUpdate = {
  id: AnyNodeId
  data: Partial<AnyNode>
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function materialWithProperties(
  material: unknown,
  properties: MaterialPropertyPatch,
): MaterialSchema {
  const record = getRecord(material)
  const currentProperties = getRecord(record?.properties)
  return {
    ...(record ?? {}),
    properties: {
      ...(currentProperties ?? {}),
      ...properties,
    },
  } as MaterialSchema
}

function paramEffects(param: SemanticRecipeEditableParam): readonly SemanticRecipeEditableParamEffect[] {
  return param.effects?.length ? param.effects : [{ kind: 'set-param' as const }]
}

function effectParamKey(param: SemanticRecipeEditableParam, effect: SemanticRecipeEditableParamEffect) {
  return effect.kind === 'set-param' && effect.param ? effect.param : param.key
}

function valueToParamValue(value: unknown): EquipmentParamValue {
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  return String(value ?? '')
}

export function findSemanticEquipmentChild(
  nodes: Record<string, AnyNode>,
  assemblyId: AnyNodeId,
  role: string,
): AnyNode | null {
  const assembly = nodes[assemblyId]
  const explicitChildren =
    assembly && 'children' in assembly && Array.isArray((assembly as { children?: unknown }).children)
      ? ((assembly as { children?: unknown[] }).children ?? []).map(String)
      : []
  const parentedChildren = Object.values(nodes)
    .filter((node) => node.parentId === assemblyId)
    .map((node) => String(node.id))
  const childIds = new Set<string>([...explicitChildren, ...parentedChildren])
  for (const childId of childIds) {
    const child = nodes[childId]
    if (!child) continue
    const metadata = getRecord(child.metadata)
    if (metadata?.semanticRole === role) return child
  }
  return null
}

function readDynamicLevelGeometry(node: AnyNode | undefined): DynamicLevelGeometry | null {
  const metadata = getRecord(node?.metadata)
  const geometry = getRecord(metadata?.dynamicLevelGeometry)
  return geometry ? (geometry as DynamicLevelGeometry) : null
}

function buildEquipmentParamMetadataUpdate(
  assembly: AnyNode,
  patch: Record<string, EquipmentParamValue>,
): Partial<AnyNode> {
  const metadata = getRecord(assembly.metadata) ?? {}
  const sourceArgs = getRecord(metadata.sourceArgs) ?? {}
  const equipmentAssembly = getRecord(metadata.equipmentAssembly) ?? {}
  const sourceParams = getRecord(sourceArgs.recipeParams) ?? {}
  const equipmentParams = getRecord(equipmentAssembly.params) ?? {}
  return {
    metadata: {
      ...metadata,
      sourceArgs: {
        ...sourceArgs,
        recipeParams: {
          ...sourceParams,
          ...patch,
        },
      },
      equipmentAssembly: {
        ...equipmentAssembly,
        params: {
          ...equipmentParams,
          ...patch,
        },
      },
    },
  } as Partial<AnyNode>
}

function buildDynamicLevelUpdate(input: {
  assembly: AnyNode
  target: AnyNode
  effect: Extract<SemanticRecipeEditableParamEffect, { kind: 'set-part-dynamic-level' }>
  value: number
}): Partial<AnyNode> | null {
  if (input.target.type !== 'cylinder') return null
  const dynamicLevelGeometry = readDynamicLevelGeometry(input.assembly)
  const span =
    dynamicLevelGeometry?.kind === 'horizontal'
      ? dynamicLevelGeometry.length
      : dynamicLevelGeometry?.height
  if (!span || span <= 0) return null
  const level = clamp01(input.value)
  const height = Math.max(input.effect.minSize ?? 0.02, span * level)
  const currentPosition = Array.isArray((input.target as { position?: unknown }).position)
    ? ([...(input.target as { position: [number, number, number] }).position] as [number, number, number])
    : ([0, 0, 0] as [number, number, number])
  const base = dynamicLevelGeometry?.position
  if (dynamicLevelGeometry?.kind === 'horizontal') {
    currentPosition[0] = (base?.[0] ?? 0) - (span - height) / 2
  } else {
    currentPosition[1] = (base?.[1] ?? 0) + height / 2
  }
  return { height, position: currentPosition } as Partial<AnyNode>
}

function buildMaterialUpdate(
  target: AnyNode,
  effect: Extract<SemanticRecipeEditableParamEffect, { kind: 'set-part-material' }>,
  value: EquipmentParamValue,
): Partial<AnyNode> | null {
  const properties: MaterialPropertyPatch = {}
  if (effect.property === 'color' && typeof value === 'string') {
    properties.color = value
  } else if (effect.property === 'opacity' && typeof value === 'number') {
    const opacity = clamp01(value)
    properties.opacity = opacity
    if (effect.transparentWhenBelowOne) properties.transparent = opacity < 1
  } else if (effect.property === 'transparent' && typeof value === 'boolean') {
    properties.transparent = value
  } else if (effect.property === 'roughness' && typeof value === 'number') {
    properties.roughness = clamp01(value)
  } else if (effect.property === 'metalness' && typeof value === 'number') {
    properties.metalness = clamp01(value)
  }
  if (Object.keys(properties).length === 0) return null
  return {
    material: materialWithProperties((target as { material?: unknown }).material, properties),
  } as Partial<AnyNode>
}

export function buildSemanticEquipmentEditableParamUpdates(input: {
  nodes: Record<string, AnyNode>
  assemblyId: AnyNodeId
  param: SemanticRecipeEditableParam
  value: unknown
}): SemanticEquipmentEditableParamUpdate[] {
  const assembly = input.nodes[input.assemblyId]
  if (!assembly) return []
  const value = valueToParamValue(input.value)
  const updates: SemanticEquipmentEditableParamUpdate[] = []
  const paramPatch: Record<string, EquipmentParamValue> = {}
  for (const effect of paramEffects(input.param)) {
    if (effect.kind === 'set-param') {
      paramPatch[effectParamKey(input.param, effect)] = value
      continue
    }
    const target = findSemanticEquipmentChild(input.nodes, input.assemblyId, effect.partRole)
    if (!target) continue
    const data =
      effect.kind === 'set-part-material'
        ? buildMaterialUpdate(target, effect, value)
        : typeof value === 'number'
          ? buildDynamicLevelUpdate({ assembly, target, effect, value })
          : null
    if (data) updates.push({ id: target.id as AnyNodeId, data })
  }
  if (Object.keys(paramPatch).length > 0) {
    updates.push({
      id: input.assemblyId,
      data: buildEquipmentParamMetadataUpdate(assembly, paramPatch),
    })
  }
  return updates
}
