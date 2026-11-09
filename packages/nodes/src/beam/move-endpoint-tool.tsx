'use client'

import {
  type AnyNode,
  type BeamNode,
  beamTopElevation,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  MeasurementPill,
  triggerSFX,
  useDragAction,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { createPortal } from '@react-three/fiber'
import { moveBeamEndpointDragAction } from './actions/move-endpoint'

/**
 * The reshaped node and which end: the tool manager builds it from the endpoint scope, naming a
 * kind it has no slot for under `wall`.
 */
export type MovingBeamEndpoint = {
  wall?: AnyNode
  fence?: AnyNode
  beam?: AnyNode
  endpoint: 'start' | 'end'
}

/**
 * A beam's end dragged in 3D: the thin wrapper around `moveBeamEndpointDragAction`, which owns
 * the snapping and the single undo step. Shows the cursor at the moving end and the beam's height,
 * length and width while it runs. Mounted by the tool manager from `move-endpoint`.
 */
export const MoveBeamEndpointTool: React.FC<{ target: MovingBeamEndpoint }> = ({ target }) => {
  const initial = (target.beam ?? target.wall ?? target.fence) as BeamNode | undefined
  const unit = useViewer((state) => state.unit)
  const beamId = initial?.id
  const live = useScene((state) => (beamId ? state.nodes[beamId] : undefined))
  const beam = live?.type === 'beam' ? live : initial
  const top = useScene((state) => (beam ? beamTopElevation(state.nodes, beam) : 0))

  const exit = (committed: boolean) => {
    if (committed) triggerSFX('sfx:item-place')
    if (beamId) useViewer.getState().setSelection({ selectedIds: [beamId] })
    useInteractionScope
      .getState()
      .endIf((scope) => scope.kind === 'reshaping' && scope.reshape === 'endpoint')
  }

  useDragAction({
    active: initial?.type === 'beam',
    action: moveBeamEndpointDragAction,
    initial: {
      node: initial,
      handleId: target.endpoint,
      point: initial ? initial[target.endpoint] : [0, 0],
    },
    onCommit: () => exit(true),
    onCancel: () => exit(false),
  })

  const level = beam?.parentId ? sceneRegistry.nodes.get(beam.parentId) : undefined
  if (!(beam?.type === 'beam' && level)) return null
  const moving = beam[target.endpoint]
  const length = Math.hypot(beam.end[0] - beam.start[0], beam.end[1] - beam.start[1])
  // In the beam's level, where its top is measured.
  return createPortal(
    <group>
      <CursorSphere position={[moving[0], top, moving[1]]} showTooltip={false} />
      <Html
        center
        position={[(beam.start[0] + beam.end[0]) / 2, top + 0.3, (beam.start[1] + beam.end[1]) / 2]}
        style={{ pointerEvents: 'none', touchAction: 'none' }}
        zIndexRange={[100, 0]}
      >
        <MeasurementPill
          height={beam.depth}
          length={length}
          primary="length"
          thickness={beam.width}
          unit={unit}
        />
      </Html>
    </group>,
    level,
  )
}

export default MoveBeamEndpointTool
