'use client'

import type { SiteNode } from '@pascal-app/core'
import { sceneRegistry, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { getSceneTheme, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useMemo, useRef, useState } from 'react'
import { type Camera, type Object3D, Vector3 } from 'three'
import { formatLinearMeasurement } from '../../lib/measurements'
import { SITE_BOUNDARY_DRAG_LABEL } from '../../lib/site-boundary'
import { useActiveHandleDrag } from '../../store/use-interaction-scope'

type ViewportSize = {
  width: number
  height: number
}

const htmlPosition = new Vector3()

function calculateHtmlPosition(el: Object3D, camera: Camera, size: ViewportSize) {
  htmlPosition.setFromMatrixPosition(el.matrixWorld)
  htmlPosition.project(camera)

  const widthHalf = size.width / 2
  const heightHalf = size.height / 2
  return [htmlPosition.x * widthHalf + widthHalf, -htmlPosition.y * heightHalf + heightHalf]
}

export function SiteEdgeLabels() {
  // Narrow subscription to just the site node — subscribing to the full
  // s.nodes dict re-rendered this on every wall/level mutation even though
  // the site itself rarely changes.
  const siteNode = useScene((state) => {
    const firstRoot = state.rootNodeIds[0]
    if (!firstRoot) return null
    const node = state.nodes[firstRoot]
    return node?.type === 'site' ? (node as SiteNode) : null
  })
  const activeHandleDrag = useActiveHandleDrag()
  const unit = useViewer((state) => state.unit)
  const cameraMode = useViewer((state) => state.cameraMode)
  const isNight = useViewer((state) => getSceneTheme(state.sceneTheme).appearance === 'dark')
  const camera = useThree((state) => state.camera)
  // Drei Html can hold the previous default camera across a camera-object swap.
  const calculateLabelPosition = useCallback(
    (el: Object3D, _camera: Camera, size: ViewportSize) => calculateHtmlPosition(el, camera, size),
    [camera],
  )

  const siteNodeId = siteNode?.id
  const livePolygon = useLiveNodeOverrides((state) => {
    if (!siteNodeId) return null
    return (state.overrides.get(siteNodeId)?.polygon as SiteNode['polygon'] | undefined) ?? null
  })
  const polygon = livePolygon?.points ?? siteNode?.polygon?.points ?? []
  const shouldShowLabels =
    Boolean(siteNodeId) &&
    activeHandleDrag?.nodeId === siteNodeId &&
    activeHandleDrag?.label === SITE_BOUNDARY_DRAG_LABEL

  const color = isNight ? '#ffffff' : '#111111'
  const shadowColor = isNight ? '#111111' : '#ffffff'

  const [siteObj, setSiteObj] = useState<Object3D | null>(null)
  const prevSiteNodeIdRef = useRef<string | undefined>(undefined)

  // Poll each frame until the site group is registered.
  // Also resets when the site node ID changes (new project loaded).
  useFrame(() => {
    if (siteNodeId !== prevSiteNodeIdRef.current) {
      prevSiteNodeIdRef.current = siteNodeId
      setSiteObj(null)
      return
    }
    if (siteObj || !siteNodeId) return
    const obj = sceneRegistry.nodes.get(siteNodeId)
    if (obj) setSiteObj(obj)
  })

  const edges = useMemo(() => {
    if (polygon.length < 2) return []
    return polygon.map(([x1, z1], i) => {
      const [x2, z2] = polygon[(i + 1) % polygon.length]!
      const midX = (x1! + x2) / 2
      const midZ = (z1! + z2) / 2
      const dist = Math.sqrt((x2 - x1!) ** 2 + (z2 - z1!) ** 2)
      return { midX, midZ, dist }
    })
  }, [polygon])

  if (!shouldShowLabels || !siteObj || edges.length === 0) return null

  return createPortal(
    <>
      {edges.map((edge, i) => (
        <Html
          center
          calculatePosition={calculateLabelPosition}
          key={`${cameraMode}-${camera.uuid}-edge-${i}`}
          occlude
          position={[edge.midX, 0.5, edge.midZ]}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
          zIndexRange={[10, 0]}
        >
          <div
            className="whitespace-nowrap font-bold font-mono text-[15px]"
            style={{
              color,
              textShadow: `-1.5px -1.5px 0 ${shadowColor}, 1.5px -1.5px 0 ${shadowColor}, -1.5px 1.5px 0 ${shadowColor}, 1.5px 1.5px 0 ${shadowColor}, 0 0 4px ${shadowColor}, 0 0 4px ${shadowColor}`,
            }}
          >
            {formatLinearMeasurement(edge.dist, unit)}
          </div>
        </Html>
      ))}
    </>,
    siteObj,
  )
}
