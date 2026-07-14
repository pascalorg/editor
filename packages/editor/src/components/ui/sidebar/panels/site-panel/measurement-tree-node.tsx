import { type AnyNodeId, type MeasurementNode, useScene } from '@pascal-app/core'
import { Ruler, Trash2 } from 'lucide-react'
import { memo, useCallback } from 'react'
import { useMeasurementTool } from '../../../../../store/use-measurement-tool'
import { TreeNodeWrapper } from './tree-node'

interface MeasurementTreeNodeProps {
  nodeId: AnyNodeId
  depth: number
  isLast?: boolean
}

export const MeasurementTreeNode = memo(function MeasurementTreeNode({
  nodeId,
  depth,
  isLast,
}: MeasurementTreeNodeProps) {
  const node = useScene((state) => state.nodes[nodeId] as MeasurementNode | undefined)
  const isSelected = useMeasurementTool((state) => state.selectedId === node?.measurementId)
  const selectMeasurement = useMeasurementTool((state) => state.selectMeasurement)
  const removeMeasurement = useMeasurementTool((state) => state.removeMeasurement)
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      if (node) selectMeasurement(node.measurementId)
    },
    [node, selectMeasurement],
  )
  const handleDelete = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      if (node) removeMeasurement(node.measurementId)
    },
    [node, removeMeasurement],
  )

  if (!node) return null

  return (
    <TreeNodeWrapper
      actions={
        <button
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
          onClick={handleDelete}
          title="Delete measurement"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      }
      depth={depth}
      expanded={false}
      hasChildren={false}
      icon={<Ruler className="h-3.5 w-3.5" />}
      isLast={isLast}
      isSelected={isSelected}
      label={node.name || 'Measurement'}
      nodeId={nodeId}
      onClick={handleClick}
      onToggle={() => {}}
    />
  )
})
