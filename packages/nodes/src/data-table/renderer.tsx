'use client'

import {
  type DataTableNode,
  formatStaticLiveDataValue,
  STATIC_LIVE_DATA,
  STATIC_LIVE_DATA_OPTIONS,
  useRegistry,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useCallback, useRef } from 'react'
import type { Group } from 'three'

function dataLabel(dataKey: string): string {
  return STATIC_LIVE_DATA_OPTIONS.find((option) => option.value === dataKey)?.label ?? dataKey
}

export default function DataTableRenderer({ node }: { node: DataTableNode }) {
  const ref = useRef<Group>(null!)
  const handlers = useNodeEvents(node, 'data-table')
  const setSelection = useViewer((state) => state.setSelection)
  const handleHtmlSelect = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setSelection({ selectedIds: [node.id] })
    },
    [node.id, setSelection],
  )

  useRegistry(node.id, 'data-table', ref)

  return (
    <group position={node.position} ref={ref} rotation={node.rotation} visible={node.visible}>
      <mesh {...handlers}>
        <boxGeometry args={[1.8, 0.8, 0.08]} />
        <meshBasicMaterial opacity={0.02} transparent />
      </mesh>
      <Html center distanceFactor={8} pointerEvents="auto" zIndexRange={[80, 0]}>
        <div
          aria-label={node.name || 'Table Widget'}
          className="min-w-64 cursor-pointer select-none rounded-lg border border-white/15 px-4 py-3 shadow-xl backdrop-blur-md"
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
            <span className="text-[0.72em] opacity-70">列表</span>
          </div>
          <div className="overflow-hidden rounded-md border border-white/10">
            <div
              className="grid grid-cols-[1fr_auto_auto] gap-3 border-white/10 border-b px-2 py-1.5 font-semibold text-[0.72em]"
              style={{ color: node.accent }}
            >
              <span>名称</span>
              <span>数值</span>
              <span>单位</span>
            </div>
            {node.rows.map((row, index) => {
              const option = STATIC_LIVE_DATA[row.dataKey as keyof typeof STATIC_LIVE_DATA]
              const value = formatStaticLiveDataValue(row.dataKey)
              const match = /^(.*?)([a-zA-Z%°/]+)?$/.exec(value)
              return (
                <div
                  className="grid grid-cols-[1fr_auto_auto] gap-3 border-white/10 border-b px-2 py-1.5 last:border-b-0"
                  key={`${index}:${row.dataKey}`}
                >
                  <span className="truncate opacity-75">{row.label || dataLabel(row.dataKey)}</span>
                  <span className="font-semibold">{match?.[1]?.trim() || value}</span>
                  <span className="opacity-55">{option?.unit || match?.[2] || '-'}</span>
                </div>
              )
            })}
          </div>
        </div>
      </Html>
    </group>
  )
}
