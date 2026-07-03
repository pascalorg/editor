'use client'

import {
  type DataWidgetNode,
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
import { renderLiveDataPathTemplate } from '../shared/live-data-format'

const DRAG_THRESHOLD_PX = 4

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

function getHitVolumeArgs(widgetType: DataWidgetNode['widgetType']): [number, number, number] {
  if (widgetType === 'card' || widgetType === 'chart') return [2.8, 1, 0.08]
  if (widgetType === 'badge') return [1.8, 0.5, 0.08]
  return [1.6, 0.5, 0.08]
}

function ChartContent({ node, text }: { node: DataWidgetNode; text: string }) {
  const value = useLiveData((state) => state.values[node.dataKey])
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
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const handlers = useNodeEvents(node, 'data-widget')
  const liveTransform = useLiveTransforms((state) => state.get(node.id))
  const setSelection = useViewer((state) => state.setSelection)
  const [isHtmlPassthrough, setIsHtmlPassthrough] = useState(false)
  const paths = useLiveData((state) => state.paths)
  const values = useLiveData((state) => state.values)
  const text = useMemo(
    () =>
      renderLiveDataPathTemplate({
        path: node.dataKey,
        paths,
        template: node.template,
        values,
      }),
    [node.template, node.dataKey, paths, values],
  )
  const isEmpty = text.trim().length === 0
  const background = withOpacity(node.background ?? '#111827', node.backgroundOpacity ?? 1)
  const hitVolumeArgs = useMemo(() => getHitVolumeArgs(node.widgetType), [node.widgetType])
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

  useRegistry(node.id, 'data-widget', ref)

  return (
    <group
      position={liveTransform?.position ?? node.position}
      ref={ref}
      rotation={rotation}
      visible={node.visible}
    >
      <mesh name="collision-mesh" {...handlers}>
        <boxGeometry args={hitVolumeArgs} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} opacity={0} transparent />
      </mesh>
      <Html
        center
        distanceFactor={8}
        pointerEvents={isHtmlPassthrough ? 'none' : 'auto'}
        zIndexRange={[80, 0]}
      >
        <div
          aria-label={node.name || '\u5355\u6807\u7b7e'}
          className={`${getWidgetClassName(node.widgetType)} cursor-pointer select-none focus:outline-none focus-visible:outline-none`}
          onClick={handleHtmlSelect}
          onMouseDown={handleHtmlSelect}
          onPointerDown={handleHtmlPointerDown}
          onKeyDown={(event) => {
            if (handleDataDisplayKeyboardNudge(event, node)) return
            if (event.key === 'Enter' || event.key === ' ') handleHtmlSelect(event)
          }}
          role="button"
          style={{
            background: isEmpty ? 'rgba(17, 24, 39, 0.55)' : background,
            color: node.foreground,
            fontSize: node.fontSize,
            lineHeight: 1.2,
            minHeight: isEmpty ? 24 : undefined,
            minWidth: isEmpty ? 40 : undefined,
            outline: isEmpty ? '1px dashed rgba(255,255,255,0.45)' : 'none',
            boxShadow: 'none',
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
