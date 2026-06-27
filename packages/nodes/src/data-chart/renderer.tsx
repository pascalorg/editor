'use client'

import {
  type DataChartNode,
  formatStaticLiveDataValue,
  getStaticLiveDataValue,
  STATIC_LIVE_DATA_OPTIONS,
  useRegistry,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useCallback, useMemo, useRef } from 'react'
import type { Group } from 'three'

function numericValue(dataKey: string): number {
  const value = getStaticLiveDataValue(dataKey)
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function dataLabel(dataKey: string): string {
  return STATIC_LIVE_DATA_OPTIONS.find((option) => option.value === dataKey)?.label ?? dataKey
}

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
  const handlers = useNodeEvents(node, 'data-chart')
  const setSelection = useViewer((state) => state.setSelection)
  const values = useMemo(() => node.dataKeys.map(numericValue), [node.dataKeys])
  const ratios = useMemo(() => normalizeValues(values), [values])
  const handleHtmlSelect = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setSelection({ selectedIds: [node.id] })
    },
    [node.id, setSelection],
  )

  useRegistry(node.id, 'data-chart', ref)

  return (
    <group position={node.position} ref={ref} rotation={node.rotation} visible={node.visible}>
      <mesh {...handlers}>
        <boxGeometry args={[1.65, 0.7, 0.08]} />
        <meshBasicMaterial opacity={0.02} transparent />
      </mesh>
      <Html center distanceFactor={8} pointerEvents="auto" zIndexRange={[80, 0]}>
        <div
          aria-label={node.name || 'Chart Widget'}
          className="min-w-56 cursor-pointer select-none rounded-lg border border-white/15 px-4 py-3 shadow-xl backdrop-blur-md"
          onPointerDown={handleHtmlSelect}
          role="button"
          style={{
            background: node.background,
            color: node.foreground,
            fontSize: node.fontSize,
            lineHeight: 1.2,
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
                <span className="truncate opacity-70">{dataLabel(dataKey)}</span>
                <span className="font-semibold">{formatStaticLiveDataValue(dataKey)}</span>
              </div>
            ))}
          </div>
        </div>
      </Html>
    </group>
  )
}
