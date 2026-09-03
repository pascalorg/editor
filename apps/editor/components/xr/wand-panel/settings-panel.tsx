'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  getLevelDisplayName,
  getLibraryMaterialIdFromRef,
  getLibraryMaterialsVersion,
  getMaterialsForCategory,
  type LevelNode,
  MATERIAL_CATEGORIES,
  subscribeLibraryMaterials,
  toLibraryMaterialRef,
  useScene,
} from '@pascal-app/core'
import { commitParametricNodeFields, useEditor } from '@pascal-app/editor'
import { toggleXRPlayerMode, useViewer, useXRPlayerMode, XR_PLAYER_MODES } from '@pascal-app/viewer'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  collectXRSettingRows,
  createXRSettingPatch,
  readXRSettingValue,
  resolveXRSettingsContext,
  type XRSettingFieldRow,
  type XRSettingsContext,
} from '@/lib/xr/settings'
import { getPage } from './panel-layout'
import {
  PageArrows,
  PanelHeader,
  PanelHint,
  SettingChoice,
  SettingCycle,
  SettingStepper,
  SpatialButton,
} from './spatial-controls'
import { SpatialText } from './spatial-text'
import { XR_WAND_THEME } from './theme'

const ROWS_PER_PAGE = 5
const XR_COLORS = ['#888888', '#ffffff', '#18181b', '#ef4444', '#22c55e', '#3b82f6']

function cycleOption(options: readonly unknown[], current: unknown, direction: -1 | 1) {
  if (options.length === 0) return undefined
  const index = options.indexOf(current)
  const base = index < 0 ? (direction === 1 ? -1 : 0) : index
  return options[(base + direction + options.length) % options.length]
}

function formatValue(value: unknown) {
  if (typeof value === 'string') return value || 'None'
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  if (typeof value === 'number') return String(Number(value.toFixed(3)))
  return value == null ? 'None' : 'Assigned'
}

function FieldControl({
  context,
  materials,
  onChange,
  referenceNodes,
  row,
}: {
  context: XRSettingsContext
  materials: ReturnType<typeof getMaterialsForCategory>
  onChange: (row: XRSettingFieldRow, value: unknown) => void
  referenceNodes: AnyNode[]
  row: XRSettingFieldRow
}) {
  let value = readXRSettingValue(context, row)
  const name = `xr-setting-${String(row.field.key)}${row.axis == null ? '' : `-${row.axis}`}`

  if (row.field.kind === 'number' || row.field.kind === 'vec3') {
    const min = row.field.kind === 'number' ? (row.field.min ?? -1000) : -1000
    const max = row.field.kind === 'number' ? (row.field.max ?? 1000) : 1000
    const numericValue = Math.max(min, Math.min(max, typeof value === 'number' ? value : min))
    return (
      <SettingStepper
        label={row.label}
        max={max}
        min={min}
        name={name}
        onChange={(next) => onChange(row, next)}
        step={row.field.kind === 'number' ? (row.field.step ?? 0.1) : 0.1}
        unit={row.field.kind === 'number' ? row.field.unit : undefined}
        value={numericValue}
      />
    )
  }
  if (row.field.kind === 'boolean') {
    return (
      <SettingChoice
        label={row.label}
        name={name}
        onClick={() => onChange(row, value !== true)}
        value={value === true ? 'On' : 'Off'}
      />
    )
  }

  let options: readonly unknown[] = []
  let displayValue = formatValue(value)
  let mapValue = (next: unknown) => next
  if (row.field.kind === 'enum') options = row.field.options
  if (row.field.kind === 'color') options = XR_COLORS
  if (row.field.kind === 'material') {
    options = materials.map((material) => material.id)
    const selectedId = getLibraryMaterialIdFromRef(value as never)
    displayValue = materials.find((material) => material.id === selectedId)?.label ?? 'Default'
    mapValue = (next) => toLibraryMaterialRef(String(next))
    value = selectedId
  }
  if (row.field.kind === 'ref') {
    const refKind = row.field.refKind
    const references = referenceNodes.filter((node) => node.type === refKind)
    options = [null, ...references.map((node) => node.id)]
    const selected = references.find((node) => node.id === value)
    displayValue = selected
      ? String((selected as AnyNode & { name?: string }).name ?? selected.type)
      : 'None'
  }
  if (row.field.kind === 'custom') {
    return <SettingChoice label={row.label} name={name} value="Custom editor" />
  }

  const change = (direction: -1 | 1) => {
    const next = cycleOption(options, value, direction)
    if (next !== undefined) onChange(row, mapValue(next))
  }
  return (
    <SettingCycle
      label={row.label}
      name={name}
      next={() => change(1)}
      previous={() => change(-1)}
      value={displayValue}
    />
  )
}

