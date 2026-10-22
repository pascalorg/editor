'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type RoofSegmentNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  duplicateNodeAndPickUp,
  PanelSection,
  PanelWrapper,
  SliderControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { getRoofOuterSurfaceFrameAtPoint, useViewer } from '@pascal-app/viewer'
import { Copy, Move, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { resolveEyebrowVentPlacement } from './placement'
import type { EyebrowVentNode } from './schema'

/**
 * Inspector panel for a placed eyebrow vent. Louvers toggle + dimensions plus
 * Move / Duplicate / Delete wired into the same ghost-preview drag flow the
 * placement tool uses. Mirrors the box-vent / cupola panel.
 */
export default function EyebrowVentPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const storeNode = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as EyebrowVentNode | undefined) : undefined,
  )
  const overrides = useLiveNodeOverrides((s) =>
    selectedId
      ? (s.get(selectedId as AnyNodeId) as Partial<EyebrowVentNode> | undefined)
      : undefined,
  )
  const node: EyebrowVentNode | undefined =
    storeNode && overrides ? ({ ...storeNode, ...overrides } as EyebrowVentNode) : storeNode

  const segment = useScene((s) =>
    node?.roofSegmentId
      ? (s.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const previewProp = useCallback(
    (updates: Partial<EyebrowVentNode>) => {
      if (!selectedId) return
      useLiveNodeOverrides.getState().set(selectedId as AnyNodeId, updates)
    },
    [selectedId],
  )

  const commitProp = useCallback(
    (updates: Partial<EyebrowVentNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
      useLiveNodeOverrides.getState().clear(selectedId as AnyNodeId)
    },
    [selectedId, updateNode],
  )

  const handleUpdate = commitProp

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleBack = useCallback(() => {
    if (node?.roofSegmentId) {
      setSelection({ selectedIds: [node.roofSegmentId as AnyNode['id']] })
    }
  }, [node?.roofSegmentId, setSelection])

  const handleMove = useCallback(() => {
    if (!node) return
    triggerSFX('sfx:item-pick')
    setMovingNode(node as never)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  const handleDuplicate = useCallback(() => {
    if (node) duplicateNodeAndPickUp(node)
  }, [node])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    triggerSFX('sfx:item-delete')
    const segmentId = node.roofSegmentId
    deleteNode(selectedId as AnyNodeId)
    if (segmentId) {
      useScene.getState().dirtyNodes.add(segmentId as AnyNodeId)
      setSelection({ selectedIds: [segmentId as AnyNode['id']] })
    } else {
      setSelection({ selectedIds: [] })
    }
  }, [selectedId, node, deleteNode, setSelection])

  if (!(node && node.type === 'eyebrow-vent' && selectedId)) return null

  const surfaceY = (x: number, z: number) =>
    segment ? getRoofOuterSurfaceFrameAtPoint(segment, x, z).point.y : 0
  const offset = node.position[1] - surfaceY(node.position[0], node.position[2])
  const at = (x: number, z: number): [number, number, number] => [x, surfaceY(x, z) + offset, z]

  return (
    <PanelWrapper
      icon="/icons/eyebrow-vent.webp"
      onBack={node.roofSegmentId ? handleBack : undefined}
      onClose={handleClose}
      title={node.name || 'Eyebrow Vent'}
      width={300}
    >
      <PanelSection title="Style">
        <div className="grid grid-cols-3 gap-2">
          {(['scoop', 'half-round', 'slant-box'] as const).map((style) => (
            <button
              key={style}
              type="button"
              aria-pressed={node.style === style}
              className={`rounded-lg border p-2 text-xs transition-colors ${node.style === style ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}
              onClick={() => handleUpdate({ style })}
            >
              <img
                src={`/icons/eyebrow-vent/${style}.webp`}
                alt=""
                className="mx-auto h-14 w-14 object-contain"
              />
              {style === 'scoop' ? 'Scoop' : style === 'half-round' ? 'Half-round' : 'Slant-box'}
            </button>
          ))}
        </div>
      </PanelSection>
      <PanelSection title="Opening">
        <SliderControl
          label="Louvers"
          max={8}
          min={0}
          onChange={(v) => previewProp({ louverCount: Math.round(v) })}
          onCommit={(v) => handleUpdate({ louverCount: Math.round(v) })}
          precision={0}
          restoreOnCommit={false}
          step={1}
          value={node.louverCount ?? 3}
        />
        <p className="text-xs text-muted-foreground">
          Zero louvers leaves the recessed screen visible.
        </p>
        {node.style === 'slant-box' ? (
          <SliderControl
            label="Rear height"
            max={100}
            min={15}
            onChange={(v) => previewProp({ backRatio: v / 100 })}
            onCommit={(v) => handleUpdate({ backRatio: v / 100 })}
            precision={2}
            restoreOnCommit={false}
            step={1}
            unit="%"
            value={Math.round((node.backRatio ?? 0.5) * 100)}
          />
        ) : null}
      </PanelSection>

      <PanelSection title="Dimensions">
        <SliderControl
          label="Width"
          min={0.15}
          onChange={(v) => previewProp({ width: v })}
          onCommit={(v) => handleUpdate({ width: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={node.width}
        />
        <SliderControl
          label="Depth"
          min={0.15}
          onChange={(v) => previewProp({ depth: v })}
          onCommit={(v) => handleUpdate({ depth: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={node.depth}
        />
        <SliderControl
          label="Height"
          min={0.06}
          onChange={(v) => previewProp({ height: v })}
          onCommit={(v) => handleUpdate({ height: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.02}
          unit="m"
          value={node.height}
        />
      </PanelSection>

      <PanelSection title="Placement">
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!segment}
            className="rounded border px-2 py-1 text-xs disabled:opacity-40"
            onClick={() =>
              segment &&
              handleUpdate({
                position: resolveEyebrowVentPlacement(
                  segment,
                  node,
                  node.position[0],
                  node.position[2],
                ).position,
              })
            }
          >
            Seat on roof
          </button>
          <button
            type="button"
            disabled={!segment}
            className="rounded border px-2 py-1 text-xs disabled:opacity-40"
            onClick={() =>
              segment &&
              handleUpdate({
                rotation: resolveEyebrowVentPlacement(
                  segment,
                  node,
                  node.position[0],
                  node.position[2],
                  { alignDownslope: true },
                ).rotation,
              })
            }
          >
            Face downslope
          </button>
        </div>
      </PanelSection>
      <PanelSection title="Position" defaultExpanded={false}>
        <SliderControl
          label="X"
          max={Math.round(((segment?.width ?? 10) / 2) * 100) / 100}
          min={-Math.round(((segment?.width ?? 10) / 2) * 100) / 100}
          onChange={(v) => previewProp({ position: at(v, node.position[2]) })}
          onCommit={(v) => handleUpdate({ position: at(v, node.position[2]) })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={node.position[0] ?? 0}
        />
        <SliderControl
          label="Roof offset"
          onChange={(v) =>
            previewProp({
              position: [
                node.position[0],
                surfaceY(node.position[0], node.position[2]) + v,
                node.position[2],
              ],
            })
          }
          onCommit={(v) =>
            handleUpdate({
              position: [
                node.position[0],
                surfaceY(node.position[0], node.position[2]) + v,
                node.position[2],
              ],
            })
          }
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={offset}
        />
        <SliderControl
          label="Z"
          max={Math.round(((segment?.depth ?? 10) / 2) * 100) / 100}
          min={-Math.round(((segment?.depth ?? 10) / 2) * 100) / 100}
          onChange={(v) => previewProp({ position: at(node.position[0], v) })}
          onCommit={(v) => handleUpdate({ position: at(node.position[0], v) })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={node.position[2] ?? 0}
        />
        <SliderControl
          label="Rotation"
          max={180}
          min={-180}
          onChange={(deg) => previewProp({ rotation: (deg * Math.PI) / 180 })}
          onCommit={(deg) => handleUpdate({ rotation: (deg * Math.PI) / 180 })}
          precision={0}
          restoreOnCommit={false}
          step={1}
          unit="°"
          value={Math.round(((node.rotation ?? 0) * 180) / Math.PI)}
        />
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
            icon={<Trash2 className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />}
            label="Delete"
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
