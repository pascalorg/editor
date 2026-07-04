'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type EquipmentParamValue,
  getMaterialPresetByRef,
  type SemanticRecipeEditableParam,
  type SemanticRecipeEditableParamEffect,
  useScene,
} from '@pascal-app/core'
import { useMemo } from 'react'
import { buildSemanticEquipmentEditableParamUpdates } from '../../../lib/semantic-equipment-editing'
import { MaterialSwatchField } from '../controls/material-swatch-field'
import { SegmentedControl } from '../controls/segmented-control'
import { SliderControl } from '../controls/slider-control'
import { ToggleControl } from '../controls/toggle-control'

type SemanticEquipmentAssembly = {
  kind?: string
  recipeId?: string
  profileId?: string
  equipmentFamily?: string
  params?: Record<string, EquipmentParamValue>
  editableParams?: readonly SemanticRecipeEditableParam[]
}

type DynamicLevelGeometry = {
  kind?: string
  height?: number
  length?: number
  diameter?: number
  position?: [number, number, number]
}

const STORAGE_TANK_FALLBACK_EDITABLE_PARAMS: readonly SemanticRecipeEditableParam[] = [
  {
    key: 'liquidLevel',
    label: '\u6db2\u4f4d',
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    precision: 2,
    effects: [
      { kind: 'set-param' },
      { kind: 'set-part-dynamic-level', partRole: 'liquid_volume', geometryRef: 'dynamicLevelGeometry' },
    ],
  },
  {
    key: 'shellOpacity',
    label: '\u7f50\u4f53\u900f\u660e\u5ea6',
    kind: 'number',
    min: 0.12,
    max: 1,
    step: 0.01,
    precision: 2,
    effects: [
      { kind: 'set-param' },
      {
        kind: 'set-part-material',
        partRole: 'vessel_shell',
        property: 'opacity',
        transparentWhenBelowOne: true,
      },
    ],
  },
  {
    key: 'liquidOpacity',
    label: '\u6db2\u4f53\u900f\u660e\u5ea6',
    kind: 'number',
    min: 0.08,
    max: 0.92,
    step: 0.01,
    precision: 2,
    effects: [
      { kind: 'set-param' },
      {
        kind: 'set-part-material',
        partRole: 'liquid_volume',
        property: 'opacity',
        transparentWhenBelowOne: true,
      },
    ],
  },
  {
    key: 'liquidColor',
    label: '\u6db2\u4f53\u989c\u8272',
    kind: 'color',
    defaultValue: '#38bdf8',
    effects: [
      { kind: 'set-param' },
      { kind: 'set-part-material', partRole: 'liquid_volume', property: 'color' },
    ],
  },
]

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clampRange(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function paramEffects(param: SemanticRecipeEditableParam): readonly SemanticRecipeEditableParamEffect[] {
  return param.effects?.length ? param.effects : [{ kind: 'set-param' as const }]
}

function effectParamKey(param: SemanticRecipeEditableParam, effect: SemanticRecipeEditableParamEffect) {
  return effect.kind === 'set-param' && effect.param ? effect.param : param.key
}

export function readSemanticEquipmentAssembly(node: AnyNode | undefined): SemanticEquipmentAssembly | null {
  const metadata = getRecord(node?.metadata)
  const equipmentAssembly = getRecord(metadata?.equipmentAssembly)
  if (equipmentAssembly?.kind === 'semantic-assembly') {
    return equipmentAssembly as SemanticEquipmentAssembly
  }
  if (metadata?.resolver === 'semantic-assembly' && typeof metadata.recipeId === 'string') {
    return {
      kind: 'semantic-assembly',
      recipeId: metadata.recipeId,
      profileId:
        typeof metadata.equipmentProfileId === 'string'
          ? metadata.equipmentProfileId
          : undefined,
      equipmentFamily:
        typeof metadata.semanticType === 'string' ? metadata.semanticType : undefined,
    }
  }
  return null
}

function readRecipeParams(node: AnyNode | undefined, equipment: SemanticEquipmentAssembly) {
  const metadata = getRecord(node?.metadata)
  const sourceArgs = getRecord(metadata?.sourceArgs)
  const sourceParams = getRecord(sourceArgs?.recipeParams)
  return {
    ...(sourceParams ?? {}),
    ...(equipment.params ?? {}),
  }
}

function editableParamsFor(
  equipment: SemanticEquipmentAssembly,
  dynamicLevelGeometry: DynamicLevelGeometry | null,
  liquid: AnyNode | null,
  shell: AnyNode | null,
) {
  if (equipment.editableParams?.length) return equipment.editableParams
  if (equipment.recipeId === 'factory:storage-tank' && dynamicLevelGeometry && liquid && shell) {
    return STORAGE_TANK_FALLBACK_EDITABLE_PARAMS
  }
  return []
}

function readDynamicLevelGeometry(node: AnyNode | undefined): DynamicLevelGeometry | null {
  const metadata = getRecord(node?.metadata)
  const geometry = getRecord(metadata?.dynamicLevelGeometry)
  if (!geometry) return null
  return geometry as DynamicLevelGeometry
}

function findSemanticChild(
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
    const metadata = getRecord(child?.metadata)
    if (metadata?.semanticRole === role) return child
  }
  return null
}

function childMaterialColor(node: AnyNode | null, fallback: string) {
  const material = getRecord((node as { material?: unknown } | null)?.material)
  const properties = getRecord(material?.properties)
  return typeof properties?.color === 'string' ? properties.color : fallback
}

function childMaterialOpacity(node: AnyNode | null, fallback: number) {
  const material = getRecord((node as { material?: unknown } | null)?.material)
  const properties = getRecord(material?.properties)
  return typeof properties?.opacity === 'number' ? properties.opacity : fallback
}

