'use client'

import {
  type AnyNode,
  type AnyNodeId,
  getEffectiveWallSurfaceMaterial,
  getClampedWallCurveOffset,
  getMaxWallCurveOffset,
  getWallCurveLength,
  getWallSurfaceMaterialSignature,
  normalizeWallCurveOffset,
  type MaterialSchema,
  useScene,
  type WallSurfaceSide,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Move, Spline } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { MaterialPicker } from '../controls/material-picker'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'
import { PanelWrapper } from './panel-wrapper'

function buildWallSurfaceMaterialPatch(
  node: WallNode,
  targetSide: WallSurfaceSide | null,
  material: MaterialSchema | undefined,
  materialPreset: string | undefined,
): Partial<WallNode> {
  const nextSurfaceMaterial = { material, materialPreset }
  const nextInterior =
    targetSide === null || targetSide === 'interior'
      ? nextSurfaceMaterial
      : getEffectiveWallSurfaceMaterial(node, 'interior')
  const nextExterior =
    targetSide === null || targetSide === 'exterior'
      ? nextSurfaceMaterial
      : getEffectiveWallSurfaceMaterial(node, 'exterior')

  return {
    interiorMaterial: nextInterior.material,
    interiorMaterialPreset: nextInterior.materialPreset,
    exteriorMaterial: nextExterior.material,
    exteriorMaterialPreset: nextExterior.materialPreset,
    material: undefined,
    materialPreset: undefined,
  }
}

