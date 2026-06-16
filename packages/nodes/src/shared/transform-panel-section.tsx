'use client'

import { type AnyNodeId, sceneRegistry, useLiveTransforms } from '@pascal-app/core'
import {
  ActionButton,
  MetricControl,
  PanelSection,
  SliderControl,
  triggerSFX,
} from '@pascal-app/editor'
import { useCallback } from 'react'
import { L, S } from '../i18n/panel-labels'

type Vector3 = [number, number, number]

export type TransformPanelNode = {
  position: Vector3
  rotation: Vector3
}

type TransformPatch = Partial<Pick<TransformPanelNode, 'position' | 'rotation'>>

type Axis = 0 | 1 | 2

type TransformPanelSectionProps<TNode extends TransformPanelNode> = {
  node: TNode
  nodeId?: AnyNodeId
  onUpdate: (updates: Partial<TNode>) => void
  title?: string
  includePlanarPosition?: boolean
  includeElevation?: boolean
  includeRotation?: boolean
  includeFlip?: boolean
  rotationAxes?: readonly Axis[]
}

const POSITION_NUDGE = 0.1
const ROTATION_NUDGE = Math.PI / 4
const FLIP_NUDGE = Math.PI
const RAD_TO_DEG = 180 / Math.PI
const DEG_TO_RAD = Math.PI / 180

function rounded(value: number, precision = 2) {
  const scale = 10 ** precision
  return Math.round(value * scale) / scale
}

function axisLabel(axis: Axis) {
  if (axis === 0) return L.x()
  if (axis === 1) return L.y()
  return L.z()
}

function syncSceneObject(nodeId: AnyNodeId | undefined, updates: TransformPatch) {
  if (!nodeId) return
  useLiveTransforms.getState().clear(nodeId)

  const object = sceneRegistry.nodes.get(nodeId)
  if (object && updates.position) {
    object.position.set(updates.position[0], updates.position[1], updates.position[2])
  }
  if (object && updates.rotation) {
    object.rotation.set(updates.rotation[0], updates.rotation[1], updates.rotation[2])
  }
}

export function TransformPanelSection<TNode extends TransformPanelNode>({
  node,
  nodeId,
  onUpdate,
  title = S.transform(),
  includePlanarPosition = false,
  includeElevation = true,
  includeRotation = true,
  includeFlip = true,
  rotationAxes = [0, 1, 2],
}: TransformPanelSectionProps<TNode>) {
  const commit = useCallback(
    (updates: TransformPatch) => {
      syncSceneObject(nodeId, updates)
      onUpdate(updates as Partial<TNode>)
    },
    [nodeId, onUpdate],
  )

  const updatePosition = useCallback(
    (axis: Axis, value: number) => {
      const position = [...node.position] as Vector3
      position[axis] = rounded(value)
      commit({ position })
    },
    [commit, node.position],
  )

  const nudgePosition = useCallback(
    (axis: Axis, delta: number) => {
      triggerSFX('sfx:item-rotate')
      updatePosition(axis, node.position[axis] + delta)
    },
    [node.position, updatePosition],
  )

  const updateRotation = useCallback(
    (axis: Axis, value: number) => {
      const rotation = [...node.rotation] as Vector3
      rotation[axis] = rounded(value, 4)
      commit({ rotation })
    },
    [commit, node.rotation],
  )

  const nudgeRotation = useCallback(
    (axis: Axis, delta: number) => {
      triggerSFX('sfx:item-rotate')
      updateRotation(axis, node.rotation[axis] + delta)
    },
    [node.rotation, updateRotation],
  )

  return (
    <PanelSection title={title}>
      {includePlanarPosition ? (
        <>
          <div className="flex items-center gap-1.5">
            <ActionButton label={L.left()} onClick={() => nudgePosition(0, -POSITION_NUDGE)} />
            <SliderControl
              label={L.x()}
              max={50}
              min={-50}
              onChange={(value) => updatePosition(0, value)}
              precision={2}
              step={0.05}
              unit="m"
              value={rounded(node.position[0])}
            />
            <ActionButton label={L.right()} onClick={() => nudgePosition(0, POSITION_NUDGE)} />
          </div>
          <div className="flex items-center gap-1.5">
            <ActionButton label="后" onClick={() => nudgePosition(2, -POSITION_NUDGE)} />
            <SliderControl
              label={L.z()}
              max={50}
              min={-50}
              onChange={(value) => updatePosition(2, value)}
              precision={2}
              step={0.05}
              unit="m"
              value={rounded(node.position[2])}
            />
            <ActionButton label={L.front()} onClick={() => nudgePosition(2, POSITION_NUDGE)} />
          </div>
        </>
      ) : null}

      {includeElevation ? (
        <div className="flex items-center gap-1.5">
          <ActionButton label={L.down()} onClick={() => nudgePosition(1, -POSITION_NUDGE)} />
          <MetricControl
            label={L.height()}
            max={50}
            min={-50}
            onChange={(value) => updatePosition(1, value)}
            precision={2}
            step={0.05}
            unit="m"
            value={rounded(node.position[1])}
          />
          <ActionButton label={L.up()} onClick={() => nudgePosition(1, POSITION_NUDGE)} />
        </div>
      ) : null}

      {includeRotation
        ? rotationAxes.map((axis) => (
            <div className="flex items-center gap-1.5" key={axis}>
              <ActionButton
                label={L.rotateMinus45()}
                onClick={() => nudgeRotation(axis, -ROTATION_NUDGE)}
              />
              <SliderControl
                label={axisLabel(axis)}
                max={180}
                min={-180}
                onChange={(degrees) => updateRotation(axis, degrees * DEG_TO_RAD)}
                precision={0}
                step={1}
                unit="°"
                value={Math.round(node.rotation[axis] * RAD_TO_DEG)}
              />
              <ActionButton
                label={L.rotatePlus45()}
                onClick={() => nudgeRotation(axis, ROTATION_NUDGE)}
              />
            </div>
          ))
        : null}

      {includeRotation && includeFlip ? (
        <div
          className={
            rotationAxes.length === 1 ? 'grid grid-cols-1 gap-1.5' : 'grid grid-cols-3 gap-1.5'
          }
        >
          {rotationAxes.map((axis) => (
            <ActionButton
              key={axis}
              label={`翻转 ${axisLabel(axis)}`}
              onClick={() => nudgeRotation(axis, FLIP_NUDGE)}
            />
          ))}
        </div>
      ) : null}
    </PanelSection>
  )
}
