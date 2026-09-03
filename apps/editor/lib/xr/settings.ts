import {
  type AnyNode,
  type AnyNodeDefinition,
  type AnyNodeId,
  nodeRegistry,
  type ParamAction,
  type ParametricDescriptor,
  type ParamField,
  type ToolHint,
} from '@pascal-app/core'

export type XRSettingsContext = {
  definition: AnyNodeDefinition
  key: string
  node: AnyNode
  source: 'node' | 'tool'
  title: string
  tool?: string
}

export type XRSettingFieldRow = {
  axis?: number
  field: ParamField<AnyNode>
  group: string
  id: string
  kind: 'field'
  label: string
}

export type XRSettingActionRow = {
  action: ParamAction<AnyNode>
  id: string
  kind: 'action'
  label: string
}

export type XRSettingToolChipRow = {
  hint: ToolHint & { chip: NonNullable<ToolHint['chip']> }
  id: string
  kind: 'tool-chip'
  label: string
}

export type XRSettingRow = XRSettingActionRow | XRSettingFieldRow | XRSettingToolChipRow

type ResolveXRSettingsContextInput = {
  mode: string
  selectedNode?: AnyNode
  tool: string | null
  toolDefaults?: Readonly<Record<string, unknown>>
}

export function resolveXRSettingsContext({
  mode,
  selectedNode,
  tool,
  toolDefaults,
}: ResolveXRSettingsContextInput): XRSettingsContext | null {
  if (selectedNode) {
    const definition = nodeRegistry.get(selectedNode.type)
    if (!definition) return null
    return {
      definition,
      key: `node:${selectedNode.id}`,
      node: selectedNode,
      source: 'node',
      title: definition.presentation?.label ?? selectedNode.type,
    }
  }

  if (mode !== 'build' || !tool) return null
  const definition = nodeRegistry.get(tool)
  if (!definition) return null
  const defaults = definition.defaults() as Record<string, unknown>
  const node = {
    ...defaults,
    ...toolDefaults,
    id: `xr-tool-default:${tool}` as AnyNodeId,
    type: tool,
  } as AnyNode
  return {
    definition,
    key: `tool:${tool}`,
    node,
    source: 'tool',
    title: `${definition.presentation?.label ?? tool} defaults`,
    tool,
  }
}

export function collectXRSettingRows(context: XRSettingsContext): XRSettingRow[] {
  const parametrics = context.definition.parametrics as ParametricDescriptor<AnyNode> | undefined
  const rows: XRSettingRow[] = []

  if (context.source === 'tool') {
    context.definition.toolHints?.forEach((hint, index) => {
      if (!hint.chip || (hint.visible && !hint.visible.value())) return
      rows.push({
        hint: hint as ToolHint & { chip: NonNullable<ToolHint['chip']> },
        id: `tool-chip-${index}-${hint.label}`,
        kind: 'tool-chip',
        label: hint.label,
      })
    })
  }

  if (!parametrics) return rows

  parametrics.groups.forEach((group, groupIndex) => {
    group.fields.forEach((rawField, fieldIndex) => {
      const field = rawField as ParamField<AnyNode>
      if (field.visibleIf) {
        try {
          if (!field.visibleIf(context.node)) return
        } catch {
          return
        }
      }
      const label = field.label ?? String(field.key)
      const id = `${groupIndex}-${fieldIndex}-${String(field.key)}`
      if (field.kind === 'vec3') {
        for (let axis = 0; axis < 3; axis += 1) {
          rows.push({
            axis,
            field,
            group: group.label,
            id: `${id}-${axis}`,
            kind: 'field',
            label: `${label} ${'XYZ'[axis]}`,
          })
        }
        return
      }
      rows.push({ field, group: group.label, id, kind: 'field', label })
    })
  })

  if (context.source === 'node') {
    parametrics.actions?.forEach((action, index) => {
      rows.push({
        action: action as ParamAction<AnyNode>,
        id: `action-${index}-${action.label}`,
        kind: 'action',
        label: action.label,
      })
    })
  }

  return rows
}

export function readXRSettingValue(context: XRSettingsContext, row: XRSettingFieldRow): unknown {
  const value = (context.node as unknown as Record<string, unknown>)[String(row.field.key)]
  if (row.field.kind !== 'vec3') return value
  return Array.isArray(value) ? value[row.axis ?? 0] : undefined
}

export function createXRSettingPatch(
  context: XRSettingsContext,
  row: XRSettingFieldRow,
  value: unknown,
): Record<string, unknown> {
  const key = String(row.field.key)
  let patch: Record<string, unknown>
  if (row.field.kind === 'vec3') {
    const current = (context.node as unknown as Record<string, unknown>)[key]
    const vector = Array.isArray(current) ? [...current] : [0, 0, 0]
    vector[row.axis ?? 0] = value
    patch = { [key]: vector }
  } else {
    patch = { [key]: value }
  }

  if (context.source !== 'tool') return patch
  const parametrics = context.definition.parametrics as ParametricDescriptor<AnyNode> | undefined
  if (!parametrics?.derive) return patch
  const next = { ...context.node, ...patch } as AnyNode
  return {
    ...patch,
    ...parametrics.derive(next, patch as Partial<AnyNode>, context.node),
  }
}
