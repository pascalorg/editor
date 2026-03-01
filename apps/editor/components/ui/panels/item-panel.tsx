'use client'

import { getScaledDimensions, type AnyNode, ItemNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Link, Link2Off, Move, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import useEditor from '@/store/use-editor'
import { sfxEmitter } from '@/lib/sfx-bus'
import { cn } from '@/lib/utils'

import { PanelWrapper } from './panel-wrapper'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { MetricControl } from '../controls/metric-control'
import { ActionButton, ActionGroup } from '../controls/action-button'

export function ItemPanel() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const setSelection = useViewer((s) => s.setSelection)
  const nodes = useScene((s) => s.nodes)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const selectedId = selectedIds[0]
  const node = selectedId
    ? (nodes[selectedId as AnyNode['id']] as ItemNode | undefined)
    : undefined

  const [uniformScale, setUniformScale] = useState(true)

  const handleUpdate = useCallback(
    (updates: Partial<ItemNode>) => {
      if (!selectedId || !node) return
      updateNode(selectedId as AnyNode['id'], updates)

      if (node.asset.attachTo === 'wall' && node.parentId) {
        requestAnimationFrame(() => {
          useScene.getState().dirtyNodes.add(node.parentId as AnyNode['id'])
        })
      }
    },
    [selectedId, node, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleMove = useCallback(() => {
    if (node) {
      sfxEmitter.emit('sfx:item-pick')
      setMovingNode(node)
      setSelection({ selectedIds: [] })
    }
  }, [node, setMovingNode, setSelection])

  const handleDuplicate = useCallback(() => {
    if (!node) return
    sfxEmitter.emit('sfx:item-pick')
    const proto = ItemNode.parse({
      position: [...node.position] as [number, number, number],
      rotation: [...node.rotation] as [number, number, number],
      name: node.name,
      asset: node.asset,
      parentId: node.parentId,
      side: node.side,
      metadata: { isNew: true },
    })
    setMovingNode(proto)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  const handleDelete = useCallback(() => {
    if (!selectedId) return
    sfxEmitter.emit('sfx:item-delete')
    deleteNode(selectedId as AnyNode['id'])
    setSelection({ selectedIds: [] })
  }, [selectedId, deleteNode, setSelection])

  if (!node || node.type !== 'item' || selectedIds.length !== 1) return null

  return (
    <PanelWrapper
      title={node.name || node.asset.name}
      icon={node.asset.thumbnail || '/icons/furniture.png'}
      onClose={handleClose}
      width={300}
    >
      <PanelSection title="Position">
        <SliderControl
          label={<>X<sub className="text-[11px] ml-[1px] opacity-70">pos</sub></>}
          value={Math.round(node.position[0] * 100) / 100}
          onChange={(value) => handleUpdate({ position: [value, node.position[1], node.position[2]] })}
          min={node.position[0] - 2}
          max={node.position[0] + 2}
          precision={2}
          step={0.01}
          unit="m"
        />
        <SliderControl
          label={<>Y<sub className="text-[11px] ml-[1px] opacity-70">pos</sub></>}
          value={Math.round(node.position[1] * 100) / 100}
          onChange={(value) => handleUpdate({ position: [node.position[0], value, node.position[2]] })}
          min={node.position[1] - 2}
          max={node.position[1] + 2}
          precision={2}
          step={0.01}
          unit="m"
        />
        <SliderControl
          label={<>Z<sub className="text-[11px] ml-[1px] opacity-70">pos</sub></>}
          value={Math.round(node.position[2] * 100) / 100}
          onChange={(value) => handleUpdate({ position: [node.position[0], node.position[1], value] })}
          min={node.position[2] - 2}
          max={node.position[2] + 2}
          precision={2}
          step={0.01}
          unit="m"
        />
      </PanelSection>

      <PanelSection title="Rotation">
        <SliderControl
          label={<>Y<sub className="text-[11px] ml-[1px] opacity-70">rot</sub></>}
          value={Math.round((node.rotation[1] * 180) / Math.PI)}
          onChange={(degrees) => {
            const radians = (degrees * Math.PI) / 180
            handleUpdate({ rotation: [node.rotation[0], radians, node.rotation[2]] })
          }}
          min={Math.round((node.rotation[1] * 180) / Math.PI) - 45}
          max={Math.round((node.rotation[1] * 180) / Math.PI) + 45}
          precision={0}
          step={1}
          unit="°"
        />
        <div className="flex gap-1.5 px-1 pt-2 pb-1">
          <ActionButton 
            label="-45°" 
            onClick={() => {
              sfxEmitter.emit('sfx:item-rotate')
              const currentDegrees = (node.rotation[1] * 180) / Math.PI
              const radians = ((currentDegrees - 45) * Math.PI) / 180
              handleUpdate({ rotation: [node.rotation[0], radians, node.rotation[2]] })
            }} 
          />
          <ActionButton 
            label="+45°" 
            onClick={() => {
              sfxEmitter.emit('sfx:item-rotate')
              const currentDegrees = (node.rotation[1] * 180) / Math.PI
              const radians = ((currentDegrees + 45) * Math.PI) / 180
              handleUpdate({ rotation: [node.rotation[0], radians, node.rotation[2]] })
            }} 
          />
        </div>
      </PanelSection>

      <PanelSection title="Scale">
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">Uniform Scale</span>
          <button
            type="button"
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md transition-colors text-muted-foreground hover:text-foreground",
              uniformScale ? "bg-[#3e3e3e]" : "bg-[#2C2C2E] hover:bg-[#3e3e3e]"
            )}
            onClick={() => setUniformScale((v) => !v)}
          >
            {uniformScale ? <Link className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
          </button>
        </div>
        
        {uniformScale ? (
          <SliderControl
            label={<>XYZ<sub className="text-[11px] ml-[1px] opacity-70">scale</sub></>}
            value={Math.round(node.scale[0] * 100) / 100}
            onChange={(value) => {
              const v = Math.max(0.01, value)
              handleUpdate({ scale: [v, v, v] })
            }}
            min={0.01}
            max={10}
            precision={2}
            step={0.1}
          />
        ) : (
          <>
            <SliderControl
              label={<>X<sub className="text-[11px] ml-[1px] opacity-70">scale</sub></>}
              value={Math.round(node.scale[0] * 100) / 100}
              onChange={(value) => handleUpdate({ scale: [Math.max(0.01, value), node.scale[1], node.scale[2]] })}
              min={0.01}
              max={10}
              precision={2}
              step={0.1}
            />
            <SliderControl
              label={<>Y<sub className="text-[11px] ml-[1px] opacity-70">scale</sub></>}
              value={Math.round(node.scale[1] * 100) / 100}
              onChange={(value) => handleUpdate({ scale: [node.scale[0], Math.max(0.01, value), node.scale[2]] })}
              min={0.01}
              max={10}
              precision={2}
              step={0.1}
            />
            <SliderControl
              label={<>Z<sub className="text-[11px] ml-[1px] opacity-70">scale</sub></>}
              value={Math.round(node.scale[2] * 100) / 100}
              onChange={(value) => handleUpdate({ scale: [node.scale[0], node.scale[1], Math.max(0.01, value)] })}
              min={0.01}
              max={10}
              precision={2}
              step={0.1}
            />
          </>
        )}
      </PanelSection>

      <PanelSection title="Info">
        <div className="flex items-center justify-between px-2 py-1 text-sm text-muted-foreground">
          <span>Dimensions</span>
          {(() => {
            const [w, h, d] = getScaledDimensions(node)
            return (
              <span className="font-mono text-white">
                {Math.round(w * 100) / 100}×{Math.round(h * 100) / 100}×{Math.round(d * 100) / 100}
              </span>
            )
          })()}
        </div>
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton icon={<Move className="h-3.5 w-3.5" />} label="Move" onClick={handleMove} />
          <ActionButton icon={<Copy className="h-3.5 w-3.5" />} label="Duplicate" onClick={handleDuplicate} />
          <ActionButton 
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />} 
            label="Delete" 
            onClick={handleDelete} 
            className="hover:bg-red-500/20"
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
