'use client'

import { type AnyNode, getScaledDimensions, ItemNode, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  CollectionsPopover,
  PanelSection,
  PanelWrapper,
  SliderControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Link, Link2Off, Move, Trash2 } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

/**
 * Stage E inspector for item. 1:1 port of the legacy
 * `editor/components/ui/panels/item-panel.tsx`, relocated into the
 * kind's folder so `parametrics.customPanel` mounts it through the
 * registry inspector. The catalog popover (`<CollectionsPopover>`) is
 * the only kind-specific UI that can't be expressed via the generic
 * auto-inspector today — kept inline.
 *
 * Slider-drag fix recipe applied: scale / position / rotation slider
 * `onChange` callbacks read from a `useRef(node)` instead of the
 * closure-captured node, which would re-render every panel-driven
 * update mid-drag and exceed React's update-depth budget on big scenes
 * (see the wiki / plan recipe).
 */
export default function ItemPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as ItemNode | undefined) : undefined,
  )

  const [uniformScale, setUniformScale] = useState(true)
  const nodeRef = useRef(node)
  nodeRef.current = node

  const handleUpdate = useCallback(
    (updates: Partial<ItemNode>) => {
      if (!selectedId) return
      const n = nodeRef.current
      if (!n) return
      useScene.getState().updateNode(selectedId as AnyNode['id'], updates)

      // When an item is mounted on a wall, dirty the wall so the next
      // frame regenerates its cutout geometry around the moved item.
      if (n.asset.attachTo === 'wall' && n.parentId) {
        requestAnimationFrame(() => {
          useScene.getState().markDirty(n.parentId as AnyNode['id'])
        })
      }
    },
    [selectedId],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleMove = useCallback(() => {
    if (node) {
      triggerSFX('sfx:item-pick')
      setMovingNode(node)
      setSelection({ selectedIds: [] })
    }
  }, [node, setMovingNode, setSelection])

  const handleDuplicate = useCallback(() => {
    if (!node) return
    triggerSFX('sfx:item-pick')
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
    triggerSFX('sfx:item-delete')
    deleteNode(selectedId as AnyNode['id'])
    setSelection({ selectedIds: [] })
  }, [selectedId, deleteNode, setSelection])

  if (!(node && node.type === 'item' && selectedId)) return null

  return (
    <PanelWrapper
      icon={node.asset.thumbnail || '/icons/furniture.webp'}
      onClose={handleClose}
      title={node.name || node.asset.name}
      width={300}
    >
      <PanelSection title="Position">
        <SliderControl
          label={
            <>
              X<sub className="ml-[1px] text-[11px] opacity-70">pos</sub>
            </>
          }
          max={node.position[0] + 2}
          min={node.position[0] - 2}
          onChange={(value) =>
            handleUpdate({ position: [value, node.position[1], node.position[2]] })
          }
          precision={2}
          step={0.01}
          unit="m"
          value={Math.round(node.position[0] * 100) / 100}
        />
        <SliderControl
          label={
            <>
              Y<sub className="ml-[1px] text-[11px] opacity-70">pos</sub>
            </>
          }
          max={node.position[1] + 2}
          min={node.position[1] - 2}
          onChange={(value) =>
            handleUpdate({ position: [node.position[0], value, node.position[2]] })
          }
          precision={2}
          step={0.01}
          unit="m"
          value={Math.round(node.position[1] * 100) / 100}
        />
        <SliderControl
          label={
            <>
              Z<sub className="ml-[1px] text-[11px] opacity-70">pos</sub>
            </>
          }
          max={node.position[2] + 2}
          min={node.position[2] - 2}
          onChange={(value) =>
            handleUpdate({ position: [node.position[0], node.position[1], value] })
          }
          precision={2}
          step={0.01}
          unit="m"
          value={Math.round(node.position[2] * 100) / 100}
        />
      </PanelSection>

      <PanelSection title="Rotation">
        <SliderControl
          label={
            <>
              Y<sub className="ml-[1px] text-[11px] opacity-70">rot</sub>
            </>
          }
          max={Math.round((node.rotation[1] * 180) / Math.PI) + 45}
          min={Math.round((node.rotation[1] * 180) / Math.PI) - 45}
          onChange={(degrees) => {
            const radians = (degrees * Math.PI) / 180
            handleUpdate({ rotation: [node.rotation[0], radians, node.rotation[2]] })
          }}
          precision={0}
          step={1}
          unit="°"
          value={Math.round((node.rotation[1] * 180) / Math.PI)}
        />
        <div className="flex gap-1.5 px-1 pt-2 pb-1">
          <ActionButton
            label="-45°"
            onClick={() => {
              triggerSFX('sfx:item-rotate')
              const currentDegrees = (node.rotation[1] * 180) / Math.PI
              const radians = ((currentDegrees - 45) * Math.PI) / 180
              handleUpdate({ rotation: [node.rotation[0], radians, node.rotation[2]] })
            }}
          />
          <ActionButton
            label="+45°"
            onClick={() => {
              triggerSFX('sfx:item-rotate')
              const currentDegrees = (node.rotation[1] * 180) / Math.PI
              const radians = ((currentDegrees + 45) * Math.PI) / 180
              handleUpdate({ rotation: [node.rotation[0], radians, node.rotation[2]] })
            }}
          />
        </div>
      </PanelSection>

      <PanelSection title="Scale">
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
            Uniform Scale
          </span>
          <button
            className={
              uniformScale
                ? 'flex h-6 w-6 items-center justify-center rounded-md bg-[#3e3e3e] text-muted-foreground transition-colors hover:text-foreground'
                : 'flex h-6 w-6 items-center justify-center rounded-md bg-[#2C2C2E] text-muted-foreground transition-colors hover:bg-[#3e3e3e] hover:text-foreground'
            }
            onClick={() => setUniformScale((v) => !v)}
            type="button"
          >
            {uniformScale ? <Link className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
          </button>
        </div>

        {uniformScale ? (
          <SliderControl
            label={
              <>
                XYZ<sub className="ml-[1px] text-[11px] opacity-70">scale</sub>
              </>
            }
            max={10}
            min={0.01}
            onChange={(value) => {
              const v = Math.max(0.01, value)
              handleUpdate({ scale: [v, v, v] })
            }}
            precision={2}
            step={0.1}
            value={Math.round(node.scale[0] * 100) / 100}
          />
        ) : (
          <>
            <SliderControl
              label={
                <>
                  X<sub className="ml-[1px] text-[11px] opacity-70">scale</sub>
                </>
              }
              max={10}
              min={0.01}
              onChange={(value) =>
                handleUpdate({ scale: [Math.max(0.01, value), node.scale[1], node.scale[2]] })
              }
              precision={2}
              step={0.1}
              value={Math.round(node.scale[0] * 100) / 100}
            />
            <SliderControl
              label={
                <>
                  Y<sub className="ml-[1px] text-[11px] opacity-70">scale</sub>
                </>
              }
              max={10}
              min={0.01}
              onChange={(value) =>
                handleUpdate({ scale: [node.scale[0], Math.max(0.01, value), node.scale[2]] })
              }
              precision={2}
              step={0.1}
              value={Math.round(node.scale[1] * 100) / 100}
            />
            <SliderControl
              label={
                <>
                  Z<sub className="ml-[1px] text-[11px] opacity-70">scale</sub>
                </>
              }
              max={10}
              min={0.01}
              onChange={(value) =>
                handleUpdate({ scale: [node.scale[0], node.scale[1], Math.max(0.01, value)] })
              }
              precision={2}
              step={0.1}
              value={Math.round(node.scale[2] * 100) / 100}
            />
          </>
        )}
      </PanelSection>

      <PanelSection title="Info">
        <div className="flex items-center justify-between px-2 py-1 text-muted-foreground text-sm">
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

      <PanelSection title="Collections">
        <ActionGroup>
          <CollectionsPopover
            collectionIds={node.collectionIds}
            nodeId={selectedId as AnyNode['id']}
          >
            <ActionButton label="Manage collections…" />
          </CollectionsPopover>
        </ActionGroup>
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton icon={<Move className="h-3.5 w-3.5" />} label="Move" onClick={handleMove} />
          <ActionButton
            icon={<Copy className="h-3.5 w-3.5" />}
            label="Duplicate"
            onClick={handleDuplicate}
          />
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            label="Delete"
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
