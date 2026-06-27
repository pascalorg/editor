'use client'

import {
  type AnyNode,
  type ConveyorBeltNode,
  getTransferConnections,
  type TransferConnection,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  MetricControl,
  PanelSection,
  PanelWrapper,
  ToggleControl,
  triggerSFX,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Trash2 } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { L, S } from '../i18n/panel-labels'

const SELECT_CLASS =
  'h-10 w-full rounded-lg border border-border/50 bg-[#2C2C2E] px-3 text-sm text-foreground outline-none transition-colors hover:bg-[#3e3e3e] focus:ring-1 focus:ring-border'

const COLOR_INPUT_CLASS =
  'h-10 w-full rounded-lg border border-border/50 bg-[#2C2C2E] px-2 py-1 outline-none transition-colors hover:bg-[#3e3e3e] focus:ring-1 focus:ring-border'

function rounded(value: number, precision = 2) {
  const scale = 10 ** precision
  return Math.round(value * scale) / scale
}

function connectionLabel(connection: TransferConnection, selectedId: string, nodes: Record<string, AnyNode>) {
  const isOutgoing = connection.fromNodeId === selectedId
  const otherId = isOutgoing ? connection.toNodeId : connection.fromNodeId
  const other = nodes[otherId as AnyNode['id']]
  const otherName = other?.name || otherId
  const direction = isOutgoing ? '\u8f93\u51fa' : '\u8f93\u5165'
  return `${direction} \u2192 ${otherName}`
}

export default function ConveyorBeltPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selectedCount = useViewer((s) => s.selection.selectedIds.length)
  const setSelection = useViewer((s) => s.setSelection)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const nodes = useScene((s) => s.nodes)

  const node = selectedId ? (nodes[selectedId as AnyNode['id']] as ConveyorBeltNode | undefined) : undefined

  const connections = useMemo(() => {
    if (!selectedId) return []
    return Object.values(nodes).flatMap((candidate) =>
      getTransferConnections(candidate).filter(
        (connection) => connection.fromNodeId === selectedId || connection.toNodeId === selectedId,
      ),
    )
  }, [nodes, selectedId])

  const handleUpdate = useCallback(
    (updates: Partial<ConveyorBeltNode>) => {
      if (!selectedId) return
      updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId, updateNode],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleDelete = useCallback(() => {
    if (!(selectedId && node)) return
    triggerSFX('sfx:structure-delete')
    deleteNode(selectedId as AnyNode['id'])
    setSelection({ selectedIds: [] })
  }, [deleteNode, node, selectedId, setSelection])

  if (!(node && node.type === 'conveyor-belt' && selectedId && selectedCount === 1)) return null

  return (
    <PanelWrapper
      icon="/icons/pipe.svg"
      onClose={handleClose}
      title={node.name || '\u8f93\u9001\u5e26'}
      width={320}
    >
      <PanelSection title={S.dimensions()}>
        <MetricControl
          label={L.width()}
          max={5}
          min={0.1}
          onChange={(width) => handleUpdate({ width })}
          precision={2}
          step={0.05}
          unit="m"
          value={rounded(node.width)}
        />
        <MetricControl
          label={'\u539a\u5ea6'}
          max={0.5}
          min={0.02}
          onChange={(thickness) => handleUpdate({ thickness })}
          precision={2}
          step={0.01}
          unit="m"
          value={rounded(node.thickness)}
        />
        <MetricControl
          label={'\u6807\u9ad8'}
          max={20}
          min={-2}
          onChange={(elevation) => handleUpdate({ elevation })}
          precision={2}
          step={0.05}
          unit="m"
          value={rounded(node.elevation)}
        />
      </PanelSection>

      <PanelSection title={'\u8f93\u9001'}>
        <select
          className={SELECT_CLASS}
          onChange={(event) => handleUpdate({ direction: event.target.value as ConveyorBeltNode['direction'] })}
          value={node.direction}
        >
          <option value="forward">{'\u6b63\u5411'}</option>
          <option value="backward">{'\u53cd\u5411'}</option>
        </select>
        <ToggleControl
          checked={node.showRollers}
          label={'\u663e\u793a\u6eda\u7b52'}
          onChange={(showRollers) => handleUpdate({ showRollers })}
        />
        {node.showRollers ? (
          <MetricControl
            label={'\u6eda\u7b52\u95f4\u8ddd'}
            max={5}
            min={0.2}
            onChange={(rollerSpacing) => handleUpdate({ rollerSpacing })}
            precision={2}
            step={0.05}
            unit="m"
            value={rounded(node.rollerSpacing)}
          />
        ) : null}
      </PanelSection>

      <PanelSection title={'\u8fde\u63a5'}>
        <div className="space-y-1 rounded-lg border border-border/40 bg-black/15 p-2 text-xs text-muted-foreground">
          {connections.length > 0 ? (
            connections.map((connection, index) => (
              <div key={`${connection.fromNodeId}-${connection.toNodeId}-${index}`} className="truncate">
                {connectionLabel(connection, selectedId, nodes)}
              </div>
            ))
          ) : (
            <div>{'\u672a\u8fde\u63a5\uff1a\u62d6\u52a8\u7aef\u70b9\u9760\u8fd1\u5176\u4ed6\u8f93\u9001\u5e26\u53ef\u81ea\u52a8\u5438\u9644'}</div>
          )}
        </div>
      </PanelSection>

      <PanelSection title={'\u5916\u89c2'}>
        <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
          <label className="space-y-1">
            <span>{'\u76ae\u5e26'}</span>
            <input
              className={COLOR_INPUT_CLASS}
              onChange={(event) => handleUpdate({ color: event.target.value })}
              type="color"
              value={node.color}
            />
          </label>
          <label className="space-y-1">
            <span>{'\u8fb9\u6846'}</span>
            <input
              className={COLOR_INPUT_CLASS}
              onChange={(event) => handleUpdate({ edgeColor: event.target.value })}
              type="color"
              value={node.edgeColor}
            />
          </label>
          <label className="space-y-1">
            <span>{'\u6eda\u7b52'}</span>
            <input
              className={COLOR_INPUT_CLASS}
              onChange={(event) => handleUpdate({ rollerColor: event.target.value })}
              type="color"
              value={node.rollerColor}
            />
          </label>
        </div>
        <ToggleControl
          checked={node.showFrame}
          label={'\u663e\u793a\u8fb9\u6846'}
          onChange={(showFrame) => handleUpdate({ showFrame })}
        />
      </PanelSection>

      <PanelSection title={S.actions()}>
        <ActionGroup>
          <ActionButton
            className="border-red-500/40 text-red-200 hover:bg-red-500/15"
            icon={<Trash2 className="h-4 w-4" />}
            label={L.delete()}
            onClick={handleDelete}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}
