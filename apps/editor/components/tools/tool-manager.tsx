import { type AnyNodeId, type CeilingNode, type SlabNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor, { type Phase, type Tool } from '@/store/use-editor'
import { CeilingBoundaryEditor } from './ceiling/ceiling-boundary-editor'
import { CeilingHoleEditor } from './ceiling/ceiling-hole-editor'
import { CeilingTool } from './ceiling/ceiling-tool'
import { ItemTool } from './item/item-tool'
import { MoveTool } from './item/move-tool'
import { RoofTool } from './roof/roof-tool'
import { SiteBoundaryEditor } from './site/site-boundary-editor'
import { SlabBoundaryEditor } from './slab/slab-boundary-editor'
import { SlabHoleEditor } from './slab/slab-hole-editor'
import { SlabTool } from './slab/slab-tool'
import { WallTool } from './wall/wall-tool'
import { WindowTool } from './window/window-tool'
import { ZoneBoundaryEditor } from './zone/zone-boundary-editor'
import { ZoneTool } from './zone/zone-tool'

const tools: Record<Phase, Partial<Record<Tool, React.FC>>> = {
  site: {
    'property-line': SiteBoundaryEditor,
  },
  structure: {
    wall: WallTool,
    slab: SlabTool,
    ceiling: CeilingTool,
    roof: RoofTool,
    item: ItemTool,
    zone: ZoneTool,
    window: WindowTool,
  },
  furnish: {
    item: ItemTool,
  },
}

export const ToolManager: React.FC = () => {
  const phase = useEditor((state) => state.phase)
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const movingNode = useEditor((state) => state.movingNode)
  const editingHole = useEditor((state) => state.editingHole)
  const selectedZoneId = useViewer((state) => state.selection.zoneId)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const nodes = useScene((state) => state.nodes)

  // Check if a slab is selected
  const selectedSlabId = selectedIds.find((id) => nodes[id as AnyNodeId]?.type === 'slab') as
    | SlabNode['id']
    | undefined

  // Check if a ceiling is selected
  const selectedCeilingId = selectedIds.find((id) => nodes[id as AnyNodeId]?.type === 'ceiling') as
    | CeilingNode['id']
    | undefined

  // Show site boundary editor when in site phase and edit mode
  const showSiteBoundaryEditor = phase === 'site' && mode === 'edit'

  // Show slab boundary editor when in structure/select mode with a slab selected (but not editing a hole)
  const showSlabBoundaryEditor =
    phase === 'structure' && mode === 'select' && selectedSlabId !== undefined &&
    (!editingHole || editingHole.nodeId !== selectedSlabId)

  // Show slab hole editor when editing a hole on the selected slab
  const showSlabHoleEditor =
    selectedSlabId !== undefined && editingHole !== null && editingHole.nodeId === selectedSlabId

  // Show ceiling boundary editor when in structure/select mode with a ceiling selected (but not editing a hole)
  const showCeilingBoundaryEditor =
    phase === 'structure' && mode === 'select' && selectedCeilingId !== undefined &&
    (!editingHole || editingHole.nodeId !== selectedCeilingId)

  // Show ceiling hole editor when editing a hole on the selected ceiling
  const showCeilingHoleEditor =
    selectedCeilingId !== undefined && editingHole !== null && editingHole.nodeId === selectedCeilingId

  // Show zone boundary editor when in structure/select mode with a zone selected
  // Hide when editing a slab or ceiling to avoid overlapping handles
  const showZoneBoundaryEditor =
    phase === 'structure' &&
    mode === 'select' &&
    selectedZoneId !== null &&
    !showSlabBoundaryEditor &&
    !showCeilingBoundaryEditor

  // Show build tools when in build mode
  const showBuildTool = mode === 'build' && tool !== null

  const BuildToolComponent = showBuildTool ? tools[phase]?.[tool] : null

  return (
    <>
      {showSiteBoundaryEditor && <SiteBoundaryEditor />}
      {showZoneBoundaryEditor && selectedZoneId && <ZoneBoundaryEditor zoneId={selectedZoneId} />}
      {showSlabBoundaryEditor && selectedSlabId && <SlabBoundaryEditor slabId={selectedSlabId} />}
      {showSlabHoleEditor && selectedSlabId && editingHole && (
        <SlabHoleEditor slabId={selectedSlabId} holeIndex={editingHole.holeIndex} />
      )}
      {showCeilingBoundaryEditor && selectedCeilingId && (
        <CeilingBoundaryEditor ceilingId={selectedCeilingId} />
      )}
      {showCeilingHoleEditor && selectedCeilingId && editingHole && (
        <CeilingHoleEditor ceilingId={selectedCeilingId} holeIndex={editingHole.holeIndex} />
      )}
      {movingNode && <MoveTool />}
      {!movingNode && BuildToolComponent && <BuildToolComponent />}
    </>
  )
}
