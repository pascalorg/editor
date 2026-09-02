'use client'

import type {
  AnyNode,
  AnyNodeId,
  CabinetModuleNode as CabinetModuleNodeType,
  CabinetNode as CabinetNodeType,
} from '@pascal-app/core'
import { createSceneApi, useScene } from '@pascal-app/core'
import {
  ActionButton,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
  SliderControl,
  ToggleControl,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Equal as EqualIcon, Plus, Trash } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import {
  metadataForSelectedWidth,
  metadataWithPresetWidthDebt,
  presetNominalWidth,
  presetWidthDebt,
  recordedPresetNominalWidth,
} from './preset-width-debt'
import {
  CABINET_DIMENSION_PROFILES,
  type CabinetDimensionProfileId,
  cabinetDimensionProfileById,
  cabinetDimensionProfileId,
} from './profiles'
import { MAX_CABINET_WIDTH } from './resize-limits'
import {
  CABINET_REVEAL_GAPS,
  type CabinetRevealGapId,
  cabinetRevealGapById,
  cabinetRevealGapId,
} from './reveals'
import { runWallConstraints } from './run-layout'
import {
  addCabinetModuleSide,
  backAlignZ,
  bumpCabinetRunLayoutRevision,
  cabinetMetadataRecord,
  cabinetRunWidthEqualizationPlan,
  equalizeCabinetRunWidths,
  nestedCornerRunPositionOverrides,
  resolveCabinetType,
  runModuleBaseY,
  syncCornerRunsFromRunSources,
  syncCornerStyleGroupFromRun,
  wallChildOf,
} from './run-ops'
import {
  backAnchoredModuleZ,
  minCabinetCarcassHeightForStack,
  reflowCabinetRunModules,
  stackForCabinet,
} from './stack'

export type CabinetEditableNode = CabinetNodeType | CabinetModuleNodeType

const RUN_POSITION_PATCH_KEYS = new Set<keyof CabinetNodeType>(['showPlinth', 'plinthHeight'])
const RUN_MODULE_SYNC_PATCH_KEYS = new Set<keyof CabinetNodeType>([
  'frontStyle',
  'frontOverlay',
  'handleStyle',
  'handlePosition',
  'frontGap',
])
const RUN_DEPTH_PATCH_KEY = 'depth'
const MIN_TRIMMED_CORNER_PRESET_WIDTH = 0.05

const FRONT_STYLE_OPTIONS = [
  { value: 'slab', label: 'Slab' },
  { value: 'shaker', label: 'Shaker' },
  { value: 'raised-arch', label: 'Raised Arch' },
] as const

const FRONT_OVERLAY_OPTIONS = [
  { value: 'full', label: 'Overlay' },
  { value: 'inset', label: 'Inset' },
] as const

const HANDLE_STYLE_OPTIONS = [
  { value: 'bar', label: 'Bar' },
  { value: 'knob', label: 'Knob' },
  { value: 'cutout', label: 'Cutout' },
  { value: 'hole', label: 'Hole' },
  { value: 'none', label: 'None' },
] as const

const HANDLE_POSITION_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'top', label: 'Top' },
  { value: 'center', label: 'Center' },
] as const

function moduleSummary(module: CabinetModuleNodeType) {
  if ((module.cabinetType ?? 'base') === 'tall') return 'Tall cabinet'
  const stack = stackForCabinet(module)
  if (stack.length === 0) return 'Empty'
  if (stack.length === 1) return stack[0]!.type
  return `${stack.length} compartments`
}

export function bumpRunLayoutRevisionViaStore(
  scene: ReturnType<typeof useScene.getState>,
  run: CabinetNodeType,
) {
  bumpCabinetRunLayoutRevision(createSceneApi(useScene), run)
  scene.markDirty(run.id as AnyNodeId)
}

