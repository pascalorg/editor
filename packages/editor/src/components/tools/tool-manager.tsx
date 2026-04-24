import {
  type AnyNodeId,
  type BuildingNode,
  type CeilingNode,
  type SlabNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor, { type Phase, type Tool } from '../../store/use-editor'
import { CeilingBoundaryEditor } from './ceiling/ceiling-boundary-editor'
import { CeilingHoleEditor } from './ceiling/ceiling-hole-editor'
import { ArchwayTool } from './archway/archway-tool'
import { CeilingTool } from './ceiling/ceiling-tool'
import { DoorTool } from './door/door-tool'
import { CurveFenceTool } from './fence/curve-fence-tool'
import { FenceTool } from './fence/fence-tool'
import { MoveFenceEndpointTool } from './fence/move-fence-endpoint-tool'
import { ItemTool } from './item/item-tool'
import { MoveTool } from './item/move-tool'
import { RoofTool } from './roof/roof-tool'
import { SiteBoundaryEditor } from './site/site-boundary-editor'
import { SlabBoundaryEditor } from './slab/slab-boundary-editor'
import { SlabHoleEditor } from './slab/slab-hole-editor'
import { SlabTool } from './slab/slab-tool'
import { StairTool } from './stair/stair-tool'
import { CurveWallTool } from './wall/curve-wall-tool'
import { MoveWallEndpointTool } from './wall/move-wall-endpoint-tool'
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
    fence: FenceTool,
    slab: SlabTool,
    ceiling: CeilingTool,
    roof: RoofTool,
    stair: StairTool,
    door: DoorTool,
    item: ItemTool,
    zone: ZoneTool,
    window: WindowTool,
    archway: ArchwayTool,
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
  const movingWallEndpoint = useEditor((state) => state.movingWallEndpoint)
  const movingFenceEndpoint = useEditor((state) => state.movingFenceEndpoint)
  const curvingWall = useEditor((state) => state.curvingWall)
  const curvingFence = useEditor((state) => state.curvingFence)
  const editingHole = useEditor((state) => state.editingHole)
  const selectedZoneId = useViewer((state) => state.selection.zoneId)
  const buildingId = useViewer((state) => state.selection.buildingId)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const nodes = useScene((state) => state.nodes)

  // Building transform for the local group — all building-relative tools live inside this group
  // so their cursor positions and committed data are naturally in building-local space.
  const building = buildingId
    ? (nodes[buildingId as AnyNodeId] as BuildingNode | undefined)
    : undefined
  const buildingPosition = building?.position ?? [0, 0, 0]
  const buildingRotation = building?.rotation ?? [0, 0, 0]

  // Check if a slab is selected
  const selectedSlabId = selectedIds.find((id) => nodes[id as AnyNodeId]?.type === 'slab') as
    | SlabNode['id']
    | undefined

  // Check if a ceiling is selected
  const selectedCeilingId = selectedIds.find((id) => nodes[id as AnyNodeId]?.type === 'ceiling') as
    | CeilingNode['id']
    | undefined

  // Show site boundary editor when in site phase (toggle controls entry/exit)
  const showSiteBoundaryEditor = phase === 'site'

  // Show slab boundary editor when in structure/select mode with a slab selected (but not editing a hole)
  const showSlabBoundaryEditor =
    phase === 'structure' &&
    mode === 'select' &&
    selectedSlabId !== undefined &&
    (!editingHole || editingHole.nodeId !== selectedSlabId)

  // Show slab hole editor when editing a hole on the selected slab
  const showSlabHoleEditor =
    selectedSlabId !== undefined && editingHole !== null && editingHole.nodeId === selectedSlabId

  // Show ceiling boundary editor when in structure/select mode with a ceiling selected (but not editing a hole)
  const showCeilingBoundaryEditor =
    phase === 'structure' &&
    mode === 'select' &&
    selectedCeilingId !== undefined &&
    (!editingHole || editingHole.nodeId !== selectedCeilingId)

  // Show ceiling hole editor when editing a hole on the selected ceiling
  const showCeilingHoleEditor =
    selectedCeilingId !== undefined &&
    editingHole !== null &&
    editingHole.nodeId === selectedCeilingId

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
      {/* World-space tools: site boundary and building movement operate in world coordinates */}
      {movingNode?.type === 'building' && <MoveTool />}

      {/* Building-local group: all other tools are relative to the selected building.
          Cursor visuals set positions in building-local space; this group applies the
          building's world transform so they render at the correct world position. */}
      <group
        position={buildingPosition as [number, number, number]}
        rotation={buildingRotation as [number, number, number]}
      >
        {showZoneBoundaryEditor && selectedZoneId && <ZoneBoundaryEditor zoneId={selectedZoneId} />}
        {showSlabBoundaryEditor && selectedSlabId && <SlabBoundaryEditor slabId={selectedSlabId} />}
        {showSlabHoleEditor && selectedSlabId && editingHole && (
          <SlabHoleEditor holeIndex={editingHole.holeIndex} slabId={selectedSlabId} />
        )}
        {showCeilingBoundaryEditor && selectedCeilingId && (
          <CeilingBoundaryEditor ceilingId={selectedCeilingId} />
        )}
        {showCeilingHoleEditor && selectedCeilingId && editingHole && (
          <CeilingHoleEditor ceilingId={selectedCeilingId} holeIndex={editingHole.holeIndex} />
        )}
        {movingWallEndpoint && <MoveWallEndpointTool target={movingWallEndpoint} />}
        {movingFenceEndpoint && <MoveFenceEndpointTool target={movingFenceEndpoint} />}
        {curvingWall && <CurveWallTool node={curvingWall} />}
        {curvingFence && <CurveFenceTool node={curvingFence} />}
        {movingNode && movingNode.type !== 'building' && <MoveTool />}
        {!movingNode && BuildToolComponent && <BuildToolComponent />}
      </group>
    </>
  )
}
