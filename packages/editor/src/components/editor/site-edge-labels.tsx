'use client'

import type { SiteNode } from '@pascal-app/core'
import { sceneRegistry, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { getSceneTheme, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useMemo, useRef, useState } from 'react'
import { type Camera, type Object3D, Vector3 } from 'three'
import { groundHeightAt } from '../../lib/ground-surface'
import { formatLinearMeasurement } from '../../lib/measurements'
import { SITE_BOUNDARY_DRAG_LABEL } from '../../lib/site-boundary'
import { useActiveHandleDrag } from '../../store/use-interaction-scope'

type ViewportSize = {
  width: number
  height: number
}

/**
 * How far the label floats above the ground under it.
 *
 * Was a bare `0.5` in the position literal, which on flat ground is the same thing.
 * Named now because it is no longer the label's *height* but its clearance: on a
 * sculpted lot the number underneath moves, and half a metre is what keeps the text
 * clear of a rim the boundary line is draped over.
 */
const LABEL_LIFT = 0.5

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

  // No live-terrain subscription here, deliberately: these labels only render while
  // a site-boundary handle drag is active, and sculpt mode hides those handles
  // (`siteBoundaryHandlesEnabled`), so the ground cannot move while they are on
  // screen. The drag itself rewrites `polygon` every frame, which is what re-runs
  // this — so the heights are always read against the field as of this frame.
  const edges = useMemo(() => {
    if (polygon.length < 2) return []
    return polygon.map(([x1, z1], i) => {
      const [x2, z2] = polygon[(i + 1) % polygon.length]!
      const midX = (x1! + x2) / 2
      const midZ = (z1! + z2) / 2
      // Length stays the *plan* length. A property line is a horizontal measurement
      // — a deed says 30 m whether the lot is flat or a hillside — and reporting the
      // slope distance would make the same lot appear to grow as it is sculpted.
      // Only the label's Y follows the ground.
      const dist = Math.sqrt((x2 - x1!) ** 2 + (z2 - z1!) ** 2)
      // `?? 0` covers both no-terrain cases, and 0 *is* the datum, so this reduces
      // to the flat constant it replaced whenever the lot is unsculpted.
      const groundY = groundHeightAt(midX, midZ, 0) ?? 0
      return { midX, midY: groundY + LABEL_LIFT, midZ, dist }
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
          position={[edge.midX, edge.midY, edge.midZ]}
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
