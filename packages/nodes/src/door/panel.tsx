'use client'

import { type AnyNode, type AnyNodeId, DoorNode, useInteractive, useScene } from '@pascal-app/core'
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
import { Copy, DoorOpen, FlipHorizontal2, Move, Trash2 } from 'lucide-react'
import { useCallback, useRef } from 'react'
import { scaleHandleHeight } from './door-math'

const doorTypeOptions = [
  { label: 'Hinged', value: 'hinged', available: true },
  { label: 'Double', value: 'double', available: true },
  { label: 'French', value: 'french', available: true },
  { label: 'Folding', value: 'folding', available: true },
  { label: 'Pocket', value: 'pocket', available: true },
  { label: 'Barn', value: 'barn', available: true },
  { label: 'Sliding', value: 'sliding', available: true },
] satisfies {
  label: string
  value: DoorNode['doorType']
  available: boolean
}[]

const garageDoorTypeOptions = [
  { label: 'Sectional', value: 'garage-sectional', available: true },
  { label: 'Roll-up', value: 'garage-rollup', available: true },
  { label: 'Tilt-up', value: 'garage-tiltup', available: true },
] satisfies {
  label: string
  value: DoorNode['doorType']
  available: boolean
}[]

const frenchDoorSegments: DoorNode['segments'] = [
  {
    type: 'glass',
    heightRatio: 0.76,
    columnRatios: [1, 1],
    dividerThickness: 0.025,
    panelDepth: 0.01,
    panelInset: 0.04,
  },
  {
    type: 'panel',
    heightRatio: 0.24,
    columnRatios: [1],
    dividerThickness: 0.03,
    panelDepth: 0.012,
    panelInset: 0.035,
  },
]

const foldingDoorSegments: DoorNode['segments'] = [
  {
    type: 'panel',
    heightRatio: 1,
    columnRatios: [1],
    dividerThickness: 0.02,
    panelDepth: 0.008,
    panelInset: 0.025,
  },
]

const hingedDoorSegments: DoorNode['segments'] = [
  {
    type: 'panel',
    heightRatio: 0.4,
    columnRatios: [1],
    dividerThickness: 0.03,
    panelDepth: 0.01,
    panelInset: 0.04,
  },
  {
    type: 'panel',
    heightRatio: 0.6,
    columnRatios: [1],
    dividerThickness: 0.03,
    panelDepth: 0.01,
    panelInset: 0.04,
  },
]

const defaultDoorDimensions: Record<DoorNode['doorType'], { width: number; height: number }> = {
  hinged: { width: 0.9, height: 2.1 },
  double: { width: 1.5, height: 2.1 },
  french: { width: 1.5, height: 2.1 },
  folding: { width: 1.8, height: 2.1 },
  pocket: { width: 0.9, height: 2.1 },
  barn: { width: 1, height: 2.1 },
  sliding: { width: 1.5, height: 2.1 },
  'garage-sectional': { width: 2.7, height: 2.4 },
  'garage-rollup': { width: 2.7, height: 2.4 },
  'garage-tiltup': { width: 2.7, height: 2.4 },
}

const defaultDoorSegmentsByType: Record<DoorNode['doorType'], DoorNode['segments']> = {
  hinged: hingedDoorSegments,
  double: hingedDoorSegments,
  french: frenchDoorSegments,
  folding: foldingDoorSegments,
  pocket: foldingDoorSegments,
  barn: foldingDoorSegments,
  sliding: frenchDoorSegments,
  'garage-sectional': foldingDoorSegments,
  'garage-rollup': foldingDoorSegments,
  'garage-tiltup': foldingDoorSegments,
}

function isSameDoorValue(current: unknown, next: unknown): boolean {
  if (typeof current === 'number' && typeof next === 'number') {
    return Math.abs(current - next) < 1e-6
  }

  if (Array.isArray(current) && Array.isArray(next)) {
    return (
      current.length === next.length &&
      current.every((value, index) => isSameDoorValue(value, next[index]))
    )
  }

  return Object.is(current, next)
}

