'use client'

import {
  type AnyNode,
  type AnyNodeId,
  nodeRegistry,
  type ParamField,
  type ParametricDescriptor,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslations } from '../../../lib/i18n'
import { selectionMatchesSessionGroup } from '../../../lib/session-groups'
import useSessionGroups from '../../../store/use-session-groups'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { resolveUniqueSelectionIds } from './homogeneous-selection'
import {
  commitMultiNodeFields,
  fieldVisibleForAll,
  firstNumericFieldValue,
  firstVec3FieldValue,
  previewMultiNodeFields,
  reduceFieldValue,
} from './multi-field-value'
import { MultiHeightModeField } from './multi-height-mode'
import { MultiSelectionActions } from './multi-selection-panel'
import { getTypeDisplay } from './node-display'
import { ParametricFieldControl } from './parametric-field-control'
import { PanelWrapper } from './panel-wrapper'
import { formatSelectionBreakdown } from './selection-breakdown'

export function MultiParametricInspector({ footer }: { footer?: React.ReactNode }) {
  const t = useTranslations()
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const nodeIds = useScene(
    useShallow((s) => resolveUniqueSelectionIds(selectedIds, s.nodes)),
  )
  const nodeType = useScene((s) => {
    const first = nodeIds[0] ? s.nodes[nodeIds[0]] : undefined
    return first?.type ?? null
  })
  const breakdown = useScene((s) =>
    formatSelectionBreakdown(
      nodeIds.map((id) => s.nodes[id]?.type),
      t,
    ),
  )
  const sessionGroups = useSessionGroups((s) => s.groups)
  const matchedGroup = useMemo(
    () => selectionMatchesSessionGroup(sessionGroups, selectedIds),
    [sessionGroups, selectedIds],
  )

  const def = nodeType ? nodeRegistry.get(nodeType) : undefined
  const parametrics = def?.parametrics as ParametricDescriptor<AnyNode> | undefined

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  if (nodeIds.length < 2 || !nodeType || !parametrics) return null

  const display = getTypeDisplay(nodeType, t)
  const title = matchedGroup ? `${matchedGroup.label} · ${breakdown}` : breakdown || display.label

  return (
    <PanelWrapper footer={footer} icon={display.icon} onClose={handleClose} title={title} width={320}>
      {matchedGroup && (
        <div className="border-border/50 border-b px-3 py-2 text-muted-foreground text-xs">
          {matchedGroup.label} (session only). Plain click reselects all members. Not saved with the
          project.
        </div>
      )}
      {parametrics.groups.map((group, gi) => (
        <MultiGroupFields
          fields={group.fields as ParamField<AnyNode>[]}
          key={`group-${gi}`}
          nodeIds={nodeIds}
          nodeType={nodeType}
          parametrics={parametrics}
          title={group.label}
        />
      ))}
      <div className="border-border/50 border-t p-3">
        <MultiSelectionActions />
      </div>
    </PanelWrapper>
  )
}

function MultiGroupFields({
  title,
  fields,
  nodeIds,
  nodeType,
  parametrics,
}: {
  title: string
  fields: ParamField<AnyNode>[]
  nodeIds: AnyNodeId[]
  nodeType: AnyNode['type']
  parametrics: ParametricDescriptor<AnyNode>
}) {
  const genericFields = fields.filter((field) => field.kind !== 'custom')
  const anyVisible = useScene((s) =>
    genericFields.some((field) =>
      fieldVisibleForAll(nodeIds, (field as { visibleIf?: (n: AnyNode) => boolean }).visibleIf, s.nodes),
    ),
  )
  if (genericFields.length === 0 || !anyVisible) return null
  return (
    <PanelSection title={title}>
      {genericFields.map((field, fi) => {
        if (
          String(field.key) === 'height' &&
          (nodeType === 'wall' || nodeType === 'ceiling') &&
          field.kind === 'number'
        ) {
          return (
            <MultiHeightModeField
              key={`field-${fi}-height-mode`}
              max={field.max}
              min={field.min}
              nodeIds={nodeIds}
              nodeType={nodeType}
              parametrics={parametrics}
              step={field.step}
            />
          )
        }
        return (
          <MultiFieldRenderer
            field={field}
            key={`field-${fi}-${String(field.key)}`}
            nodeIds={nodeIds}
            parametrics={parametrics}
          />
        )
      })}
    </PanelSection>
  )
}

