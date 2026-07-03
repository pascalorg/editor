'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type AttachmentSide,
  type StairSegmentNode,
  StairSegmentNode as StairSegmentNodeSchema,
  type StairSegmentType,
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
import useViewer from '@pascal-app/viewer/store'
import { Copy, Move, Trash2 } from 'lucide-react'
import { useCallback } from 'react'

const SEGMENT_TYPE_OPTIONS: { label: string; value: StairSegmentType }[] = [
  { label: '梯段', value: 'stair' },
  { label: '平台', value: 'landing' },
]

const ATTACHMENT_SIDE_OPTIONS: { label: string; value: AttachmentSide }[] = [
  { label: '前方', value: 'front' },
  { label: '左侧', value: 'left' },
  { label: '右侧', value: 'right' },
]

export default function StairSegmentPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as StairSegmentNode | undefined) : undefined,
  )

  // Boolean selector — re-renders only when this segment's position among the
  // parent stair's children flips to/from "first".
  const isFirstSegment = useScene((s) => {
    if (!node?.parentId) return true
    const parent = s.nodes[node.parentId as AnyNodeId]
    if (!parent || parent.type !== 'stair') return true
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

  const handleBack = useCallback(() => {
    if (node?.parentId) {
      setSelection({ selectedIds: [node.parentId] })
    }
  }, [node?.parentId, setSelection])

  const handleDuplicate = useCallback(() => {
    if (!node?.parentId) return
    triggerSFX('sfx:item-pick')

    let duplicateInfo = structuredClone(node) as any
    delete duplicateInfo.id
    duplicateInfo.metadata = { ...duplicateInfo.metadata, isNew: true }
    duplicateInfo.position = [
      duplicateInfo.position[0] + 1,
      duplicateInfo.position[1],
      duplicateInfo.position[2] + 1,
    ]

    try {
      const duplicate = StairSegmentNodeSchema.parse(duplicateInfo)
      useScene.getState().createNode(duplicate, duplicate.parentId as AnyNodeId)
      setSelection({ selectedIds: [] })
      setMovingNode(duplicate)
    } catch (e) {
      console.error('Failed to duplicate stair segment', e)
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

  if (!(node && node.type === 'stair-segment' && selectedId)) return null

  return (
    <PanelWrapper
      icon="/icons/stairs.webp"
      onBack={handleBack}
      onClose={handleClose}
      title={node.name || '楼梯分段'}
      width={300}
    >
      <PanelSection title="类型">
        <SegmentedControl
          onChange={(v) => {
            const updates: Partial<StairSegmentNode> = { segmentType: v }
            if (v === 'landing') {
              updates.height = 0
              updates.stepCount = 0
              updates.length = 1.0
            } else {
              updates.height = 2.5
              updates.stepCount = 10
              updates.length = 3.0
            }
            handleUpdate(updates)
          }}
          options={SEGMENT_TYPE_OPTIONS}
          value={node.segmentType}
        />
      </PanelSection>

      {!isFirstSegment && (
        <PanelSection title="连接方向">
          <SegmentedControl
            onChange={(v) => handleUpdate({ attachmentSide: v })}
            options={ATTACHMENT_SIDE_OPTIONS}
            value={node.attachmentSide}
          />
        </PanelSection>
      )}

      <PanelSection title="尺寸">
        <SliderControl
          label="宽度"
          max={5}
          min={0.5}
          onChange={(v) => handleUpdate({ width: v })}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(node.width * 100) / 100}
        />
        <SliderControl
          label="长度"
          max={10}
          min={0.5}
          onChange={(v) => handleUpdate({ length: v })}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(node.length * 100) / 100}
        />
        {node.segmentType === 'stair' && (
          <>
            <SliderControl
              label="高度"
              max={10}
              min={0.5}
              onChange={(v) => handleUpdate({ height: v })}
              precision={2}
              step={0.1}
              unit="m"
              value={Math.round(node.height * 100) / 100}
            />
            <SliderControl
              label="台阶数"
              max={30}
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

      <PanelSection title="结构">
        <div className="space-y-3">
          <ToggleControl
            checked={node.fillToFloor}
            label="贴合楼层"
            onChange={(checked) => handleUpdate({ fillToFloor: checked })}
          />
          {!node.fillToFloor && (
            <SliderControl
              label="厚度"
              max={1}
              min={0.05}
              onChange={(v) => handleUpdate({ thickness: v })}
              precision={2}
              step={0.05}
              unit="m"
              value={Math.round((node.thickness ?? 0.25) * 100) / 100}
            />
          )}
        </div>
      </PanelSection>

      <PanelSection title="位置">
        <SliderControl
          label="X"
          max={50}
          min={-50}
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
          max={50}
          min={-50}
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
          max={50}
          min={-50}
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
        <SliderControl
          label="旋转"
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

      <PanelSection title="操作">
        <ActionGroup>
          <ActionButton icon={<Move className="h-3.5 w-3.5" />} label="移动" onClick={handleMove} />
          <ActionButton
            icon={<Copy className="h-3.5 w-3.5" />}
            label="复制"
            onClick={handleDuplicate}
          />
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            label="删除"
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
