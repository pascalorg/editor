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
import { Copy, Move, Pause, Play, Trash2 } from 'lucide-react'
import { useCallback, useRef } from 'react'
import type { TurbineVentNode } from './schema'

// Speed restored when resuming a paused turbine that has no remembered
// speed yet (matches the schema default).
const DEFAULT_SPIN_SPEED = 0.8

/**
 * Inspector panel for a placed turbine vent. Exposes style + dimensions +
 * spin speed plus Move / Duplicate / Delete wired into the same
 * ghost-preview drag flow the placement tool uses (see `./move-tool.tsx`).
 * Mirrors the box-vent panel.
 */
export default function TurbineVentPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const storeNode = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as TurbineVentNode | undefined) : undefined,
  )
  const overrides = useLiveNodeOverrides((s) =>
    selectedId
      ? (s.get(selectedId as AnyNodeId) as Partial<TurbineVentNode> | undefined)
      : undefined,
  )
  const node: TurbineVentNode | undefined =
    storeNode && overrides ? ({ ...storeNode, ...overrides } as TurbineVentNode) : storeNode

  const segment = useScene((s) =>
    node?.roofSegmentId
      ? (s.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const previewProp = useCallback(
    (updates: Partial<TurbineVentNode>) => {
      if (!selectedId) return
      useLiveNodeOverrides.getState().set(selectedId as AnyNodeId, updates)
    },
    [selectedId],
  )

  const commitProp = useCallback(
    (updates: Partial<TurbineVentNode>) => {
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

  // Play / pause the idle spin. Pausing remembers the current speed so
  // Play restores it (falling back to the default if it was never running).
  const lastSpeedRef = useRef(new Map<string, number>())
  const isSpinning = (node?.spinSpeed ?? 0) > 0
  const handleToggleSpin = useCallback(() => {
    if (!node) return
    const current = node.spinSpeed ?? 0
    if (current > 0) {
      lastSpeedRef.current.set(node.id, current)
      handleUpdate({ spinSpeed: 0 })
    } else {
      handleUpdate({
        spinSpeed: lastSpeedRef.current.get(node.id) ?? DEFAULT_SPIN_SPEED,
      })
    }
  }, [node, handleUpdate])

  if (!(node && node.type === 'turbine-vent' && selectedId)) return null

  const surfaceY = (x: number, z: number) =>
    segment ? getRoofOuterSurfaceFrameAtPoint(segment, x, z).point.y : 0
  const roofOffset = node.position[1] - surfaceY(node.position[0], node.position[2])
  const at = (x: number, z: number): [number, number, number] => [x, surfaceY(x, z) + roofOffset, z]

  return (
    <PanelWrapper
      icon="/icons/turbine-vent.webp"
      onBack={node.roofSegmentId ? handleBack : undefined}
      onClose={handleClose}
      title={node.name || 'Turbine Vent'}
      width={300}
    >
      <PanelSection title="Style">
        <div className="grid grid-cols-2 gap-2">
          {(['globe', 'cylinder'] as const).map((style) => (
            <button
              key={style}
              type="button"
              aria-pressed={node.style === style}
              className={`rounded-lg border p-2 text-xs transition-colors ${node.style === style ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}
              onClick={() => handleUpdate({ style })}
            >
              <img
                src={`/icons/turbine-vent/${style}.webp`}
                alt=""
                className="mx-auto h-16 w-16 object-contain"
              />
              {style === 'globe' ? 'Globe' : 'Cylinder'}
            </button>
          ))}
        </div>
      </PanelSection>

      <PanelSection title="Dimensions">
        <SliderControl
          label="Diameter"
          min={0.1}
          onChange={(v) => previewProp({ diameter: v })}
          onCommit={(v) => handleUpdate({ diameter: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.01}
          unit="m"
          value={node.diameter}
        />
        <SliderControl
          label="Height"
          min={0.12}
          onChange={(v) =>
            previewProp({ height: v, neckHeight: Math.min(node.neckHeight, v * 0.5) })
          }
          onCommit={(v) =>
            handleUpdate({ height: v, neckHeight: Math.min(node.neckHeight, v * 0.5) })
          }
          precision={2}
          restoreOnCommit={false}
          step={0.01}
          unit="m"
          value={node.height}
        />
        <SliderControl
          label="Neck Height"
          max={node.height * 0.5}
          min={0.02}
          onChange={(v) => previewProp({ neckHeight: v })}
          onCommit={(v) => handleUpdate({ neckHeight: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.01}
          unit="m"
          value={node.neckHeight ?? 0.09}
        />
        <SliderControl
          label="Vanes"
          max={36}
          min={6}
          onChange={(v) => previewProp({ vaneCount: Math.round(v) })}
          onCommit={(v) => handleUpdate({ vaneCount: Math.round(v) })}
          precision={0}
          restoreOnCommit={false}
          step={1}
          unit=""
          value={Math.round(node.vaneCount ?? 20)}
        />
      </PanelSection>

      <PanelSection title="Installation">
        <SliderControl
          label="Flashing overhang"
          min={0}
          value={node.baseOverhang}
          onChange={(v) => previewProp({ baseOverhang: v })}
          onCommit={(v) => handleUpdate({ baseOverhang: v })}
          precision={2}
          step={0.01}
          unit="m"
          restoreOnCommit={false}
        />
        <button
          type="button"
          disabled={!segment}
          className="rounded border px-2 py-1 text-xs disabled:opacity-40"
          onClick={() =>
            segment &&
            handleUpdate({
              position: [
                node.position[0],
                getRoofOuterSurfaceFrameAtPoint(segment, node.position[0], node.position[2]).point
                  .y,
                node.position[2],
              ],
            })
          }
        >
          Seat on roof
        </button>
      </PanelSection>

      <PanelSection title="Motion">
        <ActionGroup>
          <ActionButton
            icon={isSpinning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            label={isSpinning ? 'Pause' : 'Play'}
            onClick={handleToggleSpin}
          />
        </ActionGroup>
        <SliderControl
          label="Spin Speed"
          min={0}
          onChange={(v) => previewProp({ spinSpeed: v })}
          onCommit={(v) => handleUpdate({ spinSpeed: v })}
          precision={1}
          restoreOnCommit={false}
          step={0.1}
          unit="rad/s"
          value={Math.round((node.spinSpeed ?? 0) * 10) / 10}
        />
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
          value={roofOffset}
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
