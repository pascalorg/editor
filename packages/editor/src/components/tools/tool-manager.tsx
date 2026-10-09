import {
  type AnyNodeDefinition,
  type AnyNodeId,
  type BuildingNode,
  type CeilingNode,
  createSceneApi,
  type FenceNode,
  nodeRegistry,
  type SlabNode,
  useScene,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type ComponentType, lazy, Suspense, useMemo } from 'react'
import { useRegisteredToolEnabled } from '../../hooks/use-registered-tool-enabled'
import { useCeilingEditCeilingId } from '../../lib/ceiling-edit-session'
import type { ReshapeKind } from '../../lib/interaction/scope'
import { paintRegionTargets, usePaintRegionMode } from '../../lib/paint-region-mode'
import { siteBoundaryHandlesEnabled } from '../../lib/site-boundary'
import useEditor, { type Tool } from '../../store/use-editor'
import useInteractionScope, {
  useControlPointReshape,
  useEditingHole,
  useEndpointReshape,
  useIsCurveReshape,
  useIsFloorplanDrivenReshape,
  useIsToolDrivenReshape,
  useMovingNode,
  useReshapingNode,
  useTangentReshape,
} from '../../store/use-interaction-scope'
import { Alignment3DGuideLayer } from '../editor/alignment-3d-guide-layer'
import { Elevation3DGuideLayer } from '../editor/elevation-3d-guide-layer'
import { FloorOpeningsOverlay3D } from '../editor/floor-openings-overlay'
import { FloorRegionControls3D } from '../editor/floor-region-controls'
import { OpenWallEnds3DLayer } from '../editor/open-wall-ends-3d-layer'
import { OpeningGuides3DLayer } from '../editor/opening-guides-3d-layer'
import { WallSnapBeaconLayer } from '../editor/wall-snap-beacon-layer'
import { ElevatorTool } from './elevator/elevator-tool'
import { MoveTool } from './item/move-tool'
import { WallPaintRegionTool } from './paint-region/wall-paint-region-tool'
import { RegistryToolProvider } from './registry-tool-context'
import {
  getRegistryAffordanceTool,
  preloadRegistryAffordanceTools,
} from './shared/affordance-dispatch'
import { FacingPoseIndicator } from './shared/facing-pose-indicator'
import { SiteBoundaryEditor } from './site/site-boundary-editor'
import { TerrainSculptTool } from './site/terrain-sculpt-tool'
import { ZoneBoundaryEditor } from './zone/zone-boundary-editor'
import { ZoneTool } from './zone/zone-tool'

// Cache lazy tool components keyed by their loader so React.lazy isn't
// re-invoked across renders.
const lazyToolCache = new WeakMap<() => Promise<unknown>, ComponentType>()
// Reshapes with their own arm below; anything else resolves by name.
const DEDICATED_RESHAPES = new Set<ReshapeKind>([
  'curve',
  'hole',
  'endpoint',
  'boundary',
  'control-point',
  'tangent',
])
const registryToolPreloadCache = new WeakMap<AnyNodeDefinition, Promise<void>>()

export function preloadRegistryToolModules(tool: string | null): Promise<void> {
  if (!tool) return Promise.resolve()
  const def = nodeRegistry.get(tool)
  if (!def) return Promise.resolve()
  const cached = registryToolPreloadCache.get(def)
  if (cached) return cached

  const loaders: Array<() => Promise<unknown>> = []
  if (def.tool) loaders.push(def.tool)
  if (def.preview) loaders.push(def.preview)
  if (def.renderer?.kind === 'parametric') loaders.push(def.renderer.module)
  if (def.system) loaders.push(def.system.module)
  if (def.parametrics?.customPanel) loaders.push(def.parametrics.customPanel)
  if (def.parametrics?.trailingSection) loaders.push(def.parametrics.trailingSection)
  loaders.push(() => preloadRegistryAffordanceTools(tool))

  const preload = Promise.allSettled(loaders.map((loader) => loader())).then(() => undefined)
  registryToolPreloadCache.set(def, preload)
  return preload
}

function getRegistryTool(tool: Tool | null): ComponentType | null {
  if (!tool) return null
  const def = nodeRegistry.get(tool)
  if (!def?.tool) return null
  const cached = lazyToolCache.get(def.tool)
  if (cached) return cached
  const Comp = lazy(async () => {
    // Placement can only begin once the node's preview, committed renderer,
    // inspector, and move contribution are warm. This keeps the click itself
    // synchronous even under Next.js dev-time on-demand compilation.
    await preloadRegistryToolModules(tool)
    return def.tool!() as Promise<{ default: ComponentType }>
  })
  lazyToolCache.set(def.tool, Comp)
  return Comp
}

// Legacy tool fallbacks — kinds whose placement tools haven't migrated
// to `def.tool` yet. Wall / fence / slab / ceiling / door / window /
// item / shelf / spawn now go through the registry path above.
const tools: Partial<Record<Tool, React.FC>> = {
  'property-line': SiteBoundaryEditor,
  zone: ZoneTool,
}

