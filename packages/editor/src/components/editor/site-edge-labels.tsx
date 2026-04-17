'use client'

import type { SiteNode } from '@pascal-app/core'
import { sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { createPortal, useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import type { Object3D } from 'three'

function formatMeasurement(value: number, unit: 'metric' | 'imperial') {
  if (unit === 'imperial') {
    const feet = value * 3.280_84
    const wholeFeet = Math.floor(feet)
    const inches = Math.round((feet - wholeFeet) * 12)
    if (inches === 12) return `${wholeFeet + 1}'0"`
    return `${wholeFeet}'${inches}"`
  }
  return `${Number.parseFloat(value.toFixed(2))}m`
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
  const unit = useViewer((state) => state.unit)
  const theme = useViewer((state) => state.theme)

  const siteNodeId = siteNode?.id

  const isNight = theme === 'dark'
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
    const polygon = siteNode?.polygon?.points ?? []
    if (polygon.length < 2) return []
    return polygon.map(([x1, z1], i) => {
      const [x2, z2] = polygon[(i + 1) % polygon.length]!
      const midX = (x1! + x2) / 2
      const midZ = (z1! + z2) / 2
      const dist = Math.sqrt((x2 - x1!) ** 2 + (z2 - z1!) ** 2)
      return { midX, midZ, dist }
    })
  }, [siteNode?.polygon?.points])

  if (!siteObj || edges.length === 0) return null

  return createPortal(
    <>
      {edges.map((edge, i) => (
        <Html
          center
          key={`edge-${i}`}
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
            {formatMeasurement(edge.dist, unit)}
          </div>
        </Html>
      ))}
    </>,
    siteObj,
  )
}