export default function DoorPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const previewRef = useRef<{
    id: AnyNodeId
    key: keyof DoorNode
    value: unknown
  } | null>(null)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as DoorNode | undefined) : undefined,
  )

  // Panel slider-drag fix recipe (plans/editor-node-registry.md). Without
  // it, the 29+ SliderControls in this panel would loop on drag.
  const handleUpdate = useCallback(
    (updates: Partial<DoorNode>) => {
      if (!selectedId) return
      const liveNode = useScene.getState().nodes[selectedId as AnyNodeId]
      if (liveNode?.type !== 'door') return

      const hasChange = Object.entries(updates).some(([key, value]) => {
        const currentValue = liveNode[key as keyof DoorNode]
        return !isSameDoorValue(currentValue, value)
      })
      if (!hasChange) return

      if ('operationState' in updates || 'swingAngle' in updates || 'doorType' in updates) {
        useInteractive.getState().removeDoorOpenState(selectedId as AnyNodeId)
      }
      useScene.getState().updateNode(selectedId as AnyNode['id'], updates)
      const scene = useScene.getState()
      scene.dirtyNodes.add(selectedId as AnyNodeId)
      if (liveNode.parentId) scene.dirtyNodes.add(liveNode.parentId as AnyNodeId)
    },
    [selectedId],
  )

  const previewDoorUpdate = useCallback(
    <K extends keyof DoorNode>(key: K, value: DoorNode[K]) => {
      if (!selectedId) return
      const liveNode = useScene.getState().nodes[selectedId as AnyNodeId]
      if (liveNode?.type !== 'door') return

      if (
        !(
          previewRef.current &&
          previewRef.current.id === selectedId &&
          previewRef.current.key === key
        )
      ) {
        previewRef.current = {
          id: selectedId as AnyNodeId,
          key,
          value: liveNode[key],
        }
      }

      if (isSameDoorValue(liveNode[key], value)) return

      ;(liveNode as DoorNode)[key] = value
      useScene.getState().dirtyNodes.add(selectedId as AnyNodeId)
    },
    [selectedId],
  )

  const commitDoorPreview = useCallback(
    <K extends keyof DoorNode>(key: K, value: DoorNode[K]) => {
      if (!selectedId) return

      const scene = useScene.getState()
      const liveNode = scene.nodes[selectedId as AnyNodeId]
      const preview = previewRef.current
      if (liveNode?.type === 'door' && preview?.id === selectedId && preview.key === key) {
        ;(liveNode as DoorNode)[key] = preview.value as DoorNode[K]
        scene.dirtyNodes.add(selectedId as AnyNodeId)
      }
      previewRef.current = null

      useScene
        .getState()
        .updateNode(selectedId as AnyNode['id'], { [key]: value } as Partial<DoorNode>)
      scene.dirtyNodes.add(selectedId as AnyNodeId)
    },
    [selectedId],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleFlip = useCallback(() => {
    if (!node) return
    handleUpdate({
      side: node.side === 'front' ? 'back' : 'front',
      rotation: [node.rotation[0], node.rotation[1] + Math.PI, node.rotation[2]],
    })
  }, [node, handleUpdate])

  const handleMove = useCallback(() => {
    if (!node) return
    triggerSFX('sfx:item-pick')
    setMovingNode(node)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    triggerSFX('sfx:item-delete')
    deleteNode(selectedId as AnyNode['id'])
    if (node.parentId) useScene.getState().dirtyNodes.add(node.parentId as AnyNodeId)
    setSelection({ selectedIds: [] })
  }, [selectedId, node, deleteNode, setSelection])

  const handleDuplicate = useCallback(() => {
    if (!node?.parentId) return
    triggerSFX('sfx:item-pick')
    useScene.temporal.getState().pause()
    const cloned = structuredClone(node) as any
    delete cloned.id
    cloned.metadata = { ...cloned.metadata, isNew: true }
    const duplicate = DoorNode.parse(cloned)
    useScene.getState().createNode(duplicate, node.parentId as AnyNodeId)
    setMovingNode(duplicate)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  const setSegmentHeightRatio = (segIdx: number, newVal: number) => {
    if (!node) return
    const numSegs = node.segments.length
    const totalH = node.segments.reduce((sum, s) => sum + s.heightRatio, 0)
    const normH = node.segments.map((s) => s.heightRatio / totalH)
    const clamped = Math.max(0.05, Math.min(0.95, newVal))
    const neighborIdx = segIdx < numSegs - 1 ? segIdx + 1 : segIdx - 1
    const delta = clamped - normH[segIdx]!
    const neighborVal = Math.max(0.05, normH[neighborIdx]! - delta)
    const newRatios = normH.map((v, i) => {
      if (i === segIdx) return clamped
      if (i === neighborIdx) return neighborVal
      return v
    })
    const updated = node.segments.map((s, idx) => ({ ...s, heightRatio: newRatios[idx]! }))
    handleUpdate({ segments: updated })
  }

  const setSegmentColumnRatio = (segIdx: number, colIdx: number, newVal: number) => {
    const seg = node?.segments[segIdx]
    if (!seg) return
    const normRatios = (() => {
      const sum = seg.columnRatios.reduce((a, b) => a + b, 0)
      return seg.columnRatios.map((r) => r / sum)
    })()
    const numCols = normRatios.length
    const clamped = Math.max(0.05, Math.min(0.95, newVal))
    const neighborIdx = colIdx < numCols - 1 ? colIdx + 1 : colIdx - 1
    const delta = clamped - normRatios[colIdx]!
    const neighborVal = Math.max(0.05, normRatios[neighborIdx]! - delta)
    const newRatios = normRatios.map((v, i) => {
      if (i === colIdx) return clamped
      if (i === neighborIdx) return neighborVal
      return v
    })
    const updated = node?.segments.map((s, idx) =>
      idx === segIdx ? { ...s, columnRatios: newRatios } : s,
    )
    handleUpdate({ segments: updated })
  }

  if (!(node && node.type === 'door' && selectedId)) return null

  const hSum = node.segments.reduce((s, seg) => s + seg.heightRatio, 0)
  const normHeights = node.segments.map((seg) => seg.heightRatio / hSum)
  const isOpening = node.openingKind === 'opening'
  const openingShape = node.openingShape ?? 'rectangle'
  const doorShape =
    openingShape === 'arch' || openingShape === 'rounded' ? openingShape : 'rectangle'
  const openingRadiusMode = node.openingRadiusMode ?? 'all'
  const openingTopRadii = node.openingTopRadii ?? [0.15, 0.15]
  const cornerRadius = node.cornerRadius ?? 0.15
  const archHeight = node.archHeight ?? 0.45
  const openingRevealRadius = node.openingRevealRadius ?? 0.025
  const maxRoundedRadius = Math.max(0.01, Math.min(node.width / 2, node.height))
  const doorType = node.doorType ?? 'hinged'
  const isGarageDoor = node.doorCategory === 'garage' || doorType.startsWith('garage-')
  const isSwingDoor = doorType === 'hinged' || doorType === 'double' || doorType === 'french'
  const isSlideFoldDoor =
    doorType === 'folding' || doorType === 'pocket' || doorType === 'barn' || doorType === 'sliding'
  const isSlidingDoor = doorType === 'pocket' || doorType === 'barn' || doorType === 'sliding'
  const isFoldingDoor = doorType === 'folding'
  const isSectionalGarageDoor = doorType === 'garage-sectional'
  const isRollupGarageDoor = doorType === 'garage-rollup'
  const isTiltupGarageDoor = doorType === 'garage-tiltup'
  const isCutoutOnly = isOpening
  const typeMode = isCutoutOnly ? 'opening' : isGarageDoor ? 'garage' : 'door'
  const supportsHingeSide = doorType === 'hinged'
  const supportsHandleSide = doorType === 'hinged'
  const supportsTopShape = isSwingDoor
  const showFlipSide = !isCutoutOnly
  const showFoldSection = isFoldingDoor && !isCutoutOnly
  const showSlideSection = isSlidingDoor && !isCutoutOnly
  const showGarageSection =
    (isSectionalGarageDoor || isRollupGarageDoor || isTiltupGarageDoor) && !isCutoutOnly
  const showOpeningShapeSection = isCutoutOnly
  const showDoorShapeSection = !isCutoutOnly && supportsTopShape
  const showFrameSection = !isCutoutOnly
  const showContentPaddingSection = !isCutoutOnly && !isGarageDoor
  const showSwingSection = isSwingDoor
  const showThresholdSection = isSwingDoor
  const showHandleSection = isSwingDoor
  const showHardwareSection = isSwingDoor
  const showSegmentsSection = !isCutoutOnly && !isGarageDoor
  const maxDoorWidth = isGarageDoor ? 6 : 3

  const setOpeningTopRadius = (index: number, value: number, commit = false) => {
    const next = [...openingTopRadii] as [number, number]
    next[index] = value
    if (commit) {
      commitDoorPreview('openingTopRadii', next)
    } else {
      previewDoorUpdate('openingTopRadii', next)
    }
  }

  const getDoorTypeUpdates = (nextDoorType: DoorNode['doorType']): Partial<DoorNode> => {
    const dimensions = defaultDoorDimensions[nextDoorType]
    const segments = structuredClone(defaultDoorSegmentsByType[nextDoorType])
    const dimensionUpdates = {
      width: dimensions.width,
      height: dimensions.height,
      position: [node.position[0], dimensions.height / 2, node.position[2]] as DoorNode['position'],
    }

    if (nextDoorType === 'double' || nextDoorType === 'french') {
      return {
        doorCategory: 'interior',
        doorType: nextDoorType,
        leafCount: 2,
        ...dimensionUpdates,
        handleSide: 'right',
        segments,
        ...(nextDoorType === 'french'
          ? {
              contentPadding: [0.045, 0.055],
            }
          : {}),
      }
    }

    if (nextDoorType === 'folding') {
      return {
        doorCategory: 'interior',
        doorType: nextDoorType,
        leafCount: 4,
        ...dimensionUpdates,
        openingShape: 'rectangle',
        handle: true,
        handleSide: 'right',
        trackStyle: 'visible',
        operationState: Math.max(node.operationState ?? 0, 0.65),
        threshold: false,
        contentPadding: [0.03, 0.04],
        segments,
      }
    }

    if (nextDoorType === 'pocket') {
      return {
        doorCategory: 'interior',
        doorType: nextDoorType,
        leafCount: 1,
        ...dimensionUpdates,
        openingShape: 'rectangle',
        handle: true,
        handleSide: 'right',
        trackStyle: 'pocket',
        slideDirection: node.slideDirection ?? 'left',
        operationState: node.operationState ?? 0,
        threshold: false,
        contentPadding: [0.035, 0.045],
        segments,
      }
    }

    if (nextDoorType === 'barn') {
      return {
        doorCategory: 'interior',
        doorType: nextDoorType,
        leafCount: 1,
        ...dimensionUpdates,
        openingShape: 'rectangle',
        handle: true,
        handleSide: 'right',
        trackStyle: 'visible',
        slideDirection: node.slideDirection ?? 'left',
        operationState: node.operationState ?? 0,
        threshold: false,
        contentPadding: [0.035, 0.045],
        segments,
      }
    }

    if (nextDoorType === 'sliding') {
      return {
        doorCategory: 'interior',
        doorType: nextDoorType,
        leafCount: 2,
        ...dimensionUpdates,
        openingShape: 'rectangle',
        handle: true,
        handleSide: 'right',
        trackStyle: 'visible',
        slideDirection: node.slideDirection ?? 'left',
        operationState: node.operationState ?? 0,
        threshold: false,
        contentPadding: [0.03, 0.04],
        segments,
      }
    }

    if (nextDoorType === 'garage-sectional') {
      return {
        doorCategory: 'garage',
        doorType: nextDoorType,
        leafCount: 1,
        ...dimensionUpdates,
        handle: false,
        threshold: false,
        openingShape: 'rectangle',
        trackStyle: 'overhead',
        operationState: 0,
        garagePanelCount: Math.max(3, Math.min(8, node.garagePanelCount ?? 4)),
        contentPadding: [0.04, 0.04],
        segments,
      }
    }

    if (nextDoorType === 'garage-rollup') {
      return {
        doorCategory: 'garage',
        doorType: nextDoorType,
        leafCount: 1,
        ...dimensionUpdates,
        handle: false,
        threshold: false,
        openingShape: 'rectangle',
        trackStyle: 'overhead',
        operationState: 0,
        garagePanelCount: 4,
        contentPadding: [0.04, 0.04],
        segments,
      }
    }

    if (nextDoorType === 'garage-tiltup') {
      return {
        doorCategory: 'garage',
        doorType: nextDoorType,
        leafCount: 1,
        ...dimensionUpdates,
        handle: false,
        threshold: false,
        openingShape: 'rectangle',
        trackStyle: 'overhead',
        operationState: 0,
        garagePanelCount: 4,
        contentPadding: [0.04, 0.04],
        segments,
      }
    }

    return {
      doorCategory: 'interior',
      doorType: nextDoorType,
      leafCount: 1,
      ...dimensionUpdates,
      segments,
      threshold: true,
    }
  }

  return (
    <PanelWrapper
      icon="/icons/door.webp"
      onClose={handleClose}
      title={node.name || 'Door'}
      width={320}
    >
      <PanelSection title="Type">
        <div className="flex flex-col gap-2 px-1 pb-1">
          <SegmentedControl
            onChange={(v) =>
              handleUpdate(
                v === 'opening'
                  ? {
                      openingKind: v,
                      openingShape,
                      openingRadiusMode,
                      openingTopRadii,
                      cornerRadius,
                      archHeight,
                      openingRevealRadius,
                    }
                  : v === 'garage'
                    ? {
                        openingKind: 'door',
                        ...getDoorTypeUpdates(isGarageDoor ? doorType : 'garage-sectional'),
                      }
                    : {
                        openingKind: 'door',
                        ...(isGarageDoor ? getDoorTypeUpdates('hinged') : {}),
                      },
              )
            }
            options={[
              { label: 'Door', value: 'door' },
              { label: 'Opening', value: 'opening' },
              { label: 'Garage', value: 'garage' },
            ]}
            value={typeMode}
          />
        </div>
        {!isOpening && (
          <div className="grid grid-cols-2 gap-2 px-1 pt-1">
            {(isGarageDoor ? garageDoorTypeOptions : doorTypeOptions).map((option) => {
              const isSelected = doorType === option.value
              return (
                <button
                  className={cn(
                    'flex min-h-12 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-xs transition-colors',
                    isSelected
                      ? 'border-orange-400/60 bg-orange-400/10 text-foreground'
                      : 'border-border/50 bg-[#2C2C2E] text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground',
                    !option.available &&
                      'cursor-not-allowed opacity-45 hover:bg-[#2C2C2E] hover:text-muted-foreground',
                  )}
                  disabled={!option.available}
                  key={option.value}
                  onClick={() => handleUpdate(getDoorTypeUpdates(option.value))}
                  type="button"
                >
                  <DoorOpen className="h-4 w-4 shrink-0" />
                  <span className="truncate font-medium">{option.label}</span>
                </button>
              )
            })}
          </div>
        )}
      </PanelSection>

      <PanelSection title="Position">
        <SliderControl
          label={
            <>
              X<sub className="ml-[1px] text-[11px] opacity-70">wall</sub>
            </>
          }
          max={10}
          min={-10}
          onChange={(v) => handleUpdate({ position: [v, node.position[1], node.position[2]] })}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(node.position[0] * 100) / 100}
        />
        {showFlipSide && (
          <div className="px-1 pt-2 pb-1">
            <ActionButton
              className="w-full"
              icon={<FlipHorizontal2 className="h-4 w-4" />}
              label="Flip Side"
              onClick={handleFlip}
            />
          </div>
        )}
      </PanelSection>

      {showFoldSection && (
        <PanelSection title="Fold">
          <div className="flex flex-col gap-2 px-1 pb-1">
            <div className="space-y-1">
              <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                Panels
              </span>
              <SegmentedControl
                onChange={(v) => handleUpdate({ leafCount: v === '2' ? 2 : 4 })}
                options={[
                  { label: '2', value: '2' },
                  { label: '4', value: '4' },
                ]}
                value={node.leafCount === 2 ? '2' : '4'}
              />
            </div>
          </div>
          <SliderControl
            label="Open"
            max={100}
            min={0}
            onChange={(v) => handleUpdate({ operationState: v / 100 })}
            precision={0}
            restoreOnCommit={false}
            step={5}
            unit="%"
            value={Math.round((node.operationState ?? 0) * 100)}
          />
        </PanelSection>
      )}

      {showSlideSection && (
        <PanelSection title="Slide">
          <div className="flex flex-col gap-2 px-1 pb-1">
            <div className="space-y-1">
              <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                {doorType === 'pocket' ? 'Pocket' : doorType === 'barn' ? 'Rail' : 'Panel'}
              </span>
              <SegmentedControl
                onChange={(v) => handleUpdate({ slideDirection: v })}
                options={[
                  { label: 'Left', value: 'left' },
                  { label: 'Right', value: 'right' },
                ]}
                value={node.slideDirection ?? 'left'}
              />
            </div>
          </div>
          <SliderControl
            label="Open"
            max={100}
            min={0}
            onChange={(v) => handleUpdate({ operationState: v / 100 })}
            precision={0}
            restoreOnCommit={false}
            step={5}
            unit="%"
            value={Math.round((node.operationState ?? 0) * 100)}
          />
        </PanelSection>
      )}

      {showGarageSection && (
        <PanelSection title="Garage">
          <SliderControl
            label="Open"
            max={100}
            min={0}
            onChange={(v) => handleUpdate({ operationState: v / 100 })}
            precision={0}
            restoreOnCommit={false}
            step={5}
            unit="%"
            value={Math.round((node.operationState ?? 0) * 100)}
          />
          {isSectionalGarageDoor && (
            <SliderControl
              label="Panels"
              max={8}
              min={3}
              onChange={(v) => handleUpdate({ garagePanelCount: Math.round(v) })}
              precision={0}
              restoreOnCommit={false}
              step={1}
              value={node.garagePanelCount ?? 4}
            />
          )}
        </PanelSection>
      )}

      <PanelSection title="Dimensions">
        <SliderControl
          label="Width"
          max={maxDoorWidth}
          min={0.5}
          onChange={(v) => handleUpdate({ width: v })}
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.width * 100) / 100}
        />
        <SliderControl
          label="Height"
          max={4}
          min={1.0}
          onChange={(v) =>
            handleUpdate({
              height: v,
              position: [node.position[0], v / 2, node.position[2]],
              // Keep the handle at the same relative height as the door resizes,
              // matching the height-resize arrow.
              handleHeight: scaleHandleHeight(node.handleHeight, node.height, v),
            })
          }
          precision={2}
          restoreOnCommit={false}
          step={0.05}
          unit="m"
          value={Math.round(node.height * 100) / 100}
        />
      </PanelSection>

      {showDoorShapeSection && (
        <PanelSection title="Top Shape">
          <div className="flex flex-col gap-2 px-1 pb-1">
            <SegmentedControl
              onChange={(v) =>
                handleUpdate({
                  openingShape: v as DoorNode['openingShape'],
                  ...(v === 'rounded'
                    ? {
                        openingRadiusMode,
                        openingTopRadii,
                        cornerRadius: Math.min(cornerRadius, maxRoundedRadius),
                        openingRevealRadius,
                      }
                    : {}),
                  ...(v === 'arch' ? { archHeight } : {}),
                })
              }
              options={[
                { label: 'Rect', value: 'rectangle' },
                { label: 'Rounded', value: 'rounded' },
                { label: 'Arch', value: 'arch' },
              ]}
              value={doorShape}
            />
          </div>
          {doorShape === 'rounded' && (
            <>
              <div className="flex flex-col gap-2 px-1 pb-1">
                <SegmentedControl
                  onChange={(v) =>
                    handleUpdate({ openingRadiusMode: v as DoorNode['openingRadiusMode'] })
                  }
                  options={[
                    { label: 'All', value: 'all' },
                    { label: 'Individual', value: 'individual' },
                  ]}
                  value={openingRadiusMode}
                />
              </div>
              {openingRadiusMode === 'all' ? (
                <SliderControl
                  label="Corner Radius"
                  max={maxRoundedRadius}
                  min={0}
                  onChange={(v) => previewDoorUpdate('cornerRadius', v)}
                  onCommit={(v) => commitDoorPreview('cornerRadius', v)}
                  precision={2}
                  step={0.05}
                  unit="m"
                  value={Math.round(cornerRadius * 100) / 100}
                />
              ) : (
                <>
                  {[
                    ['Top Left', 0],
                    ['Top Right', 1],
                  ].map(([label, index]) => (
                    <SliderControl
                      key={label}
                      label={label}
                      max={maxRoundedRadius}
                      min={0}
                      onChange={(v) => setOpeningTopRadius(index as number, v)}
                      onCommit={(v) => setOpeningTopRadius(index as number, v, true)}
                      precision={2}
                      step={0.05}
                      unit="m"
                      value={Math.round((openingTopRadii[index as number] ?? 0) * 100) / 100}
                    />
                  ))}
                </>
              )}
              <SliderControl
                label="Reveal Radius"
                max={0.08}
                min={0}
                onChange={(v) => previewDoorUpdate('openingRevealRadius', v)}
                onCommit={(v) => commitDoorPreview('openingRevealRadius', v)}
                precision={3}
                step={0.005}
                unit="m"
                value={Math.round(openingRevealRadius * 1000) / 1000}
              />
            </>
          )}
          {doorShape === 'arch' && (
            <SliderControl
              label="Arch Height"
              max={node.height}
              min={0.05}
              onChange={(v) => handleUpdate({ archHeight: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit="m"
              value={Math.round(archHeight * 100) / 100}
            />
          )}
        </PanelSection>
      )}

      {showOpeningShapeSection && (
        <PanelSection title="Opening Shape">
          <div className="flex flex-col gap-2 px-1 pb-1">
            <SegmentedControl
              onChange={(v) =>
                handleUpdate({
                  openingShape: v,
                  ...(v === 'rounded'
                    ? { openingRadiusMode, openingTopRadii, cornerRadius, openingRevealRadius }
                    : {}),
                  ...(v === 'arch' ? { archHeight } : {}),
                })
              }
              options={[
                { label: 'Rect', value: 'rectangle' },
                { label: 'Rounded', value: 'rounded' },
                { label: 'Arch', value: 'arch' },
              ]}
              value={openingShape}
            />
          </div>
          {openingShape === 'rounded' && (
            <>
              <div className="flex flex-col gap-2 px-1 pb-1">
                <SegmentedControl
                  onChange={(v) =>
                    handleUpdate({ openingRadiusMode: v as DoorNode['openingRadiusMode'] })
                  }
                  options={[
                    { label: 'All', value: 'all' },
                    { label: 'Individual', value: 'individual' },
                  ]}
                  value={openingRadiusMode}
                />
              </div>
              {openingRadiusMode === 'all' ? (
                <SliderControl
                  label="Corner Radius"
                  max={maxRoundedRadius}
                  min={0}
                  onChange={(v) => previewDoorUpdate('cornerRadius', v)}
                  onCommit={(v) => commitDoorPreview('cornerRadius', v)}
                  precision={2}
                  step={0.05}
                  unit="m"
                  value={Math.round(cornerRadius * 100) / 100}
                />
              ) : (
                <>
                  {[
                    ['Top Left', 0],
                    ['Top Right', 1],
                  ].map(([label, index]) => (
                    <SliderControl
                      key={label}
                      label={label}
                      max={maxRoundedRadius}
                      min={0}
                      onChange={(v) => setOpeningTopRadius(index as number, v)}
                      onCommit={(v) => setOpeningTopRadius(index as number, v, true)}
                      precision={2}
                      step={0.05}
                      unit="m"
                      value={Math.round((openingTopRadii[index as number] ?? 0) * 100) / 100}
                    />
                  ))}
                </>
              )}
              <SliderControl
                label="Reveal Radius"
                max={0.08}
                min={0}
                onChange={(v) => previewDoorUpdate('openingRevealRadius', v)}
                onCommit={(v) => commitDoorPreview('openingRevealRadius', v)}
                precision={3}
                step={0.005}
                unit="m"
                value={Math.round(openingRevealRadius * 1000) / 1000}
              />
            </>
          )}
          {openingShape === 'arch' && (
            <SliderControl
              label="Arch Height"
              max={node.height}
              min={0.05}
              onChange={(v) => handleUpdate({ archHeight: v })}
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit="m"
              value={Math.round(archHeight * 100) / 100}
            />
          )}
        </PanelSection>
      )}

      {!isCutoutOnly && (
        <>
          {showFrameSection && (
            <PanelSection title="Frame">
              <SliderControl
                label="Thickness"
                max={0.2}
                min={0.01}
                onChange={(v) => handleUpdate({ frameThickness: v })}
                precision={3}
                step={0.01}
                unit="m"
                value={Math.round(node.frameThickness * 1000) / 1000}
              />
              <SliderControl
                label="Depth"
                max={0.3}
                min={0.01}
                onChange={(v) => handleUpdate({ frameDepth: v })}
                precision={3}
                step={0.01}
                unit="m"
                value={Math.round(node.frameDepth * 1000) / 1000}
              />
            </PanelSection>
          )}

          {showContentPaddingSection && (
            <PanelSection title="Content Padding">
              <SliderControl
                label="Horizontal"
                max={0.2}
                min={0}
                onChange={(v) => handleUpdate({ contentPadding: [v, node.contentPadding[1]] })}
                precision={3}
                step={0.005}
                unit="m"
                value={Math.round(node.contentPadding[0] * 1000) / 1000}
              />
              <SliderControl
                label="Vertical"
                max={0.2}
                min={0}
                onChange={(v) => handleUpdate({ contentPadding: [node.contentPadding[0], v] })}
                precision={3}
                step={0.005}
                unit="m"
                value={Math.round(node.contentPadding[1] * 1000) / 1000}
              />
            </PanelSection>
          )}

          {showSwingSection && (
            <PanelSection title="Swing">
              <div className="flex flex-col gap-2 px-1 pb-1">
                {supportsHingeSide && (
                  <div className="space-y-1">
                    <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                      Hinges Side
                    </span>
                    <SegmentedControl
                      onChange={(v) => handleUpdate({ hingesSide: v })}
                      options={[
                        { label: 'Left', value: 'left' },
                        { label: 'Right', value: 'right' },
                      ]}
                      value={node.hingesSide}
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                    Direction
                  </span>
                  <SegmentedControl
                    onChange={(v) => handleUpdate({ swingDirection: v })}
                    options={[
                      { label: 'Inward', value: 'inward' },
                      { label: 'Outward', value: 'outward' },
                    ]}
                    value={node.swingDirection}
                  />
                </div>
              </div>
            </PanelSection>
          )}

          {showThresholdSection && (
            <PanelSection title="Threshold">
              <ToggleControl
                checked={node.threshold}
                label="Enable Threshold"
                onChange={(checked) => handleUpdate({ threshold: checked })}
              />
              {node.threshold && (
                <div className="mt-1 flex flex-col gap-1">
                  <SliderControl
                    label="Height"
                    max={0.1}
                    min={0.005}
                    onChange={(v) => handleUpdate({ thresholdHeight: v })}
                    precision={3}
                    step={0.005}
                    unit="m"
                    value={Math.round(node.thresholdHeight * 1000) / 1000}
                  />
                </div>
              )}
            </PanelSection>
          )}

          {showHandleSection && (
            <PanelSection title="Handle">
              {isSwingDoor && (
                <ToggleControl
                  checked={node.handle}
                  label="Enable Handle"
                  onChange={(checked) => handleUpdate({ handle: checked })}
                />
              )}
              {(node.handle || !isSwingDoor) && (
                <div className="mt-1 flex flex-col gap-1">
                  <SliderControl
                    label="Height"
                    max={node.height - 0.1}
                    min={0.5}
                    onChange={(v) => handleUpdate({ handleHeight: v })}
                    precision={2}
                    step={0.05}
                    unit="m"
                    value={Math.round(node.handleHeight * 100) / 100}
                  />
                  {supportsHandleSide && (
                    <div className="space-y-1">
                      <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                        Handle Side
                      </span>
                      <SegmentedControl
                        onChange={(v) => handleUpdate({ handleSide: v })}
                        options={[
                          { label: 'Left', value: 'left' },
                          { label: 'Right', value: 'right' },
                        ]}
                        value={node.handleSide}
                      />
                    </div>
                  )}
                </div>
              )}
            </PanelSection>
          )}

          {showHardwareSection && (
            <PanelSection title="Hardware">
              <ToggleControl
                checked={node.doorCloser}
                label="Door Closer"
                onChange={(checked) => handleUpdate({ doorCloser: checked })}
              />
              <ToggleControl
                checked={node.panicBar}
                label="Panic Bar"
                onChange={(checked) => handleUpdate({ panicBar: checked })}
              />
              {node.panicBar && (
                <div className="mt-1 flex flex-col gap-1">
                  <SliderControl
                    label="Bar Height"
                    max={node.height - 0.1}
                    min={0.5}
                    onChange={(v) => handleUpdate({ panicBarHeight: v })}
                    precision={2}
                    step={0.05}
                    unit="m"
                    value={Math.round(node.panicBarHeight * 100) / 100}
                  />
                </div>
              )}
            </PanelSection>
          )}

          {showSegmentsSection && (
            <PanelSection title="Segments">
              {node.segments.map((seg, i) => {
                const numCols = seg.columnRatios.length
                const colSum = seg.columnRatios.reduce((a, b) => a + b, 0)
                const normCols = seg.columnRatios.map((r) => r / colSum)
                return (
                  <div className="mb-2 flex flex-col gap-1" key={i}>
                    <div className="flex items-center justify-between pb-1">
                      <span className="font-medium text-white/80 text-xs">Segment {i + 1}</span>
                    </div>

                    <SegmentedControl
                      onChange={(t) => {
                        const updated = node.segments.map((s, idx) =>
                          idx === i ? { ...s, type: t } : s,
                        )
                        handleUpdate({ segments: updated })
                      }}
                      options={[
                        { label: 'Panel', value: 'panel' },
                        { label: 'Glass', value: 'glass' },
                        { label: 'Empty', value: 'empty' },
                      ]}
                      value={seg.type}
                    />

                    <SliderControl
                      label="Height"
                      max={95}
                      min={5}
                      onChange={(v) => setSegmentHeightRatio(i, v / 100)}
                      precision={1}
                      step={1}
                      unit="%"
                      value={Math.round(normHeights[i]! * 100 * 10) / 10}
                    />

                    <SliderControl
                      label="Columns"
                      max={8}
                      min={1}
                      onChange={(v) => {
                        const n = Math.max(1, Math.min(8, Math.round(v)))
                        const updated = node.segments.map((s, idx) =>
                          idx === i ? { ...s, columnRatios: Array(n).fill(1 / n) } : s,
                        )
                        handleUpdate({ segments: updated })
                      }}
                      precision={0}
                      step={1}
                      value={numCols}
                    />

                    {numCols > 1 && (
                      <div className="mt-1 border-border/50 border-t pt-1">
                        {normCols.map((ratio, ci) => (
                          <SliderControl
                            key={`c-${ci}`}
                            label={`C${ci + 1}`}
                            max={95}
                            min={5}
                            onChange={(v) => setSegmentColumnRatio(i, ci, v / 100)}
                            precision={1}
                            step={1}
                            unit="%"
                            value={Math.round(ratio * 100 * 10) / 10}
                          />
                        ))}
                        <SliderControl
                          label="Divider"
                          max={0.1}
                          min={0.005}
                          onChange={(v) => {
                            const updated = node.segments.map((s, idx) =>
                              idx === i ? { ...s, dividerThickness: v } : s,
                            )
                            handleUpdate({ segments: updated })
                          }}
                          precision={3}
                          step={0.005}
                          unit="m"
                          value={Math.round(seg.dividerThickness * 1000) / 1000}
                        />
                      </div>
                    )}

                    {seg.type === 'panel' && (
                      <div className="mt-1 border-border/50 border-t pt-1">
                        <SliderControl
                          label="Inset"
                          max={0.1}
                          min={0}
                          onChange={(v) => {
                            const updated = node.segments.map((s, idx) =>
                              idx === i ? { ...s, panelInset: v } : s,
                            )
                            handleUpdate({ segments: updated })
                          }}
                          precision={3}
                          step={0.005}
                          unit="m"
                          value={Math.round(seg.panelInset * 1000) / 1000}
                        />
                        <SliderControl
                          label="Depth"
                          max={0.1}
                          min={0}
                          onChange={(v) => {
                            const updated = node.segments.map((s, idx) =>
                              idx === i ? { ...s, panelDepth: v } : s,
                            )
                            handleUpdate({ segments: updated })
                          }}
                          precision={3}
                          step={0.005}
                          unit="m"
                          value={Math.round(seg.panelDepth * 1000) / 1000}
                        />
                      </div>
                    )}
                  </div>
                )
              })}

              <div className="flex gap-1.5 px-1 pt-1">
                <ActionButton
                  label="+ Add Segment"
                  onClick={() => {
                    const updated = [
                      ...node.segments,
                      {
                        type: 'panel' as const,
                        heightRatio: 1,
                        columnRatios: [1],
                        dividerThickness: 0.03,
                        panelDepth: 0.01,
                        panelInset: 0.04,
                      },
                    ]
                    handleUpdate({ segments: updated })
                  }}
                />
                {node.segments.length > 1 && (
                  <ActionButton
                    className="text-white/60 hover:text-white"
                    label="- Remove"
                    onClick={() => handleUpdate({ segments: node.segments.slice(0, -1) })}
                  />
                )}
              </div>
            </PanelSection>
          )}
        </>
      )}

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