function canDonatePresetWidth(module: CabinetModuleNodeType, run: CabinetNodeType): boolean {
  return (
    resolveCabinetType(module, run) === 'base' &&
    stackForCabinet(module).every(
      (compartment) =>
        compartment.type === 'door' ||
        compartment.type === 'drawer' ||
        compartment.type === 'shelf',
    )
  )
}

function hasLinkedCornerRun(module: CabinetModuleNodeType): boolean {
  const value = cabinetMetadataRecord(module.metadata).cabinetCornerSourceLink
  return (
    Boolean(value && typeof value === 'object' && !Array.isArray(value)) &&
    Array.isArray((value as { linkedRunIds?: unknown }).linkedRunIds) &&
    (value as { linkedRunIds: unknown[] }).linkedRunIds.length > 0
  )
}

export function reflowRunModules({
  modules,
  parentRun,
  patch,
  scene,
  selected,
}: {
  modules: CabinetModuleNodeType[]
  parentRun: CabinetNodeType
  patch: Partial<CabinetModuleNodeType>
  scene: ReturnType<typeof useScene.getState>
  selected: CabinetModuleNodeType
}): boolean {
  const wallConstraints = runWallConstraints(
    parentRun,
    modules,
    scene.nodes as Record<AnyNodeId, AnyNode>,
    { widthGrowth: Math.max(0, (patch.width ?? selected.width) - selected.width) },
  )
  const sortedModules = [...modules].sort((a, b) => a.position[0] - b.position[0])
  const leftCornerAnchored = Boolean(sortedModules[0] && hasLinkedCornerRun(sortedModules[0]))
  const rightCornerAnchored = Boolean(
    sortedModules.at(-1) && hasLinkedCornerRun(sortedModules.at(-1)!),
  )
  const effectiveWallConstraints = {
    left:
      leftCornerAnchored && wallConstraints.left.constrained
        ? { constrained: true, slack: 0 }
        : wallConstraints.left,
    right:
      rightCornerAnchored && wallConstraints.right.constrained
        ? { constrained: true, slack: 0 }
        : wallConstraints.right,
  }
  const eligibleDonorIds = new Set(
    modules.filter((module) => canDonatePresetWidth(module, parentRun)).map((module) => module.id),
  )
  const preserveExtent =
    effectiveWallConstraints.left.constrained && effectiveWallConstraints.right.constrained
  const selectedWillShrink = (patch.width ?? selected.width) < selected.width - 1e-4
  const nominalWidthById = new Map(
    modules.map((module) => [module.id, recordedPresetNominalWidth(module)]),
  )
  const maximumWidthById = new Map(modules.map((module) => [module.id, presetNominalWidth(module)]))
  const originalDonorIds = new Set(
    modules
      .filter(
        (module) => eligibleDonorIds.has(module.id) && presetWidthDebt(module, selected.id) > 1e-4,
      )
      .map((module) => module.id),
  )
  if (preserveExtent && selectedWillShrink) {
    const sorted = [...modules].sort((a, b) => a.position[0] - b.position[0])
    const selectedIndex = sorted.findIndex((module) => module.id === selected.id)
    const fallbackCandidates = sorted
      .map((module, index) => ({ index, module }))
      .filter(({ module }) => module.id !== selected.id && eligibleDonorIds.has(module.id))
      .sort((a, b) => {
        const distance = Math.abs(a.index - selectedIndex) - Math.abs(b.index - selectedIndex)
        return distance !== 0 ? distance : b.index - a.index
      })
    const freedWidth = selected.width - (patch.width ?? selected.width)
    const ordinaryCapacity = fallbackCandidates.reduce((total, { module }) => {
      const maximumWidth = maximumWidthById.get(module.id) ?? MAX_CABINET_WIDTH
      return total + Math.max(0, maximumWidth - module.width)
    }, 0)
    let extraCapacity = Math.max(0, freedWidth - ordinaryCapacity)
    const extensionCandidates = [...fallbackCandidates].sort((a, b) => {
      const donorOrder =
        Number(originalDonorIds.has(a.module.id)) - Number(originalDonorIds.has(b.module.id))
      return donorOrder !== 0 ? donorOrder : 0
    })
    for (const { module } of extensionCandidates) {
      if (extraCapacity <= 1e-4) break
      const nominalWidth = maximumWidthById.get(module.id) ?? MAX_CABINET_WIDTH
      const addedCapacity = Math.min(extraCapacity, MAX_CABINET_WIDTH - nominalWidth)
      maximumWidthById.set(module.id, nominalWidth + addedCapacity)
      extraCapacity -= addedCapacity
    }
  }
  const reflowed = reflowCabinetRunModules(modules, selected.id, patch.width ?? selected.width, {
    wallConstraints: effectiveWallConstraints,
    eligibleDonorIds,
    minimumWidthById: new Map(
      modules
        .filter(hasLinkedCornerRun)
        .map((module) => [module.id, MIN_TRIMMED_CORNER_PRESET_WIDTH]),
    ),
    maximumWidth: MAX_CABINET_WIDTH,
    maximumWidthById,
    nominalWidthById,
    restorableWidthById: new Map(
      modules.map((module) => [module.id, presetWidthDebt(module, selected.id)]),
    ),
  })
  if (reflowed.length === 0) return false

  const reflowById = new Map(reflowed.map((entry) => [entry.id, entry]))
  for (const module of [...modules].sort((a, b) => a.position[0] - b.position[0])) {
    const reflow = reflowById.get(module.id)
    if (!reflow) continue
    const isSelected = module.id === selected.id
    const nextPatch: Partial<CabinetModuleNodeType> = isSelected
      ? { ...patch, width: reflow.width }
      : { width: reflow.width }
    const widthDelta = reflow.width - module.width
    if (isSelected && Math.abs(widthDelta) > 1e-4) {
      nextPatch.metadata = metadataForSelectedWidth(module, reflow.width, nextPatch.metadata)
    }
    if (!isSelected && Math.abs(widthDelta) > 1e-4) {
      nextPatch.metadata = metadataWithPresetWidthDebt(module, selected.id, widthDelta)
    }
    const nextPosition: CabinetModuleNodeType['position'] = [
      reflow.position[0],
      isSelected && patch.position ? patch.position[1] : reflow.position[1],
      isSelected && typeof patch.depth === 'number'
        ? backAnchoredModuleZ(module.position[2], module.depth, patch.depth)
        : reflow.position[2],
    ]

    if (isSelected) {
      const cabinetType = patch.cabinetType ?? module.cabinetType
      const convertsToBase =
        cabinetType === 'base' && resolveCabinetType(module, parentRun) !== 'base'
      if (convertsToBase) {
        nextPatch.depth = patch.depth ?? parentRun.depth
        nextPatch.carcassHeight = patch.carcassHeight ?? parentRun.carcassHeight
        nextPatch.plinthHeight = patch.plinthHeight ?? parentRun.plinthHeight
        nextPatch.toeKickDepth = patch.toeKickDepth ?? parentRun.toeKickDepth
        nextPatch.countertopThickness = patch.countertopThickness ?? parentRun.countertopThickness
        nextPatch.countertopOverhang = patch.countertopOverhang ?? parentRun.countertopOverhang
      }
    }

    nextPatch.position = nextPosition
    const nestedCornerOverrides = nestedCornerRunPositionOverrides(
      module,
      nextPosition,
      scene.nodes as Readonly<Partial<Record<AnyNodeId, AnyNode>>>,
    )
    scene.updateNode(module.id as AnyNodeId, nextPatch)
    for (const [id, override] of nestedCornerOverrides) {
      scene.updateNode(id, override)
    }

    const wallChild = wallChildOf(
      module,
      scene.nodes as Record<string, CabinetEditableNode | undefined>,
    )
    if (wallChild) {
      scene.updateNode(wallChild.id as AnyNodeId, {
        position: [
          0,
          wallChild.position[1],
          backAlignZ(nextPatch.depth ?? module.depth, wallChild.depth),
        ],
        width: reflow.width,
      })
      scene.markDirty(module.id as AnyNodeId)
    }
  }

  syncCornerRunsFromRunSources({
    baseLayout: 'width-only',
    previousModules: modules,
    run: (useScene.getState().nodes[parentRun.id] as CabinetNodeType | undefined) ?? parentRun,
    sceneApi: createSceneApi(useScene),
  })
  bumpRunLayoutRevisionViaStore(scene, parentRun)
  return true
}

