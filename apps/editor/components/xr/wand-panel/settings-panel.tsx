'use client'

import {
  type AnyNode,
  type AnyNodeId,
  nodeRegistry,
  type ParamAction,
  type ParamField,
  useScene,
} from '@pascal-app/core'
import { commitParametricNodeFields, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useMemo, useState } from 'react'
import { getPage } from './panel-layout'
import {
  PanelHeader,
  PanelHint,
  SettingChoice,
  SettingStepper,
  SpatialButton,
} from './spatial-controls'
import { SpatialText } from './spatial-text'
import { XR_WAND_THEME } from './theme'

const ROWS_PER_PAGE = 4

type FieldRow = {
  axis?: number
  field: ParamField<AnyNode>
  id: string
  label: string
}

function fieldRows(node: AnyNode): FieldRow[] {
  const parametrics = nodeRegistry.get(node.type)?.parametrics
  if (!parametrics) return []
  const rows: FieldRow[] = []
  for (const group of parametrics.groups) {
    for (const rawField of group.fields) {
      const field = rawField as ParamField<AnyNode>
      if (field.visibleIf && !field.visibleIf(node)) continue
      const label = field.label ?? String(field.key)
      if (field.kind === 'vec3') {
        for (let axis = 0; axis < 3; axis += 1) {
          rows.push({
            axis,
            field,
            id: `${String(field.key)}-${axis}`,
            label: `${label} ${'XYZ'[axis]}`,
          })
        }
      } else {
        rows.push({ field, id: String(field.key), label })
      }
    }
  }
  return rows
}

function formatReadout(value: unknown, field: ParamField<AnyNode>) {
  if (field.kind === 'custom') return 'Desktop control'
  if (field.kind === 'material') return value ? 'Assigned' : 'Default'
  if (field.kind === 'ref') return typeof value === 'string' ? value.slice(0, 12) : 'None'
  if (field.kind === 'color') return typeof value === 'string' ? value.toUpperCase() : 'Default'
  return String(value ?? '—')
}

function FieldControl({ node, row }: { node: AnyNode; row: FieldRow }) {
  const key = String(row.field.key)
  const rawValue = (node as unknown as Record<string, unknown>)[key]
  if (row.field.kind === 'number') {
    const value = typeof rawValue === 'number' ? rawValue : 0
    return (
      <SettingStepper
        label={row.label}
        max={row.field.max ?? 1000}
        min={row.field.min ?? -1000}
        onChange={(next) => commitParametricNodeFields(node.id as AnyNodeId, { [key]: next })}
        step={row.field.step ?? 0.1}
        unit={row.field.unit}
        value={value}
      />
    )
  }
  if (row.field.kind === 'vec3') {
    const axis = row.axis ?? 0
    const vector = Array.isArray(rawValue) ? [...rawValue] : [0, 0, 0]
    const value = typeof vector[axis] === 'number' ? vector[axis] : 0
    return (
      <SettingStepper
        label={row.label}
        max={1000}
        min={-1000}
        onChange={(next) => {
          vector[axis] = next
          commitParametricNodeFields(node.id as AnyNodeId, { [key]: vector })
        }}
        step={0.1}
        value={value}
      />
    )
  }
  if (row.field.kind === 'boolean') {
    return (
      <SettingChoice
        label={row.label}
        onClick={() => commitParametricNodeFields(node.id as AnyNodeId, { [key]: !rawValue })}
        value={rawValue ? 'On' : 'Off'}
      />
    )
  }
  if (row.field.kind === 'enum') {
    const index = row.field.options.indexOf(String(rawValue))
    const next = row.field.options[(index + 1) % row.field.options.length]
    return (
      <SettingChoice
        label={row.label}
        onClick={() => commitParametricNodeFields(node.id as AnyNodeId, { [key]: next })}
        value={String(rawValue ?? row.field.options[0] ?? '—')}
      />
    )
  }
  return <SettingChoice label={row.label} value={formatReadout(rawValue, row.field)} />
}

