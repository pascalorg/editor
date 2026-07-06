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
  ToggleControl,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Plus, Trash } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import {
  addCabinetModuleSide,
  backAlignZ,
  bumpCabinetRunLayoutRevision,
  cornerLinkedSourceModuleForRun,
  runModuleBaseY,
  syncCornerRunsFromSourceModule,
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
const RUN_DEPTH_PATCH_KEY = 'depth'

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
  scene.dirtyNodes.add(run.id as AnyNodeId)
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
}) {
  const reflowed = reflowCabinetRunModules(modules, selected.id, patch.width ?? selected.width)
  if (reflowed.length === 0) return

  const reflowById = new Map(reflowed.map((entry) => [entry.id, entry]))
  for (const module of [...modules].sort((a, b) => a.position[0] - b.position[0])) {
    const reflow = reflowById.get(module.id)
    if (!reflow) continue
    const isSelected = module.id === selected.id
    const nextPatch: Partial<CabinetModuleNodeType> = isSelected ? { ...patch } : {}
    const nextPosition: CabinetModuleNodeType['position'] = [
      reflow.position[0],
      isSelected && patch.position ? patch.position[1] : reflow.position[1],
      isSelected && typeof patch.depth === 'number'
        ? backAnchoredModuleZ(module.position[2], module.depth, patch.depth)
        : reflow.position[2],
    ]

    if (isSelected) {
      const cabinetType = patch.cabinetType ?? module.cabinetType
      if (cabinetType === 'base') {
        nextPatch.depth = patch.depth ?? parentRun.depth
        nextPatch.carcassHeight = patch.carcassHeight ?? parentRun.carcassHeight
        nextPatch.plinthHeight = patch.plinthHeight ?? parentRun.plinthHeight
        nextPatch.toeKickDepth = patch.toeKickDepth ?? parentRun.toeKickDepth
        nextPatch.countertopThickness = patch.countertopThickness ?? 0
        nextPatch.countertopOverhang = patch.countertopOverhang ?? parentRun.countertopOverhang
      }
    }

    nextPatch.position = nextPosition
    scene.updateNode(module.id as AnyNodeId, nextPatch)

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
      scene.dirtyNodes.add(module.id as AnyNodeId)
    }
  }

  bumpRunLayoutRevisionViaStore(scene, parentRun)
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
  const sortedModules = useMemo(
    () => [...modules].sort((a, b) => a.position[0] - b.position[0]),
    [modules],
  )

  const updateRun = useCallback(
    (patch: Partial<CabinetNodeType>) => {
      const scene = useScene.getState()
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
      if (!shouldSyncDepth && !shouldSyncHeight && !shouldSyncPosition) return

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
        scene.updateNode(module.id, modulePatch)
      }

      const cornerSource = cornerLinkedSourceModuleForRun(nextNode, scene.nodes)
      if (cornerSource) {
        syncCornerRunsFromSourceModule({
          module: cornerSource,
          run: nextNode,
          sceneApi: createSceneApi(useScene),
        })
      }
    },
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

  const deleteModule = useCallback(
    (module: CabinetModuleNodeType) => {
      useScene.getState().deleteNode(module.id as AnyNodeId)
      // Deleting the last module cascades the empty run away too — only
      // keep it selected/dirty if it survived.
      if (useScene.getState().nodes[node.id as AnyNodeId]) {
        useScene.getState().dirtyNodes.add(node.id as AnyNodeId)
        setSelection({ selectedIds: [node.id] })
      } else {
        setSelection({ selectedIds: [] })
      }
    },
    [node.id, setSelection],
  )

  return (
    <PanelWrapper
      icon="/icons/furniture.webp"
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
        </div>
      </PanelSection>

      <PanelSection title="Shared Plinth & Countertop">
        <div className="space-y-2 px-1 pb-2">
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
    </PanelWrapper>
  )
}
