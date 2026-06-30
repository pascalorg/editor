import {
  type AnyNodeId,
  type BuildingNode,
  type CeilingNode,
  type FenceNode,
  nodeRegistry,
  type SlabNode,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type ComponentType, lazy, Suspense, useMemo } from 'react'
import useEditor, { type Phase, type Tool } from '../../store/use-editor'
import {
  useControlPointReshape,
  useEditingHole,
  useEndpointReshape,
  useIsCurveReshape,
  useMovingNode,
  useReshapingNode,
  useTangentReshape,
} from '../../store/use-interaction-scope'
import { Alignment3DGuideLayer } from '../editor/alignment-3d-guide-layer'
import { OpeningGuides3DLayer } from '../editor/opening-guides-3d-layer'
import { WallSnapBeaconLayer } from '../editor/wall-snap-beacon-layer'
import { ElevatorTool } from './elevator/elevator-tool'
import { MoveTool } from './item/move-tool'
import { RoofTool } from './roof/roof-tool'
import { getRegistryAffordanceTool } from './shared/affordance-dispatch'
import { FacingPoseIndicator } from './shared/facing-pose-indicator'
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
  const movingNode = useMovingNode()
  const movingNodeOrigin = useEditor((state) => state.movingNodeOrigin)
  const endpointReshape = useEndpointReshape()
  const controlPointReshape = useControlPointReshape()
  const tangentReshape = useTangentReshape()
  const isCurveReshape = useIsCurveReshape()
  const reshapingNode = useReshapingNode()
  // The endpoint affordance tool's `target` is kind-specific
  // (`{ wall | fence, endpoint }`); rebuild it from the (frozen) reshaped node +
  // the scope's endpoint. Memoised so it stays referentially stable across the
  // scene-write re-renders during the drag — otherwise a fresh object each frame
  // re-fires the tool's setup effect (endpoint drag would loop / freeze).
  const endpointTarget = useMemo(() => {
    if (!(endpointReshape && reshapingNode)) return null
    return reshapingNode.type === 'fence'
      ? { fence: reshapingNode as FenceNode, endpoint: endpointReshape.endpoint }
      : { wall: reshapingNode as WallNode, endpoint: endpointReshape.endpoint }
  }, [endpointReshape, reshapingNode])
  const controlPointTarget = useMemo(() => {
    if (!(controlPointReshape && reshapingNode?.type === 'fence')) return null
    return { fence: reshapingNode as FenceNode, index: controlPointReshape.index }
  }, [controlPointReshape, reshapingNode])
  const tangentTarget = useMemo(() => {
    if (!(tangentReshape && reshapingNode?.type === 'fence')) return null
    return {
      fence: reshapingNode as FenceNode,
      index: tangentReshape.index,
      side: tangentReshape.side,
    }
  }, [reshapingNode, tangentReshape])
  const editingHole = useEditingHole()
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
  const selectedSlab = selectedSlabId ? (nodes[selectedSlabId as AnyNodeId] as SlabNode) : null
  const editingSlabHoleIsManual =
    selectedSlabId !== undefined &&
    editingHole?.nodeId === selectedSlabId &&
    selectedSlab?.holeMetadata?.[editingHole.holeIndex]?.source === 'manual'

  // Check if a ceiling is selected
  const selectedCeilingId = selectedIds.find((id) => nodes[id as AnyNodeId]?.type === 'ceiling') as
    | CeilingNode['id']
    | undefined

  // Keep the site vertex flags available in select mode; the editor component
  // switches to full polygon editing only after a flag activates site mode.
  const showSiteBoundaryEditor = phase === 'site' || mode === 'select'

  // Show slab boundary editor when in structure/select mode with a slab selected (but not editing a hole)
  const showSlabBoundaryEditor =
    phase === 'structure' &&
    mode === 'select' &&
    selectedSlabId !== undefined &&
    !editingSlabHoleIsManual

  // Show slab hole editor when editing a hole on the selected slab
  const showSlabHoleEditor =
    selectedSlabId !== undefined &&
    editingHole !== null &&
    editingHole.nodeId === selectedSlabId &&
    editingSlabHoleIsManual

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

  // A move initiated from the 2D floor-plan (orange move-dot) is owned end-to-
  // end by `FloorplanRegistryMoveOverlay`, which marks the origin `'2d'` at
  // dot-down. Mounting the 3D affordance mover alongside it would adopt the
  // same node and, on its unmount, restore the adopt-time position — snapping
  // the committed 2D move back to its start. Gate the 3D mover off for 2D moves
  // (the scene writes the overlay makes still mirror into the 3D view). A
  // 3D-initiated move leaves the origin null until its own commit, so this only
  // suppresses the 3D tool for genuinely 2D-owned moves.
  const showMover = movingNode != null && movingNodeOrigin !== '2d'

  // Registry-first: if the active tool's kind has a NodeDefinition with a
  // tool contribution, the registry-driven tool takes over.
  const RegistryToolComponent = showBuildTool ? getRegistryTool(tool) : null
  const useRegistryTool = RegistryToolComponent != null

  const BuildToolComponent = showBuildTool && !useRegistryTool ? tools[phase]?.[tool] : null
  const handlePlacedNodeSelected = (nodeId: AnyNodeId) => {
    setSelection({ selectedIds: [nodeId] })
  }
  const handlePlacedElevatorSelected = (
    nodeId: AnyNodeId,
    elevatorBuildingId: BuildingNode['id'],
  ) => {
    // Preserve the active level. `setSelection`'s hierarchy guard nulls
    // `levelId` whenever `buildingId` is passed without an explicit
    // `levelId` — which deselected the current floor plan the moment an
    // elevator was placed. Pass the current level through so the floor
    // plan stays selected.
    setSelection({
      buildingId: elevatorBuildingId,
      levelId: activeLevelId ?? null,
      selectedIds: [nodeId],
    })
  }

  return (
    <>
      {/* World-space tools: site boundary and building movement operate in world coordinates */}
      {showSiteBoundaryEditor && <SiteBoundaryEditor />}
      {showMover && movingNode?.type === 'building' && (
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
          selectedSlabId &&
          (() => {
            const Registry = getRegistryAffordanceTool('slab', 'boundary-edit')
            return Registry ? (
              <Suspense fallback={null}>
                <Registry slabId={selectedSlabId} />
              </Suspense>
            ) : null
          })()}
        {showSlabHoleEditor &&
          selectedSlabId &&
          editingHole &&
          (() => {
            const Registry = getRegistryAffordanceTool('slab', 'hole-edit')
            return Registry ? (
              <Suspense fallback={null}>
                <Registry holeIndex={editingHole.holeIndex} slabId={selectedSlabId} />
              </Suspense>
            ) : null
          })()}
        {showCeilingBoundaryEditor &&
          selectedCeilingId &&
          (() => {
            const Registry = getRegistryAffordanceTool('ceiling', 'boundary-edit')
            return Registry ? (
              <Suspense fallback={null}>
                <Registry ceilingId={selectedCeilingId} />
              </Suspense>
            ) : null
          })()}
        {showCeilingHoleEditor &&
          selectedCeilingId &&
          editingHole &&
          (() => {
            const Registry = getRegistryAffordanceTool('ceiling', 'hole-edit')
            return Registry ? (
              <Suspense fallback={null}>
                <Registry ceilingId={selectedCeilingId} holeIndex={editingHole.holeIndex} />
              </Suspense>
            ) : null
          })()}
        {endpointTarget &&
          reshapingNode &&
          (() => {
            const RegistryAffordance = getRegistryAffordanceTool(
              reshapingNode.type,
              'move-endpoint',
            )
            return RegistryAffordance ? (
              <Suspense fallback={null}>
                <RegistryAffordance target={endpointTarget} />
              </Suspense>
            ) : null
          })()}
        {isCurveReshape &&
          reshapingNode &&
          (() => {
            const RegistryAffordance = getRegistryAffordanceTool(reshapingNode.type, 'curve')
            return RegistryAffordance ? (
              <Suspense fallback={null}>
                <RegistryAffordance node={reshapingNode} />
              </Suspense>
            ) : null
          })()}
        {controlPointTarget &&
          (() => {
            const RegistryAffordance = getRegistryAffordanceTool('fence', 'move-control-point')
            return RegistryAffordance ? (
              <Suspense fallback={null}>
                <RegistryAffordance target={controlPointTarget} />
              </Suspense>
            ) : null
          })()}
        {tangentTarget &&
          (() => {
            const RegistryAffordance = getRegistryAffordanceTool('fence', 'move-tangent')
            return RegistryAffordance ? (
              <Suspense fallback={null}>
                <RegistryAffordance target={tangentTarget} />
              </Suspense>
            ) : null
          })()}
        {showMover && movingNode.type !== 'building' && (
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
        {!movingNode && !useRegistryTool && showBuildTool && tool === 'elevator' && (
          <ElevatorTool
            buildingId={buildingId as BuildingNode['id'] | null}
            levelId={activeLevelId ?? null}
            onPlaced={handlePlacedElevatorSelected}
          />
        )}
        {!movingNode && BuildToolComponent && tool !== 'elevator' ? <BuildToolComponent /> : null}
        {/* Figma-style alignment guides published by the move / placement
            tools above. Lives inside the building-local group so the
            building-local guide coords render at the right world position. */}
        <Alignment3DGuideLayer />
        {/* The one forward-facing triangle renderer. Placement/move tools
            publish their ghost pose to `useFacingPose`; this draws it. Mounted
            here so it shares the building-local frame the tools publish in. */}
        <FacingPoseIndicator />
        {/* Wall-plane proximity / sill / equal-spacing guides for openings,
            published by the door/window move tools in the same world frame. */}
        <OpeningGuides3DLayer />
        {/* "Magnetic" beacon at the active wall-draft snap point. */}
        <WallSnapBeaconLayer />
      </group>
    </>
  )
}