export const ToolManager: React.FC = () => {
  const phase = useEditor((state) => state.phase)
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const paintsWallRegions = usePaintRegionMode((state) => paintRegionTargets(state.mode).wall)
  const registeredToolEnabled = useRegisteredToolEnabled(tool)
  const movingNode = useMovingNode()
  const registryToolOwnsPlacement = useInteractionScope(
    (state) => state.scope.kind === 'placing' && state.scope.driver === 'registry-tool',
  )
  const movingNodeOrigin = useEditor((state) => state.movingNodeOrigin)
  const endpointReshape = useEndpointReshape()
  const controlPointReshape = useControlPointReshape()
  const tangentReshape = useTangentReshape()
  const isCurveReshape = useIsCurveReshape()
  const isToolDrivenReshape = useIsToolDrivenReshape()
  const registryReshape = useInteractionScope((state) =>
    state.scope.kind === 'reshaping' && !DEDICATED_RESHAPES.has(state.scope.reshape)
      ? state.scope.reshape
      : null,
  )
  const isFloorplanDrivenReshape = useIsFloorplanDrivenReshape()
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
  const editCeilingId = useCeilingEditCeilingId()
  // A zone picked as a zone, from the Scene list (zoneId) or its area or pill (sole selection).
  const zoneSelectionId = useViewer((state) => state.selection.zoneId)
  const soleSelectedId = useViewer((state) =>
    state.selection.selectedIds.length === 1 ? state.selection.selectedIds[0] : undefined,
  )
  const soleSelectedZone = useScene((state) =>
    soleSelectedId && state.nodes[soleSelectedId as AnyNodeId]?.type === 'zone'
      ? (soleSelectedId as ZoneNode['id'])
      : null,
  )
  const selectedZoneId = zoneSelectionId ?? soleSelectedZone
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const buildingId = useViewer((state) => state.selection.buildingId)
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const unit = useViewer((state) => state.unit)
  const setSelection = useViewer((state) => state.setSelection)
  const nodes = useScene((state) => state.nodes)
  const registrySceneApi = useMemo(() => createSceneApi(useScene), [])
  const registryToolContext = useMemo(
    () => ({
      activeLevelId: activeLevelId ?? null,
      isCameraDragging: () => useViewer.getState().cameraDragging,
      sceneApi: registrySceneApi,
      selectNode: (nodeId: AnyNodeId) => setSelection({ selectedIds: [nodeId] }),
      unit,
    }),
    [activeLevelId, registrySceneApi, setSelection, unit],
  )

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

  // Site boundary handles normally share one 2D/3D rule. Sculpt is the deliberate
  // 3D exception: the brush only owns this canvas, where PolygonEditor can hand
  // off its pointer before a boundary drag starts.
  const sculpting = mode === 'terrain-sculpt'
  // Sculpt keeps the 3D property controls visible. PolygonEditor marks its
  // pointer before the canvas-level brush listener runs, and activating one
  // exits sculpt mode before starting the boundary drag.
  const showSiteBoundaryEditor = sculpting || siteBoundaryHandlesEnabled({ mode, phase })

  // A multi-selection is manipulated as one rigid group (drag / R / T), so
  // per-node reshape chrome — the slab / ceiling boundary editors' vertex and
  // edge handles — mounts only for a sole selection.
  const isSoleSelection = selectedIds.length === 1

  // Show slab boundary editor in select mode with a slab selected (but not editing a hole)
  const showSlabBoundaryEditor =
    mode === 'select' &&
    isSoleSelection &&
    selectedSlabId !== undefined &&
    // Derived plates (a footprint's floor, a room's raised plate) follow their
    // rooms; only user-drawn slabs get the outline editor.
    !selectedSlab?.plateRole &&
    !isFloorplanDrivenReshape &&
    !editingSlabHoleIsManual

  // Show slab hole editor when editing a hole on the selected slab
  const showSlabHoleEditor =
    selectedSlabId !== undefined &&
    editingHole !== null &&
    editingHole.nodeId === selectedSlabId &&
    !isFloorplanDrivenReshape &&
    editingSlabHoleIsManual

  // Show ceiling boundary editor only inside the ceiling's Edit ceiling session (not while editing a hole)
  const showCeilingBoundaryEditor =
    mode === 'select' &&
    isSoleSelection &&
    selectedCeilingId !== undefined &&
    selectedCeilingId === editCeilingId &&
    !isFloorplanDrivenReshape &&
    (!editingHole || editingHole.nodeId !== selectedCeilingId)

  // Show ceiling hole editor when editing a manual hole inside the ceiling's Edit ceiling session
  const showCeilingHoleEditor =
    selectedCeilingId !== undefined &&
    selectedCeilingId === editCeilingId &&
    editingHole !== null &&
    editingHole.nodeId === selectedCeilingId &&
    ((nodes[selectedCeilingId as AnyNodeId] as CeilingNode).holeMetadata?.[editingHole.holeIndex]
      ?.source ?? 'manual') === 'manual' &&
    !isFloorplanDrivenReshape

  // Show zone boundary editor in select mode with a zone selected
  // Hide when editing a slab or ceiling to avoid overlapping handles
  const showZoneBoundaryEditor =
    mode === 'select' &&
    selectedZoneId !== null &&
    !isFloorplanDrivenReshape &&
    !showSlabBoundaryEditor &&
    !showCeilingBoundaryEditor

  // Show build tools when in build mode
  const showBuildTool = mode === 'build' && tool !== null && registeredToolEnabled

  // A move initiated from the 2D floor-plan (orange move-dot) is owned end-to-
  // end by `FloorplanRegistryMoveOverlay`, which marks the origin `'2d'` at
  // dot-down. Mounting the 3D affordance mover alongside it would adopt the
  // same node and, on its unmount, restore the adopt-time position — snapping
  // the committed 2D move back to its start. Gate the 3D mover off for 2D moves
  // (the scene writes the overlay makes still mirror into the 3D view). A
  // 3D-initiated move leaves the origin null until its own commit, so this only
  // suppresses the 3D tool for genuinely 2D-owned moves.
  const showMover = movingNode != null && movingNodeOrigin !== '2d' && !registryToolOwnsPlacement

  // Registry-first: if the active tool's kind has a NodeDefinition with a
  // tool contribution, the registry-driven tool takes over.
  const RegistryToolComponent = showBuildTool ? getRegistryTool(tool) : null
  const useRegistryTool = RegistryToolComponent != null

  const BuildToolComponent = showBuildTool && !useRegistryTool ? tools[tool] : null
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
    <RegistryToolProvider value={registryToolContext}>
      {/* World-space tools: site boundary and building movement operate in world coordinates */}
      {showSiteBoundaryEditor && <SiteBoundaryEditor />}
      {/* Terrain sculpting is a mode rather than a `tools[tool]` entry —
          it places no node — so it gets its own gate here. World-space, because
          the ground is not building-local. */}
      {sculpting && <TerrainSculptTool />}
      {/* "Paint part of the floor": level-space, follows the level matrix itself. */}
      <FloorRegionControls3D />
      {/* Floor and ceiling openings: level-space, follows the level matrix itself. */}
      <FloorOpeningsOverlay3D />
      {/* "Paint part of the wall": follows the wall mesh's own matrix. */}
      {mode === 'material-paint' && paintsWallRegions && <WallPaintRegionTool />}
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
        {isToolDrivenReshape &&
          endpointTarget &&
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
        {isToolDrivenReshape &&
          isCurveReshape &&
          reshapingNode &&
          (() => {
            const RegistryAffordance = getRegistryAffordanceTool(reshapingNode.type, 'curve')
            return RegistryAffordance ? (
              <Suspense fallback={null}>
                <RegistryAffordance node={reshapingNode} />
              </Suspense>
            ) : null
          })()}
        {isToolDrivenReshape &&
          controlPointTarget &&
          (() => {
            const RegistryAffordance = getRegistryAffordanceTool('fence', 'move-control-point')
            return RegistryAffordance ? (
              <Suspense fallback={null}>
                <RegistryAffordance target={controlPointTarget} />
              </Suspense>
            ) : null
          })()}
        {isToolDrivenReshape &&
          tangentTarget &&
          (() => {
            const RegistryAffordance = getRegistryAffordanceTool('fence', 'move-tangent')
            return RegistryAffordance ? (
              <Suspense fallback={null}>
                <RegistryAffordance target={tangentTarget} />
              </Suspense>
            ) : null
          })()}
        {/* Reshape kinds without an arm above mount the kind's own affordance tool
            under the reshape's name (`def.affordanceTools[reshape]`, e.g. wall 'split'). */}
        {isToolDrivenReshape &&
          reshapingNode &&
          registryReshape &&
          (() => {
            const RegistryAffordance = getRegistryAffordanceTool(
              reshapingNode.type,
              registryReshape,
            )
            return RegistryAffordance ? (
              <Suspense fallback={null}>
                <RegistryAffordance node={reshapingNode} />
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
        {(!movingNode || registryToolOwnsPlacement) && useRegistryTool && RegistryToolComponent && (
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
        {/* Structural Y-datum feedback for slab, ceiling, wall, and fence
            elevation handles. Ephemeral editor chrome; never scene data. */}
        <Elevation3DGuideLayer />
        {/* "Magnetic" beacon at the active wall-draft snap point. */}
        <WallSnapBeaconLayer />
        {/* Wall ends that aren't joined, with a one-click join — twin of the floor plan's. */}
        <OpenWallEnds3DLayer />
      </group>
    </RegistryToolProvider>
  )
}
