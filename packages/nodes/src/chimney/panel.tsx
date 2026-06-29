'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type ChimneyNode,
  getActiveRoofHeight,
  type RoofNode,
  type RoofSegmentNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
  SliderControl,
  triggerSFX,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Vector3 } from 'three'
import {
  CHIMNEY_PRESET_KEYS,
  CHIMNEY_PRESET_LABELS,
  type ChimneyPresetKey,
  chimneyPresets,
  detectActiveChimneyPreset,
} from './presets'

// Tiny clsx-equivalent. The editor package doesn't re-export the
// legacy `cn` helper; inlining keeps this panel self-contained.
const cn = (...classes: Array<string | false | undefined | null>): string =>
  classes.filter(Boolean).join(' ')

type ChimneyType = 'cap' | 'flues' | 'shoulder' | 'bands' | 'cricket' | 'panels'

const CHIMNEY_TYPE_OPTIONS: Array<{ label: string; value: ChimneyType }> = [
  { label: 'Cap', value: 'cap' },
  { label: 'Flues', value: 'flues' },
  { label: 'Shoulder', value: 'shoulder' },
  { label: 'Bands', value: 'bands' },
  { label: 'Cricket', value: 'cricket' },
  { label: 'Panels', value: 'panels' },
]

export default function ChimneyPanel() {
  const [chimneyType, setChimneyType] = useState<ChimneyType>('cap')
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)

  const storeNode = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as ChimneyNode | undefined) : undefined,
  )
  // Merge live overrides so slider displays the value the user is actively
  // dragging, even though the store hasn't been written to yet.
  const overrides = useLiveNodeOverrides((s) =>
    selectedId ? (s.get(selectedId as AnyNodeId) as Partial<ChimneyNode> | undefined) : undefined,
  )
  const node = storeNode && overrides ? ({ ...storeNode, ...overrides } as ChimneyNode) : storeNode

  const handleUpdate = useCallback(
    (updates: Partial<ChimneyNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  // Slider drag → write live override (mesh updates, store untouched).
  // Slider release → commit to store + clear override.
  const previewProp = useCallback(
    (updates: Partial<ChimneyNode>) => {
      if (!selectedId) return
      useLiveNodeOverrides.getState().set(selectedId as AnyNodeId, updates)
    },
    [selectedId],
  )
  const commitProp = useCallback(
    (updates: Partial<ChimneyNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
      // If reparenting was part of the patch, flag both segments dirty so the
      // roof system rebuilds them.
      if (updates.roofSegmentId !== undefined) {
        const state = useScene.getState()
        const prev = node?.roofSegmentId
        if (prev) state.dirtyNodes.add(prev as AnyNodeId)
        state.dirtyNodes.add(updates.roofSegmentId as AnyNodeId)
        state.dirtyNodes.add(selectedId as AnyNodeId)
      }
      useLiveNodeOverrides.getState().clear(selectedId as AnyNodeId)
    },
    [node, selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleBack = useCallback(() => {
    if (node?.roofSegmentId) {
      setSelection({ selectedIds: [node.roofSegmentId as AnyNode['id']] })
    }
  }, [node?.roofSegmentId, setSelection])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    triggerSFX('sfx:item-delete')
    const segmentId = node.roofSegmentId
    // Unlist from host segment's children before deleting the node.
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

  // Match the current store node against the preset table so the
  // segmented control highlights "the preset you'd land on if you
  // applied X again". Compare against the store node, not the live-
  // override-merged `node`, so the highlight is stable across slider
  // drags. Null means the user has tweaked away from any preset; the
  // segmented control will then render with no segment selected.
  const activePreset = useMemo(() => detectActiveChimneyPreset(storeNode), [storeNode])
  const applyPreset = useCallback(
    (key: ChimneyPresetKey) => {
      commitProp(chimneyPresets[key] as Partial<ChimneyNode>)
      triggerSFX('sfx:item-pick')
    },
    [commitProp],
  )

  if (!(node && node.type === 'chimney' && selectedId)) return null

  const scenestate = useScene.getState()
  const segment = node.roofSegmentId
    ? (scenestate.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
    : undefined
  const roof = segment?.parentId
    ? (scenestate.nodes[segment.parentId as AnyNodeId] as RoofNode | undefined)
    : undefined

  // ---- True world-space helpers -------------------------------------------
  // We use the registered THREE.js Object3D matrices so the conversion picks
  // up EVERY ancestor transform (building rotation, level, etc.) and not
  // just roof + segment. Falls back to identity if a matrix isn't available
  // yet (rare timing edge case).

  const chimneyObj = sceneRegistry.nodes.get(selectedId)
  if (chimneyObj) chimneyObj.updateWorldMatrix(true, false)

  // World pose of the chimney's group origin (after segment.position +
  // segment.rotation + roof + building, etc.). Used as the basis for the
  // chimney's actual world position (which is groupOrigin + chimney.position
  // rotated through the chain).
  const computeChimneyWorldPos = () => {
    if (!chimneyObj) return { x: 0, z: 0 }
    // The chimney's outer group is at segment.position + segment.rotation
    // already; chimney.position is applied inside the geometry. To get the
    // world position of the chimney's center we transform its local center
    // (chimney.position[0], 0, chimney.position[2]) through the outer group.
    const localPt = new Vector3(node.position[0] ?? 0, 0, node.position[2] ?? 0)
    const worldPt = localPt.applyMatrix4(chimneyObj.matrixWorld)
    return { x: worldPt.x, z: worldPt.z }
  }
  const computeChimneyWorldRotation = () => {
    if (!chimneyObj) return node.rotation ?? 0
    // Extract Y rotation from the outer group's world matrix. Assumes only
    // Y-axis ancestor rotations (true for our scene — buildings can rotate
    // around Y; levels/roofs/segments all rotate around Y).
    const m = chimneyObj.matrixWorld.elements
    // 3x3 rotation portion (column-major): m[0]=cos, m[2]=-sin for pure Y rot.
    const ancestorWorldY = Math.atan2(-(m[2] ?? 0), m[0] ?? 1)
    return ancestorWorldY + (node.rotation ?? 0)
  }
  const { x: worldX_now, z: worldZ_now } = computeChimneyWorldPos()
  const worldRotation_now = computeChimneyWorldRotation()

  // Find any roof-segment whose footprint contains a given world (x, z).
  const findSegmentForWorldPoint = (
    wx: number,
    wz: number,
  ): { segment: RoofSegmentNode; localX: number; localZ: number } | null => {
    const state = useScene.getState()
    const worldPt = new Vector3(wx, 0, wz)
    for (const candidate of Object.values(state.nodes)) {
      if (candidate?.type !== 'roof-segment') continue
      const seg = candidate as RoofSegmentNode
      const segObj = sceneRegistry.nodes.get(seg.id)
      if (!segObj) continue
      segObj.updateWorldMatrix(true, false)
      const local = segObj.worldToLocal(worldPt.clone())
      if (Math.abs(local.x) <= seg.width / 2 && Math.abs(local.z) <= seg.depth / 2) {
        return { segment: seg, localX: local.x, localZ: local.z }
      }
    }
    return null
  }

  // World→segment-local for a given segment. Uses the segment's registered
  // mesh (whose world matrix already walks every ancestor transform).
  const worldToSegLocal = (
    wx: number,
    wz: number,
    seg: RoofSegmentNode,
  ): { localX: number; localZ: number } => {
    const segObj = sceneRegistry.nodes.get(seg.id)
    if (!segObj) return { localX: wx, localZ: wz }
    segObj.updateWorldMatrix(true, false)
    const local = segObj.worldToLocal(new Vector3(wx, 0, wz))
    return { localX: local.x, localZ: local.z }
  }

  // World-space slider range = bounding box of the chimney's parent roof
  // segments. Computed from each segment mesh's world matrix so the range
  // is in TRUE world coords too.
  let worldMinX = worldX_now - 20
  let worldMaxX = worldX_now + 20
  let worldMinZ = worldZ_now - 20
  let worldMaxZ = worldZ_now + 20
  if (roof) {
    let lo_x = Number.POSITIVE_INFINITY
    let hi_x = Number.NEGATIVE_INFINITY
    let lo_z = Number.POSITIVE_INFINITY
    let hi_z = Number.NEGATIVE_INFINITY
    for (const childId of roof.children ?? []) {
      const seg = scenestate.nodes[childId as AnyNodeId] as RoofSegmentNode | undefined
      if (!seg) continue
      const segObj = sceneRegistry.nodes.get(seg.id)
      if (!segObj) continue
      segObj.updateWorldMatrix(true, false)
      const segWorldCenter = new Vector3().applyMatrix4(segObj.matrixWorld)
      // Use a circular bound (sqrt(w^2 + d^2)/2) — rotation-agnostic.
      const r = Math.hypot(seg.width, seg.depth) / 2
      lo_x = Math.min(lo_x, segWorldCenter.x - r)
      hi_x = Math.max(hi_x, segWorldCenter.x + r)
      lo_z = Math.min(lo_z, segWorldCenter.z - r)
      hi_z = Math.max(hi_z, segWorldCenter.z + r)
    }
    if (Number.isFinite(lo_x)) {
      worldMinX = lo_x
      worldMaxX = hi_x
      worldMinZ = lo_z
      worldMaxZ = hi_z
    }
  }

  // Commit a new world (x, z). Finds whichever segment contains the point;
  // if it differs from the current segment, reparents while preserving the
  // chimney's world rotation and the world Y of the chimney top (via
  // heightAboveRidge).
  const commitWorldPosition = (newWorldX: number, newWorldZ: number) => {
    if (!segment) return
    const oldWorldRotation = worldRotation_now
    const oldHeightAboveRidge = node.heightAboveRidge ?? 1
    const oldPeakY = segment.wallHeight + getActiveRoofHeight(segment)
    // Compute the chimney's current world top Y by transforming the segment-
    // local top point through the chimney's matrix.
    let oldWorldTopY = 0
    if (chimneyObj) {
      const localTop = new Vector3(
        node.position[0] ?? 0,
        oldPeakY + oldHeightAboveRidge,
        node.position[2] ?? 0,
      )
      oldWorldTopY = localTop.applyMatrix4(chimneyObj.matrixWorld).y
    }

    const target = findSegmentForWorldPoint(newWorldX, newWorldZ)
    if (target && target.segment.id !== segment.id) {
      const newSegObj = sceneRegistry.nodes.get(target.segment.id)
      const newPeakY = target.segment.wallHeight + getActiveRoofHeight(target.segment)

      // World Y of the new chimney's group origin (at target localX,Z, y=0).
      let newOriginWorldY = 0
      if (newSegObj) {
        newSegObj.updateWorldMatrix(true, false)
        newOriginWorldY = new Vector3(target.localX, 0, target.localZ).applyMatrix4(
          newSegObj.matrixWorld,
        ).y
      }
      const newHeightAboveRidge = Math.max(0.1, oldWorldTopY - newOriginWorldY - newPeakY)

      // Preserve world rotation: extract the new segment's ancestor world
      // Y-rotation from its matrix, then compute the chimney-local rotation
      // that yields the same world rotation.
      let newAncestorWorldY = 0
      if (newSegObj) {
        const m = newSegObj.matrixWorld.elements
        newAncestorWorldY = Math.atan2(-(m[2] ?? 0), m[0] ?? 1)
      }
      const newSegLocalRot = oldWorldRotation - newAncestorWorldY

      commitProp({
        roofSegmentId: target.segment.id,
        parentId: target.segment.id,
        position: [target.localX, 0, target.localZ],
        rotation: newSegLocalRot,
        heightAboveRidge: newHeightAboveRidge,
      } as Partial<ChimneyNode>)
    } else {
      // Same segment, just convert world → segment-local.
      const local = worldToSegLocal(newWorldX, newWorldZ, segment)
      commitProp({ position: [local.localX, 0, local.localZ] })
    }
  }

  // Commit a new world rotation. Stays parented to the current segment.
  const commitWorldRotation = (newWorldRot: number) => {
    if (!segment) return
    let ancestorWorldY = 0
    const segObj = sceneRegistry.nodes.get(segment.id)
    if (segObj) {
      segObj.updateWorldMatrix(true, false)
      const m = segObj.matrixWorld.elements
      ancestorWorldY = Math.atan2(-(m[2] ?? 0), m[0] ?? 1)
    }
    commitProp({ rotation: newWorldRot - ancestorWorldY })
  }

  // Match the current store node against the preset table so the
  return (
    <PanelWrapper
      icon="/icons/roof.webp"
      onBack={node.roofSegmentId ? handleBack : undefined}
      onClose={handleClose}
      title={node.name || 'Chimney'}
      width={300}
    >
      <PanelSection title="Style">
        <SegmentedControl
          onChange={(v) => applyPreset(v as ChimneyPresetKey)}
          options={CHIMNEY_PRESET_KEYS.map((k) => ({
            label: CHIMNEY_PRESET_LABELS[k],
            value: k,
          }))}
          // Empty string when no preset matches — nothing highlighted,
          // which reads correctly as "custom".
          value={activePreset ?? ''}
        />
      </PanelSection>

      <PanelSection title="Footprint">
        <SegmentedControl
          onChange={(v) => handleUpdate({ bodyShape: v })}
          options={[
            { label: 'Square', value: 'square' },
            { label: 'Round', value: 'round' },
          ]}
          value={node.bodyShape ?? 'square'}
        />
        <SliderControl
          label={(node.bodyShape ?? 'square') === 'round' ? 'Diameter' : 'Width'}
          max={3}
          min={0.2}
          onChange={(v) => previewProp({ width: v })}
          onCommit={(v) => commitProp({ width: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.width * 100) / 100}
        />
        {(node.bodyShape ?? 'square') !== 'round' && (
          <SliderControl
            label="Depth"
            max={3}
            min={0.2}
            onChange={(v) => previewProp({ depth: v })}
            onCommit={(v) => commitProp({ depth: v })}
            precision={2}
            restoreOnCommit={false}
            step={0.05}
            unit="m"
            value={Math.round(node.depth * 100) / 100}
          />
        )}
        <SliderControl
          label="Hollow Depth"
          max={3}
          min={0}
          onChange={(v) => previewProp({ bodyHollowDepth: v })}
          onCommit={(v) => commitProp({ bodyHollowDepth: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round((node.bodyHollowDepth ?? 0.6) * 100) / 100}
        />
        <SliderControl
          label="Wall Thickness"
          max={0.3}
          min={0}
          onChange={(v) => previewProp({ bodyHollowMargin: v })}
          onCommit={(v) => commitProp({ bodyHollowMargin: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round((node.bodyHollowMargin ?? 0.08) * 1000) / 1000}
        />
        {(node.bodyShape ?? 'square') !== 'round' && (
          <SliderControl
            label="Corner Bevel"
            max={Math.max(0, Math.min(node.width, node.depth) / 2 - 0.005)}
            min={0}
            onChange={(v) => previewProp({ cornerBevel: v })}
            onCommit={(v) => commitProp({ cornerBevel: v })}
            precision={3}
            restoreOnCommit={false}
            step={0.005}
            unit="m"
            value={Math.round((node.cornerBevel ?? 0) * 1000) / 1000}
          />
        )}
      </PanelSection>

      <PanelSection title="Height">
        <SliderControl
          label="Above Ridge"
          max={5}
          min={0.1}
          onChange={(v) => previewProp({ heightAboveRidge: v })}
          onCommit={(v) => commitProp({ heightAboveRidge: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.1}
          unit="m"
          value={Math.round(node.heightAboveRidge * 100) / 100}
        />
        <SliderControl
          label="Cutout Offset"
          max={0.5}
          min={0}
          onChange={(v) => previewProp({ cutoutOffset: v })}
          onCommit={(v) => commitProp({ cutoutOffset: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round((node.cutoutOffset ?? 0) * 1000) / 1000}
        />
      </PanelSection>

      <PanelSection title="Position">
        <SliderControl
          label="X"
          max={Math.round(worldMaxX * 10) / 10}
          min={Math.round(worldMinX * 10) / 10}
          onChange={(newWorldX) => {
            // Live preview: keep the chimney parented to its current segment
            // and update its segment-local position so the visual matches the
            // dragged world X. Reparenting (if any) happens on commit.
            if (!segment) return
            const local = worldToSegLocal(newWorldX, worldZ_now, segment)
            previewProp({ position: [local.localX, 0, local.localZ] })
          }}
          onCommit={(newWorldX) => commitWorldPosition(newWorldX, worldZ_now)}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(worldX_now * 100) / 100}
        />
        <SliderControl
          label="Z"
          max={Math.round(worldMaxZ * 10) / 10}
          min={Math.round(worldMinZ * 10) / 10}
          onChange={(newWorldZ) => {
            if (!segment) return
            const local = worldToSegLocal(worldX_now, newWorldZ, segment)
            previewProp({ position: [local.localX, 0, local.localZ] })
          }}
          onCommit={(newWorldZ) => commitWorldPosition(worldX_now, newWorldZ)}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(worldZ_now * 100) / 100}
        />
        <SliderControl
          label="Rotation"
          max={180}
          min={-180}
          onChange={(degrees) => {
            // World rotation → segment-local rotation for the current segment.
            const newWorldRot = (degrees * Math.PI) / 180
            let ancestorWorldY = 0
            if (segment) {
              const segObj = sceneRegistry.nodes.get(segment.id)
              if (segObj) {
                segObj.updateWorldMatrix(true, false)
                const m = segObj.matrixWorld.elements
                ancestorWorldY = Math.atan2(-(m[2] ?? 0), m[0] ?? 1)
              }
            }
            previewProp({ rotation: newWorldRot - ancestorWorldY })
          }}
          onCommit={(degrees) => commitWorldRotation((degrees * Math.PI) / 180)}
          precision={0}
          restoreOnCommit={false}
          step={1}
          unit="°"
          value={Math.round((worldRotation_now * 180) / Math.PI)}
        />
      </PanelSection>

      <PanelSection title="Chimney Type">
        <div className="grid grid-cols-2 gap-1.5 px-1 pt-1">
          {CHIMNEY_TYPE_OPTIONS.filter((option) => {
            // Cricket and Panels both rely on a flat face — hide them for
            // round bodies.
            if ((node.bodyShape ?? 'square') === 'round') {
              return option.value !== 'cricket' && option.value !== 'panels'
            }
            return true
          }).map((option) => {
            const isSelected = chimneyType === option.value
            return (
              <button
                className={cn(
                  'flex min-h-12 items-center rounded-lg border px-3 py-2.5 text-left text-xs transition-colors',
                  isSelected
                    ? 'border-orange-400/60 bg-orange-400/10 text-foreground'
                    : 'border-border/50 bg-[#2C2C2E] text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground',
                )}
                key={option.value}
                onClick={() => setChimneyType(option.value)}
                type="button"
              >
                <span className="truncate font-medium">{option.label}</span>
              </button>
            )
          })}
        </div>

        {chimneyType === 'cap' && (
          <>
            <SegmentedControl
              className="mt-2"
              onChange={(v) => handleUpdate({ cap: v !== 'none', capShape: v })}
              options={[
                { label: 'None', value: 'none' },
                { label: 'Sloped', value: 'sloped' },
                { label: 'Flat', value: 'flat' },
                { label: 'Stepped', value: 'stepped' },
              ]}
              value={node.capShape ?? 'sloped'}
            />
            {(node.capShape ?? 'sloped') !== 'none' && (
              <>
                <SliderControl
                  label="Overhang"
                  max={0.2}
                  min={0}
                  onChange={(v) => previewProp({ capOverhang: v })}
                  onCommit={(v) => commitProp({ capOverhang: v })}
                  precision={3}
                  restoreOnCommit={false}
                  step={0.005}
                  unit="m"
                  value={Math.round((node.capOverhang ?? 0.04) * 1000) / 1000}
                />
                <SliderControl
                  label="Thickness"
                  max={0.3}
                  min={0.02}
                  onChange={(v) => previewProp({ capThickness: v })}
                  onCommit={(v) => commitProp({ capThickness: v })}
                  precision={3}
                  restoreOnCommit={false}
                  step={0.005}
                  unit="m"
                  value={Math.round((node.capThickness ?? 0.08) * 1000) / 1000}
                />
              </>
            )}
          </>
        )}

        {chimneyType === 'shoulder' && (
          <>
            <SegmentedControl
              className="mt-2"
              onChange={(v) => handleUpdate({ shoulderStyle: v })}
              options={[
                { label: 'None', value: 'none' },
                { label: 'Tapered', value: 'tapered' },
                { label: 'Corbeled', value: 'corbeled' },
              ]}
              value={node.shoulderStyle ?? 'none'}
            />
            {(node.shoulderStyle ?? 'none') !== 'none' && (
              <>
                <SliderControl
                  label="Height"
                  max={3}
                  min={0.1}
                  onChange={(v) => previewProp({ shoulderHeight: v })}
                  onCommit={(v) => commitProp({ shoulderHeight: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.05}
                  unit="m"
                  value={Math.round((node.shoulderHeight ?? 0.5) * 100) / 100}
                />
                <SliderControl
                  label="Extent"
                  max={0.5}
                  min={0}
                  onChange={(v) => previewProp({ shoulderExtent: v })}
                  onCommit={(v) => commitProp({ shoulderExtent: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.01}
                  unit="m"
                  value={Math.round((node.shoulderExtent ?? 0.1) * 100) / 100}
                />
              </>
            )}
          </>
        )}

        {chimneyType === 'flues' && (
          <>
            <SliderControl
              label="Count"
              max={4}
              min={0}
              onChange={(v) => previewProp({ flueCount: Math.round(v) })}
              onCommit={(v) => commitProp({ flueCount: Math.round(v) })}
              precision={0}
              restoreOnCommit={false}
              step={1}
              unit=""
              value={node.flueCount ?? 1}
            />
            {(node.flueCount ?? 1) > 0 && (
              <>
                <SegmentedControl
                  onChange={(v) => handleUpdate({ flueShape: v })}
                  options={[
                    { label: 'Round', value: 'round' },
                    { label: 'Square', value: 'square' },
                  ]}
                  value={node.flueShape ?? 'round'}
                />
                <SliderControl
                  label="Diameter"
                  max={Math.max(0.4, node.width)}
                  min={0.05}
                  onChange={(v) => previewProp({ flueDiameter: v })}
                  onCommit={(v) => commitProp({ flueDiameter: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.01}
                  unit="m"
                  value={Math.round((node.flueDiameter ?? 0.22) * 100) / 100}
                />
                <SliderControl
                  label="Height"
                  max={1.5}
                  min={0.05}
                  onChange={(v) => previewProp({ flueHeight: v })}
                  onCommit={(v) => commitProp({ flueHeight: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.01}
                  unit="m"
                  value={Math.round((node.flueHeight ?? 0.3) * 100) / 100}
                />
                {(node.flueCount ?? 1) > 1 && (
                  <SliderControl
                    label="Spacing"
                    max={1}
                    min={0}
                    onChange={(v) => previewProp({ flueSpacing: v })}
                    onCommit={(v) => commitProp({ flueSpacing: v })}
                    precision={2}
                    restoreOnCommit={false}
                    step={0.05}
                    value={Math.round((node.flueSpacing ?? 1) * 100) / 100}
                  />
                )}
                <SliderControl
                  label="Wall Thickness"
                  max={Math.max(0.1, (node.flueDiameter ?? 0.22) / 2 - 0.01)}
                  min={0}
                  onChange={(v) => previewProp({ flueWallThickness: v })}
                  onCommit={(v) => commitProp({ flueWallThickness: v })}
                  precision={3}
                  restoreOnCommit={false}
                  step={0.005}
                  unit="m"
                  value={Math.round((node.flueWallThickness ?? 0.02) * 1000) / 1000}
                />
              </>
            )}
          </>
        )}

        {chimneyType === 'bands' && (
          <>
            <SegmentedControl
              className="mt-2"
              onChange={(v) => handleUpdate({ bandStyle: v })}
              options={[
                { label: 'None', value: 'none' },
                { label: 'Single', value: 'single' },
                { label: 'Double', value: 'double' },
              ]}
              value={node.bandStyle ?? 'none'}
            />
            {(node.bandStyle ?? 'none') !== 'none' && (
              <>
                <SliderControl
                  label="Thickness"
                  max={0.4}
                  min={0.02}
                  onChange={(v) => previewProp({ bandHeight: v })}
                  onCommit={(v) => commitProp({ bandHeight: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.01}
                  unit="m"
                  value={Math.round((node.bandHeight ?? 0.1) * 100) / 100}
                />
                <SliderControl
                  label="Extent"
                  max={0.2}
                  min={0}
                  onChange={(v) => previewProp({ bandExtent: v })}
                  onCommit={(v) => commitProp({ bandExtent: v })}
                  precision={3}
                  restoreOnCommit={false}
                  step={0.005}
                  unit="m"
                  value={Math.round((node.bandExtent ?? 0.04) * 1000) / 1000}
                />
                <SliderControl
                  label="Offset"
                  max={3}
                  min={0}
                  onChange={(v) => previewProp({ bandOffset: v })}
                  onCommit={(v) => commitProp({ bandOffset: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.05}
                  unit="m"
                  value={Math.round((node.bandOffset ?? 0.4) * 100) / 100}
                />
              </>
            )}
          </>
        )}

        {chimneyType === 'cricket' && (
          <>
            <SegmentedControl
              className="mt-2"
              onChange={(v) => handleUpdate({ cricketStyle: v })}
              options={[
                { label: 'None', value: 'none' },
                { label: 'Simple', value: 'simple' },
              ]}
              value={node.cricketStyle ?? 'none'}
            />
            {(node.cricketStyle ?? 'none') !== 'none' && (
              <>
                <SegmentedControl
                  className="mt-2"
                  onChange={(v) => handleUpdate({ cricketSide: v })}
                  options={[
                    { label: 'Front', value: 'front' },
                    { label: 'Back', value: 'back' },
                  ]}
                  value={node.cricketSide ?? 'front'}
                />
                <SliderControl
                  label="Length"
                  max={2}
                  min={0.1}
                  onChange={(v) => previewProp({ cricketLength: v })}
                  onCommit={(v) => commitProp({ cricketLength: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.05}
                  unit="m"
                  value={Math.round((node.cricketLength ?? 0.6) * 100) / 100}
                />
                <SliderControl
                  label="Height"
                  max={1.5}
                  min={0.05}
                  onChange={(v) => previewProp({ cricketHeight: v })}
                  onCommit={(v) => commitProp({ cricketHeight: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.05}
                  unit="m"
                  value={Math.round((node.cricketHeight ?? 0.4) * 100) / 100}
                />
              </>
            )}
          </>
        )}

        {chimneyType === 'panels' && (
          <>
            <SegmentedControl
              className="mt-2"
              onChange={(v) => handleUpdate({ panelStyle: v })}
              options={[
                { label: 'None', value: 'none' },
                { label: 'Rectangular', value: 'rectangular' },
              ]}
              value={node.panelStyle ?? 'none'}
            />
            {(node.panelStyle ?? 'none') !== 'none' && (
              <>
                <SliderControl
                  label="Depth"
                  max={0.15}
                  min={0.005}
                  onChange={(v) => previewProp({ panelDepth: v })}
                  onCommit={(v) => commitProp({ panelDepth: v })}
                  precision={3}
                  restoreOnCommit={false}
                  step={0.005}
                  unit="m"
                  value={Math.round((node.panelDepth ?? 0.03) * 1000) / 1000}
                />
                <SliderControl
                  label="Height"
                  max={3}
                  min={0.1}
                  onChange={(v) => previewProp({ panelHeight: v })}
                  onCommit={(v) => commitProp({ panelHeight: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.05}
                  unit="m"
                  value={Math.round((node.panelHeight ?? 0.8) * 100) / 100}
                />
                <SliderControl
                  label="Top Offset"
                  max={2}
                  min={0}
                  onChange={(v) => previewProp({ panelOffsetTop: v })}
                  onCommit={(v) => commitProp({ panelOffsetTop: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.05}
                  unit="m"
                  value={Math.round((node.panelOffsetTop ?? 0.15) * 100) / 100}
                />
                <SliderControl
                  label="Side Margin"
                  max={Math.max(0.5, node.width / 2 - 0.05)}
                  min={0.02}
                  onChange={(v) => previewProp({ panelMargin: v })}
                  onCommit={(v) => commitProp({ panelMargin: v })}
                  precision={2}
                  restoreOnCommit={false}
                  step={0.01}
                  unit="m"
                  value={Math.round((node.panelMargin ?? 0.1) * 100) / 100}
                />
              </>
            )}
          </>
        )}
      </PanelSection>

      <PanelSection title="Actions">
        <ActionGroup>
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
