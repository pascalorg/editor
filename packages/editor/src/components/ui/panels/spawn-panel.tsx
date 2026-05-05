'use client'

import { type AnyNode, type SpawnNode, useLiveTransforms, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Move, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

export function SpawnPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as SpawnNode | undefined) : undefined,
  )
  const [draftRotation, setDraftRotation] = useState<number | null>(null)

  useEffect(() => {
    if (!(node && node.type === 'spawn')) {
      setDraftRotation(null)
      return
    }

    setDraftRotation(node.rotation)
    useLiveTransforms.getState().clear(node.id)
  }, [node?.id, node?.rotation, node?.type])

  const handleUpdate = useCallback(
    (updates: Partial<SpawnNode>) => {
      if (!(selectedId && node)) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [node, selectedId, updateNode],
  )

  const handleRotationChange = useCallback(
    (degrees: number) => {
      if (!(node && selectedId)) return
      const nextRotation = (degrees * Math.PI) / 180
      setDraftRotation(nextRotation)
      useLiveTransforms.getState().set(selectedId as AnyNode['id'], {
        position: [...node.position],
        rotation: nextRotation,
      })
    },
    [node, selectedId],
  )

  const commitRotation = useCallback(
    (degrees: number) => {
      if (!(node && selectedId)) return
      const nextRotation = (degrees * Math.PI) / 180
      useLiveTransforms.getState().clear(selectedId as AnyNode['id'])
      setDraftRotation(nextRotation)
      if (Math.abs(nextRotation - node.rotation) > 1e-6) {
        updateNode(selectedId as AnyNode['id'], { rotation: nextRotation })
      }
    },
    [node, selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleMove = useCallback(() => {
    if (!node) return
    sfxEmitter.emit('sfx:item-pick')
    setMovingNode(node)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  const handleDelete = useCallback(() => {
    if (!selectedId) return
    sfxEmitter.emit('sfx:structure-delete')
    deleteNode(selectedId as AnyNode['id'])
    setSelection({ selectedIds: [] })
  }, [deleteNode, selectedId, setSelection])

  if (!(node && node.type === 'spawn' && selectedId)) return null

  const rotationDegrees = Math.round((((draftRotation ?? node.rotation) * 180) / Math.PI))
  const storedRotationDegrees = Math.round((node.rotation * 180) / Math.PI)

  return (
    <PanelWrapper icon="/icons/site.png" onClose={handleClose} title="Spawn Point" width={300}>
      <PanelSection title="Position">
        <SliderControl
          label="X"
          max={node.position[0] + 2}
          min={node.position[0] - 2}
          onChange={(value) => handleUpdate({ position: [value, node.position[1], node.position[2]] })}
          precision={2}
          step={0.01}
          unit="m"
          value={Math.round(node.position[0] * 100) / 100}
        />
        <SliderControl
          label="Y"
          max={node.position[1] + 2}
          min={node.position[1] - 2}
          onChange={(value) => handleUpdate({ position: [node.position[0], value, node.position[2]] })}
          precision={2}
          step={0.01}
          unit="m"
          value={Math.round(node.position[1] * 100) / 100}
        />
        <SliderControl
          label="Z"
          max={node.position[2] + 2}
          min={node.position[2] - 2}
          onChange={(value) => handleUpdate({ position: [node.position[0], node.position[1], value] })}
          precision={2}
          step={0.01}
          unit="m"
          value={Math.round(node.position[2] * 100) / 100}
        />
      </PanelSection>

      <PanelSection title="Facing">
        <SliderControl
          label="Yaw"
          max={storedRotationDegrees + 90}
          min={storedRotationDegrees - 90}
          onChange={handleRotationChange}
          onCommit={commitRotation}
          precision={0}
          step={1}
          unit="°"
          value={rotationDegrees}
        />
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton icon={<Move className="h-4 w-4" />} label="Move" onClick={handleMove} />
          <ActionButton
            className="border-red-500/40 text-red-200 hover:bg-red-500/15"
            icon={<Trash2 className="h-4 w-4" />}
            label="Delete"
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
