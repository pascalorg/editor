'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type AttachmentSide,
  DEFAULT_LEVEL_HEIGHT,
  type MessageDescriptor,
  planStairFlightHeightEdit,
  resolveStairTotalRise,
  type StairSegmentNode,
  type StairSegmentType,
  stairSegmentConstructionError,
  stairSegmentDetailError,
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
import { Copy, Move, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { StairConstructionControls } from '../stair/construction-controls'

const SEGMENT_TYPE_OPTIONS: { label: MessageDescriptor; value: StairSegmentType }[] = [
  { label: /* i18n */ { id: 'node.stairSegment.panel.flight', message: 'Flight' }, value: 'stair' },
  {
    label: /* i18n */ { id: 'node.stairSegment.panel.landing', message: 'Landing' },
    value: 'landing',
  },
]

const ATTACHMENT_SIDE_OPTIONS: { label: MessageDescriptor; value: AttachmentSide }[] = [
  { label: /* i18n */ { id: 'node.stairSegment.panel.front', message: 'Front' }, value: 'front' },
  { label: /* i18n */ { id: 'node.stairSegment.panel.left', message: 'Left' }, value: 'left' },
  { label: /* i18n */ { id: 'node.stairSegment.panel.right', message: 'Right' }, value: 'right' },
]

export default function StairSegmentPanel() {
  const i18n = usePascalI18n()
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as StairSegmentNode | undefined) : undefined,
  )

  const parentStair = useScene((state) => {
    const parent = node?.parentId ? state.nodes[node.parentId as AnyNodeId] : undefined
    return parent?.type === 'stair' ? parent : undefined
  })

  const parentConstruction = parentStair?.construction

  // Boolean selector — re-renders only when this segment's position among the
  // parent stair's children flips to/from "first".
  const isFirstSegment = useScene((s) => {
    if (!node?.parentId) return true
    const parent = s.nodes[node.parentId as AnyNodeId]
    if (parent?.type !== 'stair') return true
    const children = (parent as any).children ?? []
    return children[0] === node.id
  })

  const handleUpdate = useCallback(
    (updates: Partial<StairSegmentNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  // A follows-level stair would hand the edited height straight back to
  // `syncStairRises`, so a flight edit also pins the parent to the new total:
  // the stair becomes Custom rise, exactly as editing Rise on its own panel.
  const parentFollowsLevel = useScene((s) => {
    const parent = node?.parentId ? s.nodes[node.parentId as AnyNodeId] : undefined
    return parent?.type === 'stair' && parent.totalRise == null
  })
  const handleFlightHeightChange = useCallback(
    (height: number) => {
      if (!node) return
      const scene = useScene.getState()
      const current = scene.nodes[node.id]
      if (current?.type !== 'stair-segment') return
      scene.updateNodes(planStairFlightHeightEdit(current, height, scene.nodes))
    },
    [node],
  )

  // Turning a landing back into a flight seeds the rise the parent stair
  // resolves — a fixed 2.5 m stops halfway up a tall storey, and for a
  // follows-mode stair it is what `syncStairRises` would converge to anyway.
  const resolveParentStairRise = useCallback(() => {
    const sceneNodes = useScene.getState().nodes
    const parent = node?.parentId ? sceneNodes[node.parentId as AnyNodeId] : undefined
    return parent?.type === 'stair'
      ? resolveStairTotalRise(parent, sceneNodes)
      : DEFAULT_LEVEL_HEIGHT
  }, [node])

  const handleBack = useCallback(() => {
    if (node?.parentId) {
      setSelection({ selectedIds: [node.parentId] })
    }
  }, [node?.parentId, setSelection])

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

  if (!(node && node.type === 'stair-segment' && selectedId)) return null

  return (
    <PanelWrapper
      icon="/icons/stairs.webp"
      onBack={handleBack}
      onClose={handleClose}
      title={
        node.name ||
        i18n._({ id: 'node.stairSegment.panel.stairSegment', message: 'Stair Segment' })
      }
      width={300}
    >
      <PanelSection title={i18n._({ id: 'node.stairSegment.panel.type', message: 'Type' })}>
        <SegmentedControl
          onChange={(v) => {
            const updates: Partial<StairSegmentNode> = { segmentType: v }
            if (v === 'landing') {
              updates.winder = undefined
              updates.height = 0
              updates.stepCount = 0
              updates.length = 1.0
            } else {
              updates.height = resolveParentStairRise()
              updates.stepCount = 10
              updates.length = 3.0
            }
            handleUpdate(updates)
          }}
          options={SEGMENT_TYPE_OPTIONS.map((option) => ({
            ...option,
            label: i18n._(option.label),
          }))}
          value={node.segmentType}
        />
      </PanelSection>

      {!isFirstSegment && (
        <PanelSection
          title={i18n._({ id: 'node.stairSegment.panel.attachment', message: 'Attachment' })}
        >
          <SegmentedControl
            onChange={(v) => handleUpdate({ attachmentSide: v })}
            options={ATTACHMENT_SIDE_OPTIONS.map((option) => ({
              ...option,
              label: i18n._(option.label),
            }))}
            value={node.attachmentSide}
          />
        </PanelSection>
      )}

      {(stairSegmentDetailError(node) ?? stairSegmentConstructionError(node, parentStair)) ? (
        <div role="alert" className="px-3 text-xs">
          {stairSegmentDetailError(node) ?? stairSegmentConstructionError(node, parentStair)}
        </div>
      ) : null}
      {node.segmentType === 'stair' && (
        <PanelSection
          title={i18n._({ id: 'node.stairSegment.panel.flightShape', message: 'Flight shape' })}
        >
          <SegmentedControl
            value={node.winder ? 'winder' : 'straight'}
            onChange={(value) =>
              handleUpdate({
                winder:
                  value === 'winder'
                    ? {
                        turn: 'left',
                        innerGap: 0,
                        walkingLineOffset: Math.min(0.5, node.width),
                        division: 'equal-going',
                      }
                    : undefined,
              })
            }
            options={[
              {
                label: i18n._({ id: 'node.stairSegment.panel.straight', message: 'Straight' }),
                value: 'straight',
              },
              {
                label: i18n._({ id: 'node.stairSegment.panel.winder', message: 'Winder' }),
                value: 'winder',
              },
            ]}
          />
          {node.winder && (
            <>
              <SegmentedControl
                value={node.winder.turn}
                onChange={(turn) => handleUpdate({ winder: { ...node.winder!, turn } })}
                options={[
                  {
                    label: i18n._({ id: 'node.stairSegment.panel.leftTurn', message: 'Left turn' }),
                    value: 'left',
                  },
                  {
                    label: i18n._({
                      id: 'node.stairSegment.panel.rightTurn',
                      message: 'Right turn',
                    }),
                    value: 'right',
                  },
                ]}
              />
              <SliderControl
                label={i18n._({ id: 'node.stairSegment.panel.innerGap', message: 'Inner gap' })}
                unit="m"
                min={0}
                precision={2}
                step={0.05}
                value={node.winder.innerGap}
                onChange={(innerGap) => handleUpdate({ winder: { ...node.winder!, innerGap } })}
              />
              <SliderControl
                label={i18n._({
                  id: 'node.stairSegment.panel.walkingLineOffset',
                  message: 'Walking line offset',
                })}
                unit="m"
                min={0.001}
                max={node.width}
                precision={2}
                step={0.05}
                value={node.winder.walkingLineOffset}
                onChange={(walkingLineOffset) =>
                  handleUpdate({ winder: { ...node.winder!, walkingLineOffset } })
                }
              />
              <SegmentedControl
                value={node.winder.division}
                onChange={(division) => handleUpdate({ winder: { ...node.winder!, division } })}
                options={[
                  {
                    label: i18n._({
                      id: 'node.stairSegment.panel.equalGoing',
                      message: 'Equal going',
                    }),
                    value: 'equal-going',
                  },
                  {
                    label: i18n._({
                      id: 'node.stairSegment.panel.equalAngle',
                      message: 'Equal angle',
                    }),
                    value: 'equal-angle',
                  },
                ]}
              />
            </>
          )}
        </PanelSection>
      )}
      <PanelSection
        title={i18n._({ id: 'node.stairSegment.panel.dimensions', message: 'Dimensions' })}
      >
        <SliderControl
          label={i18n._({ id: 'node.stairSegment.panel.width', message: 'Width' })}
          min={0.001}
          onChange={(v) => handleUpdate({ width: v })}
          precision={2}
          step={0.1}
          unit="m"
          value={node.width}
        />
        {!node.winder && (
          <SliderControl
            label={i18n._({ id: 'node.stairSegment.panel.length', message: 'Length' })}
            min={0.001}
            onChange={(v) => handleUpdate({ length: v })}
            precision={2}
            step={0.1}
            unit="m"
            value={node.length}
          />
        )}
        {node.segmentType === 'stair' && (
          <>
            <SliderControl
              label={i18n._({ id: 'node.stairSegment.panel.height', message: 'Height' })}
              min={0.001}
              onChange={handleFlightHeightChange}
              precision={2}
              step={0.1}
              unit="m"
              value={node.height}
            />
            {parentFollowsLevel && (
              <div className="px-1 text-[11px] text-muted-foreground">
                {i18n._({
                  id: 'node.stairSegment.panel.editingSwitchesTheStairToCustom',
                  message: 'Editing switches the stair to Custom rise',
                })}
              </div>
            )}
            <SliderControl
              label={i18n._({ id: 'node.stairSegment.panel.steps', message: 'Steps' })}
              min={2}
              onChange={(v) => handleUpdate({ stepCount: Math.round(v) })}
              precision={0}
              step={1}
              unit=""
              value={node.stepCount}
            />
          </>
        )}
      </PanelSection>

      <PanelSection
        title={i18n._({ id: 'node.stairSegment.panel.structure', message: 'Structure' })}
      >
        <div className="space-y-3">
          <StairConstructionControls
            node={node}
            inherited={parentConstruction}
            onChange={(construction) => handleUpdate({ construction })}
          />
          {!(node.construction ?? parentConstruction) ? (
            <ToggleControl
              checked={node.fillToFloor}
              label={i18n._({
                id: 'node.stairSegment.panel.fillToFloor',
                message: 'Fill to floor',
              })}
              onChange={(checked) => handleUpdate({ fillToFloor: checked })}
            />
          ) : null}
          {!(node.construction ?? parentConstruction) && !node.fillToFloor && (
            <SliderControl
              label={i18n._({ id: 'node.stairSegment.panel.thickness', message: 'Thickness' })}
              min={0.001}
              onChange={(v) => handleUpdate({ thickness: v })}
              precision={2}
              step={0.05}
              unit="m"
              value={node.thickness ?? 0.25}
            />
          )}
        </div>
      </PanelSection>

      <PanelSection title={i18n._({ id: 'node.stairSegment.panel.position', message: 'Position' })}>
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
        <SliderControl
          label={i18n._({ id: 'node.stairSegment.panel.rotation', message: 'Rotation' })}
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
      </PanelSection>

      <PanelSection title={i18n._({ id: 'node.stairSegment.panel.actions', message: 'Actions' })}>
        <ActionGroup>
          <ActionButton
            icon={<Move className="h-3.5 w-3.5" />}
            label={i18n._({ id: 'node.stairSegment.panel.move', message: 'Move' })}
            onClick={handleMove}
          />
          <ActionButton
            icon={<Copy className="h-3.5 w-3.5" />}
            label={i18n._({ id: 'node.stairSegment.panel.duplicate', message: 'Duplicate' })}
            onClick={handleDuplicate}
          />
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />}
            label={i18n._({ id: 'node.stairSegment.panel.delete', message: 'Delete' })}
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