export function SemanticEquipmentParamControls({ nodeId }: { nodeId: AnyNodeId }) {
  const assembly = useScene((state) => state.nodes[nodeId])
  const liquid = useScene((state) => findSemanticChild(state.nodes, nodeId, 'liquid_volume'))
  const shell = useScene((state) => findSemanticChild(state.nodes, nodeId, 'vessel_shell'))
  const dynamicLevelGeometry = useMemo(() => readDynamicLevelGeometry(assembly), [assembly])
  const equipment = useMemo(
    () =>
      readSemanticEquipmentAssembly(assembly) ??
      (dynamicLevelGeometry && liquid && shell
        ? {
            kind: 'semantic-assembly',
            recipeId: 'factory:storage-tank',
            equipmentFamily: 'tank',
          }
        : null),
    [assembly, dynamicLevelGeometry, liquid, shell],
  )
  const editableParams = equipment
    ? editableParamsFor(equipment, dynamicLevelGeometry, liquid, shell)
    : []
  const snapshot =
    equipment && assembly && editableParams.length
      ? {
          assembly,
          equipment,
          editableParams,
        }
      : null
  if (!snapshot) return null

  const params = readRecipeParams(snapshot.assembly, snapshot.equipment)

  const updateEditableParam = (param: SemanticRecipeEditableParam, rawValue: unknown) => {
    const scene = useScene.getState()
    const updates = buildSemanticEquipmentEditableParamUpdates({
      nodes: scene.nodes,
      assemblyId: nodeId,
      param,
      value: rawValue,
    })
    updates.forEach((update) => scene.updateNode(update.id, update.data))
  }

  const valueForParam = (param: SemanticRecipeEditableParam) => {
    if (params[param.key] !== undefined) return params[param.key]
    for (const effect of paramEffects(param)) {
      const key = effectParamKey(param, effect)
      if (effect.kind === 'set-param' && params[key] !== undefined) return params[key]
      if (effect.kind === 'set-part-material') {
        const child = findSemanticChild(useScene.getState().nodes, nodeId, effect.partRole)
        if (effect.property === 'color') return childMaterialColor(child, String(param.defaultValue ?? '#38bdf8'))
        if (effect.property === 'opacity') return childMaterialOpacity(child, numberValue(param.defaultValue, 1))
        const material = getRecord((child as { material?: unknown } | null)?.material)
        const properties = getRecord(material?.properties)
        if (properties?.[effect.property] !== undefined) return properties[effect.property]
      }
      if (effect.kind === 'set-part-dynamic-level') {
        const dynamicLevelGeometry = readDynamicLevelGeometry(assembly)
        const child = findSemanticChild(useScene.getState().nodes, nodeId, effect.partRole)
        const span =
          dynamicLevelGeometry?.kind === 'horizontal'
            ? dynamicLevelGeometry.length
            : dynamicLevelGeometry?.height
        const height = (child as { height?: unknown } | null)?.height
        if (span && span > 0 && typeof height === 'number') return clamp01(height / span)
      }
    }
    return param.defaultValue
  }

  const renderEditableParam = (param: SemanticRecipeEditableParam) => {
    const label = param.label ?? param.key
    const rawValue = valueForParam(param)
    if (param.kind === 'number') {
      const min = param.min ?? 0
      const max = param.max ?? 1
      const value = clampRange(numberValue(rawValue, numberValue(param.defaultValue, min)), min, max)
      return (
        <SliderControl
          key={param.key}
          label={label}
          max={max}
          min={min}
          onChange={(next) => updateEditableParam(param, clampRange(next, min, max))}
          precision={param.precision ?? 2}
          step={param.step ?? 0.01}
          unit={param.unit ?? ''}
          value={value}
        />
      )
    }
    if (param.kind === 'color') {
      const value = typeof rawValue === 'string' ? rawValue : String(param.defaultValue ?? '#38bdf8')
      return (
        <div className="px-2 pt-1" key={param.key}>
          <MaterialSwatchField
            label={label}
            value={{
              preset: 'custom',
              properties: {
                color: value,
                roughness: 0.24,
                metalness: 0.04,
                opacity: 1,
                transparent: false,
                side: 'front',
              },
            }}
            onChange={(material) => {
              const color = material.properties?.color
              if (color) updateEditableParam(param, color)
            }}
            onSelectMaterialPreset={(materialPreset) => {
              const color = getMaterialPresetByRef(materialPreset)?.mapProperties.color
              if (color) updateEditableParam(param, color)
            }}
          />
        </div>
      )
    }
    if (param.kind === 'boolean') {
      return (
        <ToggleControl
          checked={rawValue === true}
          key={param.key}
          label={label}
          onChange={(checked) => updateEditableParam(param, checked)}
        />
      )
    }
    if (param.kind === 'enum' && param.options?.length) {
      const options = param.options.map((option: string) => ({ label: option, value: option }))
      const fallback = param.options[0] ?? ''
      const value =
        typeof rawValue === 'string' && param.options.includes(rawValue)
          ? rawValue
          : fallback
      return (
        <div className="space-y-1 px-2" key={param.key}>
          <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
          <SegmentedControl
            onChange={(next) => updateEditableParam(param, next)}
            options={options}
            value={value}
          />
        </div>
      )
    }
    return null
  }

  return (
    <div className="space-y-1 pt-1" data-testid="semantic-inspector-equipment-params">
      <div className="px-2 pb-1 font-medium text-[11px] text-muted-foreground">
        Instance parameters
      </div>
      {snapshot.editableParams.map((param) => (
        <div data-testid={`semantic-inspector-equipment-param-${param.key}`} key={param.key}>
          {renderEditableParam(param)}
        </div>
      ))}
    </div>
  )
}
