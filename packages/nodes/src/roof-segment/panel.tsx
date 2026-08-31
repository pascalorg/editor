'use client'

import {
  type AnyNode,
  type AnyNodeId,
  createDefaultRidgeVentsForSegment,
  getConicalRoofCoverage,
  isAutoGutterEnabled,
  isAutoRidgeVentEnabled,
  isDefaultRidgeVentNode,
  normalizeRoofSegmentTrim,
  ROOF_SHAPE_DEFAULTS,
  type RoofSegmentNode,
  RoofSegmentNode as RoofSegmentNodeSchema,
  type RoofSegmentTrim,
  type RoofType,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
  SliderControl,
  ToggleControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Check, Copy, Move, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { useCallback } from 'react'

const ROOF_TYPE_OPTIONS: { label: string; value: RoofType }[] = [
  { label: 'Hip', value: 'hip' },
  { label: 'Gable', value: 'gable' },
  { label: 'Shed', value: 'shed' },
]

const ROOF_TYPE_OPTIONS_2: { label: string; value: RoofType }[] = [
  { label: 'Flat', value: 'flat' },
  { label: 'Gambrel', value: 'gambrel' },
  { label: 'Dutch', value: 'dutch' },
  { label: 'Mansard', value: 'mansard' },
]

const ROOF_TYPE_OPTIONS_3: { label: string; value: RoofType }[] = [
  { label: 'Conical', value: 'conical' },
]

// Carpenter / roofer convention: rise over a 12" run, converted to degrees.
// atan(3/12) ≈ 14.04°, atan(6/12) ≈ 26.57°, atan(9/12) ≈ 36.87°, atan(12/12) = 45°.
const PITCH_PRESETS: { label: string; deg: number }[] = [
  { label: '3/12', deg: 14.04 },
  { label: '6/12', deg: 26.57 },
  { label: '9/12', deg: 36.87 },
  { label: '12/12', deg: 45 },
]

const EMPTY_TRIM: RoofSegmentTrim = {
  left: 0,
  right: 0,
  front: 0,
  back: 0,
  frontLeft: 0,
  frontRight: 0,
  backLeft: 0,
  backRight: 0,
  frontLeftX: 0,
  frontLeftZ: 0,
  frontRightX: 0,
  frontRightZ: 0,
  backLeftX: 0,
  backLeftZ: 0,
  backRightX: 0,
  backRightZ: 0,
}

function hasSegmentTrim(node: RoofSegmentNode): boolean {
  return Object.values(normalizeRoofSegmentTrim(node)).some((value) => value > 0)
}

function shouldShowTrimPlanes(metadata: unknown): boolean {
  return metadataRecord(metadata).showTrimPlanes === true
}

function isManagedLeanToRoofSegment(metadata: unknown): boolean {
  const record = metadataRecord(metadata)
  return record.managedByLeanTo !== undefined && record.leanToRole === 'roof-segment'
}

function metadataRecord(metadata: unknown): Record<string, unknown> {
  if (typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>
  }
  return {}
}

export default function RoofSegmentPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const setRoofHostDragArmedId = useEditor((s) => s.setRoofHostDragArmedId)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as RoofSegmentNode | undefined) : undefined,
  )
  const autoRidgeVentEnabled = useScene((s) => {
    const current = selectedId
      ? (s.nodes[selectedId as AnyNode['id']] as RoofSegmentNode | undefined)
      : undefined
    if (current?.type !== 'roof-segment') return false
    return isAutoRidgeVentEnabled(current, s.nodes)
  })
  const autoGutterEnabled = useScene((s) => {
    const current = selectedId
      ? (s.nodes[selectedId as AnyNode['id']] as RoofSegmentNode | undefined)
      : undefined
    if (current?.type !== 'roof-segment') return false
    return isAutoGutterEnabled(current, s.nodes)
  })

  const handleUpdate = useCallback(
    (updates: Partial<RoofSegmentNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleRoofTypeChange = useCallback(
    (roofType: RoofType) => {
      if (isManagedLeanToRoofSegment(node?.metadata)) return
      if (roofType === 'conical' && node) {
        const scene = useScene.getState()
        const defaultVentIds = (node.children ?? []).filter((childId) =>
          isDefaultRidgeVentNode(scene.nodes[childId as AnyNodeId], node.id),
        ) as AnyNodeId[]
        if (defaultVentIds.length > 0) scene.deleteNodes(defaultVentIds)
      }
      // Switching to Dutch resets the shape parameters to their defaults so the
      // gablet is well-formed regardless of the leftover values from the
      // previous roof type.
      handleUpdate(
        roofType === 'conical'
          ? {
              roofType,
              depth: node?.width ?? 8,
              rotation: 0,
              trim: EMPTY_TRIM,
              conicalFullCircle: true,
              metadata: {
                ...metadataRecord(node?.metadata),
                autoGutter: false,
                autoRidgeVent: false,
                showTrimPlanes: false,
              },
            }
          : roofType === 'dutch'
            ? {
                roofType,
                dutchHipWidthRatio: ROOF_SHAPE_DEFAULTS.dutchHipWidthRatio,
                dutchHipHeightRatio: ROOF_SHAPE_DEFAULTS.dutchHipHeightRatio,
                dutchWaistLengthRatio: ROOF_SHAPE_DEFAULTS.dutchWaistLengthRatio,
                dutchGabletRake: ROOF_SHAPE_DEFAULTS.dutchGabletRake,
                dutchTopRakeThickness: ROOF_SHAPE_DEFAULTS.dutchTopRakeThickness,
              }
            : { roofType },
      )
    },
    [handleUpdate, node],
  )

  const handleClose = useCallback(() => {
    if (node && shouldShowTrimPlanes(node.metadata)) {
      updateNode(node.id, {
        metadata: { ...metadataRecord(node.metadata), showTrimPlanes: false },
      })
    }
    setSelection({ selectedIds: [] })
  }, [node, setSelection, updateNode])

  const handleBack = useCallback(() => {
    if (node?.parentId) {
      if (shouldShowTrimPlanes(node.metadata)) {
        updateNode(node.id, {
          metadata: { ...metadataRecord(node.metadata), showTrimPlanes: false },
        })
      }
      setRoofHostDragArmedId(node.parentId as AnyNodeId)
      setSelection({ selectedIds: [node.parentId] })
    }
  }, [node, setRoofHostDragArmedId, setSelection, updateNode])

  const handleDuplicate = useCallback(() => {
    if (!node?.parentId) return
    triggerSFX('sfx:item-pick')

    let duplicateInfo = structuredClone(node) as any
    delete duplicateInfo.id
    duplicateInfo.metadata = { ...duplicateInfo.metadata, isNew: true }
    // Offset slightly so it's visible
    duplicateInfo.position = [
      duplicateInfo.position[0] + 1,
      duplicateInfo.position[1],
      duplicateInfo.position[2] + 1,
    ]

    try {
      const duplicate = RoofSegmentNodeSchema.parse(duplicateInfo)
      useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
      setSelection({ selectedIds: [] })
      setMovingNode(duplicate)
    } catch (e) {
      console.error('Failed to duplicate roof segment', e)
    }
  }, [node, setSelection, setMovingNode])

  const handleMove = useCallback(() => {
    if (node) {
      triggerSFX('sfx:item-pick')
      setMovingNode(node)
      setSelection({ selectedIds: [] })
    }
  }, [node, setMovingNode, setSelection])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    triggerSFX('sfx:item-delete')
    const parentId = node.parentId
    useScene.getState().deleteNode(selectedId as AnyNodeId)
    if (parentId) {
      useScene.getState().dirtyNodes.add(parentId as AnyNodeId)
      setSelection({ selectedIds: [parentId] })
    } else {
      setSelection({ selectedIds: [] })
    }
  }, [selectedId, node, setSelection])

  const handleAutoRidgeVentToggle = useCallback(
    (checked: boolean) => {
      if (!selectedId) return
      const scene = useScene.getState()
      const current = scene.nodes[selectedId as AnyNodeId] as RoofSegmentNode | undefined
      if (current?.type !== 'roof-segment') return

      scene.updateNode(selectedId as AnyNodeId, {
        metadata: { ...metadataRecord(current.metadata), autoRidgeVent: checked },
      })

      const latest = useScene.getState().nodes[selectedId as AnyNodeId] as
        | RoofSegmentNode
        | undefined
      if (latest?.type !== 'roof-segment') return

      const defaultVentIds = (latest.children ?? []).filter((childId) =>
        isDefaultRidgeVentNode(useScene.getState().nodes[childId as AnyNodeId], latest.id),
      ) as AnyNodeId[]

      if (!checked) {
        if (defaultVentIds.length > 0) {
          useScene.getState().deleteNodes(defaultVentIds)
        }
        return
      }

      if (defaultVentIds.length > 0) return

      const ridgeVents = createDefaultRidgeVentsForSegment(latest)
      if (ridgeVents.length === 0) return

      scene.createNodes(
        ridgeVents.map((ridgeVent) => ({
          node: ridgeVent,
          parentId: latest.id as AnyNodeId,
        })),
      )
    },
    [selectedId],
  )

  const handleAutoGutterToggle = useCallback(
    (checked: boolean) => {
      if (!selectedId) return
      const scene = useScene.getState()
      const current = scene.nodes[selectedId as AnyNodeId] as RoofSegmentNode | undefined
      if (current?.type !== 'roof-segment') return
      scene.updateNode(selectedId as AnyNodeId, {
        metadata: { ...metadataRecord(current.metadata), autoGutter: checked },
      })
    },
    [selectedId],
  )

  const handleTrimEditing = useCallback(
    (editing: boolean) => {
      if (!node) return
      triggerSFX('sfx:item-pick')
      handleUpdate({
        metadata: { ...metadataRecord(node.metadata), showTrimPlanes: editing },
      })
    },
    [handleUpdate, node],
  )

  const handleResetTrim = useCallback(() => {
    if (!node || !hasSegmentTrim(node)) return
    triggerSFX('sfx:item-pick')
    handleUpdate({ trim: EMPTY_TRIM })
  }, [handleUpdate, node])

  if (!(node && node.type === 'roof-segment' && selectedId)) return null

  const showTrimPlanes = shouldShowTrimPlanes(node.metadata)
  const managedLeanToRoofSegment = isManagedLeanToRoofSegment(node.metadata)
  const conicalCoverage = getConicalRoofCoverage(node)

  return (
    <PanelWrapper
      icon="/icons/roof.webp"
      onBack={handleBack}
      onClose={handleClose}
      title={node.name || 'Roof Segment'}
      width={300}
    >
      <PanelSection title="Roof Type">
        <SegmentedControl
          onChange={(v) => handleRoofTypeChange(v)}
          options={ROOF_TYPE_OPTIONS}
          value={node.roofType}
          disabled={managedLeanToRoofSegment}
        />
        <SegmentedControl
          onChange={(v) => handleRoofTypeChange(v)}
          options={ROOF_TYPE_OPTIONS_2}
          value={node.roofType}
          disabled={managedLeanToRoofSegment}
        />
        <SegmentedControl
          onChange={(v) => handleRoofTypeChange(v)}
          options={ROOF_TYPE_OPTIONS_3}
          value={node.roofType}
          disabled={managedLeanToRoofSegment}
        />
      </PanelSection>

      {node.roofType !== 'conical' && (
        <PanelSection title="Trim">
          <ActionGroup>
            <ActionButton
              icon={
                showTrimPlanes ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Pencil className="h-3.5 w-3.5" />
                )
              }
              label={showTrimPlanes ? 'Done editing' : 'Edit footprint'}
              onClick={() => (showTrimPlanes ? handleBack() : handleTrimEditing(true))}
            />
            <ActionButton
              className="disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!hasSegmentTrim(node)}
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              label="Reset"
              onClick={handleResetTrim}
            />
          </ActionGroup>
          {node.roofType !== 'shed' && node.roofType !== 'flat' && (
            <ToggleControl
              checked={autoRidgeVentEnabled}
              label="Auto ridge vent"
              onChange={handleAutoRidgeVentToggle}
            />
          )}
        </PanelSection>
      )}

      {node.roofType !== 'conical' && (
        <PanelSection title="Drainage">
          <ToggleControl
            checked={autoGutterEnabled}
            label="Auto gutters"
            onChange={handleAutoGutterToggle}
          />
        </PanelSection>
      )}

      <PanelSection title="Footprint">
        {node.roofType === 'conical' ? (
          <SliderControl
            label="Diameter"
            max={1000}
            min={0.5}
            onChange={(v) => handleUpdate({ width: v, depth: v })}
            precision={2}
            step={0.5}
            unit="m"
            value={Math.round(node.width * 100) / 100}
          />
        ) : (
          <>
            <SliderControl
              label="Width"
              max={1000}
              min={0.5}
              onChange={(v) => handleUpdate({ width: v })}
              precision={2}
              step={0.5}
              unit="m"
              value={Math.round(node.width * 100) / 100}
            />
            <SliderControl
              label="Depth"
              max={1000}
              min={0.5}
              onChange={(v) => handleUpdate({ depth: v })}
              precision={2}
              step={0.5}
              unit="m"
              value={Math.round(node.depth * 100) / 100}
            />
          </>
        )}
      </PanelSection>

      {node.roofType === 'conical' && (
        <PanelSection title="Conical Shape">
          <ToggleControl
            checked={!conicalCoverage.fullCircle}
            label="Clipped version"
            onChange={(checked) => handleUpdate({ conicalFullCircle: !checked })}
          />
          {!conicalCoverage.fullCircle && (
            <>
              <SliderControl
                label="Start Angle"
                max={180}
                min={-180}
                onChange={(degrees) =>
                  handleUpdate({ conicalStartAngle: (degrees * Math.PI) / 180 })
                }
                precision={0}
                step={1}
                unit="°"
                value={Math.round((conicalCoverage.startAngle * 180) / Math.PI)}
              />
              <SliderControl
                label="Arc"
                max={345}
                min={15}
                onChange={(degrees) =>
                  handleUpdate({
                    conicalSweepAngle:
                      (Math.sign(conicalCoverage.sweepAngle) * degrees * Math.PI) / 180,
                  })
                }
                precision={0}
                step={1}
                unit="°"
                value={Math.round((Math.abs(conicalCoverage.sweepAngle) * 180) / Math.PI)}
              />
            </>
          )}
        </PanelSection>
      )}

      <PanelSection title="Drainage">
        <ToggleControl
          checked={autoGutterEnabled}
          label="Auto gutters"
          onChange={handleAutoGutterToggle}
        />
      </PanelSection>

      <PanelSection title="Wall Height">
        <SliderControl
          label="Wall"
          max={1000}
          min={0}
          onChange={(v) => handleUpdate({ wallHeight: v })}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(node.wallHeight * 100) / 100}
        />
      </PanelSection>

      <PanelSection title="Pitch">
        <SliderControl
          label="Angle"
          max={60}
          min={0}
          onChange={(v) => handleUpdate({ pitch: v })}
          precision={0}
          step={1}
          unit="°"
          value={Math.round(node.pitch)}
        />
        <div className="flex gap-1.5 px-1 pt-2 pb-1">
          {PITCH_PRESETS.map((preset) => (
            <ActionButton
              key={preset.label}
              label={preset.label}
              onClick={() => handleUpdate({ pitch: preset.deg })}
            />
          ))}
        </div>
      </PanelSection>

      {node.roofType === 'gambrel' && (
        <PanelSection title="Shape">
          <SliderControl
            label="Kink Depth"
            max={0.9}
            min={0.1}
            onChange={(v) => handleUpdate({ gambrelLowerWidthRatio: v })}
            precision={2}
            step={0.01}
            unit=""
            value={Math.round(node.gambrelLowerWidthRatio * 100) / 100}
          />
          <SliderControl
            label="Kink Height"
            max={0.9}
            min={0.1}
            onChange={(v) => handleUpdate({ gambrelLowerHeightRatio: v })}
            precision={2}
            step={0.01}
            unit=""
            value={Math.round(node.gambrelLowerHeightRatio * 100) / 100}
          />
        </PanelSection>
      )}

      {node.roofType === 'mansard' && (
        <PanelSection title="Shape">
          <SliderControl
            label="Waist Width"
            max={0.45}
            min={0.05}
            onChange={(v) => handleUpdate({ mansardSteepWidthRatio: v })}
            precision={2}
            step={0.01}
            unit=""
            value={Math.round(node.mansardSteepWidthRatio * 100) / 100}
          />
          <SliderControl
            label="Waist Height"
            max={0.9}
            min={0.1}
            onChange={(v) => handleUpdate({ mansardSteepHeightRatio: v })}
            precision={2}
            step={0.01}
            unit=""
            value={Math.round(node.mansardSteepHeightRatio * 100) / 100}
          />
        </PanelSection>
      )}

      {node.roofType === 'dutch' && (
        <PanelSection title="Shape">
          <SliderControl
            label="Waist Width"
            max={0.45}
            min={0.05}
            onChange={(v) => handleUpdate({ dutchHipWidthRatio: v })}
            precision={2}
            step={0.01}
            unit=""
            value={Math.round(node.dutchHipWidthRatio * 100) / 100}
          />
          <SliderControl
            label="Waist Height"
            max={0.9}
            min={0.1}
            onChange={(v) => handleUpdate({ dutchHipHeightRatio: v })}
            precision={2}
            step={0.01}
            unit=""
            value={Math.round(node.dutchHipHeightRatio * 100) / 100}
          />
          <SliderControl
            label="Waist Length"
            max={1}
            min={0.1}
            onChange={(v) => handleUpdate({ dutchWaistLengthRatio: v })}
            precision={2}
            step={0.01}
            unit=""
            value={
              Math.round(
                (node.dutchWaistLengthRatio ?? ROOF_SHAPE_DEFAULTS.dutchWaistLengthRatio) * 100,
              ) / 100
            }
          />
          <SliderControl
            label="Top Rake Thick."
            max={0.5}
            min={0.01}
            onChange={(v) => handleUpdate({ dutchTopRakeThickness: v })}
            precision={2}
            step={0.01}
            unit="m"
            value={
              Math.round(
                (node.dutchTopRakeThickness ?? ROOF_SHAPE_DEFAULTS.dutchTopRakeThickness) * 100,
              ) / 100
            }
          />
          <SliderControl
            label="Top Rake Length"
            max={3}
            min={0}
            onChange={(v) => handleUpdate({ dutchGabletRake: v })}
            precision={2}
            step={0.01}
            unit="m"
            value={
              Math.round((node.dutchGabletRake ?? ROOF_SHAPE_DEFAULTS.dutchGabletRake) * 100) / 100
            }
          />
        </PanelSection>
      )}

      <PanelSection title="Structure">
        <SliderControl
          label="Wall Thick."
          max={1}
          min={0.05}
          onChange={(v) => handleUpdate({ wallThickness: v })}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.wallThickness * 100) / 100}
        />
        <SliderControl
          label="Deck Thick."
          max={0.3}
          min={0.04}
          onChange={(v) => handleUpdate({ deckThickness: v })}
          precision={2}
          step={0.01}
          unit="m"
          value={Math.round(node.deckThickness * 100) / 100}
        />
        <SliderControl
          label="Overhang"
          max={1}
          min={0}
          onChange={(v) => handleUpdate({ overhang: v })}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.overhang * 100) / 100}
        />
        <SliderControl
          label="Shingle Thick."
          max={0.3}
          min={0.02}
          onChange={(v) => handleUpdate({ shingleThickness: v })}
          precision={2}
          step={0.01}
          unit="m"
          value={Math.round(node.shingleThickness * 100) / 100}
        />
      </PanelSection>

      <PanelSection title="Position">
        <SliderControl
          label="X"
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[0] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.position[0] * 100) / 100}
        />
        <SliderControl
          label="Y"
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[1] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.position[1] * 100) / 100}
        />
        <SliderControl
          label="Z"
          onChange={(v) => {
            const pos = [...node.position] as [number, number, number]
            pos[2] = v
            handleUpdate({ position: pos })
          }}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.position[2] * 100) / 100}
        />
        {(node.roofType !== 'conical' || !conicalCoverage.fullCircle) && (
          <>
            <SliderControl
              label="Rotation"
              max={180}
              min={-180}
              onChange={(degrees) => {
                handleUpdate({ rotation: (degrees * Math.PI) / 180 })
              }}
              precision={0}
              step={1}
              unit="°"
              value={Math.round((node.rotation * 180) / Math.PI)}
            />
            <div className="flex gap-1.5 px-1 pt-2 pb-1">
              <ActionButton
                label="-45°"
                onClick={() => {
                  triggerSFX('sfx:item-rotate')
                  handleUpdate({ rotation: node.rotation - Math.PI / 4 })
                }}
              />
              <ActionButton
                label="+45°"
                onClick={() => {
                  triggerSFX('sfx:item-rotate')
                  handleUpdate({ rotation: node.rotation + Math.PI / 4 })
                }}
              />
            </div>
          </>
        )}
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
