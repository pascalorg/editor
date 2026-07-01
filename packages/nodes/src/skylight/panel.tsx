'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type RoofNode,
  type RoofSegmentNode,
  SKYLIGHT_TYPE_ORDER,
  SKYLIGHT_TYPE_PRESETS,
  type SkylightNode,
  type SkylightType,
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
import { useCallback } from 'react'
import { Vector3 } from 'three'

const cn = (...classes: Array<string | false | undefined | null>): string =>
  classes.filter(Boolean).join(' ')

export default function SkylightPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)

  const storeNode = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as SkylightNode | undefined) : undefined,
  )
  const overrides = useLiveNodeOverrides((s) =>
    selectedId ? (s.get(selectedId as AnyNodeId) as Partial<SkylightNode> | undefined) : undefined,
  )
  const node = storeNode && overrides ? ({ ...storeNode, ...overrides } as SkylightNode) : storeNode

  const handleUpdate = useCallback(
    (updates: Partial<SkylightNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const previewProp = useCallback(
    (updates: Partial<SkylightNode>) => {
      if (!selectedId) return
      useLiveNodeOverrides.getState().set(selectedId as AnyNodeId, updates)
    },
    [selectedId],
  )
  const commitProp = useCallback(
    (updates: Partial<SkylightNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
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

  if (!(node && node.type === 'skylight' && selectedId)) return null

  const scenestate = useScene.getState()
  const segment = node.roofSegmentId
    ? (scenestate.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
    : undefined
  const roof = segment?.parentId
    ? (scenestate.nodes[segment.parentId as AnyNodeId] as RoofNode | undefined)
    : undefined

  const skylightObj = sceneRegistry.nodes.get(selectedId)
  if (skylightObj) skylightObj.updateWorldMatrix(true, false)

  const computeWorldPos = () => {
    if (!skylightObj) return { x: 0, z: 0 }
    const localPt = new Vector3(node.position[0] ?? 0, 0, node.position[2] ?? 0)
    const worldPt = localPt.applyMatrix4(skylightObj.matrixWorld)
    return { x: worldPt.x, z: worldPt.z }
  }
  const computeWorldRotation = () => {
    if (!skylightObj) return node.rotation ?? 0
    const m = skylightObj.matrixWorld.elements
    const ancestorWorldY = Math.atan2(-(m[2] ?? 0), m[0] ?? 1)
    return ancestorWorldY + (node.rotation ?? 0)
  }
  const { x: worldX_now, z: worldZ_now } = computeWorldPos()
  const worldRotation_now = computeWorldRotation()

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

  const commitWorldPosition = (newWorldX: number, newWorldZ: number) => {
    if (!segment) return
    const target = findSegmentForWorldPoint(newWorldX, newWorldZ)
    if (target && target.segment.id !== segment.id) {
      const oldWorldRotation = worldRotation_now
      const newSegObj = sceneRegistry.nodes.get(target.segment.id)
      let newAncestorWorldY = 0
      if (newSegObj) {
        newSegObj.updateWorldMatrix(true, false)
        const m = newSegObj.matrixWorld.elements
        newAncestorWorldY = Math.atan2(-(m[2] ?? 0), m[0] ?? 1)
      }
      const newSegLocalRot = oldWorldRotation - newAncestorWorldY
      commitProp({
        roofSegmentId: target.segment.id,
        parentId: target.segment.id,
        position: [target.localX, 0, target.localZ],
        rotation: newSegLocalRot,
      } as Partial<SkylightNode>)
    } else {
      const local = worldToSegLocal(newWorldX, newWorldZ, segment)
      commitProp({ position: [local.localX, 0, local.localZ] })
    }
  }

  const commitWorldRotation = (newWorldRot: number) => {
    if (!skylightObj) return
    const m = skylightObj.matrixWorld.elements
    const ancestorWorldY = Math.atan2(-(m[2] ?? 0), m[0] ?? 1)
    commitProp({ rotation: newWorldRot - ancestorWorldY })
  }

  const activeSkylightType = node.skylightType ?? 'flat'

  const handleTypeChange = (skylightType: SkylightType) => {
    const preset = SKYLIGHT_TYPE_PRESETS[skylightType]
    commitProp({
      skylightType,
      width: preset.width,
      height: preset.height,
      frameThickness: preset.frameThickness,
      frameDepth: preset.frameDepth,
      glassThickness: preset.glassThickness,
      curb: preset.curb,
      curbHeight: preset.curbHeight,
      cutoutOffset: preset.cutoutOffset,
      lanternHeight: preset.lanternHeight,
      lanternTopScale: preset.lanternTopScale,
      openingAngle: preset.openingAngle,
      openingSide: preset.openingSide,
      operationState: preset.operationState,
      motorHousing: preset.motorHousing,
      slideFraction: preset.slideFraction,
      slideDirection: preset.slideDirection,
      trackWidth: preset.trackWidth,
      motorHousingSize: preset.motorHousingSize,
    } as Partial<SkylightNode>)
  }

  return (
    <PanelWrapper
      icon="/icons/roof.webp"
      onBack={node.roofSegmentId ? handleBack : undefined}
      onClose={handleClose}
      title={node.name || 'Skylight'}
      width={300}
    >
      <PanelSection title="Type">
        <div className="grid grid-cols-2 gap-2 px-1 pt-1">
          {SKYLIGHT_TYPE_ORDER.map((skylightType) => {
            const isSelected = activeSkylightType === skylightType
            return (
              <button
                className={cn(
                  'flex min-h-12 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-xs transition-colors',
                  isSelected
                    ? 'border-orange-400/60 bg-orange-400/10 text-foreground'
                    : 'border-border/50 bg-[#2C2C2E] text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground',
                )}
                key={skylightType}
                onClick={() => handleTypeChange(skylightType)}
                type="button"
              >
                <span className="min-w-0 truncate font-medium">
                  {SKYLIGHT_TYPE_PRESETS[skylightType].label}
                </span>
              </button>
            )
          })}
        </div>
        <SliderControl
          label="Glass Thickness"
          max={0.05}
          min={0.002}
          onChange={(v) => previewProp({ glassThickness: v })}
          onCommit={(v) => commitProp({ glassThickness: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.001}
          unit="m"
          value={Math.round((node.glassThickness ?? 0.01) * 1000) / 1000}
        />
        {activeSkylightType === 'lantern' && (
          <>
            <SliderControl
              label="Lantern Height"
              max={1.0}
              min={0.05}
              onChange={(v) => previewProp({ lanternHeight: v })}
              onCommit={(v) => commitProp({ lanternHeight: v })}
              precision={3}
              restoreOnCommit={false}
              step={0.01}
              unit="m"
              value={Math.round((node.lanternHeight ?? 0.25) * 1000) / 1000}
            />
            <SliderControl
              label="Top Scale"
              max={0.95}
              min={0}
              onChange={(v) => previewProp({ lanternTopScale: v })}
              onCommit={(v) => commitProp({ lanternTopScale: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit=""
              value={Math.round((node.lanternTopScale ?? 0.25) * 100) / 100}
            />
          </>
        )}
        {activeSkylightType === 'opening' && (
          <>
            <SliderControl
              label="Open"
              max={1}
              min={0}
              onChange={(v) => previewProp({ operationState: v })}
              onCommit={(v) => commitProp({ operationState: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.01}
              unit=""
              value={Math.round((node.operationState ?? 0) * 100) / 100}
            />
            <SliderControl
              label="Opening Angle"
              max={80}
              min={0}
              onChange={(deg) => previewProp({ openingAngle: (deg * Math.PI) / 180 })}
              onCommit={(deg) => commitProp({ openingAngle: (deg * Math.PI) / 180 })}
              precision={0}
              restoreOnCommit={false}
              step={1}
              unit="°"
              value={Math.round(((node.openingAngle ?? Math.PI / 10) * 180) / Math.PI)}
            />
            <SegmentedControl
              onChange={(v) => commitProp({ openingSide: v as SkylightNode['openingSide'] })}
              options={[
                { label: 'Top', value: 'top' },
                { label: 'Bottom', value: 'bottom' },
                { label: 'Left', value: 'left' },
                { label: 'Right', value: 'right' },
              ]}
              value={(node.openingSide ?? 'top') as any}
            />
            <SegmentedControl
              onChange={(v) => commitProp({ motorHousing: v === 'yes' })}
              options={[
                { label: 'Motor', value: 'yes' },
                { label: 'No Motor', value: 'no' },
              ]}
              value={(node.motorHousing ?? false) ? 'yes' : 'no'}
            />
            {(node.motorHousing ?? false) && (
              <SliderControl
                label="Motor Housing"
                max={0.2}
                min={0.03}
                onChange={(v) => previewProp({ motorHousingSize: v })}
                onCommit={(v) => commitProp({ motorHousingSize: v })}
                precision={3}
                restoreOnCommit={false}
                step={0.005}
                unit="m"
                value={Math.round((node.motorHousingSize ?? 0.08) * 1000) / 1000}
              />
            )}
          </>
        )}
        {activeSkylightType === 'sliding' && (
          <>
            <SliderControl
              label="Open"
              max={1}
              min={0}
              onChange={(v) => previewProp({ operationState: v })}
              onCommit={(v) => commitProp({ operationState: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.01}
              unit=""
              value={Math.round((node.operationState ?? 0) * 100) / 100}
            />
            <SegmentedControl
              onChange={(v) => commitProp({ slideDirection: v as SkylightNode['slideDirection'] })}
              options={[
                { label: 'Along Z', value: 'z' },
                { label: 'Along X', value: 'x' },
              ]}
              value={(node.slideDirection ?? 'z') as any}
            />
            <SliderControl
              label="Track Width"
              max={0.12}
              min={0.02}
              onChange={(v) => previewProp({ trackWidth: v })}
              onCommit={(v) => commitProp({ trackWidth: v })}
              precision={3}
              restoreOnCommit={false}
              step={0.005}
              unit="m"
              value={Math.round((node.trackWidth ?? 0.045) * 1000) / 1000}
            />
          </>
        )}
      </PanelSection>

      <PanelSection title="Dimensions">
        <SliderControl
          label="Width"
          max={3}
          min={0.3}
          onChange={(v) => previewProp({ width: v })}
          onCommit={(v) => commitProp({ width: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.width * 100) / 100}
        />
        <SliderControl
          label="Height"
          max={3}
          min={0.3}
          onChange={(v) => previewProp({ height: v })}
          onCommit={(v) => commitProp({ height: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.height * 100) / 100}
        />
      </PanelSection>

      <PanelSection title="Frame">
        <SliderControl
          label="Thickness"
          max={0.2}
          min={0.02}
          onChange={(v) => previewProp({ frameThickness: v })}
          onCommit={(v) => commitProp({ frameThickness: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round((node.frameThickness ?? 0.05) * 1000) / 1000}
        />
        <SliderControl
          label="Depth"
          max={0.3}
          min={0.02}
          onChange={(v) => previewProp({ frameDepth: v })}
          onCommit={(v) => commitProp({ frameDepth: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round((node.frameDepth ?? 0.08) * 1000) / 1000}
        />
        <SliderControl
          label="Cutout Offset"
          max={0.2}
          min={0}
          onChange={(v) => previewProp({ cutoutOffset: v })}
          onCommit={(v) => commitProp({ cutoutOffset: v })}
          precision={3}
          restoreOnCommit={false}
          step={0.005}
          unit="m"
          value={Math.round((node.cutoutOffset ?? 0.01) * 1000) / 1000}
        />
      </PanelSection>

      <PanelSection title="Curb">
        <SegmentedControl
          onChange={(v) => handleUpdate({ curb: v === 'yes' })}
          options={[
            { label: 'Yes', value: 'yes' },
            { label: 'No', value: 'no' },
          ]}
          value={(node.curb ?? false) ? 'yes' : 'no'}
        />
        {(node.curb ?? false) && (
          <SliderControl
            label="Height"
            max={0.3}
            min={0.02}
            onChange={(v) => previewProp({ curbHeight: v })}
            onCommit={(v) => commitProp({ curbHeight: v })}
            precision={3}
            restoreOnCommit={false}
            step={0.005}
            unit="m"
            value={Math.round((node.curbHeight ?? 0.1) * 1000) / 1000}
          />
        )}
      </PanelSection>

      <PanelSection title="Position">
        <SliderControl
          label="X"
          max={Math.round(worldMaxX * 10) / 10}
          min={Math.round(worldMinX * 10) / 10}
          onChange={(newWorldX) => {
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
            const newWorldRot = (degrees * Math.PI) / 180
            if (!skylightObj) return
            const m = skylightObj.matrixWorld.elements
            const ancestorWorldY = Math.atan2(-(m[2] ?? 0), m[0] ?? 1)
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