function DefaultSettings() {
  const mode = useEditor((state) => state.mode)
  const playerMode = useXRPlayerMode((state) => state.mode)
  const gridSnapStep = useEditor((state) => state.gridSnapStep)
  const cycleGridSnapStep = useEditor((state) => state.cycleGridSnapStep)
  const selectedBuildingId = useViewer((state) => state.selection.buildingId)
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const setSelection = useViewer((state) => state.setSelection)
  const resolvedBuildingId = useScene((state) => {
    if (selectedBuildingId) return selectedBuildingId
    return (
      Object.values(state.nodes).find((node) => node?.type === 'building') as
        | BuildingNode
        | undefined
    )?.id
  })
  const levels = useScene(
    useShallow((state) => {
      const building = resolvedBuildingId ? state.nodes[resolvedBuildingId] : undefined
      if (building?.type !== 'building') return [] as LevelNode[]
      return building.children
        .map((id) => state.nodes[id])
        .filter((node): node is LevelNode => node?.type === 'level')
        .sort((a, b) => a.level - b.level)
    }),
  )
  const activeLevel = levels.find((level) => level.id === activeLevelId) ?? levels[0]
  const cycleFloor = () => {
    if (!activeLevel) return
    const index = levels.findIndex((level) => level.id === activeLevel.id)
    const next = levels[(index + 1) % levels.length]
    if (next) setSelection({ buildingId: resolvedBuildingId, levelId: next.id })
  }

  return (
    <>
      <group position={[0, 0.28, 0]}>
        <SettingChoice
          label="Floor"
          name="xr-setting-floor"
          onClick={levels.length ? cycleFloor : undefined}
          value={activeLevel ? getLevelDisplayName(activeLevel) : 'No floors'}
        />
      </group>
      <group position={[0, 0.16, 0]}>
        <SettingChoice label="Editor mode" name="xr-setting-editor-mode" value={mode} />
      </group>
      <group position={[0, 0.04, 0]}>
        <SettingChoice
          label="Grid snap"
          name="xr-setting-grid-snap"
          onClick={cycleGridSnapStep}
          value={`${gridSnapStep} m`}
        />
      </group>
      <group position={[0, -0.08, 0]}>
        <SettingChoice
          label="XR scale"
          name="xr-setting-player-mode"
          onClick={toggleXRPlayerMode}
          value={playerMode === XR_PLAYER_MODES.GOD ? 'God' : 'Human'}
        />
      </group>
      <PanelHint position={[0, -0.22, 0.012]}>Select an item or choose a build tool.</PanelHint>
    </>
  )
}

export function XRSettingsPanel() {
  const [pagination, setPagination] = useState({ key: '', page: 0 })
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const toolDefaults = useEditor((state) =>
    state.tool ? state.toolDefaults[state.tool] : undefined,
  )
  const setToolDefaults = useEditor((state) => state.setToolDefaults)
  const selectedId = useViewer((state) =>
    state.selection.selectedIds.length === 1 ? state.selection.selectedIds[0] : undefined,
  )
  const selectedNode = useScene((state) =>
    selectedId ? state.nodes[selectedId as AnyNodeId] : undefined,
  )
  const nodes = useScene((state) => state.nodes)
  const materialVersion = useSyncExternalStore(
    subscribeLibraryMaterials,
    getLibraryMaterialsVersion,
    getLibraryMaterialsVersion,
  )
  const materials = useMemo(() => {
    void materialVersion
    return MATERIAL_CATEGORIES.flatMap((category) => getMaterialsForCategory(category))
  }, [materialVersion])
  const referenceNodes = useMemo(() => Object.values(nodes).filter(Boolean) as AnyNode[], [nodes])
  const context = useMemo(
    () => resolveXRSettingsContext({ mode, selectedNode, tool, toolDefaults }),
    [mode, selectedNode, tool, toolDefaults],
  )
  const rows = useMemo(() => (context ? collectXRSettingRows(context) : []), [context])
  const contextKey = context?.key ?? 'default'
  const page = pagination.key === contextKey ? pagination.page : 0
  const current = getPage(rows, page, ROWS_PER_PAGE)
  const setPage = (nextPage: number) => setPagination({ key: contextKey, page: nextPage })

  const update = (row: XRSettingFieldRow, value: unknown) => {
    if (!context) return
    const patch = createXRSettingPatch(context, row, value)
    if (context.source === 'node') {
      commitParametricNodeFields(context.node.id as AnyNodeId, patch)
    } else if (context.tool) {
      setToolDefaults(context.tool, { ...toolDefaults, ...patch })
    }
  }

  return (
    <group name="xr-wand-settings-panel">
      <PanelHeader
        mark={context ? `${rows.length} controls` : 'selection-aware'}
        title={context?.title ?? 'Settings'}
      />
      {!context ? (
        <DefaultSettings />
      ) : (
        <>
          {current.items.map((row, index) => (
            <group key={row.id} position={[0, 0.29 - index * 0.125, 0]}>
              {row.kind === 'field' ? (
                <FieldControl
                  context={context}
                  materials={materials}
                  onChange={update}
                  referenceNodes={referenceNodes}
                  row={row}
                />
              ) : (
                <SpatialButton
                  disabled={row.action.enabledIf ? !row.action.enabledIf(context.node) : false}
                  name={`xr-setting-action-${row.id}`}
                  onClick={() =>
                    row.action.onClick(
                      useScene.getState().nodes[context.node.id as AnyNodeId] as AnyNode,
                    )
                  }
                  position={[0, 0, 0]}
                  size={[0.7, 0.075]}
                >
                  <SpatialText
                    anchorX="center"
                    anchorY="middle"
                    color={XR_WAND_THEME.text}
                    fontSize={0.021}
                    position={[0, 0, 0.012]}
                  >
                    {row.label}
                  </SpatialText>
                </SpatialButton>
              )}
            </group>
          ))}
          {rows.length === 0 && (
            <PanelHint>No spatial settings are exposed for this item yet.</PanelHint>
          )}
          {current.pageCount > 1 && (
            <PageArrows
              name="xr-settings"
              onChange={setPage}
              page={current.currentPage}
              pageCount={current.pageCount}
            />
          )}
        </>
      )}
    </group>
  )
}
