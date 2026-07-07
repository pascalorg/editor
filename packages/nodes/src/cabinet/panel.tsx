'use client'

import type {
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
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Pause, Play, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CompartmentCard } from './compartment-card'
import {
  animateCabinetOperationState,
  isCabinetAnimationRunning,
  onCabinetAnimationChange,
  stopCabinetAnimation,
} from './interaction'
import { CABINET_PRESETS, type CabinetPresetId } from './presets'
import {
  addWallChildAbove,
  backAlignZ,
  resolveCabinetType,
  runModuleBaseY,
  switchCabinetToBase,
  switchCabinetToTall,
  syncCornerRunsFromSourceModule,
  wallChildOf,
} from './run-ops'
import {
  bumpRunLayoutRevisionViaStore,
  type CabinetEditableNode,
  CabinetRunPanel,
  reflowRunModules,
} from './run-panel'
import {
  backAnchoredModuleZ,
  type CabinetCompartment,
  isHoodCompartmentType,
  minCabinetCarcassHeightForStack,
  newCabinetCompartment,
  normalizeCabinetStack,
  resizeCabinetCompartmentStack,
  stackForCabinet,
} from './stack'
import { resolveCompartmentTransition } from './stack-transitions'

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

const FRONT_OVERLAY_OPTIONS = [
  { value: 'full', label: 'Overlay' },
  { value: 'inset', label: 'Inset' },
] as const

const FRONT_STYLE_OPTIONS = [
  { value: 'slab', label: 'Slab' },
  { value: 'shaker', label: 'Shaker' },
  { value: 'raised-arch', label: 'Raised Arch' },
] as const

const CABINET_TIER_OPTIONS = [
  { value: 'base', label: 'Base Cabinet' },
  { value: 'tall', label: 'Tall Cabinet' },
] as const

const EMPTY_MODULES: CabinetModuleNodeType[] = []
const EMPTY_MODULE_IDS: AnyNodeId[] = []

const PRESET_BUTTON_CLASS =
  'flex h-9 items-center justify-center rounded-md border border-border/40 bg-[#252527] px-3 py-2 text-center text-xs font-medium text-foreground transition-colors hover:border-border/70 hover:bg-[#303033]'