export function updateCabinetRun({
  modules,
  node,
  patch,
}: {
  modules: CabinetModuleNodeType[]
  node: CabinetNodeType
  patch: Partial<CabinetNodeType>
}) {
  const scene = useScene.getState()
  const sceneApi = createSceneApi(useScene)
  const nextPatch = { ...patch }
  if (typeof nextPatch.carcassHeight === 'number') {
    const minModuleHeight = Math.max(
      0.4,
      ...modules.map((module) => minCabinetCarcassHeightForStack(module)),
    )
    nextPatch.carcassHeight = Math.max(nextPatch.carcassHeight, minModuleHeight)
  }
  const nextNode = { ...node, ...nextPatch }
  scene.updateNode(node.id, nextPatch)

  const shouldSyncDepth = RUN_DEPTH_PATCH_KEY in nextPatch
  const shouldSyncHeight = 'carcassHeight' in nextPatch
  const shouldSyncPosition = Object.keys(nextPatch).some((key) =>
    RUN_POSITION_PATCH_KEYS.has(key as keyof CabinetNodeType),
  )
  const shouldSyncModules = Object.keys(nextPatch).some((key) =>
    RUN_MODULE_SYNC_PATCH_KEYS.has(key as keyof CabinetNodeType),
  )
  if (!shouldSyncDepth && !shouldSyncHeight && !shouldSyncPosition && !shouldSyncModules) return

  const stylePatch: Partial<CabinetNodeType> = {}
  if ('frontStyle' in nextPatch) stylePatch.frontStyle = nextNode.frontStyle
  if ('frontOverlay' in nextPatch) stylePatch.frontOverlay = nextNode.frontOverlay
  if ('handleStyle' in nextPatch) stylePatch.handleStyle = nextNode.handleStyle
  if ('handlePosition' in nextPatch) stylePatch.handlePosition = nextNode.handlePosition
  if ('frontGap' in nextPatch) stylePatch.frontGap = nextNode.frontGap

  for (const module of modules) {
    const modulePatch: Partial<CabinetModuleNodeType> = {}
    if (shouldSyncDepth) {
      modulePatch.depth = nextNode.depth
    }
    if (shouldSyncHeight) {
      modulePatch.carcassHeight = Math.max(
        nextNode.carcassHeight,
        minCabinetCarcassHeightForStack(module),
      )
    }
    if (shouldSyncPosition) {
      modulePatch.position = [module.position[0], runModuleBaseY(nextNode), module.position[2]]
    }
    if (shouldSyncModules) {
      if ('frontStyle' in nextPatch) modulePatch.frontStyle = nextNode.frontStyle
      if ('frontOverlay' in nextPatch) modulePatch.frontOverlay = nextNode.frontOverlay
      if ('handleStyle' in nextPatch) modulePatch.handleStyle = nextNode.handleStyle
      if ('handlePosition' in nextPatch) modulePatch.handlePosition = nextNode.handlePosition
      if ('frontGap' in nextPatch) modulePatch.frontGap = nextNode.frontGap
    }
    scene.updateNode(module.id, modulePatch)

    if (shouldSyncModules) {
      const wallChild = wallChildOf(
        module,
        scene.nodes as Record<string, CabinetEditableNode | undefined>,
      )
      if (wallChild) {
        scene.updateNode(wallChild.id, {
          frontStyle: nextNode.frontStyle,
          frontOverlay: nextNode.frontOverlay,
          handleStyle: nextNode.handleStyle,
          handlePosition: nextNode.handlePosition,
          ...('frontGap' in nextPatch ? { frontGap: nextNode.frontGap } : {}),
        })
      }
    }
  }

  if (shouldSyncModules) {
    syncCornerStyleGroupFromRun({
      run: nextNode,
      patch: stylePatch,
      sceneApi,
    })
  } else {
    syncCornerRunsFromRunSources({ run: nextNode, sceneApi })
  }
}

