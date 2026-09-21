'use client'

import { createSceneApi, nodeRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type ComponentType, lazy, Suspense, useCallback, useMemo } from 'react'
import { useRegisteredToolEnabled } from '../../hooks/use-registered-tool-enabled'
import {
  type FloorplanToolContext,
  getFloorplanNodeExtension,
} from '../../lib/floorplan/floorplan-extension'
import {
  type FloorplanMode,
  isFloorplanToolAvailableInMode,
} from '../../lib/floorplan/floorplan-mode'
import useEditor from '../../store/use-editor'
import useFloorplanMode from '../../store/use-floorplan-mode'
import useInteractionScope, { useReshapingNode } from '../../store/use-interaction-scope'

type Loader = () => Promise<{ default: ComponentType<FloorplanToolContext> }>
const lazyToolCache = new WeakMap<Loader, ComponentType<FloorplanToolContext>>()

function lazyTool(loader: Loader | undefined): ComponentType<FloorplanToolContext> | null {
  if (!loader) return null
  const cached = lazyToolCache.get(loader)
  if (cached) return cached
  const component = lazy(loader)
  lazyToolCache.set(loader, component)
  return component
}

function registeredFloorplanTool(
  tool: string | null,
  mode: FloorplanMode,
): ComponentType<FloorplanToolContext> | null {
  if (!tool) return null
  const extension = getFloorplanNodeExtension(nodeRegistry.get(tool))
  if (!isFloorplanToolAvailableInMode(extension?.availableModes, mode)) return null
  return lazyTool(extension?.tool)
}

/** The plan sibling of `def.affordanceTools[reshape]`: a kind's layer for its own reshape. */
function registeredReshapeLayer(
  kind: string | null,
  reshape: string | null,
): ComponentType<FloorplanToolContext> | null {
  if (!(kind && reshape)) return null
  return lazyTool(getFloorplanNodeExtension(nodeRegistry.get(kind))?.reshapeLayers?.[reshape])
}

export function FloorplanRegisteredToolLayer() {
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const registeredToolEnabled = useRegisteredToolEnabled(tool)
  const floorplanMode = useFloorplanMode((state) => state.mode)
  const gridSnapStep = useEditor((state) => state.gridSnapStep)
  const toolDefaults = useEditor((state) =>
    state.tool ? (state.toolDefaults[state.tool] ?? null) : null,
  )
  const reshape = useInteractionScope((state) =>
    state.scope.kind === 'reshaping' ? state.scope.reshape : null,
  )
  const reshapingNode = useReshapingNode()
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const sceneApi = useMemo(() => createSceneApi(useScene), [])
  const selectNode = useCallback(
    (id: Parameters<FloorplanToolContext['selectNode']>[0]) =>
      useViewer.getState().setSelection({ selectedIds: [id] }),
    [],
  )
  const finishTool = useCallback(() => {
    useEditor.getState().setTool(null)
    useEditor.getState().setMode('select')
  }, [])
  const Active =
    registeredReshapeLayer(reshapingNode?.type ?? null, reshape) ??
    (mode === 'build' && registeredToolEnabled
      ? registeredFloorplanTool(tool, floorplanMode)
      : null)
  return Active ? (
    <Suspense fallback={null}>
      <Active
        activeLevelId={activeLevelId}
        finishTool={finishTool}
        gridSnapStep={gridSnapStep}
        metricNotation={metricNotation}
        sceneApi={sceneApi}
        selectNode={selectNode}
        toolDefaults={toolDefaults}
        unit={unit}
      />
    </Suspense>
  ) : null
}
