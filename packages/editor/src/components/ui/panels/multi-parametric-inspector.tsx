'use client'

import {
  type AnyNode,
  type AnyNodeId,
  nodeRegistry,
  type ParamField,
  type ParametricDescriptor,
  useScene, usePascalI18n,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { getNodePanelModel, type MultiPanelControl } from '../../../lib/panel-rows'
import { selectionMatchesSessionGroup } from '../../../lib/session-groups'
import useSessionGroups from '../../../store/use-session-groups'
import { PanelSection } from '../controls/panel-section'
import { SegmentedControl } from '../controls/segmented-control'
import { SelectControl } from '../controls/select-control'
import { SliderControl } from '../controls/slider-control'
import { resolveUniqueSelectionIds } from './homogeneous-selection'
import {
  commitMultiNodeFields,
  fieldTargetIds,
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
import { inspectorGroupDescriptor } from '../../../i18n/node-messages'

export function MultiParametricInspector({ footer }: { footer?: React.ReactNode }) {
  const i18n = usePascalI18n()
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
    formatSelectionBreakdown(nodeIds.map((id) => s.nodes[id]?.type)),
  )
  const sessionGroups = useSessionGroups((s) => s.groups)
  const matchedGroup = useMemo(
    () => selectionMatchesSessionGroup(sessionGroups, selectedIds),
    [sessionGroups, selectedIds],
  )

  const def = nodeType ? nodeRegistry.get(nodeType) : undefined
  const parametrics = def?.parametrics as ParametricDescriptor<AnyNode> | undefined
  const hasKindControls = !!getNodePanelModel(def)?.multiControls

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  if (nodeIds.length < 2 || !nodeType || !parametrics) return null

  const display = getTypeDisplay(nodeType, i18n)
  const title = matchedGroup ? `${matchedGroup.label} · ${breakdown}` : breakdown || display.label

  return (
    <PanelWrapper footer={footer} icon={display.icon} onClose={handleClose} title={title} width={320}>
      {matchedGroup && (
        <div className="border-border/50 border-b px-3 py-2 text-muted-foreground text-xs">
          {i18n._({ id: 'editor.panels.multiParametricInspector.labelSessionOnlyPlainClickReselects', message: '{label} (session only). Plain click reselects all members. Not saved with the project.', values: { label: matchedGroup.label } })}</div>
      )}
      {parametrics.groups.map((group, gi) => (
        <MultiGroupFields
          defaultExpanded={group.defaultExpanded}
          fields={group.fields as ParamField<AnyNode>[]}
          key={`${nodeType}-${group.label}-${gi}`}
          nodeIds={nodeIds}
          nodeType={nodeType}
          parametrics={parametrics}
          title={i18n._(inspectorGroupDescriptor(group.label))}
        >
          {hasKindControls ? (
            <MultiKindControls nodeIds={nodeIds} nodeType={nodeType} section={group.label} />
          ) : null}
        </MultiGroupFields>
      ))}
      {hasKindControls ? (
        <MultiKindSections
          groupTitles={parametrics.groups.map((group) => group.label)}
          nodeIds={nodeIds}
          nodeType={nodeType}
        />
      ) : null}
      <div className="border-border/50 border-t p-3">
        <MultiSelectionActions />
      </div>
    </PanelWrapper>
  )
}

function useMultiKindControls(nodeIds: AnyNodeId[], nodeType: AnyNode['type']) {
  const nodes = useScene((s) => s.nodes)
  return useMemo(() => {
    const model = getNodePanelModel(nodeRegistry.get(nodeType))
    if (!model?.multiControls) return []
    const selection = nodeIds.flatMap((id) => (nodes[id] ? [nodes[id]!] : []))
    return model.multiControls({ selection, nodes })
  }, [nodeIds, nodeType, nodes])
}

/**
 * The kind's own multi-selection controls for one section (the wall's
 * Reference), from its panel model — the same control the single panel
 * shows, mixed when the selection disagrees.
 */
function MultiKindControls({
  nodeIds,
  nodeType,
  section,
}: {
  nodeIds: AnyNodeId[]
  nodeType: AnyNode['type']
  section: string
}) {
  const controls = useMultiKindControls(nodeIds, nodeType).filter(
    (control) => control.section === section,
  )
  return (
    <>
      {controls.map((control) => (
        <MultiKindControlView control={control} key={control.id} />
      ))}
    </>
  )
}

/** The kind's controls whose section is none of the parametrics groups, each section its own. */
function MultiKindSections({
  groupTitles,
  nodeIds,
  nodeType,
}: {
  groupTitles: readonly string[]
  nodeIds: AnyNodeId[]
  nodeType: AnyNode['type']
}) {
  const controls = useMultiKindControls(nodeIds, nodeType).filter(
    (control) => !groupTitles.includes(control.section),
  )
  const sections = [...new Set(controls.map((control) => control.section))]
  return (
    <>
      {sections.map((section) => (
        <PanelSection key={section} title={section}>
          {controls
            .filter((control) => control.section === section)
            .map((control) => (
              <MultiKindControlView control={control} key={control.id} />
            ))}
        </PanelSection>
      ))}
    </>
  )
}

function MultiKindControlView({ control }: { control: MultiPanelControl }) {
  if (control.kind === 'readout') {
    return (
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
          {control.label}
        </span>
        <span className="truncate text-[11px] text-muted-foreground tabular-nums">
          {control.detail ? `${control.value} · ${control.detail}` : control.value}
        </span>
      </div>
    )
  }
  if (control.kind === 'select') {
    return (
      <SelectControl
        label={control.label}
        mixed={control.value === null}
        onChange={control.onChange}
        options={control.options.map((option) => ({ ...option }))}
        value={control.value ?? ''}
      />
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="px-1 font-medium text-[10px] text-muted-foreground/80">{control.label}</div>
      <SegmentedControl
        mixed={control.value === null}
        onChange={control.onChange}
        options={control.options.map((option) => ({ ...option }))}
        value={control.value ?? ''}
      />
    </div>
  )
}

function MultiGroupFields({
  defaultExpanded,
  title,
  fields,
  nodeIds,
  nodeType,
  parametrics,
  children,
}: {
  children?: React.ReactNode
  defaultExpanded?: boolean
  title: string
  fields: ParamField<AnyNode>[]
  nodeIds: AnyNodeId[]
  nodeType: AnyNode['type']
  parametrics: ParametricDescriptor<AnyNode>
}) {
  const genericFields = fields.filter((field) => field.kind !== 'custom')
  const anyVisible = useScene((s) =>
    genericFields.some((field) => {
      const { visibleIf, appliesTo } = field as {
        visibleIf?: (n: AnyNode) => boolean
        appliesTo?: (n: AnyNode) => boolean
      }
      return (
        fieldVisibleForAll(nodeIds, visibleIf, s.nodes) &&
        fieldTargetIds(nodeIds, appliesTo, s.nodes).length > 0
      )
    }),
  )
  if ((genericFields.length === 0 || !anyVisible) && !children) return null
  return (
    <PanelSection defaultExpanded={defaultExpanded} title={title}>
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
      {children}
    </PanelSection>
  )
}

function MultiFieldRenderer({
  field,
  nodeIds: selectedIds,
  parametrics,
}: {
  field: ParamField<AnyNode>
  nodeIds: AnyNodeId[]
  parametrics: ParametricDescriptor<AnyNode>
}) {
  const key = String(field.key)
  // A field that names the nodes it `appliesTo` reads and edits only those.
  const appliesTo = (field as { appliesTo?: (n: AnyNode) => boolean }).appliesTo
  const nodeIds = useScene(
    useShallow((s) => fieldTargetIds(selectedIds, appliesTo, s.nodes)),
  )
  const visible = useScene((s) =>
    fieldVisibleForAll(nodeIds, (field as { visibleIf?: (n: AnyNode) => boolean }).visibleIf, s.nodes),
  )
  const fallback = field.kind === 'number' ? field.default : undefined
  const reduced = useScene(
    useShallow((s) => reduceFieldValue(nodeIds, key, s.nodes, fallback)),
  )
  const numericOrigin = useScene((s) =>
    firstNumericFieldValue(nodeIds, key, s.nodes, fallback ?? 0),
  )
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

  if (!visible || nodeIds.length === 0) return null

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
            value={axisValue}
          />
        )
      })}
    </>
  )
}
