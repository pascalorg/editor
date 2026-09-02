'use client'

import {
  type AnyNode,
  type AnyNodeId,
  useInteractive,
  useScene,
  WindowNode,
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
  useTranslations,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Copy, FlipHorizontal2, Move, Trash2 } from 'lucide-react'
import { useCallback, useRef } from 'react'
import { OpeningDocumentationFields } from '../shared/opening-documentation-fields'

function isSameWindowValue(current: unknown, next: unknown): boolean {
  if (typeof current === 'number' && typeof next === 'number') {
    return Math.abs(current - next) < 1e-6
  }

  if (Array.isArray(current) && Array.isArray(next)) {
    return (
      current.length === next.length &&
      current.every((value, index) => isSameWindowValue(value, next[index]))
    )
  }

  return Object.is(current, next)
}

function getMaxSharedWindowRadius(width: number, height: number) {
  return Math.max(0, Math.min(width / 2, height / 2))
}

function normalizeWindowCornerRadii(
  radii: [number, number, number, number],
  width: number,
  height: number,
): [number, number, number, number] {
  const next = radii.map((radius) => Math.max(radius, 0)) as [number, number, number, number]
  const scale = Math.min(
    1,
    Math.max(width, 0) / Math.max(next[0] + next[1], 1e-6),
    Math.max(width, 0) / Math.max(next[3] + next[2], 1e-6),
    Math.max(height, 0) / Math.max(next[0] + next[3], 1e-6),
    Math.max(height, 0) / Math.max(next[1] + next[2], 1e-6),
  )

  if (scale >= 1) return next

  return next.map((radius) => radius * scale) as [number, number, number, number]
}

function isSameRadiusTuple(
  current: [number, number, number, number],
  next: [number, number, number, number],
) {
  return current.every((value, index) => Math.abs(value - (next[index] ?? 0)) < 1e-6)
}

const windowTypeOptions: Array<{ label: string; value: WindowNode['windowType'] }> = [
  { label: 'nodes.window.typeOptions.fixed', value: 'fixed' },
  { label: 'nodes.window.typeOptions.sliding', value: 'sliding' },
  { label: 'nodes.window.typeOptions.casement', value: 'casement' },
  { label: 'nodes.window.typeOptions.awning', value: 'awning' },
  { label: 'nodes.window.typeOptions.singleHung', value: 'single-hung' },
  { label: 'nodes.window.typeOptions.doubleHung', value: 'double-hung' },
  { label: 'nodes.window.typeOptions.bay', value: 'bay' },
  { label: 'nodes.window.typeOptions.bow', value: 'bow' },
  { label: 'nodes.window.typeOptions.louvered', value: 'louvered' },
]

const shapedWindowTypes = new Set<WindowNode['windowType']>([
  'fixed',
  'casement',
  'awning',
  'hopper',
  'louvered',
])

const silllessWindowTypes = new Set<WindowNode['windowType']>(['bay', 'bow'])

