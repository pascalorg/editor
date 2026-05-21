'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type DormerNode,
  type RoofNode,
  type RoofSegmentNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  cn,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
  SliderControl,
  ToggleControl,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Move, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Vector3 } from 'three'

type RoofType = DormerNode['roofType']
type WindowShape = DormerNode['windowShape']
type WindowRadiusMode = DormerNode['windowRadiusMode']

type DormerSection = 'dormer' | 'window'

const ROOF_TYPE_OPTIONS: Array<{ label: string; value: RoofType }> = [
  { label: 'Gable', value: 'gable' },
  { label: 'Hip', value: 'hip' },
  { label: 'Shed', value: 'shed' },
  { label: 'Gambrel', value: 'gambrel' },
  { label: 'Dutch', value: 'dutch' },
  { label: 'Mansard', value: 'mansard' },
  { label: 'Flat', value: 'flat' },
]

const SECTION_OPTIONS: Array<{ label: string; value: DormerSection }> = [
  { label: 'Dormer', value: 'dormer' },
  { label: 'Window', value: 'window' },
]

function maxSharedRadius(width: number, height: number) {
  return Math.max(0, Math.min(width / 2, height / 2))
}

export default function DormerPanel() {
  const [section, setSection] = useState<DormerSection>('dormer')
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const storeNode = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as DormerNode | undefined) : undefined,
  )
  const overrides = useLiveNodeOverrides((s) =>
    selectedId ? (s.get(selectedId as AnyNodeId) as Partial<DormerNode> | undefined) : undefined,
  )
  const node =
    storeNode && overrides ? ({ ...storeNode, ...overrides } as DormerNode) : storeNode

  const handleUpdate = useCallback(
    (updates: Partial<DormerNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  // Slider drag → write live override; release → commit.
  const previewProp = useCallback(
    (updates: Partial<DormerNode>) => {
      if (!selectedId) return
      useLiveNodeOverrides.getState().set(selectedId as AnyNodeId, updates)
    },
    [selectedId],
  )
  const commitProp = useCallback(
    (updates: Partial<DormerNode>) => {
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

  const handleMove = useCallback(() => {
    if (!(node && selectedId)) return
    triggerSFX('sfx:item-pick')
    setMovingNode(node)
    setSelection({ selectedIds: [] })
  }, [node, selectedId, setMovingNode, setSelection])

  const handleDuplicate = useCallback(() => {
    if (!(node && node.roofSegmentId)) return
    triggerSFX('sfx:item-pick')
    // Deep clone and strip the id so the move tool's onClick branch
    // (`isNew || !node.id`) takes the "create fresh" path. Setting
    // `metadata.isNew = true` is what gates the move tool from
    // updating any existing node — the dormer is only added to the
    // scene on click, not when the Duplicate button is pressed.
    //
    // Pattern mirrors `panel-manager.handleDuplicate` for movables.
    const cloned = structuredClone(node) as DormerNode & { id?: AnyNodeId }
    delete (cloned as { id?: AnyNodeId }).id
    const prevMeta =
      cloned.metadata && typeof cloned.metadata === 'object' && !Array.isArray(cloned.metadata)
        ? (cloned.metadata as Record<string, unknown>)
        : {}
    cloned.metadata = { ...prevMeta, isNew: true }
    setMovingNode(cloned as DormerNode)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

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

  if (!(node && node.type === 'dormer' && selectedId)) return null

  const scenestate = useScene.getState()
  const segment = node.roofSegmentId
    ? (scenestate.nodes[node.roofSegmentId as AnyNodeId] as RoofSegmentNode | undefined)
    : undefined
  const roof = segment?.parentId
    ? (scenestate.nodes[segment.parentId as AnyNodeId] as RoofNode | undefined)
    : undefined

  // ---- World-space position helpers (mirrors chimney panel) ------------
  const dormerObj = sceneRegistry.nodes.get(selectedId)
  if (dormerObj) dormerObj.updateWorldMatrix(true, false)

  const computeWorldPos = () => {
    if (!dormerObj) return { x: 0, z: 0 }
    const localPt = new Vector3(node.position[0] ?? 0, 0, node.position[2] ?? 0)
    const worldPt = localPt.applyMatrix4(dormerObj.matrixWorld)
    return { x: worldPt.x, z: worldPt.z }
  }
  const computeWorldRotation = () => {
    if (!dormerObj) return node.rotation ?? 0
    const m = dormerObj.matrixWorld.elements
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
      if (!candidate || candidate.type !== 'roof-segment') continue
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
    const oldWorldRotation = worldRotation_now
    const target = findSegmentForWorldPoint(newWorldX, newWorldZ)
    if (target && target.segment.id !== segment.id) {
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
      } as Partial<DormerNode>)
    } else {
      const local = worldToSegLocal(newWorldX, newWorldZ, segment)
      commitProp({ position: [local.localX, 0, local.localZ] })
    }
  }

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

  // ---- Derived values for the window controls --------------------------
  const windowShape: WindowShape = node.windowShape ?? 'rectangle'
  const windowRadiusMode: WindowRadiusMode = node.windowRadiusMode ?? 'all'
  const windowCornerRadii = (node.windowCornerRadii ?? [0.15, 0.15, 0.15, 0.15]) as [
    number,
    number,
    number,
    number,
  ]
  const windowCornerRadius = node.windowCornerRadius ?? 0.15
  const windowArchHeight = node.windowArchHeight ?? 0.35
  const maxRadius = Math.max(0.01, maxSharedRadius(node.windowWidth, node.windowHeight))

  const setCornerRadius = (index: number, value: number, commit: boolean) => {
    const next = [...windowCornerRadii] as [number, number, number, number]
    next[index] = value
    if (commit) commitProp({ windowCornerRadii: next })
    else previewProp({ windowCornerRadii: next })
  }

  return (
    <PanelWrapper
      icon="/icons/roof.png"
      onBack={node.roofSegmentId ? handleBack : undefined}
      onClose={handleClose}
      title={node.name || 'Dormer'}
      width={300}
    >
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

      <PanelSection title="Section">
        <div className="grid grid-cols-3 gap-1.5 px-1 pt-1">
          {SECTION_OPTIONS.map((option) => {
            const isSelected = section === option.value
            return (
              <button
                className={cn(
                  'flex min-h-10 items-center justify-center rounded-lg border px-2 py-2 text-center text-xs transition-colors',
                  isSelected
                    ? 'border-orange-400/60 bg-orange-400/10 text-foreground'
                    : 'border-border/50 bg-[#2C2C2E] text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground',
                )}
                key={option.value}
                onClick={() => setSection(option.value)}
                type="button"
              >
                <span className="truncate font-medium">{option.label}</span>
              </button>
            )
          })}
        </div>
      </PanelSection>

      {section === 'dormer' && (
        <>
          <PanelSection title="Dimensions">
            <SliderControl
              label="Width"
              max={4}
              min={0.5}
              onChange={(v) => previewProp({ width: v })}
              onCommit={(v) => commitProp({ width: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit="m"
              value={Math.round(node.width * 100) / 100}
            />
            <SliderControl
              label="Depth"
              max={5}
              min={0.5}
              onChange={(v) => previewProp({ depth: v })}
              onCommit={(v) => commitProp({ depth: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit="m"
              value={Math.round(node.depth * 100) / 100}
            />
            <SliderControl
              label="Wall Height"
              max={5}
              min={0}
              onChange={(v) => previewProp({ height: v })}
              onCommit={(v) => commitProp({ height: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit="m"
              value={Math.round(node.height * 100) / 100}
            />
            <SliderControl
              label="Roof Height"
              max={3}
              min={0}
              onChange={(v) => previewProp({ roofHeight: v })}
              onCommit={(v) => commitProp({ roofHeight: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit="m"
              value={Math.round((node.roofHeight ?? 0.83) * 100) / 100}
            />
          </PanelSection>

          <PanelSection title="Roof Type">
            <div className="grid grid-cols-3 gap-1.5 px-1 pt-1">
              {ROOF_TYPE_OPTIONS.map((option) => {
                const isSelected = (node.roofType ?? 'gable') === option.value
                return (
                  <button
                    className={cn(
                      'flex min-h-10 items-center justify-center rounded-lg border px-2 py-2 text-xs transition-colors',
                      isSelected
                        ? 'border-orange-400/60 bg-orange-400/10 text-foreground'
                        : 'border-border/50 bg-[#2C2C2E] text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground',
                    )}
                    key={option.value}
                    onClick={() => handleUpdate({ roofType: option.value })}
                    type="button"
                  >
                    <span className="truncate font-medium">{option.label}</span>
                  </button>
                )
              })}
            </div>
          </PanelSection>
        </>
      )}

      {section === 'window' && (
        <>
          <PanelSection title="Hung Wall">
            <SliderControl
              label="Height"
              max={6}
              min={0.2}
              onChange={(v) => previewProp({ wallSkirtHeight: v })}
              onCommit={(v) => commitProp({ wallSkirtHeight: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit="m"
              value={Math.round((node.wallSkirtHeight ?? 2) * 100) / 100}
            />
          </PanelSection>

          <PanelSection title="Opening">
            <SliderControl
              label="Width"
              max={Math.max(0.5, node.width - 0.1)}
              min={0.2}
              onChange={(v) => previewProp({ windowWidth: v })}
              onCommit={(v) => commitProp({ windowWidth: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit="m"
              value={Math.round(node.windowWidth * 100) / 100}
            />
            <SliderControl
              label="Height"
              max={Math.max(0.2, (node.wallSkirtHeight ?? 2) - 0.1)}
              min={0.2}
              onChange={(v) => previewProp({ windowHeight: v })}
              onCommit={(v) => commitProp({ windowHeight: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit="m"
              value={Math.round(node.windowHeight * 100) / 100}
            />
            <SliderControl
              label="Offset X"
              max={1}
              min={-1}
              onChange={(v) => previewProp({ windowOffsetX: v })}
              onCommit={(v) => commitProp({ windowOffsetX: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit="m"
              value={Math.round(node.windowOffsetX * 100) / 100}
            />
            <SliderControl
              label="Offset Y"
              max={2}
              min={0}
              onChange={(v) => previewProp({ windowOffsetY: v })}
              onCommit={(v) => commitProp({ windowOffsetY: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit="m"
              value={Math.round(node.windowOffsetY * 100) / 100}
            />
          </PanelSection>

          <PanelSection title="Shape">
            <SegmentedControl
              onChange={(v) =>
                handleUpdate({
                  windowShape: v as WindowShape,
                  ...(v === 'rounded'
                    ? {
                        windowRadiusMode,
                        windowCornerRadii,
                        windowCornerRadius: Math.min(windowCornerRadius, maxRadius),
                      }
                    : {}),
                })
              }
              options={[
                { value: 'rectangle', label: 'Rect' },
                { value: 'rounded', label: 'Rounded' },
                { value: 'arch', label: 'Arch' },
              ]}
              value={windowShape}
            />
            {windowShape === 'rounded' && (
              <div className="mt-2 flex flex-col gap-1">
                <SegmentedControl
                  onChange={(v) => handleUpdate({ windowRadiusMode: v as WindowRadiusMode })}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'individual', label: 'Individual' },
                  ]}
                  value={windowRadiusMode}
                />
                {windowRadiusMode === 'all' ? (
                  <SliderControl
                    label="Corner Radius"
                    max={maxRadius}
                    min={0}
                    onChange={(v) => previewProp({ windowCornerRadius: v })}
                    onCommit={(v) => commitProp({ windowCornerRadius: v })}
                    precision={2}
                    restoreOnCommit={false}
                    step={0.01}
                    unit="m"
                    value={Math.round(windowCornerRadius * 100) / 100}
                  />
                ) : (
                  (
                    [
                      ['Top Left', 0],
                      ['Top Right', 1],
                      ['Bottom Right', 2],
                      ['Bottom Left', 3],
                    ] as const
                  ).map(([label, index]) => (
                    <SliderControl
                      key={label}
                      label={label}
                      max={maxRadius}
                      min={0}
                      onChange={(v) => setCornerRadius(index, v, false)}
                      onCommit={(v) => setCornerRadius(index, v, true)}
                      precision={2}
                      restoreOnCommit={false}
                      step={0.01}
                      unit="m"
                      value={Math.round((windowCornerRadii[index] ?? 0) * 100) / 100}
                    />
                  ))
                )}
              </div>
            )}
            {windowShape === 'arch' && (
              <SliderControl
                label="Arch Height"
                max={Math.max(0.1, node.windowHeight)}
                min={0.1}
                onChange={(v) => previewProp({ windowArchHeight: v })}
                onCommit={(v) => commitProp({ windowArchHeight: v })}
                precision={2}
                restoreOnCommit={false}
                step={0.05}
                unit="m"
                value={Math.round(windowArchHeight * 100) / 100}
              />
            )}
          </PanelSection>

          <PanelSection title="Frame">
            <SliderControl
              label="Thickness"
              max={0.15}
              min={0.01}
              onChange={(v) => previewProp({ windowFrameThickness: v })}
              onCommit={(v) => commitProp({ windowFrameThickness: v })}
              precision={3}
              restoreOnCommit={false}
              step={0.005}
              unit="m"
              value={Math.round(node.windowFrameThickness * 1000) / 1000}
            />
            <SliderControl
              label="Depth"
              max={0.15}
              min={0.02}
              onChange={(v) => previewProp({ windowFrameDepth: v })}
              onCommit={(v) => commitProp({ windowFrameDepth: v })}
              precision={3}
              restoreOnCommit={false}
              step={0.005}
              unit="m"
              value={Math.round(node.windowFrameDepth * 1000) / 1000}
            />
            <SliderControl
              label="Divider"
              max={0.06}
              min={0}
              onChange={(v) => previewProp({ windowDividerThickness: v })}
              onCommit={(v) => commitProp({ windowDividerThickness: v })}
              precision={3}
              restoreOnCommit={false}
              step={0.002}
              unit="m"
              value={Math.round(node.windowDividerThickness * 1000) / 1000}
            />
          </PanelSection>

          <PanelSection title="Grid">
            <SliderControl
              label="Columns"
              max={8}
              min={1}
              onChange={(v) =>
                previewProp({ windowColumns: Math.max(1, Math.min(8, Math.round(v))) })
              }
              onCommit={(v) =>
                commitProp({ windowColumns: Math.max(1, Math.min(8, Math.round(v))) })
              }
              precision={0}
              restoreOnCommit={false}
              step={1}
              value={node.windowColumns ?? 3}
            />
            <SliderControl
              label="Rows"
              max={8}
              min={1}
              onChange={(v) => previewProp({ windowRows: Math.max(1, Math.min(8, Math.round(v))) })}
              onCommit={(v) => commitProp({ windowRows: Math.max(1, Math.min(8, Math.round(v))) })}
              precision={0}
              restoreOnCommit={false}
              step={1}
              value={node.windowRows ?? 3}
            />
          </PanelSection>

          <PanelSection title="Sill">
            <ToggleControl
              checked={node.windowSill ?? true}
              label="Enable Sill"
              onChange={(checked) => handleUpdate({ windowSill: checked })}
            />
            {(node.windowSill ?? true) && (
              <div className="mt-1 flex flex-col gap-1">
                <SliderControl
                  label="Depth"
                  max={0.3}
                  min={0.02}
                  onChange={(v) => previewProp({ windowSillDepth: v })}
                  onCommit={(v) => commitProp({ windowSillDepth: v })}
                  precision={3}
                  restoreOnCommit={false}
                  step={0.01}
                  unit="m"
                  value={Math.round((node.windowSillDepth ?? 0.08) * 1000) / 1000}
                />
                <SliderControl
                  label="Thickness"
                  max={0.1}
                  min={0.01}
                  onChange={(v) => previewProp({ windowSillThickness: v })}
                  onCommit={(v) => commitProp({ windowSillThickness: v })}
                  precision={3}
                  restoreOnCommit={false}
                  step={0.005}
                  unit="m"
                  value={Math.round((node.windowSillThickness ?? 0.03) * 1000) / 1000}
                />
              </div>
            )}
          </PanelSection>
        </>
      )}

      <PanelSection title="Actions">
        <ActionGroup>
          <ActionButton
            icon={<Move className="h-3.5 w-3.5" />}
            label="Move"
            onClick={handleMove}
          />
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
