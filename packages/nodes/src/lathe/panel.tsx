'use client'

import { type AnyNode, type LatheNode, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
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

export default function LathePanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as LatheNode | undefined) : undefined,
  )

  const handleUpdate = useCallback(
    (updates: Partial<LatheNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleNudgePosition = useCallback(
    (axis: number, delta: number) => {
      if (!node) return
      triggerSFX('sfx:item-rotate')
      const pos = [...node.position] as [number, number, number]
      pos[axis] = Math.round((pos[axis]! + delta) * 100) / 100
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

  if (!(node && node.type === 'lathe' && selectedId && selectedCount === 1)) return null

  return (
    <PanelWrapper onClose={handleClose} title={node.name || 'Lathe'} width={300}>
      <PanelSection title={S.dimensions()}>
        <SliderControl
          label="Segments"
          max={128}
          min={8}
          onChange={(value) => handleUpdate({ segments: Math.round(value) })}
          precision={0}
          step={1}
          value={node.segments ?? 32}
        />
        <SliderControl
          label="Arc"
          max={360}
          min={1}
          onChange={(degrees) => handleUpdate({ arc: (degrees * Math.PI) / 180 })}
          precision={0}
          step={1}
          unit="deg"
          value={Math.round(((node.arc ?? Math.PI * 2) * 180) / Math.PI)}
        />
      </PanelSection>

      <NodeMaterialSection />

      <PanelSection title={S.position()}>
        <div className="flex items-center gap-1.5">
          <ActionButton label={L.left()} onClick={() => handleNudgePosition(0, -POSITION_NUDGE)} />
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
          <ActionButton label={L.right()} onClick={() => handleNudgePosition(0, POSITION_NUDGE)} />
        </div>
        <div className="flex items-center gap-1.5">
          <ActionButton label="Back" onClick={() => handleNudgePosition(2, -POSITION_NUDGE)} />
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
          <ActionButton label={L.front()} onClick={() => handleNudgePosition(2, POSITION_NUDGE)} />
        </div>
      </PanelSection>

      <PanelSection title={S.elevation()}>
        <div className="flex items-center gap-1.5">
          <ActionButton label={L.down()} onClick={() => handleNudgePosition(1, -POSITION_NUDGE)} />
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
          <ActionButton label={L.up()} onClick={() => handleNudgePosition(1, POSITION_NUDGE)} />
        </div>
      </PanelSection>

      <PanelSection title={S.rotation()}>
        {[0, 1, 2].map((axis) => (
          <div className="flex items-center gap-1.5" key={axis}>
            <ActionButton
              label={L.rotateMinus45()}
              onClick={() => handleNudgeRotation(axis, -ROTATION_NUDGE)}
            />
            <SliderControl
              label={axis === 0 ? L.x() : axis === 1 ? L.y() : L.z()}
              max={180}
              min={-180}
              onChange={(degrees) => {
                const rot = [...node.rotation] as [number, number, number]
                rot[axis] = (degrees * Math.PI) / 180
                handleUpdate({ rotation: rot })
              }}
              precision={0}
              step={1}
              unit="deg"
              value={Math.round((node.rotation[axis]! * 180) / Math.PI)}
            />
            <ActionButton
              label={L.rotatePlus45()}
              onClick={() => handleNudgeRotation(axis, ROTATION_NUDGE)}
            />
          </div>
        ))}
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