export function CabinetRunPanel({
  node,
  modules,
  onClose,
}: {
  node: CabinetNodeType
  modules: CabinetModuleNodeType[]
  onClose: () => void
}) {
  const setSelection = useViewer((s) => s.setSelection)
  const sceneNodes = useScene((s) => s.nodes)
  const sortedModules = useMemo(
    () => [...modules].sort((a, b) => a.position[0] - b.position[0]),
    [modules],
  )
  const widthEqualization = useMemo(
    () => cabinetRunWidthEqualizationPlan(node, sceneNodes),
    [node, sceneNodes],
  )

  const updateRun = useCallback(
    (patch: Partial<CabinetNodeType>) => updateCabinetRun({ modules, node, patch }),
    [modules, node],
  )

  const addModule = useCallback(
    (side: 'left' | 'right') => {
      const id = addCabinetModuleSide({
        anchorModule: null,
        run: node,
        sceneApi: createSceneApi(useScene),
        side,
      })
      if (id) setSelection({ selectedIds: [id] })
    },
    [node, setSelection],
  )

  const equalizeWidths = useCallback(() => {
    equalizeCabinetRunWidths({ run: node, sceneApi: createSceneApi(useScene) })
  }, [node])

  const equalizeWidthsTitle = !widthEqualization.ok
    ? widthEqualization.reason === 'not-enough-modules'
      ? 'At least two standard base cabinets are required'
      : 'The available run width cannot satisfy the cabinet width limits'
    : widthEqualization.changed
      ? 'Equalize all resizeable standard base cabinets in this run'
      : 'The resizeable cabinet widths are already equal'

  const dimensionProfile = cabinetDimensionProfileId(node)
  const applyDimensionProfile = useCallback(
    (profileId: CabinetDimensionProfileId) => {
      const profile = cabinetDimensionProfileById(profileId)
      updateRun({
        carcassHeight: profile.carcassHeight,
        countertopThickness: profile.countertopThickness,
        depth: profile.depth,
        plinthHeight: profile.plinthHeight,
      })
    },
    [updateRun],
  )

  const deleteModule = useCallback(
    (module: CabinetModuleNodeType) => {
      useScene.getState().deleteNode(module.id as AnyNodeId)
      // Deleting the last module cascades the empty run away too — only
      // keep it selected/dirty if it survived.
      if (useScene.getState().nodes[node.id as AnyNodeId]) {
        useScene.getState().markDirty(node.id as AnyNodeId)
        setSelection({ selectedIds: [node.id] })
      } else {
        setSelection({ selectedIds: [] })
      }
    },
    [node.id, setSelection],
  )

  return (
    <PanelWrapper
      icon="/icons/item.webp"
      onClose={onClose}
      title={node.name || 'Modular Cabinet'}
      width={320}
    >
      <PanelSection title="Modules">
        <div className="flex flex-col gap-2 px-1 pb-2">
          {sortedModules.map((module, index) => (
            <div
              className="flex items-center justify-between rounded-lg border border-border/40 bg-[#252527] px-2 py-2"
              key={module.id}
            >
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => setSelection({ selectedIds: [module.id] })}
                type="button"
              >
                <div className="truncate text-xs font-medium text-foreground">
                  {module.name || `Module ${index + 1}`}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {moduleSummary(module)}
                </div>
              </button>
              <button
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-red-500/20 bg-red-500/8 text-red-300 transition-colors hover:bg-red-500/15 hover:text-red-200 disabled:opacity-30"
                disabled={modules.length <= 1}
                onClick={() => deleteModule(module)}
                type="button"
              >
                <Trash className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="px-1 pb-1">
          <div className="grid grid-cols-2 gap-2">
            <ActionButton
              icon={<Plus className="h-4 w-4" />}
              label="Add left"
              onClick={() => addModule('left')}
            />
            <ActionButton
              icon={<Plus className="h-4 w-4" />}
              label="Add right"
              onClick={() => addModule('right')}
            />
          </div>
          <ActionButton
            className="mt-2 w-full"
            disabled={!widthEqualization.ok || !widthEqualization.changed}
            icon={<EqualIcon className="h-4 w-4" />}
            label="Equalize widths"
            onClick={equalizeWidths}
            title={equalizeWidthsTitle}
          />
          <p className="px-1 pt-1 text-[10px] leading-4 text-muted-foreground">
            Balances standard base cabinets while keeping appliance and corner-filler widths fixed.
          </p>
        </div>
      </PanelSection>

      <PanelSection title="Shared Plinth & Countertop">
        <div className="space-y-2 px-1 pb-2">
          {node.runTier === 'base' && (
            <div>
              <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Standard dimensions
              </div>
              <SegmentedControl
                mixed={dimensionProfile === 'custom'}
                onChange={(value) => applyDimensionProfile(value as CabinetDimensionProfileId)}
                options={CABINET_DIMENSION_PROFILES.map((profile) => ({
                  label: profile.label,
                  value: profile.id,
                }))}
                value={dimensionProfile === 'us-base' ? 'us-base' : 'metric-base'}
              />
              <p className="px-1 pt-1 text-[10px] leading-4 text-muted-foreground">
                Applies depth, carcass, plinth, and countertop thickness to this run.
              </p>
            </div>
          )}
          <SliderControl
            label="Depth"
            max={1.2}
            min={0.3}
            onChange={(value) => updateRun({ depth: value })}
            precision={2}
            step={0.01}
            unit="m"
            value={node.depth}
          />
          <SliderControl
            label="Carcass height"
            max={node.runTier === 'tall' ? 2.4 : 1.4}
            min={Math.max(0.4, ...modules.map((module) => minCabinetCarcassHeightForStack(module)))}
            onChange={(value) => updateRun({ carcassHeight: value })}
            precision={2}
            step={0.01}
            unit="m"
            value={node.carcassHeight}
          />
          <ToggleControl
            checked={node.showPlinth}
            label="Show plinth"
            onChange={(checked) => updateRun({ showPlinth: checked })}
          />
          {node.showPlinth && (
            <SliderControl
              label="Plinth height"
              max={0.3}
              min={0.02}
              onChange={(value) => updateRun({ plinthHeight: value })}
              precision={2}
              step={0.01}
              unit="m"
              value={node.plinthHeight}
            />
          )}
          <ToggleControl
            checked={node.withCountertop}
            label="Show countertop"
            onChange={(checked) => updateRun({ withCountertop: checked })}
          />
          {node.withCountertop && (
            <>
              <SliderControl
                label="Countertop height"
                max={0.08}
                min={0.005}
                onChange={(value) => updateRun({ countertopThickness: value })}
                precision={3}
                step={0.005}
                unit="m"
                value={node.countertopThickness}
              />
              <SliderControl
                label="Countertop depth"
                max={0.12}
                min={0}
                onChange={(value) => updateRun({ countertopOverhang: value })}
                precision={2}
                step={0.005}
                unit="m"
                value={node.countertopOverhang}
              />
            </>
          )}
        </div>
      </PanelSection>

      <PanelSection title="Island & Bar">
        <div className="space-y-2 px-1 pb-2">
          {node.withCountertop && node.barLedge?.edge !== 'back' && (
            <SliderControl
              label="Seating overhang"
              max={0.45}
              min={0}
              onChange={(value) => updateRun({ countertopBackOverhang: value })}
              precision={2}
              step={0.05}
              unit="m"
              value={node.countertopBackOverhang}
            />
          )}
          <ToggleControl
            checked={node.withFinishedBack}
            label="Finished back"
            onChange={(checked) => updateRun({ withFinishedBack: checked })}
          />
          <ToggleControl
            checked={node.withFinishedEnds}
            label="Finished end panels"
            onChange={(checked) => updateRun({ withFinishedEnds: checked })}
          />
          {node.withCountertop && (
            <ToggleControl
              checked={node.withWaterfall}
              label="Waterfall ends"
              onChange={(checked) => updateRun({ withWaterfall: checked })}
            />
          )}
          <ToggleControl
            checked={Boolean(node.barLedge)}
            label="Bar counter"
            onChange={(checked) =>
              updateRun({
                barLedge: checked ? { edge: 'back', height: 1.06, depth: 0.35 } : undefined,
              })
            }
          />
          {node.barLedge && (
            <>
              <SegmentedControl
                onChange={(value) =>
                  updateRun({
                    barLedge: { ...node.barLedge!, edge: value as 'back' | 'left' | 'right' },
                  })
                }
                options={[
                  { value: 'back', label: 'Back' },
                  { value: 'left', label: 'Left' },
                  { value: 'right', label: 'Right' },
                ]}
                value={node.barLedge.edge}
              />
              <SliderControl
                label="Bar height"
                max={1.3}
                min={0.9}
                onChange={(value) => updateRun({ barLedge: { ...node.barLedge!, height: value } })}
                precision={2}
                step={0.01}
                unit="m"
                value={node.barLedge.height}
              />
              <SliderControl
                label="Bar depth"
                max={0.5}
                min={0.15}
                onChange={(value) => updateRun({ barLedge: { ...node.barLedge!, depth: value } })}
                precision={2}
                step={0.01}
                unit="m"
                value={node.barLedge.depth}
              />
            </>
          )}
        </div>
      </PanelSection>

      <PanelSection title="Fronts">
        <div className="space-y-2 px-1 pb-2">
          <div>
            <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Style
            </div>
            <SegmentedControl
              onChange={(value) =>
                updateRun({ frontStyle: value as CabinetNodeType['frontStyle'] })
              }
              options={FRONT_STYLE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={node.frontStyle ?? 'slab'}
            />
          </div>
          <div>
            <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Mounting
            </div>
            <SegmentedControl
              onChange={(value) =>
                updateRun({ frontOverlay: value as CabinetNodeType['frontOverlay'] })
              }
              options={FRONT_OVERLAY_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={node.frontOverlay ?? 'full'}
            />
          </div>
          <div>
            <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Reveal gap
            </div>
            <SegmentedControl
              mixed={cabinetRevealGapId(node.frontGap) === 'custom'}
              onChange={(value) =>
                updateRun({
                  frontGap: cabinetRevealGapById(value as CabinetRevealGapId).value,
                })
              }
              options={CABINET_REVEAL_GAPS.map((gap) => ({
                value: gap.id,
                label: gap.label,
              }))}
              value={
                cabinetRevealGapId(node.frontGap) === 'custom'
                  ? '3'
                  : cabinetRevealGapId(node.frontGap)
              }
            />
          </div>
        </div>
      </PanelSection>

      <PanelSection title="Handles">
        <div className="space-y-2 px-1 pb-2">
          <div>
            <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Style
            </div>
            <SegmentedControl
              onChange={(value) =>
                updateRun({ handleStyle: value as CabinetNodeType['handleStyle'] })
              }
              options={HANDLE_STYLE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={node.handleStyle}
            />
          </div>
          {(node.handleStyle === 'bar' || node.handleStyle === 'knob') && (
            <div>
              <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Position
              </div>
              <SegmentedControl
                onChange={(value) =>
                  updateRun({ handlePosition: value as CabinetNodeType['handlePosition'] })
                }
                options={HANDLE_POSITION_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                value={node.handlePosition ?? 'auto'}
              />
            </div>
          )}
        </div>
      </PanelSection>
    </PanelWrapper>
  )
}
