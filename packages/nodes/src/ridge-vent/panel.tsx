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
  SegmentedControl,
  SliderControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Move, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { resolveRidgeVentPlacement } from './placement'
import type { RidgeVentNode } from './schema'

/**
 * Inspector panel for a placed ridge vent. Same structure as box-vent's
 * panel — sliders for style / dimensions / position + Move / Duplicate /
 * Delete actions that route through the kind-owned ghost-drag flow.
 */
export default function RidgeVentPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const storeNode = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as RidgeVentNode | undefined) : undefined,
  )

  const overrides = useLiveNodeOverrides((s) =>
    selectedId ? s.get(selectedId as AnyNodeId) : undefined,
  )
  const node = storeNode ? ({ ...storeNode, ...overrides } as RidgeVentNode) : undefined
  const previewProp = (patch: Partial<RidgeVentNode>) => {
    if (selectedId) useLiveNodeOverrides.getState().set(selectedId as AnyNodeId, patch)
  }

  const segment = useScene((s) =>
    node?.roofSegmentId
      ? (s.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
      : undefined,
  )

  const handleUpdate = useCallback(
    (updates: Partial<RidgeVentNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
      useLiveNodeOverrides.getState().clear(selectedId as AnyNodeId)
    },
    [selectedId, updateNode],
  )

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
    // Type-union escape — see box-vent panel.
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

  if (!(node && node.type === 'ridge-vent' && selectedId)) return null

  const fit = segment
    ? resolveRidgeVentPlacement(segment, node, node.position[0], node.position[2], { fit: true })
    : null
  const align = segment
    ? resolveRidgeVentPlacement(segment, node, node.position[0], node.position[2])
    : null

  return (
    <PanelWrapper
      icon="/icons/ridge-vent.webp"
      onBack={node.roofSegmentId ? handleBack : undefined}
      onClose={handleClose}
      title={node.name || 'Ridge Vent'}
      width={300}
    >
      <PanelSection title="Style">
        <div className="grid grid-cols-3 gap-2 px-1">
          {(['standard', 'shingled', 'metal'] as const).map((style) => (
            <button
              key={style}
              type="button"
              aria-pressed={node.style === style}
              onClick={() => handleUpdate({ style })}
              className={`flex flex-col items-center gap-2 rounded-lg border p-2 text-xs capitalize ${node.style === style ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-accent'}`}
            >
              <img
                src={`/icons/ridge-vent/${style}.webp`}
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
        <p className="px-1 text-xs text-muted-foreground">
          {node.style === 'standard'
            ? 'Rounded continuous cap.'
            : node.style === 'shingled'
              ? 'Peaked cap with raised shingle seams.'
              : 'Folded cap with a broad crown and edge hems.'}
        </p>
      </PanelSection>
      <PanelSection title="Installation">
        <SegmentedControl
          onChange={(v) => handleUpdate({ endCaps: v === 'yes' })}
          options={[
            { label: 'End Caps', value: 'yes' },
            { label: 'Open', value: 'no' },
          ]}
          value={(node.endCaps ?? true) ? 'yes' : 'no'}
        />
      </PanelSection>

      <PanelSection title="Ridge placement">
        <div className="flex gap-2 px-1">
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs disabled:opacity-40"
            disabled={!align?.valid}
            onClick={() =>
              align && handleUpdate({ position: align.position, rotation: align.rotation })
            }
          >
            Align to ridge
          </button>
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs disabled:opacity-40"
            disabled={!fit}
            onClick={() =>
              fit &&
              handleUpdate({ position: fit.position, rotation: fit.rotation, length: fit.length })
            }
          >
            Fit ridge
          </button>
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          {fit
            ? `Available ridge run: ${fit.availableLength.toFixed(2)} m`
            : 'This roof has no supported ridge run.'}
        </p>
      </PanelSection>

      <PanelSection title="Dimensions">
        <SliderControl
          label="Length"
          min={0.2}
          onChange={(v) => previewProp({ length: v })}
          onCommit={(v) => handleUpdate({ length: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={node.length}
        />
        <SliderControl
          label="Width"
          min={0.1}
          onChange={(v) => previewProp({ width: v })}
          onCommit={(v) => handleUpdate({ width: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.01}
          unit="m"
          value={node.width}
        />
        <SliderControl
          label="Height"
          min={0.02}
          onChange={(v) => previewProp({ height: v })}
          onCommit={(v) => handleUpdate({ height: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={node.height}
        />
      </PanelSection>

      <PanelSection title="Position" defaultExpanded={false}>
        <SliderControl
          label="X"
          onChange={(v) =>
            previewProp({
              position: [v, node.position[1] ?? 0, node.position[2] ?? 0],
            })
          }
          onCommit={(v) =>
            handleUpdate({
              position: [v, node.position[1] ?? 0, node.position[2] ?? 0],
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
              position: [node.position[0] ?? 0, v, node.position[2] ?? 0],
            })
          }
          onCommit={(v) =>
            handleUpdate({
              position: [node.position[0] ?? 0, v, node.position[2] ?? 0],
            })
          }
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={node.position[1] ?? 0}
        />
        <SliderControl
          label="Z"
          onChange={(v) =>
            previewProp({
              position: [node.position[0] ?? 0, node.position[1] ?? 0, v],
            })
          }
          onCommit={(v) =>
            handleUpdate({
              position: [node.position[0] ?? 0, node.position[1] ?? 0, v],
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
