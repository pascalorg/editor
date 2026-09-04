'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  DEFAULT_LEVEL_HEIGHT,
  getLevelDisplayName,
  getLibraryMaterialIdFromRef,
  getLibraryMaterialsVersion,
  getMaterialsForCategory,
  LevelNode,
  MATERIAL_CATEGORIES,
  type ParamAction,
  type RoofNode,
  RoofType as RoofTypeSchema,
  subscribeLibraryMaterials,
  toLibraryMaterialRef,
  useRegistryVersion,
  useScene,
} from '@pascal-app/core'
import {
  commitParametricNodeFields,
  cycleSnappingModeIn,
  emitDeleteSFX,
  getHistoryCommandState,
  getSnappingModeLabel,
  runRedo,
  runUndo,
  subscribeHistoryCommandState,
  triggerSFX,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import {
  requestGodScaleReset,
  toggleXRPlayerMode,
  useViewer,
  useXRPlayerMode,
  XR_PLAYER_MODES,
} from '@pascal-app/viewer'
import { useMemo, useSyncExternalStore } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  activateRoofFeatureTool,
  activateRoofFootprintSource,
  collectRoofFeatures,
} from '@/lib/build-palette'
import { getRoofFootprintSources } from '@/lib/build-tab-state'
import {
  collectXRSettingRows,
  createXRSettingPatch,
  readXRSettingValue,
  resolveXRSettingsContext,
  type XRSettingActionRow,
  type XRSettingFieldRow,
  type XRSettingRow,
  type XRSettingsContext,
  type XRSettingToolChipRow,
} from '@/lib/xr/settings'
import {
  useXRWandPanelSettings,
  XR_WAND_PANEL_SCALE_MAX,
  XR_WAND_PANEL_SCALE_MIN,
  XR_WAND_PANEL_SCALE_STEP,
} from '@/lib/xr/wand-panel-settings'
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
import { XRTerrainSettingsPanel } from './terrain-settings-panel'
import { XR_WAND_THEME } from './theme'

const ROWS_PER_PAGE = 5
const DEFAULT_SETTINGS_CONTEXT_KEY = 'default-settings'
const DEFAULT_SETTINGS_PAGES = 2
const XR_COLORS = ['#888888', '#ffffff', '#18181b', '#ef4444', '#22c55e', '#3b82f6']

function collectRoofActionRows(node: AnyNode): XRSettingActionRow[] {
  if (node.type !== 'roof' && node.type !== 'roof-segment') return []
  const roofType = node.type === 'roof-segment' ? node.roofType : 'gable'
  const rows: XRSettingActionRow[] = getRoofFootprintSources(roofType).map((source) => ({
    action: {
      label: source.value === 'draw' ? 'Draw Footprint' : `Create from ${source.label}`,
      onClick: () => activateRoofFootprintSource(source.value),
    } satisfies ParamAction<AnyNode>,
    id: `roof-source-${source.value}`,
    kind: 'action',
    label: source.value === 'draw' ? 'Draw Footprint' : `Create from ${source.label}`,
  }))

  rows.push({
    action: {
      label: 'Draw Segment',
      onClick: () => {
        triggerSFX('sfx:item-pick')
        const editor = useEditor.getState()
        editor.setTool('roof')
        if (editor.mode !== 'build') editor.setMode('build')
      },
    } satisfies ParamAction<AnyNode>,
    id: 'roof-draw-segment',
    kind: 'action',
    label: 'Draw Segment',
  })

  for (const feature of collectRoofFeatures()) {
    rows.push({
      action: {
        label: `Add ${feature.label}`,
        onClick: () => activateRoofFeatureTool(feature),
      } satisfies ParamAction<AnyNode>,
      id: `roof-feature-${feature.id}`,
      kind: 'action',
      label: `Add ${feature.label}`,
    })
  }

  return rows
}

type RoofSpatialAction = {
  id: string
  label: string
  onClick: () => void
}

