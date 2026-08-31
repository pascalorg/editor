'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '../../lib/utils'
import { FloorplanPreview, type FloorplanPreviewScene } from './floorplan-preview'
import {
  normalizeViewerStageModes,
  resolveMobileViewerStageMode,
  resolveViewerStageMode,
  type ViewerStageMode,
  viewerStageIncludes3D,
} from './viewer-stage-modes'
import { ViewerStageSwitcher } from './viewer-stage-switcher'

export type ViewerStageProps = {
  children?: ReactNode
  className?: string
  collapseSplitOnMobile?: boolean
  compassHost?: Element | null
  defaultMode?: ViewerStageMode
  floorplanClassName?: string
  levelId?: string | null
  mode?: ViewerStageMode
  modes?: readonly ViewerStageMode[]
  onLevelChange?: (levelId: string) => void
  onModeChange?: (mode: ViewerStageMode) => void
  scene?: FloorplanPreviewScene | null
  showCompass?: boolean
  showLevelSelector?: boolean
  showSwitcher?: boolean
  switcherClassName?: string
  synchronizeNavigation?: boolean
  threeDClassName?: string
}

const EMPTY_LEVEL_IDS: string[] = []

function levelNodeIds(nodes: Record<string, AnyNode>) {
  return Object.values(nodes)
    .filter((node) => node.type === 'level')
    .sort(
      (left, right) =>
        ((left as { level?: number }).level ?? 0) - ((right as { level?: number }).level ?? 0),
    )
    .map((node) => node.id)
}

function selectViewerLevel(nodes: Record<string, AnyNode>, levelId: string) {
  const level = nodes[levelId as AnyNodeId]
  if (level?.type !== 'level') return
  const building = level.parentId ? nodes[level.parentId as AnyNodeId] : null
  const viewer = useViewer.getState()
  viewer.setSelection({
    buildingId: building?.type === 'building' ? building.id : null,
    levelId: level.id,
    selectedIds: [],
    zoneId: null,
  })
  viewer.setLevelMode('solo')
}