export default function WindowPanel() {
  const t = useTranslations()
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const deleteNode = useScene((s) => s.deleteNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)
  const previewRef = useRef<{
    id: AnyNodeId
    key: keyof WindowNode
    value: unknown
  } | null>(null)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as WindowNode | undefined) : undefined,
  )

  // Panel slider-drag fix recipe (plans/editor-node-registry.md). Without
  // it, the 15+ SliderControls in this panel would loop on drag.
  const handleUpdate = useCallback(
    (updates: Partial<WindowNode>) => {
      if (!selectedId) return
      const liveNode = useScene.getState().nodes[selectedId as AnyNodeId]
      if (liveNode?.type !== 'window') return

      const hasChange = Object.entries(updates).some(([key, value]) => {
        const currentValue = liveNode[key as keyof WindowNode]
        return !isSameWindowValue(currentValue, value)
      })
      if (!hasChange) return

      useScene.getState().updateNode(selectedId as AnyNode['id'], updates)
      const scene = useScene.getState()
      scene.dirtyNodes.add(selectedId as AnyNodeId)
      if (liveNode.parentId) scene.dirtyNodes.add(liveNode.parentId as AnyNodeId)
    },
    [selectedId],
  )

  const previewWindowUpdate = useCallback(
    <K extends keyof WindowNode>(key: K, value: WindowNode[K]) => {
      if (!selectedId) return
      const liveNode = useScene.getState().nodes[selectedId as AnyNodeId]
      if (liveNode?.type !== 'window') return

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

      if (isSameWindowValue(liveNode[key], value)) return

      ;(liveNode as WindowNode)[key] = value
      useScene.getState().dirtyNodes.add(selectedId as AnyNodeId)
    },
    [selectedId],
  )

  const commitWindowPreview = useCallback(
    <K extends keyof WindowNode>(key: K, value: WindowNode[K]) => {
      if (!selectedId) return

      const scene = useScene.getState()
      const liveNode = scene.nodes[selectedId as AnyNodeId]
      const preview = previewRef.current
      if (liveNode?.type === 'window' && preview?.id === selectedId && preview.key === key) {
        ;(liveNode as WindowNode)[key] = preview.value as WindowNode[K]
        scene.dirtyNodes.add(selectedId as AnyNodeId)
      }
      previewRef.current = null

      useScene.getState().updateNode(
        selectedId as AnyNode['id'],
        {
          [key]: value,
        } as Partial<WindowNode>,
      )
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
    const duplicate = WindowNode.parse({
      position: [...node.position] as [number, number, number],
      rotation: [...node.rotation] as [number, number, number],
      side: node.side,
      wallId: node.wallId,
      dormerId: node.dormerId,
      dormerFace: node.dormerFace,
      roofSegmentId: node.roofSegmentId,
      roofFace: node.roofFace,
      parentId: node.parentId,
      width: node.width,
      height: node.height,
      roughOpeningWidth: node.roughOpeningWidth,
      roughOpeningHeight: node.roughOpeningHeight,
      windowType: node.windowType,
      operationState: node.operationState,
      awningDirection: node.awningDirection,
      casementStyle: node.casementStyle,
      hingesSide: node.hingesSide,
      frameThickness: node.frameThickness,
      frameDepth: node.frameDepth,
      openingKind: node.openingKind,
      openingShape: node.openingShape,
      openingRadiusMode: node.openingRadiusMode ?? 'all',
      openingCornerRadii: [...(node.openingCornerRadii ?? [0.15, 0.15, 0.15, 0.15])],
      cornerRadius: node.cornerRadius,
      archHeight: node.archHeight,
      openingRevealRadius: node.openingRevealRadius,
      columnRatios: [...node.columnRatios],
      rowRatios: [...node.rowRatios],
      columnDividerThickness: node.columnDividerThickness,
      rowDividerThickness: node.rowDividerThickness,
      sill: node.sill,
      sillDepth: node.sillDepth,
      sillThickness: node.sillThickness,
      metadata: { isNew: true },
    })
    useScene.getState().createNode(duplicate, node.parentId as AnyNodeId)
    setMovingNode(duplicate)
    setSelection({ selectedIds: [] })
  }, [node, setMovingNode, setSelection])

  if (!(node && node.type === 'window' && selectedId)) return null

  const numCols = node.columnRatios.length
  const numRows = node.rowRatios.length

  const colSum = node.columnRatios.reduce((a, b) => a + b, 0)
  const rowSum = node.rowRatios.reduce((a, b) => a + b, 0)
  const normCols = node.columnRatios.map((r) => r / colSum)
  const normRows = node.rowRatios.map((r) => r / rowSum)
  const isOpening = node.openingKind === 'opening'
  const openingShape = node.openingShape ?? 'rectangle'
  const windowShape =
    openingShape === 'arch' || openingShape === 'rounded' ? openingShape : 'rectangle'
  const openingRadiusMode = node.openingRadiusMode ?? 'all'
  const openingCornerRadii = node.openingCornerRadii ?? [0.15, 0.15, 0.15, 0.15]
  const cornerRadius = node.cornerRadius ?? 0.15
  const archHeight = node.archHeight ?? 0.35
  const openingRevealRadius = node.openingRevealRadius ?? 0.025
  const maxRoundedRadius = Math.max(0.01, getMaxSharedWindowRadius(node.width, node.height))
  const displayedWindowType = node.windowType === 'hopper' ? 'awning' : (node.windowType ?? 'fixed')
  const awningDirection = node.windowType === 'hopper' ? 'down' : (node.awningDirection ?? 'up')
  const windowType = node.windowType ?? 'fixed'
  const isFixedWindow = windowType === 'fixed'
  const isTrackSashWindow =
    windowType === 'sliding' || windowType === 'single-hung' || windowType === 'double-hung'
  const isOperableSashWindow =
    windowType === 'casement' ||
    windowType === 'awning' ||
    windowType === 'hopper' ||
    windowType === 'louvered'
  const isOperableWindow = isTrackSashWindow || isOperableSashWindow
  const supportsWindowShape = shapedWindowTypes.has(node.windowType ?? 'fixed')
  const supportsGrid = isFixedWindow
  const supportsSill = !silllessWindowTypes.has(node.windowType)
  const showWindowTypeSection = !isOpening
  const showWindowShapeSection = !isOpening && supportsWindowShape
  const showOpeningShapeSection = isOpening
  const showFrameSection = !isOpening
  const showGridSection = !isOpening && supportsGrid
  const showSillSection = !isOpening && supportsSill
  const showOperationSection = !isOpening && isOperableWindow
  const showAwningDirectionSection = !isOpening && displayedWindowType === 'awning'
  const showCasementSection = !isOpening && windowType === 'casement'
  const showFlipSide = !isOpening
  const operationLabel = isTrackSashWindow
    ? windowType === 'sliding'
      ? t('nodes.window.operationLabels.slide')
      : t('nodes.window.operationLabels.raise')
    : windowType === 'casement'
      ? t('nodes.window.operationLabels.swing')
      : windowType === 'louvered'
        ? t('nodes.window.operationLabels.slats')
        : t('nodes.window.operationLabels.tilt')

  const setOperationState = (value: number) => {
    useInteractive.getState().cancelWindowAnimation(node.id)
    useInteractive.getState().removeWindowOpenState(node.id)
    handleUpdate({ operationState: Math.max(0, Math.min(1, value)) })
  }

  const getDimensionUpdates = (updates: Partial<Pick<WindowNode, 'width' | 'height'>>) => {
    const nextWidth = updates.width ?? node.width
    const nextHeight = updates.height ?? node.height
    const nextUpdates: Partial<WindowNode> = { ...updates }

    if (openingShape === 'rounded') {
      if (openingRadiusMode === 'individual') {
        const currentRadii = openingCornerRadii as [number, number, number, number]
        const nextRadii = normalizeWindowCornerRadii(
          openingCornerRadii as [number, number, number, number],
          nextWidth,
          nextHeight,
        )
        if (!isSameRadiusTuple(currentRadii, nextRadii)) {
          nextUpdates.openingCornerRadii = nextRadii
        }
      } else {
        const nextRadius = Math.min(
          Math.max(cornerRadius, 0),
          getMaxSharedWindowRadius(nextWidth, nextHeight),
        )
        if (Math.abs(nextRadius - cornerRadius) > 1e-6) {
          nextUpdates.cornerRadius = nextRadius
        }
      }
    }

    if (openingShape === 'arch') {
      const nextArchHeight = Math.min(Math.max(archHeight, 0.05), Math.max(nextHeight, 0.05))
      if (Math.abs(nextArchHeight - archHeight) > 1e-6) {
        nextUpdates.archHeight = nextArchHeight
      }
    }

    return nextUpdates
  }

  const setOpeningCornerRadius = (index: number, value: number, commit = false) => {
    const next = [...openingCornerRadii] as [number, number, number, number]
    next[index] = value
    if (commit) {
      commitWindowPreview('openingCornerRadii', next)
    } else {
      previewWindowUpdate('openingCornerRadii', next)
    }
  }

  const setColumnRatio = (index: number, newVal: number) => {
    const clamped = Math.max(0.05, Math.min(0.95, newVal))
    const neighborIdx = index < numCols - 1 ? index + 1 : index - 1
    const delta = clamped - normCols[index]!
    const neighborVal = Math.max(0.05, normCols[neighborIdx]! - delta)
    const newRatios = normCols.map((v, i) => {
      if (i === index) return clamped
      if (i === neighborIdx) return neighborVal
      return v
    })
    handleUpdate({ columnRatios: newRatios })
  }

  const setRowRatio = (index: number, newVal: number) => {
    const clamped = Math.max(0.05, Math.min(0.95, newVal))
    const neighborIdx = index < numRows - 1 ? index + 1 : index - 1
    const delta = clamped - normRows[index]!
    const neighborVal = Math.max(0.05, normRows[neighborIdx]! - delta)
    const newRatios = normRows.map((v, i) => {
      if (i === index) return clamped
      if (i === neighborIdx) return neighborVal
      return v
    })
    handleUpdate({ rowRatios: newRatios })
  }

  return (
    <PanelWrapper
      icon="/icons/window.webp"
      onClose={handleClose}
      title={node.name || t('nodes.window.fallbackTitle')}
      width={320}
    >
      <PanelSection title={t('nodes.window.type')}>
        <SegmentedControl
          onChange={(value) =>
            handleUpdate({
              openingKind: value as WindowNode['openingKind'],
              ...(value === 'opening'
                ? {
                    openingShape,
                    openingRadiusMode,
                    openingCornerRadii,
                    cornerRadius,
                    archHeight,
                    openingRevealRadius,
                  }
                : {}),
            })
          }
          options={[
            { value: 'window', label: t('nodes.window.typeOptions.window') },
            { value: 'opening', label: t('nodes.window.typeOptions.opening') },
          ]}
          value={node.openingKind ?? 'window'}
        />
      </PanelSection>

      <PanelSection title="Documentation">
        <OpeningDocumentationFields
          constructionType={node.constructionType}
          dimensionReference={node.dimensionReference}
          finishOpeningHeight={node.finishOpeningHeight}
          finishOpeningWidth={node.finishOpeningWidth}
          mark={node.mark}
          masonryOpeningHeight={node.masonryOpeningHeight}
          masonryOpeningWidth={node.masonryOpeningWidth}
          onChange={handleUpdate}
          roughOpeningHeight={node.roughOpeningHeight}
          roughOpeningWidth={node.roughOpeningWidth}
        />
      </PanelSection>

      {showWindowTypeSection && (
        <PanelSection title={t('nodes.window.windowType')}>
          <div className="grid grid-cols-2 gap-2 px-1 pt-1">
            {windowTypeOptions.map((option) => {
              const isSelected = displayedWindowType === option.value
              return (
                <button
                  className={cn(
                    'flex min-h-12 items-center rounded-lg border px-3 py-2.5 text-left text-xs transition-colors',
                    isSelected
                      ? 'border-orange-400/60 bg-orange-400/10 text-foreground'
                      : 'border-border/50 bg-[#2C2C2E] text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground',
                  )}
                  key={option.value}
                  onClick={() =>
                    handleUpdate({
                      windowType: option.value,
                      ...(option.value === 'awning' ? { awningDirection } : {}),
                      ...(!shapedWindowTypes.has(option.value)
                        ? { openingShape: 'rectangle' }
                        : {}),
                      ...(silllessWindowTypes.has(option.value) ? { sill: false } : {}),
                    })
                  }
                  type="button"
                >
                  <span className="truncate font-medium">{t(option.label)}</span>
                </button>
              )
            })}
          </div>
          {showAwningDirectionSection && (
            <div className="mt-2">
              <SegmentedControl
                onChange={(value) =>
                  handleUpdate({
                    windowType: 'awning',
                    awningDirection: value as WindowNode['awningDirection'],
                  })
                }
                options={[
                  { value: 'up', label: t('common.directions.up') },
                  { value: 'down', label: t('common.directions.down') },
                ]}
                value={awningDirection}
              />
            </div>
          )}
          {showCasementSection && (
            <div className="mt-2 space-y-2">
              <SegmentedControl
                onChange={(value) =>
                  handleUpdate({ casementStyle: value as WindowNode['casementStyle'] })
                }
                options={[
                  { value: 'single', label: t('nodes.window.casementStyleOptions.single') },
                  { value: 'french', label: t('nodes.window.casementStyleOptions.french') },
                ]}
                value={node.casementStyle ?? 'single'}
              />
              {(node.casementStyle ?? 'single') === 'single' && (
                <SegmentedControl
                  onChange={(value) =>
                    handleUpdate({ hingesSide: value as WindowNode['hingesSide'] })
                  }
                  options={[
                    { value: 'left', label: t('common.directions.left') },
                    { value: 'right', label: t('common.directions.right') },
                  ]}
                  value={node.hingesSide ?? 'left'}
                />
              )}
            </div>
          )}
          {showOperationSection && (
            <div className="mt-2">
              <SliderControl
                label={operationLabel}
                max={1}
                min={0}
                onChange={setOperationState}
                precision={2}
                restoreOnCommit={false}
                step={0.05}
                value={Math.round((node.operationState ?? 0) * 100) / 100}
              />
            </div>
          )}
        </PanelSection>
      )}

      <PanelSection title={t('common.position')}>
        <SliderControl
          label={
            <>
              X<sub className="ml-[1px] text-[11px] opacity-70">pos</sub>
            </>
          }
          onChange={(v) => handleUpdate({ position: [v, node.position[1], node.position[2]] })}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(node.position[0] * 100) / 100}
        />
        <SliderControl
          label={
            <>
              Y<sub className="ml-[1px] text-[11px] opacity-70">pos</sub>
            </>
          }
          onChange={(v) => handleUpdate({ position: [node.position[0], v, node.position[2]] })}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(node.position[1] * 100) / 100}
        />
        {showFlipSide && (
          <div className="px-1 pt-2 pb-1">
            <ActionButton
              className="w-full"
              icon={<FlipHorizontal2 className="h-4 w-4" />}
              label={t('nodes.window.flipSide')}
              onClick={handleFlip}
            />
          </div>
        )}
      </PanelSection>

      <PanelSection title={t('common.dimensions')}>
        <SliderControl
          label={t('common.width')}
          min={0}
          onChange={(v) => handleUpdate(getDimensionUpdates({ width: v }))}
          precision={2}
          restoreOnCommit={false}
          step={0.1}
          unit="m"
          value={Math.round(node.width * 100) / 100}
        />
        <SliderControl
          label={t('common.height')}
          min={0}
          onChange={(v) => handleUpdate(getDimensionUpdates({ height: v }))}
          precision={2}
          restoreOnCommit={false}
          step={0.1}
          unit="m"
          value={Math.round(node.height * 100) / 100}
        />
      </PanelSection>

      {showWindowShapeSection && (
        <PanelSection title={t('nodes.window.topShape')}>
          <SegmentedControl
            onChange={(value) =>
              handleUpdate({
                openingShape: value as WindowNode['openingShape'],
                ...(value === 'rounded'
                  ? {
                      openingRadiusMode,
                      openingCornerRadii,
                      cornerRadius: Math.min(cornerRadius, maxRoundedRadius),
                      openingRevealRadius,
                      sill: false,
                    }
                  : {}),
                ...(value === 'arch' ? { archHeight } : {}),
              })
            }
            options={[
              { value: 'rectangle', label: t('nodes.window.topShapeOptions.rect') },
              { value: 'rounded', label: t('nodes.window.topShapeOptions.rounded') },
              { value: 'arch', label: t('nodes.window.topShapeOptions.arch') },
            ]}
            value={windowShape}
          />
          {windowShape === 'rounded' && (
            <div className="mt-2 flex flex-col gap-1">
              <SegmentedControl
                onChange={(value) =>
                  handleUpdate({ openingRadiusMode: value as WindowNode['openingRadiusMode'] })
                }
                options={[
                  { value: 'all', label: t('nodes.window.radiusModeOptions.all') },
                  { value: 'individual', label: t('nodes.window.radiusModeOptions.individual') },
                ]}
                value={openingRadiusMode}
              />
              {openingRadiusMode === 'all' ? (
                <SliderControl
                  label={t('nodes.window.cornerRadius')}
                  max={maxRoundedRadius}
                  min={0}
                  onChange={(value) => previewWindowUpdate('cornerRadius', value)}
                  onCommit={(value) => commitWindowPreview('cornerRadius', value)}
                  precision={2}
                  step={0.05}
                  unit="m"
                  value={Math.round(cornerRadius * 100) / 100}
                />
              ) : (
                <>
                  {[
                    [t('common.corners.topLeft'), 0],
                    [t('common.corners.topRight'), 1],
                    [t('common.corners.bottomRight'), 2],
                    [t('common.corners.bottomLeft'), 3],
                  ].map(([label, index]) => (
                    <SliderControl
                      key={label}
                      label={label}
                      max={maxRoundedRadius}
                      min={0}
                      onChange={(value) => setOpeningCornerRadius(index as number, value)}
                      onCommit={(value) => setOpeningCornerRadius(index as number, value, true)}
                      precision={2}
                      step={0.05}
                      unit="m"
                      value={Math.round((openingCornerRadii[index as number] ?? 0) * 100) / 100}
                    />
                  ))}
                </>
              )}
              <SliderControl
                label={t('nodes.window.revealRadius')}
                max={0.08}
                min={0}
                onChange={(value) => previewWindowUpdate('openingRevealRadius', value)}
                onCommit={(value) => commitWindowPreview('openingRevealRadius', value)}
                precision={3}
                step={0.005}
                unit="m"
                value={Math.round(openingRevealRadius * 1000) / 1000}
              />
            </div>
          )}
          {windowShape === 'arch' && (
            <div className="mt-2 flex flex-col gap-1">
              <SliderControl
                label={t('nodes.window.archHeight')}
                max={Math.max(0.05, node.height)}
                min={0.05}
                onChange={(value) => handleUpdate({ archHeight: value })}
                precision={2}
                restoreOnCommit={false}
                step={0.05}
                unit="m"
                value={Math.round(archHeight * 100) / 100}
              />
            </div>
          )}
        </PanelSection>
      )}

      {showOpeningShapeSection && (
        <PanelSection title={t('nodes.window.openingShape')}>
          <SegmentedControl
            onChange={(value) =>
              handleUpdate({ openingShape: value as WindowNode['openingShape'] })
            }
            options={[
              { value: 'rectangle', label: t('nodes.window.openingShapeOptions.rect') },
              { value: 'rounded', label: t('nodes.window.openingShapeOptions.rounded') },
              { value: 'arch', label: t('nodes.window.openingShapeOptions.arch') },
            ]}
            value={openingShape}
          />
          {openingShape === 'rounded' && (
            <div className="mt-2 flex flex-col gap-1">
              <SegmentedControl
                onChange={(value) =>
                  handleUpdate({ openingRadiusMode: value as WindowNode['openingRadiusMode'] })
                }
                options={[
                  { value: 'all', label: t('nodes.window.radiusModeOptions.all') },
                  { value: 'individual', label: t('nodes.window.radiusModeOptions.individual') },
                ]}
                value={openingRadiusMode}
              />
              {openingRadiusMode === 'all' ? (
                <SliderControl
                  label={t('nodes.window.cornerRadius')}
                  max={maxRoundedRadius}
                  min={0}
                  onChange={(value) => previewWindowUpdate('cornerRadius', value)}
                  onCommit={(value) => commitWindowPreview('cornerRadius', value)}
                  precision={2}
                  step={0.05}
                  unit="m"
                  value={Math.round(cornerRadius * 100) / 100}
                />
              ) : (
                <>
                  {[
                    [t('common.corners.topLeft'), 0],
                    [t('common.corners.topRight'), 1],
                    [t('common.corners.bottomRight'), 2],
                    [t('common.corners.bottomLeft'), 3],
                  ].map(([label, index]) => (
                    <SliderControl
                      key={label}
                      label={label}
                      max={maxRoundedRadius}
                      min={0}
                      onChange={(value) => setOpeningCornerRadius(index as number, value)}
                      onCommit={(value) => setOpeningCornerRadius(index as number, value, true)}
                      precision={2}
                      step={0.05}
                      unit="m"
                      value={Math.round((openingCornerRadii[index as number] ?? 0) * 100) / 100}
                    />
                  ))}
                </>
              )}
              <SliderControl
                label={t('nodes.window.revealRadius')}
                max={0.08}
                min={0}
                onChange={(value) => previewWindowUpdate('openingRevealRadius', value)}
                onCommit={(value) => commitWindowPreview('openingRevealRadius', value)}
                precision={3}
                step={0.005}
                unit="m"
                value={Math.round(openingRevealRadius * 1000) / 1000}
              />
            </div>
          )}
          {openingShape === 'arch' && (
            <div className="mt-2 flex flex-col gap-1">
              <SliderControl
                label={t('nodes.window.archHeight')}
                max={Math.max(0.05, node.height)}
                min={0.05}
                onChange={(value) => handleUpdate({ archHeight: value })}
                precision={2}
                restoreOnCommit={false}
                step={0.05}
                unit="m"
                value={Math.round(archHeight * 100) / 100}
              />
            </div>
          )}
        </PanelSection>
      )}

      {!isOpening && (
        <>
          {showFrameSection && (
            <PanelSection title={t('nodes.window.frame')}>
              <SliderControl
                label={t('nodes.window.thickness')}
                min={0}
                onChange={(v) => handleUpdate({ frameThickness: v })}
                precision={3}
                step={0.01}
                unit="m"
                value={Math.round(node.frameThickness * 1000) / 1000}
              />
              <SliderControl
                label={t('nodes.window.depth')}
                min={0}
                onChange={(v) => handleUpdate({ frameDepth: v })}
                precision={3}
                step={0.01}
                unit="m"
                value={Math.round(node.frameDepth * 1000) / 1000}
              />
            </PanelSection>
          )}

          {showGridSection && (
            <PanelSection title={t('nodes.window.grid')}>
              <SliderControl
                label={t('nodes.window.columns')}
                max={8}
                min={1}
                onChange={(v) => {
                  const n = Math.max(1, Math.min(8, Math.round(v)))
                  handleUpdate({ columnRatios: Array(n).fill(1 / n) })
                }}
                precision={0}
                step={1}
                value={numCols}
              />
              <SliderControl
                label={t('nodes.window.rows')}
                max={8}
                min={1}
                onChange={(v) => {
                  const n = Math.max(1, Math.min(8, Math.round(v)))
                  handleUpdate({ rowRatios: Array(n).fill(1 / n) })
                }}
                precision={0}
                step={1}
                value={numRows}
              />

              {numCols > 1 && (
                <div className="mt-2 flex flex-col gap-1">
                  <div className="mb-1 px-1 font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                    {t('nodes.window.colWidths')}
                  </div>
                  {normCols.map((ratio, i) => (
                    <SliderControl
                      key={`c-${i}`}
                      label={`C${i + 1}`}
                      max={95}
                      min={5}
                      onChange={(v) => setColumnRatio(i, v / 100)}
                      precision={1}
                      step={1}
                      unit="%"
                      value={Math.round(ratio * 100 * 10) / 10}
                    />
                  ))}
                  <div className="mt-1 border-border/50 border-t pt-1">
                    <SliderControl
                      label={t('nodes.window.divider')}
                      max={0.1}
                      min={0.005}
                      onChange={(v) => handleUpdate({ columnDividerThickness: v })}
                      precision={3}
                      step={0.01}
                      unit="m"
                      value={Math.round((node.columnDividerThickness ?? 0.03) * 1000) / 1000}
                    />
                  </div>
                </div>
              )}

              {numRows > 1 && (
                <div className="mt-2 flex flex-col gap-1">
                  <div className="mb-1 px-1 font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                    {t('nodes.window.rowHeights')}
                  </div>
                  {normRows.map((ratio, i) => (
                    <SliderControl
                      key={`r-${i}`}
                      label={`R${i + 1}`}
                      max={95}
                      min={5}
                      onChange={(v) => setRowRatio(i, v / 100)}
                      precision={1}
                      step={1}
                      unit="%"
                      value={Math.round(ratio * 100 * 10) / 10}
                    />
                  ))}
                  <div className="mt-1 border-border/50 border-t pt-1">
                    <SliderControl
                      label={t('nodes.window.divider')}
                      max={0.1}
                      min={0.005}
                      onChange={(v) => handleUpdate({ rowDividerThickness: v })}
                      precision={3}
                      step={0.01}
                      unit="m"
                      value={Math.round((node.rowDividerThickness ?? 0.03) * 1000) / 1000}
                    />
                  </div>
                </div>
              )}
            </PanelSection>
          )}

          {showSillSection && (
            <PanelSection title={t('nodes.window.sill')}>
              <ToggleControl
                checked={node.sill}
                label={t('nodes.window.enableSill')}
                onChange={(checked) => handleUpdate({ sill: checked })}
              />
              {node.sill && (
                <div className="mt-1 flex flex-col gap-1">
                  <SliderControl
                    label={t('nodes.window.sillDepth')}
                    min={0}
                    onChange={(v) => handleUpdate({ sillDepth: v })}
                    precision={3}
                    step={0.01}
                    unit="m"
                    value={Math.round(node.sillDepth * 1000) / 1000}
                  />
                  <SliderControl
                    label={t('nodes.window.sillThickness')}
                    min={0}
                    onChange={(v) => handleUpdate({ sillThickness: v })}
                    precision={3}
                    step={0.01}
                    unit="m"
                    value={Math.round(node.sillThickness * 1000) / 1000}
                  />
                </div>
              )}
            </PanelSection>
          )}
        </>
      )}

      <PanelSection title={t('common.actions')}>
        <ActionGroup>
          <ActionButton icon={<Move className="h-3.5 w-3.5" />} label={t('common.move')} onClick={handleMove} />
          <ActionButton
            icon={<Copy className="h-3.5 w-3.5" />}
            label={t('common.duplicate')}
            onClick={handleDuplicate}
          />
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            label={t('common.delete')}
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
