'use client'

import { type AnyNode, type BoxNode, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  MetricControl,
  NodeMaterialSection,
  PanelSection,
  PanelWrapper,
  SliderControl,
  triggerSFX,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { L, S } from '../i18n/panel-labels'

const POSITION_NUDGE = 0.1
const ROTATION_NUDGE = Math.PI / 4

export default function BoxPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as BoxNode | undefined) : undefined,
  )

  const handleUpdate = useCallback(
    (updates: Partial<BoxNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleNudgeX = useCallback(
    (delta: number) => {
      if (!node) return
      triggerSFX('sfx:item-rotate')
      const pos = [...node.position] as [number, number, number]
      pos[0] = Math.round((pos[0] + delta) * 100) / 100
      handleUpdate({ position: pos })
    },
    [node, handleUpdate],
  )

  const handleNudgeY = useCallback(
    (delta: number) => {
      if (!node) return
      triggerSFX('sfx:item-rotate')
      const pos = [...node.position] as [number, number, number]
      pos[1] = Math.round((pos[1] + delta) * 100) / 100
      handleUpdate({ position: pos })
    },
    [node, handleUpdate],
  )

  const handleNudgeZ = useCallback(
    (delta: number) => {
      if (!node) return
      triggerSFX('sfx:item-rotate')
      const pos = [...node.position] as [number, number, number]
      pos[2] = Math.round((pos[2] + delta) * 100) / 100
      handleUpdate({ position: pos })
    },
    [node, handleUpdate],
  )

  const handleNudgeRotation = useCallback(
    (axis: number, delta: number) => {
      if (!node) return
      triggerSFX('sfx:item-rotate')
      const rot = [...node.rotation] as [number, number, number]
      rot[axis] = Math.round((rot[axis]! + delta) * 100) / 100
      handleUpdate({ rotation: rot })
    },
    [node, handleUpdate],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    triggerSFX('sfx:item-delete')
    const parentId = node.parentId
    useScene.getState().deleteNode(selectedId as AnyNode['id'])
    if (parentId) {
      useScene.getState().dirtyNodes.add(parentId as AnyNode['id'])
    }
    setSelection({ selectedIds: [] })
  }, [selectedId, node, setSelection])

  if (!(node && node.type === 'box' && selectedId && selectedCount === 1)) return null

  return (
    <PanelWrapper
      icon="/icons/cube.png"
      onClose={handleClose}
      title={node.name || 'Box'}
      width={300}
    >
      <PanelSection title={S.dimensions()}>
        <MetricControl
          label={L.length()}
          max={20}
          min={0.1}
          onChange={(value) => handleUpdate({ length: value })}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round((node.length ?? 1) * 100) / 100}
        />
        <MetricControl
          label={L.width()}
          max={20}
          min={0.1}
          onChange={(value) => handleUpdate({ width: value })}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round((node.width ?? 1) * 100) / 100}
        />
        <MetricControl
          label={L.height()}
          max={20}
          min={0.1}
          onChange={(value) => handleUpdate({ height: value })}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round((node.height ?? 1) * 100) / 100}
        />
        <MetricControl
          label="Corner radius"
          max={Math.max(0, Math.min(node.length ?? 1, node.width ?? 1, node.height ?? 1) / 2)}
          min={0}
          onChange={(value) => handleUpdate({ cornerRadius: value })}
          precision={2}
          step={0.01}
          unit="m"
          value={Math.round((node.cornerRadius ?? 0) * 100) / 100}
        />
      </PanelSection>

      <NodeMaterialSection />

      <PanelSection title={S.position()}>
        <div className="flex items-center gap-1.5">
          <ActionButton label={L.left()} onClick={() => handleNudgeX(-POSITION_NUDGE)} />
          <SliderControl
            label={L.x()}
            max={50}
            min={-50}
            onChange={(v) => {
              const pos = [...node.position] as [number, number, number]
              pos[0] = v
              handleUpdate({ position: pos })
            }}
            precision={2}
            step={0.05}
            unit="m"
            value={Math.round(node.position[0] * 100) / 100}
          />
          <ActionButton label={L.right()} onClick={() => handleNudgeX(POSITION_NUDGE)} />
        </div>
        <div className="flex items-center gap-1.5">
          <ActionButton label="Back" onClick={() => handleNudgeZ(-POSITION_NUDGE)} />
          <SliderControl
            label={L.z()}
            max={50}
            min={-50}
            onChange={(v) => {
              const pos = [...node.position] as [number, number, number]
              pos[2] = v
              handleUpdate({ position: pos })
            }}
            precision={2}
            step={0.05}
            unit="m"
            value={Math.round(node.position[2] * 100) / 100}
          />
          <ActionButton label={L.front()} onClick={() => handleNudgeZ(POSITION_NUDGE)} />
        </div>
      </PanelSection>

      <PanelSection title={S.elevation()}>
        <div className="flex items-center gap-1.5">
          <ActionButton label={L.down()} onClick={() => handleNudgeY(-POSITION_NUDGE)} />
          <SliderControl
            label={L.y()}
            max={50}
            min={-50}
            onChange={(v) => {
              const pos = [...node.position] as [number, number, number]
              pos[1] = v
              handleUpdate({ position: pos })
            }}
            precision={2}
            step={0.05}
            unit="m"
            value={Math.round(node.position[1] * 100) / 100}
          />
          <ActionButton label={L.up()} onClick={() => handleNudgeY(POSITION_NUDGE)} />
        </div>
      </PanelSection>

      <PanelSection title={S.rotation()}>
        <div className="flex items-center gap-1.5">
          <ActionButton
            label={L.rotateMinus45()}
            onClick={() => handleNudgeRotation(0, -ROTATION_NUDGE)}
          />
          <SliderControl
            label={L.x()}
            max={180}
            min={-180}
            onChange={(degrees) => {
              const rot = [...node.rotation] as [number, number, number]
              rot[0] = (degrees * Math.PI) / 180
              handleUpdate({ rotation: rot })
            }}
            precision={0}
            step={1}
            unit="°"
            value={Math.round((node.rotation[0] * 180) / Math.PI)}
          />
          <ActionButton
            label={L.rotatePlus45()}
            onClick={() => handleNudgeRotation(0, ROTATION_NUDGE)}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <ActionButton
            label={L.rotateMinus45()}
            onClick={() => handleNudgeRotation(1, -ROTATION_NUDGE)}
          />
          <SliderControl
            label={L.y()}
            max={180}
            min={-180}
            onChange={(degrees) => {
              const rot = [...node.rotation] as [number, number, number]
              rot[1] = (degrees * Math.PI) / 180
              handleUpdate({ rotation: rot })
            }}
            precision={0}
            step={1}
            unit="°"
            value={Math.round((node.rotation[1] * 180) / Math.PI)}
          />
          <ActionButton
            label={L.rotatePlus45()}
            onClick={() => handleNudgeRotation(1, ROTATION_NUDGE)}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <ActionButton
            label={L.rotateMinus45()}
            onClick={() => handleNudgeRotation(2, -ROTATION_NUDGE)}
          />
          <SliderControl
            label={L.z()}
            max={180}
            min={-180}
            onChange={(degrees) => {
              const rot = [...node.rotation] as [number, number, number]
              rot[2] = (degrees * Math.PI) / 180
              handleUpdate({ rotation: rot })
            }}
            precision={0}
            step={1}
            unit="°"
            value={Math.round((node.rotation[2] * 180) / Math.PI)}
          />
          <ActionButton
            label={L.rotatePlus45()}
            onClick={() => handleNudgeRotation(2, ROTATION_NUDGE)}
          />
        </div>
      </PanelSection>

      <PanelSection title={S.actions()}>
        <ActionGroup>
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            label={L.delete()}
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
