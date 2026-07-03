import {
  type AnyNodeId,
  type BuildingNode,
  type CeilingNode,
  nodeRegistry,
  type SlabNode,
  useScene,
} from '@pascal-app/core'
import useViewer from '@pascal-app/viewer/store'
import { type ComponentType, lazy, Suspense } from 'react'
import useEditor, { type Phase, type Tool } from '../../store/use-editor'
import { OpeningGuides3DLayer } from '../editor/opening-guides-3d-layer'
import { ColumnTool } from './column/column-tool'
import { ElevatorTool } from './elevator/elevator-tool'
import { MoveTool } from './item/move-tool'
import { RoofTool } from './roof/roof-tool'
import { getRegistryAffordanceTool } from './shared/affordance-dispatch'
import { SiteBoundaryEditor } from './site/site-boundary-editor'
import { StairTool } from './stair/stair-tool'
import { ZoneBoundaryEditor } from './zone/zone-boundary-editor'
import { ZoneTool } from './zone/zone-tool'

// Cache lazy tool components keyed by their loader so React.lazy isn't
// re-invoked across renders.
const lazyToolCache = new WeakMap<() => Promise<unknown>, ComponentType>()

function getRegistryTool(tool: Tool | null): ComponentType | null {
  if (!tool) return null
  const def = nodeRegistry.get(tool)
  if (!def?.tool) return null
  const cached = lazyToolCache.get(def.tool)
  if (cached) return cached
  const Comp = lazy(def.tool as () => Promise<{ default: ComponentType }>)
  lazyToolCache.set(def.tool, Comp)
  return Comp
}

function RegistryAffordanceMount({
  affordance,
  kind,
  props,
}: {
  affordance: string
  kind: string
  props: Record<string, unknown>
}) {
  const RegistryAffordance = getRegistryAffordanceTool(kind, affordance)
  if (!RegistryAffordance) return null
  return (
    <Suspense fallback={null}>
      <RegistryAffordance {...props} />
    </Suspense>
  )
}

type AffordanceMount = {
  key: string
  kind: string
  props: Record<string, unknown>
}

function isAffordanceMount(entry: AffordanceMount | null): entry is AffordanceMount {
  return entry !== null
}

// Legacy tool fallbacks — kinds whose placement tools haven't migrated
// to `def.tool` yet. Wall / fence / slab / ceiling / door / window /
// item / shelf / spawn now go through the registry path above.
const tools: Record<Phase, Partial<Record<Tool, React.FC>>> = {
  site: {
    'property-line': SiteBoundaryEditor,
  },
  structure: {
    roof: RoofTool,
    stair: StairTool,
    zone: ZoneTool,
  },
  furnish: {},
}

