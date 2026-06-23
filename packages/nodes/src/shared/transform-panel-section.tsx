'use client'

import { type AnyNodeId, sceneRegistry, useLiveTransforms } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  MetricControl,
  PanelSection,
  SegmentedControl,
  SliderControl,
  triggerSFX,
} from '@pascal-app/editor'
import { useCallback, useState } from 'react'
import { L } from '../i18n/panel-labels'

type Vector3 = [number, number, number]

export type TransformPanelNode = {
  position: Vector3
  rotation: Vector3
}

type TransformPatch = Partial<Pick<TransformPanelNode, 'position' | 'rotation'>>

type Axis = 0 | 1 | 2
type TransformTab = 'position' | 'elevation' | 'rotation' | 'invert'

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

function invertLabel(axis: Axis) {
  if (axis === 0) return '\u524d\u540e\u5012\u8f6c'
  if (axis === 2) return '\u5de6\u53f3\u5012\u8f6c'
  return `${axisLabel(axis)} \u5012\u8f6c`
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
  title = '\u6574\u4f53\u53d8\u5f62',
  includePlanarPosition = false,
  includeElevation = true,
  includeRotation = true,
  includeFlip = true,
  rotationAxes = [0, 1, 2],
}: TransformPanelSectionProps<TNode>) {
  const [activeTab, setActiveTab] = useState<TransformTab>(() =>
    includeElevation ? 'elevation' : includeRotation ? 'rotation' : 'invert',
  )

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

  const rotationTabAxes =
    includeRotation && rotationAxes.includes(1) ? ([1] as const) : rotationAxes
  const invertAxes = includeRotation
    ? rotationAxes.filter((axis): axis is 0 | 2 => axis === 0 || axis === 2)
    : []
  const tabs: Array<{ label: string; value: TransformTab }> = [
    ...(includePlanarPosition ? [{ label: '\u5e73\u79fb', value: 'position' as const }] : []),
    ...(includeElevation ? [{ label: '\u4e0a\u4e0b', value: 'elevation' as const }] : []),
    ...(includeRotation && rotationTabAxes.length > 0
      ? [{ label: '\u65cb\u8f6c', value: 'rotation' as const }]
      : []),
    ...(includeFlip && invertAxes.length > 0
      ? [{ label: '\u5012\u8f6c', value: 'invert' as const }]
      : []),
  ]
  const visibleActiveTab = tabs.some((tab) => tab.value === activeTab)
    ? activeTab
    : (tabs[0]?.value ?? 'elevation')

  if (tabs.length === 0) return null

  return (
    <PanelSection title={title}>
      {tabs.length > 1 ? (
        <SegmentedControl<TransformTab>
          onChange={setActiveTab}
          options={tabs}
          value={visibleActiveTab}
        />
      ) : null}

      {includePlanarPosition && visibleActiveTab === 'position' ? (
        <div className="space-y-2 pt-2">
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
        </div>
      ) : null}

      {includeElevation && visibleActiveTab === 'elevation' ? (
        <div className="flex items-center gap-1.5 pt-2">
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

      {includeRotation && visibleActiveTab === 'rotation' ? (
        <div className="space-y-2 pt-2">
          {rotationTabAxes.map((axis) => (
            <div className="flex items-center gap-1.5" key={axis}>
              <ActionButton
                label={L.rotateMinus45()}
                onClick={() => nudgeRotation(axis, -ROTATION_NUDGE)}
              />
              <SliderControl
                label={`${axisLabel(axis)} \u65cb\u8f6c`}
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
          ))}
          {rotationTabAxes.includes(1) ? (
            <div className="grid grid-cols-4 gap-1.5">
              <ActionButton label="0°" onClick={() => updateRotation(1, 0)} />
              <ActionButton label="90°" onClick={() => updateRotation(1, Math.PI / 2)} />
              <ActionButton label="180°" onClick={() => updateRotation(1, Math.PI)} />
              <ActionButton label="270°" onClick={() => updateRotation(1, -Math.PI / 2)} />
            </div>
          ) : null}
        </div>
      ) : null}

      {includeRotation && includeFlip && visibleActiveTab === 'invert' ? (
        <div className="space-y-2 pt-2">
          {invertAxes.map((axis) => (
            <div className="flex items-center gap-1.5" key={axis}>
              <ActionButton
                label={L.rotateMinus45()}
                onClick={() => nudgeRotation(axis, -ROTATION_NUDGE)}
              />
              <SliderControl
                label={invertLabel(axis)}
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
          ))}
          <ActionGroup>
            <ActionButton
              label="放平"
              onClick={() => commit({ rotation: [0, node.rotation[1], 0] })}
            />
            <ActionButton
              label="倒置"
              onClick={() => commit({ rotation: [Math.PI, node.rotation[1], 0] })}
            />
          </ActionGroup>
        </div>
      ) : null}
    </PanelSection>
  )
}
