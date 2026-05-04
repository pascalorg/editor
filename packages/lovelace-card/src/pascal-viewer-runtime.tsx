'use client'

import { useScene } from '@pascal-app/core'
import {
  HomeAssistantInteractiveSystem,
  type HomeAssistantDeviceActionDispatch,
} from '@pascal-app/home-assistant'
import { Viewer, ViewerFitCameraControls, useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { getArtifactBindings, getResourceEntityIds } from './artifact'
import { runHomeAssistantActionRequest } from './ha-actions'
import { PascalLovelaceHomeAssistantSystem } from './pascal-lovelace-system'
import type {
  HomeAssistantLike,
  PascalLovelaceSceneArtifact,
  PascalViewerCardConfig,
  PendingHomeAssistantState,
} from './types'

const cardShellStyle: React.CSSProperties = {
  background: 'var(--ha-card-background, var(--card-background-color, #111827))',
  borderRadius: 'var(--ha-card-border-radius, 12px)',
  boxShadow: 'var(--ha-card-box-shadow, 0 2px 6px rgba(0,0,0,0.28))',
  color: 'var(--primary-text-color, #fff)',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  overflow: 'hidden',
  position: 'relative',
  width: '100%',
}

const viewerWrapStyle: React.CSSProperties = {
  background: '#1f2433',
  flex: '1 1 auto',
  minHeight: 0,
  position: 'relative',
}

const PENDING_HOME_ASSISTANT_STATE_TTL_MS = 3500

function applyViewerDefaults(
  artifact: PascalLovelaceSceneArtifact,
  config: PascalViewerCardConfig,
) {
  const viewer = useViewer.getState()
  viewer.setTheme('dark')
  viewer.setShowGrid(false)
  viewer.setShowGuides(false)
  viewer.setShowScans(false)
  viewer.setLevelMode(artifact.viewer?.levelMode ?? 'solo')
  viewer.setWallMode(artifact.viewer?.wallMode ?? 'cutaway')
  viewer.setCameraMode('perspective')
  viewer.setProjectId('lovelace')

  const selectedLevelId = config.default_level ?? artifact.viewer?.defaultLevelId ?? null
  viewer.setSelection({
    levelId: selectedLevelId as never,
    selectedIds: [],
    zoneId: null,
  })
}

function getSceneBounds(artifact: PascalLovelaceSceneArtifact) {
  const min: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ]
  const max: [number, number, number] = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]
  let hasPoint = false

  const includePoint = (x: number, y: number, z: number) => {
    min[0] = Math.min(min[0], x)
    min[1] = Math.min(min[1], y)
    min[2] = Math.min(min[2], z)
    max[0] = Math.max(max[0], x)
    max[1] = Math.max(max[1], y)
    max[2] = Math.max(max[2], z)
    hasPoint = true
  }

  for (const node of Object.values(artifact.scene.nodes)) {
    if (!node || node.visible === false) {
      continue
    }

    if (node.type === 'zone' && Array.isArray(node.polygon)) {
      for (const point of node.polygon) {
        includePoint(point[0] ?? 0, 0, point[1] ?? 0)
      }
      continue
    }

    const position = (node as { position?: unknown }).position
    if (!Array.isArray(position)) {
      continue
    }

    const [x = 0, y = 0, z = 0] = position as number[]
    const asset = (node as { asset?: { dimensions?: unknown } }).asset
    if (node.type === 'item' && Array.isArray(asset?.dimensions)) {
      const [width = 1, height = 1, depth = 1] = asset.dimensions as number[]
      includePoint(x - width / 2, y, z - depth / 2)
      includePoint(x + width / 2, y + height, z + depth / 2)
    } else {
      includePoint(x, y, z)
    }
  }

  if (!hasPoint) {
    return { center: [0, 0, 0] as [number, number, number], radius: 10 }
  }

  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ]
  const spanX = max[0] - min[0]
  const spanY = max[1] - min[1]
  const spanZ = max[2] - min[2]
  const radius = Math.max(Math.hypot(spanX, spanZ) / 2, spanY, 8)

  return { center, radius }
}

function PascalLovelaceHeader({
  artifact,
  config,
  hass,
}: {
  artifact: PascalLovelaceSceneArtifact
  config: PascalViewerCardConfig
  hass: HomeAssistantLike | null
}) {
  if (config.show_header === false) {
    return null
  }

  const bindings = getArtifactBindings(artifact)
  const entityCount = bindings.reduce((sum, binding) => sum + binding.resources.length, 0)
  const connected = Boolean(hass)

  return (
    <div
      style={{
        alignItems: 'center',
        display: 'flex',
        flex: '0 0 auto',
        gap: 10,
        justifyContent: 'space-between',
        minHeight: 40,
        padding: '8px 12px',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700 }}>Pascal</div>
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          gap: 8,
          fontSize: 11,
          opacity: 0.82,
        }}
      >
        <span>{config.mode ?? artifact.viewer?.defaultMode ?? 'overview'}</span>
        <span>{entityCount} HA resources</span>
        <span style={{ color: connected ? '#86efac' : '#fca5a5' }}>
          {connected ? 'Live' : 'No HA state'}
        </span>
      </div>
    </div>
  )
}

export function PascalViewerRuntime({
  artifact,
  config,
  hass,
}: {
  artifact: PascalLovelaceSceneArtifact
  config: PascalViewerCardConfig
  eventTarget: HTMLElement
  hass: HomeAssistantLike | null
}) {
  const sceneBounds = useMemo(() => getSceneBounds(artifact), [artifact])
  const pendingHomeAssistantStateRef = useRef<Record<string, PendingHomeAssistantState>>({})
  const handleHomeAssistantDeviceAction = useCallback(
    async ({ binding, request }: HomeAssistantDeviceActionDispatch) => {
      if (!hass) {
        return
      }
      const pendingState: Omit<PendingHomeAssistantState, 'expiresAt'> | null =
        request.kind === 'toggle'
          ? { desiredOn: request.value }
          : request.kind === 'range' && request.capability === 'brightness'
            ? { brightnessPct: request.value }
            : null
      if (pendingState) {
        const expiresAt = Date.now() + PENDING_HOME_ASSISTANT_STATE_TTL_MS
        for (const resource of binding.resources) {
          for (const entityId of getResourceEntityIds(resource)) {
            pendingHomeAssistantStateRef.current[entityId] = {
              ...pendingState,
              expiresAt,
            }
          }
        }
      }
      await runHomeAssistantActionRequest({ binding, hass, request })
    },
    [hass],
  )

  useEffect(() => {
    const scene = useScene.getState()
    scene.setReadOnly(false)
    scene.setScene(artifact.scene.nodes, artifact.scene.rootNodeIds, artifact.scene.collections)
    scene.setReadOnly(true)
    applyViewerDefaults(artifact, config)

    return () => {
      const nextScene = useScene.getState()
      nextScene.setReadOnly(false)
      nextScene.unloadScene()
    }
  }, [artifact, config])

  return (
    <div
      style={{
        ...cardShellStyle,
      }}
    >
      <PascalLovelaceHeader artifact={artifact} config={config} hass={hass} />
      <div style={viewerWrapStyle}>
        <Viewer selectionManager="custom">
          <ViewerFitCameraControls center={sceneBounds.center} radius={sceneBounds.radius} />
          <PascalLovelaceHomeAssistantSystem
            hass={hass}
            pendingStateRef={pendingHomeAssistantStateRef}
          />
          <HomeAssistantInteractiveSystem
            onHomeAssistantDeviceAction={handleHomeAssistantDeviceAction}
          />
        </Viewer>
      </div>
    </div>
  )
}
