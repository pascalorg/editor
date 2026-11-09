'use client'

import {
  type AnyNode,
  type AnyNodeId,
  createDefaultRidgeVentsForSegment,
  getConicalRoofCoverage,
  getRoofSegmentDeckReach,
  getSegmentSlopeFrame,
  isAutoGutterEnabled,
  isAutoRidgeVentEnabled,
  isDefaultRidgeVentNode,
  isGlazedRoofSegment,
  type MessageDescriptor,
  normalizeRoofSegmentTrim,
  ROOF_SHAPE_DEFAULTS,
  type RoofEaveCut,
  type RoofSegmentNode,
  type RoofSegmentTrim,
  type RoofType,
  roofBuildUpPatch,
  roofSegmentEaveProfile,
  roofTypeHasRakes,
  usePascalI18n,
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
  ToggleControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Check, Copy, Move, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { BarrelRoofPanel } from '../roof/barrel-panel'
import { RoofGlazingPanel } from '../roof/glazing-panel'
import { commitSeatedRoofEdit } from '../roof/roof-level-target'
import { RoofBuildUpSection } from './build-up-section'

const ROOF_TYPE_OPTIONS: { label: MessageDescriptor; value: RoofType }[] = [
  { label: /* i18n */ { id: 'node.roofSegment.panel.hip', message: 'Hip' }, value: 'hip' },
  { label: /* i18n */ { id: 'node.roofSegment.panel.gable', message: 'Gable' }, value: 'gable' },
  { label: /* i18n */ { id: 'node.roofSegment.panel.shed', message: 'Shed' }, value: 'shed' },
]

const ROOF_TYPE_OPTIONS_2: { label: MessageDescriptor; value: RoofType }[] = [
  { label: /* i18n */ { id: 'node.roofSegment.panel.flat', message: 'Flat' }, value: 'flat' },
  {
    label: /* i18n */ { id: 'node.roofSegment.panel.gambrel', message: 'Gambrel' },
    value: 'gambrel',
  },
  { label: /* i18n */ { id: 'node.roofSegment.panel.dutch', message: 'Dutch' }, value: 'dutch' },
  {
    label: /* i18n */ { id: 'node.roofSegment.panel.mansard', message: 'Mansard' },
    value: 'mansard',
  },
]

const ROOF_TYPE_OPTIONS_3: { label: MessageDescriptor; value: RoofType }[] = [
  {
    label: /* i18n */ { id: 'node.roofSegment.panel.conical', message: 'Conical' },
    value: 'conical',
  },
  { label: /* i18n */ { id: 'node.roofSegment.panel.barrel', message: 'Barrel' }, value: 'barrel' },
]

// How the rafter tails are cut at the eaves, the fascia and soffit with them (core's `roofEaveProfile`).
const EAVE_CUT_OPTIONS: { label: MessageDescriptor; value: RoofEaveCut }[] = [
  { label: /* i18n */ { id: 'node.roofSegment.panel.plumb', message: 'Plumb' }, value: 'plumb' },
  { label: /* i18n */ { id: 'node.roofSegment.panel.square', message: 'Square' }, value: 'square' },
  {
    label: /* i18n */ { id: 'node.roofSegment.panel.plumbLevel', message: 'Plumb + level' },
    value: 'plumb-level',
  },
]

/** The sloped forms whose tails are cut at their eaves by the plane's eave cut. */
const EAVE_CUT_ROOF_TYPES: ReadonlySet<RoofType> = new Set(['gable', 'hip', 'shed'])

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

/** The planes of a roof that take layers: its segments, glazed ones aside. */
function roofLayerPlaneIds(
  children: readonly string[],
  nodes: Record<AnyNodeId, AnyNode>,
): AnyNodeId[] {
  return children.filter((id) => {
    const child = nodes[id as AnyNodeId]
    return child?.type === 'roof-segment' && !isGlazedRoofSegment(child)
  }) as AnyNodeId[]
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
  const i18n = usePascalI18n()
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const setRoofHostDragArmedId = useEditor((s) => s.setRoofHostDragArmedId)
  const unit = useViewer((s) => s.unit)

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
  // How many planes of this roof take layers: "Apply to all planes" shows once there are two.
  const roofPlaneCount = useScene((s) => {
    const current = selectedId
      ? (s.nodes[selectedId as AnyNode['id']] as RoofSegmentNode | undefined)
      : undefined
    const roof = current?.parentId ? s.nodes[current.parentId as AnyNodeId] : undefined
    return roof?.type === 'roof' ? roofLayerPlaneIds(roof.children, s.nodes).length : 0
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
      // Reshaped or moved onto the walls that carry it, its roof goes to the level above them.
      commitSeatedRoofEdit(
        [{ id: selectedId as AnyNodeId, data: updates }],
        selectedId as AnyNodeId,
      )
    },
    [selectedId],
  )

  const handleApplyToRoof = useCallback(() => {
    const scene = useScene.getState()
    const current = selectedId ? scene.nodes[selectedId as AnyNodeId] : undefined
    if (current?.type !== 'roof-segment' || !current.buildUp) return
    const roof = current.parentId ? scene.nodes[current.parentId as AnyNodeId] : undefined
    if (roof?.type !== 'roof') return
    const patch = roofBuildUpPatch(current.buildUp)
    scene.updateNodes(
      roofLayerPlaneIds(roof.children, scene.nodes).map((id) => ({ id, data: patch })),
    )
  }, [selectedId])

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
    if (node) duplicateNodeAndPickUp(node)
  }, [node])

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
  // both overhangs in plan, past the walls' outside faces; the node keeps the eaves' along the slope
  const reach = getRoofSegmentDeckReach(node)
  const halfWall = node.wallThickness / 2
  const { cosTheta } = getSegmentSlopeFrame(node)

  return (
    <PanelWrapper
      icon="/icons/roof.webp"
      onBack={handleBack}
      onClose={handleClose}
      title={
        node.name || i18n._({ id: 'node.roofSegment.panel.roofSegment', message: 'Roof Segment' })
      }
      width={300}
    >
      <RoofGlazingPanel segments={[node]} />
      <PanelSection title={i18n._({ id: 'node.roofSegment.panel.roofType', message: 'Roof Type' })}>
        <SegmentedControl
          onChange={(v) => handleRoofTypeChange(v)}
          options={ROOF_TYPE_OPTIONS.map((option) => ({ ...option, label: i18n._(option.label) }))}
          value={node.roofType}
          disabled={managedLeanToRoofSegment}
        />
        <SegmentedControl
          onChange={(v) => handleRoofTypeChange(v)}
          options={ROOF_TYPE_OPTIONS_2.map((option) => ({
            ...option,
            label: i18n._(option.label),
          }))}
          value={node.roofType}
          disabled={managedLeanToRoofSegment}
        />
        <SegmentedControl
          onChange={(v) => handleRoofTypeChange(v)}
          options={ROOF_TYPE_OPTIONS_3.map((option) => ({
            ...option,
            label: i18n._(option.label),
          }))}
          value={node.roofType}
          disabled={managedLeanToRoofSegment}
        />
      </PanelSection>

      {node.roofType !== 'conical' && (
        <PanelSection title={i18n._({ id: 'node.roofSegment.panel.trim', message: 'Trim' })}>
          <ActionGroup>
            <ActionButton
              icon={
                showTrimPlanes ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Pencil className="h-3.5 w-3.5" />
                )
              }
              label={
                showTrimPlanes
                  ? i18n._({ id: 'node.roofSegment.panel.doneEditing', message: 'Done editing' })
                  : i18n._({
                      id: 'node.roofSegment.panel.editFootprint',
                      message: 'Edit footprint',
                    })
              }
              onClick={() => (showTrimPlanes ? handleBack() : handleTrimEditing(true))}
            />
            <ActionButton
              className="disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!hasSegmentTrim(node)}
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              label={i18n._({ id: 'node.roofSegment.panel.reset', message: 'Reset' })}
              onClick={handleResetTrim}
            />
          </ActionGroup>
          {node.roofType !== 'shed' && node.roofType !== 'flat' && node.roofType !== 'barrel' && (
            <ToggleControl
              checked={autoRidgeVentEnabled}
              label={i18n._({
                id: 'node.roofSegment.panel.autoRidgeVent',
                message: 'Auto ridge vent',
              })}
              onChange={handleAutoRidgeVentToggle}
            />
          )}
        </PanelSection>
      )}

      {node.roofType !== 'conical' && (
        <PanelSection
          title={i18n._({ id: 'node.roofSegment.panel.drainage', message: 'Drainage' })}
        >
          <ToggleControl
            checked={autoGutterEnabled}
            label={i18n._({ id: 'node.roofSegment.panel.autoGutters', message: 'Auto gutters' })}
            onChange={handleAutoGutterToggle}
          />
        </PanelSection>
      )}

      <PanelSection
        title={i18n._({ id: 'node.roofSegment.panel.footprint', message: 'Footprint' })}
      >
        {node.roofType === 'conical' ? (
          <SliderControl
            label={i18n._({ id: 'node.roofSegment.panel.diameter', message: 'Diameter' })}
            max={1000}
            min={0.5}
            onChange={(v) => handleUpdate({ width: v, depth: v })}
            precision={2}
            step={0.5}
            unit="m"
            value={node.width}
          />
        ) : (
          <>
            <SliderControl
              label={
                node.roofType === 'barrel'
                  ? i18n._({ id: 'node.roofSegment.panel.length', message: 'Length' })
                  : i18n._({ id: 'node.roofSegment.panel.width', message: 'Width' })
              }
              max={1000}
              min={0.5}
              onChange={(v) => handleUpdate({ width: v })}
              precision={2}
              step={0.5}
              unit="m"
              value={node.width}
            />
            <SliderControl
              label={
                node.roofType === 'barrel'
                  ? i18n._({ id: 'node.roofSegment.panel.span', message: 'Span' })
                  : i18n._({ id: 'node.roofSegment.panel.depth', message: 'Depth' })
              }
              max={1000}
              min={0.5}
              onChange={(v) => handleUpdate({ depth: v })}
              precision={2}
              step={0.5}
              unit="m"
              value={node.depth}
            />
          </>
        )}
      </PanelSection>

      {node.roofType === 'conical' && (
        <PanelSection
          title={i18n._({ id: 'node.roofSegment.panel.conicalShape', message: 'Conical Shape' })}
        >
          <ToggleControl
            checked={!conicalCoverage.fullCircle}
            label={i18n._({
              id: 'node.roofSegment.panel.clippedVersion',
              message: 'Clipped version',
            })}
            onChange={(checked) => handleUpdate({ conicalFullCircle: !checked })}
          />
          {!conicalCoverage.fullCircle && (
            <>
              <SliderControl
                label={i18n._({ id: 'node.roofSegment.panel.startAngle', message: 'Start Angle' })}
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
                label={i18n._({ id: 'node.roofSegment.panel.arc', message: 'Arc' })}
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

      <PanelSection
        title={i18n._({ id: 'node.roofSegment.panel.wallHeight', message: 'Wall Height' })}
      >
        <SliderControl
          label={i18n._({ id: 'node.roofSegment.panel.wall', message: 'Wall' })}
          max={1000}
          min={0}
          onChange={(v) => handleUpdate({ wallHeight: v })}
          precision={2}
          step={0.1}
          unit="m"
          value={node.wallHeight}
        />
      </PanelSection>

      {node.roofType === 'barrel' ? (
        <BarrelRoofPanel node={node} />
      ) : (
        <PanelSection title={i18n._({ id: 'node.roofSegment.panel.pitch', message: 'Pitch' })}>
          <SliderControl
            label={i18n._({ id: 'node.roofSegment.panel.angle', message: 'Angle' })}
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
      )}

      {node.roofType === 'gambrel' && (
        <PanelSection title={i18n._({ id: 'node.roofSegment.panel.shape', message: 'Shape' })}>
          <SliderControl
            label={i18n._({ id: 'node.roofSegment.panel.kinkDepth', message: 'Kink Depth' })}
            max={0.9}
            min={0.1}
            onChange={(v) => handleUpdate({ gambrelLowerWidthRatio: v })}
            precision={2}
            step={0.01}
            unit=""
            value={Math.round(node.gambrelLowerWidthRatio * 100) / 100}
          />
          <SliderControl
            label={i18n._({ id: 'node.roofSegment.panel.kinkHeight', message: 'Kink Height' })}
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
        <PanelSection title={i18n._({ id: 'node.roofSegment.panel.shape', message: 'Shape' })}>
          <SliderControl
            label={i18n._({ id: 'node.roofSegment.panel.waistWidth', message: 'Waist Width' })}
            max={0.45}
            min={0.05}
            onChange={(v) => handleUpdate({ mansardSteepWidthRatio: v })}
            precision={2}
            step={0.01}
            unit=""
            value={Math.round(node.mansardSteepWidthRatio * 100) / 100}
          />
          <SliderControl
            label={i18n._({ id: 'node.roofSegment.panel.waistHeight', message: 'Waist Height' })}
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
        <PanelSection title={i18n._({ id: 'node.roofSegment.panel.shape', message: 'Shape' })}>
          <SliderControl
            label={i18n._({ id: 'node.roofSegment.panel.waistWidth', message: 'Waist Width' })}
            max={0.45}
            min={0.05}
            onChange={(v) => handleUpdate({ dutchHipWidthRatio: v })}
            precision={2}
            step={0.01}
            unit=""
            value={Math.round(node.dutchHipWidthRatio * 100) / 100}
          />
          <SliderControl
            label={i18n._({ id: 'node.roofSegment.panel.waistHeight', message: 'Waist Height' })}
            max={0.9}
            min={0.1}
            onChange={(v) => handleUpdate({ dutchHipHeightRatio: v })}
            precision={2}
            step={0.01}
            unit=""
            value={Math.round(node.dutchHipHeightRatio * 100) / 100}
          />
          <SliderControl
            label={i18n._({ id: 'node.roofSegment.panel.waistLength', message: 'Waist Length' })}
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
            label={i18n._({
              id: 'node.roofSegment.panel.topRakeThick',
              message: 'Top Rake Thick.',
            })}
            max={0.5}
            min={0.01}
            onChange={(v) => handleUpdate({ dutchTopRakeThickness: v })}
            precision={2}
            step={0.01}
            unit="m"
            value={node.dutchTopRakeThickness ?? ROOF_SHAPE_DEFAULTS.dutchTopRakeThickness}
          />
          <SliderControl
            label={i18n._({
              id: 'node.roofSegment.panel.topRakeLength',
              message: 'Top Rake Length',
            })}
            max={3}
            min={0}
            onChange={(v) => handleUpdate({ dutchGabletRake: v })}
            precision={2}
            step={0.01}
            unit="m"
            value={node.dutchGabletRake ?? ROOF_SHAPE_DEFAULTS.dutchGabletRake}
          />
        </PanelSection>
      )}

      <PanelSection
        title={i18n._({ id: 'node.roofSegment.panel.structure', message: 'Structure' })}
      >
        <SliderControl
          label={i18n._({ id: 'node.roofSegment.panel.wallThick', message: 'Wall Thick.' })}
          max={1}
          min={0.05}
          onChange={(v) => handleUpdate({ wallThickness: v })}
          precision={2}
          step={0.05}
          unit="m"
          value={node.wallThickness}
        />
        {/* With layers, the Layers section sets it and shows it. */}
        {!(isGlazedRoofSegment(node) || node.buildUp) && (
          <SliderControl
            label={i18n._({ id: 'node.roofSegment.panel.deckThick', message: 'Deck Thick.' })}
            max={0.3}
            min={0.04}
            onChange={(v) => handleUpdate({ deckThickness: v })}
            precision={2}
            step={0.01}
            unit="m"
            value={node.deckThickness}
          />
        )}
        {node.roofType === 'barrel' ? (
          <SliderControl
            label={i18n._({ id: 'node.roofSegment.panel.endOverhang', message: 'End overhang' })}
            max={1}
            min={0}
            onChange={(v) => handleUpdate({ overhang: v })}
            precision={2}
            step={0.05}
            unit="m"
            value={reach.x - halfWall}
          />
        ) : (
          <SliderControl
            label={i18n._({ id: 'node.roofSegment.panel.eaveOverhang', message: 'Eave overhang' })}
            max={1}
            min={0}
            onChange={(v) => handleUpdate({ overhang: v / cosTheta })}
            precision={2}
            step={0.05}
            unit="m"
            value={reach.z - halfWall}
          />
        )}
        {roofTypeHasRakes(node.roofType) && (
          <SliderControl
            label={i18n._({
              id: 'node.roofSegment.panel.gableOverhang',
              message: 'Gable overhang',
            })}
            max={3}
            min={0}
            onChange={(v) => handleUpdate({ gableOverhang: v })}
            precision={2}
            step={0.05}
            unit="m"
            value={reach.x - halfWall}
          />
        )}
        {!(isGlazedRoofSegment(node) || node.buildUp) && (
          <SliderControl
            label={i18n._({ id: 'node.roofSegment.panel.shingleThick', message: 'Shingle Thick.' })}
            max={0.3}
            min={0.02}
            onChange={(v) => handleUpdate({ shingleThickness: v })}
            precision={2}
            step={0.01}
            unit="m"
            value={node.shingleThickness}
          />
        )}
        {EAVE_CUT_ROOF_TYPES.has(node.roofType) && node.pitch > 0 && (
          <div>
            <div className="px-1 pb-1 text-[10px] text-muted-foreground uppercase tracking-wide">
              {i18n._({ id: 'node.roofSegment.panel.eaveCut', message: 'Eave cut' })}
            </div>
            <SegmentedControl
              onChange={(v) => handleUpdate({ eaveCut: v })}
              options={EAVE_CUT_OPTIONS.map((option) => ({
                ...option,
                label: i18n._(option.label),
              }))}
              value={node.eaveCut ?? 'plumb'}
            />
          </div>
        )}
        <ToggleControl
          checked={node.fascia ?? false}
          label={i18n._({ id: 'node.roofSegment.panel.fascia', message: 'Fascia' })}
          onChange={(checked) => handleUpdate({ fascia: checked })}
        />
        {node.fascia && (
          <SliderControl
            label={i18n._({ id: 'node.roofSegment.panel.fasciaHeight', message: 'Fascia height' })}
            max={0.6}
            min={0.1}
            onChange={(v) => handleUpdate({ fasciaHeight: v })}
            precision={2}
            step={0.01}
            unit="m"
            value={node.fasciaHeight ?? roofSegmentEaveProfile(node).fascia.height}
          />
        )}
      </PanelSection>

      {!isGlazedRoofSegment(node) && (
        <RoofBuildUpSection
          node={node}
          onApplyToRoof={roofPlaneCount > 1 ? handleApplyToRoof : undefined}
          onUpdate={handleUpdate}
          unit={unit}
        />
      )}

      <PanelSection title={i18n._({ id: 'node.roofSegment.panel.position', message: 'Position' })}>
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
          value={node.position[0]}
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
          value={node.position[1]}
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
          value={node.position[2]}
        />
        {(node.roofType !== 'conical' || !conicalCoverage.fullCircle) && (
          <>
            <SliderControl
              label={i18n._({ id: 'node.roofSegment.panel.rotation', message: 'Rotation' })}
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

      <PanelSection title={i18n._({ id: 'node.roofSegment.panel.actions', message: 'Actions' })}>
        <ActionGroup>
          <ActionButton
            icon={<Move className="h-3.5 w-3.5" />}
            label={i18n._({ id: 'node.roofSegment.panel.move', message: 'Move' })}
            onClick={handleMove}
          />
          <ActionButton
            icon={<Copy className="h-3.5 w-3.5" />}
            label={i18n._({ id: 'node.roofSegment.panel.duplicate', message: 'Duplicate' })}
            onClick={handleDuplicate}
          />
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />}
            label={i18n._({ id: 'node.roofSegment.panel.delete', message: 'Delete' })}
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
