'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type DoorNode,
  isAutoFrameDepth,
  type MessageDescriptor,
  resolveHostedOpeningFrameDepth,
  scriptImages,
  useInteractive,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import { DOOR_STYLES, doorStyleLook, doorStylesOf, doorTypeChange } from '@pascal-app/core/building'
import {
  ActionButton,
  ActionGroup,
  cn,
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
import { Copy, DoorOpen, FlipHorizontal2, Move, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo } from 'react'
import { AuthoredParams } from '../item/authored-params'
import { constrainCurtainOpening, curtainOpeningLimits } from '../shared/curtain-opening-limits'
import { OpeningCasingSection } from '../shared/opening-casing-section'
import { DOOR_STYLE_MESSAGES } from '../shared/opening-labels'
import { createOpeningPropertyPreview } from '../shared/opening-property-preview'
import { openingPropertyPreviewHost } from '../shared/opening-property-preview-host'
import { scaleHandleHeight } from './door-math'
import { doorTypeOptions } from './placement'

/** The type cards' names; `doorTypeOptions` keeps English for the placement chips. */
const DOOR_TYPE_LABELS: Record<DoorNode['doorType'], MessageDescriptor> = {
  hinged: /* i18n */ { id: 'node.door.type.hinged', message: 'Hinged' },
  double: /* i18n */ { id: 'node.door.type.double', message: 'Double' },
  french: /* i18n */ { id: 'node.door.type.french', message: 'French' },
  folding: /* i18n */ { id: 'node.door.type.folding', message: 'Folding' },
  pocket: /* i18n */ { id: 'node.door.type.pocket', message: 'Pocket' },
  barn: /* i18n */ { id: 'node.door.type.barn', message: 'Barn' },
  sliding: /* i18n */ { id: 'node.door.type.sliding', message: 'Sliding' },
  'garage-sectional': /* i18n */ { id: 'node.door.type.garageSectional', message: 'Sectional' },
  'garage-rollup': /* i18n */ { id: 'node.door.type.garageRollup', message: 'Roll-up' },
  'garage-tiltup': /* i18n */ { id: 'node.door.type.garageTiltup', message: 'Tilt-up' },
}

const garageDoorTypeOptions = [
  {
    value: 'garage-sectional',
    available: true,
  },
  {
    value: 'garage-rollup',
    available: true,
  },
  {
    value: 'garage-tiltup',
    available: true,
  },
] satisfies {
  value: DoorNode['doorType']
  available: boolean
}[]

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
  const i18n = usePascalI18n()
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const preview = useMemo(
    () =>
      selectedId
        ? createOpeningPropertyPreview<DoorNode>(
            selectedId as AnyNodeId,
            openingPropertyPreviewHost,
          )
        : null,
    [selectedId],
  )
  useEffect(() => () => preview?.cancel(), [preview])

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as DoorNode | undefined) : undefined,
  )
  // The depth the frame renders at: explicit, or the host wall's thickness plus the lip.
  const frameDepth = useScene((s) => (node ? resolveHostedOpeningFrameDepth(node, s.nodes) : 0))
  // Stable handler refs ("Custom panels" in wiki/architecture/node-definitions.md).
  // Without them, the 29+ SliderControls in this panel would loop on drag.
  const handleUpdate = useCallback(
    (updates: Partial<DoorNode>) => {
      if (!selectedId) return
      const liveNode = useScene.getState().nodes[selectedId as AnyNodeId]
      if (liveNode?.type !== 'door') return

      updates = constrainCurtainOpening(liveNode, updates, useScene.getState().nodes)
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

  const previewDoorUpdate = <K extends keyof DoorNode>(key: K, value: DoorNode[K]) =>
    preview?.preview({ [key]: value } as Partial<DoorNode>)
  const commitDoorPreview = <K extends keyof DoorNode>(key: K, value: DoorNode[K]) =>
    preview?.commit({ [key]: value } as Partial<DoorNode>)

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
    if (node) duplicateNodeAndPickUp(node)
  }, [node])

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

  const limits = curtainOpeningLimits(node, useScene.getState().nodes)
  // The sill stays where it stands (a garage's slab, the house's floor); the head moves.
  const heightUpdates = (height: number): Partial<DoorNode> => ({
    height,
    position: [node.position[0], node.position[1] - node.height / 2 + height / 2, node.position[2]],
    handleHeight: scaleHandleHeight(node.handleHeight, node.height, height),
  })
  const hSum = node.segments.reduce((s, seg) => s + seg.heightRatio, 0)
  const normHeights = node.segments.map((seg) => seg.heightRatio / hSum)
  const isOpening = node.openingKind === 'opening'
  // Built from a script: its params replace the parametric leaf's fields, as on an authored item.
  const scripted = Boolean(node.source)
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
  const doorStyles = doorStylesOf(node)
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
  const showFoldSection = !scripted && isFoldingDoor && !isCutoutOnly
  const showSlideSection = !scripted && isSlidingDoor && !isCutoutOnly
  const showGarageSection =
    !scripted &&
    (isSectionalGarageDoor || isRollupGarageDoor || isTiltupGarageDoor) &&
    !isCutoutOnly
  const showOpeningShapeSection = !scripted && isCutoutOnly
  const showDoorShapeSection = !scripted && !isCutoutOnly && supportsTopShape
  const showFrameSection = !scripted && !isCutoutOnly
  const showContentPaddingSection = !scripted && !isCutoutOnly && !isGarageDoor
  const showSwingSection = !scripted && isSwingDoor
  const showThresholdSection = !scripted && isSwingDoor
  const showHandleSection = !scripted && isSwingDoor
  const showHardwareSection = !scripted && isSwingDoor
  const showSegmentsSection = !scripted && !isCutoutOnly && !isGarageDoor
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

  const getDoorTypeUpdates = (nextDoorType: DoorNode['doorType']): Partial<DoorNode> =>
    doorTypeChange(node, nextDoorType)

  return (
    <PanelWrapper
      icon={scriptImages(node)?.thumbnail ?? '/icons/door.webp'}
      onClose={handleClose}
      title={node.name || i18n._({ id: 'node.door.panel.door', message: 'Door' })}
      width={320}
    >
      {!scripted && (
        <PanelSection title={i18n._({ id: 'node.door.panel.type', message: 'Type' })}>
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
                { label: i18n._({ id: 'node.door.panel.door', message: 'Door' }), value: 'door' },
                {
                  label: i18n._({ id: 'node.door.panel.opening', message: 'Opening' }),
                  value: 'opening',
                },
                {
                  label: i18n._({ id: 'node.door.panel.garage', message: 'Garage' }),
                  value: 'garage',
                },
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
                        : 'border-border/50 bg-black/4 dark:bg-[#2C2C2E] text-muted-foreground hover:bg-black/8 dark:hover:bg-[#3e3e3e] hover:text-foreground',
                      !option.available &&
                        'cursor-not-allowed opacity-45 hover:bg-black/4 dark:hover:bg-[#2C2C2E] hover:text-muted-foreground',
                    )}
                    disabled={!option.available}
                    key={option.value}
                    onClick={() => handleUpdate(getDoorTypeUpdates(option.value))}
                    type="button"
                  >
                    <DoorOpen className="h-4 w-4 shrink-0" />
                    <span className="truncate font-medium">
                      {i18n._(DOOR_TYPE_LABELS[option.value])}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </PanelSection>
      )}

      {!scripted && !isOpening && !isGarageDoor && (
        <PanelSection title={i18n._({ id: 'node.door.panel.style', message: 'Style' })}>
          <div className="grid grid-cols-2 gap-2 px-1 pt-1">
            {DOOR_STYLES.map((style) => (
              <button
                aria-pressed={doorStyles.includes(style)}
                className={cn(
                  'flex min-h-10 items-center rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                  doorStyles.includes(style)
                    ? 'border-orange-400/60 bg-orange-400/10 text-foreground'
                    : 'border-border/50 bg-black/4 dark:bg-[#2C2C2E] text-muted-foreground hover:bg-black/8 dark:hover:bg-[#3e3e3e] hover:text-foreground',
                )}
                key={style}
                onClick={() => handleUpdate(doorStyleLook(style))}
                type="button"
              >
                <span className="truncate font-medium">{i18n._(DOOR_STYLE_MESSAGES[style])}</span>
              </button>
            ))}
          </div>
          {!doorStyles.length && (
            <p className="px-1 pt-2 text-muted-foreground text-xs">
              {i18n._({
                id: 'node.door.panel.customTheSegmentsMatchNoStyle',
                message: 'Custom: the segments match no style.',
              })}
            </p>
          )}
        </PanelSection>
      )}

      <PanelSection title={i18n._({ id: 'node.door.panel.position', message: 'Position' })}>
        <SliderControl
          label={
            <>
              X
              <sub className="ml-[1px] text-[11px] opacity-70">
                {i18n._({ id: 'node.door.panel.wall', message: 'wall' })}
              </sub>
            </>
          }
          max={10}
          min={-10}
          onChange={(v) => handleUpdate({ position: [v, node.position[1], node.position[2]] })}
          precision={2}
          step={0.1}
          unit="m"
          value={node.position[0]}
        />
        {showFlipSide && (
          <div className="px-1 pt-2 pb-1">
            <ActionButton
              className="w-full"
              icon={<FlipHorizontal2 className="h-4 w-4" />}
              label={i18n._({ id: 'node.door.panel.flipSide', message: 'Flip Side' })}
              onClick={handleFlip}
            />
          </div>
        )}
      </PanelSection>

      {showFoldSection && (
        <PanelSection title={i18n._({ id: 'node.door.panel.fold', message: 'Fold' })}>
          <div className="flex flex-col gap-2 px-1 pb-1">
            <div className="space-y-1">
              <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                {i18n._({ id: 'node.door.panel.panels', message: 'Panels' })}
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
            label={i18n._({ id: 'node.door.panel.open', message: 'Open' })}
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
        <PanelSection title={i18n._({ id: 'node.door.panel.slide', message: 'Slide' })}>
          <div className="flex flex-col gap-2 px-1 pb-1">
            <div className="space-y-1">
              <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                {doorType === 'pocket'
                  ? i18n._({ id: 'node.door.panel.pocket', message: 'Pocket' })
                  : doorType === 'barn'
                    ? i18n._({ id: 'node.door.panel.rail', message: 'Rail' })
                    : i18n._({ id: 'node.door.panel.panel', message: 'Panel' })}
              </span>
              <SegmentedControl
                onChange={(v) => handleUpdate({ slideDirection: v })}
                options={[
                  { label: i18n._({ id: 'node.door.panel.left', message: 'Left' }), value: 'left' },
                  {
                    label: i18n._({ id: 'node.door.panel.right', message: 'Right' }),
                    value: 'right',
                  },
                ]}
                value={node.slideDirection ?? 'left'}
              />
            </div>
          </div>
          <SliderControl
            label={i18n._({ id: 'node.door.panel.open', message: 'Open' })}
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
        <PanelSection title={i18n._({ id: 'node.door.panel.garage', message: 'Garage' })}>
          <SliderControl
            label={i18n._({ id: 'node.door.panel.open', message: 'Open' })}
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
              label={i18n._({ id: 'node.door.panel.panels', message: 'Panels' })}
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

      {scripted && <AuthoredParams node={node} />}

      {!scripted && (
        <PanelSection title={i18n._({ id: 'node.door.panel.dimensions', message: 'Dimensions' })}>
          {limits && (
            <p className="text-[11px] text-muted-foreground">
              {i18n._({
                id: 'node.door.panel.sizeIsLimitedToTheWall',
                message: 'Size is limited to the wall, including clearance for the opening frame.',
              })}
            </p>
          )}
          <SliderControl
            label={i18n._({ id: 'node.door.panel.width', message: 'Width' })}
            max={Math.min(maxDoorWidth, limits?.width ?? Infinity)}
            min={Math.min(0.5, limits?.width ?? 0.5)}
            onChange={(v) => previewDoorUpdate('width', v)}
            onCommit={(v) => commitDoorPreview('width', v)}
            onCancel={() => preview?.cancel()}
            previewWhileTyping
            precision={2}
            restoreOnCommit={false}
            step={0.01}
            unit="m"
            value={node.width}
          />
          <SliderControl
            label={i18n._({ id: 'node.door.panel.height', message: 'Height' })}
            max={limits?.height ?? 1000}
            min={Math.min(1, limits?.height ?? 1)}
            onChange={(v) => preview?.preview(heightUpdates(v))}
            onCommit={(v) => preview?.commit(heightUpdates(v))}
            onCancel={() => preview?.cancel()}
            previewWhileTyping
            precision={2}
            restoreOnCommit={false}
            step={0.01}
            unit="m"
            value={node.height}
          />
        </PanelSection>
      )}

      {showDoorShapeSection && (
        <PanelSection title={i18n._({ id: 'node.door.panel.topShape', message: 'Top Shape' })}>
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
                {
                  label: i18n._({ id: 'node.door.panel.rect', message: 'Rect' }),
                  value: 'rectangle',
                },
                {
                  label: i18n._({ id: 'node.door.panel.rounded', message: 'Rounded' }),
                  value: 'rounded',
                },
                { label: i18n._({ id: 'node.door.panel.arch', message: 'Arch' }), value: 'arch' },
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
                    { label: i18n._({ id: 'node.door.panel.all', message: 'All' }), value: 'all' },
                    {
                      label: i18n._({ id: 'node.door.panel.individual', message: 'Individual' }),
                      value: 'individual',
                    },
                  ]}
                  value={openingRadiusMode}
                />
              </div>
              {openingRadiusMode === 'all' ? (
                <SliderControl
                  label={i18n._({ id: 'node.door.panel.cornerRadius', message: 'Corner Radius' })}
                  max={maxRoundedRadius}
                  min={0}
                  onChange={(v) => previewDoorUpdate('cornerRadius', v)}
                  onCommit={(v) => commitDoorPreview('cornerRadius', v)}
                  onCancel={() => preview?.cancel()}
                  previewWhileTyping
                  restoreOnCommit={false}
                  precision={2}
                  step={0.05}
                  unit="m"
                  value={cornerRadius}
                />
              ) : (
                <>
                  {[
                    [i18n._({ id: 'node.cornerRadius.topLeft', message: 'Top Left' }), 0],
                    [i18n._({ id: 'node.cornerRadius.topRight', message: 'Top Right' }), 1],
                  ].map(([label, index]) => (
                    <SliderControl
                      key={label}
                      label={label}
                      max={maxRoundedRadius}
                      min={0}
                      onChange={(v) => setOpeningTopRadius(index as number, v)}
                      onCommit={(v) => setOpeningTopRadius(index as number, v, true)}
                      onCancel={() => preview?.cancel()}
                      previewWhileTyping
                      restoreOnCommit={false}
                      precision={2}
                      step={0.05}
                      unit="m"
                      value={openingTopRadii[index as number] ?? 0}
                    />
                  ))}
                </>
              )}
              <SliderControl
                label={i18n._({ id: 'node.door.panel.revealRadius', message: 'Reveal Radius' })}
                max={0.08}
                min={0}
                onChange={(v) => previewDoorUpdate('openingRevealRadius', v)}
                onCommit={(v) => commitDoorPreview('openingRevealRadius', v)}
                onCancel={() => preview?.cancel()}
                previewWhileTyping
                restoreOnCommit={false}
                precision={3}
                step={0.005}
                unit="m"
                value={openingRevealRadius}
              />
            </>
          )}
          {doorShape === 'arch' && (
            <SliderControl
              label={i18n._({ id: 'node.door.panel.archHeight', message: 'Arch Height' })}
              max={node.height}
              min={0.05}
              onChange={(v) => previewDoorUpdate('archHeight', v)}
              onCommit={(v) => commitDoorPreview('archHeight', v)}
              onCancel={() => preview?.cancel()}
              previewWhileTyping
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit="m"
              value={archHeight}
            />
          )}
        </PanelSection>
      )}

      {showOpeningShapeSection && (
        <PanelSection
          title={i18n._({ id: 'node.door.panel.openingShape', message: 'Opening Shape' })}
        >
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
                {
                  label: i18n._({ id: 'node.door.panel.rect', message: 'Rect' }),
                  value: 'rectangle',
                },
                {
                  label: i18n._({ id: 'node.door.panel.rounded', message: 'Rounded' }),
                  value: 'rounded',
                },
                { label: i18n._({ id: 'node.door.panel.arch', message: 'Arch' }), value: 'arch' },
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
                    { label: i18n._({ id: 'node.door.panel.all', message: 'All' }), value: 'all' },
                    {
                      label: i18n._({ id: 'node.door.panel.individual', message: 'Individual' }),
                      value: 'individual',
                    },
                  ]}
                  value={openingRadiusMode}
                />
              </div>
              {openingRadiusMode === 'all' ? (
                <SliderControl
                  label={i18n._({ id: 'node.door.panel.cornerRadius', message: 'Corner Radius' })}
                  max={maxRoundedRadius}
                  min={0}
                  onChange={(v) => previewDoorUpdate('cornerRadius', v)}
                  onCommit={(v) => commitDoorPreview('cornerRadius', v)}
                  onCancel={() => preview?.cancel()}
                  previewWhileTyping
                  restoreOnCommit={false}
                  precision={2}
                  step={0.05}
                  unit="m"
                  value={cornerRadius}
                />
              ) : (
                <>
                  {[
                    [i18n._({ id: 'node.cornerRadius.topLeft', message: 'Top Left' }), 0],
                    [i18n._({ id: 'node.cornerRadius.topRight', message: 'Top Right' }), 1],
                  ].map(([label, index]) => (
                    <SliderControl
                      key={label}
                      label={label}
                      max={maxRoundedRadius}
                      min={0}
                      onChange={(v) => setOpeningTopRadius(index as number, v)}
                      onCommit={(v) => setOpeningTopRadius(index as number, v, true)}
                      onCancel={() => preview?.cancel()}
                      previewWhileTyping
                      restoreOnCommit={false}
                      precision={2}
                      step={0.05}
                      unit="m"
                      value={openingTopRadii[index as number] ?? 0}
                    />
                  ))}
                </>
              )}
              <SliderControl
                label={i18n._({ id: 'node.door.panel.revealRadius', message: 'Reveal Radius' })}
                max={0.08}
                min={0}
                onChange={(v) => previewDoorUpdate('openingRevealRadius', v)}
                onCommit={(v) => commitDoorPreview('openingRevealRadius', v)}
                onCancel={() => preview?.cancel()}
                previewWhileTyping
                restoreOnCommit={false}
                precision={3}
                step={0.005}
                unit="m"
                value={openingRevealRadius}
              />
            </>
          )}
          {openingShape === 'arch' && (
            <SliderControl
              label={i18n._({ id: 'node.door.panel.archHeight', message: 'Arch Height' })}
              max={node.height}
              min={0.05}
              onChange={(v) => previewDoorUpdate('archHeight', v)}
              onCommit={(v) => commitDoorPreview('archHeight', v)}
              onCancel={() => preview?.cancel()}
              previewWhileTyping
              precision={2}
              restoreOnCommit={false}
              step={0.05}
              unit="m"
              value={archHeight}
            />
          )}
        </PanelSection>
      )}

      {!isCutoutOnly && !scripted && (
        <>
          {showFrameSection && (
            <PanelSection title={i18n._({ id: 'node.door.panel.frame', message: 'Frame' })}>
              <SliderControl
                label={i18n._({ id: 'node.door.panel.thickness', message: 'Thickness' })}
                max={0.2}
                min={0.01}
                onChange={(v) => handleUpdate({ frameThickness: v })}
                precision={3}
                step={0.01}
                unit="m"
                value={node.frameThickness}
              />
              <SliderControl
                label={
                  isAutoFrameDepth(node)
                    ? i18n._({ id: 'node.door.panel.frameDepthAuto', message: 'Depth (auto)' })
                    : i18n._({ id: 'node.door.panel.depth', message: 'Depth' })
                }
                max={0.5}
                min={0.01}
                onChange={(v) => handleUpdate({ frameDepth: v })}
                precision={3}
                step={0.01}
                unit="m"
                value={frameDepth}
              />
              {!isAutoFrameDepth(node) && (
                <div className="flex items-center justify-between px-2 text-muted-foreground text-xs">
                  <span>
                    {i18n._({
                      id: 'node.door.panel.autoFollowsTheWall',
                      message: 'Auto follows the wall',
                    })}
                  </span>
                  <button
                    className="rounded-full border border-border/50 px-2.5 py-0.5 transition-colors hover:bg-accent"
                    onClick={() => handleUpdate({ frameDepth: undefined })}
                    type="button"
                  >
                    {i18n._({ id: 'node.door.panel.auto', message: 'Auto' })}
                  </button>
                </div>
              )}
            </PanelSection>
          )}

          {showContentPaddingSection && (
            <PanelSection
              title={i18n._({ id: 'node.door.panel.contentPadding', message: 'Content Padding' })}
            >
              <SliderControl
                label={i18n._({ id: 'node.door.panel.horizontal', message: 'Horizontal' })}
                max={0.2}
                min={0}
                onChange={(v) => handleUpdate({ contentPadding: [v, node.contentPadding[1]] })}
                precision={3}
                step={0.005}
                unit="m"
                value={node.contentPadding[0]}
              />
              <SliderControl
                label={i18n._({ id: 'node.door.panel.vertical', message: 'Vertical' })}
                max={0.2}
                min={0}
                onChange={(v) => handleUpdate({ contentPadding: [node.contentPadding[0], v] })}
                precision={3}
                step={0.005}
                unit="m"
                value={node.contentPadding[1]}
              />
            </PanelSection>
          )}

          {showSwingSection && (
            <PanelSection title={i18n._({ id: 'node.door.panel.swing', message: 'Swing' })}>
              <div className="flex flex-col gap-2 px-1 pb-1">
                {supportsHingeSide && (
                  <div className="space-y-1">
                    <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                      {i18n._({ id: 'node.door.panel.hingesSide', message: 'Hinges Side' })}
                    </span>
                    <SegmentedControl
                      onChange={(v) => handleUpdate({ hingesSide: v })}
                      options={[
                        {
                          label: i18n._({ id: 'node.door.panel.left', message: 'Left' }),
                          value: 'left',
                        },
                        {
                          label: i18n._({ id: 'node.door.panel.right', message: 'Right' }),
                          value: 'right',
                        },
                      ]}
                      value={node.hingesSide}
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                    {i18n._({ id: 'node.door.panel.direction', message: 'Direction' })}
                  </span>
                  <SegmentedControl
                    onChange={(v) => handleUpdate({ swingDirection: v })}
                    options={[
                      {
                        label: i18n._({ id: 'node.door.panel.inward', message: 'Inward' }),
                        value: 'inward',
                      },
                      {
                        label: i18n._({ id: 'node.door.panel.outward', message: 'Outward' }),
                        value: 'outward',
                      },
                    ]}
                    value={node.swingDirection}
                  />
                </div>
              </div>
            </PanelSection>
          )}

          {showThresholdSection && (
            <PanelSection title={i18n._({ id: 'node.door.panel.threshold', message: 'Threshold' })}>
              <ToggleControl
                checked={node.threshold}
                label={i18n._({
                  id: 'node.door.panel.enableThreshold',
                  message: 'Enable Threshold',
                })}
                onChange={(checked) => handleUpdate({ threshold: checked })}
              />
              {node.threshold && (
                <div className="mt-1 flex flex-col gap-1">
                  <SliderControl
                    label={i18n._({ id: 'node.door.panel.height', message: 'Height' })}
                    max={0.1}
                    min={0.005}
                    onChange={(v) => handleUpdate({ thresholdHeight: v })}
                    precision={3}
                    step={0.005}
                    unit="m"
                    value={node.thresholdHeight}
                  />
                </div>
              )}
            </PanelSection>
          )}

          {showHandleSection && (
            <PanelSection title={i18n._({ id: 'node.door.panel.handle', message: 'Handle' })}>
              {isSwingDoor && (
                <ToggleControl
                  checked={node.handle}
                  label={i18n._({ id: 'node.door.panel.enableHandle', message: 'Enable Handle' })}
                  onChange={(checked) => handleUpdate({ handle: checked })}
                />
              )}
              {(node.handle || !isSwingDoor) && (
                <div className="mt-1 flex flex-col gap-1">
                  <SliderControl
                    label={i18n._({ id: 'node.door.panel.height', message: 'Height' })}
                    max={node.height - 0.1}
                    min={0.5}
                    onChange={(v) => handleUpdate({ handleHeight: v })}
                    precision={2}
                    step={0.05}
                    unit="m"
                    value={node.handleHeight}
                  />
                  {supportsHandleSide && (
                    <div className="space-y-1">
                      <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                        {i18n._({ id: 'node.door.panel.handleSide', message: 'Handle Side' })}
                      </span>
                      <SegmentedControl
                        onChange={(v) => handleUpdate({ handleSide: v })}
                        options={[
                          {
                            label: i18n._({ id: 'node.door.panel.left', message: 'Left' }),
                            value: 'left',
                          },
                          {
                            label: i18n._({ id: 'node.door.panel.right', message: 'Right' }),
                            value: 'right',
                          },
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
            <PanelSection title={i18n._({ id: 'node.door.panel.hardware', message: 'Hardware' })}>
              <ToggleControl
                checked={node.doorCloser}
                label={i18n._({ id: 'node.door.panel.doorCloser', message: 'Door Closer' })}
                onChange={(checked) => handleUpdate({ doorCloser: checked })}
              />
              <ToggleControl
                checked={node.panicBar}
                label={i18n._({ id: 'node.door.panel.panicBar', message: 'Panic Bar' })}
                onChange={(checked) => handleUpdate({ panicBar: checked })}
              />
              {node.panicBar && (
                <div className="mt-1 flex flex-col gap-1">
                  <SliderControl
                    label={i18n._({ id: 'node.door.panel.barHeight', message: 'Bar Height' })}
                    max={node.height - 0.1}
                    min={0.5}
                    onChange={(v) => handleUpdate({ panicBarHeight: v })}
                    precision={2}
                    step={0.05}
                    unit="m"
                    value={node.panicBarHeight}
                  />
                </div>
              )}
            </PanelSection>
          )}

          {showSegmentsSection && (
            <PanelSection title={i18n._({ id: 'node.door.panel.segments', message: 'Segments' })}>
              {node.segments.map((seg, i) => {
                const numCols = seg.columnRatios.length
                const colSum = seg.columnRatios.reduce((a, b) => a + b, 0)
                const normCols = seg.columnRatios.map((r) => r / colSum)
                return (
                  <div className="mb-2 flex flex-col gap-1" key={i}>
                    <div className="flex items-center justify-between pb-1">
                      <span className="font-medium text-foreground/80 dark:text-white/80 text-xs">
                        {i18n._({
                          id: 'node.segmentNumber',
                          message: 'Segment {number}',
                          values: { number: i + 1 },
                        })}
                      </span>
                    </div>

                    <SegmentedControl
                      onChange={(t) => {
                        const updated = node.segments.map((s, idx) =>
                          idx === i ? { ...s, type: t } : s,
                        )
                        handleUpdate({ segments: updated })
                      }}
                      options={[
                        {
                          label: i18n._({ id: 'node.door.panel.panel', message: 'Panel' }),
                          value: 'panel',
                        },
                        {
                          label: i18n._({ id: 'node.door.panel.glass', message: 'Glass' }),
                          value: 'glass',
                        },
                        {
                          label: i18n._({ id: 'node.door.panel.empty', message: 'Empty' }),
                          value: 'empty',
                        },
                      ]}
                      value={seg.type}
                    />

                    <SliderControl
                      label={i18n._({ id: 'node.door.panel.height', message: 'Height' })}
                      max={95}
                      min={5}
                      onChange={(v) => setSegmentHeightRatio(i, v / 100)}
                      precision={1}
                      step={1}
                      unit="%"
                      value={Math.round(normHeights[i]! * 100 * 10) / 10}
                    />

                    <SliderControl
                      label={i18n._({ id: 'node.door.panel.columns', message: 'Columns' })}
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
                          label={i18n._({ id: 'node.door.panel.divider', message: 'Divider' })}
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
                          value={seg.dividerThickness}
                        />
                      </div>
                    )}

                    {seg.type === 'panel' && (
                      <div className="mt-1 border-border/50 border-t pt-1">
                        <SliderControl
                          label={i18n._({ id: 'node.door.panel.inset', message: 'Inset' })}
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
                          value={seg.panelInset}
                        />
                        <SliderControl
                          label={i18n._({ id: 'node.door.panel.depth', message: 'Depth' })}
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
                          value={seg.panelDepth}
                        />
                      </div>
                    )}
                  </div>
                )
              })}

              <div className="flex gap-1.5 px-1 pt-1">
                <ActionButton
                  label={i18n._({ id: 'node.door.panel.addSegment', message: '+ Add Segment' })}
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
                    className="text-foreground/60 hover:text-foreground dark:text-white/60 dark:hover:text-white"
                    label={i18n._({ id: 'node.door.panel.remove', message: '- Remove' })}
                    onClick={() => handleUpdate({ segments: node.segments.slice(0, -1) })}
                  />
                )}
              </div>
            </PanelSection>
          )}
        </>
      )}

      <OpeningCasingSection node={node} onUpdate={handleUpdate} />

      <PanelSection title={i18n._({ id: 'node.door.panel.actions', message: 'Actions' })}>
        <ActionGroup>
          <ActionButton
            icon={<Move className="h-3.5 w-3.5" />}
            label={i18n._({ id: 'node.door.panel.move', message: 'Move' })}
            onClick={handleMove}
          />
          <ActionButton
            icon={<Copy className="h-3.5 w-3.5" />}
            label={i18n._({ id: 'node.door.panel.duplicate', message: 'Duplicate' })}
            onClick={handleDuplicate}
          />
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />}
            label={i18n._({ id: 'node.door.panel.delete', message: 'Delete' })}
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
