import {
  type AnyNode,
  type AnyNodeId,
  nodeRegistry,
  type RoofNode,
  useScene,
} from '@pascal-app/core'
import {
  duplicateRoofSubtree,
  type NodePanelModel,
  type PanelRow,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'

export const roofPanelModel: NodePanelModel<RoofNode> = {
  rows({ node, nodes, update }) {
    const select = (id: AnyNodeId) => useViewer.getState().setSelection({ selectedIds: [id] })
    const activate = (kind: string) => {
      triggerSFX('sfx:item-pick')
      const editor = useEditor.getState()
      editor.setTool(kind)
      if (editor.mode !== 'build') editor.setMode('build')
    }
    const segments = (node.children ?? [])
      .map((id) => nodes[id])
      .filter((child) => child?.type === 'roof-segment')
    const segmentIds = new Set(segments.map((segment) => segment.id))
    const rows: PanelRow[] = segments.map((segment, index) => ({
      id: segment.id,
      kind: 'choice',
      section: 'Segments',
      label: segment.name || `Segment ${index + 1}`,
      value: segment.roofType,
      onSelect: () => select(segment.id),
    }))
    rows.push({
      id: 'add-segment',
      kind: 'action',
      section: 'Segments',
      label: 'Draw Segment',
      onSelect: () => activate('roof'),
    })
    for (const axis of [0, 1, 2] as const)
      rows.push({
        id: `position-${axis}`,
        kind: 'stepper',
        section: 'Position',
        label: 'XYZ'[axis]!,
        value: node.position[axis],
        unit: 'm',
        step: 0.05,
        min: -Infinity,
        max: Infinity,
        onChange: (value) => {
          const live = useScene.getState().nodes[node.id] as RoofNode | undefined
          const position = [...(live?.position ?? node.position)] as [number, number, number]
          position[axis] = value
          update({ position })
        },
      })
    rows.push(
      {
        id: 'rotation',
        kind: 'stepper',
        section: 'Position',
        label: 'Rotation',
        value: Math.round((node.rotation * 180) / Math.PI),
        unit: '°',
        step: 1,
        min: -180,
        max: 180,
        onChange: (degrees) => update({ rotation: (degrees * Math.PI) / 180 }),
      },
      {
        id: 'rotate',
        kind: 'actions',
        section: 'Position',
        actions: [-1, 1].map((direction) => ({
          id: `rotate-${direction}`,
          label: direction < 0 ? '-45°' : '+45°',
          onSelect: () => {
            triggerSFX('sfx:item-rotate')
            const live = useScene.getState().nodes[node.id] as RoofNode | undefined
            update({ rotation: (live?.rotation ?? node.rotation) + (direction * Math.PI) / 4 })
          },
        })),
      },
    )
    for (const child of Object.values(nodes)) {
      if (
        !child ||
        !('roofSegmentId' in child) ||
        !child.roofSegmentId ||
        !segmentIds.has(child.roofSegmentId)
      )
        continue
      rows.push({
        id: child.id,
        kind: 'action',
        section: 'Elements',
        label: child.name || nodeRegistry.get(child.type)?.presentation?.label || child.type,
        onSelect: () => select(child.id),
      })
    }
    for (const [kind, definition] of nodeRegistry.entries()) {
      if (
        definition.presentation?.hidden ||
        definition.capabilities.wallOpeningPlacement ||
        (definition.capabilities.roofAccessory === undefined &&
          definition.presentation?.paletteGroup !== 'roof-features')
      )
        continue
      const icon = definition.presentation?.icon
      rows.push({
        id: `add-${kind}`,
        kind: 'action',
        section: 'Features & extensions',
        label: `Add ${definition.presentation?.label ?? kind}`,
        icon: icon?.kind === 'url' ? { src: icon.src } : undefined,
        onSelect: () => activate(kind),
      })
    }
    rows.push({
      id: 'roof-actions',
      kind: 'actions',
      section: 'Actions',
      actions: [
        {
          id: 'move',
          label: 'Move',
          onSelect: () => {
            const live = useScene.getState().nodes[node.id]
            if (!live) return
            triggerSFX('sfx:item-pick')
            useEditor.getState().setMovingNode(live)
            useViewer.getState().setSelection({ selectedIds: [] })
          },
        },
        {
          id: 'duplicate',
          label: 'Duplicate',
          onSelect: () => {
            if (!useScene.getState().nodes[node.id]) return
            triggerSFX('sfx:item-pick')
            duplicateRoofSubtree(node.id, { mode: 'move' })
          },
        },
        {
          id: 'delete',
          label: 'Delete',
          onSelect: () => {
            const live: AnyNode | undefined = useScene.getState().nodes[node.id]
            if (!live) return
            triggerSFX('sfx:item-delete')
            useScene.getState().deleteNode(node.id)
            if (live.parentId) useScene.getState().dirtyNodes.add(live.parentId)
            useViewer.getState().setSelection({ selectedIds: [] })
          },
        },
      ],
    })
    return rows
  },
}