function RoofSpatialSettings({ roof }: { roof: RoofNode }) {
  const setSelection = useViewer((state) => state.setSelection)
  const setTool = useEditor((state) => state.setTool)
  const setMode = useEditor((state) => state.setMode)
  const roofDefaults = useEditor((state) => state.toolDefaults.roof)
  const registryVersion = useRegistryVersion()
  const parsedRoofType = RoofTypeSchema.safeParse(roofDefaults?.roofType)
  const roofType = parsedRoofType.success ? parsedRoofType.data : 'gable'
  const actionIds = useScene(
    useShallow((state) => {
      const segmentIds = (roof.children ?? []).filter(
        (id) => state.nodes[id as AnyNodeId]?.type === 'roof-segment',
      )
      const segmentIdSet = new Set<string>(segmentIds)
      const accessoryIds = Object.values(state.nodes)
        .filter((node) => node?.parentId && segmentIdSet.has(node.parentId as AnyNodeId))
        .map((node) => node!.id)
      return [...segmentIds, ...accessoryIds]
    }),
  )
  const actions = useMemo<RoofSpatialAction[]>(() => {
    const nodes = useScene.getState().nodes
    let segmentIndex = 0
    return actionIds.flatMap((id) => {
      const node = nodes[id as AnyNodeId]
      if (!node) return []
      if (node.type === 'roof-segment') {
        segmentIndex += 1
        return [
          {
            id: `segment-${node.id}`,
            label: `Segment ${segmentIndex}: ${node.roofType}`,
            onClick: () => setSelection({ selectedIds: [node.id as AnyNodeId] }),
          },
        ]
      }
      return [
        {
          id: `accessory-${node.id}`,
          label: `${node.name || node.type}`,
          onClick: () => setSelection({ selectedIds: [node.id as AnyNodeId] }),
        },
      ]
    })
  }, [actionIds, setSelection])
  const paginationKey = useXRWandPanelSettings((state) => state.settingsContextKey)
  const paginationPage = useXRWandPanelSettings((state) => state.settingsPage)
  const setSettingsNavigation = useXRWandPanelSettings((state) => state.setSettingsNavigation)
  const rows = useMemo<RoofSpatialAction[]>(() => {
    void registryVersion
    return [
      ...getRoofFootprintSources(roofType).map((source) => ({
        id: `draw-from-${source.value}`,
        label: source.value === 'draw' ? 'Draw Footprint' : `Create from ${source.label}`,
        onClick: () => activateRoofFootprintSource(source.value),
      })),
      {
        id: 'draw-segment',
        label: 'Draw Segment',
        onClick: () => {
          triggerSFX('sfx:item-pick')
          setTool('roof')
          if (useEditor.getState().mode !== 'build') setMode('build')
        },
      },
      ...actions,
      ...collectRoofFeatures().map((feature) => ({
        id: `add-${feature.id}`,
        label: `Add ${feature.label}`,
        onClick: () => {
          activateRoofFeatureTool(feature)
        },
      })),
    ]
  }, [actions, registryVersion, roofType, setMode, setTool])
  const contextKey = `node:${roof.id}:roof-actions`
  const page = paginationKey === contextKey ? paginationPage : 0
  const current = getPage(rows, page, ROWS_PER_PAGE)

  return (
    <>
      {current.items.map((row, index) => (
        <group key={row.id} position={[0, 0.29 - index * 0.125, 0]}>
          <SpatialButton
            name={`xr-roof-${row.id}`}
            onClick={row.onClick}
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
        </group>
      ))}
      <PageArrows
        name="xr-roof-actions"
        onChange={(nextPage) => setSettingsNavigation(contextKey, nextPage)}
        page={current.currentPage}
        pageCount={current.pageCount}
      />
    </>
  )
}

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

function ToolChipControl({ row }: { row: XRSettingToolChipRow }) {
  const { chip } = row.hint
  const value = useSyncExternalStore(chip.subscribe, chip.value, chip.value)
  return (
    <SettingChoice
      label={row.label}
      name={`xr-setting-${row.id}`}
      onClick={chip.cycle}
      value={chip.labels[value] ?? value}
    />
  )
}