function DefaultSettings() {
  const mode = useEditor((state) => state.mode)
  const gridSnapStep = useEditor((state) => state.gridSnapStep)
  const cycleGridSnapStep = useEditor((state) => state.cycleGridSnapStep)
  return (
    <>
      <group position={[0, 0.2, 0]}>
        <SettingChoice label="Editor mode" value={mode} />
      </group>
      <group position={[0, 0.09, 0]}>
        <SettingChoice label="Grid snap" onClick={cycleGridSnapStep} value={`${gridSnapStep} m`} />
      </group>
      <PanelHint>Select one scene item to edit its registry settings here.</PanelHint>
    </>
  )
}

export function XRSettingsPanel() {
  const [page, setPage] = useState(0)
  const selectedId = useViewer((state) =>
    state.selection.selectedIds.length === 1
      ? (state.selection.selectedIds[0] as AnyNodeId | undefined)
      : undefined,
  )
  const node = useScene((state) => (selectedId ? state.nodes[selectedId] : undefined))
  const rows = useMemo(() => (node ? fieldRows(node) : []), [node])
  const current = getPage(rows, page, ROWS_PER_PAGE)
  const definition = node ? nodeRegistry.get(node.type) : undefined
  const actions = (definition?.parametrics?.actions ?? []) as ParamAction<AnyNode>[]

  return (
    <group name="xr-wand-settings-panel">
      <PanelHeader
        mark={node ? `${rows.length} settings` : 'selection-aware'}
        title={node ? (definition?.presentation?.label ?? node.type) : 'Settings'}
      />
      {!node ? (
        <DefaultSettings />
      ) : (
        <>
          {current.items.map((row, index) => (
            <group key={row.id} position={[0, 0.28 - index * 0.115, 0]}>
              <FieldControl node={node} row={row} />
            </group>
          ))}
          {rows.length === 0 && (
            <PanelHint>
              This item uses a custom desktop inspector. Select another item or use the editor
              panel.
            </PanelHint>
          )}
          <group position={[0, -0.27, 0]}>
            {actions.slice(0, 2).map((action, index) => (
              <SpatialButton
                disabled={action.enabledIf ? !action.enabledIf(node) : false}
                key={action.label}
                onClick={() =>
                  action.onClick(useScene.getState().nodes[node.id as AnyNodeId] as AnyNode)
                }
                position={[-0.18 + index * 0.36, 0, 0]}
                size={[0.32, 0.07]}
              >
                <SpatialText
                  anchorX="center"
                  anchorY="middle"
                  color={XR_WAND_THEME.text}
                  fontSize={0.019}
                  maxWidth={0.29}
                  position={[0, 0, 0.012]}
                >
                  {action.label}
                </SpatialText>
              </SpatialButton>
            ))}
          </group>
          {current.pageCount > 1 && (
            <group position={[0, -0.35, 0]}>
              <SpatialButton
                disabled={current.currentPage === 0}
                onClick={() => setPage(current.currentPage - 1)}
                position={[-0.16, 0, 0]}
                size={[0.08, 0.055]}
              >
                <SpatialText
                  anchorX="center"
                  anchorY="middle"
                  color={XR_WAND_THEME.text}
                  fontSize={0.027}
                  position={[0, 0, 0.012]}
                >
                  ‹
                </SpatialText>
              </SpatialButton>
              <SpatialText
                anchorX="center"
                anchorY="middle"
                color={XR_WAND_THEME.muted}
                fontSize={0.019}
                position={[0, 0, 0.012]}
              >
                {current.currentPage + 1}/{current.pageCount}
              </SpatialText>
              <SpatialButton
                disabled={current.currentPage >= current.pageCount - 1}
                onClick={() => setPage(current.currentPage + 1)}
                position={[0.16, 0, 0]}
                size={[0.08, 0.055]}
              >
                <SpatialText
                  anchorX="center"
                  anchorY="middle"
                  color={XR_WAND_THEME.text}
                  fontSize={0.027}
                  position={[0, 0, 0.012]}
                >
                  ›
                </SpatialText>
              </SpatialButton>
            </group>
          )}
        </>
      )}
    </group>
  )
}