export default function CabinetPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const [isAnimating, setIsAnimating] = useState(false)
  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNodeId] as CabinetEditableNode | undefined) : undefined,
  )
  const parentRun = useScene((s) => {
    if (!selectedId) return undefined
    const selected = s.nodes[selectedId as AnyNodeId]
    if (selected?.type !== 'cabinet-module' || !selected.parentId) return undefined
    const parent = s.nodes[selected.parentId as AnyNodeId] as CabinetEditableNode | undefined
    return parent?.type === 'cabinet' ? parent : undefined
  })
  const moduleIds = useScene((s) => {
    if (!selectedId) return EMPTY_MODULE_IDS
    const selected = s.nodes[selectedId as AnyNodeId] as CabinetEditableNode | undefined
    const parent =
      selected?.type === 'cabinet'
        ? selected
        : selected?.type === 'cabinet-module' && selected.parentId
          ? (s.nodes[selected.parentId as AnyNodeId] as CabinetNodeType | undefined)
          : undefined
    if (parent?.type !== 'cabinet') return EMPTY_MODULE_IDS
    return (parent.children ?? EMPTY_MODULE_IDS) as AnyNodeId[]
  })
  // Select just the run's modules — subscribing to the whole `s.nodes` record
  // re-rendered the panel on every scene mutation anywhere in the scene.
  const modules = useScene(
    useShallow((s) => {
      if (moduleIds.length === 0) return EMPTY_MODULES
      const found = moduleIds
        .map((id) => s.nodes[id as AnyNodeId] as CabinetModuleNodeType | undefined)
        .filter((child): child is CabinetModuleNodeType => child?.type === 'cabinet-module')
      return found.length === 0 ? EMPTY_MODULES : found
    }),
  )
  const wallChild = useScene((s) => {
    const selected = selectedId ? s.nodes[selectedId as AnyNodeId] : undefined
    return selected?.type === 'cabinet-module'
      ? wallChildOf(selected, s.nodes as Record<string, CabinetEditableNode | undefined>)
      : undefined
  })
  const parentIsModule = useScene((s) => {
    const selected = selectedId ? s.nodes[selectedId as AnyNodeId] : undefined
    return (
      selected?.type === 'cabinet-module' &&
      selected.parentId != null &&
      s.nodes[selected.parentId as AnyNodeId]?.type === 'cabinet-module'
    )
  })

  const updateNode = useCallback(
    (patch: Partial<CabinetEditableNode>) => {
      if (!selectedId) return
      const scene = useScene.getState()
      const liveBeforeUpdate = scene.nodes[selectedId as AnyNodeId] as
        | CabinetEditableNode
        | undefined
      const nextPatch = { ...patch }
      if (
        liveBeforeUpdate?.type === 'cabinet-module' &&
        typeof nextPatch.carcassHeight === 'number'
      ) {
        nextPatch.carcassHeight = Math.max(
          nextPatch.carcassHeight,
          minCabinetCarcassHeightForStack(liveBeforeUpdate),
        )
      }
      if (
        liveBeforeUpdate?.type === 'cabinet-module' &&
        liveBeforeUpdate.parentId &&
        parentRun?.type === 'cabinet' &&
        'width' in nextPatch &&
        typeof nextPatch.width === 'number'
      ) {
        reflowRunModules({
          modules,
          parentRun,
          patch: nextPatch as Partial<CabinetModuleNodeType>,
          scene,
          selected: liveBeforeUpdate,
        })
        return
      }
      if (
        liveBeforeUpdate?.type === 'cabinet-module' &&
        liveBeforeUpdate.parentId &&
        parentRun?.type === 'cabinet' &&
        typeof nextPatch.depth === 'number'
      ) {
        const patchPosition = nextPatch.position as CabinetModuleNodeType['position'] | undefined
        nextPatch.position = [
          patchPosition?.[0] ?? liveBeforeUpdate.position[0],
          patchPosition?.[1] ?? liveBeforeUpdate.position[1],
          backAnchoredModuleZ(
            liveBeforeUpdate.position[2],
            liveBeforeUpdate.depth,
            nextPatch.depth,
          ),
        ]
      }
      scene.updateNode(selectedId as AnyNodeId, nextPatch)
      const liveNode = scene.nodes[selectedId as AnyNodeId] as CabinetEditableNode | undefined
      if (liveNode?.type === 'cabinet-module' && liveNode.parentId) {
        scene.markDirty(liveNode.parentId as AnyNodeId)
        const parent = scene.nodes[liveNode.parentId as AnyNodeId] as
          | CabinetEditableNode
          | undefined
        const affectsRunLayout =
          'stack' in nextPatch ||
          'carcassHeight' in nextPatch ||
          'cabinetType' in nextPatch ||
          'position' in nextPatch ||
          'depth' in nextPatch ||
          'width' in nextPatch
        if (parent?.type === 'cabinet' && affectsRunLayout) {
          bumpRunLayoutRevisionViaStore(scene, parent)
          if (liveNode?.type === 'cabinet-module') {
            syncCornerRunsFromSourceModule({
              module: liveNode,
              run: parent,
              sceneApi: createSceneApi(useScene),
            })
          }
        }
      }
      // Keep a nested wall cabinet's back flush with its base when the base depth changes.
      if ('depth' in nextPatch && liveNode?.type === 'cabinet-module') {
        const wallChild = wallChildOf(
          liveNode,
          scene.nodes as Record<string, CabinetEditableNode | undefined>,
        )
        if (wallChild) {
          scene.updateNode(wallChild.id as AnyNodeId, {
            position: [
              wallChild.position[0],
              wallChild.position[1],
              backAlignZ(liveNode.depth, wallChild.depth),
            ],
          })
          scene.markDirty(liveNode.id as AnyNodeId)
        }
      }
    },
    [modules, parentRun, selectedId],
  )

  const close = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  // Selecting the run as the sole selection is enough: the selection-manager's
  // parent-frame routing keeps clicks on child modules targeting the run while
  // it stays the single selected node.
  const backToRun = useCallback(() => {
    if (node?.type === 'cabinet-module' && node.parentId) {
      setSelection({ selectedIds: [node.parentId] })
    }
  }, [node, setSelection])

  // Animation lives in ./interaction.ts, shared with the registry E-key
  // action; the panel only mirrors its running state for the Play button.
  const stopAnimation = useCallback(() => {
    if (selectedId) stopCabinetAnimation(selectedId as AnyNodeId)
  }, [selectedId])

  const animateOperationState = useCallback(
    (target: 0 | 1) => {
      if (selectedId) animateCabinetOperationState(selectedId as AnyNodeId, target)
    },
    [selectedId],
  )

  useEffect(() => {
    setIsAnimating(selectedId ? isCabinetAnimationRunning(selectedId as AnyNodeId) : false)
    return onCabinetAnimationChange((nodeId, running) => {
      if (nodeId === selectedId) setIsAnimating(running)
    })
  }, [selectedId])

  if (!node || (node.type !== 'cabinet' && node.type !== 'cabinet-module')) return null

  const stack = stackForCabinet(node)
  const isHoodOnlyNode =
    stack.length > 0 && stack.every((compartment) => isHoodCompartmentType(compartment.type))
  const normalized = normalizeCabinetStack(node)
  const rowHeights = new Map(normalized.map((row) => [row.index, row.height]))
  const rows = stack.map((compartment, index) => ({ compartment, index })).reverse()

  const commitStack = (
    next: CabinetCompartment[],
    extraPatch: Partial<CabinetModuleNodeType> = {},
  ) => {
    const patch = { ...extraPatch, stack: next }
    const minCarcassHeight = minCabinetCarcassHeightForStack({ ...node, stack: next })
    const targetCarcassHeight = patch.carcassHeight ?? node.carcassHeight
    if (targetCarcassHeight < minCarcassHeight) patch.carcassHeight = minCarcassHeight
    if (node.type === 'cabinet-module' && parentRun?.type === 'cabinet' && patch.width) {
      reflowRunModules({
        modules,
        parentRun,
        patch,
        scene: useScene.getState(),
        selected: node,
      })
      return
    }
    updateNode(patch)
  }
  const replaceAt = (index: number, next: CabinetCompartment) => {
    const transition = resolveCompartmentTransition({ node, parentRun, index, next })
    commitStack(transition.stack, transition.modulePatch)
  }
  const resizeAt = (index: number, height: number) =>
    commitStack(resizeCabinetCompartmentStack(node, index, height))
  const removeAt = (index: number) => commitStack(stack.filter((_, i) => i !== index))
  const addCompartment = () => commitStack([...stack, newCabinetCompartment('shelf')])
  const moveCompartment = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= stack.length) return
    const next = stack.slice()
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    commitStack(next)
  }

  // Structural run mutations live in run-ops.ts, shared with the quick-action
  // menu so the two surfaces can't drift.
  const runOpsApi = () => createSceneApi(useScene)

  const addWallCabinetOrHoodAbove = (kind: 'cabinet' | 'hood') => {
    if (node?.type !== 'cabinet-module' || parentRun?.type !== 'cabinet') return
    const id = addWallChildAbove({ kind, module: node, run: parentRun, sceneApi: runOpsApi() })
    if (id) setSelection({ selectedIds: [id] })
  }

  const addWallCabinetAbove = () => addWallCabinetOrHoodAbove('cabinet')
  const addHoodAbove = () => addWallCabinetOrHoodAbove('hood')

  const removeWallCabinet = () => {
    if (node?.type !== 'cabinet-module') return
    const scene = useScene.getState()
    const wall = wallChildOf(node, scene.nodes)
    if (!wall) return
    scene.deleteNode(wall.id as AnyNodeId)
    scene.markDirty(node.id as AnyNodeId)
    setSelection({ selectedIds: [node.id] })
  }

  const switchToTall = () => {
    if (node?.type !== 'cabinet-module' || parentRun?.type !== 'cabinet') return
    if (switchCabinetToTall({ module: node, run: parentRun, sceneApi: runOpsApi() })) {
      setSelection({ selectedIds: [node.id] })
    }
  }

  const switchToBase = () => {
    if (node?.type !== 'cabinet-module' || parentRun?.type !== 'cabinet') return
    if (switchCabinetToBase({ module: node, run: parentRun, sceneApi: runOpsApi() })) {
      setSelection({ selectedIds: [node.id] })
    }
  }

  const hasWallCabinet = node?.type === 'cabinet-module' ? Boolean(wallChild) : false

  const isWallChildModule = node?.type === 'cabinet-module' && parentIsModule

  const applyPreset = (presetId: CabinetPresetId) => {
    if (node?.type !== 'cabinet-module') return
    const scene = useScene.getState()
    const preset = CABINET_PRESETS.find((entry) => entry.id === presetId)
    if (!preset) return

    const patch = preset.createPatch(parentRun)
    const wallChild = wallChildOf(
      node,
      scene.nodes as Record<string, CabinetEditableNode | undefined>,
    )
    if (wallChild && patch.cabinetType === 'tall') {
      scene.deleteNode(wallChild.id as AnyNodeId)
    }

    const nextPatch: Partial<CabinetModuleNodeType> = {
      ...patch,
      position: [
        node.position[0],
        parentRun?.type === 'cabinet' ? runModuleBaseY(parentRun) : node.position[1],
        typeof patch.depth === 'number'
          ? backAnchoredModuleZ(node.position[2], node.depth, patch.depth)
          : node.position[2],
      ],
    }

    if (parentRun?.type === 'cabinet') {
      reflowRunModules({
        modules,
        parentRun,
        patch: nextPatch,
        scene,
        selected: node,
      })
    } else {
      scene.updateNode(node.id as AnyNodeId, nextPatch)
    }
    setSelection({ selectedIds: [node.id] })
  }

  if (node.type === 'cabinet' && modules.length > 0) {
    return <CabinetRunPanel modules={modules} node={node} onClose={close} />
  }

  return (
    <PanelWrapper
      icon="/icons/furniture.webp"
      onBack={node.type === 'cabinet-module' ? backToRun : undefined}
      onClose={close}
      title={node.name || 'Modular Cabinet'}
      width={320}
    >
      {node.type === 'cabinet-module' && parentRun?.type === 'cabinet' && (
        <PanelSection title="Presets">
          <div className="grid grid-cols-2 gap-2 px-1 pb-2">
            {CABINET_PRESETS.map((preset) => (
              <button
                className={PRESET_BUTTON_CLASS}
                key={preset.id}
                onClick={() => applyPreset(preset.id)}
                type="button"
              >
                <span className="truncate">{preset.label}</span>
              </button>
            ))}
          </div>
        </PanelSection>
      )}

      <PanelSection title="Dimensions">
        <SliderControl
          label="Width"
          max={3}
          min={0.3}
          onChange={(value) => updateNode({ width: value })}
          precision={2}
          step={0.05}
          unit="m"
          value={node.width}
        />
        {!isHoodOnlyNode && (
          <>
            <SliderControl
              label="Depth"
              max={1.2}
              min={0.3}
              onChange={(value) => updateNode({ depth: value })}
              precision={2}
              step={0.01}
              unit="m"
              value={node.depth}
            />
            <SliderControl
              label="Carcass height"
              max={
                node.type === 'cabinet-module' && resolveCabinetType(node, parentRun) === 'tall'
                  ? 2.4
                  : 1.4
              }
              min={
                node.type === 'cabinet-module'
                  ? Math.max(0.4, minCabinetCarcassHeightForStack(node))
                  : 0.4
              }
              onChange={(value) => updateNode({ carcassHeight: value })}
              precision={2}
              step={0.01}
              unit="m"
              value={node.carcassHeight}
            />
          </>
        )}
      </PanelSection>

      {node.type === 'cabinet-module' && parentRun?.type === 'cabinet' && !isHoodOnlyNode && (
        <PanelSection title="Cabinet Type">
          <div className="space-y-2 px-1 pb-2">
            <SegmentedControl
              onChange={(value) => {
                if (value === 'tall') {
                  switchToTall()
                  return
                }
                switchToBase()
              }}
              options={CABINET_TIER_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={resolveCabinetType(node, parentRun)}
            />
            {resolveCabinetType(node, parentRun) === 'base' &&
              (hasWallCabinet ? (
                <ActionButton label="Remove wall cabinet" onClick={removeWallCabinet} />
              ) : (
                <>
                  <ActionButton label="Add wall cabinet" onClick={addWallCabinetAbove} />
                  <ActionButton label="Add chimney" onClick={addHoodAbove} />
                </>
              ))}
          </div>
        </PanelSection>
      )}

      {!isHoodOnlyNode && (
        <PanelSection title="Open Animation">
          <div className="flex items-center gap-2 px-1">
            <div className="min-w-0 flex-1">
              <SliderControl
                label="Open"
                max={100}
                min={0}
                onChange={(value) => {
                  if (isAnimating) stopAnimation()
                  updateNode({ operationState: value / 100 })
                }}
                step={1}
                unit="%"
                value={Math.round((node.operationState ?? 0) * 100)}
              />
            </div>
            <button
              aria-label={
                isAnimating
                  ? 'Stop animation'
                  : (node.operationState ?? 0) >= 0.99
                    ? 'Close cabinet'
                    : 'Open cabinet'
              }
              className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border/40 bg-[#2C2C2E] px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-[#3e3e3e]"
              onClick={() => {
                if (isAnimating) {
                  stopAnimation()
                  return
                }
                animateOperationState((node.operationState ?? 0) >= 0.99 ? 0 : 1)
              }}
              title={
                isAnimating
                  ? 'Stop animation'
                  : (node.operationState ?? 0) >= 0.99
                    ? 'Close cabinet'
                    : 'Play animation'
              }
              type="button"
            >
              {isAnimating ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              <span>
                {isAnimating ? 'Stop' : (node.operationState ?? 0) >= 0.99 ? 'Close' : 'Play'}
              </span>
            </button>
          </div>
        </PanelSection>
      )}

      <PanelSection title="Compartments">
        <div className="flex flex-col gap-2 px-1 pb-2">
          {rows.map(({ compartment, index }, displayIndex) => (
            <CompartmentCard
              allowHood={isWallChildModule}
              wallCabinet={isWallChildModule}
              compartment={compartment}
              carcassHeight={node.carcassHeight}
              displayIndex={displayIndex}
              index={index}
              key={compartment.id}
              onMove={(delta) => moveCompartment(index, delta)}
              onRemove={() => removeAt(index)}
              onReplace={(next) => replaceAt(index, next)}
              onResizeHeight={(height) => resizeAt(index, height)}
              resolvedHeight={
                rowHeights.get(index) ?? node.carcassHeight / Math.max(stack.length, 1)
              }
              total={rows.length}
              width={node.width}
            />
          ))}
        </div>
        <div className="px-1 pb-1">
          <ActionButton
            icon={<Plus className="h-4 w-4" />}
            label="Add compartment"
            onClick={addCompartment}
          />
        </div>
      </PanelSection>

      {!isHoodOnlyNode && (
        <>
          <PanelSection title="Fronts">
            <div className="space-y-2 px-1 pb-2">
              <div>
                <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Style
                </div>
                <SegmentedControl
                  onChange={(value) =>
                    updateNode({ frontStyle: value as CabinetNodeType['frontStyle'] })
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
                    updateNode({ frontOverlay: value as CabinetNodeType['frontOverlay'] })
                  }
                  options={FRONT_OVERLAY_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  value={node.frontOverlay ?? 'full'}
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
                    updateNode({ handleStyle: value as CabinetNodeType['handleStyle'] })
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
                      updateNode({ handlePosition: value as CabinetNodeType['handlePosition'] })
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
        </>
      )}
    </PanelWrapper>
  )
}
