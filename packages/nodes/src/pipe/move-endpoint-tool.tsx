'use client'

import { type PipeNode, getPipeEndpoint3D, useScene } from '@pascal-app/core'
import {
  CursorSphere,
  type MovingPipeEndpoint,
  type PipePlanPoint,
  triggerSFX,
  useDragAction,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useState } from 'react'
import { movePipeEndpointDragAction } from './actions/move-endpoint'

export const MovePipeEndpointTool: React.FC<{ target: MovingPipeEndpoint }> = ({ target }) => {
  const pipeId = target.pipe.id
  const endpoint = target.endpoint
  const initialPoint: PipePlanPoint =
    endpoint === 'start'
      ? [target.pipe.start[0], target.pipe.start[1]]
      : [target.pipe.end[0], target.pipe.end[1]]

  const [altPressed, setAltPressed] = useState(false)

  const exitMoveMode = (committed: boolean) => {
    if (committed) triggerSFX('sfx:item-place')
    useViewer.getState().setSelection({ selectedIds: [pipeId] })
    useEditor.getState().setMovingPipeEndpoint(null)
  }

  useDragAction({
    active: true,
    action: movePipeEndpointDragAction,
    initial: {
      node: target.pipe,
      handleId: endpoint,
      point: initialPoint,
    },
    onCommit: () => exitMoveMode(true),
    onCancel: () => exitMoveMode(false),
  })

  const live = useScene((s) => s.nodes[pipeId])
  const livePipe = live?.type === 'pipe' ? (live as PipeNode) : null
  const pipeFor3d = livePipe ?? target.pipe
  const endpoint3d = getPipeEndpoint3D(pipeFor3d, endpoint)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Alt') setAltPressed(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltPressed(false)
    }
    const onBlur = () => setAltPressed(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const cursorPos: [number, number, number] = [endpoint3d.x, endpoint3d.y, endpoint3d.z]

  return (
    <group>
      <CursorSphere position={cursorPos} showTooltip={false} />
      <Html
        position={cursorPos}
        style={{ pointerEvents: 'none', touchAction: 'none' }}
        zIndexRange={[100, 0]}
      >
        <div className="translate-y-10">
          <div
            className={`whitespace-nowrap rounded-full border px-2 py-1 font-medium text-[11px] shadow-lg backdrop-blur-md transition-colors ${
              altPressed
                ? 'border-amber-500/70 bg-amber-500/15 text-amber-100'
                : 'border-border/70 bg-background/90 text-foreground/80'
            }`}
          >
            {altPressed ? 'Detach endpoint' : 'Drag endpoint'}
          </div>
        </div>
      </Html>
    </group>
  )
}

export default MovePipeEndpointTool