export function ViewerStage({
  children,
  className,
  collapseSplitOnMobile = true,
  compassHost,
  defaultMode,
  floorplanClassName,
  levelId,
  mode: controlledMode,
  modes,
  onLevelChange,
  onModeChange,
  scene,
  showCompass = true,
  showLevelSelector = true,
  showSwitcher = true,
  switcherClassName,
  synchronizeNavigation = true,
  threeDClassName,
}: ViewerStageProps) {
  const enabledModes = normalizeViewerStageModes(modes)
  const [internalMode, setInternalMode] = useState(() =>
    resolveViewerStageMode(defaultMode, enabledModes),
  )
  const activeMode = resolveViewerStageMode(controlledMode ?? internalMode, enabledModes)
  const storeLevelIds = useScene(
    useShallow((state) => (scene ? EMPTY_LEVEL_IDS : levelNodeIds(state.nodes))),
  )
  const externalLevelIds = useMemo(() => (scene ? levelNodeIds(scene.nodes) : null), [scene])
  const levelIds = externalLevelIds ?? storeLevelIds
  const selectedLevelId = useViewer((state) => state.selection.levelId)
  const [internalLevelId, setInternalLevelId] = useState<string | null>(null)
  const [internalCompassHost, setInternalCompassHost] = useState<HTMLDivElement | null>(null)
  const resolvedCompassHost = compassHost ?? internalCompassHost
  const floorplanEnabled = enabledModes.includes('2d') || enabledModes.includes('split')
  const threeDEnabled = viewerStageIncludes3D(enabledModes)
  const mountFloorplan = floorplanEnabled || showCompass

  const requestMode = useCallback(
    (nextMode: ViewerStageMode) => {
      if (!enabledModes.includes(nextMode)) return
      if (controlledMode === undefined) setInternalMode(nextMode)
      onModeChange?.(nextMode)
    },
    [controlledMode, enabledModes, onModeChange],
  )

  useEffect(() => {
    if (controlledMode !== undefined) {
      if (controlledMode !== activeMode) onModeChange?.(activeMode)
      return
    }
    if (internalMode !== activeMode) setInternalMode(activeMode)
  }, [activeMode, controlledMode, internalMode, onModeChange])

  useEffect(() => {
    if (!collapseSplitOnMobile) return
    const mediaQuery = window.matchMedia('(max-width: 767px)')
    const resolveMode = () => {
      if (!mediaQuery.matches) return
      const nextMode = resolveMobileViewerStageMode(activeMode, enabledModes)
      if (nextMode !== activeMode) requestMode(nextMode)
    }
    resolveMode()
    mediaQuery.addEventListener('change', resolveMode)
    return () => mediaQuery.removeEventListener('change', resolveMode)
  }, [activeMode, collapseSplitOnMobile, enabledModes, requestMode])

  const chooseLevel = useCallback(
    (nextLevelId: string, notify = true) => {
      setInternalLevelId(nextLevelId)
      selectViewerLevel(scene?.nodes ?? useScene.getState().nodes, nextLevelId)
      if (notify) onLevelChange?.(nextLevelId)
    },
    [onLevelChange, scene],
  )

  useEffect(() => {
    if (activeMode === '3d' || levelIds.length === 0) return
    const nextLevelId =
      (levelId && levelIds.includes(levelId) ? levelId : null) ??
      (selectedLevelId && levelIds.includes(selectedLevelId) ? selectedLevelId : null) ??
      (internalLevelId && levelIds.includes(internalLevelId) ? internalLevelId : null) ??
      levelIds[0] ??
      null
    if (nextLevelId) chooseLevel(nextLevelId, false)
  }, [activeMode, chooseLevel, internalLevelId, levelId, levelIds, selectedLevelId])

  return (
    <div
      className={cn('relative h-full w-full overflow-hidden bg-neutral-100', className)}
      data-pascal-navigation-sync={synchronizeNavigation ? 'on' : 'off'}
      data-pascal-viewer-stage={activeMode}
    >
      {showCompass && compassHost === undefined ? (
        <div className="pointer-events-none absolute inset-0 z-30" ref={setInternalCompassHost} />
      ) : null}

      {showSwitcher && enabledModes.length > 1 ? (
        <ViewerStageSwitcher
          className={switcherClassName}
          hideSplitOnMobile={collapseSplitOnMobile}
          mode={activeMode}
          modes={enabledModes}
          onChange={requestMode}
        />
      ) : null}

      <div
        className={
          activeMode === 'split'
            ? 'absolute inset-0 grid grid-rows-2 md:grid-cols-2 md:grid-rows-1'
            : 'absolute inset-0'
        }
      >
        {threeDEnabled ? (
          <div
            className={cn(
              activeMode === '2d'
                ? 'pointer-events-none invisible absolute inset-0 h-full w-full'
                : 'relative h-full min-h-0 w-full min-w-0',
              threeDClassName,
            )}
            data-pascal-viewer-3d
          >
            {children}
          </div>
        ) : null}

        {mountFloorplan ? (
          <FloorplanPreview
            className={cn(
              activeMode === '3d'
                ? 'hidden'
                : activeMode === 'split'
                  ? 'min-h-0 min-w-0 border-border border-t md:border-t-0 md:border-l'
                  : 'h-full w-full',
              floorplanClassName,
            )}
            compassHost={resolvedCompassHost}
            levelId={levelId ?? internalLevelId}
            navigationVisible={activeMode !== '3d'}
            onLevelChange={chooseLevel}
            scene={scene}
            showCompass={showCompass}
            showLevelSelector={showLevelSelector}
            synchronizeNavigation={synchronizeNavigation}
          />
        ) : null}
      </div>
    </div>
  )
}
