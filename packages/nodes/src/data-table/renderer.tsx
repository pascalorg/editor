'use client'

import {
  type DataTableNode,
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
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useCallback, useRef, useState } from 'react'
import type { Group } from 'three'
import { withOpacity } from '../shared/css-color'
import { formatLiveDataPathValue, liveDataPathLabel } from '../shared/live-data-format'

const DRAG_THRESHOLD_PX = 4

export default function DataTableRenderer({ node }: { node: DataTableNode }) {
  const ref = useRef<Group>(null!)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const handlers = useNodeEvents(node, 'data-table')
  const liveTransform = useLiveTransforms((state) => state.get(node.id))
  const setSelection = useViewer((state) => state.setSelection)
  const [isHtmlPassthrough, setIsHtmlPassthrough] = useState(false)
  const paths = useLiveData((state) => state.paths)
  const values = useLiveData((state) => state.values)
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

  useRegistry(node.id, 'data-table', ref)

  return (
    <group
      position={liveTransform?.position ?? node.position}
      ref={ref}
      rotation={rotation}
      visible={node.visible}
    >
      <mesh name="collision-mesh" {...handlers}>
        <boxGeometry args={[1.8, 0.8, 0.08]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} opacity={0} transparent />
      </mesh>
      <Html
        center
        distanceFactor={8}
        pointerEvents={isHtmlPassthrough ? 'none' : 'auto'}
        zIndexRange={[80, 0]}
      >
        <div
          aria-label={node.name || 'Table Widget'}
          className="min-w-64 cursor-pointer select-none rounded-lg border border-white/15 px-4 py-3 shadow-xl backdrop-blur-md focus:outline-none focus-visible:outline-none"
          onClick={handleHtmlSelect}
          onMouseDown={handleHtmlSelect}
          onPointerDown={handleHtmlPointerDown}
          onKeyDown={(event) => {
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
              const path = paths.find((entry) => entry.path === row.dataKey)
              const value = formatLiveDataPathValue(paths, values, row.dataKey)
              const match = /^(.*?)([a-zA-Z%°/]+)?$/.exec(value)
              return (
                <div
                  className="grid grid-cols-[1fr_auto_auto] gap-3 border-white/10 border-b px-2 py-1.5 last:border-b-0"
                  key={`${index}:${row.dataKey}`}
                >
                  <span className="truncate opacity-75">
                    {row.label || liveDataPathLabel(paths, row.dataKey)}
                  </span>
                  <span className="font-semibold">{match?.[1]?.trim() || value}</span>
                  <span className="opacity-55">{path?.unit || match?.[2] || '-'}</span>
                </div>
              )
            })}
          </div>
        </div>
      </Html>
    </group>
  )
}
