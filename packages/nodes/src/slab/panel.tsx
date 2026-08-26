'use client'

import { type AnyNode, MIN_SLAB_THICKNESS, type SlabNode, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  holeEditScope,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
  SliderControl,
  triggerSFX,
  useEditingHole,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Edit, Move, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import {
  applySlabAnchorElevationChange,
  applySlabElevationPreset,
  applySlabRecessDepthChange,
  applySlabThicknessChange,
  applySlabTopChange,
  clampSlabElevation,
  getSlabAnchorElevation,
  getSlabBaseElevation,
  getSlabRecessDepth,
} from './elevation-limit'

/**
 * Phase 5 Stage E — slab inspector (kind-owned).
 *
 * 1:1 port of the legacy `SlabPanel`. Mounted via
 * `parametrics.customPanel` because the slab editor has shape-specific
 * concerns (elevation presets, area display, holes list with auto-
 * vs-manual provenance) that don't fit the auto-derived
 * `<ParametricInspector>` field model yet. When the inspector grows
 * `list` / `computed` / `action` field kinds, this panel collapses
 * into `parametrics.groups`.
 */
export function SlabPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const unit = useViewer((s) => s.unit)
  const setSelection = useViewer((s) => s.setSelection)
  const editingHole = useEditingHole()
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as SlabNode | undefined) : undefined,
  )

  // See "Panel slider-drag fix recipe" in plans/editor-node-registry.md.
  // Stable handler refs across re-renders so slider drags don't trigger
  // a Maximum update depth cascade on the panel's SliderControls.
  const nodeRef = useRef(node)
  nodeRef.current = node

  const handleUpdate = useCallback(
    (updates: Partial<SlabNode>) => {
      if (!selectedId) return
      useScene.getState().updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId],
  )

  const handleElevationChange = useCallback(
    (proposed: number) => {
      const current = nodeRef.current
      if (!current) return
      const { elevation } = clampSlabElevation(useScene.getState().nodes, current, proposed)
      handleUpdate(applySlabTopChange(current, elevation))
    },
    [handleUpdate],
  )

  const handleThicknessChange = useCallback(
    (proposed: number) => {
      const current = nodeRef.current
      if (!current) return
      const base = getSlabBaseElevation(current)
      const requested = applySlabThicknessChange(current, proposed)
      const clamped = clampSlabElevation(useScene.getState().nodes, current, requested.elevation)
      handleUpdate(
        applySlabThicknessChange(current, Math.max(MIN_SLAB_THICKNESS, clamped.elevation - base)),
      )
    },
    [handleUpdate],
  )

  const handleAnchorChange = useCallback(
    (proposed: number) => {
      const current = nodeRef.current
      if (!current) return
      const patch = applySlabAnchorElevationChange(current, proposed)
      const requestedTop = patch.elevation ?? current.elevation
      const { elevation } = clampSlabElevation(useScene.getState().nodes, current, requestedTop)
      if (current.recessed) {
        const delta = elevation - requestedTop
        handleUpdate({
          ...patch,
          elevation,
          recessedRimElevation: (patch.recessedRimElevation ?? proposed) + delta,
        })
        return
      }
      handleUpdate(applySlabAnchorElevationChange(current, elevation - current.thickness))
    },
    [handleUpdate],
  )

  const handleRecessDepthChange = useCallback(
    (proposed: number) => {
      const current = nodeRef.current
      if (!current?.recessed) return
      handleUpdate(applySlabRecessDepthChange(current, proposed))
    },
    [handleUpdate],
  )

  const handleElevationPreset = useCallback(
    (signedDepth: number) => {
      const current = nodeRef.current
      if (!current) return
      const anchor = getSlabAnchorElevation(current)
      const requested = applySlabElevationPreset(current, signedDepth)
      if (requested.recessed) {
        handleUpdate(requested)
        return
      }
      const requestedTop = requested.elevation ?? current.elevation
      const { elevation } = clampSlabElevation(useScene.getState().nodes, current, requestedTop)
      const thickness = Math.max(MIN_SLAB_THICKNESS, elevation - anchor)
      handleUpdate({ ...requested, elevation: anchor + thickness, thickness })
    },
    [handleUpdate],
  )

  const handleTerrainModeChange = useCallback(
    (mode: 'fixed' | 'terrain') => {
      handleUpdate({ fillToTerrain: mode === 'terrain' ? true : undefined })
    },
    [handleUpdate],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
    useInteractionScope
      .getState()
      .endIf((scope) => scope.kind === 'reshaping' && scope.reshape === 'hole')
  }, [setSelection])

  useEffect(() => {
    if (!node) {
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'reshaping' && scope.reshape === 'hole')
    }
  }, [node])

  useEffect(() => {
    return () => {
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'reshaping' && scope.reshape === 'hole')
    }
  }, [])

  const handleAddHole = useCallback(() => {
    if (!(node && selectedId)) return

    const polygon = node.polygon
    let cx = 0
    let cz = 0
    for (const [x, z] of polygon) {
      cx += x
      cz += z
    }
    cx /= polygon.length
    cz /= polygon.length

    const holeSize = 0.5
    const newHole: Array<[number, number]> = [
      [cx - holeSize, cz - holeSize],
      [cx + holeSize, cz - holeSize],
      [cx + holeSize, cz + holeSize],
      [cx - holeSize, cz + holeSize],
    ]
    const currentHoles = node?.holes || []
    const currentMetadata = currentHoles.map(
      (_, index) => node?.holeMetadata?.[index] ?? { source: 'manual' as const },
    )
    handleUpdate({
      holes: [...currentHoles, newHole],
      holeMetadata: [...currentMetadata, { source: 'manual' }],
    })
    useInteractionScope
      .getState()
      .begin(holeEditScope({ nodeId: selectedId, holeIndex: currentHoles.length }))
  }, [node, selectedId, handleUpdate])

  const handleEditHole = useCallback(
    (index: number) => {
      if (!selectedId) return
      useInteractionScope.getState().begin(holeEditScope({ nodeId: selectedId, holeIndex: index }))
    },
    [selectedId],
  )

  const handleDeleteHole = useCallback(
    (index: number) => {
      if (!selectedId) return
      const currentHoles = node?.holes || []
      if ((node?.holeMetadata?.[index]?.source ?? 'manual') !== 'manual') return
      const newHoles = currentHoles.filter((_, i) => i !== index)
      const currentMetadata = currentHoles.map(
        (_, metadataIndex) => node?.holeMetadata?.[metadataIndex] ?? { source: 'manual' as const },
      )
      const newMetadata = currentMetadata.filter((_, i) => i !== index)
      handleUpdate({ holes: newHoles, holeMetadata: newMetadata })
      if (editingHole?.nodeId === selectedId && editingHole?.holeIndex === index) {
        useInteractionScope
          .getState()
          .endIf((scope) => scope.kind === 'reshaping' && scope.reshape === 'hole')
      }
    },
    [selectedId, node?.holes, node?.holeMetadata, handleUpdate, editingHole],
  )

  const handleMove = useCallback(() => {
    if (!node) return
    triggerSFX('sfx:item-pick')
    setMovingNode(node)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  if (!(node && node.type === 'slab' && selectedId)) return null

  const calculateArea = (polygon: Array<[number, number]>): number => {
    if (polygon.length < 3) return 0
    let area = 0
    const n = polygon.length
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const current = polygon[i]
      const next = polygon[j]
      if (!(current && next)) continue
      area += current[0] * next[1]
      area -= next[0] * current[1]
    }
    return Math.abs(area) / 2
  }

  const area = calculateArea(node.polygon)

  // Clean preset values per display system; imperial stores exact meters
  // for whole-inch offsets.
  const elevationPresets =
    unit === 'imperial'
      ? [
          { label: 'Sunken (6")', elevation: -0.1524 },
          { label: 'Thin (1")', elevation: 0.0254 },
          { label: 'Standard (2")', elevation: 0.0508 },
          { label: 'Thick (6")', elevation: 0.1524 },
        ]
      : [
          { label: 'Sunken (15cm)', elevation: -0.15 },
          { label: 'Thin (2cm)', elevation: 0.02 },
          { label: 'Standard (5cm)', elevation: 0.05 },
          { label: 'Thick (15cm)', elevation: 0.15 },
        ]

  return (
    <PanelWrapper
      icon="/icons/floor.webp"
      onClose={handleClose}
      title={node.name || 'Slab'}
      width={320}
    >
      <PanelSection title="Elevation">
        {/* Range mirrors the 20 m storey cap; `clampSlabElevation` in the
            write path stays the real bound against the level. */}
        <SliderControl
          label={node.recessed ? 'Floor' : 'Surface'}
          max={20}
          min={-3}
          onChange={handleElevationChange}
          precision={3}
          step={0.01}
          unit="m"
          value={Math.round(node.elevation * 1000) / 1000}
        />

        <SliderControl
          label={node.recessed ? 'Rim' : 'Base'}
          max={20}
          min={-3}
          onChange={handleAnchorChange}
          precision={3}
          step={0.01}
          unit="m"
          value={Math.round(getSlabAnchorElevation(node) * 1000) / 1000}
        />

        {node.recessed ? (
          <SliderControl
            label="Depth"
            max={1000}
            min={MIN_SLAB_THICKNESS}
            onChange={handleRecessDepthChange}
            precision={2}
            step={0.01}
            unit="m"
            value={Math.round(getSlabRecessDepth(node) * 100) / 100}
          />
        ) : (
          <SliderControl
            label="Thickness"
            max={1000}
            min={MIN_SLAB_THICKNESS}
            onChange={handleThicknessChange}
            precision={2}
            step={0.01}
            unit="m"
            value={Math.round((node.thickness ?? 0.05) * 100) / 100}
          />
        )}

        {!node.recessed && (
          <>
            <div className="px-1 font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
              Foundation
            </div>
            <SegmentedControl
              onChange={handleTerrainModeChange}
              options={[
                { label: 'Fixed', value: 'fixed' },
                { label: 'Follows terrain', value: 'terrain' },
              ]}
              value={node.fillToTerrain ? 'terrain' : 'fixed'}
            />
            {node.fillToTerrain && (
              <div className="px-1 text-[11px] text-muted-foreground">
                Extends the perimeter down to terrain. The flat surface, base, and thickness stay
                unchanged.
              </div>
            )}
          </>
        )}

        <div className="mt-2 grid grid-cols-2 gap-1.5 px-1 pb-1">
          {elevationPresets.map((preset) => (
            <ActionButton
              key={preset.label}
              label={preset.label}
              onClick={() => handleElevationPreset(preset.elevation)}
            />
          ))}
        </div>
      </PanelSection>

      <PanelSection title="Info">
        <div className="flex items-center justify-between px-2 py-1 text-muted-foreground text-sm">
          <span>Area</span>
          <span className="font-mono text-white">{area.toFixed(2)} m²</span>
        </div>
      </PanelSection>

      <PanelSection title="Holes">
        {node.holes && node.holes.length > 0 ? (
          <div className="flex flex-col gap-1 pb-2">
            {node.holes.map((hole, index) => {
              const holeArea = calculateArea(hole)
              const isEditing =
                editingHole?.nodeId === selectedId && editingHole?.holeIndex === index
              const source = node.holeMetadata?.[index]?.source ?? 'manual'
              const isAutoHole = source !== 'manual'
              const autoLabel = source === 'elevator' ? 'Auto elevator cutout' : 'Auto stair cutout'
              return (
                <div
                  className={`flex items-center justify-between rounded-lg border p-2 transition-colors ${
                    isEditing
                      ? 'border-primary/50 bg-primary/10'
                      : 'border-transparent hover:bg-accent/30'
                  }`}
                  key={index}
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className={`font-medium text-xs ${isEditing ? 'text-primary' : 'text-white'}`}
                    >
                      Hole {index + 1} {isEditing && '(Editing)'}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {holeArea.toFixed(2)} m² · {hole.length} pts ·{' '}
                      {isAutoHole ? autoLabel : 'Manual'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {isEditing ? (
                      <ActionButton
                        className="h-7 bg-primary text-primary-foreground hover:bg-primary/90"
                        label="Done"
                        onClick={() =>
                          useInteractionScope
                            .getState()
                            .endIf(
                              (scope) => scope.kind === 'reshaping' && scope.reshape === 'hole',
                            )
                        }
                      />
                    ) : isAutoHole ? (
                      <div className="rounded-md bg-[#2C2C2E] px-2 py-1 text-[10px] text-muted-foreground">
                        Auto
                      </div>
                    ) : (
                      <>
                        <button
                          className="flex h-7 w-7 items-center justify-center rounded-md bg-[#2C2C2E] text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground"
                          onClick={() => handleEditHole(index)}
                          type="button"
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="flex h-7 w-7 items-center justify-center rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300"
                          onClick={() => handleDeleteHole(index)}
                          type="button"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="px-2 py-3 text-center text-muted-foreground text-xs">No holes</div>
        )}

        <div className="px-1 pt-1 pb-1">
          <ActionButton
            className="w-full"
            disabled={editingHole?.nodeId === selectedId}
            icon={<Plus className="h-3.5 w-3.5" />}
            label="Add Hole"
            onClick={handleAddHole}
          />
        </div>
      </PanelSection>
      <ActionGroup>
        <ActionButton icon={<Move className="h-3.5 w-3.5" />} label="Move" onClick={handleMove} />
      </ActionGroup>
    </PanelWrapper>
  )
}

export default SlabPanel
