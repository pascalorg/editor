import { useViewer } from '@pascal-app/viewer'
import { Eye, EyeOff, Ruler, Trash2 } from 'lucide-react'
import { formatLength } from './../../../../../lib/measurements'
import useEditor, { type MeasurementGuide } from './../../../../../store/use-editor'
import { TreeNodeWrapper } from './tree-node'

interface MeasurementGuideTreeNodeProps {
  guide: MeasurementGuide
  depth: number
  isLast?: boolean
}

function MeasurementGuideTreeActions({ guide }: { guide: MeasurementGuide }) {
  const selectedMeasurementGuideId = useEditor((state) => state.selectedMeasurementGuideId)
  const updateMeasurementGuide = useEditor((state) => state.updateMeasurementGuide)
  const deleteMeasurementGuide = useEditor((state) => state.deleteMeasurementGuide)

  const isVisible = guide.visible !== false

  const handleToggleVisibility = (e: React.MouseEvent) => {
    e.stopPropagation()
    updateMeasurementGuide(guide.id, { visible: !isVisible })
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    deleteMeasurementGuide(guide.id)
  }

  return (
    <div className="flex items-center gap-0.5">
      <button
        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
        onClick={handleToggleVisibility}
        title={isVisible ? 'Hide' : 'Show'}
        type="button"
      >
        {isVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 opacity-50" />}
      </button>
      <button
        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
        onClick={handleDelete}
        title="Delete"
        type="button"
      >
        <Trash2 className="h-3 w-3" />
      </button>
      {selectedMeasurementGuideId === guide.id && <span className="sr-only">Selected</span>}
    </div>
  )
}

export function MeasurementGuideTreeNode({
  guide,
  depth,
  isLast,
}: MeasurementGuideTreeNodeProps) {
  const unitSystem = useViewer((state) => state.unitSystem)
  const setSelection = useViewer((state) => state.setSelection)
  const setSelectedReferenceId = useEditor((state) => state.setSelectedReferenceId)
  const selectedMeasurementGuideId = useEditor((state) => state.selectedMeasurementGuideId)
  const setSelectedMeasurementGuideId = useEditor((state) => state.setSelectedMeasurementGuideId)
  const hoveredMeasurementGuideId = useEditor((state) => state.hoveredMeasurementGuideId)
  const setHoveredMeasurementGuideId = useEditor((state) => state.setHoveredMeasurementGuideId)

  const distance = Math.hypot(guide.end[0] - guide.start[0], guide.end[1] - guide.start[1])
  const label = `${guide.name ?? 'Measurement'} · ${formatLength(distance, unitSystem)}`

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setSelection({ selectedIds: [], zoneId: null })
    setSelectedReferenceId(null)
    setSelectedMeasurementGuideId(guide.id)
  }

  return (
    <TreeNodeWrapper
      actions={<MeasurementGuideTreeActions guide={guide} />}
      depth={depth}
      expanded={false}
      hasChildren={false}
      icon={<Ruler className="h-3.5 w-3.5" />}
      isHovered={hoveredMeasurementGuideId === guide.id}
      isLast={isLast}
      isSelected={selectedMeasurementGuideId === guide.id}
      isVisible={guide.visible !== false}
      label={label}
      nodeId={guide.id}
      onClick={handleClick}
      onMouseEnter={() => setHoveredMeasurementGuideId(guide.id)}
      onMouseLeave={() => setHoveredMeasurementGuideId(null)}
      onToggle={() => {}}
    />
  )
}
