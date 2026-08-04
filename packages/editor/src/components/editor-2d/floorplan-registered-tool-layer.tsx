'use client'

import { createSceneApi, nodeRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type ComponentType, lazy, Suspense, useCallback, useMemo } from 'react'
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

const lazyToolCache = new WeakMap<() => Promise<unknown>, ComponentType<FloorplanToolContext>>()

function registeredFloorplanTool(
  tool: string | null,
  mode: FloorplanMode,
): ComponentType<FloorplanToolContext> | null {
  if (!tool) return null
  const extension = getFloorplanNodeExtension(nodeRegistry.get(tool))
  if (!isFloorplanToolAvailableInMode(extension?.availableModes, mode)) return null
  const loader = extension?.tool
  if (!loader) return null
  const cached = lazyToolCache.get(loader)
  if (cached) return cached
  const component = lazy(loader)
  lazyToolCache.set(loader, component)
  return component
}

export function FloorplanRegisteredToolLayer() {
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const floorplanMode = useFloorplanMode((state) => state.mode)
  const gridSnapStep = useEditor((state) => state.gridSnapStep)
  const toolDefaults = useEditor((state) =>
    state.tool ? (state.toolDefaults[state.tool] ?? null) : null,
  )
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
  if (mode !== 'build') return null
  const Tool = registeredFloorplanTool(tool, floorplanMode)
  return Tool ? (
    <Suspense fallback={null}>
      <Tool
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
