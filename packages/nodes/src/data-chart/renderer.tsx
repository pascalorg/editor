'use client'

import {
  type DataChartNode,
  useLiveData,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  clearRegistryHtmlDragOrigin,
  setRegistryHtmlDragOrigin,
  useEditor,
} from '@pascal-app/editor'
import { useNodeEvents } from '@pascal-app/viewer/node-events'
import useViewer from '@pascal-app/viewer/store'
import { Html } from '@react-three/drei'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import { withOpacity } from '../shared/css-color'
import { handleDataDisplayKeyboardNudge } from '../shared/data-display-keyboard'
import {
  formatLiveDataPathValue,
  liveDataPathLabel,
  numericLiveDataPathValue,
} from '../shared/live-data-format'

const DRAG_THRESHOLD_PX = 4

function normalizeValues(values: number[]) {
  const max = Math.max(1, ...values.map((value) => Math.abs(value)))
  return values.map((value) => Math.max(0.08, Math.min(1, Math.abs(value) / max)))
}

function LineChart({ accent, ratios }: { accent: string; ratios: number[] }) {
  const points = ratios
    .map((ratio, index) => {
      const x = ratios.length <= 1 ? 50 : (index / (ratios.length - 1)) * 100
      const y = 100 - ratio * 88
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg aria-hidden="true" className="h-16 w-full overflow-visible" viewBox="0 0 100 100">
      <polyline
        fill="none"
        points={points}
        stroke={accent}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="5"
      />
      {ratios.map((ratio, index) => {
        const x = ratios.length <= 1 ? 50 : (index / (ratios.length - 1)) * 100
        const y = 100 - ratio * 88
        return <circle cx={x} cy={y} fill={accent} key={`${index}:${ratio}`} r="4" />
      })}
    </svg>
  )
}

export default function DataChartRenderer({ node }: { node: DataChartNode }) {
  const ref = useRef<Group>(null!)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const handlers = useNodeEvents(node, 'data-chart')
  const liveTransform = useLiveTransforms((state) => state.get(node.id))
  const setSelection = useViewer((state) => state.setSelection)
  const [isHtmlPassthrough, setIsHtmlPassthrough] = useState(false)
  const paths = useLiveData((state) => state.paths)
  const liveValues = useLiveData((state) => state.values)
  const values = useMemo(
    () => node.dataKeys.map((dataKey) => numericLiveDataPathValue(liveValues, dataKey)),
    [node.dataKeys, liveValues],
  )
  const ratios = useMemo(() => normalizeValues(values), [values])
  const background = withOpacity(node.background ?? '#111827', node.backgroundOpacity ?? 1)
  const rotation: [number, number, number] =
    liveTransform?.rotation !== undefined ? [0, liveTransform.rotation, 0] : node.rotation
  const handleHtmlSelect = useCallback(
    (
      event:
        | React.PointerEvent<HTMLDivElement>
        | React.MouseEvent<HTMLDivElement>
        | React.KeyboardEvent<HTMLDivElement>,
    ) => {
      event.preventDefault()
      event.stopPropagation()
      setSelection({ selectedIds: [node.id] })
    },
    [node.id, setSelection],
  )
  const handleHtmlPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      handleHtmlSelect(event)
      setRegistryHtmlDragOrigin(node.id, event)
      dragStartRef.current = { x: event.clientX, y: event.clientY }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const start = dragStartRef.current
        if (!start) return
        if (
          Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < DRAG_THRESHOLD_PX
        )
          return

        dragStartRef.current = null
        setIsHtmlPassthrough(true)
        const liveNode = useScene.getState().nodes[node.id] ?? node
        useEditor.getState().setMovingNode(liveNode as never)
        window.removeEventListener('pointermove', handlePointerMove)
      }

      const handlePointerUp = () => {
        dragStartRef.current = null
        clearRegistryHtmlDragOrigin(node.id)
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.setTimeout(() => setIsHtmlPassthrough(false), 0)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp, { once: true })
    },
    [handleHtmlSelect, node],
  )

  useRegistry(node.id, 'data-chart', ref)

  return (
    <group
      position={liveTransform?.position ?? node.position}
      ref={ref}
      rotation={rotation}
      visible={node.visible}
    >
      <mesh name="collision-mesh" {...handlers}>
        <boxGeometry args={[1.65, 0.7, 0.08]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} opacity={0} transparent />
      </mesh>
      <Html
        center
        distanceFactor={8}
        pointerEvents={isHtmlPassthrough ? 'none' : 'auto'}
        zIndexRange={[80, 0]}
      >
        <div
          aria-label={node.name || 'Chart Widget'}
          className="min-w-56 cursor-pointer select-none rounded-lg border border-white/15 px-4 py-3 shadow-xl backdrop-blur-md focus:outline-none focus-visible:outline-none"
          onClick={handleHtmlSelect}
          onMouseDown={handleHtmlSelect}
          onPointerDown={handleHtmlPointerDown}
          onKeyDown={(event) => {
            if (handleDataDisplayKeyboardNudge(event, node)) return
            if (event.key === 'Enter' || event.key === ' ') handleHtmlSelect(event)
          }}
          role="button"
          style={{
            background,
            color: node.foreground,
            fontSize: node.fontSize,
            lineHeight: 1.2,
            outline: 'none',
            boxShadow: 'none',
          }}
          tabIndex={0}
        >
          <div className="mb-2 flex items-center justify-between gap-4">
            <span className="font-semibold">{node.title}</span>
            <span className="text-[0.72em] opacity-70">
              {node.chartType === 'bar' ? '柱状图' : '曲线图'}
            </span>
          </div>
          {node.chartType === 'bar' ? (
            <div className="flex h-16 items-end gap-2 border-white/10 border-b px-1">
              {ratios.map((ratio, index) => (
                <div className="flex min-w-6 flex-1 flex-col items-center gap-1" key={index}>
                  <span
                    className="w-full rounded-t-sm"
                    style={{
                      background: node.accent,
                      height: `${Math.round(ratio * 100)}%`,
                      opacity: 0.88,
                    }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="border-white/10 border-b px-1">
              <LineChart accent={node.accent} ratios={ratios} />
            </div>
          )}
          <div className="mt-2 grid gap-1">
            {node.dataKeys.map((dataKey, index) => (
              <div className="flex items-center justify-between gap-4 text-[0.78em]" key={dataKey}>
                <span className="truncate opacity-70">{liveDataPathLabel(paths, dataKey)}</span>
                <span className="font-semibold">
                  {formatLiveDataPathValue(paths, liveValues, dataKey)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Html>
    </group>
  )
}