function MultiFieldRenderer({
  field,
  nodeIds,
  parametrics,
}: {
  field: ParamField<AnyNode>
  nodeIds: AnyNodeId[]
  parametrics: ParametricDescriptor<AnyNode>
}) {
  const key = String(field.key)
  const visible = useScene((s) =>
    fieldVisibleForAll(nodeIds, (field as { visibleIf?: (n: AnyNode) => boolean }).visibleIf, s.nodes),
  )
  const reduced = useScene(useShallow((s) => reduceFieldValue(nodeIds, key, s.nodes)))
  const numericOrigin = useScene((s) => firstNumericFieldValue(nodeIds, key, s.nodes))
  const vecOrigin = useScene(useShallow((s) => firstVec3FieldValue(nodeIds, key, s.nodes)))

  const preview = useCallback(
    (patch: Partial<AnyNode>) => {
      previewMultiNodeFields(nodeIds.map((id) => [id, patch] as const))
    },
    [nodeIds],
  )
  const commit = useCallback(
    (patch: Partial<AnyNode>) => {
      commitMultiNodeFields(nodeIds, () => patch, parametrics)
    },
    [nodeIds, parametrics],
  )

  if (!visible) return null

  if (field.kind === 'vec3') {
    return (
      <MultiVec3Field
        fieldKey={key}
        mixed={reduced.kind === 'mixed'}
        nodeIds={nodeIds}
        origin={vecOrigin}
        parametrics={parametrics}
        value={reduced.kind === 'same' && Array.isArray(reduced.value) ? (reduced.value as [number, number, number]) : vecOrigin}
      />
    )
  }

  const value =
    reduced.kind === 'same' ? reduced.value : field.kind === 'number' ? numericOrigin : undefined

  return (
    <ParametricFieldControl
      field={field}
      mixed={reduced.kind === 'mixed'}
      onChange={field.kind === 'number' ? preview : commit}
      onCommit={field.kind === 'number' ? commit : undefined}
      value={value}
    />
  )
}

function MultiVec3Field({
  fieldKey,
  mixed,
  nodeIds,
  origin,
  parametrics,
  value,
}: {
  fieldKey: string
  mixed: boolean
  nodeIds: AnyNodeId[]
  origin: [number, number, number]
  parametrics: ParametricDescriptor<AnyNode>
  value: [number, number, number]
}) {
  const axes: Array<{ label: string; index: 0 | 1 | 2 }> = [
    { label: 'X', index: 0 },
    { label: 'Y', index: 1 },
    { label: 'Z', index: 2 },
  ]
  return (
    <>
      {axes.map(({ label, index }) => {
        const axisValue = value[index] ?? origin[index] ?? 0
        const patchAxis = (next: number): Array<readonly [AnyNodeId, Partial<AnyNode>]> => {
          const nodes = useScene.getState().nodes
          return nodeIds.flatMap((id) => {
            const node = nodes[id]
            if (!node) return []
            const current = (node as Record<string, unknown>)[fieldKey]
            const nextVec = (
              Array.isArray(current) && current.length >= 3 ? [...current] : [...origin]
            ) as [number, number, number]
            nextVec[index] = next
            return [[id, { [fieldKey]: nextVec } as Partial<AnyNode>] as const]
          })
        }
        return (
          <SliderControl
            key={`${fieldKey}-${label}`}
            label={label}
            mixed={mixed}
            onChange={(next) => previewMultiNodeFields(patchAxis(next))}
            onCommit={(next) => {
              const entries = patchAxis(next)
              commitMultiNodeFields(
                nodeIds,
                (node) => entries.find(([id]) => id === node.id)?.[1] ?? {},
                parametrics,
              )
            }}
            precision={2}
            restoreOnCommit={false}
            step={0.05}
            unit="m"
            value={Math.round(axisValue * 100) / 100}
          />
        )
      })}
    </>
  )
}