export function WallPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const setCurvingWall = useEditor((s) => s.setCurvingWall)
  const selectedMaterialTarget = useEditor((s) => s.selectedMaterialTarget)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as WallNode | undefined) : undefined,
  )

  // Boolean selector — re-renders only when this specific wall's child
  // composition crosses the "has a door/window/wall-item" threshold.
  const hasWallChildrenBlockingCurve = useScene((s) => {
    if (!node) return false
    return (node.children ?? []).some((childId) => {
      const child = s.nodes[childId as AnyNodeId]
      if (!child) return false
      if (child.type === 'door' || child.type === 'window') return true
      if (child.type === 'item') {
        const attachTo = child.asset?.attachTo
        return attachTo === 'wall' || attachTo === 'wall-side'
      }
      return false
    })
  })

  const handleUpdate = useCallback(
    (updates: Partial<WallNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
      useScene.getState().dirtyNodes.add(selectedId as AnyNodeId)
    },
    [selectedId, updateNode],
  )

  const effectiveInteriorMaterial = useMemo(
    () => (node ? getEffectiveWallSurfaceMaterial(node, 'interior') : {}),
    [node],
  )
  const effectiveExteriorMaterial = useMemo(
    () => (node ? getEffectiveWallSurfaceMaterial(node, 'exterior') : {}),
    [node],
  )
  const surfaceMaterialsMatch = useMemo(
    () =>
      getWallSurfaceMaterialSignature(effectiveInteriorMaterial) ===
      getWallSurfaceMaterialSignature(effectiveExteriorMaterial),
    [effectiveExteriorMaterial, effectiveInteriorMaterial],
  )
  const materialTargetSide =
    selectedMaterialTarget &&
    selectedMaterialTarget.nodeId === node?.id &&
    (selectedMaterialTarget.role === 'interior' || selectedMaterialTarget.role === 'exterior')
      ? selectedMaterialTarget.role
      : null
  const materialPickerValue =
    materialTargetSide === 'interior'
      ? effectiveInteriorMaterial
      : materialTargetSide === 'exterior'
        ? effectiveExteriorMaterial
        : surfaceMaterialsMatch
          ? effectiveInteriorMaterial
          : {}

  const handleUpdateLength = useCallback(
    (newLength: number) => {
      if (!node || newLength <= 0) return

      const dx = node.end[0] - node.start[0]
      const dz = node.end[1] - node.start[1]
      const currentLength = Math.sqrt(dx * dx + dz * dz)

      if (currentLength === 0) return

      const dirX = dx / currentLength
      const dirZ = dz / currentLength

      const newEnd: [number, number] = [
        node.start[0] + dirX * newLength,
        node.start[1] + dirZ * newLength,
      ]

      handleUpdate({ end: newEnd })
    },
    [node, handleUpdate],
  )

  const handleMaterialPresetChange = useCallback(
    (materialPreset: string) => {
      if (!node || !materialTargetSide) return
      handleUpdate(buildWallSurfaceMaterialPatch(node, materialTargetSide, undefined, materialPreset))
    },
    [handleUpdate, materialTargetSide, node],
  )

  const handleCustomMaterialChange = useCallback(
    (material: MaterialSchema) => {
      if (!node || !materialTargetSide) return
      handleUpdate(buildWallSurfaceMaterialPatch(node, materialTargetSide, material, undefined))
    },
    [handleUpdate, materialTargetSide, node],
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

  const handleCurve = useCallback(() => {
    if (!node) return
    sfxEmitter.emit('sfx:item-pick')
    setCurvingWall(node)
    setSelection({ selectedIds: [] })
  }, [node, setCurvingWall, setSelection])

  if (!(node && node.type === 'wall' && selectedId)) return null

  const dx = node.end[0] - node.start[0]
  const dz = node.end[1] - node.start[1]
  const length = getWallCurveLength(node)

  const height = node.height ?? 2.5
  const thickness = node.thickness ?? 0.1
  const curveOffset = getClampedWallCurveOffset(node)
  const maxCurveOffset = getMaxWallCurveOffset(node)

  return (
    <PanelWrapper
      icon="/icons/wall.png"
      onClose={handleClose}
      title={node.name || 'Wall'}
      width={280}
    >
      <PanelSection title="Dimensions">
        <SliderControl
          label="Length"
          max={20}
          min={0.1}
          onChange={handleUpdateLength}
          precision={2}
          step={0.01}
          unit="m"
          value={length}
        />
        <SliderControl
          label="Height"
          max={6}
          min={0.1}
          onChange={(v) => handleUpdate({ height: Math.max(0.1, v) })}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(height * 100) / 100}
        />
        <SliderControl
          label="Thickness"
          max={1}
          min={0.05}
          onChange={(v) => handleUpdate({ thickness: Math.max(0.05, v) })}
          precision={3}
          step={0.01}
          unit="m"
          value={Math.round(thickness * 1000) / 1000}
        />
        {!hasWallChildrenBlockingCurve && (
          <SliderControl
            label="Curve"
            max={Math.max(0.01, maxCurveOffset)}
            min={-Math.max(0.01, maxCurveOffset)}
            onChange={(v) => handleUpdate({ curveOffset: normalizeWallCurveOffset(node, v) })}
            precision={2}
            step={0.1}
            unit="m"
            value={Math.round(curveOffset * 100) / 100}
          />
        )}
      </PanelSection>

      <PanelSection title="Material">
        {!materialTargetSide ? (
          <div className="mb-3 rounded-lg border border-border/50 bg-[#2C2C2E] px-3 py-2 text-[11px] text-muted-foreground">
            Click the wall face you want to edit. Materials now apply to one side at a time.
          </div>
        ) : null}
        <MaterialPicker
          disabled={!materialTargetSide}
          hideSideControl
          nodeType="wall"
          onChange={handleCustomMaterialChange}
          onSelectMaterialPreset={handleMaterialPresetChange}
          selectedMaterialPreset={materialPickerValue.materialPreset}
          value={materialPickerValue.material}
        />
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton icon={<Move className="h-3.5 w-3.5" />} label="Move" onClick={handleMove} />
          {!hasWallChildrenBlockingCurve && (
            <ActionButton
              icon={<Spline className="h-3.5 w-3.5" />}
              label="Curve"
              onClick={handleCurve}
            />
          )}
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
