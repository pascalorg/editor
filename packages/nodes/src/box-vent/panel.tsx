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
import { useCallback, useRef } from 'react'
import { getDownSlopeYaw } from '../shared/roof-surface'
import { boxVentDimensionPatch, boxVentDimensions } from './dimensions'
import type { BoxVentNode } from './schema'

/**
 * Inspector panel for a placed box-vent. Exposes the same parametrics
 * as the auto-derived inspector (style + dimensions) plus Move /
 * Duplicate / Delete actions wired into the same ghost-preview drag
 * flow the placement tool uses.
 *
 * Move sets the vent as `editor.movingNode` — the registered move
 * affordance tool (see `./move-tool.tsx`) takes over from there.
 * Duplicate inserts a fresh clone into the scene (marked `isNew` so a
 * cancelled drag deletes it), then routes the same way. On click the
 * ghost commits; on Esc it cancels and the original mesh is restored.
 */
export default function BoxVentPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const storeNode = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as BoxVentNode | undefined) : undefined,
  )
  // Mirror any in-progress slider drag so the panel reads the same live
  // values the renderer paints. Without this the slider thumb would jump
  // back to the store value on every render until commit.
  const overrides = useLiveNodeOverrides((s) =>
    selectedId ? (s.get(selectedId as AnyNodeId) as Partial<BoxVentNode> | undefined) : undefined,
  )
  const effectiveNode: BoxVentNode | undefined =
    storeNode && overrides ? ({ ...storeNode, ...overrides } as BoxVentNode) : storeNode

  const node = effectiveNode ? { ...effectiveNode, ...boxVentDimensions(effectiveNode) } : undefined

  const nodeRef = useRef(node)
  nodeRef.current = node

  // Pull the parent segment so the Position sliders can clamp to the
  // segment's footprint (no point letting the user drag the vent off
  // the eaves into thin air).
  const segment = useScene((s) =>
    node?.roofSegmentId
      ? (s.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  // Slider drag (during): write to the ephemeral live-overrides store so
  // the mesh updates frame-by-frame without thrashing the scene store
  // (or polluting undo history).
  const previewProp = useCallback(
    (updates: Partial<BoxVentNode>) => {
      if (!selectedId) return
      const node = nodeRef.current
      useLiveNodeOverrides.getState().set(selectedId as AnyNodeId, {
        ...updates,
        ...(node ? boxVentDimensionPatch({ ...node, ...updates }, updates) : {}),
      })
    },
    [selectedId],
  )

  // Slider release (commit): flush to the scene store as a single
  // undoable change and clear the live override.
  const commitProp = useCallback(
    (updates: Partial<BoxVentNode>) => {
      if (!selectedId) return
      const node = nodeRef.current
      updateNode(selectedId as AnyNode['id'], {
        ...updates,
        ...(node ? boxVentDimensionPatch({ ...node, ...updates }, updates) : {}),
      })
      useLiveNodeOverrides.getState().clear(selectedId as AnyNodeId)
    },
    [selectedId, updateNode],
  )

  // Discrete / one-shot updates (style switch, end-cap toggle) bypass
  // the live-override dance — they're never part of a drag.
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
    // `setMovingNode`'s type union doesn't include roof-mounted kinds —
    // skylight / chimney / etc. take the same `as never` escape hatch.
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
    if (segmentId) {
      const state = useScene.getState()
      const segment = state.nodes[segmentId as AnyNodeId] as RoofSegmentNode | undefined
      if (segment) {
        state.updateNode(segmentId as AnyNode['id'], {
          children: (segment.children ?? []).filter((id) => id !== selectedId),
        })
      }
    }
    deleteNode(selectedId as AnyNodeId)
    if (segmentId) {
      useScene.getState().dirtyNodes.add(segmentId as AnyNodeId)
      setSelection({ selectedIds: [segmentId as AnyNode['id']] })
    } else {
      setSelection({ selectedIds: [] })
    }
  }, [selectedId, node, deleteNode, setSelection])

  if (!(node && node.type === 'box-vent' && selectedId)) return null

  const roofY = (x: number, z: number) =>
    segment ? getRoofOuterSurfaceFrameAtPoint(segment, x, z).point.y : 0
  const roofOffset = node.position[1] - roofY(node.position[0], node.position[2])

  return (
    <PanelWrapper
      icon="/icons/roof.webp"
      onBack={node.roofSegmentId ? handleBack : undefined}
      onClose={handleClose}
      title={node.name || 'Box Vent'}
      width={300}
    >
      <PanelSection title="Style">
        <div className="grid grid-cols-3 gap-2 px-1">
          {(['box', 'cap', 'dome'] as const).map((style) => (
            <button
              key={style}
              type="button"
              aria-pressed={node.style === style}
              onClick={() => handleUpdate({ style })}
              className={`flex flex-col items-center gap-2 rounded-lg border p-2 text-xs capitalize ${node.style === style ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-accent'}`}
            >
              <img
                src={`/icons/box-vent/${style}.webp`}
                alt=""
                width={64}
                height={64}
                className="size-16 object-contain"
                draggable={false}
              />
              {style}
            </button>
          ))}
        </div>
      </PanelSection>

      <PanelSection title="Dimensions">
        <SliderControl
          label="Width"
          min={0.15}
          onChange={(v) => previewProp({ width: v })}
          onCommit={(v) => handleUpdate({ width: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.01}
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
          step={0.01}
          unit="m"
          value={node.depth}
        />
        <SliderControl
          label="Housing height"
          min={0.05}
          onChange={(v) => previewProp({ height: v })}
          onCommit={(v) => handleUpdate({ height: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.01}
          unit="m"
          value={node.height}
        />
      </PanelSection>

      <PanelSection
        title={`${node.style === 'box' ? 'Box' : node.style === 'cap' ? 'Cap' : 'Dome'} details`}
      >
        {/* Hood Overhang is `cap`-only — the dome shape rolls down to
            the body footprint without a flange skirt, and `box` doesn't
            have a hood at all. Max scales with width so wider vents can
            flare further past the body. */}
        {node.style === 'cap' && (
          <SliderControl
            label="Hood Overhang"
            min={0}
            onChange={(v) => previewProp({ hoodOverhang: v })}
            onCommit={(v) => handleUpdate({ hoodOverhang: v })}
            precision={3}
            restoreOnCommit={false}
            step={0.005}
            unit="m"
            value={node.hoodOverhang ?? 0}
          />
        )}
        {node.style === 'box' && (
          <>
            <SliderControl
              label="Base Inset"
              max={Math.max(0.005, Math.min(node.width, node.depth) / 2 - 0.005)}
              min={0}
              onChange={(v) => previewProp({ baseInset: v })}
              onCommit={(v) => handleUpdate({ baseInset: v })}
              precision={3}
              restoreOnCommit={false}
              step={0.005}
              unit="m"
              value={node.baseInset ?? 0.06}
            />
            <SliderControl
              label="Base Height"
              max={Math.max(0.01, node.height - 0.005)}
              min={0.005}
              onChange={(v) => previewProp({ baseHeight: v })}
              onCommit={(v) => handleUpdate({ baseHeight: v })}
              precision={3}
              restoreOnCommit={false}
              step={0.005}
              unit="m"
              value={node.baseHeight ?? 0.04}
            />
            <SliderControl
              label="Corner Bevel"
              max={Math.max(
                0,
                Math.min(node.width, node.depth) / 2 - (node.baseInset ?? 0.06) - 0.001,
              )}
              min={0}
              onChange={(v) => previewProp({ cornerBevel: v })}
              onCommit={(v) => handleUpdate({ cornerBevel: v })}
              precision={3}
              restoreOnCommit={false}
              step={0.002}
              unit="m"
              value={node.cornerBevel ?? 0.012}
            />
          </>
        )}
        {node.style === 'cap' && (
          <>
            <SliderControl
              label="Cap Height"
              max={Math.max(0.02, node.height - 0.01)}
              min={0.01}
              onChange={(v) => previewProp({ capHeight: v })}
              onCommit={(v) => handleUpdate({ capHeight: v })}
              precision={3}
              restoreOnCommit={false}
              step={0.005}
              unit="m"
              value={node.capHeight ?? 0.07}
            />
            <SliderControl
              label="Vent opening"
              max={Math.max(0, node.height - Math.max(0.01, node.capHeight ?? 0.07) - 0.005)}
              min={0}
              onChange={(v) => previewProp({ capGap: v })}
              onCommit={(v) => handleUpdate({ capGap: v })}
              precision={3}
              restoreOnCommit={false}
              step={0.005}
              unit="m"
              value={node.capGap ?? 0}
            />
            <SliderControl
              label="Top Taper"
              max={1}
              min={0}
              onChange={(v) => previewProp({ topTaper: v })}
              onCommit={(v) => handleUpdate({ topTaper: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit=""
              value={Math.round((node.topTaper ?? 0.4) * 100) / 100}
            />
          </>
        )}
        {node.style === 'dome' && (
          <>
            <SliderControl
              label="Dome Curvature"
              max={1.5}
              min={0.3}
              onChange={(v) => previewProp({ domeCurvature: v })}
              onCommit={(v) => handleUpdate({ domeCurvature: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit=""
              value={Math.round((node.domeCurvature ?? 1.0) * 100) / 100}
            />
            <SliderControl
              label="Base Flange"
              min={0}
              onChange={(v) => previewProp({ hoodOverhang: v })}
              onCommit={(v) => handleUpdate({ hoodOverhang: v })}
              precision={3}
              restoreOnCommit={false}
              step={0.005}
              unit="m"
              value={node.hoodOverhang ?? 0.04}
            />
          </>
        )}
        <p className="px-2 pb-2 text-xs text-muted-foreground">
          Detail dimensions stay within the housing height and width.
        </p>
      </PanelSection>

      <PanelSection title="Installation">
        <SliderControl
          label="Flashing extension"
          min={0}
          step={0.01}
          unit="m"
          precision={2}
          value={node.flashingWidth ?? 0}
          restoreOnCommit={false}
          onChange={(v) => previewProp({ flashingWidth: v })}
          onCommit={(v) => handleUpdate({ flashingWidth: v })}
        />
        <p className="px-2 pb-2 text-xs text-muted-foreground">
          Flashing extends beyond the housing on every side. Set to zero to omit it.
        </p>
        {segment && (
          <ActionGroup>
            <ActionButton
              label="Seat on roof"
              onClick={() =>
                handleUpdate({
                  position: [
                    node.position[0],
                    roofY(node.position[0], node.position[2]),
                    node.position[2],
                  ],
                })
              }
            />
            <ActionButton
              label="Face downslope"
              onClick={() =>
                handleUpdate({
                  rotation: getDownSlopeYaw(node.position[0], node.position[2], segment),
                })
              }
            />
          </ActionGroup>
        )}
      </PanelSection>
      <PanelSection title="Position" defaultExpanded={false}>
        <SliderControl
          label="X"
          max={Math.round(((segment?.width ?? 10) / 2) * 100) / 100}
          min={-Math.round(((segment?.width ?? 10) / 2) * 100) / 100}
          onChange={(v) =>
            previewProp({
              position: [v, roofY(v, node.position[2]) + roofOffset, node.position[2]],
            })
          }
          onCommit={(v) =>
            handleUpdate({
              position: [v, roofY(v, node.position[2]) + roofOffset, node.position[2]],
            })
          }
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
                roofY(node.position[0], node.position[2]) + v,
                node.position[2],
              ],
            })
          }
          onCommit={(v) =>
            handleUpdate({
              position: [
                node.position[0],
                roofY(node.position[0], node.position[2]) + v,
                node.position[2],
              ],
            })
          }
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={roofOffset}
        />
        <SliderControl
          label="Z"
          max={Math.round(((segment?.depth ?? 10) / 2) * 100) / 100}
          min={-Math.round(((segment?.depth ?? 10) / 2) * 100) / 100}
          onChange={(v) =>
            previewProp({
              position: [node.position[0], roofY(node.position[0], v) + roofOffset, v],
            })
          }
          onCommit={(v) =>
            handleUpdate({
              position: [node.position[0], roofY(node.position[0], v) + roofOffset, v],
            })
          }
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