export const ToolManager: React.FC = () => {
  const phase = useEditor((state) => state.phase)
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const movingNode = useEditor((state) => state.movingNode)
  const movingWallEndpoint = useEditor((state) => state.movingWallEndpoint)
  const movingFenceEndpoint = useEditor((state) => state.movingFenceEndpoint)
  const movingPipeEndpoint = useEditor((state) => state.movingPipeEndpoint)
  const movingCableTrayEndpoint = useEditor((state) => state.movingCableTrayEndpoint)
  const movingConveyorBeltEndpoint = useEditor((state) => state.movingConveyorBeltEndpoint)
  const movingRoadEndpoint = useEditor((state) => state.movingRoadEndpoint)
  const movingSteelBeamEndpoint = useEditor((state) => state.movingSteelBeamEndpoint)
  const activeAffordance = useEditor((state) => state.activeAffordance)
  const curvingWall = useEditor((state) => state.curvingWall)
  const curvingFence = useEditor((state) => state.curvingFence)
  const curvingPipe = useEditor((state) => state.curvingPipe)
  const curvingCableTray = useEditor((state) => state.curvingCableTray)
  const curvingRoad = useEditor((state) => state.curvingRoad)
  const curvingSteelBeam = useEditor((state) => state.curvingSteelBeam)
  const editingHole = useEditor((state) => state.editingHole)
  const selectedZoneId = useViewer((state) => state.selection.zoneId)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const buildingId = useViewer((state) => state.selection.buildingId)
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const setSelection = useViewer((state) => state.setSelection)
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

  // Registry-first: if the active tool's kind has a NodeDefinition with a
  // tool contribution, the registry-driven tool takes over.
  const RegistryToolComponent = showBuildTool ? getRegistryTool(tool) : null
  const useRegistryTool = RegistryToolComponent != null

  const BuildToolComponent = showBuildTool && !useRegistryTool ? tools[phase]?.[tool] : null
  const endpointAffordanceMounts = ([
    movingWallEndpoint && {
      key: 'wall',
      kind: movingWallEndpoint.wall.type,
      props: { target: movingWallEndpoint },
    },
    movingFenceEndpoint && {
      key: 'fence',
      kind: movingFenceEndpoint.fence.type,
      props: { target: movingFenceEndpoint },
    },
    movingPipeEndpoint && {
      key: 'pipe',
      kind: movingPipeEndpoint.pipe.type,
      props: { target: movingPipeEndpoint },
    },
    movingCableTrayEndpoint && {
      key: 'cable-tray',
      kind: movingCableTrayEndpoint.cableTray.type,
      props: { target: movingCableTrayEndpoint },
    },
    movingConveyorBeltEndpoint && {
      key: 'conveyor-belt',
      kind: movingConveyorBeltEndpoint.conveyorBelt.type,
      props: { target: movingConveyorBeltEndpoint },
    },
    movingRoadEndpoint && {
      key: 'road',
      kind: movingRoadEndpoint.road.type,
      props: { target: movingRoadEndpoint },
    },
    movingSteelBeamEndpoint && {
      key: 'steel-beam',
      kind: movingSteelBeamEndpoint.steelBeam.type,
      props: { target: movingSteelBeamEndpoint },
    },
  ] as Array<AffordanceMount | null>).filter(isAffordanceMount)
  const curveAffordanceMounts = ([
    curvingWall && { key: 'wall', kind: curvingWall.type, props: { node: curvingWall } },
    curvingFence && { key: 'fence', kind: curvingFence.type, props: { node: curvingFence } },
    curvingPipe && { key: 'pipe', kind: curvingPipe.type, props: { node: curvingPipe } },
    curvingCableTray && {
      key: 'cable-tray',
      kind: curvingCableTray.type,
      props: { node: curvingCableTray },
    },
    curvingRoad && { key: 'road', kind: curvingRoad.type, props: { node: curvingRoad } },
    curvingSteelBeam && {
      key: 'steel-beam',
      kind: curvingSteelBeam.type,
      props: { node: curvingSteelBeam },
    },
  ] as Array<AffordanceMount | null>).filter(isAffordanceMount)
  const handlePlacedNodeSelected = (nodeId: AnyNodeId) => {
    setSelection({ selectedIds: [nodeId] })
  }
  const handlePlacedElevatorSelected = (
    nodeId: AnyNodeId,
    elevatorBuildingId: BuildingNode['id'],
  ) => {
    setSelection({ buildingId: elevatorBuildingId, selectedIds: [nodeId] })
  }

  return (
    <>
      {/* World-space tools: site boundary and building movement operate in world coordinates */}
      {showSiteBoundaryEditor && <SiteBoundaryEditor />}
      {movingNode?.type === 'building' && (
        <MoveTool onNodeMoved={handlePlacedNodeSelected} onSpawnMoved={handlePlacedNodeSelected} />
      )}

      {/* Building-local group: all other tools are relative to the selected building.
          Cursor visuals set positions in building-local space; this group applies the
          building's world transform so they render at the correct world position. */}
      <group
        position={buildingPosition as [number, number, number]}
        rotation={buildingRotation as [number, number, number]}
      >
        {showZoneBoundaryEditor && selectedZoneId && <ZoneBoundaryEditor zoneId={selectedZoneId} />}
        {showSlabBoundaryEditor &&
          selectedSlabId && (
            <RegistryAffordanceMount
              affordance="boundary-edit"
              kind="slab"
              props={{ slabId: selectedSlabId }}
            />
          )}
        {showSlabHoleEditor &&
          selectedSlabId &&
          editingHole && (
            <RegistryAffordanceMount
              affordance="hole-edit"
              kind="slab"
              props={{ holeIndex: editingHole.holeIndex, slabId: selectedSlabId }}
            />
          )}
        {showCeilingBoundaryEditor &&
          selectedCeilingId && (
            <RegistryAffordanceMount
              affordance="boundary-edit"
              kind="ceiling"
              props={{ ceilingId: selectedCeilingId }}
            />
          )}
        {showCeilingHoleEditor &&
          selectedCeilingId &&
          editingHole && (
            <RegistryAffordanceMount
              affordance="hole-edit"
              kind="ceiling"
              props={{ ceilingId: selectedCeilingId, holeIndex: editingHole.holeIndex }}
            />
          )}
        {activeAffordance && (
          <RegistryAffordanceMount
            affordance={activeAffordance.affordance}
            kind={activeAffordance.node.type}
            props={activeAffordance.props}
          />
        )}
        {endpointAffordanceMounts.map((mount) => (
          <RegistryAffordanceMount
            affordance="move-endpoint"
            key={mount.key}
            kind={mount.kind}
            props={mount.props}
          />
        ))}
        {curveAffordanceMounts.map((mount) => (
          <RegistryAffordanceMount
            affordance="curve"
            key={mount.key}
            kind={mount.kind}
            props={mount.props}
          />
        ))}
        {movingNode && movingNode.type !== 'building' && (
          <MoveTool
            onNodeMoved={handlePlacedNodeSelected}
            onSpawnMoved={handlePlacedNodeSelected}
          />
        )}
        {/* Registry-first: when the active tool's kind has a registered
            NodeDefinition with a tool contribution, mount it here. */}
        {!movingNode && useRegistryTool && RegistryToolComponent && (
          <Suspense fallback={null}>
            <RegistryToolComponent />
          </Suspense>
        )}
        {!movingNode && !useRegistryTool && showBuildTool && tool === 'column' && (
          <ColumnTool currentLevelId={activeLevelId ?? null} onPlaced={handlePlacedNodeSelected} />
        )}
        {!movingNode && !useRegistryTool && showBuildTool && tool === 'elevator' && (
          <ElevatorTool
            buildingId={buildingId as BuildingNode['id'] | null}
            levelId={activeLevelId ?? null}
            onPlaced={handlePlacedElevatorSelected}
          />
        )}
        {!movingNode && BuildToolComponent && tool !== 'column' && tool !== 'elevator' ? (
          <BuildToolComponent />
        ) : null}
        <OpeningGuides3DLayer />
      </group>
    </>
  )
}
