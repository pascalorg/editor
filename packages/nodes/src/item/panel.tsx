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
import { L, S } from '../i18n/panel-labels'
import {
  createItemColorMetadata,
  DEFAULT_ITEM_COLOR,
  getItemColorMode,
  getItemColorOverride,
  isImportedGlbAsset,
  normalizeItemColor,
} from './color-metadata'

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
          useScene.getState().dirtyNodes.add(n.parentId as AnyNode['id'])
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
      metadata:
        typeof node.metadata === 'object' && node.metadata !== null && !Array.isArray(node.metadata)
          ? { ...node.metadata, isNew: true }
          : { isNew: true },
    })
    setMovingNode(proto)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  const handleColorDefault = useCallback(() => {
    const n = nodeRef.current
    if (!n) return
    handleUpdate({ metadata: createItemColorMetadata(n, 'default') })
  }, [handleUpdate])

  const handleColorCustom = useCallback(
    (color?: string) => {
      const n = nodeRef.current
      if (!n) return
      const nextColor = normalizeItemColor(color) ?? getItemColorOverride(n) ?? DEFAULT_ITEM_COLOR
      handleUpdate({ metadata: createItemColorMetadata(n, 'custom', nextColor) })
    },
    [handleUpdate],
  )

  const handleDelete = useCallback(() => {
    if (!selectedId) return
    triggerSFX('sfx:item-delete')
    deleteNode(selectedId as AnyNode['id'])
    setSelection({ selectedIds: [] })
  }, [selectedId, deleteNode, setSelection])

  if (!(node && node.type === 'item' && selectedId)) return null

  const itemColorMode = getItemColorMode(node)
  const itemColor = getItemColorOverride(node) ?? DEFAULT_ITEM_COLOR
  const importedGlb = isImportedGlbAsset(node)

  return (
    <PanelWrapper
      icon={node.asset.thumbnail || '/icons/furniture.png'}
      onClose={handleClose}
      title={node.name || node.asset.name}
      width={300}
    >
      <PanelSection title={S.position()}>
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

      <PanelSection title={S.rotation()}>
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
            label={L.rotateMinus45()}
            onClick={() => {
              triggerSFX('sfx:item-rotate')
              const currentDegrees = (node.rotation[1] * 180) / Math.PI
              const radians = ((currentDegrees - 45) * Math.PI) / 180
              handleUpdate({ rotation: [node.rotation[0], radians, node.rotation[2]] })
            }}
          />
          <ActionButton
            label={L.rotatePlus45()}
            onClick={() => {
              triggerSFX('sfx:item-rotate')
              const currentDegrees = (node.rotation[1] * 180) / Math.PI
              const radians = ((currentDegrees + 45) * Math.PI) / 180
              handleUpdate({ rotation: [node.rotation[0], radians, node.rotation[2]] })
            }}
          />
        </div>
      </PanelSection>

      <PanelSection title={S.scale()}>
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
            {L.uniformScale()}
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

      <PanelSection title="颜色">
        <div className="space-y-2 px-2 py-1">
          <div className="grid grid-cols-2 gap-1.5">
            <button
              className={
                itemColorMode === 'default'
                  ? 'rounded-md border border-white/15 bg-white/10 px-2 py-1.5 font-medium text-white text-xs'
                  : 'rounded-md border border-white/10 bg-[#2C2C2E] px-2 py-1.5 font-medium text-muted-foreground text-xs transition-colors hover:bg-[#3e3e3e] hover:text-white'
              }
              onClick={handleColorDefault}
              type="button"
            >
              默认
            </button>
            <button
              className={
                itemColorMode === 'custom'
                  ? 'rounded-md border border-white/15 bg-white/10 px-2 py-1.5 font-medium text-white text-xs'
                  : 'rounded-md border border-white/10 bg-[#2C2C2E] px-2 py-1.5 font-medium text-muted-foreground text-xs transition-colors hover:bg-[#3e3e3e] hover:text-white'
              }
              onClick={() => handleColorCustom(itemColor)}
              type="button"
            >
              自定义
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              aria-label="物品颜色"
              className="h-8 w-10 cursor-pointer rounded border border-white/10 bg-transparent p-0.5"
              onChange={(event) => handleColorCustom(event.target.value)}
              type="color"
              value={itemColor}
            />
            <div className="flex-1 rounded-md border border-white/10 bg-[#1f1f21] px-2 py-1.5 font-mono text-muted-foreground text-xs">
              {itemColor}
            </div>
          </div>
          {importedGlb && itemColorMode === 'default' ? (
            <p className="px-0.5 text-[11px] text-muted-foreground">
              默认使用导入 GLB 自带的颜色和贴图。
            </p>
          ) : null}
        </div>
      </PanelSection>

      <PanelSection title={S.info()}>
        <div className="flex items-center justify-between px-2 py-1 text-muted-foreground text-sm">
          <span>{L.dimensions()}</span>
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

      <PanelSection title={S.collections()}>
        <ActionGroup>
          <CollectionsPopover
            collectionIds={node.collectionIds}
            nodeId={selectedId as AnyNode['id']}
          >
            <ActionButton label={L.manageCollections()} />
          </CollectionsPopover>
        </ActionGroup>
      </PanelSection>

      <PanelSection title={S.actions()}>
        <ActionGroup>
          <ActionButton
            icon={<Move className="h-3.5 w-3.5" />}
            label={L.move()}
            onClick={handleMove}
          />
          <ActionButton
            icon={<Copy className="h-3.5 w-3.5" />}
            label={L.duplicate()}
            onClick={handleDuplicate}
          />
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
