'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type RoofSegmentNode,
  RoofSegmentNode as RoofSegmentNodeSchema,
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
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Copy, Move, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { getRoofTypeOptions, L, N, S } from '../i18n/panel-labels'

const ROOF_TYPE_VALUES = ['hip', 'gable', 'shed', 'flat'] as const
const ROOF_TYPE_VALUES_2 = ['gambrel', 'dutch', 'mansard'] as const

export default function RoofSegmentPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const setMovingNode = useEditor((s) => s.setMovingNode)

  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as RoofSegmentNode | undefined) : undefined,
  )

  const handleUpdate = useCallback(
    (updates: Partial<RoofSegmentNode>) => {
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

  if (!(node && node.type === 'roof-segment' && selectedId)) return null

  const roofTypeOptions = getRoofTypeOptions([...ROOF_TYPE_VALUES]) as {
    label: string
    value: RoofType
  }[]
  const roofTypeOptions2 = getRoofTypeOptions([...ROOF_TYPE_VALUES_2]) as {
    label: string
    value: RoofType
  }[]

  return (
    <PanelWrapper
      icon="/icons/roof.png"
      onBack={handleBack}
      onClose={handleClose}
      title={node.name || N.roofSegment()}
      width={300}
    >
      <PanelSection title={S.roofType()}>
        <SegmentedControl
          onChange={(v) => handleUpdate({ roofType: v })}
          options={roofTypeOptions}
          value={node.roofType}
        />
        <SegmentedControl
          onChange={(v) => handleUpdate({ roofType: v })}
          options={roofTypeOptions2}
          value={node.roofType}
        />
      </PanelSection>

      <PanelSection title={S.footprint()}>
        <SliderControl
          label={L.width()}
          max={25}
          min={0.5}
          onChange={(v) => handleUpdate({ width: v })}
          precision={2}
          step={0.5}
          unit="m"
          value={Math.round(node.width * 100) / 100}
        />
        <SliderControl
          label={L.depth()}
          max={25}
          min={0.5}
          onChange={(v) => handleUpdate({ depth: v })}
          precision={2}
          step={0.5}
          unit="m"
          value={Math.round(node.depth * 100) / 100}
        />
      </PanelSection>

      <PanelSection title={S.heights()}>
        <SliderControl
          label={L.wall()}
          max={5}
          min={0}
          onChange={(v) => handleUpdate({ wallHeight: v })}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(node.wallHeight * 100) / 100}
        />
        <SliderControl
          label={L.roof()}
          max={15}
          min={0}
          onChange={(v) => handleUpdate({ roofHeight: v })}
          precision={2}
          step={0.1}
          unit="m"
          value={Math.round(node.roofHeight * 100) / 100}
        />
      </PanelSection>

      <PanelSection title={S.structure()}>
        <SliderControl
          label={L.wallThick()}
          max={1}
          min={0.05}
          onChange={(v) => handleUpdate({ wallThickness: v })}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.wallThickness * 100) / 100}
        />
        <SliderControl
          label={L.deckThick()}
          max={0.3}
          min={0.04}
          onChange={(v) => handleUpdate({ deckThickness: v })}
          precision={2}
          step={0.01}
          unit="m"
          value={Math.round(node.deckThickness * 100) / 100}
        />
        <SliderControl
          label={L.overhang()}
          max={1}
          min={0}
          onChange={(v) => handleUpdate({ overhang: v })}
          precision={2}
          step={0.05}
          unit="m"
          value={Math.round(node.overhang * 100) / 100}
        />
        <SliderControl
          label={L.shingleThick()}
          max={0.3}
          min={0.02}
          onChange={(v) => handleUpdate({ shingleThickness: v })}
          precision={2}
          step={0.01}
          unit="m"
          value={Math.round(node.shingleThickness * 100) / 100}
        />
      </PanelSection>

      <PanelSection title={S.position()}>
        <SliderControl
          label={L.x()}
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
          label={L.y()}
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
          label={L.z()}
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
          label={L.rotation()}
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
            label={L.rotateMinus45()}
            onClick={() => {
              triggerSFX('sfx:item-rotate')
              handleUpdate({ rotation: node.rotation - Math.PI / 4 })
            }}
          />
          <ActionButton
            label={L.rotatePlus45()}
            onClick={() => {
              triggerSFX('sfx:item-rotate')
              handleUpdate({ rotation: node.rotation + Math.PI / 4 })
            }}
          />
        </div>
      </PanelSection>

      <PanelSection title={S.actions()}>
        <ActionGroup>
          <ActionButton icon={<Move className="h-3.5 w-3.5" />} label={L.move()} onClick={handleMove} />
          <ActionButton
            icon={<Copy className="h-3.5 w-3.5" />}
            label={L.duplicate()}
            onClick={handleDuplicate}
          />
          <ActionButton
            className="hover:bg-red-500/20"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            label={L.delete()}
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