function DefaultSettings() {
  const mode = useEditor((state) => state.mode)
  const interactionIdle = useInteractionScope((state) => state.scope.kind === 'idle')
  const playerMode = useXRPlayerMode((state) => state.mode)
  const panelScale = useXRWandPanelSettings((state) => state.panelScale)
  const setPanelScale = useXRWandPanelSettings((state) => state.setPanelScale)
  const gridSnapStep = useEditor((state) => state.gridSnapStep)
  const cycleGridSnapStep = useEditor((state) => state.cycleGridSnapStep)
  const wallSnappingMode = useEditor((state) => state.snappingModeByContext.wall)
  const setSnappingMode = useEditor((state) => state.setSnappingMode)
  const selectedBuildingId = useViewer((state) => state.selection.buildingId)
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const setSelection = useViewer((state) => state.setSelection)
  const createNode = useScene((state) => state.createNode)
  const deleteNode = useScene((state) => state.deleteNode)
  const settingsPage = useXRWandPanelSettings((state) => state.settingsPage)
  const settingsContextKey = useXRWandPanelSettings((state) => state.settingsContextKey)
  const setSettingsNavigation = useXRWandPanelSettings((state) => state.setSettingsNavigation)
  const canUndo = useSyncExternalStore(
    subscribeHistoryCommandState,
    () => getHistoryCommandState().canUndo,
    () => false,
  )
  const canRedo = useSyncExternalStore(
    subscribeHistoryCommandState,
    () => getHistoryCommandState().canRedo,
    () => false,
  )
  const resolvedBuildingId = useScene((state) => {
    if (selectedBuildingId && state.nodes[selectedBuildingId]?.type === 'building') {
      return selectedBuildingId
    }
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

  const addFloor = () => {
    if (!resolvedBuildingId) return
    const level = levels.length === 0 ? 0 : Math.max(...levels.map((entry) => entry.level)) + 1
    const newLevel = LevelNode.parse({
      level,
      height: DEFAULT_LEVEL_HEIGHT,
      children: [],
      parentId: resolvedBuildingId,
    })
    createNode(newLevel, resolvedBuildingId as AnyNodeId)
    setSelection({ buildingId: resolvedBuildingId, levelId: newLevel.id })
  }

  const addBasement = () => {
    if (!resolvedBuildingId) return
    const level = levels.length === 0 ? -1 : Math.min(...levels.map((entry) => entry.level)) - 1
    const newLevel = LevelNode.parse({
      level,
      height: DEFAULT_LEVEL_HEIGHT,
      children: [],
      parentId: resolvedBuildingId,
    })
    createNode(newLevel, resolvedBuildingId as AnyNodeId)
    setSelection({ buildingId: resolvedBuildingId, levelId: newLevel.id })
  }

  const removeFloor = () => {
    if (!(activeLevel && activeLevel.level !== 0)) return
    const index = levels.findIndex((level) => level.id === activeLevel.id)
    const fallback = levels[index - 1] ?? levels[index + 1]
    deleteNode(activeLevel.id)
    setSelection({
      buildingId: resolvedBuildingId,
      levelId: fallback?.id ?? null,
    })
  }

  const page = settingsContextKey === DEFAULT_SETTINGS_CONTEXT_KEY ? settingsPage : 0
  const setPage = (nextPage: number) =>
    setSettingsNavigation(DEFAULT_SETTINGS_CONTEXT_KEY, nextPage)

  return (
    <>
      <SpatialButton
        disabled={!canUndo || !interactionIdle}
        name="xr-setting-undo"
        onClick={runUndo}
        position={[-0.24, 0.3, 0]}
        size={[0.21, 0.075]}
      >
        <SpatialText
          anchorX="center"
          anchorY="middle"
          color={XR_WAND_THEME.text}
          fontSize={0.023}
          position={[0, 0, 0.012]}
        >
          Undo
        </SpatialText>
      </SpatialButton>
      <SpatialButton
        disabled={!canRedo || !interactionIdle}
        name="xr-setting-redo"
        onClick={runRedo}
        position={[0, 0.3, 0]}
        size={[0.21, 0.075]}
      >
        <SpatialText
          anchorX="center"
          anchorY="middle"
          color={XR_WAND_THEME.text}
          fontSize={0.023}
          position={[0, 0, 0.012]}
        >
          Redo
        </SpatialText>
      </SpatialButton>
      <SpatialButton
        disabled={playerMode !== XR_PLAYER_MODES.GOD || !interactionIdle}
        name="xr-setting-reset-view"
        onClick={requestGodScaleReset}
        position={[0.24, 0.3, 0]}
        size={[0.21, 0.075]}
      >
        <SpatialText
          anchorX="center"
          anchorY="middle"
          color={XR_WAND_THEME.text}
          fontSize={0.02}
          position={[0, 0, 0.012]}
        >
          Reset view
        </SpatialText>
      </SpatialButton>
      {page === 0 ? (
        <>
          <group position={[0, 0.18, 0]}>
            <SettingChoice
              label="Floor"
              name="xr-setting-floor"
              onClick={levels.length ? cycleFloor : undefined}
              value={activeLevel ? getLevelDisplayName(activeLevel) : 'No floors'}
            />
          </group>
          <group position={[0, 0.06, 0]}>
            <SpatialButton
              name="xr-setting-add-floor"
              onClick={addFloor}
              position={[-0.18, 0, 0]}
              size={[0.32, 0.075]}
            >
              <SpatialText
                anchorX="center"
                anchorY="middle"
                color={XR_WAND_THEME.text}
                fontSize={0.019}
                position={[0, 0, 0.012]}
              >
                Add floor
              </SpatialText>
            </SpatialButton>
            <SpatialButton
              name="xr-setting-add-basement"
              onClick={addBasement}
              position={[0.18, 0, 0]}
              size={[0.32, 0.075]}
            >
              <SpatialText
                anchorX="center"
                anchorY="middle"
                color={XR_WAND_THEME.text}
                fontSize={0.019}
                position={[0, 0, 0.012]}
              >
                Add basement
              </SpatialText>
            </SpatialButton>
          </group>
          <group position={[0, -0.06, 0]}>
            <SpatialButton
              disabled={!activeLevel || activeLevel.level === 0}
              name="xr-setting-remove-floor"
              onClick={removeFloor}
              position={[0, 0, 0]}
              size={[0.7, 0.075]}
            >
              <SpatialText
                anchorX="center"
                anchorY="middle"
                color={XR_WAND_THEME.text}
                fontSize={0.019}
                position={[0, 0, 0.012]}
              >
                Remove selected floor
              </SpatialText>
            </SpatialButton>
          </group>
          <group position={[0, -0.18, 0]}>
            <SettingChoice label="Editor mode" name="xr-setting-editor-mode" value={mode} />
          </group>
        </>
      ) : (
        <>
          <group position={[0, 0.18, 0]}>
            <SettingChoice
              label="Grid snap"
              name="xr-setting-grid-snap"
              onClick={cycleGridSnapStep}
              value={`${gridSnapStep} m`}
            />
          </group>
          <group position={[0, 0.06, 0]}>
            <SettingChoice
              label="XR scale"
              name="xr-setting-player-mode"
              onClick={toggleXRPlayerMode}
              value={playerMode === XR_PLAYER_MODES.GOD ? 'God' : 'Human'}
            />
          </group>
          <group position={[0, -0.06, 0]}>
            <SettingStepper
              label="Panel size"
              max={XR_WAND_PANEL_SCALE_MAX}
              min={XR_WAND_PANEL_SCALE_MIN}
              name="xr-setting-panel-scale"
              onChange={setPanelScale}
              step={XR_WAND_PANEL_SCALE_STEP}
              value={panelScale}
            />
          </group>
          <group position={[0, -0.18, 0]}>
            <SettingChoice
              label="Wall snap"
              name="xr-setting-wall-snap"
              onClick={() => setSnappingMode('wall', cycleSnappingModeIn('wall', wallSnappingMode))}
              value={getSnappingModeLabel(wallSnappingMode)}
            />
          </group>
        </>
      )}
      <PageArrows
        name="xr-default-settings"
        onChange={setPage}
        page={page}
        pageCount={DEFAULT_SETTINGS_PAGES}
      />
    </>
  )
}

export function XRSettingsPanel() {
  const paginationKey = useXRWandPanelSettings((state) => state.settingsContextKey)
  const paginationPage = useXRWandPanelSettings((state) => state.settingsPage)
  const setSettingsNavigation = useXRWandPanelSettings((state) => state.setSettingsNavigation)
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
  const deleteNode = useScene((state) => state.deleteNode)
  const setSelection = useViewer((state) => state.setSelection)
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
  const rows = useMemo<XRSettingRow[]>(
    () =>
      context ? [...collectRoofActionRows(context.node), ...collectXRSettingRows(context)] : [],
    [context],
  )
  const contextKey = context?.key ?? 'default'
  const page = paginationKey === contextKey ? paginationPage : 0
  const current = getPage(rows, page, ROWS_PER_PAGE)
  const setPage = (nextPage: number) => setSettingsNavigation(contextKey, nextPage)
  const deleteSelectedNode = () => {
    if (!(selectedId && selectedNode && context?.source === 'node')) return
    if (context.definition.capabilities.deletable === false) return
    emitDeleteSFX(selectedNode.type)
    setSelection({ selectedIds: [] })
    deleteNode(selectedId as AnyNodeId)
  }

  const update = (row: XRSettingFieldRow, value: unknown) => {
    if (!context) return
    const patch = createXRSettingPatch(context, row, value)
    if (context.source === 'node') {
      commitParametricNodeFields(context.node.id as AnyNodeId, patch)
    } else if (context.tool) {
      setToolDefaults(context.tool, { ...toolDefaults, ...patch })
    }
  }

  if (mode === 'terrain-sculpt') return <XRTerrainSettingsPanel />

  return (
    <group name="xr-wand-settings-panel">
      <PanelHeader
        mark={context ? `${rows.length} controls` : 'selection-aware'}
        onDelete={
          context?.source === 'node' && context.definition.capabilities.deletable !== false
            ? deleteSelectedNode
            : undefined
        }
        title={context?.title ?? 'Settings'}
      />
      {!context ? (
        <DefaultSettings />
      ) : context.node.type === 'roof' && context.source === 'node' ? (
        <RoofSpatialSettings roof={context.node as RoofNode} />
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
              ) : row.kind === 'action' ? (
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
              ) : (
                <ToolChipControl row={row} />
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
