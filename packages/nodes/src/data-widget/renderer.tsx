'use client'

import {
  type DataWidgetNode,
  getStaticLiveDataValue,
  renderLiveDataTemplate,
  useRegistry,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useCallback, useMemo, useRef } from 'react'
import type { Group } from 'three'

function getWidgetClassName(widgetType: DataWidgetNode['widgetType']) {
  if (widgetType === 'badge') {
    return 'rounded-full border border-white/15 px-3 py-1.5 font-semibold shadow-lg backdrop-blur-md'
  }
  if (widgetType === 'card') {
    return 'min-w-40 rounded-xl border border-white/15 px-4 py-3 shadow-xl backdrop-blur-md'
  }
  if (widgetType === 'chart') {
    return 'min-w-44 rounded-xl border border-white/15 px-4 py-3 shadow-xl backdrop-blur-md'
  }
  return 'rounded-lg border border-white/15 px-3 py-2 font-medium shadow-lg backdrop-blur-md'
}

function ChartContent({ node, text }: { node: DataWidgetNode; text: string }) {
  const value = getStaticLiveDataValue(node.dataKey)
  const numericValue = typeof value === 'number' ? value : Number(value)
  const ratio = Number.isFinite(numericValue) ? Math.max(0, Math.min(100, numericValue)) : 0
  const bars = [0.35, 0.58, ratio / 100, 0.72, 0.46]

  return (
    <div className="flex min-w-40 flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-[0.72em] opacity-70">{node.title || 'Live Data'}</span>
        <span className="font-semibold">{text}</span>
      </div>
      <div className="flex h-12 items-end gap-1.5">
        {bars.map((bar, index) => (
          <span
            className="w-4 rounded-t-sm bg-current opacity-80"
            key={`${node.id}:bar:${index}`}
            style={{ height: `${Math.max(10, bar * 100)}%` }}
          />
        ))}
      </div>
    </div>
  )
}

export default function DataWidgetRenderer({ node }: { node: DataWidgetNode }) {
  const ref = useRef<Group>(null!)
  const handlers = useNodeEvents(node, 'data-widget')
  const setSelection = useViewer((state) => state.setSelection)
  const text = useMemo(
    () => renderLiveDataTemplate(node.template, node.dataKey),
    [node.template, node.dataKey],
  )
  const isEmpty = text.trim().length === 0
  const handleHtmlSelect = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setSelection({ selectedIds: [node.id] })
    },
    [node.id, setSelection],
  )

  useRegistry(node.id, 'data-widget', ref)

  return (
    <group position={node.position} ref={ref} rotation={node.rotation} visible={node.visible}>
      <mesh {...handlers}>
        <boxGeometry args={[1.2, 0.35, 0.08]} />
        <meshBasicMaterial opacity={0.02} transparent />
      </mesh>
      <Html center distanceFactor={8} pointerEvents="auto" zIndexRange={[80, 0]}>
        <div
          aria-label={node.name || 'Data Widget'}
          className={`${getWidgetClassName(node.widgetType)} cursor-pointer select-none`}
          onPointerDown={handleHtmlSelect}
          role="button"
          style={{
            background: isEmpty ? 'rgba(17, 24, 39, 0.55)' : node.background,
            color: node.foreground,
            fontSize: node.fontSize,
            lineHeight: 1.2,
            minHeight: isEmpty ? 24 : undefined,
            minWidth: isEmpty ? 40 : undefined,
            outline: isEmpty ? '1px dashed rgba(255,255,255,0.45)' : undefined,
            whiteSpace: 'nowrap',
          }}
          tabIndex={0}
        >
          {node.widgetType === 'chart' && !isEmpty ? (
            <ChartContent node={node} text={text} />
          ) : node.widgetType === 'card' ? (
            <div className="flex flex-col gap-1">
              {!isEmpty ? (
                <>
                  <span className="text-[0.72em] opacity-70">{node.title || 'Live Data'}</span>
                  <span>{text}</span>
                </>
              ) : null}
            </div>
          ) : (
            !isEmpty && text
          )}
        </div>
      </Html>
    </group>
  )
}
